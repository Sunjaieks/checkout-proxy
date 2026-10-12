// Verify how keepSocketAlive handles the server's `Keep-Alive: timeout=N` hint
// run: node test/agent-keepalive-hint.test.mjs
import http from 'node:http';

function freedSocketTimeout(serverKeepAliveTimeoutMs, agentTimeout, agentBuffer) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => res.end('ok'));
    // make the server send `Keep-Alive: timeout=<seconds>` in its response
    srv.keepAliveTimeout = serverKeepAliveTimeoutMs;
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const agent = new http.Agent({
        keepAlive: true,
        timeout: agentTimeout,
        agentKeepAliveTimeoutBuffer: agentBuffer, // default 1000
      });
      const req = http.request({ host: '127.0.0.1', port, agent }, (res) => {
        let hdr;
        res.on('data', () => {});
        res.on('end', () => setImmediate(() => {
          hdr = res.headers['keep-alive'];
          const name = Object.keys(agent.freeSockets)[0];
          const free = agent.freeSockets[name]?.[0];
          const t = free?.timeout;
          free?.destroy();
          srv.close();
          resolve({ hdr, freedTimeout: t, reused: name !== undefined });
        }));
      });
      req.end();
    });
  });
}

// server advertises timeout=5s, agent timeout=10s, buffer=1000ms
console.log('A) server=5s, agent=10000, buffer=1000 ->',
  await freedSocketTimeout(5000, 10000, 1000));
// same as above but agent timeout=2s (smaller than 5s-1s=4s, so the agent's 2000 should be kept)
console.log('B) server=5s, agent=2000,  buffer=1000 ->',
  await freedSocketTimeout(5000, 2000, 1000));
// server advertises timeout=1s, buffer=1000ms -> 1000-1000=0 -> socket is not reused
console.log('C) server=1s, agent=10000, buffer=1000 ->',
  await freedSocketTimeout(1000, 10000, 1000));
console.log('\nDone.');