/**
 * generate rootCA.key : openssl genrsa -out rootCA.key 4096
 * generate rootCA.crt : openssl req -x509 -new -nodes -key rootCA.key -sha256 -days 27199 -out rootCA.crt -config root_ca.cnf
 * generate inherited key and cert: openssl req -nodes -x509 -new -out fallbackCA.crt -keyout fallbackCA.key -config fallback_ca.cnf -days 27199 -sha256 -CA rootCA.crt -CAkey rootCA.key -newkey rsa:4096
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { URL } from 'node:url';
import { pipeline } from 'node:stream';
import {
    gethttpFixedRule,
    gethttpsFixedRule,
    getUrlFactor,
    getWildcardRule,
    inHostBypassProxy,
    inHostUsingProxy,
    isHttp,
    isRelativePath,
    findHeaderWithIgnoreCase,
    once,
    stripHopByHopHeaders,
    removeHeaderWithIgnoreCase
} from '../util/sharedUtil.js';
import { formatUrl, logError, logInfo, safeWrite, safeDestroy, CERT_COMMON_NAME } from '../util/nodeUtil.js';
import fs from 'fs';
import { addShutdown } from './http-shutdown.js';
import forge from 'node-forge';
import tls from 'node:tls';
import { LRUCache } from './cache.js';
import {
    ASK_TO_RENEW_CA,
    ASK_TO_RENEW_CA_LONG,
    HEADER_CHECKOUT_PROXY_USE_AGENT,
    IGNORED_ERROR_CODE,
    MAX_HEADER_SIZE,
    ONE_DAY_MS,
    USE_NO_AGENT
} from '../constant/constant.js';
import { CustomHttpAgent } from './agent.js';
import { pipeResponseAndMaybeAddTrailers } from './trailer-forwarding.js';
import {
    isDisplayableContentType,
    parseCharset,
    isSupportedCharset,
    isUtf8Charset,
    isEucJpCharset,
    isLatin1Charset,
    parseMetaCharset
} from './body-decoder.js';
import iconv from 'iconv-lite';

let rootCertPath;
let rootKeyPath;
let serverErrorHandler;
let errorStateHandler;
let fallbackRootCASubjectKeyIdentifier;
let fallbackRootCA;
let fallbackRootCAKey;
let fallbackRootCAString;
let fallbackRootCAKeyString;
let rootCASubjectKeyIdentifier;
let rootCA;
let rootCAKey;
let rootCAString;
let rootCAKeyString;

const certCache = new LRUCache(10000, 1000 * 3600 * 240); // 10,000 entries, 10 day TTL
const agentCache = new LRUCache(100, 1000 * 120, (item) => safeDestroy(item, null, '[AgentCache]', true)); // 100 entries, 2min ttl

const SERVER_REQUEST_TIMEOUT_SEC = 1200; // seconds

export function clearCertCache() {
    certCache.clear();
}

export function clearAgentCache() {
    agentCache.clear();
}

export function generateRootCA() {
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = generateSerialNumber();
    const now = new Date();
    cert.validity.notBefore = new Date(now.getTime() - 30 * ONE_DAY_MS);
    cert.validity.notAfter = new Date(now.getTime() + 700 * ONE_DAY_MS);

    const attrs = [
        { name: 'commonName', value: CERT_COMMON_NAME },
        { name: 'organizationName', value: 'Checkout Proxy, Inc.' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    const keyIdentifier = cert.generateSubjectKeyIdentifier().getBytes();
    cert.setExtensions([
        { name: 'basicConstraints', cA: true, critical: true },
        {
            name: 'keyUsage',
            digitalSignature: true,
            keyCertSign: true,
            cRLSign: true,
            critical: true
        },
        {
            name: 'extKeyUsage',
            serverAuth: true,
            clientAuth: true
        },
        { name: 'subjectKeyIdentifier' },
        { name: 'authorityKeyIdentifier', keyIdentifier }
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return { key: keys.privateKey, cert: cert, keyIdentifier };
}

export async function writeRootCA(key, cert) {
    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(key);
    try {
        fs.writeFileSync(rootCertPath, certPem.replaceAll('\r\n', '\n'));
        fs.writeFileSync(rootKeyPath, keyPem.replaceAll('\r\n', '\n'));
    } catch (error) {
        logError('write certificate error:', error);
        throw new Error(
            `Failed to save Root CA: ${error.message || 'Unknown error occurred.'} ${ASK_TO_RENEW_CA} Current CA will be used continuously.`
        );
    }
}

export function loadRootCA(key, cert, keyIdentifier) {
    if (key && cert) {
        rootCA = cert;
        rootCAKey = key;
        rootCAString = forge.pki.certificateToPem(cert);
        rootCAKeyString = forge.pki.privateKeyToPem(key);
        rootCASubjectKeyIdentifier = keyIdentifier;
        return;
    }
    try {
        rootCAString = fs.readFileSync(rootCertPath, 'utf8');
        rootCAKeyString = fs.readFileSync(rootKeyPath, 'utf8');
        rootCA = forge.pki.certificateFromPem(rootCAString);
        rootCAKey = forge.pki.privateKeyFromPem(rootCAKeyString);
        rootCASubjectKeyIdentifier = rootCA.generateSubjectKeyIdentifier().getBytes();
        logInfo('Root CA loaded successfully.');
    } catch (e) {
        logError('Failed to load Root CA:', e);
        const { key, cert, keyIdentifier } = generateRootCA();
        fallbackRootCA = cert;
        fallbackRootCAKey = key;
        fallbackRootCAString = forge.pki.certificateToPem(fallbackRootCA);
        fallbackRootCAKeyString = forge.pki.privateKeyToPem(fallbackRootCAKey);
        fallbackRootCASubjectKeyIdentifier = keyIdentifier;
        throw new Error(
            `Failed to load Root CA: ${e.message || 'Unknown error occurred'}. A fallback CA will be used tentatively. ${ASK_TO_RENEW_CA_LONG}`
        );
    }
    return rootCA;
}

export const setPaths = (rootCertPathFromMain, rootKeyPathFromMain) => {
    rootCertPath = rootCertPathFromMain;
    rootKeyPath = rootKeyPathFromMain;
};

export function getRootCAString() {
    return (rootCAString || fallbackRootCAString || '').replaceAll('\r\n', '\n');
}

export const setConsoleLogCallback = (callback) => {
    consoleLogCallback = callback;
};

export const setBodyStorageCallback = (callback) => {
    bodyStorageCallback = callback;
};

export function generateSerialNumber() {
    // RFC 5280: positive integer, ≤20 bytes, minimal-length DER encoding (no redundant leading 0x00).
    const buf = crypto.randomBytes(16);
    buf[0] &= 0x7f; // clear MSB so the integer is positive
    buf[0] |= 0x01; // ensure first byte is non-zero so DER encoding stays minimal-length
    return buf.toString('hex');
}

const getGenerateServerCertificate = () => {
    const localCA = rootCA || fallbackRootCA;
    const localCAKey = rootCAKey || fallbackRootCAKey;
    const localCASubjectKeyIdentifier = rootCASubjectKeyIdentifier || fallbackRootCASubjectKeyIdentifier;
    return {
        localCA,
        localCAKey,
        generateServerCertificate: (hostname) => {
            const cached = certCache.get(hostname);
            if (cached) return cached;
            const keys = forge.pki.rsa.generateKeyPair(2048);
            const cert = forge.pki.createCertificate();
            cert.publicKey = keys.publicKey;
            cert.serialNumber = generateSerialNumber();
            const now = new Date();
            cert.validity.notBefore = new Date(now.getTime() - 20 * ONE_DAY_MS);
            cert.validity.notAfter = new Date(now.getTime() + 20 * ONE_DAY_MS);

            const attrs = [
                { name: 'commonName', value: hostname },
                { name: 'organizationName', value: `${hostname}, Inc.` }
            ];
            cert.setSubject(attrs);
            cert.setIssuer(localCA.subject.attributes);
            cert.setExtensions([
                { name: 'basicConstraints', cA: false },
                {
                    name: 'keyUsage',
                    digitalSignature: true,
                    keyEncipherment: true,
                    critical: true
                },
                {
                    name: 'extKeyUsage',
                    serverAuth: true,
                    clientAuth: true
                },
                {
                    name: 'subjectAltName',
                    altNames: net.isIP(hostname) ? [{ type: 7, ip: hostname }] : [{ type: 2, value: hostname }]
                },
                { name: 'subjectKeyIdentifier' },
                { name: 'authorityKeyIdentifier', keyIdentifier: localCASubjectKeyIdentifier }
            ]);

            cert.sign(localCAKey, forge.md.sha256.create());

            const tlsCert = {
                key: forge.pki.privateKeyToPem(keys.privateKey),
                cert: forge.pki.certificateToPem(cert)
            };

            certCache.set(hostname, tlsCert);
            logInfo(`Generated certificate for ${hostname}`);
            return tlsCert;
        }
    };
};

const getSNICallback = (generateServerCertificate) => {
    return (servername, cb) => {
        try {
            const { key, cert } = generateServerCertificate(servername || 'unknown.fallback.local');
            return cb(null, tls.createSecureContext({ key, cert }));
        } catch (err) {
            logError(`Error in SNICallback for ${servername}:`, err);
            // cb(err); // This might crash the server, better to log and potentially use a default context or fail gracefully
            // To avoid crashing, don't call cb(err) directly if generateServerCertificate can throw.
            errorStateHandler?.(`Cannot generate certificate for ${servername}: ${err?.code}-${err?.message}.`, true);
            return cb(null, tls.createSecureContext({}));
        }
    };
};

const processBypassCorsAndUserHackForOption = (requestOrigin, requestOptions, hackResponseFunctions) => {
    const preflightHeaders = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
        'Access-Control-Allow-Headers':
            requestOptions.headers['access-control-request-headers'] ||
            'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma, Expires, X-CSRF-Token, Range, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since',
        'Access-Control-Max-Age': '3600' // 1 hour
    };
    if (requestOrigin) {
        preflightHeaders['Access-Control-Allow-Origin'] = requestOrigin;
        preflightHeaders['Access-Control-Allow-Credentials'] = 'true';
    } else {
        preflightHeaders['Access-Control-Allow-Origin'] = '*';
    }
    const originalResponse = { code: 204, headers: preflightHeaders };
    const hackedResponse = (hackResponseFunctions || []).reduce((acc, f) => f(requestOptions, acc), originalResponse);
    return { code: hackedResponse?.code, headers: hackedResponse?.headers };
};

const setHeaderNameIgnoreCase = (responseHeaders, headerKey, newValue) => {
    if (!headerKey) return;
    const actuallyKey = Object.keys(responseHeaders).find((key) => key.toLowerCase() === headerKey.toLowerCase());
    responseHeaders[actuallyKey ? actuallyKey : headerKey] = newValue;
};

const processBypassCors = (requestOrigin, responseHeaders) => {
    if (requestOrigin) {
        setHeaderNameIgnoreCase(responseHeaders, 'Access-Control-Allow-Origin', requestOrigin);
        setHeaderNameIgnoreCase(responseHeaders, 'Access-Control-Allow-Credentials', 'true');
        // When ACAO is dynamic, Vary: Origin is important for caching.
        // It tells caches that the response varies based on the Origin header.
        // Concatenate if Vary already exists.
        const varyKey = findHeaderWithIgnoreCase(responseHeaders, 'Vary');
        responseHeaders[varyKey ?? 'Vary'] = responseHeaders[varyKey]
            ? `${responseHeaders[varyKey]}, Origin`
            : 'Origin';
    } else {
        setHeaderNameIgnoreCase(responseHeaders, 'Access-Control-Allow-Origin', '*');
        // If ACAO is '*', credentials cannot be allowed.
        removeHeaderWithIgnoreCase(responseHeaders, 'Access-Control-Allow-Credentials');
    }
    removeHeaderWithIgnoreCase(responseHeaders, 'content-security-policy');
    removeHeaderWithIgnoreCase(responseHeaders, 'x-frame-options');
};

const getCustomHttpAgent = (protocol, proxyUrl) => {
    const agentUrlFactor = getUrlFactor(proxyUrl);
    if (!agentUrlFactor) return undefined;
    return (
        agentCache.get(`${protocol}|${proxyUrl}`) ??
        agentCache.set(
            `${protocol}|${proxyUrl}`,
            new CustomHttpAgent(`${protocol}:`, agentUrlFactor, {
                keepAlive: true,
                keepAliveMsecs: 8000
            })
        )
    );
};

// Request logging helper - logs MITM'd requests to console window
let consoleLogCallback = null;
let bodyStorageCallback = null;
const MAX_FIELD_LENGTH = 10240; // 10k characters max per field
const BODY_COLLECT_TIMEOUT_MS = 30_000; // 30 seconds max to collect body
const FIELD_TRUNCATION_SUFFIX = '... [[Checkout-Proxy]Field Truncated: over 10kb]';
const COLLECT_TIMEOUT_PREFIX = '[Checkout-Proxy]Body collection timed out after 30s, showing partial data:\n\n';

const MAX_STREAM_SIZE_FACTOR = 2; // 2MB max raw stream
const MAX_STREAM_SIZE = MAX_STREAM_SIZE_FACTOR * 1024 * 1024;
const MAX_BODY_SIZE_FACTOR = MAX_STREAM_SIZE_FACTOR * 1.3; // 2.6MB max decoded body string
const MAX_BODY_SIZE = MAX_BODY_SIZE_FACTOR * 1024 * 1024;
const BODY_TRUNCATION_SUFFIX = `... [[Checkout-Proxy]Body Truncated: over ${MAX_BODY_SIZE_FACTOR}mb]`;
const RAW_STREAM_TOO_BIG_PREFIX = `[Checkout-Proxy]Raw stream is too big: over ${MAX_STREAM_SIZE_FACTOR}mb...\n\n`;

// Truncate a string if it exceeds MAX_FIELD_LENGTH
const truncateField = (value) => {
    if (typeof value === 'undefined' || value === null) return value;
    const str = String(value);
    if (str.length > MAX_FIELD_LENGTH) {
        return str.substring(0, MAX_FIELD_LENGTH) + FIELD_TRUNCATION_SUFFIX;
    }
    return str;
};

// Log all requests that go through the MITM proxy
const CONSOLE_LOG_MAX_ID = 99999;
let consoleLogId = 0;
const logRequestToConsole = (hackedOptions, protocol, shouldLog) => {
    if (!shouldLog || !consoleLogCallback) return null;

    try {
        const reqHeadersStr = hackedOptions.headers || null;
        const __ID__ = consoleLogId >= CONSOLE_LOG_MAX_ID ? 1 : consoleLogId + 1;
        consoleLogId = __ID__;

        const logEntry = {
            __ID__,
            timestamp: new Date().toISOString(),
            protocol: truncateField(protocol), // Will be updated with version after response
            code: null, // Will be updated after response or set to 'failed' on error
            method: truncateField(hackedOptions.method),
            host: truncateField(hackedOptions.hostname),
            port: truncateField(hackedOptions.port),
            path: truncateField(hackedOptions.path),
            proxyUrl: truncateField(hackedOptions.proxyUrl),
            reqHeaders: reqHeadersStr,
            resHeaders: null, // Will be updated after response
            resTrailer: null // Will be updated after response (if any)
        };

        consoleLogCallback(logEntry);
        return __ID__;
    } catch (e) {
        logError('[Console Log] Error in logRequestToConsole:', e);
    }
    return null;
};

const formatProtocolLabel = (baseProtocol, proxyRes) => {
    const version = proxyRes?.httpVersion;
    return version ? `${baseProtocol}/${version}` : baseProtocol;
};

const updateConsoleLogEntry = (id, updates, shouldLog) => {
    if (!shouldLog || !consoleLogCallback || !id || !updates) return;
    consoleLogCallback({
        __ID__: id,
        ...updates
    });
};

// Store body data for an entry
const storeBodyData = (id, type, body, shouldLog) => {
    if (!shouldLog || !bodyStorageCallback || !id) return;
    bodyStorageCallback(id, type, body);
};

const decodeBufferToString = (buffer, charset) => {
    const prefix = buffer.msg ? `${buffer.msg}\n\n` : '';
    if (isUtf8Charset(charset)) return `${prefix}${buffer.decomp.toString('utf-8')}`;
    if (isEucJpCharset(charset)) return `${prefix}${iconv.decode(buffer.decomp, 'euc-jp')}`;
    if (isLatin1Charset(charset)) return `${prefix}${buffer.decomp.toString('latin1')}`;
    return `${prefix}${buffer.decomp.toString('utf-8')}`;
};

const decompressBuffer = (buffer, encoding) => {
    if (encoding === 'gzip' || encoding === 'x-gzip') {
        try {
            return { decomp: zlib.gunzipSync(buffer) };
        } catch (e) {
            if (e.code === 'Z_BUF_ERROR') {
                return {
                    decomp: zlib.inflateRawSync(buffer.subarray(10), {
                        finishFlush: zlib.constants.Z_SYNC_FLUSH
                    }),
                    msg: '[Checkout-Proxy]Z_BUF_ERROR - attempted inflateRawSync on buffer.subarray(10)'
                };
            }
            throw e;
        }
    } else if (encoding === 'deflate') {
        try {
            return { decomp: zlib.inflateSync(buffer) };
        } catch {
            return {
                decomp: zlib.inflateRawSync(buffer),
                msg: '[Checkout-Proxy]Failed to inflateSync, falling back to inflateRawSync'
            };
        }
    } else if (encoding === 'br') {
        try {
            return { decomp: zlib.brotliDecompressSync(buffer) };
        } catch {
            return {
                decomp: zlib.brotliDecompressSync(buffer, {
                    finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH
                }),
                msg: '[Checkout-Proxy]Brotli decompression error - attempted partial decompression with BROTLI_OPERATION_FLUSH'
            };
        }
    }
    return { decomp: null };
};

const collectBodyFromStream = (stream, headers, logId, bodyType, shouldLog) => {
    if (!shouldLog || !logId) return;

    const contentType = headers[findHeaderWithIgnoreCase(headers, 'content-type')];
    if (contentType && !isDisplayableContentType(contentType)) {
        storeBodyData(logId, bodyType, `[Checkout-Proxy]Unsupported content-type(${contentType})...`, shouldLog);
        return;
    }
    const charset = parseCharset(contentType);
    if (charset && !isSupportedCharset(charset)) {
        storeBodyData(logId, bodyType, `[Checkout-Proxy]Unsupported charset(${charset})...`, shouldLog);
        return;
    }

    const contentEncoding = headers[findHeaderWithIgnoreCase(headers, 'content-encoding')];
    const isCompressed = contentEncoding && !['identity', 'undefined', ''].includes(contentEncoding.toLowerCase());

    const chunks = [];
    let streamTooBig = false;
    let totalSize = 0;
    let stored = false;
    let bodyCollectTimer = null;

    const cleanup = () => {
        if (bodyCollectTimer) {
            clearTimeout(bodyCollectTimer);
            bodyCollectTimer = null;
        }
        // Remove listeners to release closure references (chunks, etc.)
        stream.removeListener('data', onData);
        stream.removeListener('end', onEnd);
        stream.removeListener('close', onClose);
        stream.removeListener('error', onError);
    };

    const storeResult = (timedOut) => {
        if (stored) return;
        stored = true;
        cleanup();
        const streamTooBigPrefix = streamTooBig ? RAW_STREAM_TOO_BIG_PREFIX : '';
        const timeoutPrefix = timedOut ? COLLECT_TIMEOUT_PREFIX : '';
        try {
            const buffer = Buffer.concat(chunks);
            // Release chunk references early
            chunks.length = 0;
            let bodyStr;
            let decompressedResult;
            if (isCompressed && buffer.length > 0) {
                decompressedResult = decompressBuffer(buffer, contentEncoding.toLowerCase());
                if (!decompressedResult.decomp) {
                    storeBodyData(
                        logId,
                        bodyType,
                        `${timeoutPrefix}[Checkout-Proxy]Unsupported compression(${contentEncoding})...`,
                        shouldLog
                    );
                    return;
                }
            } else {
                decompressedResult = { decomp: buffer };
            }
            bodyStr = decodeBufferToString(decompressedResult, charset);
            // Re-decode based on HTML meta charset when Content-Type didn't specify one
            if (!charset && contentType) {
                const mimeType = contentType.split(';')[0].trim().toLowerCase();
                if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
                    const metaCharset = parseMetaCharset(bodyStr);
                    if (metaCharset && !isUtf8Charset(metaCharset) && isSupportedCharset(metaCharset)) {
                        bodyStr = decodeBufferToString(decompressedResult, metaCharset);
                    }
                }
            }
            if (bodyStr.length > MAX_BODY_SIZE) {
                bodyStr = bodyStr.substring(0, MAX_BODY_SIZE) + BODY_TRUNCATION_SUFFIX;
            }
            storeBodyData(logId, bodyType, timeoutPrefix + streamTooBigPrefix + bodyStr, shouldLog);
        } catch (e) {
            storeBodyData(
                logId,
                bodyType,
                `${timeoutPrefix}${streamTooBigPrefix}[Checkout-Proxy]Error(${e.message})...`,
                shouldLog
            );
        }
    };

    const onData = (chunk) => {
        if (totalSize > MAX_STREAM_SIZE) {
            streamTooBig = true;
            storeResult(false);
            return;
        }
        chunks.push(chunk);
        totalSize += chunk.length;
    };

    const onEnd = () => storeResult(false);
    const onClose = () => storeResult(false);
    const onError = (e) => {
        if (stored) return;
        stored = true;
        cleanup();
        storeBodyData(logId, bodyType, `[Checkout-Proxy]Stream error(${e?.message})...`, shouldLog);
    };

    stream.on('data', onData);

    // Fix: for HTTP/2 body-less GET requests (endStream:true), the stream may have
    // already ended by the time we attach listeners (race between endStream frame and
    // async work like ALPN/profile lookup). In that case readableEnded is already true
    // and the 'end' event will never fire again.
    // Also attach 'close' as a fallback because some Node.js HTTP/2 Duplex streams
    // emit 'close' without re-emitting 'end' (known quirk, see nodejs/node#40193).
    if (stream.readableEnded) {
        process.nextTick(() => storeResult(false));
    } else {
        stream.once('end', onEnd);
        stream.once('close', onClose);

        // Safety timeout: if storeResult is not called within 20 seconds,
        // force-process whatever data we have and release memory.
        bodyCollectTimer = setTimeout(() => {
            bodyCollectTimer = null;
            if (!stored) storeResult(true);
        }, BODY_COLLECT_TIMEOUT_MS);
    }

    stream.once('error', onError);
};

// Set up request body collection
const setupRequestBodyCollection = (clientReq, logId, shouldLog) => {
    collectBodyFromStream(clientReq, clientReq.headers || {}, logId, 'reqBody', shouldLog);
};

// Set up response body + trailer collection from an HTTP/1.1 proxyRes
const setupResponseCollection = (proxyRes, logId, shouldLog) => {
    if (!shouldLog || !logId) return;

    const resHeaders = proxyRes.headers || {};
    const contentType = resHeaders[findHeaderWithIgnoreCase(resHeaders, 'content-type')];

    // Check if content type is displayable
    if (contentType && !isDisplayableContentType(contentType)) {
        storeBodyData(logId, 'resBody', `[Checkout-Proxy]Unsupported content-type(${contentType})...`, shouldLog);
        proxyRes.once('end', () => {
            const trailers = proxyRes.trailers;
            if (trailers && Object.keys(trailers).length > 0) {
                updateConsoleLogEntry(logId, { resTrailer: trailers }, shouldLog);
            }
        });
        return;
    }

    const charset = parseCharset(contentType);
    if (charset && !isSupportedCharset(charset)) {
        storeBodyData(logId, 'resBody', `[Checkout-Proxy]Unsupported charset(${charset})...`, shouldLog);
        proxyRes.once('end', () => {
            const trailers = proxyRes.trailers;
            if (trailers && Object.keys(trailers).length > 0) {
                updateConsoleLogEntry(logId, { resTrailer: trailers }, shouldLog);
            }
        });
        return;
    }

    // Collect body
    collectBodyFromStream(proxyRes, resHeaders, logId, 'resBody', shouldLog);

    // Trailers (HTTP/1.1)
    proxyRes.once('end', () => {
        const trailers = proxyRes.trailers;
        if (trailers && Object.keys(trailers).length > 0) {
            updateConsoleLogEntry(logId, { resTrailer: trailers }, shouldLog);
        }
    });
};

export const getStartServers = (errorStateCallback, serverErrorCallback) => {
    const { generateServerCertificate } = getGenerateServerCertificate();
    const getSecureContext = getSNICallback(generateServerCertificate);
    errorStateHandler = errorStateCallback;
    serverErrorHandler = serverErrorCallback;
    const usingFallbackCert = !rootCAKeyString || !rootCAString;
    const localCAKeyString = usingFallbackCert ? fallbackRootCAKeyString : rootCAKeyString;
    const localCAString = usingFallbackCert ? fallbackRootCAString : rootCAString;
    return (listenOn, appPort, currentProfile) =>
        new Promise((resolve) => {
            clearAgentCache();
            const httpPort = appPort[0];
            const profile = currentProfile;
            const httpServer = addShutdown(http.createServer());
            const httpsServer = addShutdown(
                https.createServer({
                    key: localCAKeyString,
                    cert: localCAString,
                    ciphers: 'ALL:!LOW:!DSS:!EXP'
                }),
                { suppressCloseErrors: ['ERR_SERVER_NOT_RUNNING'] }
            );
            httpServer.on('connect', (cliReq, cliSoc, cliHead) => {
                const url = new URL(`http://${formatUrl(cliReq.url)}`);
                const port = url.port || '443';
                const hostname = url.hostname;
                logInfo(`[HTTP Proxy][${hostname}:${port}] CONNECT request received.`);
                let isMitm = false;
                if (profile !== null) {
                    if (
                        gethttpsFixedRule(profile)[`${hostname}:${port}`] ||
                        getWildcardRule(gethttpsFixedRule(profile), hostname, port)
                    ) {
                        isMitm = true;
                    } else if (inHostUsingProxy(profile, hostname) && !inHostBypassProxy(profile, hostname)) {
                        isMitm = true;
                    }
                }

                // HTTP server sets allowHalfOpen=true on sockets by default.
                // For CONNECT tunnels, when the browser sends FIN it means the connection is done
                // (TLS close_notify was already handled inside the tunnel). Disable half-open so
                // the proxy sends FIN back immediately, preventing lingering FIN_WAIT_2 states.
                cliSoc.allowHalfOpen = false;

                if (isMitm) {
                    // MITM path: TLS-terminate directly on cliSoc and inject into httpsServer.
                    const logPrefix = `[HTTP Proxy][MITM][${hostname}:${port}]`;
                    let tlsSocket = null;
                    const cleanup = once((err) => {
                        safeDestroy(tlsSocket, err, logPrefix);
                        safeDestroy(cliSoc, err, logPrefix);
                    });
                    cliSoc.on('error', (err) => {
                        if (!IGNORED_ERROR_CODE[err?.code]) {
                            logError(`${logPrefix} client socket error:${JSON.stringify(err)}`);
                        }
                        cleanup(err);
                    });
                    cliSoc.on('close', () => cleanup());
                    cliSoc.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: Checkout-Proxy\r\n\r\n', () => {
                        if (cliSoc.destroyed) return;
                        const secureContext = getSecureContext(hostname, (_, ctx) => ctx);
                        tlsSocket = new tls.TLSSocket(cliSoc, {
                            isServer: true,
                            server: httpsServer,
                            secureContext
                        });
                        tlsSocket.on('error', (err) => {
                            if (!IGNORED_ERROR_CODE[err?.code]) {
                                logError(`${logPrefix} TLS error: ${JSON.stringify(err)}`);
                            }
                            cleanup(err);
                        });
                        tlsSocket.on('close', () => cleanup());
                        tlsSocket.on('secure', () => {
                            httpsServer.emit('secureConnection', tlsSocket);
                        });
                    });
                    return;
                }

                const connectionEstablished = [false];
                let svrSoc = null;
                const logPrefix = `[HTTP Proxy][${hostname}:${port}]`;
                const cleanup = once((err) => {
                    safeDestroy(svrSoc, err, logPrefix);
                    safeDestroy(cliSoc, err, logPrefix);
                });

                const failConnect = once((err) => {
                    if (!connectionEstablished[0]) {
                        logError(`${logPrefix} Connection to target server failed: ${JSON.stringify(err)}`);
                        safeWrite(
                            cliSoc,
                            `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\n` +
                                `server socket error occurred in http proxy when accessing ${hostname}:${port}!\nerror:${JSON.stringify(err)}\r\n\r\n`,
                            logPrefix
                        );
                    }
                    cleanup(err);
                });

                cliSoc.on('error', (err) => {
                    if (!IGNORED_ERROR_CODE[err?.code]) {
                        logError(
                            `[HTTP Proxy][${hostname}:${port}] client socket error occurred:${JSON.stringify(err)}`
                        );
                    }
                    // Let the shared cleanup handle teardown; avoid extra destroy paths racing with pipeline().
                    cleanup(err);
                });
                cliSoc.on('close', () => cleanup());

                svrSoc = net.connect(port, hostname, () => {
                    connectionEstablished[0] = true;
                    cliSoc.write('HTTP/1.1 200 Connection Established\r\n' + 'Proxy-agent: Checkout-Proxy\r\n\r\n');
                    if (cliHead && cliHead.length > 0) {
                        safeWrite(svrSoc, cliHead, logPrefix);
                    }

                    // pipeline() already manages stream teardown on error; keep teardown idempotent via cleanup().
                    pipeline(cliSoc, svrSoc, (err) => {
                        if (err && !IGNORED_ERROR_CODE[err.code]) {
                            logError(
                                `[HTTP Proxy][${hostname}:${port}] Error piping clientSocket to serverSocket:${JSON.stringify(err)}`
                            );
                        }
                        if (err) cleanup(err);
                    });
                    pipeline(svrSoc, cliSoc, (err) => {
                        if (err && !IGNORED_ERROR_CODE[err.code]) {
                            logError(
                                `[HTTP Proxy][${hostname}:${port}] Error piping serverSocket to clientSocket:${JSON.stringify(err)}`
                            );
                        }
                        if (err) cleanup(err);
                    });
                });

                svrSoc.on('error', (err) => {
                    if (!connectionEstablished[0]) return failConnect(err);
                    if (!IGNORED_ERROR_CODE[err?.code]) {
                        logError(
                            `[HTTP Proxy][${hostname}:${port}] server socket error occurred:${JSON.stringify(err)}`
                        );
                    }
                    cleanup(err);
                });
                svrSoc.on('close', () => cleanup());
            });
            httpServer.on('request', (clientReq, clientRes) => {
                // Handle CA certificate download
                if (clientReq.url === '/download-ca') {
                    const caString = getRootCAString();
                    if (caString) {
                        clientRes.writeHead(200, {
                            'Content-Type': 'application/x-x509-ca-cert',
                            'Content-Disposition': 'attachment; filename="checkout-proxy-rootCA.crt"',
                            'Content-Length': Buffer.byteLength(caString)
                        });
                        clientRes.end(caString);
                    } else {
                        clientRes.writeHead(404, { 'Content-Type': 'text/plain' });
                        clientRes.end('No CA certificate available.');
                    }
                    return;
                }
                if (!isHttp(clientReq.url)) {
                    logError(`[HTTP Proxy] unsupported request:${clientReq.url}`);
                    clientRes.writeHead(403, { 'Content-Type': 'text/plain' });
                    clientRes.end('[Checkout-Proxy]Forbidden: only http/https schemes allowed through this proxy.');
                    return;
                }
                const { host, port, pathname, search } = new URL(clientReq.url);
                const path = pathname + search;
                let targetHost = host.split(':')[0];
                let targetPort = port;
                logInfo(`[HTTP Proxy][${targetHost}:${targetPort}] request received.`);
                let agentUrl;
                const httpFixedRule = gethttpFixedRule(profile);
                const originalHostPort = `${targetHost}:${targetPort || '80'}`;
                const mapping =
                    httpFixedRule[originalHostPort] || getWildcardRule(httpFixedRule, targetHost, targetPort || '80');
                const urlFactor = getUrlFactor(mapping?.target);
                //default is http
                const isTargetHttps = urlFactor?.protocol === 'https';
                let hasRule = false;
                if (profile) {
                    if (mapping) {
                        hasRule = true;
                        targetPort = urlFactor?.port || targetPort;
                        targetHost = urlFactor?.host || targetHost;
                        if (mapping.customizedProxy) {
                            agentUrl = mapping.customizedProxy;
                        }
                    } else if (inHostUsingProxy(profile, targetHost) && !inHostBypassProxy(profile, targetHost)) {
                        hasRule = true;
                        agentUrl = profile?.proxy?.proxyUrl;
                    }
                }
                targetPort = targetPort || (isTargetHttps ? '443' : '80');
                const requestOrigin = clientReq.headers.origin;
                const changeableOptions = {
                    hostname: targetHost,
                    port: targetPort,
                    method: clientReq.method,
                    path,
                    headers: { ...clientReq.headers },
                    protocol: isTargetHttps ? 'https' : 'http',
                    proxyUrl: agentUrl
                };

                // Preserve TE/Transfer-Encoding/Trailer per requirements.
                stripHopByHopHeaders(changeableOptions.headers, { preserve: ['te', 'transfer-encoding', 'trailer'] });

                if (profile && !mapping?.keepHostHeader && urlFactor) {
                    const isDefaultPort = isTargetHttps ? targetPort === '443' : targetPort === '80';
                    changeableOptions.headers.host = `${targetHost}${isDefaultPort ? '' : `:${targetPort}`}`;
                }

                const recording = profile?.fromGlobal?.recording && hasRule;
                if (clientReq.method === 'OPTIONS' && mapping?.bypassCors) {
                    const hackedResponse = processBypassCorsAndUserHackForOption(
                        requestOrigin,
                        changeableOptions,
                        mapping?.hackResponse
                    );
                    if (profile?.fromGlobal?.addAgentHeader) {
                        hackedResponse.headers = {
                            ...hackedResponse.headers,
                            [HEADER_CHECKOUT_PROXY_USE_AGENT]: USE_NO_AGENT[1]
                        };
                    }
                    const protocolLabel = formatProtocolLabel(changeableOptions.protocol, clientReq);
                    const logId = logRequestToConsole(changeableOptions, protocolLabel, recording);
                    updateConsoleLogEntry(
                        logId,
                        { code: String(hackedResponse.code), resHeaders: hackedResponse.headers },
                        recording
                    );
                    storeBodyData(logId, 'reqBody', '[Checkout-Proxy]Ignored...', recording);
                    storeBodyData(logId, 'resBody', '', recording);
                    clientRes.writeHead(hackedResponse.code, hackedResponse.headers);
                    clientRes.end();
                    return;
                }

                const hackedOptions = (mapping?.hackRequest || []).reduce((acc, f) => f(acc), changeableOptions) ?? {};
                const logPrefix = `[HTTP Proxy][${hackedOptions.hostname}:${hackedOptions.port}]`;

                const options = { ...hackedOptions, rejectUnauthorized: false, maxHeaderSize: MAX_HEADER_SIZE };
                if (typeof options.timeout === 'undefined') options.timeout = SERVER_REQUEST_TIMEOUT_SEC * 1000;
                if (options.proxyUrl) {
                    options.agent = getCustomHttpAgent(options.protocol, options.proxyUrl);
                }

                const savedProxyUrl = options.agent ? options.proxyUrl : USE_NO_AGENT[0];
                hackedOptions.proxyUrl = savedProxyUrl;
                const consoleLogId = logRequestToConsole(hackedOptions, hackedOptions.protocol, recording);
                // Set up request body collection
                setupRequestBodyCollection(clientReq, consoleLogId, recording);

                const httpOrHttps = options?.protocol === 'https' ? https : http;
                const savedHttpOrHttps = options?.protocol;
                ['protocol', 'proxyUrl'].forEach((key) => delete options[key]);

                const proxyReq = httpOrHttps.request(options, (proxyRes) => {
                    const responseHeaders = { ...proxyRes.headers };
                    if (mapping?.bypassCors) {
                        processBypassCors(requestOrigin, responseHeaders);
                    }
                    const originalResponse = { code: proxyRes.statusCode, headers: responseHeaders };
                    if (profile?.fromGlobal?.addAgentHeader) {
                        originalResponse.headers = {
                            ...originalResponse.headers,
                            [HEADER_CHECKOUT_PROXY_USE_AGENT]: savedProxyUrl
                        };
                    }
                    // Preserve TE/Transfer-Encoding/Trailer per requirements.
                    stripHopByHopHeaders(originalResponse.headers, {
                        preserve: ['te', 'transfer-encoding', 'trailer']
                    });

                    const hackedResponse = (mapping?.hackResponse || []).reduce(
                        (acc, f) => f(hackedOptions, acc),
                        originalResponse
                    );

                    // Update console log with protocol version, http code and response headers
                    updateConsoleLogEntry(
                        consoleLogId,
                        {
                            protocol: formatProtocolLabel(savedHttpOrHttps, proxyRes),
                            code: String(hackedResponse?.code ?? null),
                            resHeaders: hackedResponse?.headers || null
                        },
                        recording
                    );

                    // Set up response body collection
                    setupResponseCollection(proxyRes, consoleLogId, recording);

                    try {
                        clientRes.writeHead(hackedResponse?.code, hackedResponse?.headers);
                    } catch (e) {
                        logError(
                            `[HTTP Proxy][${targetHost}:${targetPort}] writeHead failed: ${e?.code || ''} ${e?.message || e}`
                        );
                        if (!clientRes.headersSent) {
                            clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
                        }
                        clientRes.end(
                            `[Checkout-Proxy]Http Proxy error: failed to write response headers.\nerror:${JSON.stringify(
                                {
                                    code: e?.code,
                                    message: e?.message
                                }
                            )}`
                        );
                        safeDestroy(proxyRes, e, logPrefix);
                        return;
                    }
                    pipeResponseAndMaybeAddTrailers(
                        proxyRes,
                        clientRes,
                        `[HTTP Proxy][${targetHost}:${targetPort}]`,
                        logError
                    );
                });
                clientRes.on('close', () => {
                    if (!clientRes.writableFinished) {
                        safeDestroy(proxyReq, null, logPrefix);
                    }
                });
                proxyReq.on('error', (err) => {
                    updateConsoleLogEntry(consoleLogId, { code: 'failed' }, recording);
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
                        clientRes.end(
                            `[Checkout-Proxy]http proxy request error!\nerror:${JSON.stringify({
                                code: err?.code,
                                message: err?.message
                            })}`
                        );
                    }
                });
                proxyReq.on('timeout', () => {
                    updateConsoleLogEntry(consoleLogId, { code: 'failed' }, recording);
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(504, { 'Content-Type': 'text/plain' }); // Gateway Timeout
                        clientRes.end(
                            `[Checkout-Proxy]Http Proxy error: socket timeout connecting to target ${targetHost}:${targetPort}`
                        );
                    }
                    safeDestroy(proxyReq, null, logPrefix);
                });
                pipeline(clientReq, proxyReq, (err) => {
                    if (err) {
                        logError(
                            `[HTTP Proxy][${targetHost}:${targetPort}] Error piping original request to proxy request: ${JSON.stringify(err)}`
                        );
                    }
                });
            });
            httpServer.on('clientError', (err, soc) => {
                logError(`[HTTP Proxy] clientError occurred:${JSON.stringify(err)}`);
                safeDestroy(soc, err, '[HTTP Proxy]');
            });
            httpServer.on('error', (err) => serverErrorHandler?.(err, 'HTTP', httpPort));
            httpServer.on('upgrade', (req, socket, head) => {
                logInfo(`[HTTP Proxy][${req.url}] upgrade request received.`);
                if (!isHttp(req.url) && !isRelativePath(req.url)) {
                    socket.write(
                        'HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n[Checkout-Proxy]Only http/https upgrade targets allowed.\r\n'
                    );
                    safeDestroy(socket, null, `[HTTP Proxy][${req.url}]`);
                    return;
                }
                socket.write(
                    'HTTP/1.1 501 Not Implemented\r\nContent-Type: text/plain\r\n\r\n[Checkout-Proxy]Upgrade not implemented.\r\n'
                );
                safeDestroy(socket, null, `[HTTP Proxy][${req.url}]`);
            });
            httpServer.listen(httpPort, listenOn || '127.0.0.1', () => {
                logInfo(`HTTP Proxy server listening on ${listenOn || '127.0.0.1'}:${httpPort}`);
                resolve({
                    startedHttpServer: httpServer,
                    startedHttpsServer: httpsServer,
                    usingFallbackCert
                });
            });

            httpsServer.on('request', (clientReq, clientRes) => {
                if (!isRelativePath(clientReq.url) && !isHttp(clientReq.url)) {
                    logError(`[HTTPS Proxy] unsupported request:${clientReq.url}`);
                    clientRes.writeHead(403, { 'Content-Type': 'text/plain' });
                    clientRes.end('[Checkout-Proxy]Forbidden: only http/https schemes allowed through this proxy.');
                    return;
                }
                const originalHost = clientReq.headers[findHeaderWithIgnoreCase(clientReq.headers, 'host')];
                let targetHost, targetPort;
                // IPv6-safe host:port parsing — e.g. [::1]:443
                if (originalHost && originalHost.startsWith('[')) {
                    const bracketEnd = originalHost.indexOf(']');
                    targetHost = bracketEnd > 0 ? originalHost.slice(1, bracketEnd) : originalHost;
                    targetPort =
                        bracketEnd > 0 && originalHost[bracketEnd + 1] === ':'
                            ? originalHost.slice(bracketEnd + 2)
                            : undefined;
                } else {
                    targetHost = originalHost?.split(':')[0] || originalHost;
                    targetPort = originalHost?.split(':')[1];
                }
                let agentUrl;
                const httpsFixedRule = gethttpsFixedRule(profile);
                const originalHostPort = `${targetHost}:${targetPort || '443'}`;
                const mapping =
                    httpsFixedRule[originalHostPort] ||
                    getWildcardRule(httpsFixedRule, targetHost, targetPort || '443');
                const urlFactor = getUrlFactor(mapping?.target);
                //default is https
                const isTargetHttp = urlFactor?.protocol === 'http';
                let hasRule = false;
                if (profile) {
                    if (mapping) {
                        hasRule = true;
                        targetPort = urlFactor?.port || targetPort;
                        targetHost = urlFactor?.host || targetHost;
                        if (mapping.customizedProxy) {
                            agentUrl = mapping.customizedProxy;
                        }
                    } else if (inHostUsingProxy(profile, targetHost) && !inHostBypassProxy(profile, targetHost)) {
                        hasRule = true;
                        agentUrl = profile.proxy?.proxyUrl;
                    }
                }
                targetPort = targetPort || (isTargetHttp ? '80' : '443');

                const requestOrigin = clientReq.headers.origin;
                const changeableOptions = {
                    hostname: targetHost,
                    port: targetPort,
                    path: clientReq.url,
                    method: clientReq.method,
                    headers: { ...clientReq.headers },
                    protocol: isTargetHttp ? 'http' : 'https',
                    proxyUrl: agentUrl
                };

                // Preserve TE/Transfer-Encoding/Trailer per requirements.
                stripHopByHopHeaders(changeableOptions.headers, { preserve: ['te', 'transfer-encoding', 'trailer'] });

                if (!mapping?.keepHostHeader && urlFactor) {
                    const isDefaultPort = isTargetHttp ? targetPort === '80' : targetPort === '443';
                    changeableOptions.headers.host = `${targetHost}${isDefaultPort ? '' : `:${targetPort}`}`;
                }

                const recording = profile?.fromGlobal?.recording && hasRule;
                if (clientReq.method === 'OPTIONS' && mapping?.bypassCors) {
                    const hackedResponse = processBypassCorsAndUserHackForOption(
                        requestOrigin,
                        changeableOptions,
                        mapping?.hackResponse
                    );
                    if (profile?.fromGlobal?.addAgentHeader) {
                        hackedResponse.headers = {
                            ...hackedResponse.headers,
                            [HEADER_CHECKOUT_PROXY_USE_AGENT]: USE_NO_AGENT[1]
                        };
                    }
                    const protocolLabel = formatProtocolLabel(changeableOptions.protocol, clientReq);
                    const logId = logRequestToConsole(changeableOptions, protocolLabel, recording);
                    updateConsoleLogEntry(
                        logId,
                        { code: String(hackedResponse.code), resHeaders: hackedResponse.headers },
                        recording
                    );
                    storeBodyData(logId, 'reqBody', '[Checkout-Proxy]Ignored...', recording);
                    storeBodyData(logId, 'resBody', '', recording);
                    clientRes.writeHead(hackedResponse.code, hackedResponse.headers);
                    clientRes.end();
                    return;
                }
                const hackedOptions = (mapping?.hackRequest || []).reduce((acc, f) => f(acc), changeableOptions) ?? {};
                const logPrefix = `[HTTPS Proxy][${hackedOptions.hostname}:${hackedOptions.port}]`;

                const options = { ...hackedOptions, rejectUnauthorized: false, maxHeaderSize: MAX_HEADER_SIZE };
                if (typeof options.timeout === 'undefined') options.timeout = SERVER_REQUEST_TIMEOUT_SEC * 1000;
                if (options.proxyUrl) {
                    options.agent = getCustomHttpAgent(options.protocol, options.proxyUrl);
                }

                const savedProxyUrl = options.agent ? options.proxyUrl : USE_NO_AGENT[0];
                hackedOptions.proxyUrl = savedProxyUrl;
                const consoleLogId = logRequestToConsole(hackedOptions, hackedOptions.protocol, recording);
                // Set up request body collection
                setupRequestBodyCollection(clientReq, consoleLogId, recording);

                const httpOrHttps = options?.protocol === 'http' ? http : https;
                const savedHttpOrHttps = options?.protocol;

                ['protocol', 'proxyUrl'].forEach((key) => delete options[key]);

                const proxyReq = httpOrHttps.request(options, (proxyRes) => {
                    const responseHeaders = { ...proxyRes.headers };
                    if (mapping?.bypassCors) {
                        processBypassCors(requestOrigin, responseHeaders);
                    }
                    const originalResponse = { code: proxyRes.statusCode, headers: responseHeaders };
                    if (profile?.fromGlobal?.addAgentHeader) {
                        originalResponse.headers = {
                            ...originalResponse.headers,
                            [HEADER_CHECKOUT_PROXY_USE_AGENT]: savedProxyUrl
                        };
                    }
                    // Preserve TE/Transfer-Encoding/Trailer per requirements.
                    stripHopByHopHeaders(originalResponse.headers, {
                        preserve: ['te', 'transfer-encoding', 'trailer']
                    });

                    const hackedResponse = (mapping?.hackResponse || []).reduce(
                        (acc, f) => f(hackedOptions, acc),
                        originalResponse
                    );

                    // Update console log with protocol version, http code and response headers
                    updateConsoleLogEntry(
                        consoleLogId,
                        {
                            protocol: formatProtocolLabel(savedHttpOrHttps, proxyRes),
                            code: String(hackedResponse?.code ?? null),
                            resHeaders: hackedResponse?.headers || null
                        },
                        recording
                    );

                    // Set up response body collection
                    setupResponseCollection(proxyRes, consoleLogId, recording);

                    try {
                        clientRes.writeHead(hackedResponse?.code, hackedResponse?.headers);
                    } catch (e) {
                        logError(
                            `[HTTPS Proxy][${targetHost}:${targetPort}] writeHead failed: ${e?.code || ''} ${e?.message || e}`
                        );
                        if (!clientRes.headersSent) {
                            clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
                        }
                        clientRes.end(
                            `[Checkout-Proxy]Https proxy error: failed to write response headers.\nerror:${JSON.stringify(
                                {
                                    code: e?.code,
                                    message: e?.message
                                }
                            )}`
                        );
                        safeDestroy(proxyRes, e, logPrefix);
                        return;
                    }
                    pipeResponseAndMaybeAddTrailers(
                        proxyRes,
                        clientRes,
                        `[HTTPS Proxy][${targetHost}:${targetPort}]`,
                        logError
                    );
                });
                clientRes.on('close', () => {
                    if (!clientRes.writableFinished) {
                        safeDestroy(proxyReq, null, logPrefix);
                    }
                });
                proxyReq.on('error', (err) => {
                    updateConsoleLogEntry(consoleLogId, { code: 'failed' }, recording);
                    const errorResponseHeaders = { 'Content-Type': 'text/plain' };
                    if (mapping?.bypassCors) {
                        if (requestOrigin) {
                            errorResponseHeaders['Access-Control-Allow-Origin'] = requestOrigin;
                            errorResponseHeaders['Access-Control-Allow-Credentials'] = 'true';
                            errorResponseHeaders['Vary'] = 'Origin';
                        } else {
                            errorResponseHeaders['Access-Control-Allow-Origin'] = '*';
                        }
                    }
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(502, errorResponseHeaders);
                        clientRes.end(
                            `[Checkout-Proxy]Https proxy request error!\nerror:${JSON.stringify({
                                code: err?.code,
                                message: err?.message
                            })}`
                        );
                    }
                });
                proxyReq.on('timeout', () => {
                    updateConsoleLogEntry(consoleLogId, { code: 'failed' }, recording);
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(504, { 'Content-Type': 'text/plain' }); // Gateway Timeout
                        clientRes.end(
                            `[Checkout-Proxy]Https Proxy error: socket timeout connecting to target ${targetHost}:${targetPort}`
                        );
                    }
                    safeDestroy(proxyReq, null, logPrefix);
                });
                pipeline(clientReq, proxyReq, (err) => {
                    if (err && !IGNORED_ERROR_CODE[err.code]) {
                        logError(
                            `[HTTPS Proxy][${targetHost}:${targetPort}] Error piping http proxy request to target request: ${JSON.stringify(err)}`
                        );
                    }
                });
            });
            httpsServer.on('error', (err) => {
                serverErrorHandler?.(err, 'HTTPS', httpPort);
            });
            httpsServer.on('clientError', (err, soc) => {
                logError(`[HTTPS Proxy] clientError error occurred:${JSON.stringify(err)}`);
                safeDestroy(soc, err, '[HTTPS Proxy]');
            });
            httpsServer.on('upgrade', (req, socket, head) => {
                logInfo(`[HTTPS Proxy][${req.url}] upgrade request received.`);
                socket.write(
                    '[Checkout-Proxy]HTTP/1.1 501 Not Implemented\r\nContent-Type: text/plain\r\n\r\nUpgrade not implemented.\r\n'
                );
                safeDestroy(socket, null, `[HTTPS Proxy][${req.url}]`);
            });
        });
};
