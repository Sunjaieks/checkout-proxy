/**
 * mitm-proxy.mjs
 *
 * A minimal MITM HTTP proxy that:
 *  - Accepts HTTP CONNECT from clients
 *  - Wraps the raw socket with tls.TLSSocket using a dynamically generated cert
 *    (NO SNICallback — the hostname is already known from the CONNECT line)
 *  - Both client-side and upstream-side negotiate HTTP/2 via ALPN
 *  - After TLS termination, pipes the decrypted stream to an inner plain
 *    http2.createServer() via a local TCP connection
 *
 * Architecture:
 *
 *   client ──[CONNECT]──► httpServer
 *                               │  200 Connection Established
 *                               │
 *                         tls.TLSSocket (server-side TLS, cert for hostname)
 *                               │  decrypted h2 frames
 *                         net.pipe ──► h2Server (plain http2, loopback)
 */
import http from 'node:http';
import http2 from 'node:http2';
import tls from 'node:tls';
import net from 'node:net';
import { generateCert } from './cert.mjs';

/**
 * Create and start the MITM proxy.
 *
 * @param {object} opts
 * @param {object} opts.caKey   - forge CA private key object
 * @param {object} opts.caCert  - forge CA certificate object
 * @param {number} [opts.port]  - proxy listen port (0 = random)
 * @returns {Promise<{ httpServer, h2Server, port, intercepted, close }>}
 */
export async function createMitmProxyAsync({ caKey, caCert, port = 0 }) {
    // ── Inner plain HTTP/2 server (receives decrypted connections via pipe) ───
    const h2Server = http2.createServer();
    const intercepted = [];

    h2Server.on('stream', (stream, headers) => {
        const method = headers[':method'];
        const path = headers[':path'];
        intercepted.push({
            httpVersion: '2.0',
            method,
            url: path,
            headers: { ...headers }
        });
        stream.respond({ ':status': 200, 'content-type': 'text/plain' });
        stream.end(`MITM intercepted: ${method} ${path}`);
    });

    h2Server.on('error', () => {});

    // h2Server must be listening so we can pipe connections to it
    await new Promise((resolve) => h2Server.listen(0, '127.0.0.1', resolve));
    const h2Port = h2Server.address().port;

    // Track inner loopback sockets so we can force-close them on shutdown
    const innerSockets = new Set();

    // ── Outer HTTP/1.1 server (accepts CONNECT from clients) ──────────────────
    const httpServer = http.createServer();

    httpServer.on('connect', (req, clientSocket) => {
        // Extract hostname from "CONNECT host:port HTTP/1.1"
        const [hostname] = req.url.split(':');

        // Generate a leaf certificate for this hostname RIGHT NOW,
        // before TLS handshake — no SNICallback needed.
        let secureContext;
        try {
            const { key, cert } = generateCert(hostname, caKey, caCert);
            secureContext = tls.createSecureContext({ key, cert });
        } catch (err) {
            clientSocket.destroy(err);
            return;
        }

        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n', () => {
            if (clientSocket.destroyed) return;

            // Terminate TLS from the client side, advertising h2 via ALPN.
            const tlsSocket = new tls.TLSSocket(clientSocket, {
                isServer: true,
                secureContext, // ← per-hostname cert, set directly (no SNICallback)
                ALPNProtocols: ['h2', 'http/1.1']
            });

            tlsSocket.on('error', () => {});

            tlsSocket.on('secure', () => {
                // TLS handshake done. Pipe the now-decrypted stream to the
                // inner h2Server via a loopback TCP connection.
                const inner = net.connect(h2Port, '127.0.0.1', () => {
                    tlsSocket.pipe(inner);
                    inner.pipe(tlsSocket);
                });
                innerSockets.add(inner);
                inner.on('error', () => {});
                inner.on('close', () => {
                    innerSockets.delete(inner);
                    tlsSocket.destroy();
                });
                tlsSocket.on('close', () => inner.destroy());
            });
        });
    });

    httpServer.on('error', () => {});

    await new Promise((resolve) => httpServer.listen(port, '127.0.0.1', resolve));
    const actualPort = httpServer.address().port;

    function close() {
        for (const s of innerSockets) s.destroy();
        innerSockets.clear();
        httpServer.closeAllConnections?.();
        h2Server.closeAllConnections?.();
        return Promise.all([
            new Promise((resolve) => httpServer.close(resolve)),
            new Promise((resolve) => h2Server.close(resolve))
        ]);
    }

    return { httpServer, h2Server, port: actualPort, intercepted, close };
}
