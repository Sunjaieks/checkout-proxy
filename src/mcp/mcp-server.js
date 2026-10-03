/**
 * Stateless MCP server over the Streamable HTTP transport, implemented directly
 * on Node's `http` module (no external SDK). It speaks JSON-RPC 2.0 and exposes
 * the proxy-control tools provided by a `proxy-mcp-controller`.
 *
 * Transport behaviour (MCP "Streamable HTTP", stateless JSON mode):
 *   - Single MCP endpoint path (default `/mcp`) that accepts HTTP POST.
 *   - A JSON-RPC *request* (has `id`) is answered with `Content-Type: application/json`
 *     carrying a single JSON-RPC response object.
 *   - A JSON-RPC *notification* / *response* (no `id`) is answered with `202 Accepted`
 *     and an empty body, per the specification.
 *   - GET / DELETE on the endpoint return `405` (no server-initiated SSE stream and
 *     no sessions to terminate in stateless mode).
 *
 * Security (per the MCP transport spec for local servers):
 *   - The `Origin` header is validated to prevent DNS-rebinding attacks; requests
 *     carrying a non-loopback `Origin` are rejected with `403`. Native (non-browser)
 *     MCP clients send no `Origin` and are allowed.
 *   - The caller is expected to bind this server to loopback (127.0.0.1) only.
 *   - NOTE: there is no authentication on this endpoint; any local process that can
 *     reach the port can control the proxy. This is acceptable only because it binds
 *     to loopback. Do not bind to 0.0.0.0.
 *
 * The server is intentionally decoupled from Electron/main so it can be tested
 * with plain HTTP requests.
 */

import http from 'node:http';
import { MCP_DEFAULT_HOST, MCP_DEFAULT_PORT, MCP_ENDPOINT_PATH, MCP_SERVER_NAME } from '../constant/constant';

export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
export const LATEST_PROTOCOL_VERSION = '2025-06-18';

const JSONRPC_VERSION = '2.0';
const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MB safety cap on request bodies.

// JSON-RPC 2.0 standard error codes.
export const RPC_ERROR = Object.freeze({
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603
});

const makeResult = (id, result) => ({ jsonrpc: JSONRPC_VERSION, id: id === undefined ? null : id, result });
const makeError = (id, code, message, data) => ({
    jsonrpc: JSONRPC_VERSION,
    id: id === undefined ? null : id,
    error: { code, message, ...(data !== undefined ? { data } : {}) }
});

/**
 * Allow a request only when it carries no `Origin` (native client) or a loopback
 * `Origin`. Everything else (e.g. a website attempting DNS rebinding) is rejected.
 */
export const isOriginAllowed = (origin) => {
    if (!origin) return true;
    try {
        const { hostname } = new URL(origin);
        return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
    } catch (e) {
        return false;
    }
};

/**
 * Create an MCP server bound to a proxy controller.
 *
 * @param {object} opts
 * @param {object} opts.controller        proxy-mcp-controller instance ({ tools, callTool })
 * @param {string} [opts.host]            bind host (defaults to loopback)
 * @param {number} [opts.port]            bind port (0 picks an ephemeral port)
 * @param {string} [opts.endpointPath]    MCP endpoint path (defaults to /mcp)
 * @param {object} [opts.serverInfo]      { name, version, instructions }
 * @param {object} [opts.logger]          { info, error }
 */
export const createMcpServer = ({
    controller,
    host = MCP_DEFAULT_HOST,
    port = MCP_DEFAULT_PORT,
    endpointPath = MCP_ENDPOINT_PATH,
    serverInfo = {},
    logger = {}
} = {}) => {
    if (!controller || typeof controller.callTool !== 'function' || !Array.isArray(controller.tools)) {
        throw new Error('createMcpServer requires a controller with { tools, callTool }.');
    }
    const info = {
        name: serverInfo.name || MCP_SERVER_NAME,
        version: serverInfo.version || '1.0.0',
        instructions:
            serverInfo.instructions ||
            'Control the Checkout-Proxy app: start a profile (optionally with toBeDecided values), ' +
                'stop the proxy, switch to Direct Connect, list available profiles, and inspect the effective ' +
                'profile of the running proxy. You can also read the entire configuration JSON ' +
                '(get_configuration) and fetch the full user guide (get_usage_guide) that explains how to ' +
                'configure and use every feature — read the guide before proposing or making configuration changes. ' +
                'Use manage_profile to write configuration in one atomic save: "action" (add/edit/remove) changes ' +
                'ONE proxy profile, the optional "globalSettingsJson" replaces the shared globalSettings sections ' +
                'others/substitute/profileSet, and you may send either or both in the same call — sending both is ' +
                'the right shape for "define a shared rule set and make this profile use it". Choose by scope: a ' +
                'change affecting only one profile goes in the profile; something shared by several profiles (a ' +
                'named rule set in profileSet, a substitute value, an app-wide toggle in others) goes in ' +
                'globalSettings. manage_profile can never change globalSettings.ai (the MCP server and AI Desktop ' +
                'settings), reusableHackFunctions, appPort or configVersion; the user must edit those in the app. ' +
                'Each globalSettings section you send replaces the stored one in full, so include its existing ' +
                'content alongside your change. Before every manage_profile call you ' +
                'must call get_usage_guide and get_configuration; you must also call list_hack_functions whenever ' +
                'hacks are involved — the profile you are changing already has hackRequest/hackResponse, or the one ' +
                'you are writing will. Never rely on remembered field meanings or function signatures. A hack ' +
                'function reported with "doNotUse": true has no usage comment and must not be used or suggested. ' +
                'hackRequest and hackResponse are the last resort: satisfy the requirement with any other field of ' +
                'the profile first, and use them only when no other field can express what the user asked for. ' +
                "manage_profile writes to the user's configuration file and cannot be undone, so never call it " +
                'unprompted: you MUST first show the user exactly what will change — a diff of the old and new ' +
                'profile JSON when editing, the full new profile JSON when adding, the profile being deleted when ' +
                'removing, a diff of each section when changing globalSettings, both halves when the call does both ' +
                '— and wait for their explicit approval. A globalSettings change can alter the routing of every ' +
                'profile that references the changed section, so name the affected profiles when you ask.'
    };
    const log = (...a) => typeof logger.info === 'function' && logger.info(...a);
    const logErr = (...a) => typeof logger.error === 'function' && logger.error(...a);

    let server = null;
    let running = false;
    let actualPort = port;

    const buildInitializeResult = (params) => {
        const requested = params && params.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
        return {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: info.name, version: info.version },
            instructions: info.instructions
        };
    };

    /**
     * Handle one JSON-RPC message. Returns a JSON-RPC response object for
     * *requests*, or `null` for *notifications* / *responses* (nothing to send).
     */
    const handleRpcMessage = async (msg) => {
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
            return makeError(null, RPC_ERROR.INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC object.');
        }
        const hasId = 'id' in msg && msg.id !== undefined;
        const id = hasId ? msg.id : null;
        const { method } = msg;

        // A *response* object from the client (no method) — nothing to do.
        if (method == null) {
            return null;
        }
        if (msg.jsonrpc !== JSONRPC_VERSION) {
            if (!hasId) return null;
            return makeError(id, RPC_ERROR.INVALID_REQUEST, 'Invalid Request: "jsonrpc" must be "2.0".');
        }
        // *Notification* (request without id): process known ones, never reply.
        if (!hasId) {
            // e.g. notifications/initialized, notifications/cancelled — no-op (stateless).
            return null;
        }

        const params = msg.params;
        switch (method) {
            case 'initialize':
                return makeResult(id, buildInitializeResult(params));
            case 'ping':
                return makeResult(id, {});
            case 'tools/list':
                return makeResult(id, { tools: controller.tools });
            case 'tools/call': {
                const name = params && params.name;
                if (typeof name !== 'string' || !name) {
                    return makeError(id, RPC_ERROR.INVALID_PARAMS, 'Invalid params: tool "name" is required.');
                }
                const args = (params && params.arguments) || {};
                const toolResult = await controller.callTool(name, args);
                return makeResult(id, toolResult);
            }
            default:
                return makeError(id, RPC_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);
        }
    };

    const sendJson = (res, status, payload) => {
        if (res.headersSent) return;
        const body = JSON.stringify(payload);
        res.writeHead(status, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        });
        res.end(body);
    };

    const sendAccepted = (res) => {
        if (res.headersSent) return;
        res.writeHead(202);
        res.end();
    };

    const handlePost = (req, res) => {
        let size = 0;
        const chunks = [];
        let aborted = false;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                aborted = true;
                sendJson(res, 413, makeError(null, RPC_ERROR.INVALID_REQUEST, 'Payload too large.'));
                req.destroy();
            } else {
                chunks.push(chunk);
            }
        });
        req.on('error', (e) => logErr('MCP request stream error:', e && e.message));
        req.on('end', async () => {
            if (aborted) return;
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) {
                return sendJson(res, 400, makeError(null, RPC_ERROR.PARSE_ERROR, 'Parse error: empty request body.'));
            }
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                return sendJson(
                    res,
                    400,
                    makeError(null, RPC_ERROR.PARSE_ERROR, 'Parse error: body is not valid JSON.')
                );
            }
            try {
                if (Array.isArray(parsed)) {
                    if (parsed.length === 0) {
                        return sendJson(
                            res,
                            400,
                            makeError(null, RPC_ERROR.INVALID_REQUEST, 'Invalid Request: empty batch.')
                        );
                    }
                    const responses = [];
                    for (const m of parsed) {
                        // eslint-disable-next-line no-await-in-loop
                        const r = await handleRpcMessage(m);
                        if (r) responses.push(r);
                    }
                    if (responses.length === 0) return sendAccepted(res);
                    return sendJson(res, 200, responses);
                }
                const response = await handleRpcMessage(parsed);
                if (response === null) return sendAccepted(res);
                return sendJson(res, 200, response);
            } catch (e) {
                logErr('MCP request handling error:', e && e.message);
                const id =
                    parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.id != null
                        ? parsed.id
                        : null;
                return sendJson(res, 200, makeError(id, RPC_ERROR.INTERNAL_ERROR, 'Internal error.'));
            }
        });
    };

    const onRequest = (req, res) => {
        let pathname = '/';
        try {
            pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
        } catch (e) {
            pathname = req.url || '/';
        }

        // DNS-rebinding protection.
        if (!isOriginAllowed(req.headers.origin)) {
            return sendJson(res, 403, makeError(null, RPC_ERROR.INVALID_REQUEST, 'Forbidden: origin not allowed.'));
        }

        const onEndpoint = pathname === endpointPath || pathname === `${endpointPath}/`;
        if (!onEndpoint) {
            return sendJson(
                res,
                404,
                makeError(null, RPC_ERROR.INVALID_REQUEST, `Not found. MCP endpoint is ${endpointPath}.`)
            );
        }

        // Validate the MCP protocol version header only when present.
        const pvHeader = req.headers['mcp-protocol-version'];
        const pv = Array.isArray(pvHeader) ? pvHeader[0] : pvHeader;
        if (pv && !SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) {
            return sendJson(
                res,
                400,
                makeError(null, RPC_ERROR.INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${pv}.`)
            );
        }

        if (req.method === 'POST') {
            return handlePost(req, res);
        }
        // Stateless: no SSE stream (GET) and no session termination (DELETE).
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify(
                makeError(null, RPC_ERROR.INVALID_REQUEST, 'Method Not Allowed. Use HTTP POST for JSON-RPC.')
            )
        );
    };

    const start = () =>
        new Promise((resolve, reject) => {
            if (running && server) {
                return resolve({ host, port: actualPort, endpointPath });
            }
            const srv = http.createServer(onRequest);
            const onStartupError = (err) => {
                running = false;
                server = null;
                logErr(`MCP server failed to start on ${host}:${port}:`, err && err.message);
                reject(err);
            };
            srv.once('error', onStartupError);
            srv.listen(port, host, () => {
                srv.removeListener('error', onStartupError);
                srv.on('error', (err) => logErr('MCP server runtime error:', err && err.message));
                server = srv;
                running = true;
                const addr = srv.address();
                actualPort = addr && typeof addr === 'object' ? addr.port : port;
                log(`MCP server listening on http://${host}:${actualPort}${endpointPath}`);
                resolve({ host, port: actualPort, endpointPath });
            });
        });

    const stop = () =>
        new Promise((resolve) => {
            const srv = server;
            server = null;
            running = false;
            if (!srv) return resolve();
            srv.close(() => resolve());
            // `close()` stops new connections and waits for the open ones to finish. Node
            // drops idle keep-alive sockets by itself, but not an *active* request — so a
            // stop triggered from inside a request handler would wait for a response that
            // is itself waiting for the stop, and never resolve. The transport is stateless,
            // so dropping sockets costs nothing and turns that hang into a fast failure.
            if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
            if (typeof srv.unref === 'function') srv.unref();
        });

    return {
        start,
        stop,
        isRunning: () => running,
        getPort: () => actualPort,
        getEndpointPath: () => endpointPath,
        getServerInfo: () => ({ ...info }),
        // Exposed for unit testing the protocol layer without HTTP.
        handleRpcMessage
    };
};
