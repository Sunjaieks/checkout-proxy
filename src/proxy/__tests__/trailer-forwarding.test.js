/**
 * Integration-style test for trailer forwarding.
 *
 * It starts:
 * - an upstream HTTP server that responds with `Trailer` + actual trailers
 * - a tiny proxy server that uses the same trailer-forwarding helpers as the app
 * - a client request to the proxy that asserts headers/trailers are received
 *
 * Run:
 *   npm test -- trailer-forwarding
 *   or
 *   npx jest trailer-forwarding
 */

// Mock electron before importing anything that depends on it
jest.mock('electron', () => ({
    app: {
        getPath: (name) => {
            const os = require('os');
            const path = require('path');
            if (name === 'userData') {
                return path.join(os.tmpdir(), 'checkout-proxy-test');
            }
            return os.tmpdir();
        }
    }
}));

const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert');
const { pipeResponseAndMaybeAddTrailers } = require('../trailer-forwarding.js');
const { CustomHttpAgent } = require('../agent.js');

function listen0(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve(server.address().port);
        });
    });
}

function requestP(opts, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(opts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('error', reject);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    trailers: res.trailers,
                    body: Buffer.concat(chunks).toString('utf8')
                });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

describe('Trailer Forwarding Integration Test', () => {
    test('forwards trailers correctly', async () => {
        const upstream = http.createServer((req, res) => {
            if (req.url !== '/trailers') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('not found');
                return;
            }
            // Declare which trailers will be sent.
            res.writeHead(200, {
                'Content-Type': 'text/plain',
                Trailer: 'X-Test-Trailer',
                'Transfer-Encoding': 'chunked'
            });
            // Body
            res.write('hello');
            res.write('world');
            // Set trailers before ending.
            res.addTrailers({ 'X-Test-Trailer': 'abc123' });
            res.end();
        });

        const upstreamPort = await listen0(upstream);

        // 1. Start a temporary HTTP proxy server
        const tempProxy = http.createServer();
        tempProxy.on('connect', (req, clientSocket, head) => {
            const [host, port] = req.url.split(':');
            const serverSocket = net.connect(port, host, () => {
                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head && head.length > 0) serverSocket.write(head);
                serverSocket.pipe(clientSocket);
                clientSocket.pipe(serverSocket);
            });
            serverSocket.on('error', (err) => {
                clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            });
            clientSocket.on('error', () => {
                serverSocket.destroy();
            });
        });
        // Handle normal GET/POST requests to the proxy
        tempProxy.on('request', (req, res) => {
            const url = new URL(req.url, 'http://' + (req.headers.host || '127.0.0.1'));
            const proxyReq = http.request(
                {
                    host: url.hostname,
                    port: url.port || 80,
                    path: url.pathname + url.search,
                    method: req.method,
                    headers: req.headers
                },
                (proxyRes) => {
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    pipeResponseAndMaybeAddTrailers(proxyRes, res, '[temp-proxy]', console.error);
                }
            );
            proxyReq.on('error', () => {
                res.writeHead(502);
                res.end();
            });
            req.pipe(proxyReq);
        });
        const tempProxyPort = await listen0(tempProxy);

        // 2. Proxy server that uses CustomHttpAgent to forward requests through tempProxy
        const proxy = http.createServer((clientReq, clientRes) => {
            const agent = new CustomHttpAgent(
                'http:',
                {
                    host: '127.0.0.1',
                    port: tempProxyPort,
                    protocol: 'http'
                },
                { keepAlive: false }
            );

            const proxyReq = http.request(
                {
                    host: '127.0.0.1',
                    port: upstreamPort,
                    path: clientReq.url,
                    method: clientReq.method,
                    headers: { ...clientReq.headers },
                    agent: agent
                },
                (proxyRes) => {
                    const responseHeaders = { ...proxyRes.headers };
                    clientRes.writeHead(proxyRes.statusCode, responseHeaders);
                    pipeResponseAndMaybeAddTrailers(proxyRes, clientRes, '[test-proxy]', console.error);
                }
            );
            proxyReq.on('error', (err) => {
                if (!clientRes.headersSent) clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
                clientRes.end(String(err?.message || err));
            });
            clientReq.pipe(proxyReq);
        });

        const proxyPort = await listen0(proxy);

        try {
            const result = await requestP({
                host: '127.0.0.1',
                port: proxyPort,
                path: '/trailers',
                method: 'GET'
            });

            assert.strictEqual(result.statusCode, 200);
            assert.strictEqual(result.body, 'helloworld');

            // `Trailer` header is lower-cased by Node client.
            assert.ok(
                typeof result.headers.trailer === 'string' && /x-test-trailer/i.test(result.headers.trailer),
                `Expected headers.trailer to include x-test-trailer, got: ${JSON.stringify(result.headers.trailer)}`
            );

            assert.ok(!('content-length' in result.headers), 'Expected no content-length when forwarding trailers');
            assert.ok(
                typeof result.headers['transfer-encoding'] === 'string' &&
                    /chunked/i.test(result.headers['transfer-encoding']),
                `Expected transfer-encoding chunked, got: ${JSON.stringify(result.headers['transfer-encoding'])}`
            );

            assert.strictEqual(
                result.trailers['x-test-trailer'],
                'abc123',
                `Expected trailers[x-test-trailer]=abc123, got: ${JSON.stringify(result.trailers)}`
            );
        } finally {
            await new Promise((r) => proxy.close(r));
            await new Promise((r) => tempProxy.close(r));
            await new Promise((r) => upstream.close(r));
        }
    });
});
