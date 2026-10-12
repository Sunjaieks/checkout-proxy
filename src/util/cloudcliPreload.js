import fs from 'node:fs';
import path from 'node:path';

// cloudcli (the AI Desktop server) opens every start with a synchronous
// `execSync('npm show @cloudcli-ai/cloudcli version')` update check. It freezes the server's event loop
// until the npm registry answers, so on a slow or filtered network the port is already listening yet
// nothing responds for far longer than AI Desktop waits. The preload below makes that one call fail at
// once (cloudcli ignores the failure) and takes itself out of NODE_OPTIONS again as soon as it loads,
// so the agents and terminals cloudcli starts later never inherit it.

export const CLOUDCLI_PRELOAD_FILE_NAME = 'cloudcli-preload.cjs';

// Carries the exact NODE_OPTIONS fragment to remove, so the preload also leaves any options the
// user's own shell profile added to NODE_OPTIONS in place.
export const CLOUDCLI_PRELOAD_FRAGMENT_ENV = 'CHECKOUT_PROXY_PRELOAD_FRAGMENT';

export const CLOUDCLI_PRELOAD_SOURCE = String.raw`'use strict';
try {
    const fragment = process.env.${CLOUDCLI_PRELOAD_FRAGMENT_ENV};
    delete process.env.${CLOUDCLI_PRELOAD_FRAGMENT_ENV};
    if (fragment && process.env.NODE_OPTIONS) {
        const remaining = process.env.NODE_OPTIONS.split(fragment).join('').trim();
        if (remaining) process.env.NODE_OPTIONS = remaining;
        else delete process.env.NODE_OPTIONS;
    }
    const childProcess = require('node:child_process');
    const execSync = childProcess.execSync;
    childProcess.execSync = function (command, ...rest) {
        if (typeof command === 'string' && /^\s*npm\s+show\s+@cloudcli-ai\/cloudcli(\s|$)/.test(command)) {
            throw new Error('cloudcli update check skipped by Checkout-Proxy');
        }
        return execSync.call(this, command, ...rest);
    };
} catch (ignored) {
    // A broken preload must never break the process it is loaded into.
}
`;

// NODE_OPTIONS reads a double-quoted value with backslash escapes, which also covers paths that
// contain spaces (macOS: ".../Application Support/...") and Windows backslashes.
export const quoteNodeOptionValue = (value) => `"${String(value).replace(/[\\"]/g, '\\$&')}"`;

const envNamesAreCaseInsensitive = () => process.platform === 'win32';

const findEnvKey = (env, name) =>
    envNamesAreCaseInsensitive() ? (Object.keys(env).find((key) => key.toUpperCase() === name) ?? name) : name;

let checkedPreloadPath = null;

const writeFileIfChanged = (filePath, content) => {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
};

/**
 * Make the Node process that `env` is spawned into load the cloudcli preload.
 */
export const installCloudCliPreload = (env, directory) => {
    const preloadPath = path.join(directory, CLOUDCLI_PRELOAD_FILE_NAME);
    // Node refuses to start when a --require file is missing, so a file deleted since the first check
    // (Clear App Cache) must be written again.
    if (checkedPreloadPath !== preloadPath || !fs.existsSync(preloadPath)) {
        writeFileIfChanged(preloadPath, CLOUDCLI_PRELOAD_SOURCE);
        checkedPreloadPath = preloadPath;
    }
    const fragment = `--require ${quoteNodeOptionValue(preloadPath)}`;
    const nodeOptionsKey = findEnvKey(env, 'NODE_OPTIONS');
    env[nodeOptionsKey] = env[nodeOptionsKey] ? `${env[nodeOptionsKey]} ${fragment}` : fragment;
    env[CLOUDCLI_PRELOAD_FRAGMENT_ENV] = fragment;
    return preloadPath;
};

export const removeCloudCliPreload = (directory) => {
    fs.rmSync(path.join(directory, CLOUDCLI_PRELOAD_FILE_NAME), { force: true });
};
