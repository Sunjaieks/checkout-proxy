/**
 * generate rootCA.key : openssl genrsa -out rootCA.key 4096
 * generate rootCA.crt : openssl req -x509 -new -nodes -key rootCA.key -sha256 -days 27199 -out rootCA.crt -config root_ca.cnf
 * generate inherited key and cert: openssl req -nodes -x509 -new -out fallbackCA.crt -keyout fallbackCA.key -config fallback_ca.cnf -days 27199 -sha256 -CA rootCA.crt -CAkey rootCA.key -newkey rsa:4096
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {URL} from 'node:url';
import {pipeline} from 'node:stream';
import {
    gethttpFixedRule,
    gethttpsFixedRule,
    getUrlFactor,
    getWildcardRule,
    inHostBypassProxy,
    inHostUsingProxy,
    isHttp,
    isLocalHost,
    isRelativePath
} from '../util/sharedUtil.js'
import {formatUrl, logError, logInfo, rootCertPath, rootKeyPath} from "../util/nodeUtil.js";
import {handleServerError} from "../main/main.js";
import fs from "fs";
import {addShutdown} from "./http-shutdown.js";
import forge from "node-forge";
import tls from 'node:tls';
import {LRUCache} from "./cache.js";
import {ASK_TO_RENEW_CA, ASK_TO_RENEW_CA_LONG, CERT_COMMON_NAME, IGNORED_ERROR_CODE} from "../constant/constant.js";
import {CustomHttpAgent} from "./agent.js";

let fallbackRootCASubjectKeyIdentifier;
let fallbackRootCA
let fallbackRootCAKey;
let fallbackRootCAString
let fallbackRootCAKeyString;
let rootCASubjectKeyIdentifier;
let rootCA
let rootCAKey;
let rootCAString;
let rootCAKeyString;

const certCache = new LRUCache(10000, 1000 * 3600 * 240); // 10,000 entries, 10 day TTL
const agentCache = new LRUCache(100, 1000 * 120, item => item.destroy?.()); // 100 entries, 1min ttl

const SERVER_REQUEST_TIMEOUT_SEC = 1200; // seconds

export function clearCertCache() {
    certCache.clear();
}

export function clearAgentCache() {
    agentCache.clear();
}

export function generateRootCA() {
    const keys = forge.pki.rsa.generateKeyPair({bits: 2048});
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = generateSerialNumber()
    const now = new Date();
    cert.validity.notBefore = new Date(now.getTime());
    cert.validity.notBefore.setDate(now.getDate() - 30);
    cert.validity.notAfter = new Date(now.getTime());
    cert.validity.notAfter.setDate(now.getDate() + 700);
    const attrs = [
        {name: 'commonName', value: CERT_COMMON_NAME},
        {name: 'organizationName', value: 'Checkout Proxy, Inc.'},
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    const keyIdentifier = cert.generateSubjectKeyIdentifier().getBytes();
    cert.setExtensions([
        {name: 'basicConstraints', cA: true, critical: true},
        {
            name: 'keyUsage',
            keyCertSign: true,
        },
        {
            name: 'extKeyUsage',
            serverAuth: true,
            clientAuth: true,
        },
        {name: 'subjectKeyIdentifier'},
        {name: 'authorityKeyIdentifier', keyIdentifier}
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return {key: keys.privateKey, cert: cert, keyIdentifier};
}

export async function writeRootCA(key, cert) {
    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(key);
    try {
        fs.writeFileSync(rootCertPath, certPem.replaceAll('\r\n', '\n'));
        fs.writeFileSync(rootKeyPath, keyPem.replaceAll('\r\n', '\n'));
    } catch (error) {
        logError('write certificate error:', error);
        throw new Error(`Failed to save Root CA: ${error.message || 'Unknown error occurred.'} ${ASK_TO_RENEW_CA} Current CA will be used continuously.`);
    }
}

export function loadRootCA(key, cert, keyIdentifier) {
    if (key && cert) {
        rootCA = cert
        rootCAKey = key
        rootCAString = forge.pki.certificateToPem(cert);
        rootCAKeyString = forge.pki.privateKeyToPem(key);
        rootCASubjectKeyIdentifier = keyIdentifier
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
        const {key, cert, keyIdentifier} = generateRootCA()
        fallbackRootCA = cert;
        fallbackRootCAKey = key;
        fallbackRootCAString = forge.pki.certificateToPem(fallbackRootCA);
        fallbackRootCAKeyString = forge.pki.privateKeyToPem(fallbackRootCAKey);
        fallbackRootCASubjectKeyIdentifier = keyIdentifier;
        throw new Error(`Failed to load Root CA: ${e.message || 'Unknown error occurred'}. A fallback CA will be used tentatively. ${ASK_TO_RENEW_CA_LONG}`);
    }
    return rootCA;
}

function generateSerialNumber() {
    // 1. Generate 16 bytes of random data. 16 bytes = 128 bits, which is more
    //    than the 64-bit entropy recommendation. We use 16 instead of the max 20
    //    to leave room for the positivity enforcement byte if needed.
    let randomBytes = forge.random.getBytesSync(16);
    // 2. Ensure the serial number is a positive integer.
    //    The most significant bit (MSB) of the first byte must be 0.
    //    If the first byte is >= 0x80 (128), its MSB is 1, which means
    //    it could be interpreted as a negative number.
    //    In that case, we prepend a '00' byte to make it positive.
    if (randomBytes.charCodeAt(0) >= 0x80) {
        randomBytes = '\x00' + randomBytes;
    }
    // 3. Convert the random bytes to a hex string.
    return forge.util.bytesToHex(randomBytes);
}

const getGenerateServerCertificate = () => {
    const localCAKey = rootCAKey || fallbackRootCAKey;
    const localCASubjectKeyIdentifier = rootCASubjectKeyIdentifier || fallbackRootCASubjectKeyIdentifier;
    return (hostname) => {
        const cached = certCache.get(hostname)
        if (cached) return cached;
        const keys = forge.pki.rsa.generateKeyPair(2048);
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = generateSerialNumber();
        const now = new Date();
        cert.validity.notBefore = new Date(now.getTime());
        cert.validity.notBefore.setDate(now.getDate() - 20);
        cert.validity.notAfter = new Date(now.getTime());
        cert.validity.notAfter.setDate(now.getDate() + 20);

        const attrs = [{name: 'commonName', value: hostname}, {name: 'organizationName', value: `${hostname}, Inc.`}];
        cert.setSubject(attrs);
        cert.setIssuer(rootCA.subject.attributes);
        cert.setExtensions([
            {name: 'basicConstraints', cA: false},
            {
                name: 'keyUsage',
                digitalSignature: true,
                nonRepudiation: true,
                keyEncipherment: true,
                dataEncipherment: true
            },
            {
                name: 'extKeyUsage',
                serverAuth: true,
                clientAuth: true,
            },
            {name: 'subjectAltName', altNames: [{type: 2, value: hostname}]},
            {name: 'subjectKeyIdentifier'},
            {name: 'authorityKeyIdentifier', keyIdentifier: localCASubjectKeyIdentifier}
        ]);

        cert.sign(localCAKey, forge.md.sha256.create());

        const tlsCert = {
            key: forge.pki.privateKeyToPem(keys.privateKey),
            cert: forge.pki.certificateToPem(cert),
        };

        certCache.set(hostname, tlsCert);
        logInfo(`Generated certificate for ${hostname}`);
        return tlsCert;
    }
}

const getSNICallback = mainWindow => {
    const generateServerCertificate = getGenerateServerCertificate()
    return (servername, cb) => {
        try {
            const {key, cert} = generateServerCertificate(servername);
            const secureContext = tls.createSecureContext({key, cert});
            cb(null, secureContext);
        } catch (err) {
            logError(`Error in SNICallback for ${servername}:`, err);
            // cb(err); // This might crash the server, better to log and potentially use a default context or fail gracefully
            // To avoid crashing, don't call cb(err) directly if generateServerCertificate can throw.
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('proxy-status-update', {
                    error: `Cannot generate certificate for ${servername}: ${err.message}.`
                });
            }
            cb(null, tls.createSecureContext({}));
        }
    }
}

const processBypassCorsAndUserHackForOption = (requestOrigin, requestOptions, hackResponseFunctions) => {
    const preflightHeaders = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
        'Access-Control-Allow-Headers': requestOptions.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma, Expires, X-CSRF-Token, Range, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since',
        'Access-Control-Max-Age': '3600', // 1 hour
    };
    if (requestOrigin) {
        preflightHeaders['Access-Control-Allow-Origin'] = requestOrigin;
        preflightHeaders['Access-Control-Allow-Credentials'] = 'true';
    } else {
        preflightHeaders['Access-Control-Allow-Origin'] = '*';
    }
    const originalResponse = {code: 204, headers: preflightHeaders};
    return (hackResponseFunctions || []).reduce((acc, f) => f(requestOptions, acc), originalResponse)
}

const setHeaderNameIgnoreCase = (responseHeaders, headerKey, newValue) => {
    if (!headerKey) return;
    const actuallyKey =
        Object.keys(responseHeaders).find(key => key.toLowerCase() === headerKey.toLowerCase());
    responseHeaders[actuallyKey ? actuallyKey : headerKey] = newValue;
}

const findHeaderWithIgnoreCase = (responseHeaders, headerKey) => {
    if (!headerKey) return undefined;
    const actuallyKey =
        Object.keys(responseHeaders).find(key => key.toLowerCase() === headerKey.toLowerCase());
    if (!actuallyKey) return undefined;
    if (!responseHeaders[actuallyKey]) {
        delete responseHeaders[actuallyKey];
        return undefined;
    }
    return actuallyKey;
}

const removeHeaderWithIgnoreCase = (responseHeaders, headerKey) => {
    if (!headerKey) return;
    const actuallyKey =
        Object.keys(responseHeaders).find(key => key.toLowerCase() === headerKey.toLowerCase());
    delete responseHeaders[actuallyKey];
}

const processBypassCors = (requestOrigin, responseHeaders) => {
    if (requestOrigin) {
        setHeaderNameIgnoreCase(responseHeaders, 'Access-Control-Allow-Origin', requestOrigin)
        setHeaderNameIgnoreCase(responseHeaders, 'Access-Control-Allow-Credentials', 'true')
        // When ACAO is dynamic, Vary: Origin is important for caching.
        // It tells caches that the response varies based on the Origin header.
        // Concatenate if Vary already exists.
        const varyKey = findHeaderWithIgnoreCase(responseHeaders, 'Vary',)
        responseHeaders[varyKey ?? 'Vary'] = responseHeaders[varyKey] ? `${responseHeaders[varyKey]}, Origin` : 'Origin';
    } else {
        setHeaderNameIgnoreCase(responseHeaders, 'Access-Control-Allow-Origin', '*')
        // If ACAO is '*', credentials cannot be allowed.
        removeHeaderWithIgnoreCase(responseHeaders, 'Access-Control-Allow-Credentials')
    }
    removeHeaderWithIgnoreCase(responseHeaders, 'content-security-policy')
    removeHeaderWithIgnoreCase(responseHeaders, 'x-frame-options')
}

const getCustomHttpAgent = (protocol, proxyUrl) => {
    const agentUrlFactor = getUrlFactor(proxyUrl);
    if (!agentUrlFactor) return undefined;
    return agentCache.get(`${protocol}|${proxyUrl}`) ??
        agentCache.set(`${protocol}|${proxyUrl}`, new CustomHttpAgent(`${protocol}:`, agentUrlFactor.host, agentUrlFactor.port, {
            keepAlive: true,
            keepAliveMsecs: 8000,
        }))
}

const getConnectionErrorHandler = (connectionEstablished, cliSoc, hostname, port) => (err) => {
    if (connectionEstablished[0]) return;
    logError(`[HTTP Proxy][${hostname}:${port}] Connection to target server failed: ${JSON.stringify(err)}`);
    if (cliSoc.writable && !cliSoc.destroyed) {
        cliSoc.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\n` +
            `sever socket error occurred in http proxy when accessing ${hostname}:${port}!\nerror:${JSON.stringify(err)}\r\n\r\n`);
        cliSoc.end();
    }
    if (!cliSoc.destroyed) cliSoc.destroy();
};

export const getStartServers = (mainWindow) => {
    const sNICallback = getSNICallback(mainWindow);
    const usingFallbackCert = !rootCAKeyString || !rootCAString
    const localCAKeyString = usingFallbackCert ? fallbackRootCAKeyString : rootCAKeyString;
    const localCAString = usingFallbackCert ? fallbackRootCAString : rootCAString;
    return (appPort, currentProfile) => new Promise((resolve) => {
        clearAgentCache()
        let startedServers = 0;
        const httpPort = appPort[0];
        const httpsPort = appPort[1];
        const profile = currentProfile;
        const httpServer = addShutdown(http.createServer());
        const httpsServer = addShutdown(https.createServer({
            key: localCAKeyString,
            cert: localCAString,
            ciphers: 'ALL:!LOW:!DSS:!EXP',
            SNICallback: sNICallback,
        }));
        httpServer.on('connect', (cliReq, cliSoc, cliHead) => {
            const connectionEstablished = [false];
            const url = new URL(`http://${formatUrl(cliReq.url)}`);
            let port = url.port || '443';
            let hostname = url.hostname;
            logInfo(`[HTTP Proxy][${hostname}:${port}] CONNECT request received.`);
            if (profile !== null) {
                if (gethttpsFixedRule(profile)[`${hostname}:${port}`] || getWildcardRule(gethttpsFixedRule(profile), hostname, port)) {
                    port = httpsPort;
                    hostname = '127.0.0.1';
                } else if (inHostUsingProxy(profile, hostname) && !inHostBypassProxy(profile, hostname)) {
                    port = httpsPort;
                    hostname = '127.0.0.1';
                }
            }
            let svrSoc;
            cliSoc
                .on('error', (err) => {
                    if (!IGNORED_ERROR_CODE[err.code]) {
                        logError(`[HTTP Proxy][${hostname}:${port}] client to http proxy socket error occurred:${JSON.stringify(err)}`);
                    }
                    if (!svrSoc.destroyed) svrSoc.destroy();
                })
            const connectionErrorHandler = getConnectionErrorHandler(connectionEstablished, cliSoc, hostname, port)
            svrSoc = net
                .connect(port, hostname, () => {
                    connectionEstablished[0] = true;
                    svrSoc.removeListener('error', connectionErrorHandler);
                    cliSoc.write('HTTP/1.1 200 Connection Established\r\n' +
                        'Proxy-agent: Checkout-Proxy\r\n\r\n');
                    if (cliHead && cliHead.length > 0) svrSoc.write(cliHead);
                    pipeline(cliSoc, svrSoc, (err) => {
                        if (err && !IGNORED_ERROR_CODE[err.code]) {
                            logError(`[HTTP Proxy][${hostname}:${port}] Error piping clientSocket to serverSocket:${JSON.stringify(err)}`);
                        }
                    });
                    pipeline(svrSoc, cliSoc, (err) => {
                        if (err) {
                            logError(`[HTTP Proxy][${hostname}:${port}] Error piping serverSocket to clientSocket:${JSON.stringify(err)}`);
                        }
                    });
                })
            svrSoc.on('error', connectionErrorHandler)
        });
        httpServer.on('request', (clientReq, clientRes) => {
            if (!isHttp(clientReq.url)) {
                logError(`[HTTP Proxy] unsupported request:${clientReq.url}`);
                clientRes.writeHead(403, {'Content-Type': 'text/plain'});
                clientRes.end('Forbidden: only http/https schemes allowed through this proxy.');
                return;
            }
            const {host, port, pathname, search} = new URL(clientReq.url);
            const path = pathname + search;
            let targetHost = host.split(':')[0];
            let targetPort = port;
            logInfo(`[HTTP Proxy][${targetHost}:${targetPort}] request received.`);
            let agentUrl;
            const httpFixedRule = gethttpFixedRule(profile);
            const originalHostPort = `${targetHost}:${targetPort || '80'}`;
            const mapping = httpFixedRule[originalHostPort] || getWildcardRule(httpFixedRule, targetHost, targetPort || '80');
            const urlFactor = getUrlFactor(mapping?.target)
            //default is http
            const isTargetHttps = urlFactor?.protocol === 'https';

            if (profile) {
                if (mapping) {
                    targetPort = urlFactor?.port || targetPort;
                    targetHost = urlFactor?.host || targetHost;
                    if (!isLocalHost(targetHost) && mapping.customizedProxy) {
                        agentUrl = mapping.customizedProxy;
                    }
                } else if (!isLocalHost(targetHost) && inHostUsingProxy(profile, targetHost) && !inHostBypassProxy(profile, targetHost)) {
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
                headers: {...clientReq.headers},
                protocol: isTargetHttps ? 'https' : 'http',
                proxyUrl: agentUrl,
            };
            if (!mapping?.keepHostHeader) {
                changeableOptions.headers.host = targetHost;
            }

            if (clientReq.method === 'OPTIONS' && mapping?.bypassCors) {
                const hackedResponse = processBypassCorsAndUserHackForOption(requestOrigin, changeableOptions, mapping?.hackResponse);
                clientRes.writeHead(hackedResponse?.code, hackedResponse?.headers);
                clientRes.end();
                return;
            }

            const hackedOptions = (mapping?.hackRequest || []).reduce((acc, f) => f(acc), changeableOptions)
            const options = {...hackedOptions, rejectUnauthorized: false}
            if (typeof options.timeout === 'undefined') options.timeout = SERVER_REQUEST_TIMEOUT_SEC * 1000;
            if (options.proxyUrl) {
                options.agent = getCustomHttpAgent(options.protocol, options.proxyUrl);
            }
            const httpOrHttps = options?.protocol === 'https' ? https : http;
            ['protocol', 'proxyUrl'].forEach(key => delete options[key]);

            const proxyReq = httpOrHttps.request(options, (proxyRes) => {
                const responseHeaders = {...proxyRes.headers};
                if (mapping?.bypassCors) {
                    processBypassCors(requestOrigin, responseHeaders);
                }
                const originalResponse = {code: proxyRes.statusCode, headers: responseHeaders};
                const hackedResponse = (mapping?.hackResponse || []).reduce((acc, f) => f(hackedOptions, acc), originalResponse)

                clientRes.writeHead(hackedResponse?.code, hackedResponse?.headers);
                pipeline(proxyRes, clientRes, (err) => {
                    if (err) {
                        logError(`[HTTP Proxy][${targetHost}:${targetPort}] Error piping target response to http proxy: ${JSON.stringify(err)}`);
                    }
                });
            });
            proxyReq.on('error', (err) => {
                if (!clientRes.headersSent) {
                    clientRes.writeHead(502, {'Content-Type': 'text/plain'});
                    clientRes.end(`http proxy request error!\nerror:${JSON.stringify({
                        code: err?.code,
                        message: err?.message
                    })}`);
                }
            });
            proxyReq.on('timeout', () => {
                if (!clientRes.headersSent) {
                    clientRes.writeHead(504, {'Content-Type': 'text/plain'}); // Gateway Timeout
                    clientRes.end(`Http Proxy error: socket timeout connecting to target ${targetHost}:${targetPort}`);
                }
                proxyReq?.destroy();
            });
            pipeline(clientReq, proxyReq, (err) => {
                if (err) {
                    logError(`[HTTPS Proxy][${targetHost}:${targetPort}] Error piping original request to proxy request: ${JSON.stringify(err)}`);
                }
            });
        });
        httpServer.on('clientError', (err, soc) => {
            logError(`[HTTP Proxy] clientError occurred:${JSON.stringify(err)}`);
            if (soc && !soc.destroyed) soc.destroy();
        })
        httpServer.on('error', (err) => handleServerError(err, 'HTTP', httpPort));
        httpServer.on('upgrade', (req, socket, head) => {
            logInfo(`[HTTP Proxy][${req.url}] upgrade request received.`);
            if (!isHttp(req.url) && !isRelativePath(req.url)) {
                socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nOnly http/https upgrade targets allowed.\r\n');
                socket.destroy();
                return;
            }
            socket.write('\'HTTP/1.1 501 Not Implemented\r\nContent-Type: text/plain\r\n\r\nUpgrade not implemented.\r\n');
            socket.destroy();
        });
        httpServer.listen(httpPort, '127.0.0.1', () => {
            logInfo(`HTTP Proxy server listening on localhost:${httpPort}`);
            startedServers++;
            if (startedServers === 2) {
                resolve({startedHttpServer: httpServer, startedHttpsServer: httpsServer, usingFallbackCert});
            }
        });

        httpsServer.on('request', (clientReq, clientRes) => {
            if (!isRelativePath(clientReq.url) && !isHttp(clientReq.url)) {
                logError(`[HTTPS Proxy] unsupported request:${clientReq.url}`);
                clientRes.writeHead(403, {'Content-Type': 'text/plain'});
                clientRes.end('Forbidden: only http/https schemes allowed through this proxy.');
                return;
            }
            const originalHost = clientReq.headers[findHeaderWithIgnoreCase(clientReq.headers, 'host')];
            let targetHost = originalHost?.split(':')[0] || originalHost;
            let targetPort = originalHost?.split(':')[1];
            let agentUrl;
            const httpsFixedRule = gethttpsFixedRule(profile);
            const originalHostPort = `${targetHost}:${targetPort || '443'}`;
            const mapping = httpsFixedRule[originalHostPort] || getWildcardRule(httpsFixedRule, targetHost, targetPort || '443');
            const urlFactor = getUrlFactor(mapping?.target)
            //default is https
            const isTargetHttp = urlFactor?.protocol === 'http';
            if (profile) {
                if (mapping) {
                    targetPort = urlFactor?.port || targetPort;
                    targetHost = urlFactor?.host || targetHost;
                    if (!isLocalHost(targetHost) && mapping.customizedProxy) {
                        agentUrl = mapping.customizedProxy;
                    }
                } else if (!isLocalHost(targetHost) && inHostUsingProxy(profile, targetHost) && !inHostBypassProxy(profile, targetHost)) {
                    agentUrl = profile?.proxy?.proxyUrl;
                }
            }
            targetPort = targetPort || (isTargetHttp ? '80' : '443');

            const requestOrigin = clientReq.headers.origin;
            const changeableOptions = {
                hostname: targetHost,
                port: targetPort,
                path: clientReq.url,
                method: clientReq.method,
                headers: {...clientReq.headers},
                protocol: isTargetHttp ? 'http' : 'https',
                proxyUrl: agentUrl
            };
            if (!mapping?.keepHostHeader) {
                changeableOptions.headers.host = originalHost?.split(':')[1] ? `${targetHost}:${targetPort}` : targetHost;
            }
            if (clientReq.method === 'OPTIONS' && mapping?.bypassCors) {
                const hackedResponse = processBypassCorsAndUserHackForOption(requestOrigin, changeableOptions, mapping?.hackResponse);
                clientRes.writeHead(hackedResponse?.code, hackedResponse?.headers);
                clientRes.end();
                return;
            }
            const hackedOptions = (mapping?.hackRequest || []).reduce((acc, f) => f(acc), changeableOptions)
            const options = {...hackedOptions, rejectUnauthorized: false}
            if (typeof options.timeout === 'undefined') options.timeout = SERVER_REQUEST_TIMEOUT_SEC * 1000;
            if (options.proxyUrl) {
                options.agent = getCustomHttpAgent(options.protocol, options.proxyUrl);
            }
            const httpOrHttps = options?.protocol === 'http' ? http : https;
            ['protocol', 'proxyUrl'].forEach(key => delete options[key]);

            const proxyReq = httpOrHttps.request(options, (proxyRes) => {
                const responseHeaders = {...proxyRes.headers};
                if (mapping?.bypassCors) {
                    processBypassCors(requestOrigin, responseHeaders);
                }
                const originalResponse = {code: proxyRes.statusCode, headers: responseHeaders};
                const hackedResponse = (mapping?.hackResponse || []).reduce((acc, f) => f(hackedOptions, acc), originalResponse)
                clientRes.writeHead(hackedResponse?.code, hackedResponse?.headers);
                pipeline(proxyRes, clientRes, (err) => {
                    if (err) {
                        logError(`[HTTPS Proxy][${targetHost}:${targetPort}] Error piping target response to proxy response: ${JSON.stringify(err)}`);
                    }
                });
            });
            proxyReq.on('error', (err) => {
                const errorResponseHeaders = {'Content-Type': 'text/plain'};
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
                    clientRes.end(`Https proxy request error!\nerror:${JSON.stringify({
                        code: err?.code,
                        message: err?.message
                    })}`);
                }
            });
            proxyReq.on('timeout', () => {
                if (!clientRes.headersSent) {
                    clientRes.writeHead(504, {'Content-Type': 'text/plain'}); // Gateway Timeout
                    clientRes.end(`Https Proxy error: socket timeout connecting to target ${targetHost}:${targetPort}`);
                }
                proxyReq?.destroy();
            });
            pipeline(clientReq, proxyReq, (err) => {
                if (err && !IGNORED_ERROR_CODE[err.code]) {
                    logError(`[HTTPS Proxy][${targetHost}:${targetPort}] Error piping http proxy request to target request: ${JSON.stringify(err)}`);
                }
            });
        });
        httpsServer.on('error', (err) => {
            handleServerError(err, 'HTTPS', httpsPort)
        });
        httpsServer.on('clientError', (err, soc) => {
            logError(`[HTTPS Proxy] clientError error occurred:${JSON.stringify(err)}`);
            if (soc && !soc.destroyed) soc.destroy();
        })
        httpsServer.listen(httpsPort, '127.0.0.1', () => {
            logInfo(`Local HTTPS MITM server listening on localhost:${httpsPort}`);
            startedServers++;
            if (startedServers === 2) {
                resolve({startedHttpServer: httpServer, startedHttpsServer: httpsServer, usingFallbackCert});
            }
        });
    });
}
