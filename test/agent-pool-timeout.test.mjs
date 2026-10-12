// Verify: a socket in the idle pool carries only the agent timeout; on reuse, the new request's timeout overrides it
// run: node test/agent-pool-timeout.test.mjs
import http from 'node:http';

const srv = http.createServer((req, res) => res.end('ok'));
srv.keepAliveTimeout = 0; // disable the server's Keep-Alive hint to rule out interference
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const agent = new http.Agent({ keepAlive: true, timeout: 9000 });

function doRequest(reqTimeout) {
  return new Promise((resolve) => {
    const opts = { host: '127.0.0.1', port, agent };
    if (reqTimeout !== undefined) opts.timeout = reqTimeout;
    const req = http.request(opts, (res) => {
      const sock = req.socket;
      const inFlight = sock.timeout; // socket timeout while the request is in flight
      res.on('data', () => {});
      res.on('end', () => setImmediate(() => {
        const name = Object.keys(agent.freeSockets)[0];
        const freed = agent.freeSockets[name]?.[0];
        resolve({ reqTimeout, inFlight, freedTimeout: freed?.timeout, sameSocket: freed === sock });
      }));
    });
    req.end();
  });
}

// Request #1: with req.timeout=300 -> in flight it should be 300 (req takes precedence); once returned to the pool it should go back to 9000 (agent)
const r1 = await doRequest(300);
console.log('req#1 (timeout=300):', r1);

// Request #2: without req.timeout, reusing the same idle socket -> in flight it should be 9000 (agent)
const r2 = await doRequest(undefined);
console.log('req#2 (no timeout) :', r2);

// Request #3: with req.timeout=500, reusing the idle socket -> in flight it should be overridden to 500
const r3 = await doRequest(500);
console.log('req#3 (timeout=500):', r3);

agent.destroy();
srv.close();
console.log('\nDone.');
