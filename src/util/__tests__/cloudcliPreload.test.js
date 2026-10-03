/**
 * Tests for the cloudcli preload that keeps cloudcli's startup `npm show` update check from
 * stalling the AI Desktop server. The preload is exercised in real Node processes started the way
 * AI Desktop starts cloudcli: through a NODE_OPTIONS `--require` whose path contains a space.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
    CLOUDCLI_PRELOAD_FILE_NAME,
    CLOUDCLI_PRELOAD_FRAGMENT_ENV,
    CLOUDCLI_PRELOAD_SOURCE,
    installCloudCliPreload,
    quoteNodeOptionValue,
    removeCloudCliPreload
} = require('../cloudcliPreload.js');

const PROBE_BODY = `
const attempt = (command) => {
    try {
        return { ok: EXEC(command, { encoding: 'utf8' }).trim() };
    } catch (e) {
        return { error: e.message };
    }
};
console.log(JSON.stringify({
    updateCheck: attempt('npm show @cloudcli-ai/cloudcli version'),
    otherNpmCall: attempt('npm show left-pad version'),
    lookAlikePackage: attempt('npm show @cloudcli-ai/cloudcli-extra version'),
    otherCommand: attempt('"' + process.execPath + '" -p 41+1'),
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    fragment: process.env.${CLOUDCLI_PRELOAD_FRAGMENT_ENV} ?? null,
    grandchildNodeOptions: attempt('"' + process.execPath + '" -p "process.env.NODE_OPTIONS||\\'\\'"')
}));
`;
const PROBES = {
    'an ES module (named import)': {
        file: 'probe.mjs',
        source: `import { execSync } from 'node:child_process';\n${PROBE_BODY.replace(/EXEC/g, 'execSync')}`
    },
    'a CommonJS script': {
        file: 'probe.cjs',
        source: `const { execSync } = require('node:child_process');\n${PROBE_BODY.replace(/EXEC/g, 'execSync')}`
    }
};

let directory;
const realPlatform = process.platform;
const setPlatform = (platform) => Object.defineProperty(process, 'platform', { value: platform });

beforeEach(() => {
    // Like macOS's ".../Application Support/...", the directory name contains a space.
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli preload '));
});

afterEach(() => {
    setPlatform(realPlatform);
    fs.rmSync(directory, { recursive: true, force: true });
});

// A stand-in `npm` that only echoes its arguments, so a probe can never reach the real registry.
const installFakeNpm = (env) => {
    const binDirectory = path.join(directory, 'fake-bin');
    fs.mkdirSync(binDirectory, { recursive: true });
    if (process.platform === 'win32') {
        fs.writeFileSync(path.join(binDirectory, 'npm.cmd'), '@echo fake-npm %*\r\n');
    } else {
        fs.writeFileSync(path.join(binDirectory, 'npm'), '#!/bin/sh\necho "fake-npm $*"\n', { mode: 0o755 });
    }
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    env[pathKey] = `${binDirectory}${path.delimiter}${env[pathKey] ?? ''}`;
};

const baseEnv = (extra = {}) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    installFakeNpm(env);
    return Object.assign(env, extra);
};

const runProbe = ({ file, source }, env, nodeArguments = []) => {
    const scriptPath = path.join(directory, file);
    fs.writeFileSync(scriptPath, source);
    const result = spawnSync(process.execPath, [...nodeArguments, scriptPath], { env, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
};

describe('quoteNodeOptionValue', () => {
    test('wraps the value in double quotes so a path with spaces stays one option value', () => {
        expect(quoteNodeOptionValue('/Users/me/Library/Application Support/app/x.cjs')).toBe(
            '"/Users/me/Library/Application Support/app/x.cjs"'
        );
    });

    test('escapes backslashes and double quotes', () => {
        expect(quoteNodeOptionValue('C:\\Users\\me\\a "b".cjs')).toBe('"C:\\\\Users\\\\me\\\\a \\"b\\".cjs"');
    });
});

describe('installCloudCliPreload', () => {
    test('writes the preload file and appends a --require to NODE_OPTIONS, keeping existing options', () => {
        const env = { NODE_OPTIONS: '--max-old-space-size=128' };

        const preloadPath = installCloudCliPreload(env, directory);

        expect(preloadPath).toBe(path.join(directory, CLOUDCLI_PRELOAD_FILE_NAME));
        expect(fs.readFileSync(preloadPath, 'utf8')).toBe(CLOUDCLI_PRELOAD_SOURCE);
        expect(env[CLOUDCLI_PRELOAD_FRAGMENT_ENV]).toBe(`--require ${quoteNodeOptionValue(preloadPath)}`);
        expect(env.NODE_OPTIONS).toBe(`--max-old-space-size=128 ${env[CLOUDCLI_PRELOAD_FRAGMENT_ENV]}`);
    });

    test('sets NODE_OPTIONS to just the --require when none existed', () => {
        const env = {};

        installCloudCliPreload(env, directory);

        expect(env.NODE_OPTIONS).toBe(env[CLOUDCLI_PRELOAD_FRAGMENT_ENV]);
    });

    test('replaces an outdated preload file', () => {
        const preloadPath = path.join(directory, CLOUDCLI_PRELOAD_FILE_NAME);
        fs.writeFileSync(preloadPath, 'outdated');

        installCloudCliPreload({}, directory);

        expect(fs.readFileSync(preloadPath, 'utf8')).toBe(CLOUDCLI_PRELOAD_SOURCE);
    });

    test('writes the file under its final name and leaves no temporary files', () => {
        installCloudCliPreload({}, directory);

        expect(fs.readdirSync(directory)).toEqual([CLOUDCLI_PRELOAD_FILE_NAME]);
    });

    test('checks the preload file once per run: a later start leaves it as it is', () => {
        const preloadPath = installCloudCliPreload({}, directory);
        fs.writeFileSync(preloadPath, 'edited after the first start');

        installCloudCliPreload({}, directory);

        expect(fs.readFileSync(preloadPath, 'utf8')).toBe('edited after the first start');
    });

    test('still sets the environment on every start, not only on the first', () => {
        installCloudCliPreload({}, directory);
        const env = { NODE_OPTIONS: '--max-old-space-size=128' };

        installCloudCliPreload(env, directory);

        expect(env[CLOUDCLI_PRELOAD_FRAGMENT_ENV]).toMatch(/^--require /);
        expect(env.NODE_OPTIONS).toBe(`--max-old-space-size=128 ${env[CLOUDCLI_PRELOAD_FRAGMENT_ENV]}`);
    });

    test('writes the preload file again when it has disappeared since the first start', () => {
        const preloadPath = installCloudCliPreload({}, directory);
        fs.rmSync(preloadPath);

        installCloudCliPreload({}, directory);

        expect(fs.readFileSync(preloadPath, 'utf8')).toBe(CLOUDCLI_PRELOAD_SOURCE);
    });

    test('on Windows reuses the NODE_OPTIONS key that already exists, whatever its case', () => {
        setPlatform('win32');
        const env = { Node_Options: '--max-old-space-size=128' };

        installCloudCliPreload(env, directory);

        expect(env.Node_Options).toContain('--max-old-space-size=128 --require');
        expect(env.NODE_OPTIONS).toBeUndefined();
    });

    test('elsewhere variable names are case-sensitive, so a differently-cased NODE_OPTIONS is left alone', () => {
        setPlatform('linux');
        const env = { Node_Options: '--max-old-space-size=128' };

        installCloudCliPreload(env, directory);

        expect(env.Node_Options).toBe('--max-old-space-size=128');
        expect(env.NODE_OPTIONS).toMatch(/^--require /);
    });

    test('throws and leaves the environment untouched when the preload file cannot be written', () => {
        const blocker = path.join(directory, 'blocker');
        fs.writeFileSync(blocker, 'a file where a directory is needed');
        const env = { NODE_OPTIONS: '--max-old-space-size=128' };

        expect(() => installCloudCliPreload(env, path.join(blocker, 'userData'))).toThrow();

        expect(env).toEqual({ NODE_OPTIONS: '--max-old-space-size=128' });
    });
});

describe('removeCloudCliPreload', () => {
    test('deletes the preload file', () => {
        const preloadPath = installCloudCliPreload({}, directory);

        removeCloudCliPreload(directory);

        expect(fs.existsSync(preloadPath)).toBe(false);
    });

    test('does nothing when there is no preload file', () => {
        expect(() => removeCloudCliPreload(directory)).not.toThrow();
    });

    test('leaves other files in the directory alone', () => {
        installCloudCliPreload({}, directory);
        fs.writeFileSync(path.join(directory, 'config.json'), '{}');

        removeCloudCliPreload(directory);

        expect(fs.readdirSync(directory)).toEqual(['config.json']);
    });

    test('a start after the removal writes the file again', () => {
        installCloudCliPreload({}, directory);
        removeCloudCliPreload(directory);

        const preloadPath = installCloudCliPreload({}, directory);

        expect(fs.readFileSync(preloadPath, 'utf8')).toBe(CLOUDCLI_PRELOAD_SOURCE);
    });
});

describe.each(Object.entries(PROBES))('the preload inside %s', (name, probe) => {
    test('makes the cloudcli update check fail at once, without running npm', () => {
        const env = baseEnv();
        installCloudCliPreload(env, directory);

        const report = runProbe(probe, env);

        expect(report.updateCheck).toEqual({ error: 'cloudcli update check skipped by Checkout-Proxy' });
    });

    test('leaves every other command alone', () => {
        const env = baseEnv();
        installCloudCliPreload(env, directory);

        expect(runProbe(probe, env).otherCommand).toEqual({ ok: '42' });
    });

    test('skips only the cloudcli update check: other npm calls, even for a look-alike package, still run', () => {
        const env = baseEnv();
        installCloudCliPreload(env, directory);

        const report = runProbe(probe, env);

        expect(report.otherNpmCall).toEqual({ ok: 'fake-npm show left-pad version' });
        expect(report.lookAlikePackage).toEqual({ ok: 'fake-npm show @cloudcli-ai/cloudcli-extra version' });
    });

    test('removes itself from NODE_OPTIONS so child processes do not inherit it, keeping the user options', () => {
        const env = baseEnv({ NODE_OPTIONS: '--max-old-space-size=128' });
        installCloudCliPreload(env, directory);

        const report = runProbe(probe, env);

        expect(report.nodeOptions).toBe('--max-old-space-size=128');
        expect(report.grandchildNodeOptions).toEqual({ ok: '--max-old-space-size=128' });
        expect(report.fragment).toBeNull();
    });

    test('leaves NODE_OPTIONS unset for children when it held nothing but the preload', () => {
        const env = baseEnv();
        installCloudCliPreload(env, directory);

        const report = runProbe(probe, env);

        expect(report.nodeOptions).toBeNull();
        expect(report.grandchildNodeOptions).toEqual({ ok: '' });
    });

    test('does not touch NODE_OPTIONS when it is loaded without a fragment to remove', () => {
        const env = baseEnv({ NODE_OPTIONS: '--max-old-space-size=128' });
        const preloadPath = path.join(directory, CLOUDCLI_PRELOAD_FILE_NAME);
        fs.writeFileSync(preloadPath, CLOUDCLI_PRELOAD_SOURCE);

        const report = runProbe(probe, env, ['--require', preloadPath]);

        expect(report.nodeOptions).toBe('--max-old-space-size=128');
        expect(report.updateCheck).toEqual({ error: 'cloudcli update check skipped by Checkout-Proxy' });
    });
});
