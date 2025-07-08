/**
 * generate rootCA.key : openssl genrsa -out rootCA.key 4096
 * generate rootCA.crt : openssl req -x509 -new -nodes -key rootCA.key -sha256 -days 27199 -out rootCA.crt -config root_ca.cnf
 * generate inherited key and cert: openssl req -nodes -x509 -new -out fallbackCA.crt -keyout fallbackCA.key -config fallback_ca.cnf -days 27199 -sha256 -CA rootCA.crt -CAkey rootCA.key -newkey rsa:4096
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {URL} from 'node:url';
import {CustomHttpAgent} from './agent.js';
import {
    gethttpFixedRule,
    gethttpsFixedRule,
    getRemoteProxyHost,
    getRemoteProxyPort,
    inHostBypassProxy,
    inHostUsingProxy,
    isLocalHost
} from '../util/sharedUtil.js'
import {getResourceFilePath, isKeepAlive, logError, logInfo} from "../util/nodeUtil";
import {handleServerError} from "../main/main.js";
import {dialog} from "electron";
import fs from "fs";
import {addShutdown} from "./http-shutdown.js";
import forge from "node-forge";
import tls from 'node:tls';
import {LRUCache} from "./cache";

let rootCA;
let rootCAKey;
let rootCAString;
let rootCAKeyString;
const certCache = new LRUCache(20000, 1000 * 3600 * 240); // 20,000 entries, 10 day TTL

const SERVER_REQUEST_TIMEOUT_SEC = 600; // seconds

export function loadRootCA() {
    try {
        const caCertPath = getResourceFilePath('resources/rootCA.crt');
        const caKeyPath = getResourceFilePath('resources/rootCA.key');

        if (!fs.existsSync(caCertPath) || !fs.existsSync(caKeyPath)) {
            throw new Error('Root CA certificate or key file not found in resources directory. Please generate them first.');
        }

        rootCAString = fs.readFileSync(caCertPath, 'utf8');
        rootCAKeyString = fs.readFileSync(caKeyPath, 'utf8');
        rootCA = forge.pki.certificateFromPem(rootCAString);
        rootCAKey = forge.pki.privateKeyFromPem(rootCAKeyString);
        logInfo('Root CA loaded successfully.');
    } catch (e) {
        logError('Failed to load Root CA:', e);
        dialog.showErrorBox("Root CA Error", "Failed to load Root CA certificate/key. Please ensure 'resources/rootCA.crt' and 'resources/rootCA.key' exist and are valid.\nThe application may not function correctly for HTTPS proxying.\nError: " + e.message);
        // Allow app to continue but HTTPS proxying will fail for cert generation
        rootCA = null;
        rootCAKey = null;
    }
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

function generateServerCertificate(hostname) {
    const cached = certCache.get(hostname)
    if (cached) return cached;

    if (!rootCAKey || !rootCA) {
        logError('Root CA not loaded. Cannot generate certificate for', hostname);
        // This should ideally not happen if loadRootCA is called and checked
        throw new Error("Root CA not loaded, cannot issue certificate.");
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = generateSerialNumber();
    const now = new Date();
    cert.validity.notBefore = new Date(now.getTime());
    cert.validity.notBefore.setDate(now.getDate() - 20);
    cert.validity.notAfter = new Date(now.getTime());
    cert.validity.notAfter.setDate(now.getDate() + 20);

    const attrs = [{name: 'commonName', value: hostname}];
    cert.setSubject(attrs);
    cert.setIssuer(rootCA.subject.attributes);
    cert.setExtensions([
        {name: 'basicConstraints', cA: false},
        {
            name: 'keyUsage',
            keyCertSign: false,
            digitalSignature: true,
            nonRepudiation: false,
            keyEncipherment: true,
            dataEncipherment: true
        },
        {
            name: 'extKeyUsage',
            serverAuth: true,
            clientAuth: false,
            codeSigning: false,
            emailProtection: false,
            timeStamping: false
        },
        {name: 'subjectAltName', altNames: [{type: 2 /* DNS */, value: hostname}]}
    ]);

    cert.sign(rootCAKey, forge.md.sha256.create());

    const tlsCert = {
        key: forge.pki.privateKeyToPem(keys.privateKey),
        cert: forge.pki.certificateToPem(cert),
    };

    certCache.set(hostname, tlsCert);
    logInfo(`Generated certificate for ${hostname}`);
    return tlsCert;
}

const sNICallback = mainWindow => (servername, cb) => {
    try {
        const {key, cert} = generateServerCertificate(servername);
        const secureContext = tls.createSecureContext({key, cert});
        cb(null, secureContext);
    } catch (err) {
        logError(`Error in SNICallback for ${servername}:`, err);
        // cb(err); // This might crash the server, better to log and potentially use a default context or fail gracefully
        // To avoid crashing, don't call cb(err) directly if generateServerCertificate can throw.
        // It's better if generateServerCertificate returns a default/error cert or SNICallback handles this.
        // For now, let it fail if root CA is missing, as it's a fundamental issue.
        if (err.message.includes("Root CA not loaded")) {
            // A specific error that indicates a setup problem, might be good to inform user
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('proxy-status-update', {
                    error: `Cannot generate certificate for ${servername}: Root CA not loaded. Please ensure root CA is correctly set up.`
                });
            }
        }
        cb(err); // Let it fail for now.
    }
}


export const startServers = (mainWindow, currentConfig, profileIndexToActivate = -9) => {
    return new Promise((resolve, reject) => {
        let startedServers = 0;
        const httpPort = currentConfig.appPort[0];
        const httpsPort = currentConfig.appPort[1];
        const profile = currentConfig.profile[profileIndexToActivate];
        const httpServer = addShutdown(http.createServer());
        const httpsServer = addShutdown(https.createServer({
            key: rootCAKeyString,
            cert: rootCAString,
            ciphers: 'ALL:!LOW:!DSS:!EXP',
            SNICallback: sNICallback(mainWindow),
        }));
        httpServer.on('connect', (cliReq, cliSoc, cliHead) => {
            const url = new URL(`http://${cliReq.url}`);
            let port = url.port || '443';
            let hostname = url.hostname;
            logInfo(`[HTTP Proxy][${hostname}:${port}] CONNECT request received.`);
            if (profile !== null) {
                if (gethttpsFixedRule(profile)[`${hostname}:${port}`]) {
                    port = httpsPort;
                    hostname = 'localhost';
                } else if (inHostUsingProxy(profile, hostname) && !inHostBypassProxy(profile, hostname)) {
                    port = httpsPort;
                    hostname = 'localhost';
                }
            }
            const svrSoc = net
                .connect(port, hostname, () => {
                    cliSoc.write('HTTP/1.1 200 Connection Established\r\n' +
                        'Proxy-agent: Checkout-Proxy\r\n\r\n');
                    if (cliHead && cliHead.length > 0) svrSoc.write(cliHead);
                    svrSoc.pipe(cliSoc).on('error', err => {
                        logError(`[HTTP Proxy][${hostname}:${port}] Error piping serverSocket to clientSocket:${JSON.stringify(err)}`);
                        cliSoc.destroy(err);
                        svrSoc.destroy(err);
                    });
                    cliSoc.pipe(svrSoc).on('error', err => {
                        logError(`[HTTP Proxy][${hostname}:${port}] Error piping clientSocket to serverSocket:${JSON.stringify(err)}`);
                        cliSoc.destroy(err);
                        svrSoc.destroy(err);
                    });
                })
            svrSoc.on('error', (err) => {
                logError(`[HTTP Proxy][${hostname}:${port}] sever socket error occurred:${JSON.stringify(err)}`);
                if (cliSoc.writable && !cliSoc.destroyed) {
                    cliSoc.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\n` +
                        `sever socket error occurred in http proxy when accessing ${hostname}:${port}!\nerror:${JSON.stringify(err)}\r\n\r\n`);
                    cliSoc.end();
                }
                svrSoc.destroy();
            })
            svrSoc.on('close', () => cliSoc.destroy());
            cliSoc
                .on('error', (err) => {
                    if (err.code !== 'ECONNRESET') {
                        logError(`[HTTP Proxy][${hostname}:${port}] client to http proxy socket error occurred:${JSON.stringify(err)}`);
                    }
                    svrSoc.destroy(err);
                })
            cliSoc.on('close', () => svrSoc.destroy());
        });
        httpServer.on('request', (clientReq, clientRes) => {
            const {host, port, pathname, search} = new URL(clientReq.url);
            const path = pathname + search;
            let targetHost = host.split(':')[0];
            let targetPort = port || '80';
            logInfo(`[HTTP Proxy][${targetHost}:${targetPort}] request received.`);
            let httpOrHttps;
            let agentHost;
            let agentPort;
            const rule = gethttpFixedRule(profile);
            const originalHostPort = `${targetHost}:${targetPort}`
            const mapping = rule[originalHostPort];
            const isTargetHttps = mapping?.target?.startsWith('https:');
            httpOrHttps = isTargetHttps ? https : http;
            if (profile !== null) {
                if (mapping) {
                    const mapped = mapping?.target?.replace(/https?:\/\//, '');
                    targetPort = mapped?.split(':')[1] || (isTargetHttps ? '443' : '80');
                    targetHost = mapped?.split(':')[0];
                    if (!isLocalHost(targetHost) && mapping.customizedProxy) {
                        agentHost = mapping.customizedProxy.split(':')[0]
                        agentPort = mapping.customizedProxy.split(':')[1]
                    }
                } else if (!isLocalHost(targetHost) && inHostUsingProxy(profile, targetHost) && !inHostBypassProxy(profile, targetHost)) {
                    agentHost = getRemoteProxyHost(profile);
                    agentPort = getRemoteProxyPort(profile);
                }
            }

            const keepAlive = isKeepAlive(clientReq);
            const agent = agentHost ? new CustomHttpAgent(isTargetHttps ? 'https:' : 'http:', agentHost, agentPort || '80', {keepAlive}) : undefined
            const options = {
                hostname: targetHost,
                port: targetPort,
                method: clientReq.method,
                path,
                agent,
                headers: {...clientReq.headers},
                rejectUnauthorized: false
            };
            if (!mapping?.keepHostHeader) {
                options.headers.host = targetHost;
            }
            const proxyReq = httpOrHttps.request(options, (proxyRes) => {
                clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(clientRes);
            });
            proxyReq.setTimeout(SERVER_REQUEST_TIMEOUT_SEC * 1000);
            proxyReq.on('error', (err) => {
                if (!clientRes.headersSent) {
                    clientRes.writeHead(502, {'Content-Type': 'text/plain'});
                    clientRes.end(`http proxy request error!\nerror:${JSON.stringify(err)}`);
                }
                proxyReq.destroy();

            });
            proxyReq.on('timeout', () => {
                if (!clientRes.headersSent) {
                    clientRes.writeHead(504, {'Content-Type': 'text/plain'}); // Gateway Timeout
                    clientRes.end(`Http Proxy error: Timeout(${SERVER_REQUEST_TIMEOUT_SEC} sec) connecting to target`);
                }
                proxyReq.destroy();
            });
            clientReq.pipe(proxyReq).on('error', (err) => {
                // proxyReq might have already sent headers if error is on clientReq side after connection
                if (!clientRes.headersSent) {
                    clientRes.writeHead(500, {'Content-Type': 'text/plain'});
                    clientRes.end('Http Proxy error piping client request.');
                }
                clientReq.destroy(err);
            });
        });
        httpServer.on('clientError', (err, soc) => {
            logError(`[HTTP Proxy] clientError occurred:${JSON.stringify(err)}`);
            if (soc.writable && !soc.destroyed) {
                soc.end(`HTTP/1.1 400 http proxy clientError error occurred:${JSON.stringify(err)}\r\n\r\n`);
                soc.destroy();
            }
        })
        httpServer.on('error', (err) => handleServerError(err, 'HTTP', httpPort));
        httpServer.listen(httpPort, () => {
            logInfo(`HTTP Proxy server listening on localhost:${httpPort}`);
            startedServers++;
            if (startedServers === 2) {
                resolve({startedHttpServer: httpServer, startedHttpsServer: httpsServer});
            }
        });

        httpsServer.on('request', (clientReq, clientRes) => {
            const originalHost = clientReq.headers['host'];
            let targetHost = originalHost?.split(':')[0] || originalHost;
            let targetPort = originalHost?.split(':')[1] || '443';
            let httpOrHttps;
            let agentHost;
            let agentPort;
            const rule = gethttpsFixedRule(profile);
            const originalHostPort = `${targetHost}:${targetPort}`
            const mapping = rule[originalHostPort];
            const isTargetHttp = mapping?.target?.startsWith('http:');
            httpOrHttps = isTargetHttp ? http : https;
            if (profile !== null) {
                if (mapping) {
                    const mapped = mapping?.target?.replace(/https?:\/\//, '');
                    targetPort = mapped?.split(':')[1] || (isTargetHttp ? '80' : '443');
                    targetHost = mapped?.split(':')[0];
                    if (!isLocalHost(targetHost) && mapping.customizedProxy) {
                        agentHost = mapping.customizedProxy.split(':')[0]
                        agentPort = mapping.customizedProxy.split(':')[1]
                    }
                } else if (!isLocalHost(targetHost) && inHostUsingProxy(profile, targetHost) && !inHostBypassProxy(profile, targetHost)) {
                    agentHost = getRemoteProxyHost(profile);
                    agentPort = getRemoteProxyPort(profile);
                }
            }

            const requestOrigin = clientReq.headers.origin;
            if (mapping?.bypassCors) {
                if (clientReq.method === 'OPTIONS') {
                    const preflightHeaders = {
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
                        'Access-Control-Allow-Headers': clientReq.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma, Expires, X-CSRF-Token, Range, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since',
                        'Access-Control-Max-Age': '3600', // 1 hour
                    };
                    if (requestOrigin) {
                        preflightHeaders['Access-Control-Allow-Origin'] = requestOrigin;
                        preflightHeaders['Access-Control-Allow-Credentials'] = 'true';
                    } else {
                        preflightHeaders['Access-Control-Allow-Origin'] = '*';
                    }
                    clientRes.writeHead(204, preflightHeaders);
                    clientRes.end();
                    return;
                }
            }

            const keepAlive = isKeepAlive(clientReq);
            const agent = agentHost ? new CustomHttpAgent(isTargetHttp ? 'http:' : 'https:', agentHost, agentPort || '80', {keepAlive}) : undefined
            const options = {
                hostname: targetHost,
                port: targetPort,
                path: clientReq.url,
                method: clientReq.method,
                headers: {...clientReq.headers},
                agent,
                rejectUnauthorized: false
            };
            if (!mapping?.keepHostHeader) {
                options.headers.host = originalHost?.split(':')[1] ? `${targetHost}:${targetPort}` : targetHost;
            }
            const proxyReq = httpOrHttps.request(options, (proxyRes) => {
                const responseHeaders = {...proxyRes.headers};
                if (mapping?.bypassCors) {
                    if (requestOrigin) {
                        responseHeaders['Access-Control-Allow-Origin'] = requestOrigin;
                        responseHeaders['Access-Control-Allow-Credentials'] = 'true';
                        // When ACAO is dynamic, Vary: Origin is important for caching.
                        // It tells caches that the response varies based on the Origin header.
                        // Concatenate if Vary already exists.
                        responseHeaders['Vary'] = responseHeaders['Vary'] ? `${responseHeaders['Vary']}, Origin` : 'Origin';
                    } else {
                        responseHeaders['Access-Control-Allow-Origin'] = '*';
                        // If ACAO is '*', credentials cannot be allowed.
                        delete responseHeaders['Access-Control-Allow-Credentials'];
                    }
                    delete responseHeaders['content-security-policy'];
                    delete responseHeaders['x-frame-options'];
                }
                clientRes.writeHead(proxyRes.statusCode, responseHeaders);
                proxyRes.pipe(clientRes).on('error', (err) => {
                    logError(`[HTTPS Proxy][${targetHost}:${targetPort}] Error piping target response to http proxy: ${JSON.stringify(err)}`);
                    clientRes.destroy(err);
                });
            });
            proxyReq.setTimeout(SERVER_REQUEST_TIMEOUT_SEC * 1000);

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
                    clientRes.end(`Https proxy request error!\nerror:${JSON.stringify(err)}`);
                }
                proxyReq.destroy();
            });
            proxyReq.on('timeout', () => {
                if (!clientRes.headersSent) {
                    clientRes.writeHead(504, {'Content-Type': 'text/plain'}); // Gateway Timeout
                    clientRes.end(`Https Proxy error: Timeout(${SERVER_REQUEST_TIMEOUT_SEC} sec) connecting to target`);
                }
                proxyReq.destroy();
            });
            clientReq.pipe(proxyReq).on('error', (err) => {
                logError(`[HTTPS Proxy][${targetHost}:${targetPort}] Error piping http proxy request to target request: ${JSON.stringify(err)}`);
                // proxyReq might have already sent headers if error is on clientReq side after connection
                if (!clientRes.headersSent) {
                    clientRes.writeHead(500, {'Content-Type': 'text/plain'});
                    clientRes.end('Proxy error piping client request.');
                }
                clientReq.destroy(err);
            });
        });
        httpsServer.on('error', (err) => {
            handleServerError(err, 'HTTPS', httpsPort)
        });
        httpsServer.on('clientError', (err, soc) => {
            logError(`[HTTPS Proxy] clientError error occurred:${JSON.stringify(err)}`);
            if (soc.writable && !soc.destroyed) {
                soc.end(`HTTP/1.1 400 http proxy clientError error occurred:${JSON.stringify(err)}\r\n\r\n`);
                soc.destroy();
            }
        })
        httpsServer.listen(httpsPort, () => {
            logInfo(`Local HTTPS MITM server listening on localhost:${httpsPort}`);
            startedServers++;
            if (startedServers === 2) {
                resolve({startedHttpServer: httpServer, startedHttpsServer: httpsServer});
            }
        });
    });
}
