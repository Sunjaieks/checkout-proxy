export function addShutdown(server) {
    server.forceShutdown = function (cb) {
        let error;
        try {
            server.close();
        } catch (e) {
            error = e;
        } finally {
            try {
                server.closeAllConnections();
            } catch (e) {
                error = e;
            } finally {
                cb(error);
            }
        }
    };
    return server;
};
