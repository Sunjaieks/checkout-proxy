import { createOsFunction, executeCommand, logError } from '../util/nodeUtil.js';

const getWindowsProxyStatus = async () => {
    const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enableOutput = await executeCommand(`reg query "${regPath}" /v ProxyEnable`);
    const isEnabled = /ProxyEnable\s+REG_DWORD\s+0x1/.test(enableOutput);
    // const serverOutput = await executeCommand(`reg query "${regPath}" /v ProxyServer`);
    // const serverMatch = serverOutput.match(/ProxyServer\s+REG_SZ\s+(.*)/);
    // const server = serverMatch ? serverMatch[1] : '';
    // const isOurProxy = server.includes(PROXY_SERVER) && server.includes(String(PROXY_PORT));
    return { isEnabled: isEnabled };
};

const getMacProxyStatus = async () => {
    const services = ['Ethernet', 'Wi-Fi'];
    for (const service of services) {
        const httpProxy = await executeCommand(`networksetup -getwebproxy "${service}"`).catch((e) => logError(e));
        const httpsProxy = await executeCommand(`networksetup -getsecurewebproxy "${service}"`).catch((e) =>
            logError(e)
        );
        const httpEnabled = /Enabled: Yes/.test(httpProxy);
        const httpsEnabled = /Enabled: Yes/.test(httpsProxy);
        // const httpServer = httpProxy.match(/Server: (.*)\n/)?.[1] === PROXY_SERVER;
        // const httpsServer = httpsProxy.match(/Server: (.*)\n/)?.[1] === PROXY_SERVER;
        if (httpEnabled || httpsEnabled) {
            return { isEnabled: true };
        }
    }
    return { isEnabled: false };
};

const enableWindowsProxy = async (proxyHost, proxyPort) => {
    try {
        const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
        // http and https proxy for windows are same
        await executeCommand(`reg add "${regPath}" /v ProxyServer /t REG_SZ /d "http://${proxyHost}:${proxyPort}" /f`);
        await executeCommand(`reg add "${regPath}" /v ProxyEnable /t REG_DWORD /d 1 /f`);
    } catch (e) {
        logError(e);
        throw new Error(`Failed to enable Windows Proxy: ${e.message}`);
    }
};

const enableMacProxy = async (proxyHost, proxyPort) => {
    const services = ['Wi-Fi', 'Ethernet'];
    let errorServiceCount = 0;
    for (const service of services) {
        try {
            await executeCommand(`networksetup -setwebproxy "${service}" ${proxyHost} ${proxyPort}`);
            await executeCommand(`networksetup -setsecurewebproxy "${service}" ${proxyHost} ${proxyPort}`);
        } catch (e) {
            logError(e);
            errorServiceCount++;
        }
    }
    if (errorServiceCount >= services.length) {
        throw new Error('Failed to enable Mac Proxy.');
    }
};

const disableWindowsProxy = async () => {
    try {
        const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
        await executeCommand(`reg add "${regPath}" /v ProxyEnable /t REG_DWORD /d 0 /f`);
    } catch (e) {
        logError(e);
        throw new Error('Failed to disable Windows Proxy.');
    }
};

const disableMacProxy = async () => {
    const services = ['Wi-Fi', 'Ethernet'];
    let errorServiceCount = 0;
    for (const service of services) {
        try {
            // Clear server/port then disable state in one shell invocation.
            // -setwebproxy implicitly enables the proxy, so -setwebproxystate off must follow.
            await executeCommand(`networksetup -setwebproxy "${service}" "" 0 && networksetup -setwebproxystate "${service}" off`);
            await executeCommand(`networksetup -setsecurewebproxy "${service}" "" 0 && networksetup -setsecurewebproxystate "${service}" off`);
        } catch (e) {
            logError(e);
            errorServiceCount++;
        }
    }
    if (errorServiceCount >= services.length) {
        throw new Error('Failed to disable Mac Proxy.');
    }
};

export const systemProxyManager = {
    getProxyStatus: createOsFunction(getMacProxyStatus, getWindowsProxyStatus),
    enableSystemProxy: createOsFunction(enableMacProxy, enableWindowsProxy),
    disableSystemProxy: createOsFunction(disableMacProxy, disableWindowsProxy)
};
