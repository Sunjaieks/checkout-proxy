// Empirical investigation of `new http.Agent({ timeout })`
// Run: node test/agent-timeout.test.mjs
import http from 'node:http';

const log = (...a) => console.log(...a);

function makeServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// A server that accepts the request but never sends a response body/headers.
const slowServer = await makeServer((req, res) => {
  // Intentionally never call res.end() -> client sits idle waiting.
});
const port = slowServer.address().port;

// ---------------------------------------------------------------------------
// Test 1: agent.options.timeout is applied to the underlying socket as
//         socket.setTimeout(), and the 'timeout' event fires after idle.
// ---------------------------------------------------------------------------
async function test1() {
  log('\n=== Test 1: agent timeout -> socket.setTimeout + "timeout" event ===');
  const agent = new http.Agent({ keepAlive: true, timeout: 400 });

  await new Promise((resolve) => {
    const start = Date.now();
    const req = http.request({ host: '127.0.0.1', port, agent }, () => {});
    let socketRef;
    let socketTimeoutFired = false;
    let requestTimeoutFired = false;

    req.on('socket', (s) => {
      socketRef = s;
      // Inspect the timeout the agent installed on the socket.
      queueMicrotask(() => log('  socket.timeout after assignment =', s.timeout));
      s.on('timeout', () => {
        socketTimeoutFired = true;
        log(`  'timeout' event on SOCKET fired @ ${Date.now() - start}ms`);
        log('  NOTE: socket NOT auto-destroyed; socket.destroyed =', s.destroyed);
        s.destroy();
      });
    });
    // Does the *request* emit timeout too? (agent timeout vs req.setTimeout)
    req.on('timeout', () => { requestTimeoutFired = true; log("  'timeout' event on REQUEST fired"); });
    req.on('error', (e) => log('  request error:', e.code || e.message));
    req.on('close', () => {
      log('  --> socketTimeoutFired =', socketTimeoutFired, '| requestTimeoutFired =', requestTimeoutFired);
      resolve();
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test 2: per-request timeout (http.request({timeout})) OVERRIDES agent timeout.
//         createSocket source: `req.timeout || this.options.timeout`.
// ---------------------------------------------------------------------------
async function test2() {
  log('\n=== Test 2: per-request timeout overrides agent timeout ===');
  const agent = new http.Agent({ keepAlive: true, timeout: 5000 });
  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, agent, timeout: 300 }, () => {});
    req.on('socket', (s) => queueMicrotask(() => log('  socket.timeout =', s.timeout, '(req=300 wins over agent=5000)')));
    req.on('close', resolve);
    req.on('error', () => {});
    req.setTimeout(300, () => { req.destroy(); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test 3: on a kept-alive (idle) socket, keepSocketAlive() re-applies
//         agent.options.timeout so idle sockets get reaped.
// ---------------------------------------------------------------------------
async function test3() {
  log('\n=== Test 3: idle keep-alive socket keeps agent timeout ===');
  const okServer = await makeServer((req, res) => res.end('ok'));
  const p = okServer.address().port;
  const agent = new http.Agent({ keepAlive: true, timeout: 350 });

  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: p, agent }, (res) => {
      res.resume();
      res.on('end', () => setImmediate(() => {
        // socket now goes back to the free pool; keepSocketAlive runs.
        const name = Object.keys(agent.freeSockets)[0];
        const free = agent.freeSockets[name]?.[0];
        log('  freed socket.timeout =', free?.timeout, '(agent re-applied 350)');
        free?.on('timeout', () => {
          log('  idle free socket "timeout" fired -> would be reaped');
          okServer.close();
          resolve();
        });
      }));
    });
    req.on('error', () => { okServer.close(); resolve(); });
    req.end();
  });
}

await test1();
await test2();
await test3();
slowServer.close();
log('\nDone.');