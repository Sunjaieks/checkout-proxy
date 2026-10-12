/**
 * HTTP + JSON-RPC protocol tests for the stateless Streamable HTTP MCP server.
 * A real http server is started on an ephemeral port and driven with raw JSON-RPC
 * POST requests, wired to a real proxy MCP controller backed by mock handlers.
 */

const http = require('node:http');
const { createMcpServer, isOriginAllowed, LATEST_PROTOCOL_VERSION, RPC_ERROR } = require('../mcp-server.js');
const { createProxyMcpController } = require('../proxy-mcp-controller.js');

// Minimal JSON HTTP client over the loopback interface.
function request({ port, method = 'POST', path = '/mcp', headers = {}, body }) {
    return new Promise((resolve, reject) => {
        const data = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
        const finalHeaders = {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            ...headers
        };
        if (data != null) finalHeaders['Content-Length'] = Buffer.byteLength(data);
        const req = http.request({ host: '127.0.0.1', port, method, path, headers: finalHeaders }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try {
                    json = text ? JSON.parse(text) : null;
                } catch (e) {
                    json = null;
                }
                resolve({ status: res.statusCode, headers: res.headers, text, json });
            });
        });
        req.on('error', reject);
        if (data != null) req.write(data);
        req.end();
    });
}

describe('MCP server (Streamable HTTP, stateless JSON mode)', () => {
    let server;
    let port;
    let calls;

    beforeEach(async () => {
        calls = { start: [], stop: 0 };
        let state = { activeProfileIndex: -9, profileName: null, decided: {}, isRunning: false };
        const profiles = [{ name: 'alpha' }, { name: 'beta', toBeDecided: ['proxyPort=5801,5802'] }];
        const controller = createProxyMcpController({
            getProfiles: () => profiles,
            getState: () => state,
            getEffectiveProfile: () => null,
            getConfiguration: () => ({ configVersion: 1, profile: profiles }),
            getUsageGuide: () => '# Checkout-Proxy User Guide\n\nGuide.',
            start: async (index, toBeDecided) => {
                calls.start.push({ index, toBeDecided });
                state = {
                    activeProfileIndex: index,
                    profileName: index >= 0 ? profiles[index]?.name ?? null : null,
                    decided: toBeDecided,
                    isRunning: true
                };
                return { success: true };
            },
            stop: async () => {
                calls.stop += 1;
                state = { activeProfileIndex: -9, profileName: null, decided: {}, isRunning: false };
                return { success: true };
            }
        });
        server = createMcpServer({
            controller,
            host: '127.0.0.1',
            port: 0,
            serverInfo: { name: 'test-mcp', version: '9.9.9' }
        });
        const info = await server.start();
        port = info.port;
        expect(server.isRunning()).toBe(true);
        expect(port).toBeGreaterThan(0);
    });

    afterEach(async () => {
        await server.stop();
    });

    describe('lifecycle / initialize', () => {
        test('initialize returns protocolVersion, tools capability and serverInfo', async () => {
            const res = await request({
                port,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } }
                }
            });
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/application\/json/);
            expect(res.json.jsonrpc).toBe('2.0');
            expect(res.json.id).toBe(1);
            expect(res.json.result.protocolVersion).toBe('2025-06-18');
            expect(res.json.result.capabilities.tools).toBeTruthy();
            expect(res.json.result.serverInfo).toEqual({ name: 'test-mcp', version: '9.9.9' });
        });

        test('initialize negotiates an unsupported requested version down to the latest', async () => {
            const res = await request({
                port,
                body: { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }
            });
            expect(res.json.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
        });

        test('ping returns an empty result object', async () => {
            const res = await request({ port, body: { jsonrpc: '2.0', id: 3, method: 'ping' } });
            expect(res.status).toBe(200);
            expect(res.json.result).toEqual({});
        });

        test('a notification (no id) is answered with 202 and an empty body', async () => {
            const res = await request({ port, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
            expect(res.status).toBe(202);
            expect(res.text).toBe('');
        });
    });

    describe('tools', () => {
        test('tools/list returns all proxy tools', async () => {
            const res = await request({ port, body: { jsonrpc: '2.0', id: 4, method: 'tools/list' } });
            const names = res.json.result.tools.map((t) => t.name).sort();
            expect(names).toEqual([
                'direct_connect',
                'get_configuration',
                'get_effective_profile',
                'get_usage_guide',
                'list_hack_functions',
                'list_profiles',
                'manage_profile',
                'start_profile',
                'stop_proxy'
            ]);
        });

        test('tools/call start_profile drives the controller and handlers end-to-end', async () => {
            const res = await request({
                port,
                body: {
                    jsonrpc: '2.0',
                    id: 5,
                    method: 'tools/call',
                    params: { name: 'start_profile', arguments: { profile: 'beta' } }
                }
            });
            expect(res.status).toBe(200);
            expect(res.json.result.isError).toBeFalsy();
            expect(calls.start).toEqual([{ index: 1, toBeDecided: { proxyPort: '5801' } }]);
            const payload = JSON.parse(res.json.result.content[0].text);
            expect(payload.ok).toBe(true);
            expect(payload.status.activeProfileIndex).toBe(1);
        });

        test('tools/call direct_connect and stop_proxy reach the handlers', async () => {
            await request({
                port,
                body: { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'direct_connect' } }
            });
            expect(calls.start.pop()).toEqual({ index: -1, toBeDecided: {} });
            const stop = await request({
                port,
                body: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'stop_proxy' } }
            });
            expect(calls.stop).toBe(1);
            expect(JSON.parse(stop.json.result.content[0].text).status.mode).toBe('stopped');
        });

        test('tools/call get_configuration and get_usage_guide reach the handlers', async () => {
            const cfg = await request({
                port,
                body: { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'get_configuration' } }
            });
            expect(cfg.status).toBe(200);
            expect(cfg.json.result.isError).toBeFalsy();
            expect(JSON.parse(cfg.json.result.content[0].text).configuration.configVersion).toBe(1);

            const guide = await request({
                port,
                body: { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'get_usage_guide' } }
            });
            expect(guide.status).toBe(200);
            expect(guide.json.result.isError).toBeFalsy();
            expect(guide.json.result.content[0].text).toMatch(/Checkout-Proxy User Guide/);
        });

        test('tools/call without a tool name returns INVALID_PARAMS', async () => {
            const res = await request({
                port,
                body: { jsonrpc: '2.0', id: 8, method: 'tools/call', params: {} }
            });
            expect(res.status).toBe(200);
            expect(res.json.error.code).toBe(RPC_ERROR.INVALID_PARAMS);
        });
    });

    describe('protocol & transport errors', () => {
        test('an unknown method returns METHOD_NOT_FOUND', async () => {
            const res = await request({ port, body: { jsonrpc: '2.0', id: 9, method: 'no/such/method' } });
            expect(res.json.error.code).toBe(RPC_ERROR.METHOD_NOT_FOUND);
        });

        test('invalid JSON returns 400 with PARSE_ERROR', async () => {
            const res = await request({ port, body: '{ not valid json' });
            expect(res.status).toBe(400);
            expect(res.json.error.code).toBe(RPC_ERROR.PARSE_ERROR);
        });

        test('GET on the endpoint returns 405', async () => {
            const res = await request({ port, method: 'GET', body: null });
            expect(res.status).toBe(405);
        });

        test('DELETE on the endpoint returns 405', async () => {
            const res = await request({ port, method: 'DELETE', body: null });
            expect(res.status).toBe(405);
        });

        test('a request to an unknown path returns 404', async () => {
            const res = await request({ port, path: '/nope', body: { jsonrpc: '2.0', id: 10, method: 'ping' } });
            expect(res.status).toBe(404);
        });

        test('an unsupported MCP-Protocol-Version header returns 400', async () => {
            const res = await request({
                port,
                headers: { 'MCP-Protocol-Version': '1999-01-01' },
                body: { jsonrpc: '2.0', id: 11, method: 'ping' }
            });
            expect(res.status).toBe(400);
        });

        test('a supported MCP-Protocol-Version header is accepted', async () => {
            const res = await request({
                port,
                headers: { 'MCP-Protocol-Version': '2025-03-26' },
                body: { jsonrpc: '2.0', id: 12, method: 'ping' }
            });
            expect(res.status).toBe(200);
            expect(res.json.result).toEqual({});
        });
    });

    describe('origin / DNS-rebinding protection', () => {
        test('rejects a non-loopback Origin with 403', async () => {
            const res = await request({
                port,
                headers: { Origin: 'http://evil.example.com' },
                body: { jsonrpc: '2.0', id: 13, method: 'ping' }
            });
            expect(res.status).toBe(403);
        });

        test('allows a loopback Origin', async () => {
            const res = await request({
                port,
                headers: { Origin: 'http://127.0.0.1:12345' },
                body: { jsonrpc: '2.0', id: 14, method: 'ping' }
            });
            expect(res.status).toBe(200);
            expect(res.json.result).toEqual({});
        });
    });
});

describe('stop() while a request is in flight', () => {
    // This is the shape of the manage_profile bug: a tool call triggers a configuration
    // save, and the save used to rebind the MCP server. `close()` waits for the open
    // connection to finish, but that connection is the very request waiting for the save —
    // so nothing ever completed and the client only saw "operation timed out".
    //
    // main.js now avoids the restart entirely (see isMcpServerSettingsChanged), and the
    // server drops active sockets on stop so a restart can never wedge like this again:
    // the caller gets a fast connection error rather than an infinite hang.
    test('does not hang forever when a tool handler stops the server', async () => {
        let instance = null;
        const controller = {
            tools: [{ name: 'self_stop', description: 'stops the server', inputSchema: { type: 'object' } }],
            callTool: async () => {
                await instance.stop(); // must not deadlock against the request being served
                return { content: [{ type: 'text', text: 'stopped' }] };
            }
        };
        instance = createMcpServer({ controller, host: '127.0.0.1', port: 0 });
        const { port } = await instance.start();

        let hangTimer;
        const outcome = await Promise.race([
            request({ port, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'self_stop' } } })
                .then(() => 'settled')
                .catch(() => 'settled'),
            new Promise((r) => {
                hangTimer = setTimeout(() => r('hung'), 3000);
            })
        ]);
        clearTimeout(hangTimer);
        await instance.stop();
        expect(outcome).toBe('settled');
    }, 10000);
});

describe('isOriginAllowed', () => {
    test('allows missing/empty and loopback origins, rejects everything else', () => {
        expect(isOriginAllowed(undefined)).toBe(true);
        expect(isOriginAllowed('')).toBe(true);
        expect(isOriginAllowed('http://localhost:3000')).toBe(true);
        expect(isOriginAllowed('http://127.0.0.1:9')).toBe(true);
        expect(isOriginAllowed('http://[::1]:9')).toBe(true);
        expect(isOriginAllowed('https://evil.com')).toBe(false);
        expect(isOriginAllowed('null')).toBe(false);
    });
});
