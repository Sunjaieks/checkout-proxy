// Verify: CustomMixedAgent tunnels HTTP and HTTPS requests through a SOCKS5 proxy.
// A minimal in-process SOCKS5 server (CONNECT, no-auth) stands in for a real proxy;
// requests are driven through it to a plain-HTTP and a TLS target and the bodies
// are asserted.
// run: node test/socks-agent.test.mjs
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert';
import { CustomMixedAgent, isSocksProxy } from '../src/proxy/agent.js';
import { createRootCA, generateCert } from './cert.mjs';

// --- Minimal SOCKS5 server: no-auth greeting + CONNECT, then pipe to dest. -------
function startSocks5Server() {
    let connectCount = 0;
    const server = net.createServer((client) => {
        client.once('data', (greeting) => {
            // greeting: VER, NMETHODS, METHODS...  -> reply "no auth required".
            assert.strictEqual(greeting[0], 0x05, 'SOCKS version 5');
            client.write(Buffer.from([0x05, 0x00]));

            client.once('data', (reqBuf) => {
                // request: VER, CMD, RSV, ATYP, ADDR, PORT(2)
                assert.strictEqual(reqBuf[1], 0x01, 'CONNECT command');
                const atyp = reqBuf[3];
                let host;
                let offset;
                if (atyp === 0x01) {
                    host = `${reqBuf[4]}.${reqBuf[5]}.${reqBuf[6]}.${reqBuf[7]}`;
                    offset = 8;
                } else if (atyp === 0x03) {
                    const len = reqBuf[4];
                    host = reqBuf.slice(5, 5 + len).toString('utf8');
                    offset = 5 + len;
                } else if (atyp === 0x04) {
                    const parts = [];
                    for (let i = 0; i < 16; i += 2) parts.push(reqBuf.readUInt16BE(4 + i).toString(16));
                    host = parts.join(':');
                    offset = 20;
                } else {
                    client.destroy();
                    return;
                }
                const port = reqBuf.readUInt16BE(offset);
                connectCount++;

                const upstream = net.connect(port, host === '::1' ? '::1' : host, () => {
                    // reply: success, bind addr 0.0.0.0:0
                    client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                    upstream.pipe(client);
                    client.pipe(upstream);
                });
                upstream.on('error', () => client.destroy());
            });
        });
        client.on('error', () => {});
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () =>
            resolve({
                server,
                get connectCount() {
                    return connectCount;
                }
            })
        );
    });
}

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// Perform one request through `agent` and collect the body.
function request(mod, opts, agent) {
    return new Promise((resolve, reject) => {
        const req = mod.request({ ...opts, agent, timeout: 5000 }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

function makeSocksAgent(protocol, socksPort) {
    // Descriptor mirrors what proxy-server.js#buildProxyDescriptor produces.
    const href = `socks5://127.0.0.1:${socksPort}`;
    return new CustomMixedAgent(
        protocol,
        {
            host: '127.0.0.1',
            port: socksPort,
            username: undefined,
            password: undefined,
            protocol: 'socks5',
            href,
            isSocks: true
        },
        { keepAlive: false, rejectUnauthorized: false }
    );
}

async function main() {
    // Sanity: URL classification.
    assert.strictEqual(isSocksProxy('socks5://x:1'), true);
    assert.strictEqual(isSocksProxy('http://x:1'), false);

    const socks = await startSocks5Server();
    const socksPort = socks.server.address().port;

    // --- HTTP target ---
    const httpServer = http.createServer((req, res) => res.end('http-ok'));
    const httpPort = await listen(httpServer);

    // --- HTTPS target (self-signed for 'localhost') ---
    const ca = createRootCA();
    const leaf = generateCert('localhost', ca.caKey, ca.caCert);
    const httpsServer = https.createServer({ key: leaf.key, cert: leaf.cert }, (req, res) => res.end('https-ok'));
    const httpsPort = await listen(httpsServer);

    // HTTP through SOCKS
    const httpAgent = makeSocksAgent('http:', socksPort);
    const r1 = await request(http, { host: '127.0.0.1', port: httpPort, path: '/', protocol: 'http:' }, httpAgent);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.body, 'http-ok');
    console.log('HTTP  via SOCKS ->', r1);

    // HTTPS through SOCKS
    const httpsAgent = makeSocksAgent('https:', socksPort);
    const r2 = await request(
        https,
        {
            host: 'localhost',
            port: httpsPort,
            path: '/',
            protocol: 'https:',
            servername: 'localhost',
            ca: ca.caCertPem
        },
        httpsAgent
    );
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r2.body, 'https-ok');
    console.log('HTTPS via SOCKS ->', r2);

    assert.ok(socks.connectCount >= 2, `expected >=2 SOCKS CONNECTs, got ${socks.connectCount}`);

    httpAgent.destroy();
    httpsAgent.destroy();
    httpServer.close();
    httpsServer.close();
    socks.server.close();
    console.log('\nAll SOCKS agent assertions passed. SOCKS CONNECTs:', socks.connectCount);
}

main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
