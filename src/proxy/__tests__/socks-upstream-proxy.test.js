/**
 * Integration test: a profile whose fixed rules route upstream traffic through a
 * SOCKS5 proxy ("customizedProxy": "socks5://...", as documented in the README's
 * Upstream Proxy Chaining feature). Exercises the real proxy-server.js request path
 * (getProxyAgent -> CustomMixedAgent -> the "socks" package) against a minimal
 * in-process SOCKS5 server standing in for the user's real SOCKS proxy, and plain
 * HTTP/HTTPS servers standing in for the real target.
 *
 * Run:
 *   npm test -- socks-upstream-proxy
 *   or
 *   npx jest socks-upstream-proxy
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
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const assert = require('node:assert');
const forge = require('node-forge');
const { getStartServers, generateRootCA, loadRootCA, clearAgentCache } = require('../proxy-server.js');

function listen0(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve(server.address().port);
        });
    });
}

// Self-signed CA + one leaf cert, used only for the mock HTTPS target (not the proxy's own MITM CA).
function generateTargetHttpsCert(hostname) {
    const caKeys = forge.pki.rsa.generateKeyPair(2048);
    const caCert = forge.pki.createCertificate();
    caCert.publicKey = caKeys.publicKey;
    caCert.serialNumber = '01';
    caCert.validity.notBefore = new Date();
    caCert.validity.notAfter = new Date();
    caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 1);
    const caAttrs = [{ name: 'commonName', value: 'Test SOCKS Target CA' }];
    caCert.setSubject(caAttrs);
    caCert.setIssuer(caAttrs);
    caCert.setExtensions([{ name: 'basicConstraints', cA: true }]);
    caCert.sign(caKeys.privateKey, forge.md.sha256.create());

    const leafKeys = forge.pki.rsa.generateKeyPair(2048);
    const leafCert = forge.pki.createCertificate();
    leafCert.publicKey = leafKeys.publicKey;
    leafCert.serialNumber = Date.now().toString(16);
    leafCert.validity.notBefore = new Date();
    leafCert.validity.notAfter = new Date();
    leafCert.validity.notAfter.setDate(leafCert.validity.notBefore.getDate() + 90);
    leafCert.setSubject([{ name: 'commonName', value: hostname }]);
    leafCert.setIssuer(caCert.subject.attributes);
    leafCert.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }
    ]);
    leafCert.sign(caKeys.privateKey, forge.md.sha256.create());

    return { key: forge.pki.privateKeyToPem(leafKeys.privateKey), cert: forge.pki.certificateToPem(leafCert) };
}

// Minimal SOCKS5 server: no-auth greeting + CONNECT, then pipes to the real destination.
// Records every "host:port" it was asked to CONNECT to, so tests can assert traffic
// actually tunneled through it (and, for the control case, that it did not).
function startSocks5Server() {
    const connectedTo = [];
    const server = net.createServer((client) => {
        client.once('data', (greeting) => {
            if (greeting[0] !== 0x05) {
                client.destroy();
                return;
            }
            client.write(Buffer.from([0x05, 0x00])); // no auth required

            client.once('data', (reqBuf) => {
                if (reqBuf[1] !== 0x01) {
                    // Only CONNECT is supported by this mock.
                    client.destroy();
                    return;
                }
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
                } else {
                    client.destroy();
                    return;
                }
                const port = reqBuf.readUInt16BE(offset);
                connectedTo.push(`${host}:${port}`);

                const upstream = net.connect(port, host, () => {
                    client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // success
                    upstream.pipe(client);
                    client.pipe(upstream);
                });
                upstream.on('error', () => client.destroy());
            });
        });
        client.on('error', () => {});
    });
    return listen0(server).then((port) => ({ server, port, connectedTo }));
}

describe('upstream SOCKS proxy ("customizedProxy": "socks5://...")', () => {
    let socks;
    let httpTarget, httpTargetPort;
    let httpsTarget, httpsTargetPort;
    let started, httpPort;

    beforeAll(async () => {
        const { key, cert, keyIdentifier } = generateRootCA();
        loadRootCA(key, cert, keyIdentifier);

        socks = await startSocks5Server();

        httpTarget = http.createServer((req, res) => res.end('http-via-socks-ok'));
        httpTargetPort = await listen0(httpTarget);

        const leaf = generateTargetHttpsCert('socks-https-target.internal');
        httpsTarget = https.createServer({ key: leaf.key, cert: leaf.cert }, (req, res) =>
            res.end('https-via-socks-ok')
        );
        httpsTargetPort = await listen0(httpsTarget);

        const startServers = getStartServers(
            () => {},
            () => {}
        );

        const profile = {
            name: 'socks-upstream-test',
            proxy: {
                proxyUrl: '',
                hostUsingProxy: [],
                hostBypassProxy: [],
                httpFixedRule: {
                    'socks-http-target.test:80': {
                        target: `http://127.0.0.1:${httpTargetPort}`,
                        customizedProxy: `socks5://127.0.0.1:${socks.port}`
                    }
                },
                httpsFixedRule: {
                    'socks-https-target.test:443': {
                        target: `https://127.0.0.1:${httpsTargetPort}`,
                        customizedProxy: `socks5://127.0.0.1:${socks.port}`
                    }
                }
            }
        };

        started = await startServers('127.0.0.1', [0], profile);
        httpPort = started.startedHttpServer.address().port;
    });

    afterAll(async () => {
        // The SOCKS agent is cached (keepAlive: true) across requests, so the
        // proxy<->SOCKS<->target socket chain is still open at this point — drop it
        // first or the mock servers below hang waiting for a connection to end.
        clearAgentCache();
        await new Promise((r) => httpTarget.close(r));
        await new Promise((r) => httpsTarget.close(r));
        await new Promise((r) => socks.server.close(r));
        if (started?.startedHttpServer) await new Promise((r) => started.startedHttpServer.shutdown(r));
    });

    test('plain HTTP request through the proxy is tunneled via the SOCKS5 proxy to the target', async () => {
        const res = await new Promise((resolve, reject) => {
            const req = http.request(
                {
                    host: '127.0.0.1',
                    port: httpPort,
                    method: 'GET',
                    path: 'http://socks-http-target.test:80/',
                    headers: { Host: 'socks-http-target.test:80' }
                },
                (response) => {
                    const chunks = [];
                    response.on('data', (c) => chunks.push(c));
                    response.on('end', () =>
                        resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
                    );
                }
            );
            req.on('error', reject);
            req.end();
        });

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body, 'http-via-socks-ok');
        assert.ok(
            socks.connectedTo.includes(`127.0.0.1:${httpTargetPort}`),
            `expected the SOCKS server to see a CONNECT to 127.0.0.1:${httpTargetPort}, got: ${socks.connectedTo}`
        );
    });

    test('HTTPS request through the MITM proxy is tunneled via the SOCKS5 proxy to the target', async () => {
        // 1. CONNECT through the proxy's single HTTP port to establish the MITM tunnel.
        const connectSocket = await new Promise((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1',
                port: httpPort,
                method: 'CONNECT',
                path: 'socks-https-target.test:443'
            });
            req.on('connect', (res, socket) => resolve(socket));
            req.on('error', reject);
            req.end();
        });

        // 2. TLS-wrap the tunnel (the proxy MITMs with a leaf cert for socks-https-target.test).
        const tlsSocket = tls.connect({
            socket: connectSocket,
            servername: 'socks-https-target.test',
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
            tlsSocket.write('GET / HTTP/1.1\r\nHost: socks-https-target.test\r\nConnection: close\r\n\r\n');
        });

        const statusLine = rawResponse.split('\r\n')[0];
        assert.ok(/^HTTP\/1\.1 200/.test(statusLine), `Expected 200, got: ${JSON.stringify(statusLine)}`);
        assert.ok(rawResponse.endsWith('https-via-socks-ok'), `Expected body, got full response: ${rawResponse}`);
        assert.ok(
            socks.connectedTo.includes(`127.0.0.1:${httpsTargetPort}`),
            `expected the SOCKS server to see a CONNECT to 127.0.0.1:${httpsTargetPort}, got: ${socks.connectedTo}`
        );
    });

    test('a request not matching any SOCKS rule bypasses the SOCKS proxy entirely (control case)', async () => {
        const directTarget = http.createServer((req, res) => res.end('direct-ok'));
        const directPort = await listen0(directTarget);
        try {
            const res = await new Promise((resolve, reject) => {
                const req = http.request(
                    {
                        host: '127.0.0.1',
                        port: httpPort,
                        method: 'GET',
                        path: `http://127.0.0.1:${directPort}/`,
                        headers: { Host: `127.0.0.1:${directPort}` }
                    },
                    (response) => {
                        const chunks = [];
                        response.on('data', (c) => chunks.push(c));
                        response.on('end', () =>
                            resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
                        );
                    }
                );
                req.on('error', reject);
                req.end();
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.body, 'direct-ok');
            assert.ok(
                !socks.connectedTo.includes(`127.0.0.1:${directPort}`),
                'the SOCKS proxy should never have seen this direct request'
            );
        } finally {
            await new Promise((r) => directTarget.close(r));
        }
    });
});
