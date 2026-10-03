/**
 * Proxy MCP controller — pure, transport-agnostic logic for the MCP tools that
 * let an AI client drive Checkout-Proxy. It owns:
 *   - the MCP tool definitions (name / description / JSON-Schema input),
 *   - `callTool(name, args)` which validates arguments and delegates to injected
 *     proxy-control handlers, then formats an MCP tool result,
 *   - profile-reference resolution and `toBeDecided` defaulting that mirror the
 *     app's UI behaviour,
 *   - serialization of tool calls so concurrent requests cannot interleave
 *     proxy start/stop operations.
 *
 * This module intentionally has NO dependency on Electron, Node `http`, or the
 * main process, so it can be unit-tested in isolation. The integration layer
 * (main process) supplies `handlers` that actually mutate/read proxy state.
 *
 * Active profile index convention (shared with the main process):
 *   -9 = nothing running, -1 = Direct Connect, >= 0 = profile at that index.
 */

export const TOOL_NAMES = Object.freeze({
    START_PROFILE: 'start_profile',
    STOP_PROXY: 'stop_proxy',
    DIRECT_CONNECT: 'direct_connect',
    LIST_PROFILES: 'list_profiles',
    GET_EFFECTIVE_PROFILE: 'get_effective_profile',
    GET_CONFIGURATION: 'get_configuration',
    GET_USAGE_GUIDE: 'get_usage_guide',
    MANAGE_PROFILE: 'manage_profile',
    LIST_HACK_FUNCTIONS: 'list_hack_functions'
});

const ACTIVE_INDEX_NONE = -9;
const ACTIVE_INDEX_DIRECT = -1;

export const PROFILE_ACTIONS = Object.freeze(['add', 'edit', 'remove']);

// The only `globalSettings` sections this tool may rewrite. `ai` is deliberately absent:
// it holds the MCP server's own enable flag/port and the AI Desktop launcher command, so
// letting a client edit it would let an AI switch off (or relocate) the very channel the
// user controls it through. Everything else under globalSettings is shared configuration
// the user legitimately wants an assistant to maintain.
export const EDITABLE_GLOBAL_SETTINGS_KEYS = Object.freeze(['others', 'substitute', 'profileSet']);

// Keys that belong to the configuration root, not to a single profile. A profile body
// carrying any of these is either the whole configuration passed by mistake or an attempt
// to reach global state through the wrong argument — both are rejected before anything is
// written. (globalSettings has its own argument; see `globalSettingsJson`.)
const NON_PROFILE_KEYS = Object.freeze([
    'globalSettings',
    'reusableHackFunctions',
    'appPort',
    'configVersion',
    'profile'
]);

const POSITION_KEYS = Object.freeze(['index', 'insertAfter', 'insertBefore']);

/**
 * Describe the running mode from the active profile index.
 */
export const describeMode = (activeProfileIndex) => {
    if (activeProfileIndex === ACTIVE_INDEX_DIRECT) return 'direct-connect';
    if (Number.isInteger(activeProfileIndex) && activeProfileIndex >= 0) return 'profile';
    return 'stopped';
};

/**
 * Parse a profile's `toBeDecided` array (e.g. ["proxyPort=5801,5802", "env=stg,prod"])
 * into a structured list of `{ name, options }`. Malformed entries are skipped.
 */
export const parseToBeDecidedSpec = (toBeDecided) => {
    if (!Array.isArray(toBeDecided)) return [];
    return toBeDecided.reduce((acc, item) => {
        if (typeof item !== 'string' || !item.trim()) return acc;
        const eq = item.indexOf('=');
        const name = (eq === -1 ? item : item.slice(0, eq)).trim();
        if (!name) return acc;
        const optionsStr = eq === -1 ? '' : item.slice(eq + 1);
        const options = optionsStr
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        acc.push({ name, options });
        return acc;
    }, []);
};

/**
 * Resolve a profile reference (exact name, or zero-based index as number or
 * numeric string) to a valid profile index, or `null` when not found.
 * Name matches take precedence over numeric-string indices.
 */
export const resolveProfileIndex = (profiles, profileRef) => {
    const list = Array.isArray(profiles) ? profiles : [];
    if (Number.isInteger(profileRef)) {
        return profileRef >= 0 && profileRef < list.length ? profileRef : null;
    }
    if (typeof profileRef === 'string') {
        const trimmed = profileRef.trim();
        if (!trimmed) return null;
        const byName = list.findIndex((p) => p && p.name === trimmed);
        if (byName >= 0) return byName;
        if (/^\d+$/.test(trimmed)) {
            const idx = Number.parseInt(trimmed, 10);
            return idx >= 0 && idx < list.length ? idx : null;
        }
    }
    return null;
};

/**
 * Read one `reusableHackFunctions` entry. An entry is either `[docComment, functionBody]`
 * — the shape the app's editor writes, where element 0 is reserved for the usage comment —
 * or a bare `functionBody` string with no documentation.
 */
const readHackEntry = (entry) => {
    if (Array.isArray(entry)) {
        const [doc, body] = entry;
        return {
            usage: typeof doc === 'string' ? doc.trim() : '',
            definition: typeof body === 'string' ? body.trim() : ''
        };
    }
    return { usage: '', definition: typeof entry === 'string' ? entry.trim() : '' };
};

/**
 * Describe the hack functions a profile can actually call, so an AI client can use them
 * without guessing at their signatures.
 *
 * Only functions present in the *live* configuration are listed — a built-in the user
 * deleted is not callable and must not be advertised. `factory` is the shipped
 * `default-config.json` map, used solely to mark which entries are built-ins.
 *
 * An entry whose usage comment is missing or empty is reported with `usage: null` and
 * `doNotUse: true`. Its documentation is its contract, so without one there is no way to
 * know what arguments it takes; it is surfaced (rather than hidden) only so a client can
 * see it exists and tell the user to document it.
 */
export const describeHackFunctions = (current, factory) => {
    const currentMap = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    const factoryMap = factory && typeof factory === 'object' && !Array.isArray(factory) ? factory : {};
    return Object.keys(currentMap).reduce((acc, name) => {
        if (!name || !name.trim()) return acc;
        const { usage, definition } = readHackEntry(currentMap[name]);
        if (!definition) return acc; // no body -> nothing is registered at runtime
        acc.push({
            name,
            builtIn: Object.prototype.hasOwnProperty.call(factoryMap, name),
            usage: usage || null,
            definition,
            ...(usage ? {} : { doNotUse: true })
        });
        return acc;
    }, []);
};

/**
 * Validate the profile body supplied to `manage_profile`. Returns an error message
 * string, or `null` when the body is shaped like a single profile. Deeper validation
 * (wildcards, toBeDecided limits, decorator type) is left to the app's own
 * `checkProfile`, which runs on the main-process side just as it does for the UI.
 */
export const validateProfileBody = (profileJson) => {
    if (!profileJson || typeof profileJson !== 'object' || Array.isArray(profileJson)) {
        return 'Argument "profileJson" must be a profile object, e.g. {"name":"my-profile","proxy":{ ... }}.';
    }
    const offending = NON_PROFILE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(profileJson, key));
    if (offending.length > 0) {
        return (
            `"profileJson" must contain only the fields of ONE profile, but it carries configuration-root key(s): ` +
            `${offending.join(', ')}. This tool edits the "profile" array only — it can never change globalSettings ` +
            'or reusableHackFunctions. Pass just the profile object (name, decorator, toBeDecided, substitute, proxy).'
        );
    }
    if (typeof profileJson.name !== 'string' || !profileJson.name.trim()) {
        return 'The profile object requires a non-empty "name".';
    }
    return null;
};

/**
 * Validate the `globalSettings` body supplied to `manage_profile`'s
 * `edit-global-settings` action. Returns an error message string, or `null` when the body
 * is an object made up only of editable sections.
 *
 * The body is a *partial* globalSettings: each section it carries replaces the stored one
 * wholesale, and sections it omits are left untouched. Deeper validation (fixed-rule
 * wildcards inside profileSet) is left to the app's own `checkGlobalSettings`, which runs
 * main-process side exactly as it does for the UI.
 */
export const validateGlobalSettingsBody = (globalSettingsJson) => {
    if (!globalSettingsJson || typeof globalSettingsJson !== 'object' || Array.isArray(globalSettingsJson)) {
        return (
            'Argument "globalSettingsJson" must be an object holding the globalSettings sections to replace, ' +
            'e.g. {"substitute":{ ... }} or {"profileSet":{ ... }}.'
        );
    }
    const keys = Object.keys(globalSettingsJson);
    if (keys.length === 0) {
        return `"globalSettingsJson" is empty. Include at least one of: ${EDITABLE_GLOBAL_SETTINGS_KEYS.join(', ')}.`;
    }
    const forbidden = keys.filter((key) => !EDITABLE_GLOBAL_SETTINGS_KEYS.includes(key));
    if (forbidden.length > 0) {
        const mentionsAi = forbidden.includes('ai');
        return (
            `"globalSettingsJson" may only contain ${EDITABLE_GLOBAL_SETTINGS_KEYS.join(', ')}, but it carries: ` +
            `${forbidden.join(', ')}. ` +
            (mentionsAi
                ? '"ai" holds the MCP server and AI Desktop settings and can never be changed through this tool — ' +
                  'propose the JSON and ask the user to apply it in [Edit Config]->[global settings]->[AI]. '
                : '') +
            'Pass only the sections you intend to replace; anything else must be edited by the user in [Edit Config].'
        );
    }
    const notAnObject = keys.filter((key) => {
        const section = globalSettingsJson[key];
        return !section || typeof section !== 'object' || Array.isArray(section);
    });
    if (notAnObject.length > 0) {
        return `Each globalSettings section must be an object; these are not: ${notAnObject.join(', ')}.`;
    }
    return null;
};

/**
 * Work out where an `add` lands. The underlying save operation inserts at
 * `anchorIndex + 1`, so every positioning form is normalised to that anchor:
 *   - `index`        — the zero-based slot the new profile should occupy
 *   - `insertAfter`  — name/index of the profile that should precede it
 *   - `insertBefore` — name/index of the profile that should follow it
 *   - none of them   — append to the end of the list
 * Returns `{ anchorIndex, targetIndex }`, or `{ error }` when the request is ambiguous
 * or the referenced neighbour does not exist.
 */
export const resolveInsertAnchor = (profiles, args = {}) => {
    const list = Array.isArray(profiles) ? profiles : [];
    const given = POSITION_KEYS.filter((key) => args[key] !== undefined && args[key] !== null && args[key] !== '');
    if (given.length > 1) {
        return { error: `Provide at most one of "index", "insertAfter", "insertBefore" (got: ${given.join(', ')}).` };
    }
    if (given.length === 0) {
        return { anchorIndex: list.length - 1, targetIndex: list.length };
    }
    if (given[0] === 'index') {
        const { index } = args;
        if (!Number.isInteger(index) || index < 0 || index > list.length) {
            return {
                error: `"index" must be an integer between 0 and ${list.length} — the position the new profile occupies after insertion.`
            };
        }
        return { anchorIndex: index - 1, targetIndex: index };
    }
    const ref = args[given[0]];
    const neighbour = resolveProfileIndex(list, ref);
    if (neighbour === null) {
        return {
            error: `Profile not found for "${given[0]}": ${JSON.stringify(ref)}. Call "list_profiles" to see available names and indices.`
        };
    }
    return given[0] === 'insertAfter'
        ? { anchorIndex: neighbour, targetIndex: neighbour + 1 }
        : { anchorIndex: neighbour - 1, targetIndex: neighbour };
};

/**
 * Build the effective `toBeDecided` value map for starting a profile, mirroring
 * the UI: provided values win; omitted placeholders default to their first
 * suggested option (or empty string). Returns the value map plus human-readable
 * warnings about defaulting / unknown keys / off-list values.
 */
export const buildDecided = (spec, provided) => {
    const decided = {};
    const warnings = [];
    const providedObj = provided && typeof provided === 'object' && !Array.isArray(provided) ? provided : {};
    spec.forEach(({ name, options }) => {
        if (Object.prototype.hasOwnProperty.call(providedObj, name) && providedObj[name] != null) {
            decided[name] = String(providedObj[name]);
            if (options.length > 0 && !options.includes(decided[name])) {
                warnings.push(
                    `Value "${decided[name]}" for "${name}" is not among suggested options [${options.join(', ')}]; using it anyway.`
                );
            }
        } else {
            decided[name] = options.length > 0 ? options[0] : '';
            if (options.length > 0) {
                warnings.push(`"${name}" not provided; defaulting to first option "${options[0]}".`);
            } else {
                warnings.push(`"${name}" not provided and has no suggested options; defaulting to empty string.`);
            }
        }
    });
    Object.keys(providedObj).forEach((key) => {
        if (!spec.find((s) => s.name === key)) {
            warnings.push(`Provided toBeDecided key "${key}" is not used by this profile and was ignored.`);
        }
    });
    return { decided, warnings };
};

/**
 * Produce a JSON-serializable copy of a prepared/effective profile. The prepared
 * profile carries instantiated hack functions (non-serializable); we drop those
 * and surface the original hack source strings (kept by the main process as
 * `rawHackRequest` / `rawHackResponse`) under `hackRequest` / `hackResponse`.
 */
export const toSerializableProfile = (profile) => {
    if (!profile || typeof profile !== 'object') return null;
    const clone = JSON.parse(
        JSON.stringify(profile, (key, value) => (typeof value === 'function' ? undefined : value))
    );
    const restoreRawHacks = (rules) => {
        if (!rules || typeof rules !== 'object') return;
        Object.values(rules).forEach((rule) => {
            if (!rule || typeof rule !== 'object') return;
            if ('rawHackRequest' in rule) {
                rule.hackRequest = rule.rawHackRequest;
                delete rule.rawHackRequest;
            }
            if ('rawHackResponse' in rule) {
                rule.hackResponse = rule.rawHackResponse;
                delete rule.rawHackResponse;
            }
        });
    };
    restoreRawHacks(clone && clone.proxy && clone.proxy.httpFixedRule);
    restoreRawHacks(clone && clone.proxy && clone.proxy.httpsFixedRule);
    return clone;
};

const buildToolDefinitions = () => [
    {
        name: TOOL_NAMES.START_PROFILE,
        description:
            'Start a Checkout-Proxy profile by name or index — the same effect as a user clicking "Start" on a ' +
            'profile in the app. If the profile defines "toBeDecided" placeholders, supply their chosen values via ' +
            'the "toBeDecided" object (e.g. {"proxyPort":"5801"}); any omitted placeholder defaults to its first ' +
            'suggested option. The suggested options reported by "list_profiles" are hints, not a restrictive enum ' +
            '— if the user names a value that is not among them, do NOT stop and ask the user to confirm; call this ' +
            'tool with that value exactly as given. The profile still starts and the result carries a warning ' +
            'noting the value fell outside the suggested list — relay that warning to the user AFTER starting, ' +
            'as a heads-up rather than a gate. Starting a profile stops any currently running proxy first. Use ' +
            '"list_profiles" to discover profile names and their required placeholders.',
        inputSchema: {
            type: 'object',
            properties: {
                profile: {
                    description:
                        'The profile to start: either its exact name (string) or its zero-based index (integer).',
                    type: ['string', 'integer']
                },
                toBeDecided: {
                    description:
                        'Optional map of placeholder name to chosen value for this profile\'s "toBeDecided" fields, ' +
                        'e.g. {"proxyPort":"5801"}. Any string is accepted, including one outside the suggested ' +
                        'options "list_profiles" reports — pass the user\'s value straight through without asking ' +
                        'for confirmation first; the tool call still succeeds and reports a warning you can relay ' +
                        'afterward.',
                    type: 'object',
                    additionalProperties: { type: 'string' }
                }
            },
            required: ['profile'],
            additionalProperties: false
        }
    },
    {
        name: TOOL_NAMES.STOP_PROXY,
        description:
            'Stop all running Checkout-Proxy servers — the same effect as clicking "Stop" in the app. Safe to call ' +
            'even when nothing is running.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
        name: TOOL_NAMES.DIRECT_CONNECT,
        description:
            'Start the proxy in "Direct Connect" mode: it runs with no fixed routing rules and no upstream proxy, ' +
            'tunneling traffic directly to its destination. The same effect as clicking "Direct Connect" in the app.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
        name: TOOL_NAMES.LIST_PROFILES,
        description:
            'List all available proxy profiles (index, name, and any required "toBeDecided" placeholders with their ' +
            'suggested options) and report which profile, if any, is currently running.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
        name: TOOL_NAMES.GET_EFFECTIVE_PROFILE,
        description:
            'Return the effective (fully-resolved) profile of the currently running proxy — with placeholders ' +
            'substituted and global profiles merged — along with the current run status. Returns no effective ' +
            'profile when the proxy is stopped or in Direct Connect mode.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
        name: TOOL_NAMES.GET_CONFIGURATION,
        description:
            'Return the entire current Checkout-Proxy configuration as JSON — every profile plus globalSettings ' +
            '(profileSet, substitute, others, ai), reusableHackFunctions, appPort and configVersion — exactly as ' +
            "stored on disk, with placeholders NOT substituted. Use this to read the user's existing setup before " +
            'editing it, to answer questions about how it is configured, or as the starting point for proposing ' +
            'configuration changes. For the resolved (placeholder-substituted, global-profile-merged) profile of the ' +
            'running proxy, use "get_effective_profile" instead.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
        name: TOOL_NAMES.GET_USAGE_GUIDE,
        description:
            'Return the full Checkout-Proxy user guide (the README) as Markdown: how the configuration JSON is ' +
            'structured and what every field means, profiles, global profiles / profileSet, placeholders ' +
            '(toBeDecided / substitute), fixed rules, wildcard matching, hack functions, the MCP tools, and Tips for ' +
            'designing profiles. Read this FIRST whenever the user asks how to configure Checkout-Proxy, what a field ' +
            "does, or how to design a profile, so your guidance and any configuration you produce follow the app's " +
            'rules. Pair it with "get_configuration" to inspect the user\'s current setup.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
        name: TOOL_NAMES.MANAGE_PROFILE,
        description:
            'Write to the user\'s configuration in ONE atomic save: a single proxy profile (via "action") and/or the ' +
            'shared globalSettings sections (via "globalSettingsJson"). Both parameters are independent, so one call ' +
            'can do either or both: (a) profile only — "action" plus its profile arguments; (b) globalSettings only ' +
            '— "globalSettingsJson" and NO "action"; (c) both together — "action" plus "globalSettingsJson", which ' +
            'is the right shape for "define a shared rule set and make this profile use it": it applies as one write ' +
            '(all or nothing) and stops/restarts the proxy once instead of twice. WHICH PART DOES THE CHANGE BELONG ' +
            'IN? Put it in the PROFILE when it affects only that profile: its proxyUrl, its own ' +
            'hostUsingProxy/hostBypassProxy, its own httpFixedRule/httpsFixedRule entries, which global profiles it ' +
            'pulls in via proxy.globalProfile, its toBeDecided placeholders, its own substitute, its name/decorator. ' +
            'Put it in globalSettings when it is SHARED ACROSS profiles: a named rule set under "profileSet" that ' +
            'several profiles reference by name, a "substitute" value many profiles interpolate, or an app-wide ' +
            'toggle under "others" (addAgentHeader, recording). Rule of thumb: "for this profile" means the profile; ' +
            '"everywhere", "for all profiles", "globally", or a value already referenced from more than one profile ' +
            'means globalSettings. When a shared rule is duplicated across profiles, prefer moving it into ' +
            'profileSet over copying it again. GLOBAL SETTINGS SCOPE. "globalSettingsJson" may carry ONLY "others", ' +
            '"substitute" and "profileSet". This tool can NEVER touch globalSettings.ai (the MCP server enable ' +
            'flag/port and the AI Desktop command), reusableHackFunctions, appPort or configVersion — for those, ' +
            'propose the JSON and ask the user to apply it in [Edit Config]. Each section you send REPLACES the ' +
            'stored one entirely; sections you omit are left untouched. So to add one key to "substitute", send the ' +
            'existing substitute object from "get_configuration" plus your new key — sending only the new key ' +
            'deletes the rest. PROTOCOL IS MANDATORY, PORT IS NOT. Every URL-valued field ("proxyUrl", a fixed ' +
            'rule\'s "target" / "customizedProxy") MUST carry an explicit scheme — "https://new.example.com"; a ' +
            'missing port is fine and defaults (80 for http, 443 for https, 1080 for socks). If the user names a ' +
            'domain without saying http, https, or (for an upstream proxy only) a SOCKS variant, STOP and ASK THEM ' +
            'before calling this tool — do not guess. The scheme also decides which fixed-rule bucket a domain ' +
            'belongs in: "httpFixedRule" for http, "httpsFixedRule" for https. PREREQUISITE CALLS. Two are MANDATORY ' +
            'before every call to this tool: (1) "get_usage_guide" — it defines what every profile field means and ' +
            'the design conventions your profile must follow, so never write a profile from memory; (2) ' +
            '"get_configuration" — the profiles as actually stored, so you edit the real thing instead of an assumed ' +
            'one. A third, "list_hack_functions", is MANDATORY whenever hacks are involved at all: either the ' +
            'profile you are editing/removing already contains hackRequest or hackResponse, or the profile you are ' +
            'about to write will contain them. Otherwise it is not needed. "hackRequest" AND "hackResponse" ARE THE ' +
            'LAST RESORT. They can run arbitrary JavaScript against the user\'s live traffic. Satisfy the ' +
            'requirement with ANY OTHER FIELD of the profile first — every field except "hackRequest" and ' +
            '"hackResponse" is fair game (the rule key itself, "target", "customizedProxy", "keepHostHeader", ' +
            '"bypassCors", "proxyUrl", "hostUsingProxy", "hostBypassProxy", "globalProfile", "substitute", ' +
            '"toBeDecided", ...). Add "hackRequest" or "hackResponse" ONLY when no other field can express what the ' +
            'user asked for, and say plainly why the other fields fell short. action="edit" REPLACES the whole ' +
            'target profile, so send the complete profile object (start from the existing one and apply your ' +
            'changes) — omitted fields are dropped. action="add" inserts a new profile; position it with exactly one ' +
            'of "index", "insertAfter" or "insertBefore", or omit all three to append at the end. action="remove" ' +
            'deletes the target profile permanently — confirm with the user first. Omitting "action" entirely means ' +
            '"change only globalSettings"; the profile arguments must then be omitted too. Every save stops the ' +
            'running proxy. It is restarted afterwards when the change allows it: editing a profile other than the ' +
            'running one, or changing globalSettings without an "add"/"remove", restarts the running profile; ' +
            'editing the running profile itself restarts it only when its placeholder values still fit the new ' +
            'toBeDecided. "add" and "remove" always leave the proxy stopped (profile indices shift), even when ' +
            'combined with a globalSettings change — call "start_profile" afterwards if the user wants it running. ' +
            'ALWAYS GET THE USER\'S EXPLICIT CONFIRMATION BEFORE CALLING THIS TOOL — it writes to their ' +
            'configuration file and there is no undo. YOU MUST SHOW THEM WHAT WILL CHANGE FIRST: for "edit" a diff ' +
            'of the stored profile against your new one, for "add" the complete new profile JSON and where it will ' +
            'be inserted, for "remove" the name and JSON of the profile about to be deleted, and for any ' +
            '"globalSettingsJson" a diff of each stored section against your replacement. When a call does both, ' +
            'show both halves. Wait for the user to approve, then call. A globalSettings change deserves extra care: ' +
            'profileSet and substitute are shared, so one change can alter the routing of EVERY profile that ' +
            'references them — say which profiles are affected.',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    description:
                        'What to do with a profile: "add" a new one, "edit" (fully replace) an existing one, or ' +
                        '"remove" one. Omit it entirely when the call changes only globalSettings.',
                    type: 'string',
                    enum: [...PROFILE_ACTIONS]
                },
                profile: {
                    description:
                        'For "edit" and "remove": the profile to target, either its exact name (string, first match ' +
                        'wins) or its zero-based index (integer). Not used by "add".',
                    type: ['string', 'integer']
                },
                profileJson: {
                    description:
                        'For "add" and "edit": the complete profile object — {"name": "...", "decorator"?, ' +
                        '"toBeDecided"?, "substitute"?, "proxy": { ... }}. Must NOT contain globalSettings, ' +
                        'reusableHackFunctions, appPort, configVersion or profile. Every URL inside "proxy" ' +
                        '("proxyUrl", a fixed rule\'s "target"/"customizedProxy") MUST include an explicit scheme ' +
                        '(http/https, or SOCKS for an upstream proxy). Ask the user if they have not clarified.',
                    type: 'object'
                },
                globalSettingsJson: {
                    description:
                        'OPTIONAL, and independent of "action": the globalSettings sections to replace. Supply it ' +
                        'alone to change only globalSettings, or together with an "action" to change a profile and ' +
                        'globalSettings in one atomic save. Allowed keys are "others", "substitute" and ' +
                        '"profileSet" — "ai" is rejected. Each section given replaces the stored one in full (send ' +
                        'the existing content plus your change, or you will delete the rest); sections omitted are ' +
                        'left untouched. Every URL inside a "profileSet" entry\'s fixed rules MUST include an ' +
                        'explicit scheme, same as in a profile\'s "proxy". Ask the user if they have not clarified.',
                    type: 'object'
                },
                index: {
                    description:
                        'For "add" only: the zero-based position the new profile should occupy after insertion ' +
                        '(0 puts it first, the profile count appends it last).',
                    type: 'integer',
                    minimum: 0
                },
                insertAfter: {
                    description:
                        'For "add" only: name or zero-based index of the profile the new one should be placed ' +
                        'immediately AFTER.',
                    type: ['string', 'integer']
                },
                insertBefore: {
                    description:
                        'For "add" only: name or zero-based index of the profile the new one should be placed ' +
                        'immediately BEFORE.',
                    type: ['string', 'integer']
                }
            },
            additionalProperties: false
        }
    },
    {
        name: TOOL_NAMES.LIST_HACK_FUNCTIONS,
        description:
            'List the reusable hack functions this configuration makes available to a profile, each with the usage ' +
            'documentation the app ships for it (parameters, what it modifies, and a ready-to-paste example) and its ' +
            'source. Hack functions are called from a fixed rule\'s "hackRequest" / "hackResponse" arrays as ' +
            '"functionName(initArgs)" — hackRequest runs just before the request goes to the target server, ' +
            'hackResponse just after its response comes back. Checkout-Proxy ships three built-ins ' +
            '(overwriteCookiesInRequestHeaders, overwriteCookiesInResponseHeaders, overwriteRuleForPath); ' +
            'the user may have added more. ' +
            'YOU MUST CALL THIS TOOL BEFORE YOU USE OR EVEN SUGGEST ANY "hackRequest" OR "hackResponse" ENTRY — ' +
            'whether you are writing one with "manage_profile" or only proposing one in chat — and also before you ' +
            'edit or remove a profile that already contains one, so you understand what its existing hacks do. ' +
            'Never rely on signatures you remember; the user may have edited, renamed or deleted a function. ' +
            'A function reported with "doNotUse": true (its "usage" comment is null) MUST NOT be used or suggested: ' +
            'without its documented contract you cannot know its arguments. Prefer an existing documented function ' +
            'over inventing new inline code — and prefer no hack at all: "hackRequest" and "hackResponse" are the ' +
            'last resort, so first try to satisfy the requirement with any other field of the profile (every field ' +
            'except "hackRequest" and "hackResponse"), and use a hack only when none of them can express what the ' +
            'user asked for.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    }
];

const textResult = (payload, isError = false) => ({
    content: [
        {
            type: 'text',
            text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
        }
    ],
    isError
});

const errorResult = (message) => textResult({ ok: false, error: message }, true);

/**
 * Create a proxy MCP controller.
 *
 * @param {object} handlers Injected proxy-control bridge:
 *   - getProfiles(): Array<{ name, toBeDecided? }>  raw config profiles
 *   - getState(): { activeProfileIndex, profileName, decided, isRunning }
 *   - getEffectiveProfile(): serializable effective profile or null
 *   - getConfiguration(): the full config JSON object (or null when unavailable)
 *   - getUsageGuide(): the user guide (README) as a Markdown string (or null when unavailable)
 *   - start(index, toBeDecided): Promise<{ success, error? }>
 *   - stop(): Promise<{ success, error? }>
 *   - getHackFunctions(): { current, factory }  live and factory `reusableHackFunctions` maps
 *   - saveProfile({ index, profileJson, asNew, globalSettingsJson }):
 *         Promise<{ success, error?, globalSettings? }>
 *       One atomic write covering both halves of a `manage_profile` call:
 *         asNew === true      -> insert `profileJson` immediately after `index`
 *         asNew === false     -> replace the profile at `index`
 *         asNew === null      -> remove the profile at `index`
 *         asNew === undefined -> leave the profile array alone (globalSettings-only call)
 *       `globalSettingsJson`, when present, replaces each section it carries (only
 *       `others`, `substitute` and `profileSet` ever reach it) and preserves everything
 *       else, `ai` included. When absent, globalSettings must be written back unchanged.
 * @returns {{ tools: Array, callTool: (name, args) => Promise<object>, getToolNames: () => string[] }}
 */
export const createProxyMcpController = (handlers = {}) => {
    const tools = buildToolDefinitions();

    const safeGetState = () => {
        try {
            const s = (handlers.getState && handlers.getState()) || {};
            return {
                activeProfileIndex: Number.isInteger(s.activeProfileIndex) ? s.activeProfileIndex : ACTIVE_INDEX_NONE,
                profileName: s.profileName == null ? null : s.profileName,
                decided: s.decided && typeof s.decided === 'object' ? s.decided : {},
                isRunning: !!s.isRunning,
                mode: describeMode(Number.isInteger(s.activeProfileIndex) ? s.activeProfileIndex : ACTIVE_INDEX_NONE)
            };
        } catch (e) {
            return {
                activeProfileIndex: ACTIVE_INDEX_NONE,
                profileName: null,
                decided: {},
                isRunning: false,
                mode: 'stopped'
            };
        }
    };

    const getProfiles = () => {
        const profiles = handlers.getProfiles && handlers.getProfiles();
        return Array.isArray(profiles) ? profiles : [];
    };

    const handleStartProfile = async (args) => {
        const profiles = getProfiles();
        const ref = args.profile;
        if (ref === undefined || ref === null || ref === '') {
            return errorResult('Missing required argument "profile" (a profile name or zero-based index).');
        }
        const index = resolveProfileIndex(profiles, ref);
        if (index === null) {
            return errorResult(
                `Profile not found: ${JSON.stringify(ref)}. Call "list_profiles" to see available profile names and indices.`
            );
        }
        const spec = parseToBeDecidedSpec(profiles[index].toBeDecided);
        const { decided, warnings } = buildDecided(spec, args.toBeDecided);
        const startRes = (await handlers.start(index, decided)) || {};
        const status = safeGetState();
        const ok = startRes.success === true;
        return textResult(
            {
                ok,
                message: ok
                    ? `Started profile "${profiles[index].name}" (index ${index}).`
                    : `Failed to start profile "${profiles[index].name}" (index ${index}).`,
                error: ok ? undefined : startRes.error || 'Proxy did not reach a running state.',
                profile: profiles[index].name,
                index,
                toBeDecided: decided,
                warnings: warnings.length ? warnings : undefined,
                status
            },
            !ok
        );
    };

    const handleDirectConnect = async () => {
        const startRes = (await handlers.start(ACTIVE_INDEX_DIRECT, {})) || {};
        const status = safeGetState();
        const ok = startRes.success === true;
        return textResult(
            {
                ok,
                message: ok
                    ? 'Direct Connect started: the proxy is running with no fixed rules or upstream proxy.'
                    : 'Failed to start Direct Connect.',
                error: ok ? undefined : startRes.error || 'Proxy did not reach a running state.',
                status
            },
            !ok
        );
    };

    const handleStopProxy = async () => {
        const stopRes = (await handlers.stop()) || {};
        const status = safeGetState();
        const ok = stopRes.success !== false;
        return textResult(
            {
                ok,
                message: ok ? 'Proxy servers stopped.' : 'Failed to stop proxy servers.',
                error: ok ? undefined : stopRes.error || 'Unknown error while stopping.',
                status
            },
            !ok
        );
    };

    const handleListProfiles = () => {
        const profiles = getProfiles();
        const status = safeGetState();
        const list = profiles.map((p, index) => ({
            index,
            name: p && p.name,
            requiresToBeDecided: parseToBeDecidedSpec(p && p.toBeDecided),
            active: status.activeProfileIndex === index
        }));
        return textResult({
            ok: true,
            mode: status.mode,
            activeProfileIndex: status.activeProfileIndex,
            runningProfile: status.activeProfileIndex >= 0 ? status.profileName : null,
            decided: status.decided,
            profileCount: list.length,
            profiles: list
        });
    };

    const handleGetEffectiveProfile = () => {
        const status = safeGetState();
        let message;
        if (status.mode === 'stopped') {
            message = 'No profile is running. Start a profile or Direct Connect first.';
        } else if (status.mode === 'direct-connect') {
            message =
                'Direct Connect is active: traffic is tunneled directly with no fixed rules or upstream proxy, so there is no effective profile.';
        } else {
            message = `Profile "${status.profileName}" is running.`;
        }
        const effectiveProfile =
            status.mode === 'profile' && handlers.getEffectiveProfile ? handlers.getEffectiveProfile() : null;
        return textResult({
            ok: true,
            mode: status.mode,
            activeProfileIndex: status.activeProfileIndex,
            runningProfile: status.activeProfileIndex >= 0 ? status.profileName : null,
            decided: status.decided,
            message,
            effectiveProfile
        });
    };

    const handleGetConfiguration = () => {
        const configuration = handlers.getConfiguration ? handlers.getConfiguration() : null;
        if (configuration == null || typeof configuration !== 'object') {
            return errorResult('Configuration is not available.');
        }
        return textResult({
            ok: true,
            message:
                'The current Checkout-Proxy configuration (raw, as stored on disk; placeholders are NOT substituted). ' +
                'Call "get_usage_guide" to learn what each field means before editing.',
            configuration
        });
    };

    const handleGetUsageGuide = () => {
        const guide = handlers.getUsageGuide ? handlers.getUsageGuide() : null;
        if (typeof guide !== 'string' || !guide.trim()) {
            return errorResult('Usage guide is not available.');
        }
        // Return the guide verbatim as Markdown so the client can read it directly.
        return textResult(guide);
    };

    const handleListHackFunctions = () => {
        const source = (handlers.getHackFunctions && handlers.getHackFunctions()) || {};
        const functions = describeHackFunctions(source.current, source.factory);
        const unusable = functions.filter((f) => f.doNotUse);
        return textResult({
            ok: true,
            message:
                functions.length > 0
                    ? 'Hack functions callable from a profile\'s "hackRequest" / "hackResponse" arrays. Call one as ' +
                      '"functionName(initArgs)"; the arguments are evaluated when the profile starts. Reuse these ' +
                      'rather than inventing new inline code, and read each "usage" comment for its exact parameters.'
                    : 'This configuration defines no reusable hack functions, so do not write any "hackRequest" or ' +
                      '"hackResponse" entry.',
            rule:
                'A function\'s "usage" comment is its contract. NEVER use or suggest a function marked ' +
                '"doNotUse": true (its "usage" is null) — you cannot know what arguments it takes, and guessing ' +
                "breaks the user's traffic at runtime. If one of those is the only fit, tell the user to document " +
                'it first in element [0] of its reusableHackFunctions entry, and propose nothing until they do.',
            callingConvention: {
                hackRequest:
                    'Runs immediately before the request is sent to the target server; modifies requestOptions.',
                hackResponse: 'Runs immediately after the target server responds; modifies the response.',
                example: {
                    'httpsFixedRule["a.example.com:443"]': {
                        target: 'https://b.example.com:443',
                        hackRequest: ["overwriteCookiesInRequestHeaders(['aa=0000'])"]
                    }
                }
            },
            functionCount: functions.length,
            usableFunctionCount: functions.length - unusable.length,
            doNotUseFunctions: unusable.map((f) => f.name),
            functions
        });
    };

    /**
     * Write configuration in ONE atomic save: an optional profile mutation (add / edit /
     * remove) and/or an optional replacement of the editable globalSettings sections.
     *
     * Both parts go to `handlers.saveProfile` together — the same save operation the app's
     * profile editor uses, which likewise writes the profile and globalSettings in one go.
     * That matters for the common "define a shared rule set and make this profile use it"
     * request: as one save it either fully applies or fully fails, and the proxy stops and
     * restarts once instead of twice.
     *
     * `action` is required for a profile change and omitted for a globalSettings-only
     * change; at least one of the two must be present.
     */
    const handleManageProfile = async (args) => {
        if (typeof handlers.saveProfile !== 'function') {
            return errorResult('Configuration editing is not available: no save handler is wired up.');
        }
        const hasAction = args.action !== undefined && args.action !== null && args.action !== '';
        const hasGlobalSettings = args.globalSettingsJson !== undefined && args.globalSettingsJson !== null;
        if (!hasAction && !hasGlobalSettings) {
            return errorResult(
                `Nothing to do: supply "action" (${PROFILE_ACTIONS.map((a) => `"${a}"`).join(', ')}) to change a ` +
                    'profile, "globalSettingsJson" to change the shared globalSettings sections, or both to do ' +
                    'them together in one save.'
            );
        }

        // Validate the globalSettings part first so a bad body is rejected before any
        // profile work is done — the save is atomic, so nothing must be half-applied.
        let globalSections = null;
        if (hasGlobalSettings) {
            const bodyError = validateGlobalSettingsBody(args.globalSettingsJson);
            if (bodyError) return errorResult(bodyError);
            globalSections = Object.keys(args.globalSettingsJson);
        }

        const action = hasAction && typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
        if (hasAction && !PROFILE_ACTIONS.includes(action)) {
            return errorResult(
                `Argument "action" must be one of ${PROFILE_ACTIONS.map((a) => `"${a}"`).join(', ')}.` +
                    ` Received ${JSON.stringify(args.action)}.`
            );
        }

        // globalSettings-only: no profile is touched.
        if (!hasAction) {
            const strayProfileArgs = ['profile', 'profileJson', ...POSITION_KEYS].filter(
                (key) => args[key] !== undefined && args[key] !== null && args[key] !== ''
            );
            if (strayProfileArgs.length > 0) {
                return errorResult(
                    `Argument(s) ${strayProfileArgs.map((k) => `"${k}"`).join(', ')} need an "action" ` +
                        `(${PROFILE_ACTIONS.map((a) => `"${a}"`).join(', ')}) saying what to do with the profile. ` +
                        'Omit them to change globalSettings alone, or add "action" to change both at once.'
                );
            }
            const saveRes =
                (await handlers.saveProfile({ globalSettingsJson: args.globalSettingsJson, asNew: undefined })) || {};
            if (saveRes.success !== true) {
                return errorResult(
                    `Failed to update globalSettings (${globalSections.join(', ')}): ${saveRes.error || 'unknown error.'}`
                );
            }
            return textResult({
                ok: true,
                action: null,
                message:
                    `Replaced globalSettings section(s): ${globalSections.join(', ')}. The configuration has been ` +
                    'saved. globalSettings.ai, reusableHackFunctions, appPort and every profile were left ' +
                    'untouched. profileSet and substitute are shared, so this may change the effective rules of ' +
                    'any profile that references them — suggest checking [Effective Profile] (or call ' +
                    '"get_effective_profile").',
                updatedGlobalSettingsSections: globalSections,
                globalSettings: saveRes.globalSettings,
                status: safeGetState()
            });
        }

        const profiles = getProfiles();
        const positionGiven = POSITION_KEYS.filter(
            (key) => args[key] !== undefined && args[key] !== null && args[key] !== ''
        );
        const targetGiven = args.profile !== undefined && args.profile !== null && args.profile !== '';

        // Reject arguments that do not belong to the chosen action rather than silently
        // ignoring them — a misplaced position would otherwise put the profile elsewhere
        // than the caller intended.
        if (action === 'add' && targetGiven) {
            return errorResult(
                'Argument "profile" is not used by action "add". Position the new profile with "index", ' +
                    '"insertAfter" or "insertBefore" instead, or omit all three to append it at the end.'
            );
        }
        if (action !== 'add' && positionGiven.length > 0) {
            return errorResult(
                `Argument(s) ${positionGiven.map((k) => `"${k}"`).join(', ')} are only used by action "add". ` +
                    `For "${action}", identify the profile with "profile" (name or zero-based index).`
            );
        }
        if (action === 'remove' && args.profileJson !== undefined) {
            return errorResult('Argument "profileJson" is not used by action "remove".');
        }

        let index;
        let asNew;
        let targetIndex;
        let targetName;

        if (action === 'add') {
            const bodyError = validateProfileBody(args.profileJson);
            if (bodyError) return errorResult(bodyError);
            const anchor = resolveInsertAnchor(profiles, args);
            if (anchor.error) return errorResult(anchor.error);
            index = anchor.anchorIndex;
            targetIndex = anchor.targetIndex;
            targetName = args.profileJson.name;
            asNew = true;
        } else {
            if (!targetGiven) {
                return errorResult(
                    `Argument "profile" is required for action "${action}" (a profile name or zero-based index).`
                );
            }
            const found = resolveProfileIndex(profiles, args.profile);
            if (found === null) {
                return errorResult(
                    `Profile not found: ${JSON.stringify(args.profile)}. Call "list_profiles" to see available profile names and indices.`
                );
            }
            index = found;
            targetIndex = found;
            if (action === 'edit') {
                const bodyError = validateProfileBody(args.profileJson);
                if (bodyError) return errorResult(bodyError);
                targetName = args.profileJson.name;
                asNew = false;
            } else {
                targetName = profiles[found] && profiles[found].name;
                asNew = null; // the save operation's "remove this index" signal
            }
        }

        const saveRes =
            (await handlers.saveProfile({
                index,
                profileJson: args.profileJson,
                asNew,
                globalSettingsJson: hasGlobalSettings ? args.globalSettingsJson : undefined
            })) || {};
        const ok = saveRes.success === true;
        if (!ok) {
            return errorResult(
                `Failed to ${action} profile ${JSON.stringify(targetName)}` +
                    (globalSections ? ` (with globalSettings ${globalSections.join(', ')})` : '') +
                    `: ${saveRes.error || 'unknown error.'} Nothing was saved.`
            );
        }

        const updated = getProfiles();
        const messages = {
            add: `Added profile "${targetName}" at index ${targetIndex}.`,
            edit: `Replaced the profile at index ${targetIndex} with "${targetName}".`,
            remove: `Removed profile "${targetName}" (was index ${targetIndex}).`
        };
        return textResult({
            ok: true,
            action,
            message:
                `${messages[action]}` +
                (globalSections
                    ? ` Also replaced globalSettings section(s): ${globalSections.join(', ')} — shared, so this may ` +
                      'change the effective rules of any profile that references them.'
                    : ' globalSettings was left untouched.') +
                ' The configuration has been saved in one atomic write. globalSettings.ai, reusableHackFunctions ' +
                'and appPort are never modified by this tool.',
            profile: targetName,
            index: action === 'remove' ? undefined : targetIndex,
            updatedGlobalSettingsSections: globalSections || undefined,
            globalSettings: saveRes.globalSettings,
            profileCount: updated.length,
            profiles: updated.map((p, i) => ({ index: i, name: p && p.name })),
            status: safeGetState()
        });
    };

    const dispatch = async (name, rawArgs) => {
        const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
        try {
            switch (name) {
                case TOOL_NAMES.START_PROFILE:
                    return await handleStartProfile(args);
                case TOOL_NAMES.DIRECT_CONNECT:
                    return await handleDirectConnect();
                case TOOL_NAMES.STOP_PROXY:
                    return await handleStopProxy();
                case TOOL_NAMES.LIST_PROFILES:
                    return handleListProfiles();
                case TOOL_NAMES.GET_EFFECTIVE_PROFILE:
                    return handleGetEffectiveProfile();
                case TOOL_NAMES.GET_CONFIGURATION:
                    return handleGetConfiguration();
                case TOOL_NAMES.GET_USAGE_GUIDE:
                    return handleGetUsageGuide();
                case TOOL_NAMES.MANAGE_PROFILE:
                    return await handleManageProfile(args);
                case TOOL_NAMES.LIST_HACK_FUNCTIONS:
                    return handleListHackFunctions();
                default:
                    return errorResult(
                        `Unknown tool "${name}". Available tools: ${Object.values(TOOL_NAMES).join(', ')}.`
                    );
            }
        } catch (e) {
            return errorResult(`Tool "${name}" failed: ${(e && e.message) || String(e)}`);
        }
    };

    // Serialize tool calls so concurrent HTTP requests cannot interleave
    // proxy start/stop operations. `dispatch` never throws (errors become
    // isError results), so the chain stays alive.
    let queue = Promise.resolve();
    const callTool = (name, args) => {
        const run = () => dispatch(name, args);
        const result = queue.then(run, run);
        queue = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    };

    return {
        tools,
        callTool,
        getToolNames: () => tools.map((t) => t.name)
    };
};
