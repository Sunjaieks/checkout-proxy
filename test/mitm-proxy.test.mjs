/**
 * mitm-proxy.test.mjs
 *
 * Tests for the MITM proxy demo.
 * Run with:  node --test test/mitm-proxy.test.mjs
 *
 * What we verify:
 *  1. Proxy accepts a CONNECT tunnel and terminates TLS without SNICallback.
 *  2. Client can send an HTTP/2 request through the proxy and get a response.
 *  3. The proxy correctly intercepted the request (hostname, method, path).
 *  4. Multiple hostnames each get their own dynamically generated certificate.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import tls from 'node:tls';
import net from 'node:net';
import { createRootCA } from './cert.mjs';
import { createMitmProxyAsync } from './mitm-proxy.mjs';

const TIMEOUT = 10_000;

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Open a CONNECT tunnel through the proxy, perform TLS handshake,
 * and return the connected TLS socket.
 * Removes the data listener from the TCP socket before TLS upgrade
 * so buffered data isn't consumed by the wrong reader.
 */
function connectThroughProxy({ proxyPort, targetHost, targetPort = 443, caCertPem }) {
    return new Promise((resolve, reject) => {
        const tcp = net.connect(proxyPort, '127.0.0.1', () => {
            tcp.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);

            let buf = '';
            const onData = (chunk) => {
                buf += chunk.toString();
                if (buf.includes('\r\n\r\n')) {
                    tcp.removeListener('data', onData);  // must remove before TLS
                    if (!buf.startsWith('HTTP/1.1 200')) {
                        reject(new Error(`CONNECT failed: ${buf.split('\r\n')[0]}`));
                        return;
                    }
                    const tlsSock = tls.connect({
                        socket: tcp,
                        servername: targetHost,
                        ALPNProtocols: ['h2', 'http/1.1'],
                        ca: caCertPem,
                        rejectUnauthorized: true,
                    });
                    tlsSock.on('secureConnect', () => resolve(tlsSock));
                    tlsSock.on('error', reject);
                }
            };
            tcp.on('data', onData);
        });
        tcp.on('error', reject);
    });
}

/**
 * Send one GET request over an existing h2 session and return the response body.
 */
function h2Get(session, path) {
    return new Promise((resolve, reject) => {
        const req = session.request({ ':method': 'GET', ':path': path });
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', reject);
        req.end();
    });
}

// ── test suite ────────────────────────────────────────────────────────────────

describe('MITM proxy (no SNICallback)', { timeout: TIMEOUT }, () => {
    let rootCA;
    let proxy;

    before(async () => {
        rootCA = createRootCA();
        proxy = await createMitmProxyAsync({
            caKey: rootCA.caKey,
            caCert: rootCA.caCert,
            port: 0,
        });
    });

    after(() => {
        // Fire-and-forget: don't let close() stall the suite teardown.
        proxy.close().catch(() => {});
    });

    it('proxy starts and listens on a port', { timeout: TIMEOUT }, () => {
        assert.ok(proxy.port > 0, `Expected a valid port, got ${proxy.port}`);
    });

    it('CONNECT tunnel is established and TLS handshake succeeds', { timeout: TIMEOUT }, async () => {
        const tlsSock = await connectThroughProxy({
            proxyPort: proxy.port,
            targetHost: 'test.example.com',
            caCertPem: rootCA.caCertPem,
        });
        assert.ok(tlsSock.authorized, 'TLS should be authorized with our root CA');
        tlsSock.destroy();
    });

    it('HTTP/2 request through proxy is intercepted correctly', { timeout: TIMEOUT }, async () => {
        const tlsSock = await connectThroughProxy({
            proxyPort: proxy.port,
            targetHost: 'api.example.com',
            caCertPem: rootCA.caCertPem,
        });

        assert.equal(tlsSock.alpnProtocol, 'h2', `Expected ALPN h2, got ${tlsSock.alpnProtocol}`);

        const session = http2.connect('https://api.example.com', {
            createConnection: () => tlsSock,
        });
        session.on('error', () => {});

        const body = await h2Get(session, '/hello');

        session.close();
        assert.ok(body.includes('MITM intercepted'), `Unexpected body: ${body}`);

        const last = proxy.intercepted.at(-1);
        assert.ok(last, 'No intercepted requests recorded');
        assert.equal(last.method, 'GET');
        assert.equal(last.url, '/hello');
    });

    it('multiple hostnames each get their own certificate (no SNI confusion)', { timeout: TIMEOUT }, async () => {
        const hosts = ['alpha.test', 'beta.test', 'gamma.test'];
        const results = await Promise.all(
            hosts.map(async (host) => {
                const sock = await connectThroughProxy({
                    proxyPort: proxy.port,
                    targetHost: host,
                    caCertPem: rootCA.caCertPem,
                });
                const cn = sock.getPeerCertificate()?.subject?.CN;
                sock.destroy();
                return { host, cn };
            })
        );
        for (const { host, cn } of results) {
            assert.equal(cn, host, `Expected CN=${host}, got ${cn}`);
        }
    });
});