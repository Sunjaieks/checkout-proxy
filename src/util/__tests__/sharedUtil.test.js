/**
 * Tests for the AI/MCP config helpers in sharedUtil, which read/validate the
 * `ai` field inside `globalSettings`. `ai` holds the MCP server settings
 * (`mcpEnabled`, `mcpPort`) plus the AI Desktop launcher settings (`guiCommand`,
 * `guiPort`).
 */

const {
    getMcpServerSettings,
    isMcpServerSettingsChanged,
    getAiGuiSettings,
    checkAiSettings,
    checkGlobalSettings,
    checkConfig,
    checkProfile
} = require('../sharedUtil.js');
const { MCP_DEFAULT_HOST } = require('../../constant/constant.js');

describe('checkProfile decorator', () => {
    test('accepts a missing decorator and any string (including UTF-8 icons)', () => {
        expect(() => checkProfile({ name: 'p' })).not.toThrow();
        expect(checkProfile({ name: 'p', decorator: '🔥' }).decorator).toBe('🔥');
        expect(() => checkProfile({ name: 'p', decorator: '' })).not.toThrow();
    });

    test('rejects a non-string decorator', () => {
        expect(() => checkProfile({ name: 'p', decorator: 123 })).toThrow(/decorator/);
        expect(() => checkProfile({ name: 'p', decorator: {} })).toThrow(/decorator/);
    });
});

describe('getMcpServerSettings (reads from globalSettings.ai)', () => {
    test('reads explicit mcpEnabled/mcpPort and always returns the loopback host', () => {
        expect(getMcpServerSettings({ globalSettings: { ai: { mcpEnabled: true, mcpPort: 9000 } } })).toEqual({
            enabled: true,
            port: 9000,
            host: MCP_DEFAULT_HOST
        });
    });

    test('defaults enabled to false unless mcpEnabled is explicitly true', () => {
        expect(getMcpServerSettings({ globalSettings: { ai: {} } }).enabled).toBe(false);
        expect(getMcpServerSettings({ globalSettings: { ai: { mcpEnabled: 'true' } } }).enabled).toBe(false);
        expect(getMcpServerSettings({ globalSettings: { ai: { mcpEnabled: false } } }).enabled).toBe(false);
        expect(getMcpServerSettings({ globalSettings: { ai: { mcpEnabled: true } } }).enabled).toBe(true);
    });

    test('falls back to disabled loopback defaults when globalSettings/ai is missing', () => {
        expect(getMcpServerSettings({}).enabled).toBe(false);
        expect(getMcpServerSettings(undefined)).toEqual({ enabled: false, port: undefined, host: MCP_DEFAULT_HOST });
        // The old `mcpServer` location is intentionally ignored now.
        expect(getMcpServerSettings({ globalSettings: { mcpServer: { enabled: true, port: 9000 } } }).enabled).toBe(
            false
        );
    });
});

describe('isMcpServerSettingsChanged (gates rebinding the MCP server)', () => {
    const base = { enabled: true, port: 18888, host: MCP_DEFAULT_HOST };

    test('reports no change for identical settings, so an unrelated save leaves the server alone', () => {
        expect(isMcpServerSettingsChanged(base, { ...base })).toBe(false);
    });

    test('a profile-only edit does not change the MCP settings derived from the config', () => {
        // What `manage_profile` does: the same globalSettings, a different profile array.
        const before = { globalSettings: { ai: { mcpEnabled: true, mcpPort: 18888 } }, profile: [{ name: 'a' }] };
        const after = { ...before, profile: [{ name: 'a' }, { name: 'b' }] };
        expect(isMcpServerSettingsChanged(getMcpServerSettings(before), getMcpServerSettings(after))).toBe(false);
    });

    test('reports a change when enabled, port or host differs', () => {
        expect(isMcpServerSettingsChanged(base, { ...base, enabled: false })).toBe(true);
        expect(isMcpServerSettingsChanged(base, { ...base, port: 18889 })).toBe(true);
        expect(isMcpServerSettingsChanged(base, { ...base, host: '0.0.0.0' })).toBe(true);
    });

    test('treats a never-configured server as changed so the first apply always binds', () => {
        expect(isMcpServerSettingsChanged(null, base)).toBe(true);
        expect(isMcpServerSettingsChanged(undefined, base)).toBe(true);
        expect(isMcpServerSettingsChanged(base, undefined)).toBe(true);
    });
});

describe('getAiGuiSettings (reads from globalSettings.ai)', () => {
    test('trims guiCommand (may carry an inline env prefix) and reads the integer guiPort', () => {
        expect(
            getAiGuiSettings({
                globalSettings: { ai: { guiCommand: '  SERVER_PORT=18887 cloudcli ', guiPort: 18887 } }
            })
        ).toEqual({ command: 'SERVER_PORT=18887 cloudcli', port: 18887 });
    });

    test('returns empty command and undefined port when ai is missing', () => {
        expect(getAiGuiSettings({})).toEqual({ command: '', port: undefined });
        expect(getAiGuiSettings(undefined)).toEqual({ command: '', port: undefined });
    });
});

describe('checkAiSettings', () => {
    test('accepts absence and well-formed objects', () => {
        expect(checkAiSettings(undefined)).toBeUndefined();
        expect(checkAiSettings(null)).toBeNull();
        expect(() =>
            checkAiSettings({ mcpEnabled: true, mcpPort: 18888, guiCommand: 'cloudcli', guiPort: 18887 })
        ).not.toThrow();
        expect(() => checkAiSettings({})).not.toThrow();
    });

    test('rejects malformed mcpEnabled/mcpPort', () => {
        expect(() => checkAiSettings({ mcpEnabled: 'yes' })).toThrow(/mcpEnabled/);
        expect(() => checkAiSettings({ mcpPort: 0 })).toThrow(/mcpPort/);
        expect(() => checkAiSettings({ mcpPort: 65536 })).toThrow(/mcpPort/);
        expect(() => checkAiSettings([])).toThrow(/Must be an object/);
    });

    test('rejects malformed guiCommand/guiPort', () => {
        expect(() => checkAiSettings({ guiCommand: 123 })).toThrow(/guiCommand/);
        expect(() => checkAiSettings({ guiPort: 0 })).toThrow(/guiPort/);
        expect(() => checkAiSettings({ guiPort: 70000 })).toThrow(/guiPort/);
        expect(() => checkAiSettings({ guiPort: 'x' })).toThrow(/guiPort/);
    });

    test('accepts empty guiCommand/guiPort (AI Desktop unconfigured by default)', () => {
        expect(() => checkAiSettings({ guiCommand: '', guiPort: '' })).not.toThrow();
    });
});

describe('checkGlobalSettings validates the nested ai', () => {
    test('throws on an invalid ai inside globalSettings', () => {
        expect(() => checkGlobalSettings({ ai: { mcpEnabled: 'nope' } })).toThrow(/mcpEnabled/);
        expect(() => checkGlobalSettings({ ai: { mcpPort: -1 } })).toThrow(/mcpPort/);
        expect(() => checkGlobalSettings({ ai: { guiPort: -1 } })).toThrow(/guiPort/);
    });

    test('accepts globalSettings with a valid ai', () => {
        expect(() =>
            checkGlobalSettings({ ai: { mcpEnabled: true, mcpPort: 12345, guiCommand: 'cloudcli', guiPort: 18887 } })
        ).not.toThrow();
        expect(() => checkGlobalSettings({})).not.toThrow();
    });
});

describe('checkConfig with ai under globalSettings', () => {
    const baseConfig = {
        appPort: [18881],
        profile: [{ name: 'p', proxy: {} }],
        globalSettings: { ai: { mcpEnabled: true, mcpPort: 18888, guiCommand: 'cloudcli', guiPort: 18887 } }
    };

    test('passes for a valid nested ai', () => {
        const out = checkConfig(JSON.stringify(baseConfig));
        expect(out.globalSettings.ai).toEqual({
            mcpEnabled: true,
            mcpPort: 18888,
            guiCommand: 'cloudcli',
            guiPort: 18887
        });
    });

    test('throws when the nested ai mcpPort is invalid', () => {
        const bad = { ...baseConfig, globalSettings: { ai: { mcpPort: 70000 } } };
        expect(() => checkConfig(JSON.stringify(bad))).toThrow(/mcpPort/);
    });
});
