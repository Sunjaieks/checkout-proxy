// refine from "proxy-agent": "^6.5.0"
import http from "node:http";
import net from "node:net";
import {Agent as HttpsAgent} from "node:https";
import {URL} from "node:url";
import {once} from "node:events";
import tls from "node:tls";
import assert from "node:assert";

const INTERNAL = Symbol('AgentBaseInternalState');

export class CustomHttpAgent extends http.Agent {
    static parseProxyResponse(socket) {
        return new Promise((resolve, reject) => {
            // we need to buffer any HTTP traffic that happens with the proxy before we get
            // the CONNECT response, so that if the response is anything other than an "200"
            // response code, then we can re-play the "data" events on the socket once the
            // HTTP parser is hooked up...
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
                    // keep buffering
                    read();
                    return;
                }

                const headerParts = buffered.slice(0, endOfHeaders).toString('ascii').split('\r\n');
                const firstLine = headerParts.shift();
                if (!firstLine) {
                    socket.destroy();
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
                        socket.destroy();
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
                    connect: {
                        statusCode,
                        statusText,
                        headers,
                    },
                    buffered,
                });
            }

            socket.on('error', onerror);
            socket.on('end', onend);
            read();
        });
    }

    constructor(protocol, host, port, opts) {
        super(opts);
        this[INTERNAL] = {protocol};
        this.connectOpts = {
            ALPNProtocols: ['http/1.1'],
            host,
            port,
        };
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
            // @ts-expect-error `sockets` is readonly in `@types/node`
            this.sockets[name] = [];
        }
        const fakeSocket = new net.Socket({writable: false});
        this.sockets[name].push(fakeSocket);
        // @ts-expect-error `totalSocketCount` isn't defined in `@types/node`
        this.totalSocketCount++;
        return fakeSocket;
    }

    decrementSockets(name, socket) {
        if (!this.sockets[name] || socket === null) {
            return;
        }
        const sockets = this.sockets[name];
        const index = sockets.indexOf(socket);
        if (index !== -1) {
            sockets.splice(index, 1);
            // @ts-expect-error  `totalSocketCount` isn't defined in `@types/node`
            this.totalSocketCount--;
            if (sockets.length === 0) {
                // @ts-expect-error `sockets` is readonly in `@types/node`
                delete this.sockets[name];
            }
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
        if (!this.isSecureEndpoint()) {
            req._header = null;
            this.setRequestProps(...args);
        }
        super.addRequest(...args);
    }

    setRequestProps(
        ...args
    ) {
        const [req, opts] = args;
        if (!this.isSecureEndpoint()) {
            const protocol = this[INTERNAL].protocol;
            const hostname = req.getHeader('host') || 'localhost';
            const base = `${protocol}//${hostname}`;
            const url = new URL(req.path, base);
            if (opts.port !== 80) {
                url.port = String(opts.port);
            }

            // Change the `http.ClientRequest` instance's "path" field
            // to the absolute path of the URL that will be requested.
            req.path = String(url);

            const headers = {};
            headers['Proxy-Connection'] = this.keepAlive
                ? 'Keep-Alive'
                : 'close';
            for (const name of Object.keys(headers)) {
                const value = headers[name];
                if (value) {
                    req.setHeader(name, value);
                }
            }
            return;
        }
        super.setRequestProps?.(...args);
    }

    createSocket(req, options, cb) {
        const connectOpts = {
            ...options,
            secureEndpoint: this.isSecureEndpoint(options),
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

    set defaultPort(v) {
    }

    get protocol() {
        return this[INTERNAL].protocol;
    }

    set protocol(v) {
    }

    /**
     * Called when the node-core HTTP client library is creating a
     * new HTTP(s) request.
     */
    async connect(req, opts) {
        if (!opts.secureEndpoint) {
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
            const socket2 = net.connect(this.connectOpts);

            // Wait for the socket's `connect` event, so that this `callback()`
            // function throws instead of the `http` request machinery. This is
            // important for i.e. `PacProxyAgent` which determines a failed proxy
            // connection via the `callback()` function throwing.
            await once(socket2, 'connect');
            return socket2;
        }

        if (!opts.host) {
            throw new TypeError('No "host" provided');
        }
        // Create a socket connection to the proxy server.
        const socket = net.connect(this.connectOpts);
        const host = net.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
        const headers = {Host: `${host}:${opts.port}`};
        headers['Proxy-Connection'] = this.keepAlive
            ? 'Keep-Alive'
            : 'close';
        let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r\n`;
        for (const name of Object.keys(headers)) {
            payload += `${name}: ${headers[name]}\r\n`;
        }

        const proxyResponsePromise = CustomHttpAgent.parseProxyResponse(socket);

        socket.write(`${payload}\r\n`);

        const {connect, buffered} = await proxyResponsePromise;
        req.emit('proxyConnect', connect);
        this.emit('proxyConnect', connect, req);

        if (connect.statusCode === 200) {
            req.once('socket', (socket) => socket.resume());
            // The proxy is connecting to a TLS server, so upgrade
            // this socket connection to a TLS connection.
            const copiedOpts = opts.servername === undefined && opts.host && !net.isIP(opts.host) ? {
                ...opts,
                servername: opts.host,
            } : {...opts};
            ['host', 'path', 'port'].forEach((key) => void delete copiedOpts[key]);
            return tls.connect({...copiedOpts, socket});
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
        socket.destroy();

        const fakeSocket = new net.Socket({writable: false});
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
