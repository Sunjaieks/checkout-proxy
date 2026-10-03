import { MCP_DEFAULT_HOST, MCP_DEFAULT_PORT, STANDARD_LIGHTNESS, STANDARD_SATURATION } from '../constant/constant';

export const gethostUsingProxy = (profile) => profile?.proxy?.hostUsingProxy || [];
export const gethostBypassProxy = (profile) => profile?.proxy?.hostBypassProxy || [];
export const gethttpFixedRule = (profile) => profile?.proxy?.httpFixedRule || Object.create(null);
export const gethttpsFixedRule = (profile) => profile?.proxy?.httpsFixedRule || Object.create(null);
export const isRelativePath = (u) => typeof u === 'string' && u.startsWith('/');
export const escapeHtml = (str) => {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
export const once = (fn) => {
    let called = false;
    return (...args) => {
        if (called) return;
        called = true;
        return fn(...args);
    };
};
export const nextTick = (cb, ...args) => {
    if (typeof cb !== 'function') return;
    process.nextTick(() => cb(...args));
};
export const isHttp = (url) => {
    const rawUrl = url?.toLowerCase() || '';
    return rawUrl.startsWith('http://') || rawUrl.startsWith('https://');
};

export const getUrlFactor = (url) => {
    try {
        if (!url) return null;
        const urlObj = new URL(url);
        if (!urlObj.hostname || !urlObj.protocol) return null;
        return {
            protocol: urlObj.protocol.slice(0, -1),
            host: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80'),
            username: urlObj.username,
            password: urlObj.password
        };
    } catch (e) {
        return null;
    }
};
export const isMatchWildcardRule = (host, port, hostRule, portRule) => {
    if (!host || !hostRule) return false;
    if (portRule && String(port) !== String(portRule)) return false;
    let sub = hostRule;
    let matchEnd = false;
    let matchStart = false;
    if (hostRule.startsWith('*')) {
        sub = sub.slice(1);
        matchEnd = true;
    }
    if (hostRule.endsWith('*')) {
        sub = sub.slice(0, -1);
        matchStart = true;
    }
    if (matchEnd && matchStart) {
        return host.includes(sub);
    } else if (matchEnd) {
        return host.endsWith(sub);
    } else if (matchStart) {
        return host.startsWith(sub);
    }
    return host === sub;
};
export const getWildcardRule = (ruleObj, host, port) => {
    if (!ruleObj || !host) return undefined;
    return Object.entries(ruleObj).find(([key, rule]) => {
        const [hostRule, portRule] = key.split(':');
        return isMatchWildcardRule(host, port, hostRule, portRule);
    })?.[1];
};
export const getProfileByIndex = (config, index) => config?.profile?.[index];
export const inHostUsingProxy = (profile, hostname) =>
    gethostUsingProxy(profile).find((item) => isMatchWildcardRule(hostname, null, item, null));
export const inHostBypassProxy = (profile, hostname) =>
    gethostBypassProxy(profile).find((item) => isMatchWildcardRule(hostname, null, item, null));
export const isLocalHost = (hostname) =>
    hostname?.includes('localhost') || hostname?.includes('127.0.0.1') || hostname?.includes('::1');
export const isConfigVersionOutdated = (currentConfig, defaultConfig) =>
    Number.isInteger(defaultConfig.configVersion) &&
    (!Number.isInteger(currentConfig?.configVersion) || currentConfig.configVersion < defaultConfig.configVersion);
export const isPortInvalid = (config) =>
    !config.appPort ||
    !Array.isArray(config.appPort) ||
    config.appPort.length < 1 ||
    !Number.isInteger(config.appPort[0]);
export const hashStringSegment = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
};
export const stringToColorArray = (str) => {
    const segments = str.split(/[\s,|.;:/_-]+/);
    let finalHash = 0;

    const weights = [1.0, 0.5, 0.3, 0.1, 0.05];
    const FALLBACK_WEIGHT = 0.01;

    segments.forEach((segment, index) => {
        const segmentHash = hashStringSegment(segment);
        const weight = weights[index] !== undefined ? weights[index] : FALLBACK_WEIGHT;
        finalHash += segmentHash * weight;
    });

    const hue = Math.abs(Math.round(finalHash) % 360);
    return [hue, STANDARD_SATURATION, STANDARD_LIGHTNESS];
};
export const toColorString = (obj) => {
    return `hsl(${obj[0]}, ${obj[1]}%, ${obj[2]}%)`;
};
export const getReusableHackFunctions = (reusableHackFunctions) =>
    Object.entries(reusableHackFunctions || Object.create(null)).reduce((acc, [key, value]) => {
        const v = Array.isArray(value) ? value[1]?.trim() : value?.trim();
        if (key?.trim() && v) acc[key] = createReusableFunction(v);
        return acc;
    }, Object.create(null));
export const createHackFunction = (fEnv, functionStrings, fallback = (arg) => arg) =>
    Array.isArray(functionStrings)
        ? functionStrings.map((f) => (f?.trim() ? new Function('return this.' + f.trim()).call(fEnv) : fallback))
        : [];
export const createReusableFunction = (functionString) => Function.call(null, 'return ' + functionString)();
export const checkConfig = (config) => {
    const configObj = JSON.parse(config);
    if (isPortInvalid(configObj)) {
        throw new Error('Invalid appPort format. Must be an array with a valid port number.');
    }
    if (!Array.isArray(configObj.profile)) {
        throw new Error('Invalid profile format. Must be an array.');
    }
    if (configObj.profile.find((item) => !item?.name)) {
        throw new Error('Invalid profile name. Name is required for each profile.');
    }
    configObj.profile.forEach(checkProfile);
    checkGlobalSettings(configObj.globalSettings);
    return configObj;
};
export const setDefaultField = (config) => {
    config.globalSettings = config.globalSettings ?? {};
    config.globalSettings.ai = config.globalSettings.ai ?? {};
    if (!isPortValid(config.globalSettings.ai.mcpPort)) {
        config.globalSettings.ai.mcpPort = MCP_DEFAULT_PORT;
    }
};
export const checkProfile = (profile) => {
    if (!profile?.name) {
        throw new Error('Invalid profile name. Name is required for each profile.');
    }
    if (profile?.decorator && typeof profile.decorator !== 'string') {
        throw new Error('Invalid profile decorator. It must be a string (any text, including UTF-8 icons).');
    }
    if (profile?.toBeDecided?.length > 2) {
        throw new Error('Invalid profile. Maximum 2 items in field of toBeDecided are allowed.');
    }
    checkWildcardForFixedRule(profile.proxy, profile.name);
    return profile;
};

export const checkGlobalSettings = (globalSettings) => {
    Object.entries(globalSettings?.profileSet || {}).forEach(([profileName, profile]) => {
        checkWildcardForFixedRule(profile, `globalSettings.profileSet[${profileName}]`);
    });
    checkAiSettings(globalSettings?.ai);
    return globalSettings;
};

export const isPortValid = (port) => Number.isInteger(port) && port >= 1 && port <= 65535;

/**
 * Validate the optional `globalSettings.ai` config field.
 * The field is optional; absence is valid and yields built-in defaults at runtime.
 * When present it must be an object with optional `mcpEnabled` (boolean),
 * `mcpPort` (integer 1-65535), `guiCommand` (string) and `guiPort` (integer 1-65535)
 * members. The first two control the built-in MCP server; the last two control the
 * AI Desktop (cloudcli) launcher. Throws on malformed input.
 */
export const checkAiSettings = (ai) => {
    if (ai === undefined || ai === null) return ai;
    if (typeof ai !== 'object' || Array.isArray(ai)) {
        throw new Error(
            'Invalid ai. Must be an object with optional "mcpEnabled" (boolean), "mcpPort" (integer), "guiCommand" (string) and "guiPort" (integer) fields.'
        );
    }
    if ('mcpEnabled' in ai && typeof ai.mcpEnabled !== 'boolean') {
        throw new Error('Invalid ai.mcpEnabled. Must be a boolean (true or false).');
    }
    if ('mcpPort' in ai && ai.mcpPort !== undefined && ai.mcpPort !== null && !isPortValid(ai.mcpPort)) {
        throw new Error('Invalid ai.mcpPort. Must be an integer between 1 and 65535.');
    }
    if (
        'guiCommand' in ai &&
        ai.guiCommand !== undefined &&
        ai.guiCommand !== null &&
        typeof ai.guiCommand !== 'string'
    ) {
        throw new Error('Invalid ai.guiCommand. Must be a string.');
    }
    // guiPort may be left empty (''/undefined/null) to mean "AI Desktop not configured".
    // When set it is the plain port (1-65535) that AI Desktop serves on / the window loads.
    if (
        'guiPort' in ai &&
        ai.guiPort !== undefined &&
        ai.guiPort !== null &&
        ai.guiPort !== '' &&
        !isPortValid(ai.guiPort)
    ) {
        throw new Error('Invalid ai.guiPort. Must be an integer between 1 and 65535.');
    }
    return ai;
};

/**
 * Resolve the effective MCP server settings from the optional `globalSettings.ai`
 * config field. The MCP server always binds to loopback for safety, so `host` is not
 * user-configurable. `enabled` defaults to false unless `ai.mcpEnabled` is explicitly
 * true. `port` is read as-is from `ai.mcpPort`; the factory config and the settings UI
 * supply/validate a valid port.
 */
export const getMcpServerSettings = (config) => {
    const ai = config?.globalSettings?.ai;
    const raw = (typeof ai === 'object' && ai) || {};
    return {
        enabled: raw.mcpEnabled === true,
        port: raw.mcpPort,
        host: MCP_DEFAULT_HOST
    };
};

/**
 * Whether a configuration change actually requires the MCP server to be rebound.
 *
 * Saving the configuration must not bounce the MCP server for unrelated edits. An MCP
 * client's `manage_profile` call is served *by* that server, and the save it triggers runs
 * inside the request: closing the server there waits for the in-flight connection to end,
 * while that connection waits for the save to finish — a deadlock the client only sees as
 * a timeout. Only `enabled`, `port` and `host` affect the listener, so only those are
 * compared. A missing `applied` means the server has never been configured, which counts
 * as a change.
 */
export const isMcpServerSettingsChanged = (applied, next) =>
    !applied || !next || applied.enabled !== next.enabled || applied.port !== next.port || applied.host !== next.host;

/**
 * Resolve the AI Desktop (cloudcli) launcher settings from `globalSettings.ai`.
 * `command` is the full command the AI Desktop tool spawns (trimmed; empty when unset). It
 * may carry an inline env prefix, e.g. `SERVER_PORT=18887 cloudcli`.
 * `port` is the plain port AI Desktop serves on — where the window loads (`http://localhost:<port>`)
 * and what readiness is probed against. It is `undefined` when unconfigured.
 */
export const getAiGuiSettings = (config) => {
    const ai = config?.globalSettings?.ai;
    const raw = (typeof ai === 'object' && ai) || {};
    return {
        command: typeof raw.guiCommand === 'string' ? raw.guiCommand.trim() : '',
        port: raw.guiPort
    };
};

export const findHeaderWithIgnoreCase = (responseHeaders, headerKey) => {
    if (!headerKey || !responseHeaders) return undefined;
    return Object.keys(responseHeaders).find((key) => key.toLowerCase() === headerKey.toLowerCase());
};

export const removeHeaderWithIgnoreCase = (responseHeaders, headerKey) => {
    if (!headerKey) return;
    const actuallyKey = Object.keys(responseHeaders).find((key) => key.toLowerCase() === headerKey.toLowerCase());
    if (typeof actuallyKey !== 'undefined') delete responseHeaders[actuallyKey];
};

/**
 * Remove hop-by-hop headers (RFC 7230) before forwarding between hops.
 *
 * This proxy intentionally preserves negotiated `TE` / `Transfer-Encoding` and `Trailer`
 * (even though they are hop-by-hop by spec), per product requirements.
 *
 * Also removes any headers nominated by `Connection: ...`.
 */
export const stripHopByHopHeaders = (headers, { preserve = [] } = {}) => {
    if (!headers) return;
    const preserveSet = new Set((preserve || []).map((h) => String(h).toLowerCase()));

    const baseHopByHop = [
        'connection',
        'keep-alive',
        'proxy-connection',
        'proxy-authenticate',
        'proxy-authorization',
        'upgrade'
    ];

    // Remove Connection itself but also remove all header fields it nominates.
    const connectionKey = findHeaderWithIgnoreCase(headers, 'connection');
    const connectionVal = headers[connectionKey];
    const nominated = String(connectionVal || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    baseHopByHop.forEach((h) => {
        if (!preserveSet.has(h)) removeHeaderWithIgnoreCase(headers, h);
    });

    nominated.forEach((h) => {
        const lower = h.toLowerCase();
        if (preserveSet.has(lower)) return;
        removeHeaderWithIgnoreCase(headers, h);
    });
};

export const checkWildcardForFixedRule = (profileHavingFixedRule, profileName) => {
    [
        ...Object.entries(profileHavingFixedRule?.httpsFixedRule || {}),
        ...Object.entries(profileHavingFixedRule?.httpFixedRule || {})
    ].forEach(([key, value]) => {
        Array.prototype.forEach.call(key, (character, index) => {
            if (
                character === '*' &&
                index !== 0 &&
                index !== key.length - 1 &&
                !(key[index + 1] === ':' && Number.isInteger(Number(key.substring(index + 2))))
            ) {
                throw new Error(
                    `Invalid wildcard in profile "${profileName}". Wildcards must be placed at the start or end of the domain.`
                );
            }
        });
    });
};

export const waitFor = (predicate, { interval = 10, timeout = 100 } = {}) => {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            try {
                if (predicate()) return resolve();
                if (Date.now() - start >= timeout) return reject(new Error('timeout'));
                setTimeout(tick, interval);
            } catch (err) {
                reject(err);
            }
        };
        tick();
    });
};
