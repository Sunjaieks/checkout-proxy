/**
 * Test: Unix-domain-socket pairFactory — no TCP port.
 *
 * 1. A single pairServer listens on a temp .sock file (NOT a TCP port).
 * 2. For each MITM connection, we connect() to that .sock to get a pair.
 * 3. TLS cleartext (tlsSocket) pipes into clientEnd.
 * 4. serverEnd is fed to h2InlineServer.emit('connection', serverEnd).
 * 5. Verify both H2 and concurrent connections work.
 */
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream';
import forge from 'node-forge';

const TIMEOUT = 8000;

// ---------------------------------------------------------------------------
// Generate a self-signed cert for testing
// ---------------------------------------------------------------------------
function generateSelfSignedCert(hostname) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    const attrs = [{ name: 'commonName', value: hostname }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return {
        key: forge.pki.privateKeyToPem(keys.privateKey),
        cert: forge.pki.certificateToPem(cert)
    };
}

const { key, cert } = generateSelfSignedCert('localhost');

// ---------------------------------------------------------------------------
// Unix-socket-based pairFactory
// ---------------------------------------------------------------------------
function createUnixPairFactory() {
    const sockPath = path.join(os.tmpdir(), `pair-${process.pid}-${Date.now()}.sock`);
    const pendingPairs = []; // queue of { resolve }

    const server = net.createServer((serverEnd) => {
        const pending = pendingPairs.shift();
        if (pending) pending.resolve(serverEnd);
        else serverEnd.destroy();
    });

    return new Promise((resolve, reject) => {
        server.listen(sockPath, () => {
            console.log(`[PairFactory] Listening on Unix socket: ${sockPath}`);
            resolve({
                getPair: () => new Promise((res) => {
                    const clientEnd = net.connect(sockPath, () => {});
                    pendingPairs.push({ resolve: (serverEnd) => res([clientEnd, serverEnd]) });
                }),
                close: () => {
                    server.close();
                    try { fs.unlinkSync(sockPath); } catch {}
                }
            });
        });
        server.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// Test: full MITM flow — TLS termination + H2 via Unix socket pair
// ---------------------------------------------------------------------------
async function testFullMitmH2() {
    console.log('\n=== Test: Full MITM TLS + H2 via Unix socket pair ===');

    const pairFactory = await createUnixPairFactory();

    // h2InlineServer: plain H2 server (no TLS — cleartext is piped in)
    const h2Server = http2.createServer();
    const requests = [];
    h2Server.on('request', (req, res) => {
        requests.push(req.url);
        console.log(`  [h2Server] Got request: ${req.method} ${req.url} (httpVersion=${req.httpVersion})`);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`hello from ${req.url}`);
    });

    // TLS server that simulates the proxy's manual TLS termination.
    // Client → TLS → (tlsSocket cleartext) → [clientEnd | serverEnd] → h2Server
    const tlsServer = net.createServer(async (cliSoc) => {
        // Manual TLS termination
        const tlsSocket = new tls.TLSSocket(cliSoc, {
            isServer: true,
            secureContext: tls.createSecureContext({ key, cert })
        });

        tlsSocket.on('secure', async () => {
            const [clientEnd, serverEnd] = await pairFactory.getPair();
            // Pipe cleartext ↔ clientEnd
            pipeline(tlsSocket, clientEnd, () => {});
            pipeline(clientEnd, tlsSocket, () => {});
            // Feed serverEnd to h2Server
            h2Server.emit('connection', serverEnd);
        });

        tlsSocket.on('error', (e) => console.log(`  [tlsSocket] error: ${e.message}`));
    });

    await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
    const port = tlsServer.address().port;
    console.log(`  [tlsServer] Listening on 127.0.0.1:${port}`);

    // --- Single H2 client test ---
    console.log('\n  --- Single client test ---');
    const result1 = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve('TIMEOUT'), TIMEOUT);
        const session = http2.connect(`https://localhost:${port}`, {
            rejectUnauthorized: false
        });
        session.on('error', (e) => console.log(`  [client] session error: ${e.message}`));
        const req = session.request({ ':path': '/test1' });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            clearTimeout(timer);
            const body = Buffer.concat(chunks).toString();
            console.log(`  [client] Response: "${body}"`);
            session.close();
            resolve(body);
        });
        req.on('error', (e) => {
            clearTimeout(timer);
            resolve(`ERROR: ${e.message}`);
        });
        req.end();
    });

    // --- Concurrent clients test ---
    console.log('\n  --- Concurrent 5-client test ---');
    const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => new Promise((resolve) => {
            const timer = setTimeout(() => resolve(`TIMEOUT-${i}`), TIMEOUT);
            const session = http2.connect(`https://localhost:${port}`, {
                rejectUnauthorized: false
            });
            session.on('error', (e) => console.log(`  [client-${i}] session error: ${e.message}`));
            const req = session.request({ ':path': `/concurrent-${i}` });
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                clearTimeout(timer);
                const body = Buffer.concat(chunks).toString();
                session.close();
                resolve(body);
            });
            req.on('error', (e) => {
                clearTimeout(timer);
                resolve(`ERROR-${i}: ${e.message}`);
            });
            req.end();
        }))
    );

    console.log(`  [concurrent results]: ${JSON.stringify(results)}`);

    // Cleanup
    tlsServer.close();
    h2Server.close();
    pairFactory.close();

    const singleOk = result1 === 'hello from /test1';
    const concurrentOk = results.every((r, i) => r === `hello from /concurrent-${i}`);
    console.log(`\n  Single client: ${singleOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Concurrent:    ${concurrentOk ? 'PASS' : 'FAIL'}`);
    return singleOk && concurrentOk;
}

(async () => {
    const result = await testFullMitmH2();
    console.log(`\n=== Final: ${result ? 'ALL PASS' : 'FAIL'} ===`);
    process.exit(result ? 0 : 1);
})();