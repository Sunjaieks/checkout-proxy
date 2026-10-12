/**
 * Test: Can we emit('connection') on a net.createServer() without listen(),
 * and get a usable socket for h2Server?
 */
import http2 from 'node:http2';
import net from 'node:net';

const TIMEOUT = 3000;

// Test 1: new net.Socket() (no handle)
async function test1() {
    console.log('\n=== Test 1: emit("connection", new net.Socket()) ===');
    const h2Server = http2.createServer();
    h2Server.on('request', (req, res) => {
        console.log(`  [h2] request: ${req.url}`);
        res.end('ok');
    });
    h2Server.on('session', () => console.log('  [h2] session created'));

    const sock = new net.Socket();
    console.log(`  sock._handle = ${sock._handle}`); // null?

    try {
        h2Server.emit('connection', sock);
        console.log('  emit succeeded, waiting for events...');
    } catch (e) {
        console.log(`  emit threw: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 1000));
    h2Server.close();
    sock.destroy();
}

// Test 2: Two new net.Socket() piped together
async function test2() {
    console.log('\n=== Test 2: Two new net.Socket() piped together ===');
    const h2Server = http2.createServer();
    h2Server.on('request', (req, res) => {
        console.log(`  [h2] request: ${req.url}`);
        res.end('ok');
    });
    h2Server.on('session', () => console.log('  [h2] session created'));
    h2Server.on('error', (e) => console.log(`  [h2] error: ${e.message}`));

    const clientEnd = new net.Socket();
    const serverEnd = new net.Socket();

    console.log(`  clientEnd._handle = ${clientEnd._handle}`);
    console.log(`  serverEnd._handle = ${serverEnd._handle}`);

    // Pipe them manually
    clientEnd.on('data', (c) => serverEnd.push(c));
    serverEnd.on('data', (c) => clientEnd.push(c));

    try {
        h2Server.emit('connection', serverEnd);
        console.log('  emit succeeded');
    } catch (e) {
        console.log(`  emit threw: ${e.message}`);
    }

    // Try writing H2 preface
    try {
        clientEnd.write(Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'));
        console.log('  wrote H2 preface');
    } catch (e) {
        console.log(`  write threw: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 1000));
    h2Server.close();
    clientEnd.destroy();
    serverEnd.destroy();
}

// Test 3: Use http2.connect with createConnection returning new net.Socket()
async function test3() {
    console.log('\n=== Test 3: http2.connect + createConnection: new net.Socket() ===');
    const h2Server = http2.createServer();
    h2Server.on('request', (req, res) => {
        console.log(`  [h2] request: ${req.url}`);
        res.end('ok');
    });
    h2Server.on('session', () => console.log('  [h2] session created'));

    const serverEnd = new net.Socket();
    console.log(`  serverEnd._handle = ${serverEnd._handle}`);

    h2Server.emit('connection', serverEnd);

    // http2.connect using a createConnection that returns the other end
    try {
        const session = http2.connect('http://localhost', {
            createConnection: () => {
                // This needs a connected socket... but we only have serverEnd
                const clientEnd = new net.Socket();
                // Wire them
                clientEnd.on('data', (c) => { try { serverEnd.push(c); } catch {} });
                serverEnd.on('data', (c) => { try { clientEnd.push(c); } catch {} });
                return clientEnd;
            }
        });
        session.on('error', (e) => console.log(`  [client] error: ${e.message}`));
        const req = session.request({ ':path': '/' });
        req.on('response', (h) => console.log(`  [client] response status: ${h[':status']}`));
        req.on('error', (e) => console.log(`  [client] req error: ${e.message}`));
        req.end();
    } catch (e) {
        console.log(`  http2.connect threw: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
    h2Server.close();
}

(async () => {
    await test1();
    await test2();
    await test3();
    console.log('\nDone.');
    process.exit(0);
})();