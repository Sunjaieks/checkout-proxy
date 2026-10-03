// Verify whether agent.destroy() interrupts a request that is still in progress (in-use socket)
// run: node test/agent-destroy-inflight.test.mjs
import http from 'node:http';

// server: trickle data out slowly to simulate a long-lived connection / large file
const srv = http.createServer((req, res) => {
  res.writeHead(200);
  res.write('chunk-1');
  // send another chunk after 2 seconds; we will destroy the agent in the meantime
  setTimeout(() => { try { res.write('chunk-2'); res.end(); } catch {} }, 2000);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const agent = new http.Agent({ keepAlive: true });

await new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, agent }, (res) => {
    let got = '';
    res.on('data', (d) => { got += d; console.log('  received data:', JSON.stringify(d.toString())); });
    res.on('end', () => { console.log('  response ended normally, total:', JSON.stringify(got)); resolve(); });
    res.on('error', (e) => { console.log('  response stream error:', e.code || e.message); });
  });
  req.on('error', (e) => { console.log('  request error:', e.code || e.message, '<-- request interrupted while in progress'); resolve(); });
  req.end();

  // while the request is in progress (after the first chunk arrives), simulate agentCache eviction -> agent.destroy()
  setTimeout(() => {
    console.log('  >>> calling agent.destroy() (simulating agentCache 120s expiry eviction)');
    console.log('      in-use sockets =', Object.values(agent.sockets).flat().length,
                '| free sockets =', Object.values(agent.freeSockets).flat().length);
    agent.destroy();
  }, 1000);
});

srv.close();
console.log('\nDone.');