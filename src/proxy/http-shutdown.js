export function addShutdown(server) {
    const connections = {};
    let isShuttingDown = false;
    let connectionCounter = 0;

    function destroy(socket, force) {
        if (force || (socket._isIdle && isShuttingDown)) {
            socket.destroy();
            delete connections[socket._connectionId];
        }
    };

    function onConnection(socket) {
        var id = connectionCounter++;
        socket._isIdle = true;
        socket._connectionId = id;
        connections[id] = socket;

        socket.on('close', function() {
            delete connections[id];
        });
    };

    server.on('request', function(req, res) {
        req.socket._isIdle = false;

        res.on('finish', function() {
            req.socket._isIdle = true;
            destroy(req.socket);
        });
    });

    server.on('connection', onConnection);
    server.on('secureConnection', onConnection);

    function shutdown(force, cb) {
        isShuttingDown = true;
        server.close(function(err) {
            if (cb) {
                process.nextTick(function() { cb(err); });
            }
        });

        Object.keys(connections).forEach(function(key) {
            destroy(connections[key], force);
        });
    };

    server.shutdown = function(cb) {
        shutdown(false, cb);
    };

    server.forceShutdown = function(cb) {
        shutdown(true, cb);
    };

    return server;
};
