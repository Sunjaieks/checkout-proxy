/**
 * Trailer forwarding helpers
 * HTTP rules recap:
 * - HTTP trailers are only valid for HTTP/1.1+ with `Transfer-Encoding: chunked`.
 * - `Trailer` MUST NOT be used with `Content-Length`.
 */
import { safeDestroy } from '../util/nodeUtil';

/**
 * Pipe upstream response to downstream response and forward trailers (if enabled).
 * Uses `{ end:false }` so we can `addTrailers` before `end()`.
 */
export function pipeResponseAndMaybeAddTrailers(proxyRes, clientRes, logPrefix, logError) {
    let finished = false;
    const safeFinish = () => {
        if (finished) return;
        finished = true;
        try {
            const trailers = proxyRes?.trailers;
            if (trailers && Object.keys(trailers).length > 0) {
                clientRes.addTrailers(trailers);
            }
        } catch (e) {
            logError(`${logPrefix} AddTrailers failed: ${e?.code || ''} ${e?.message || e}`);
        }
        clientRes.end();
    };

    clientRes.once('close', () => {
        safeDestroy(proxyRes, null, logPrefix);
    });

    proxyRes.pipe(clientRes, { end: false });
    proxyRes.once('end', safeFinish);
    proxyRes.once('close', () => {
        if (finished) return;
        if (proxyRes?.aborted || proxyRes?.complete === false) {
            finished = true;
            safeDestroy(clientRes, null, logPrefix);
        }
    });
    proxyRes.once('error', (err) => {
        logError(`${logPrefix} Proxy response error: ${JSON.stringify(err)}`);
        if (finished) return;
        finished = true;
        safeDestroy(clientRes, err, logPrefix);
    });
    clientRes.once('error', (err) => {
        logError(`${logPrefix} Client response error: ${JSON.stringify(err)}`);
        if (finished) return;
        finished = true;
        safeDestroy(proxyRes, err, logPrefix);
    });
}
