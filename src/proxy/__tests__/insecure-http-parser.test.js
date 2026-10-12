/**
 * Regression test for HPE_CR_EXPECTED when an upstream server sends a
 * header line terminated with a bare LF instead of CRLF (seen in the wild
 * from some CDN/WAF stacks). Node's strict llhttp parser rejects this by
 * default; the fix sets `insecureHTTPParser: true` on the outbound request
 * options in both the HTTP and HTTPS proxy paths.
 *
 * Run:
 *   npm test -- insecure-http-parser
 *   or
 *   npx jest insecure-http-parser
 */

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
const tls = require('node:tls');
const assert = require('node:assert');
const { getStartServers, generateRootCA, loadRootCA } = require('../proxy-server.js');

function listen0(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve(server.address().port);
        });
    });
}

// Upstream that speaks raw sockets so it can emit a non-CRLF header line
// that the `http` module itself would refuse to write.
function startBareLfUpstream() {
    const server = net.createServer((socket) => {
        socket.once('data', () => {
            socket.end(
                'HTTP/1.1 200 OK\r\n' +
                    'Content-Type: text/plain\r\n' +
                    'X-Weird-Header: value\n' + // bare LF, no CR — triggers HPE_CR_EXPECTED
                    'Content-Length: 2\r\n' +
                    '\r\n' +
                    'ok'
            );
        });
    });
    return server;
}

function httpGet(opts) {
    return new Promise((resolve, reject) => {
        const req = http.request(opts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

describe('insecureHTTPParser regression (HPE_CR_EXPECTED)', () => {
    let upstream, upstreamPort, started, httpPort;

    beforeAll(async () => {
        const { key, cert, keyIdentifier } = generateRootCA();
        loadRootCA(key, cert, keyIdentifier);

        upstream = startBareLfUpstream();
        upstreamPort = await listen0(upstream);

        const startServers = getStartServers(
            () => {},
            () => {}
        );

        const profile = {
            name: 'test-profile',
            proxy: {
                proxyUrl: '',
                hostUsingProxy: [],
                hostBypassProxy: [],
                httpsFixedRule: {
                    'bare-lf.test:443': {
                        target: `http://127.0.0.1:${upstreamPort}`
                    }
                },
                httpFixedRule: {}
            }
        };

        started = await startServers('127.0.0.1', [0], profile);
        httpPort = started.startedHttpServer.address().port;
    });

    afterAll(async () => {
        await new Promise((r) => upstream.close(r));
        if (started?.startedHttpServer) await new Promise((r) => started.startedHttpServer.shutdown(r));
    });

    test('MITM HTTPS request to an upstream with a bare-LF header succeeds instead of HPE_CR_EXPECTED', async () => {
        // 1. CONNECT through the proxy's single HTTP port.
        const connectSocket = await new Promise((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1',
                port: httpPort,
                method: 'CONNECT',
                path: 'bare-lf.test:443'
            });
            req.on('connect', (res, socket) => resolve(socket));
            req.on('error', reject);
            req.end();
        });

        // 2. TLS-wrap the tunnel (the proxy MITMs with a leaf cert for bare-lf.test).
        const tlsSocket = tls.connect({
            socket: connectSocket,
            servername: 'bare-lf.test',
            rejectUnauthorized: false
        });
        await new Promise((resolve, reject) => {
            tlsSocket.once('secureConnect', resolve);
            tlsSocket.once('error', reject);
        });

        // 3. Send a plain HTTPS request over the TLS tunnel and read the raw response.
        const rawResponse = await new Promise((resolve, reject) => {
            const chunks = [];
            tlsSocket.on('data', (c) => chunks.push(c));
            tlsSocket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            tlsSocket.on('error', reject);
            tlsSocket.write('GET / HTTP/1.1\r\nHost: bare-lf.test\r\nConnection: close\r\n\r\n');
        });

        const statusLine = rawResponse.split('\r\n')[0];
        assert.ok(
            /^HTTP\/1\.1 200/.test(statusLine),
            `Expected 200 from upstream via insecureHTTPParser, got: ${JSON.stringify(statusLine)}\nFull response: ${rawResponse}`
        );
        assert.ok(!rawResponse.includes('HPE_CR_EXPECTED'), `Response should not contain HPE_CR_EXPECTED: ${rawResponse}`);
        assert.ok(rawResponse.endsWith('ok'), `Expected body "ok", got full response: ${JSON.stringify(rawResponse)}`);
    });
});
