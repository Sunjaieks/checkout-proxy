export const gethostUsingProxy = (profile) => profile?.proxy?.hostUsingProxy || [];
export const gethostBypassProxy = (profile) => profile?.proxy?.hostBypassProxy || [];
export const gethttpFixedRule = (profile) => profile?.proxy?.httpFixedRule || Object.create(null);
export const gethttpsFixedRule = (profile) => profile?.proxy?.httpsFixedRule || Object.create(null);
export const getRemoteProxyHost = (profile) => profile?.proxy?.proxyHost;
export const getRemoteProxyPort = (profile) => profile?.proxy?.proxyPort;
export const inHostUsingProxy = (profile, hostname) => gethostUsingProxy(profile).find(item => hostname && hostname.includes(item));
export const inHostBypassProxy = (profile, hostname) => gethostBypassProxy(profile).find(item => hostname && hostname.includes(item));
export const isLocalHost = (hostname) => hostname?.includes('localhost') || hostname?.includes('127.0.0.1') || hostname?.includes('::1');
export const isConfigVersionOutdated = (currentConfig, defaultConfig) => Number.isInteger(defaultConfig.configVersion) && (!Number.isInteger(currentConfig?.configVersion) || currentConfig.configVersion < defaultConfig.configVersion);
export const isPortInvalid = (config) => !config.appPort || !Array.isArray(config.appPort) || config.appPort.length !== 2 ||
    !Number.isInteger(config.appPort[0]) || !Number.isInteger(config.appPort[1])
