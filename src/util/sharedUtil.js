export const gethostUsingProxy = (profile) => profile?.proxy?.hostUsingProxy || [];
export const gethostBypassProxy = (profile) => profile?.proxy?.hostBypassProxy || [];
export const gethttpFixedRule = (profile) => profile?.proxy?.httpFixedRule || Object.create(null);
export const gethttpsFixedRule = (profile) => profile?.proxy?.httpsFixedRule || Object.create(null);
export const getUrlFactor = (url) => {
    try {
        if(!url) return null;
        const urlObj = new URL(url);
        if (!urlObj.hostname || !urlObj.protocol) return null;
        return {
            protocol: urlObj.protocol.slice(0, -1),
            host: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80')
        };
    } catch (e) {
        return null;
    }
}
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
}
export const getWildcardRule = (ruleObj, host, port) => {
    if (!ruleObj || !host) return undefined;
    return Object.entries(ruleObj).find(([key, rule]) => {
        const [hostRule, portRule] = key.split(':');
        return isMatchWildcardRule(host, port, hostRule, portRule);
    })?.[1]
}
export const getProfileByIndex = (config, index) => config?.profile?.[index];
export const inHostUsingProxy = (profile, hostname) => gethostUsingProxy(profile).find(item => isMatchWildcardRule(hostname, null, item, null));
export const inHostBypassProxy = (profile, hostname) => gethostBypassProxy(profile).find(item => isMatchWildcardRule(hostname, null, item, null));
export const isLocalHost = (hostname) => hostname?.includes('localhost') || hostname?.includes('127.0.0.1') || hostname?.includes('::1');
export const isConfigVersionOutdated = (currentConfig, defaultConfig) => Number.isInteger(defaultConfig.configVersion) && (!Number.isInteger(currentConfig?.configVersion) || currentConfig.configVersion < defaultConfig.configVersion);
export const isPortInvalid = (config) => !config.appPort || !Array.isArray(config.appPort) || config.appPort.length !== 2 ||
    !Number.isInteger(config.appPort[0]) || !Number.isInteger(config.appPort[1])
export const getReusableHackFunctions = (reusableHackFunctions) => Object.entries(reusableHackFunctions || Object.create(null)).reduce((acc, [key, value]) => {
    const v = Array.isArray(value) ? value[1]?.trim() : value?.trim();
    if (key?.trim() && v) acc[key] = createReusableFunction(v);
    return acc;
}, Object.create(null));
export const createHackFunction = (fEnv, functionStrings, fallback = (arg) => arg) => Array.isArray(functionStrings) ? functionStrings.map(f => (f?.trim() ? new Function("return this." + f.trim()).call(fEnv) : fallback)) : [];
export const createReusableFunction = (functionString) => Function.call(null, 'return ' + functionString)();
export const checkConfig = (config) => {
    const configObj = JSON.parse(config);
    if (isPortInvalid(configObj)) {
        throw new Error("Invalid appPort format. Must be an array of two numbers.");
    }
    if (!Array.isArray(configObj.profile)) {
        throw new Error("Invalid profile format. Must be an array.");
    }
    if (configObj.profile.find(item => !item?.name)) {
        throw new Error("Invalid profile name. Name is required for each profile.");
    }
    configObj.profile.forEach(checkProfile);
    checkGlobalSettings(config.globalSettings);
    return configObj
}
export const checkProfile = (profile) => {
    if (!profile?.name) {
        throw new Error("Invalid profile name. Name is required for each profile.");
    }
    if (profile?.toBeDecided?.length > 2) {
        throw new Error("Invalid profile. Maximum 2 items in field of toBeDecided are allowed.");
    }
    checkWildcardForFixedRule(profile.proxy, profile.name);
    return profile;
}

export const checkGlobalSettings = (globalSettings) => {
    Object.entries(globalSettings?.profileSet || {}).forEach(([profileName, profile]) => {
        checkWildcardForFixedRule(profile, `globalSettings.profileSet[${profileName}]`)
    })
    return globalSettings;
}

export const checkWildcardForFixedRule = (profileHavingFixedRule, profileName) => {
    [...Object.entries(profileHavingFixedRule?.httpsFixedRule || {}), ...Object.entries(profileHavingFixedRule?.httpFixedRule || {})].forEach(([key, value]) => {
        Array.prototype.forEach.call(key, (character, index) => {
            if (character === '*' && index !== 0 && (index !== key.length - 1 && !(key[index + 1] === ':' && Number.isInteger(Number(key.substring(index + 2)))))) {
                throw new Error(`Invalid wildcard in profile "${profileName}". Wildcards must be placed at the start or end of the domain.`);
            }
        });
    });
}
