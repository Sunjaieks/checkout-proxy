// refine from "proxy-agent": "^6.5.0"
// Extended with SOCKS support and HTTP/2 session management
// HTTP/2 Agent inspired by http2-wrapper (szmarczak/http2-wrapper)
import http from 'node:http';
import net from 'node:net';
import { Agent as HttpsAgent } from 'node:https';
import { URL } from 'node:url';
import { once } from 'node:events';
import tls from 'node:tls';
import dns from 'node:dns';
import assert from 'node:assert';
import { logError, safeDestroy } from '../util/nodeUtil.js';
import { SocksClient } from 'socks';

const INTERNAL = Symbol('AgentBaseInternalState');

/**
 * Parse a CONNECT-style proxy response from a raw socket.
 * (Public so it can be reused by the HTTP/2 tunnel helper.)
 */
function parseProxyResponse(socket) {
    return new Promise((resolve, reject) => {
        let buffersLength = 0;
        const buffers = [];

        function read() {
            const b = socket.read();
            if (b) ondata(b);
            else socket.once('readable', read);
        }

        function cleanup() {
            socket.removeListener('end', onend);
            socket.removeListener('error', onerror);
            socket.removeListener('readable', read);
        }

        function onend() {
            cleanup();
            reject(new Error('Proxy connection ended before receiving CONNECT response'));
        }

        function onerror(err) {
            cleanup();
            reject(err);
        }

        function ondata(b) {
            buffers.push(b);
            buffersLength += b.length;

            const buffered = Buffer.concat(buffers, buffersLength);
            const endOfHeaders = buffered.indexOf('\r\n\r\n');

            if (endOfHeaders === -1) {
                read();
                return;
            }

            const headerParts = buffered.slice(0, endOfHeaders).toString('ascii').split('\r\n');
            const firstLine = headerParts.shift();
            if (!firstLine) {
                safeDestroy(socket, null, '[CustomHttpAgent]', true);
                return reject(new Error('No header received from proxy CONNECT response'));
            }
            const firstLineParts = firstLine.split(' ');
            const statusCode = +firstLineParts[1];
            const statusText = firstLineParts.slice(2).join(' ');
            const headers = {};
            for (const header of headerParts) {
                if (!header) continue;
                const firstColon = header.indexOf(':');
                if (firstColon === -1) {
                    safeDestroy(socket, null, '[CustomHttpAgent]', true);
                    return reject(new Error(`Invalid header from proxy CONNECT response: "${header}"`));
                }
                const key = header.slice(0, firstColon).toLowerCase();
                const value = header.slice(firstColon + 1).trimStart();
                const current = headers[key];
                if (typeof current === 'string') {
                    headers[key] = [current, value];
                } else if (Array.isArray(current)) {
                    current.push(value);
                } else {
                    headers[key] = value;
                }
            }
            cleanup();
            resolve({
                connect: { statusCode, statusText, headers },
                buffered
            });
        }

        socket.on('error', onerror);
        socket.on('end', onend);
        read();
    });
}

function createFakeSocket() {
    return new net.Socket({ writable: false });
}

function setServernameFromNonIpHost(options) {
    if (typeof options.servername === 'undefined' && options.host && !net.isIP(options.host)) {
        return { ...options, servername: options.host };
    }
    return { ...options };
}

/**
 * Detect whether a proxy URL is SOCKS.
 */
export function isSocksProxy(proxyUrl) {
    if (!proxyUrl) return false;
    try {
        const u = new URL(proxyUrl);
        const p = u.protocol.replace(':', '').toLowerCase();
        return p === 'socks' || p === 'socks4' || p === 'socks4a' || p === 'socks5' || p === 'socks5h';
    } catch {
        return false;
    }
}

/**
 * Parse SOCKS protocol string into type and DNS lookup configuration.
 * Follows RFC 1928 and the conventions established by socks-proxy-agent:
 *  - socks4:  type 4, client-side DNS lookup  (SOCKS4 only accepts IPs)
 *  - socks4a: type 4, proxy-side DNS          (SOCKS4a extension)
 *  - socks5:  type 5, client-side DNS lookup
 *  - socks5h: type 5, proxy-side DNS          ("h" = host resolved by proxy)
 *  - socks:   type 5, proxy-side DNS          (alias for socks5h)
 */
function parseSocksProtocol(protocol) {
    const p = protocol;
    switch (p) {
        case 'socks4':
            return { type: 4, shouldLookup: true };
        case 'socks4a':
            return { type: 4, shouldLookup: false };
        case 'socks5':
            return { type: 5, shouldLookup: true };
        case 'socks5h':
        case 'socks':
        default:
            return { type: 5, shouldLookup: false };
    }
}

/**
 * Promisified DNS lookup helper that honours a custom `lookup` function
 * (matching the signature used by Node's `net.connect` and `tls.connect`).
 */
function dnsLookupAsync(host, lookupFn) {
    const fn = lookupFn || dns.lookup;
    return new Promise((resolve, reject) => {
        fn(host, {}, (err, address) => {
            if (err) reject(err);
            else {
                resolve(typeof address === 'string' ? address : address[0].address);
            }
        });
    });
}

/**
 * Establish a SOCKS connection to the destination through the given proxy.
 * Handles protocol type, DNS lookup, authentication, and timeout —
 * matching the behaviour of the reference `socks-proxy-agent` package.
 *
 * @param {object} params
 * @param {string} params.proxyHost      - SOCKS proxy hostname
 * @param {number|string} params.proxyPort - SOCKS proxy port
 * @param {string} params.proxyProtocol  - e.g. 'socks5', 'socks5h', 'socks4', 'socks4a'
 * @param {string} [params.userId]       - Decoded username for SOCKS auth
 * @param {string} [params.password]     - Decoded password for SOCKS auth
 * @param {string} params.destHost       - Target hostname or IP
 * @param {number|string} params.destPort - Target port
 * @param {number} [params.timeout]      - Connection timeout in ms
 * @param {Function} [params.lookup]     - Custom DNS lookup function
 * @returns {Promise<net.Socket>}
 */
async function socksConnect({
    proxyHost,
    proxyPort,
    proxyProtocol,
    userId,
    password,
    destHost,
    destPort,
    timeout,
    lookup,
    socketOptions
}) {
    const { type, shouldLookup } = parseSocksProtocol(proxyProtocol);

    // Client-side DNS resolution when required by the protocol variant.
    let host = destHost;
    if (shouldLookup && host && net.isIP(host) === 0) {
        host = await dnsLookupAsync(host, lookup);
    }

    const proxy = {
        host: proxyHost,
        port: Number(proxyPort),
        type
    };
    if (userId) {
        Object.defineProperty(proxy, 'userId', { value: userId, enumerable: false });
    }
    if (password != null) {
        Object.defineProperty(proxy, 'password', { value: password, enumerable: false });
    }

    const socksOpts = {
        proxy,
        command: 'connect',
        destination: { host, port: Number(destPort) },
        socket_options: socketOptions ?? undefined
    };
    if (timeout != null && timeout > 0) {
        socksOpts.timeout = timeout;
    }

    const { socket } = await SocksClient.createConnection(socksOpts);

    // Mirror the timeout behaviour from socks-proxy-agent:
    // keep the timeout on the connected socket so idle connections are reaped.
    if (timeout != null && timeout > 0) {
        socket.setTimeout(timeout);
        socket.on('timeout', () => socket.destroy());
    }

    return socket;
}

/** Clear ALPN and TLS session caches. */
export class CustomMixedAgent extends http.Agent {
    proxyUsername;
    proxyPassword;
    proxyProtocol;
    isSocks;
    socketOptions;
    proxyUrl;

    constructor(protocol, proxy, opts) {
        super(opts);
        this[INTERNAL] = { protocol };
        this.connectOpts = {
            ALPNProtocols: ['http/1.1'],
            host: proxy.host,
            port: proxy.port,
            rejectUnauthorized: false
        };
        this.proxyUsername = proxy.username;
        this.proxyPassword = proxy.password;
        this.proxyProtocol = proxy.protocol;
        this.proxyUrl = proxy.href;
        this.isSocks = proxy.isSocks;
        this.socketOptions = opts?.socketOptions ?? null;
    }

    destroy(err) {
        return super.destroy(err);
    }

    isSecureEndpoint() {
        return this[INTERNAL].protocol === 'https:';
    }

    // In order to support async signatures in `connect()` and Node's native
    // connection pooling in `http.Agent`, the array of sockets for each origin
    // has to be updated synchronously. This is so the length of the array is
    // accurate when `addRequest()` is next called. We achieve this by creating a
    // fake socket and adding it to `sockets[origin]` and incrementing
    // `totalSocketCount`.
    incrementSockets(name) {
        // If `maxSockets` and `maxTotalSockets` are both Infinity then there is no
        // need to create a fake socket because Node.js native connection pooling
        // will never be invoked.
        if (this.maxSockets === Infinity && this.maxTotalSockets === Infinity) {
            return null;
        }
        // All instances of `sockets` are expected TypeScript errors. The
        // alternative is to add it as a private property of this class but that
        // will break TypeScript subclassing.
        if (!this.sockets[name]) {
            this.sockets[name] = [];
        }
        const fakeSocket = createFakeSocket();
        this.sockets[name].push(fakeSocket);

        this.totalSocketCount++;
        return fakeSocket;
    }

    decrementSockets(name, socket) {
        const socketsArr = this.sockets[name];
        if (!socket || !socketsArr) return;
        if (socketsArr.length < 1) {
            delete this.sockets[name];
        }
        const index = socketsArr.indexOf(socket);
        if (index !== -1) {
            socketsArr.splice(index, 1);
            this.totalSocketCount--;
            if (socketsArr.length === 0) {
                delete this.sockets[name];
            }
        }
        try {
            if (socket.__isFake) socket.destroy();
        } catch (e) {
            logError('Error occurred while destroying fake socket:', e);
        }
    }

    // In order to properly update the socket pool, we need to call `getName()` on
    // the core `https.Agent` if it is a secureEndpoint.
    getName(options) {
        if (this.isSecureEndpoint()) {
            return HttpsAgent.prototype.getName.call(this, options);
        }
        return super.getName(options);
    }

    addRequest(...args) {
        const [req, opts] = args;
        // For HTTP proxies the request must use an absolute-URI and carry
        // Proxy-* headers.  SOCKS tunnels are transparent — skip.
        if (!this.isSecureEndpoint() && !this.isSocks) {
            req._header = null;
            this.setRequestProps(...args);
        }
        super.addRequest(...args);
    }

    setRequestProps(...args) {
        const [req, opts] = args;
        if (!this.isSecureEndpoint()) {
            const protocol = this[INTERNAL].protocol;
            // The absolute-URI's authority must be the real connection target
            // (opts.host/opts.hostname) — it tells the upstream proxy where to actually
            // connect. Using the request's own `Host` header here would silently route
            // to whatever host that header names whenever it differs from the target,
            // e.g. when the caller sets `Host` explicitly (keepHostHeader-style use).
            const hostname = opts.host || opts.hostname || 'localhost';
            const base = `${protocol}//${hostname}`;
            const url = new URL(req.path, base);
            if (opts.port !== 80) {
                url.port = String(opts.port);
            }

            // Change the `http.ClientRequest` instance's "path" field
            // to the absolute path of the URL that will be requested.
            req.path = String(url);

            const headers = {};
            if (this.proxyUsername || this.proxyPassword) {
                const auth = `${decodeURIComponent(this.proxyUsername ?? '')}:${decodeURIComponent(this.proxyPassword ?? '')}`;
                headers['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
            }
            headers['Proxy-Connection'] = this.keepAlive ? 'Keep-Alive' : 'close';
            for (const name of Object.keys(headers)) {
                const value = headers[name];
                if (value) req.setHeader(name, value);
            }
            return;
        }
        super.setRequestProps?.(...args);
    }

    createSocket(req, options, cb) {
        const connectOpts = {
            ...options,
            secureEndpoint: this.isSecureEndpoint(options)
        };
        const name = this.getName(connectOpts);
        const fakeSocket = this.incrementSockets(name);
        Promise.resolve()
            .then(() => this.connect(req, connectOpts))
            .then(
                (socket) => {
                    this.decrementSockets(name, fakeSocket);
                    if (socket instanceof http.Agent) {
                        try {
                            return socket.addRequest(req, connectOpts);
                        } catch (err) {
                            return cb(err);
                        }
                    }
                    this[INTERNAL].currentSocket = socket;
                    super.createSocket(req, options, cb);
                },
                (err) => {
                    this.decrementSockets(name, fakeSocket);
                    cb(err);
                }
            );
    }

    createConnection() {
        const socket = this[INTERNAL].currentSocket;
        this[INTERNAL].currentSocket = undefined;
        if (!socket) {
            throw new Error('No socket was returned in the `connect()` function');
        }
        return socket;
    }

    get defaultPort() {
        return this.isSecureEndpoint() ? 443 : 80;
    }
    set defaultPort(v) {}

    get protocol() {
        return this[INTERNAL].protocol;
    }
    set protocol(v) {}

    /**
     * Called when the node-core HTTP client library is creating a new HTTP(s) request.
     */
    async connect(req, opts) {
        // Decoded credentials — needed for both SOCKS auth and HTTP Proxy-Authorization.
        const decodedUser = this.proxyUsername ? decodeURIComponent(this.proxyUsername) : undefined;
        const decodedPass = this.proxyPassword ? decodeURIComponent(this.proxyPassword) : undefined;

        // ---- Non-secure endpoint (plain HTTP through proxy) ----
        if (!opts.secureEndpoint) {
            // SOCKS: transparent tunnel — the request is already in relative form,
            // just create the tunnel and return the socket.
            if (this.isSocks) {
                const socket = await socksConnect({
                    proxyHost: this.connectOpts.host,
                    proxyPort: this.connectOpts.port,
                    proxyProtocol: this.proxyProtocol,
                    userId: decodedUser,
                    password: decodedPass,
                    destHost: opts.host || opts.hostname,
                    destPort: opts.port || 80,
                    timeout: opts.timeout,
                    lookup: opts.lookup,
                    socketOptions: this.socketOptions
                });
                req.emit('proxy', { proxy: this.proxyUrl, socket });
                return socket;
            }

            // HTTP proxy: rewrite to absolute-URI and re-serialise headers.
            req._header = null;
            if (!req.path.includes('://')) {
                this.setRequestProps(req, opts);
            }
            // At this point, the http ClientRequest's internal `_header` field
            // might have already been set. If this is the case then we'll need
            // to re-generate the string since we just changed the `req.path`.
            let first;
            let endOfHeaders;
            req._implicitHeader();
            if (req.outputData && req.outputData.length > 0) {
                first = req.outputData[0].data;
                endOfHeaders = first.indexOf('\r\n\r\n') + 4;
                req.outputData[0].data = req._header + first.substring(endOfHeaders);
            }
            // Create a socket connection to the proxy server.
            let socket2;
            let event = 'connect';
            if (this.proxyProtocol === 'https') {
                socket2 = tls.connect(this.connectOpts);
                event = 'secureConnect';
            } else {
                socket2 = net.connect(this.connectOpts);
            }

            // Wait for the socket's `connect` event, so that this `callback()`
            // function throws instead of the `http` request machinery. This is
            // important for i.e. `PacProxyAgent` which determines a failed proxy
            // connection via the `callback()` function throwing.
            await once(socket2, event);
            return socket2;
        }

        // ---- Secure endpoint (HTTPS through proxy) ----
        if (!opts.host) {
            throw new TypeError('No "host" provided');
        }

        if (this.isSocks) {
            const socksSocket = await socksConnect({
                proxyHost: this.connectOpts.host,
                proxyPort: this.connectOpts.port,
                proxyProtocol: this.proxyProtocol,
                userId: decodedUser,
                password: decodedPass,
                destHost: opts.host,
                destPort: opts.port || 443,
                timeout: opts.timeout,
                lookup: opts.lookup,
                socketOptions: this.socketOptions
            });
            req.emit('proxy', { proxy: this.proxyUrl, socket: socksSocket });
            // Upgrade to TLS for the secure endpoint.
            const copiedOpts = setServernameFromNonIpHost(opts);
            ['host', 'path', 'port'].forEach((key) => void delete copiedOpts[key]);
            const tlsSocket = tls.connect({ ...copiedOpts, socket: socksSocket });
            tlsSocket.once('error', (error) => {
                logError('[socks-agent-error]', error.message);
                safeDestroy(socksSocket);
                safeDestroy(tlsSocket);
                safeDestroy(req);
            });
            return tlsSocket;
        }

        // HTTP / HTTPS CONNECT tunnel
        let socket;
        if (this.proxyProtocol === 'https') {
            socket = tls.connect(setServernameFromNonIpHost(this.connectOpts));
        } else {
            socket = net.connect(this.connectOpts);
        }

        const host = net.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
        const headers = { Host: `${host}:${opts.port}` };
        if (this.proxyUsername || this.proxyPassword) {
            const auth = `${decodeURIComponent(this.proxyUsername ?? '')}:${decodeURIComponent(this.proxyPassword ?? '')}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
        }
        headers['Proxy-Connection'] = this.keepAlive ? 'Keep-Alive' : 'close';
        let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r\n`;
        for (const name of Object.keys(headers)) {
            payload += `${name}: ${headers[name]}\r\n`;
        }

        const proxyResponsePromise = parseProxyResponse(socket);
        socket.write(`${payload}\r\n`);

        const { connect, buffered } = await proxyResponsePromise;
        req.emit('proxyConnect', connect);
        this.emit('proxyConnect', connect, req);

        if (connect.statusCode === 200) {
            req.once('socket', (socket) => socket.resume());
            // The proxy is connecting to a TLS server, so upgrade
            // this socket connection to a TLS connection.
            const copiedOpts = setServernameFromNonIpHost(opts);
            ['host', 'path', 'port'].forEach((key) => void delete copiedOpts[key]);
            return tls.connect({ ...copiedOpts, socket });
        }

        // Some other status code that's not 200... need to re-play the HTTP
        // header "data" events onto the socket once the HTTP machinery is
        // attached so that the node core `http` can parse and handle the
        // error status code.

        // Close the original socket, and a new "fake" socket is returned
        // instead, so that the proxy doesn't get the HTTP request
        // written to it (which may contain `Authorization` headers or other
        // sensitive data).
        //
        // See: https://hackerone.com/reports/541502
        safeDestroy(socket, null, '[CustomHttpAgent]', true);

        const fakeSocket = createFakeSocket();
        fakeSocket.readable = true;

        // Need to wait for the "socket" event to re-play the "data" events.
        req.once('socket', (s) => {
            assert(s.listenerCount('data') > 0);

            // Replay the "buffered" Buffer onto the fake `socket`, since at
            // this point the HTTP module machinery has been hooked up for
            // the user.
            s.push(buffered);
            s.push(null);
        });
        return fakeSocket;
    }
}
