/**
 * Test: Can we create a connected socket pair WITHOUT listening on any port,
 * and feed one end to http2.createServer().emit('connection', ...) ?
 *
 * Approaches:
 *   A) Custom Duplex pair (no handle)
 *   B) Unix domain socket (temp file, no TCP port)
 *   C) net.Socket + manual pipe (no handle)
 */
import http2 from 'node:http2';
import net from 'node:net';
import { Duplex } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT = 5000;

// =========================================================================
//  Approach A: Custom Duplex pair — two Duplex streams wired together
// =========================================================================
async function testDuplexPair() {
    console.log('\n=== Approach A: Custom Duplex pair (no handle) ===');
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            console.log('[A] TIMEOUT — no request received');
            h2Server.close();
            resolve(false);
        }, TIMEOUT);

        // Create a connected pair of Duplex streams
        let streamA, streamB;
        streamA = new Duplex({
            read() {},
            write(chunk, enc, cb) { streamB.push(chunk); cb(); },
            final(cb) { streamB.push(null); cb(); }
        });
        streamB = new Duplex({
            read() {},
            write(chunk, enc, cb) { streamA.push(chunk); cb(); },
            final(cb) { streamA.push(null); cb(); }
        });

        const h2Server = http2.createServer({ allowHTTP1: true });
        h2Server.on('request', (req, res) => {
            console.log(`[A] Got request: ${req.method} ${req.url}`);
            res.writeHead(200);
            res.end('ok-A');
        });
        h2Server.on('error', (e) => console.log(`[A] Server error: ${e.message}`));

        // Feed streamB (server end) to h2 server
        try {
            h2Server.emit('connection', streamB);
        } catch (e) {
            console.log(`[A] emit('connection') threw: ${e.message}`);
            clearTimeout(timer);
            h2Server.close();
            resolve(false);
            return;
        }

        // Write an HTTP/1.1 request into streamA (client end)
        try {
            streamA.write('GET / HTTP/1.1\r\nHost: test\r\n\r\n');
        } catch (e) {
            console.log(`[A] write threw: ${e.message}`);
        }

        // Collect response from streamA
        const chunks = [];
        streamA.on('data', (chunk) => {
            chunks.push(chunk);
            const resp = Buffer.concat(chunks).toString();
            if (resp.includes('ok-A')) {
                console.log('[A] SUCCESS — got response');
                clearTimeout(timer);
                h2Server.close();
                resolve(true);
            }
        });
        streamA.on('error', (e) => console.log(`[A] streamA error: ${e.message}`));
    });
}

// =========================================================================
//  Approach B: Unix domain socket — temp file, no TCP port
// =========================================================================
async function testUnixSocket() {
    console.log('\n=== Approach B: Unix domain socket (no TCP port) ===');
    const sockPath = path.join(os.tmpdir(), `pair-test-${process.pid}-${Date.now()}.sock`);

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            console.log('[B] TIMEOUT — no request received');
            cleanup();
            resolve(false);
        }, TIMEOUT);

        const h2Server = http2.createServer({ allowHTTP1: true });
        let pairServer;
        let clientEnd, serverEnd;

        const cleanup = () => {
            clearTimeout(timer);
            try { clientEnd?.destroy(); } catch {}
            try { serverEnd?.destroy(); } catch {}
            try { pairServer?.close(); } catch {}
            try { h2Server.close(); } catch {}
            try { fs.unlinkSync(sockPath); } catch {}
        };

        h2Server.on('request', (req, res) => {
            console.log(`[B] Got request: ${req.method} ${req.url}`);
            res.writeHead(200);
            res.end('ok-B');
        });

        // Create socket pair via Unix domain socket
        pairServer = net.createServer((socket) => {
            serverEnd = socket;
            // Feed to h2 server
            h2Server.emit('connection', serverEnd);
        });

        pairServer.listen(sockPath, () => {
            clientEnd = net.connect(sockPath, () => {
                // Write HTTP/1.1 request
                clientEnd.write('GET / HTTP/1.1\r\nHost: test\r\n\r\n');
            });

            const chunks = [];
            clientEnd.on('data', (chunk) => {
                chunks.push(chunk);
                const resp = Buffer.concat(chunks).toString();
                if (resp.includes('ok-B')) {
                    console.log('[B] SUCCESS — got response');
                    cleanup();
                    resolve(true);
                }
            });
            clientEnd.on('error', (e) => console.log(`[B] clientEnd error: ${e.message}`));
        });
    });
}

// =========================================================================
//  Approach C: Unix domain socket + HTTP/2 client (not H1 request)
// =========================================================================
async function testUnixSocketH2() {
    console.log('\n=== Approach C: Unix domain socket + H2 client ===');
    const sockPath = path.join(os.tmpdir(), `pair-h2-${process.pid}-${Date.now()}.sock`);

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            console.log('[C] TIMEOUT — no H2 request received');
            cleanup();
            resolve(false);
        }, TIMEOUT);

        const h2Server = http2.createServer({ allowHTTP1: true });
        let pairServer;
        let clientEnd, serverEnd;

        const cleanup = () => {
            clearTimeout(timer);
            try { clientEnd?.destroy(); } catch {}
            try { serverEnd?.destroy(); } catch {}
            try { pairServer?.close(); } catch {}
            try { h2Server.close(); } catch {}
            try { fs.unlinkSync(sockPath); } catch {}
        };

        h2Server.on('request', (req, res) => {
            console.log(`[C] Got H2 request: ${req.method} ${req.url} (httpVersion=${req.httpVersion})`);
            res.writeHead(200);
            res.end('ok-C');
        });

        h2Server.on('session', (session) => {
            console.log('[C] H2 session created');
        });

        // Create socket pair via Unix domain socket
        pairServer = net.createServer((socket) => {
            serverEnd = socket;
            h2Server.emit('connection', serverEnd);
        });

        pairServer.listen(sockPath, () => {
            clientEnd = net.connect(sockPath, () => {
                // Use http2.connect over this socket
                const clientSession = http2.connect('http://localhost', {
                    createConnection: () => clientEnd
                });
                clientSession.on('error', (e) => console.log(`[C] clientSession error: ${e.message}`));

                const req = clientSession.request({ ':path': '/' });
                const chunks = [];
                req.on('data', (chunk) => chunks.push(chunk));
                req.on('end', () => {
                    const body = Buffer.concat(chunks).toString();
                    console.log(`[C] SUCCESS — got H2 response: "${body}"`);
                    clientSession.close();
                    cleanup();
                    resolve(true);
                });
                req.on('error', (e) => {
                    console.log(`[C] req error: ${e.message}`);
                    cleanup();
                    resolve(false);
                });
                req.end();
            });
            clientEnd.on('error', (e) => console.log(`[C] clientEnd error: ${e.message}`));
        });
    });
}

// =========================================================================
//  Run all tests
// =========================================================================
(async () => {
    const resultA = await testDuplexPair();
    const resultB = await testUnixSocket();
    const resultC = await testUnixSocketH2();

    console.log('\n=== Summary ===');
    console.log(`A) Duplex pair (no handle):       ${resultA ? 'PASS' : 'FAIL'}`);
    console.log(`B) Unix socket + H1:              ${resultB ? 'PASS' : 'FAIL'}`);
    console.log(`C) Unix socket + H2:              ${resultC ? 'PASS' : 'FAIL'}`);
    process.exit(0);
})();