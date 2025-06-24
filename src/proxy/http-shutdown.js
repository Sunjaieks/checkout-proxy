import http from 'node:http';
import { safeDestroy } from '../util/nodeUtil';
import { nextTick, waitFor } from '../util/sharedUtil';
import { DEFAULT_GRACEFUL_TIMEOUT_MS } from '../constant/constant';

export function addShutdown(server, { gracefulTerminationTimeout = DEFAULT_GRACEFUL_TIMEOUT_MS, suppressCloseErrors = [] } = {}) {
    const sockets = new Set();
    const secureSockets = new Set();
    let terminating;

    server.on('connection', (socket) => {
        if (terminating) {
            safeDestroy(socket, null, '[Shutdown]');
            return;
        }
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });

    server.on('secureConnection', (socket) => {
        if (terminating) {
            safeDestroy(socket, null, '[Shutdown]');
            return;
        }
        secureSockets.add(socket);
        socket.once('close', () => secureSockets.delete(socket));
    });

    const destroySocket = (sockets, socket) => {
        safeDestroy(socket, null, '[Shutdown]', true);
        sockets.delete(socket);
    };

    const terminate = async ({ force = false } = {}) => {
        if (terminating) return terminating;

        let resolveTerminating;
        let rejectTerminating;
        terminating = new Promise((resolve, reject) => {
            resolveTerminating = resolve;
            rejectTerminating = reject;
        });

        server.on('request', (_incomingMessage, outgoingMessage) => {
            if (!outgoingMessage.headersSent) {
                outgoingMessage.setHeader('connection', 'close');
            }
        });
        let closeResolved;
        let closeRejected;
        const closing = new Promise((resolve, reject) => {
            closeResolved = resolve;
            closeRejected = reject;
        });
        server.close(function (err) {
            process.nextTick(function () {
                if (err && !suppressCloseErrors.includes(err.code)) {
                    closeRejected(err);
                } else {
                    closeResolved();
                }
            });
        });

        if (force) {
            for (const socket of sockets) destroySocket(sockets, socket);
            for (const socket of secureSockets) destroySocket(secureSockets, socket);
            closing.then(resolveTerminating).catch(rejectTerminating);
            return terminating;
        }

        for (const socket of sockets) {
            // This is the HTTP CONNECT request socket.
            if (!(socket.server instanceof http.Server)) {
                continue;
            }
            // CONNECT socket has no _httpMessage.
            const serverResponse = socket._httpMessage;
            if (serverResponse) {
                if (!serverResponse.headersSent) {
                    serverResponse.setHeader('connection', 'close');
                }
                continue;
            }
            destroySocket(sockets, socket);
        }

        for (const socket of secureSockets) {
            const serverResponse = socket._httpMessage;
            if (serverResponse) {
                if (!serverResponse.headersSent) {
                    serverResponse.setHeader('connection', 'close');
                }
                continue;
            }
            destroySocket(secureSockets, socket);
        }

        try {
            await waitFor(() => sockets.size === 0 && secureSockets.size === 0, {
                interval: 10,
                timeout: gracefulTerminationTimeout
            });
        } catch {
            // ignore timeouts
        } finally {
            for (const socket of sockets) destroySocket(sockets, socket);
            for (const socket of secureSockets) destroySocket(secureSockets, socket);
        }

        closing.then(resolveTerminating).catch(rejectTerminating);

        return terminating;
    };

    server.terminate = terminate;
    server.shutdown = function (cb) {
        terminate()
            .then(() => nextTick(cb))
            .catch((err) => nextTick(cb, err));
    };
    server.forceShutdown = function (cb) {
        terminate({ force: true })
            .then(() => nextTick(cb))
            .catch((err) => nextTick(cb, err));
    };

    return server;
}
