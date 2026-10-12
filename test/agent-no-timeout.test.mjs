// Verify: when the agent has no `timeout`, how is the idle socket's timeout set
// and how is the server's `Keep-Alive` hint handled?
// run: node test/agent-no-timeout.test.mjs
import http from 'node:http';

// agentTimeout=undefined means "not set"
function freed(serverKeepAliveTimeoutMs, agentTimeout) {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => res.end('ok'));
        srv.keepAliveTimeout = serverKeepAliveTimeoutMs;
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            const opts = { keepAlive: true };
            if (agentTimeout !== undefined) opts.timeout = agentTimeout;
            const agent = new http.Agent(opts);
            const req = http.request({ host: '127.0.0.1', port, agent }, (res) => {
                res.on('data', () => {});
                res.on('end', () =>
                    setImmediate(() => {
                        const name = Object.keys(agent.freeSockets)[0];
                        const free = agent.freeSockets[name]?.[0];
                        const t = free?.timeout;
                        free?.destroy();
                        srv.close();
                        resolve({ serverHint: res.headers['keep-alive'], freedTimeout: t, reused: name !== undefined });
                    })
                );
            });
            req.end();
        });
    });
}

// idle socket timeout is 4s=> Baseline: agent timeout=10000 (already verified it becomes 4000)
console.log('agent=10000, server=5s ->', await freed(5000, 10000));
// idle socket has no timeout=> Key case: agent has no timeout, server still sends the timeout=5 hint
console.log('agent=UNSET, server=5s ->', await freed(5000, undefined));
// idle socket has no timeout=> agent has no timeout, server sends no keep-alive hint
console.log('agent=UNSET, server=off->', await freed(0, undefined));
// idle socket close immediately: agent has no timeout, but server hint too short (1s<=buffer) -> not reused
console.log('agent=UNSET, server=1s ->', await freed(1000, undefined));
console.log('\nDone.');
