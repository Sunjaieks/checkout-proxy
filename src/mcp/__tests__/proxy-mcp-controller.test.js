/**
 * Unit tests for the pure proxy MCP controller logic (no HTTP, no Electron).
 * Verifies tool definitions, argument handling, profile resolution, toBeDecided
 * defaulting, result formatting, call serialization and profile serialization.
 */

const {
    createProxyMcpController,
    TOOL_NAMES,
    parseToBeDecidedSpec,
    resolveProfileIndex,
    buildDecided,
    describeMode,
    toSerializableProfile,
    validateProfileBody,
    resolveInsertAnchor,
    describeHackFunctions,
    validateGlobalSettingsBody,
    EDITABLE_GLOBAL_SETTINGS_KEYS
} = require('../proxy-mcp-controller.js');
const DEFAULT_CONFIG = require('../../constant/default-config.json');

// Build a controller with mock proxy-control handlers and tracking of calls/state.
function makeHandlers(overrides = {}) {
    const calls = { start: [], stop: 0, saveProfile: [], saveGlobalSettings: [] };
    const globalSettingsStore = overrides.globalSettings || {
        ai: { mcpEnabled: true, mcpPort: 18888 },
        others: { recording: true },
        substitute: { host: 'a.example.com' },
        profileSet: { stgTool: { httpsFixedRule: {} } }
    };
    let state = { activeProfileIndex: -9, profileName: null, decided: {}, isRunning: false };
    const profiles = overrides.profiles || [
        { name: 'alpha' },
        { name: 'beta', toBeDecided: ['proxyPort=5801,5802'] },
        { name: 'gamma', toBeDecided: ['proxyPort=7001,7002', 'env=stg,prod'] }
    ];
    const handlers = {
        getProfiles: () => profiles,
        getState: () => state,
        getEffectiveProfile: overrides.getEffectiveProfile || (() => null),
        getConfiguration:
            'getConfiguration' in overrides
                ? overrides.getConfiguration
                : () => ({ configVersion: 1, profile: profiles }),
        getUsageGuide:
            'getUsageGuide' in overrides ? overrides.getUsageGuide : () => '# Checkout-Proxy User Guide\n\nGuide.',
        getHackFunctions:
            'getHackFunctions' in overrides
                ? overrides.getHackFunctions
                : () => ({
                      current: overrides.hackFunctions || DEFAULT_CONFIG.reusableHackFunctions,
                      factory: DEFAULT_CONFIG.reusableHackFunctions
                  }),
        start:
            overrides.start ||
            (async (index, toBeDecided) => {
                calls.start.push({ index, toBeDecided });
                state = {
                    activeProfileIndex: index,
                    profileName: index >= 0 ? (profiles[index]?.name ?? null) : null,
                    decided: toBeDecided,
                    isRunning: true
                };
                return { success: true };
            }),
        stop:
            overrides.stop ||
            (async () => {
                calls.stop += 1;
                state = { activeProfileIndex: -9, profileName: null, decided: {}, isRunning: false };
                return { success: true };
            }),
        // Mirrors the main process's `saveMcpConfigChange`: one atomic write covering the
        // profile mutation and/or a section-level globalSettings replace (`ai` preserved).
        saveProfile:
            'saveProfile' in overrides
                ? overrides.saveProfile
                : async ({ index, profileJson, asNew, globalSettingsJson }) => {
                      calls.saveProfile.push({ index, profileJson, asNew, globalSettingsJson });
                      if (asNew === null) profiles.splice(index, 1);
                      else if (asNew === true) profiles.splice(index + 1, 0, profileJson);
                      else if (asNew === false) profiles[index] = profileJson;
                      if (globalSettingsJson !== undefined && globalSettingsJson !== null) {
                          Object.entries(globalSettingsJson).forEach(([k, v]) => {
                              globalSettingsStore[k] = v;
                          });
                          return { success: true, globalSettings: JSON.parse(JSON.stringify(globalSettingsStore)) };
                      }
                      return { success: true };
                  }
    };
    return { handlers, calls, profiles, globalSettingsStore };
}

const newProfile = (name) => ({ name, proxy: { proxyUrl: 'http://p:1' } });
const namesOf = (profiles) => profiles.map((p) => p.name);

// Parse the JSON payload that the controller packs into the MCP text content.
function parsePayload(res) {
    expect(res).toHaveProperty('content');
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content[0].type).toBe('text');
    return JSON.parse(res.content[0].text);
}

describe('tool definitions', () => {
    test('exposes exactly the proxy tools in TOOL_NAMES, each with an object input schema', () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const names = controller.tools.map((t) => t.name).sort();
        expect(names).toEqual([...Object.values(TOOL_NAMES)].sort());
        controller.tools.forEach((tool) => {
            expect(typeof tool.description).toBe('string');
            expect(tool.description.length).toBeGreaterThan(10);
            expect(tool.inputSchema).toBeTruthy();
            expect(tool.inputSchema.type).toBe('object');
        });
    });

    test('manage_profile instructs the client to show the change and get confirmation first', () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const { description } = controller.tools.find((t) => t.name === TOOL_NAMES.MANAGE_PROFILE);
        expect(description).toMatch(/CONFIRMATION BEFORE CALLING THIS TOOL/);
        expect(description).toMatch(/diff of the stored profile/i);
        expect(description).toMatch(/no undo/i);
    });

    test('list_hack_functions is mandatory before using OR suggesting a hack entry', () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const { description } = controller.tools.find((t) => t.name === TOOL_NAMES.LIST_HACK_FUNCTIONS);
        expect(description).toMatch(/MUST CALL THIS TOOL BEFORE YOU USE OR EVEN SUGGEST/);
        expect(description).toMatch(/hackRequest/);
        // Also required when touching a profile whose existing rules already carry hacks.
        expect(description).toMatch(/edit or remove a profile that already contains one/);
        expect(description).toMatch(/doNotUse.*MUST NOT be used or suggested/s);
        // Hacks are the last resort, behind every other field of the profile.
        expect(description).toMatch(/prefer no hack at all/i);
        expect(description).toMatch(/"hackRequest" and "hackResponse" are the last resort/);
        expect(description).toMatch(/any other field of the profile/);
    });

    test('manage_profile names get_usage_guide and get_configuration as mandatory', () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const { description } = controller.tools.find((t) => t.name === TOOL_NAMES.MANAGE_PROFILE);
        expect(description).toMatch(/Two are MANDATORY/);
        expect(description).toMatch(/"get_usage_guide"/);
        expect(description).toMatch(/"get_configuration"/);
        expect(description).toMatch(/never\s+write a profile from memory/i);
    });

    test('manage_profile teaches when to edit a profile vs globalSettings', () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const tool = controller.tools.find((t) => t.name === TOOL_NAMES.MANAGE_PROFILE);
        // The action stays profile-only; globalSettings rides along as an optional field, so
        // one call can carry a profile change, a globalSettings change, or both.
        expect(tool.inputSchema.properties.action.enum).toEqual(['add', 'edit', 'remove']);
        expect(tool.inputSchema.required).toBeUndefined();
        expect(tool.inputSchema.properties).toHaveProperty('globalSettingsJson');
        expect(tool.description).toMatch(/ONE atomic save/);
        expect(tool.description).toMatch(/either or both/);
        expect(tool.description).toMatch(/WHICH PART DOES THE CHANGE BELONG IN/);
        expect(tool.description).toMatch(/affects only that profile/);
        expect(tool.description).toMatch(/SHARED ACROSS profiles/);
        // The scope limit and the replace-in-full semantics must both be stated.
        expect(tool.description).toMatch(/ONLY "others", "substitute" and "profileSet"/);
        expect(tool.description).toMatch(/never touch globalSettings\.ai/i);
        expect(tool.description).toMatch(/REPLACES the stored one entirely/);
    });

    test('manage_profile makes list_hack_functions conditional, not unconditional', () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const { description } = controller.tools.find((t) => t.name === TOOL_NAMES.MANAGE_PROFILE);
        // Required in both directions: existing hacks on the target, or hacks in what you write.
        expect(description).toMatch(/"list_hack_functions", is MANDATORY whenever hacks are involved/);
        expect(description).toMatch(/already contains hackRequest or hackResponse/);
        expect(description).toMatch(/about to write will contain them/);
        // ...and explicitly not required otherwise.
        expect(description).toMatch(/Otherwise it is not needed/);
    });

    test('manage_profile names hackRequest/hackResponse as the last resort behind every other field', () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const { description } = controller.tools.find((t) => t.name === TOOL_NAMES.MANAGE_PROFILE);
        expect(description).toMatch(/"hackRequest" AND "hackResponse" ARE THE LAST RESORT/);
        // The preference is stated over *any* other field, not just a shortlist.
        expect(description).toMatch(/ANY OTHER FIELD of the profile first/);
        expect(description).toMatch(/every field except "hackRequest" and "hackResponse"/);
        expect(description).toMatch(/ONLY when no other field can express what the user asked for/);
        // The shortlist survives only as examples.
        ['target', 'customizedProxy', 'keepHostHeader', 'bypassCors', 'proxyUrl', 'globalProfile'].forEach((field) =>
            expect(description).toContain(`"${field}"`)
        );
    });

    test('start_profile requires a "profile" argument', () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const startTool = controller.tools.find((t) => t.name === TOOL_NAMES.START_PROFILE);
        expect(startTool.inputSchema.required).toContain('profile');
    });
});

describe('start_profile', () => {
    test('resolves by name and defaults toBeDecided to the first option', async () => {
        const { handlers, calls } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 'beta' });
        expect(res.isError).toBeFalsy();
        expect(calls.start).toEqual([{ index: 1, toBeDecided: { proxyPort: '5801' } }]);
        const payload = parsePayload(res);
        expect(payload.ok).toBe(true);
        expect(payload.index).toBe(1);
        expect(payload.toBeDecided).toEqual({ proxyPort: '5801' });
        expect(payload.status.activeProfileIndex).toBe(1);
        expect(payload.status.mode).toBe('profile');
    });

    test('passes through explicitly provided toBeDecided values', async () => {
        const { handlers, calls } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.START_PROFILE, {
            profile: 'gamma',
            toBeDecided: { proxyPort: '7002', env: 'prod' }
        });
        expect(res.isError).toBeFalsy();
        expect(calls.start[0]).toEqual({ index: 2, toBeDecided: { proxyPort: '7002', env: 'prod' } });
    });

    test('resolves a numeric index and a numeric-string index', async () => {
        const { handlers, calls } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        await controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 0 });
        await controller.callTool(TOOL_NAMES.START_PROFILE, { profile: '0' });
        expect(calls.start[0].index).toBe(0);
        expect(calls.start[1].index).toBe(0);
    });

    test('returns isError and does not start when the profile is unknown', async () => {
        const { handlers, calls } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 'nope' });
        expect(res.isError).toBe(true);
        expect(calls.start).toHaveLength(0);
        expect(parsePayload(res).error).toMatch(/not found/i);
    });

    test('returns isError when the "profile" argument is missing', async () => {
        const { handlers, calls } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.START_PROFILE, {});
        expect(res.isError).toBe(true);
        expect(calls.start).toHaveLength(0);
    });

    test('reports failure (isError) when the start handler fails', async () => {
        const { handlers } = makeHandlers({ start: async () => ({ success: false, error: 'EADDRINUSE' }) });
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 'alpha' });
        expect(res.isError).toBe(true);
        const payload = parsePayload(res);
        expect(payload.ok).toBe(false);
        expect(payload.error).toMatch(/EADDRINUSE/);
    });

    test('warns (but still starts) when a provided value is not among the options', async () => {
        const { handlers, calls } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.START_PROFILE, {
            profile: 'beta',
            toBeDecided: { proxyPort: '9999' }
        });
        expect(res.isError).toBeFalsy();
        expect(calls.start[0]).toEqual({ index: 1, toBeDecided: { proxyPort: '9999' } });
        expect(parsePayload(res).warnings.join(' ')).toMatch(/not among suggested options/);
    });
});

describe('direct_connect / stop_proxy', () => {
    test('direct_connect starts profile index -1 with empty toBeDecided', async () => {
        const { handlers, calls } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.DIRECT_CONNECT, {});
        expect(res.isError).toBeFalsy();
        expect(calls.start[0]).toEqual({ index: -1, toBeDecided: {} });
        expect(parsePayload(res).status.mode).toBe('direct-connect');
    });

    test('stop_proxy calls the stop handler and reports stopped', async () => {
        const { handlers, calls } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        await controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 'alpha' });
        const res = await controller.callTool(TOOL_NAMES.STOP_PROXY, {});
        expect(res.isError).toBeFalsy();
        expect(calls.stop).toBe(1);
        expect(parsePayload(res).status.mode).toBe('stopped');
    });
});

describe('list_profiles', () => {
    test('lists every profile with its toBeDecided spec and active flag', async () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        await controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 'beta' });
        const res = await controller.callTool(TOOL_NAMES.LIST_PROFILES, {});
        const payload = parsePayload(res);
        expect(payload.profileCount).toBe(3);
        expect(payload.activeProfileIndex).toBe(1);
        expect(payload.profiles[0]).toMatchObject({ index: 0, name: 'alpha', active: false });
        expect(payload.profiles[1]).toMatchObject({ index: 1, name: 'beta', active: true });
        expect(payload.profiles[1].requiresToBeDecided).toEqual([{ name: 'proxyPort', options: ['5801', '5802'] }]);
    });
});

describe('get_effective_profile', () => {
    test('returns the effective profile while a profile is running', async () => {
        const effective = { name: 'beta', proxy: { proxyUrl: 'http://x:1' } };
        const { handlers } = makeHandlers({ getEffectiveProfile: () => effective });
        const controller = createProxyMcpController(handlers);
        await controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 'beta' });
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.GET_EFFECTIVE_PROFILE, {}));
        expect(payload.mode).toBe('profile');
        expect(payload.effectiveProfile).toEqual(effective);
    });

    test('returns no effective profile when stopped', async () => {
        const { handlers } = makeHandlers({ getEffectiveProfile: () => ({ should: 'not appear' }) });
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.GET_EFFECTIVE_PROFILE, {}));
        expect(payload.mode).toBe('stopped');
        expect(payload.effectiveProfile).toBeNull();
    });

    test('returns no effective profile in Direct Connect mode', async () => {
        const { handlers } = makeHandlers({ getEffectiveProfile: () => ({ should: 'not appear' }) });
        const controller = createProxyMcpController(handlers);
        await controller.callTool(TOOL_NAMES.DIRECT_CONNECT, {});
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.GET_EFFECTIVE_PROFILE, {}));
        expect(payload.mode).toBe('direct-connect');
        expect(payload.effectiveProfile).toBeNull();
    });
});

describe('get_configuration', () => {
    test('returns the whole configuration object from the handler', async () => {
        const config = { configVersion: 1, appPort: [18881], profile: [{ name: 'alpha' }] };
        const { handlers } = makeHandlers({ getConfiguration: () => config });
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.GET_CONFIGURATION, {});
        expect(res.isError).toBeFalsy();
        const payload = parsePayload(res);
        expect(payload.ok).toBe(true);
        expect(payload.configuration).toEqual(config);
    });

    test('returns isError when the configuration is unavailable', async () => {
        const { handlers } = makeHandlers({ getConfiguration: () => null });
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.GET_CONFIGURATION, {});
        expect(res.isError).toBe(true);
        expect(parsePayload(res).error).toMatch(/not available/i);
    });
});

describe('get_usage_guide', () => {
    test('returns the guide markdown verbatim as text content', async () => {
        const guide = '# Checkout-Proxy User Guide\n\nHow to configure...';
        const { handlers } = makeHandlers({ getUsageGuide: () => guide });
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.GET_USAGE_GUIDE, {});
        expect(res.isError).toBeFalsy();
        expect(res.content[0].type).toBe('text');
        expect(res.content[0].text).toBe(guide);
    });

    test('returns isError when the guide is unavailable or empty', async () => {
        const controller1 = createProxyMcpController(makeHandlers({ getUsageGuide: () => null }).handlers);
        expect((await controller1.callTool(TOOL_NAMES.GET_USAGE_GUIDE, {})).isError).toBe(true);
        const controller2 = createProxyMcpController(makeHandlers({ getUsageGuide: () => '   ' }).handlers);
        const res = await controller2.callTool(TOOL_NAMES.GET_USAGE_GUIDE, {});
        expect(res.isError).toBe(true);
        expect(parsePayload(res).error).toMatch(/not available/i);
    });
});

describe('dispatch & serialization', () => {
    test('an unknown tool name yields an isError result', async () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool('does_not_exist', {});
        expect(res.isError).toBe(true);
        expect(parsePayload(res).error).toMatch(/unknown tool/i);
    });

    test('serializes concurrent tool calls so operations never interleave', async () => {
        const events = [];
        const { handlers } = makeHandlers({
            start: async (index) => {
                events.push(`begin-${index}`);
                await new Promise((r) => setTimeout(r, 20));
                events.push(`end-${index}`);
                return { success: true };
            }
        });
        const controller = createProxyMcpController(handlers);
        await Promise.all([
            controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 0 }),
            controller.callTool(TOOL_NAMES.START_PROFILE, { profile: 1 })
        ]);
        expect(events).toEqual(['begin-0', 'end-0', 'begin-1', 'end-1']);
    });
});

describe('list_hack_functions', () => {
    const BUILT_INS = [
        'overwriteCookiesInResponseHeaders',
        'overwriteCookiesInRequestHeaders',
        'overwriteRuleForPath'
    ];

    test('lists the three shipped built-ins with the usage doc from default-config.json', async () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {}));
        expect(payload.ok).toBe(true);
        expect(payload.functions.map((f) => f.name).sort()).toEqual([...BUILT_INS].sort());
        payload.functions.forEach((f) => {
            expect(f.builtIn).toBe(true);
            // The doc lives in element [0] of each default-config entry.
            expect(f.usage).toBe(DEFAULT_CONFIG.reusableHackFunctions[f.name][0].trim());
            expect(f.usage).toMatch(/@param|@returns/);
            expect(f.definition).toBe(DEFAULT_CONFIG.reusableHackFunctions[f.name][1].trim());
        });
    });

    test('each built-in doc carries a ready-to-paste call example', async () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {}));
        payload.functions.forEach((f) => {
            expect(f.usage).toContain(`${f.name}(`);
        });
    });

    test('explains the hackRequest / hackResponse calling convention', async () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {}));
        expect(payload.callingConvention.hackRequest).toMatch(/before the request/i);
        expect(payload.callingConvention.hackResponse).toMatch(/after the target server responds/i);
    });

    test('marks a function whose usage comment was emptied as doNotUse, with no factory fallback', async () => {
        const { handlers } = makeHandlers({
            hackFunctions: {
                overwriteRuleForPath: ['', DEFAULT_CONFIG.reusableHackFunctions.overwriteRuleForPath[1]],
                overwriteCookiesInRequestHeaders: DEFAULT_CONFIG.reusableHackFunctions.overwriteCookiesInRequestHeaders
            }
        });
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {}));
        const emptied = payload.functions.find((f) => f.name === 'overwriteRuleForPath');
        expect(emptied.usage).toBeNull();
        expect(emptied.doNotUse).toBe(true);
        // The shipped documentation must NOT be substituted in. `@param` appears only in the
        // factory doc comment, never in the function body, so it is the marker to look for.
        expect(DEFAULT_CONFIG.reusableHackFunctions.overwriteRuleForPath[0]).toMatch(/@param/);
        expect(JSON.stringify(emptied)).not.toMatch(/@param/);
        expect(payload).not.toHaveProperty('functions.0.usageFromFactoryDefault');
        // The documented one stays usable and carries no doNotUse flag.
        const usable = payload.functions.find((f) => f.name === 'overwriteCookiesInRequestHeaders');
        expect(usable.doNotUse).toBeUndefined();
        expect(payload.doNotUseFunctions).toEqual(['overwriteRuleForPath']);
        expect(payload.usableFunctionCount).toBe(1);
        expect(payload.functionCount).toBe(2);
        expect(payload.rule).toMatch(/NEVER use or suggest/);
    });

    test('a bare-string entry has no usage, so it is flagged doNotUse', async () => {
        const { handlers } = makeHandlers({ hackFunctions: { bare: 'x=>y=>y' } });
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {}));
        expect(payload.functions[0]).toMatchObject({ name: 'bare', usage: null, doNotUse: true });
        expect(payload.doNotUseFunctions).toEqual(['bare']);
    });

    test('no entry ever reports usageFromFactoryDefault', async () => {
        const { handlers } = makeHandlers();
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {}));
        payload.functions.forEach((f) => expect(f).not.toHaveProperty('usageFromFactoryDefault'));
        expect(payload.doNotUseFunctions).toEqual([]);
        expect(payload.usableFunctionCount).toBe(payload.functionCount);
    });

    test('omits a built-in the user deleted, since it is no longer callable', async () => {
        const { handlers } = makeHandlers({
            hackFunctions: { overwriteRuleForPath: DEFAULT_CONFIG.reusableHackFunctions.overwriteRuleForPath }
        });
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {}));
        expect(payload.functions.map((f) => f.name)).toEqual(['overwriteRuleForPath']);
    });

    test('includes user-defined functions and flags them as not built-in', async () => {
        const { handlers } = makeHandlers({
            hackFunctions: { myOwn: ['/** mine */', 'x=>y=>y'] }
        });
        const controller = createProxyMcpController(handlers);
        const payload = parsePayload(await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {}));
        expect(payload.functions[0]).toMatchObject({ name: 'myOwn', builtIn: false, usage: '/** mine */' });
    });

    test('reports an empty library without erroring', async () => {
        const { handlers } = makeHandlers({ getHackFunctions: () => ({ current: {}, factory: {} }) });
        const controller = createProxyMcpController(handlers);
        const res = await controller.callTool(TOOL_NAMES.LIST_HACK_FUNCTIONS, {});
        expect(res.isError).toBeFalsy();
        const payload = parsePayload(res);
        expect(payload.functionCount).toBe(0);
        expect(payload.message).toMatch(/no reusable hack functions/i);
    });
});

describe('manage_profile', () => {
    describe('add', () => {
        test('appends at the end when no position is given', async () => {
            const { handlers, calls, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta')
            });
            expect(res.isError).toBeFalsy();
            expect(calls.saveProfile[0]).toMatchObject({ index: 2, asNew: true });
            expect(namesOf(profiles)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
            expect(parsePayload(res).index).toBe(3);
        });

        test('insertAfter places the profile immediately after the named neighbour', async () => {
            const { handlers, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta'),
                insertAfter: 'alpha'
            });
            expect(res.isError).toBeFalsy();
            expect(namesOf(profiles)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
            expect(parsePayload(res).index).toBe(1);
        });

        test('insertBefore places the profile immediately before the named neighbour', async () => {
            const { handlers, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta'),
                insertBefore: 'beta'
            });
            expect(res.isError).toBeFalsy();
            expect(namesOf(profiles)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
        });

        test('insertBefore the first profile puts it at the head of the list', async () => {
            const { handlers, calls, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta'),
                insertBefore: 'alpha'
            });
            expect(calls.saveProfile[0].index).toBe(-1); // splice(0, 0, profile)
            expect(namesOf(profiles)).toEqual(['delta', 'alpha', 'beta', 'gamma']);
        });

        test('an explicit index is the slot the profile occupies afterwards', async () => {
            const { handlers, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta'),
                index: 1
            });
            expect(namesOf(profiles)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
        });

        test('rejects more than one positioning argument', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta'),
                insertAfter: 'alpha',
                insertBefore: 'gamma'
            });
            expect(res.isError).toBe(true);
            expect(calls.saveProfile).toHaveLength(0);
            expect(parsePayload(res).error).toMatch(/at most one/i);
        });

        test('rejects an unknown neighbour and an out-of-range index', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const unknown = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta'),
                insertAfter: 'nope'
            });
            const oob = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta'),
                index: 99
            });
            expect(unknown.isError).toBe(true);
            expect(oob.isError).toBe(true);
            expect(calls.saveProfile).toHaveLength(0);
        });

        test('rejects the "profile" argument, which belongs to edit/remove', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profile: 'alpha',
                profileJson: newProfile('delta')
            });
            expect(res.isError).toBe(true);
            expect(calls.saveProfile).toHaveLength(0);
        });
    });

    describe('edit', () => {
        test('replaces the profile matched by name', async () => {
            const { handlers, calls, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const replacement = newProfile('beta-renamed');
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'edit',
                profile: 'beta',
                profileJson: replacement
            });
            expect(res.isError).toBeFalsy();
            expect(calls.saveProfile[0]).toEqual({ index: 1, profileJson: replacement, asNew: false });
            expect(namesOf(profiles)).toEqual(['alpha', 'beta-renamed', 'gamma']);
        });

        test('replaces the profile matched by zero-based index', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'edit',
                profile: 0,
                profileJson: newProfile('alpha2')
            });
            expect(calls.saveProfile[0].index).toBe(0);
        });

        test('rejects an unknown target without saving', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'edit',
                profile: 'nope',
                profileJson: newProfile('x')
            });
            expect(res.isError).toBe(true);
            expect(parsePayload(res).error).toMatch(/not found/i);
            expect(calls.saveProfile).toHaveLength(0);
        });

        test('rejects positioning arguments, which belong to add', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'edit',
                profile: 'beta',
                profileJson: newProfile('beta'),
                insertAfter: 'alpha'
            });
            expect(res.isError).toBe(true);
            expect(calls.saveProfile).toHaveLength(0);
        });

        test('surfaces a save failure as isError and leaves the list untouched', async () => {
            const { handlers, profiles } = makeHandlers({
                saveProfile: async () => ({ success: false, error: 'Invalid wildcard in profile "x".' })
            });
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'edit',
                profile: 'beta',
                profileJson: newProfile('beta')
            });
            expect(res.isError).toBe(true);
            expect(parsePayload(res).error).toMatch(/Invalid wildcard/);
            expect(namesOf(profiles)).toEqual(['alpha', 'beta', 'gamma']);
        });
    });

    describe('remove', () => {
        test('removes the first profile matching the name', async () => {
            const { handlers, calls, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, { action: 'remove', profile: 'beta' });
            expect(res.isError).toBeFalsy();
            expect(calls.saveProfile[0]).toMatchObject({ index: 1, asNew: null });
            expect(namesOf(profiles)).toEqual(['alpha', 'gamma']);
            expect(parsePayload(res).profile).toBe('beta');
        });

        test('removes by index and rejects a profileJson argument', async () => {
            const { handlers, calls, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const bad = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'remove',
                profile: 0,
                profileJson: newProfile('x')
            });
            expect(bad.isError).toBe(true);
            expect(calls.saveProfile).toHaveLength(0);
            await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, { action: 'remove', profile: 0 });
            expect(namesOf(profiles)).toEqual(['beta', 'gamma']);
        });

        test('requires the "profile" argument', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, { action: 'remove' });
            expect(res.isError).toBe(true);
            expect(calls.saveProfile).toHaveLength(0);
        });
    });

    describe('globalSettings via the optional globalSettingsJson', () => {
        const gsOnly = (controller, args) => controller.callTool(TOOL_NAMES.MANAGE_PROFILE, args);

        test('changes globalSettings alone when no action is given', async () => {
            const { handlers, calls, globalSettingsStore, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await gsOnly(controller, {
                globalSettingsJson: { substitute: { host: 'b.example.com', port: '9000' } }
            });
            expect(res.isError).toBeFalsy();
            expect(calls.saveProfile).toEqual([
                {
                    index: undefined,
                    profileJson: undefined,
                    asNew: undefined,
                    globalSettingsJson: { substitute: { host: 'b.example.com', port: '9000' } }
                }
            ]);
            expect(globalSettingsStore.substitute).toEqual({ host: 'b.example.com', port: '9000' });
            // untouched
            expect(globalSettingsStore.ai).toEqual({ mcpEnabled: true, mcpPort: 18888 });
            expect(globalSettingsStore.profileSet).toEqual({ stgTool: { httpsFixedRule: {} } });
            expect(namesOf(profiles)).toEqual(['alpha', 'beta', 'gamma']);
            const payload = parsePayload(res);
            expect(payload.action).toBeNull();
            expect(payload.updatedGlobalSettingsSections).toEqual(['substitute']);
        });

        test('changes a profile AND globalSettings in ONE call/one save', async () => {
            const { handlers, calls, globalSettingsStore, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const replacement = { name: 'beta', proxy: { globalProfile: ['sharedTool'] } };
            const res = await gsOnly(controller, {
                action: 'edit',
                profile: 'beta',
                profileJson: replacement,
                globalSettingsJson: { profileSet: { sharedTool: { httpsFixedRule: {} } } }
            });
            expect(res.isError).toBeFalsy();
            // exactly one save carrying both halves
            expect(calls.saveProfile).toHaveLength(1);
            expect(calls.saveProfile[0]).toEqual({
                index: 1,
                profileJson: replacement,
                asNew: false,
                globalSettingsJson: { profileSet: { sharedTool: { httpsFixedRule: {} } } }
            });
            expect(profiles[1]).toBe(replacement);
            expect(globalSettingsStore.profileSet).toEqual({ sharedTool: { httpsFixedRule: {} } });
            const payload = parsePayload(res);
            expect(payload.action).toBe('edit');
            expect(payload.updatedGlobalSettingsSections).toEqual(['profileSet']);
            expect(payload.message).toMatch(/Also replaced globalSettings/);
        });

        test('works with add and with remove too', async () => {
            const { handlers, calls, globalSettingsStore, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            await gsOnly(controller, {
                action: 'add',
                profileJson: newProfile('delta'),
                insertAfter: 'alpha',
                globalSettingsJson: { others: { recording: false } }
            });
            expect(namesOf(profiles)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
            expect(globalSettingsStore.others).toEqual({ recording: false });
            await gsOnly(controller, {
                action: 'remove',
                profile: 'delta',
                globalSettingsJson: { substitute: { z: '1' } }
            });
            expect(namesOf(profiles)).toEqual(['alpha', 'beta', 'gamma']);
            expect(globalSettingsStore.substitute).toEqual({ z: '1' });
            expect(calls.saveProfile).toHaveLength(2);
        });

        test('a profile-only call leaves globalSettings untouched and sends no sections', async () => {
            const { handlers, calls, globalSettingsStore } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await gsOnly(controller, {
                action: 'edit',
                profile: 'alpha',
                profileJson: newProfile('alpha')
            });
            expect(calls.saveProfile[0].globalSettingsJson).toBeUndefined();
            expect(globalSettingsStore.substitute).toEqual({ host: 'a.example.com' });
            expect(parsePayload(res).updatedGlobalSettingsSections).toBeUndefined();
            expect(parsePayload(res).message).toMatch(/globalSettings was left untouched/);
        });

        test.each([...EDITABLE_GLOBAL_SETTINGS_KEYS])('accepts the editable section "%s"', async (key) => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await gsOnly(controller, { globalSettingsJson: { [key]: { some: 'value' } } });
            expect(res.isError).toBeFalsy();
            expect(calls.saveProfile).toHaveLength(1);
        });

        test('refuses to touch globalSettings.ai, alone or smuggled alongside a legal section', async () => {
            const { handlers, calls, globalSettingsStore } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const alone = await gsOnly(controller, { globalSettingsJson: { ai: { mcpEnabled: false } } });
            expect(alone.isError).toBe(true);
            expect(parsePayload(alone).error).toMatch(/"ai" holds the MCP server and AI Desktop settings/);
            const smuggled = await gsOnly(controller, {
                action: 'edit',
                profile: 'alpha',
                profileJson: newProfile('alpha'),
                globalSettingsJson: { substitute: { a: '1' }, ai: { mcpPort: 1 } }
            });
            expect(smuggled.isError).toBe(true);
            // The whole call is rejected — the profile half must not slip through either.
            expect(calls.saveProfile).toHaveLength(0);
            expect(globalSettingsStore.ai).toEqual({ mcpEnabled: true, mcpPort: 18888 });
        });

        test.each(['reusableHackFunctions', 'appPort', 'configVersion', 'profile', 'globalSettings'])(
            'refuses the non-globalSettings key "%s"',
            async (key) => {
                const { handlers, calls } = makeHandlers();
                const controller = createProxyMcpController(handlers);
                const res = await gsOnly(controller, { globalSettingsJson: { [key]: {} } });
                expect(res.isError).toBe(true);
                expect(parsePayload(res).error).toContain(key);
                expect(calls.saveProfile).toHaveLength(0);
            }
        );

        test.each(['str', ['arr'], {}])('rejects an invalid globalSettingsJson: %p', async (body) => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await gsOnly(controller, { globalSettingsJson: body });
            expect(res.isError).toBe(true);
            expect(calls.saveProfile).toHaveLength(0);
        });

        test('rejects profile arguments supplied without an action', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            for (const stray of [{ profile: 'alpha' }, { profileJson: { name: 'x' } }, { insertAfter: 'alpha' }]) {
                const res = await gsOnly(controller, { globalSettingsJson: { others: {} }, ...stray });
                expect(res.isError).toBe(true);
                expect(parsePayload(res).error).toMatch(/need an "action"/);
            }
            expect(calls.saveProfile).toHaveLength(0);
        });

        test('rejects a call that asks for nothing at all', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const res = await gsOnly(controller, {});
            expect(res.isError).toBe(true);
            expect(parsePayload(res).error).toMatch(/Nothing to do/);
            expect(calls.saveProfile).toHaveLength(0);
        });

        test('surfaces a save failure without claiming success', async () => {
            const { handlers } = makeHandlers({
                saveProfile: async () => ({ success: false, error: 'Invalid wildcard in profileSet.' })
            });
            const controller = createProxyMcpController(handlers);
            const res = await gsOnly(controller, { globalSettingsJson: { profileSet: {} } });
            expect(res.isError).toBe(true);
            expect(parsePayload(res).error).toMatch(/Invalid wildcard in profileSet/);
        });

        test('reports unavailability when no save handler is wired up', async () => {
            const { handlers } = makeHandlers({ saveProfile: undefined });
            const controller = createProxyMcpController(handlers);
            const res = await gsOnly(controller, { globalSettingsJson: { others: {} } });
            expect(res.isError).toBe(true);
            expect(parsePayload(res).error).toMatch(/not available/i);
        });
    });

    describe('guards global configuration', () => {
        test.each(['globalSettings', 'reusableHackFunctions', 'appPort', 'configVersion', 'profile'])(
            'refuses a profileJson carrying the root key "%s"',
            async (key) => {
                const { handlers, calls } = makeHandlers();
                const controller = createProxyMcpController(handlers);
                const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                    action: 'add',
                    profileJson: { ...newProfile('delta'), [key]: { hacked: true } }
                });
                expect(res.isError).toBe(true);
                expect(parsePayload(res).error).toContain(key);
                expect(calls.saveProfile).toHaveLength(0);
            }
        );

        test('sends no globalSettings sections when the caller did not ask for any', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta')
            });
            expect(calls.saveProfile[0].globalSettingsJson).toBeUndefined();
        });

        test('allows a profile whose fixed rules call reusable hack functions', async () => {
            const { handlers, profiles } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const withHacks = {
                name: 'delta',
                proxy: {
                    httpsFixedRule: {
                        'a.com:443': { target: 'https://b.com', hackRequest: ['overwriteCookiesInRequestHeaders([])'] }
                    }
                }
            };
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: withHacks
            });
            expect(res.isError).toBeFalsy();
            expect(profiles[3]).toBe(withHacks);
        });
    });

    describe('argument validation', () => {
        test('rejects a missing or unknown action', async () => {
            const { handlers, calls } = makeHandlers();
            const controller = createProxyMcpController(handlers);
            const missing = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {});
            const unknown = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, { action: 'destroy' });
            expect(missing.isError).toBe(true);
            expect(unknown.isError).toBe(true);
            expect(calls.saveProfile).toHaveLength(0);
        });

        test.each([undefined, null, 'a string', ['an array'], { proxy: {} }, { name: '  ' }])(
            'rejects an invalid profileJson: %p',
            async (profileJson) => {
                const { handlers, calls } = makeHandlers();
                const controller = createProxyMcpController(handlers);
                const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, { action: 'add', profileJson });
                expect(res.isError).toBe(true);
                expect(calls.saveProfile).toHaveLength(0);
            }
        );

        test('reports unavailability when no saveProfile handler is wired up', async () => {
            const { handlers } = makeHandlers({ saveProfile: undefined });
            const controller = createProxyMcpController(handlers);
            const res = await controller.callTool(TOOL_NAMES.MANAGE_PROFILE, {
                action: 'add',
                profileJson: newProfile('delta')
            });
            expect(res.isError).toBe(true);
            expect(parsePayload(res).error).toMatch(/not available/i);
        });
    });
});

describe('pure helpers', () => {
    test('parseToBeDecidedSpec parses key=options entries', () => {
        expect(parseToBeDecidedSpec(['proxyPort=5801,5802', 'env=stg,prod'])).toEqual([
            { name: 'proxyPort', options: ['5801', '5802'] },
            { name: 'env', options: ['stg', 'prod'] }
        ]);
    });

    test('parseToBeDecidedSpec handles a bare key and trims, and tolerates non-arrays', () => {
        expect(parseToBeDecidedSpec([' lonely '])).toEqual([{ name: 'lonely', options: [] }]);
        expect(parseToBeDecidedSpec(undefined)).toEqual([]);
        expect(parseToBeDecidedSpec('nope')).toEqual([]);
    });

    test('resolveProfileIndex prefers name match, then numeric string, else null', () => {
        const profiles = [{ name: '2' }, { name: 'x' }, { name: 'y' }];
        expect(resolveProfileIndex(profiles, '2')).toBe(0); // name wins over index 2
        expect(resolveProfileIndex(profiles, 'x')).toBe(1);
        expect(resolveProfileIndex(profiles, '1')).toBe(1); // numeric string fallback
        expect(resolveProfileIndex(profiles, 1)).toBe(1);
        expect(resolveProfileIndex(profiles, 'missing')).toBeNull();
        expect(resolveProfileIndex(profiles, 9)).toBeNull();
        expect(resolveProfileIndex(profiles, -1)).toBeNull();
    });

    test('buildDecided defaults, stringifies, and warns appropriately', () => {
        const spec = [
            { name: 'proxyPort', options: ['5801', '5802'] },
            { name: 'env', options: ['stg', 'prod'] }
        ];
        expect(buildDecided(spec, {}).decided).toEqual({ proxyPort: '5801', env: 'stg' });
        expect(buildDecided(spec, { proxyPort: 5802, env: 'prod' }).decided).toEqual({
            proxyPort: '5802',
            env: 'prod'
        });
        expect(buildDecided(spec, { proxyPort: '9999' }).warnings.join(' ')).toMatch(/not among suggested options/);
        expect(buildDecided(spec, { bogus: 'x' }).warnings.join(' ')).toMatch(/bogus.*ignored/i);
    });

    test('validateGlobalSettingsBody allows only others/substitute/profileSet', () => {
        expect(EDITABLE_GLOBAL_SETTINGS_KEYS).toEqual(['others', 'substitute', 'profileSet']);
        expect(validateGlobalSettingsBody({ others: {}, substitute: {}, profileSet: {} })).toBeNull();
        expect(validateGlobalSettingsBody({ ai: {} })).toMatch(/ai/);
        expect(validateGlobalSettingsBody({ substitute: {}, appPort: [1] })).toMatch(/appPort/);
        expect(validateGlobalSettingsBody({})).toMatch(/empty/i);
        expect(validateGlobalSettingsBody(null)).toMatch(/must be an object/);
        expect(validateGlobalSettingsBody([{ others: {} }])).toMatch(/must be an object/);
        // A section itself has to be an object, not a scalar or array.
        expect(validateGlobalSettingsBody({ substitute: 'nope' })).toMatch(/must be an object; these are not/);
        expect(validateGlobalSettingsBody({ profileSet: ['nope'] })).toMatch(/must be an object; these are not/);
    });

    test('validateProfileBody accepts a profile and names the offending root key', () => {
        expect(validateProfileBody({ name: 'p', proxy: {} })).toBeNull();
        expect(validateProfileBody({ name: 'p', globalSettings: {} })).toMatch(/globalSettings/);
        expect(validateProfileBody({ name: 'p', reusableHackFunctions: {} })).toMatch(/reusableHackFunctions/);
        expect(validateProfileBody({ proxy: {} })).toMatch(/non-empty "name"/);
        expect(validateProfileBody([{ name: 'p' }])).toMatch(/must be a profile object/);
    });

    test('resolveInsertAnchor normalises every positioning form to an anchor', () => {
        const profiles = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
        expect(resolveInsertAnchor(profiles, {})).toEqual({ anchorIndex: 2, targetIndex: 3 });
        expect(resolveInsertAnchor(profiles, { insertAfter: 'a' })).toEqual({ anchorIndex: 0, targetIndex: 1 });
        expect(resolveInsertAnchor(profiles, { insertBefore: 'a' })).toEqual({ anchorIndex: -1, targetIndex: 0 });
        expect(resolveInsertAnchor(profiles, { index: 0 })).toEqual({ anchorIndex: -1, targetIndex: 0 });
        expect(resolveInsertAnchor(profiles, { index: 3 })).toEqual({ anchorIndex: 2, targetIndex: 3 });
        expect(resolveInsertAnchor([], {})).toEqual({ anchorIndex: -1, targetIndex: 0 });
        expect(resolveInsertAnchor(profiles, { index: 4 }).error).toMatch(/between 0 and 3/);
        expect(resolveInsertAnchor(profiles, { insertAfter: 'zzz' }).error).toMatch(/not found/i);
        expect(resolveInsertAnchor(profiles, { index: 0, insertAfter: 'a' }).error).toMatch(/at most one/i);
    });

    test('describeHackFunctions handles both entry shapes and tolerates junk', () => {
        const factory = { builtin: ['/** factory doc */', 'a=>b=>b'] };
        expect(describeHackFunctions({ builtin: ['/** mine */', 'x=>y=>y'] }, factory)[0]).toEqual({
            name: 'builtin',
            builtIn: true,
            usage: '/** mine */',
            definition: 'x=>y=>y'
        });
        // An emptied comment is never back-filled from the factory map — it means "unusable".
        expect(describeHackFunctions({ builtin: ['   ', 'x=>y=>y'] }, factory)[0]).toEqual({
            name: 'builtin',
            builtIn: true,
            usage: null,
            definition: 'x=>y=>y',
            doNotUse: true
        });
        // A bare string entry is a body with no documentation.
        expect(describeHackFunctions({ bare: 'x=>y=>y' }, {})[0]).toMatchObject({
            usage: null,
            doNotUse: true,
            definition: 'x=>y=>y',
            builtIn: false
        });
        // Entries without a body register nothing at runtime, so they are not listed.
        expect(describeHackFunctions({ empty: ['/** doc */', '  '], nulled: null }, {})).toEqual([]);
        expect(describeHackFunctions(undefined, undefined)).toEqual([]);
        expect(describeHackFunctions('nope', 'nope')).toEqual([]);
    });

    test('describeMode maps the active index convention', () => {
        expect(describeMode(-9)).toBe('stopped');
        expect(describeMode(-1)).toBe('direct-connect');
        expect(describeMode(0)).toBe('profile');
        expect(describeMode(5)).toBe('profile');
    });

    test('toSerializableProfile drops functions and surfaces raw hack source strings', () => {
        const prepared = {
            name: 'p',
            proxy: {
                httpsFixedRule: {
                    'a.com:443': {
                        target: 'https://b.com',
                        hackRequest: [function () {}],
                        hackResponse: [function () {}],
                        rawHackRequest: ['fnReq(1)'],
                        rawHackResponse: ['fnRes(2)']
                    }
                },
                httpFixedRule: {}
            }
        };
        const out = toSerializableProfile(prepared);
        const rule = out.proxy.httpsFixedRule['a.com:443'];
        expect(rule.hackRequest).toEqual(['fnReq(1)']);
        expect(rule.hackResponse).toEqual(['fnRes(2)']);
        expect(rule.rawHackRequest).toBeUndefined();
        expect(rule.rawHackResponse).toBeUndefined();
        expect(rule.target).toBe('https://b.com');
        expect(toSerializableProfile(null)).toBeNull();
    });
});
