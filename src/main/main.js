import {
    clearAgentCache,
    clearCertCache,
    generateRootCA,
    getStartServers,
    loadRootCA,
    writeRootCA
} from "../proxy/proxy-server.js";
import DEFAULT_CONFIG from "../constant/default-config.json" with {type: "json"};
import {
    checkConfig,
    checkGlobalSettings,
    checkProfile,
    createHackFunction,
    getReusableHackFunctions,
    isConfigVersionOutdated,
    isPortInvalid
} from "../util/sharedUtil.js";
import {
    execute,
    getInstallCommand,
    getResourceFilePath,
    getUserDataPath,
    logError,
    logInfo,
    logWarn,
    rootCertPath
} from "../util/nodeUtil.js";
import {app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, session, shell} from 'electron';
import path from 'path';
import fs from 'fs';
import {
    ASK_TO_RENEW_CA,
    ASK_TO_RENEW_CA_LONG,
    CERT_COMMON_NAME,
    CONFIG_OUTDATED_MESSAGE,
    EDITOR_WINDOW_NAME,
    GENERATE_CERT_BUTTON_NAME,
    HELP_WINDOW_NAME,
    PROFILE_EDITOR_WINDOW_NAME,
    RESTART
} from "../constant/constant.js";
import os from "node:os";
import {systemProxyManager} from "../proxy/system-proxy.js";
import {compressToObject, restoreFromCompressedObject} from "../generator/generator.js";
import * as dns from "node:dns";

app.commandLine.appendSwitch('disable-http2');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('dns-result-order', 'ipv4first')
dns.setDefaultResultOrder('ipv4first');

let temporarySession;
let mainWindow;
let editorWindow;
let profileEditorWindow;
let helpWindow;

let httpServer;
let httpsServer;
const currentConfig = [null, null];
let reusableHackFunctions = {};
let activeProfileIndex = -9;
let decided = {};
let startServers;
let oldIndexAndDecided = [-9, {}];
let firstRun = true;

const partition = 'temporary-session';
const userDataPath = getUserDataPath();
const CONFIG_FILE_NAME = 'checkout-proxy-config-v1.json';
const USER_DEFAULT_CONFIG_FILE_NAME = 'checkout-proxy-user-default-config-v1.json';
const userDefaultConfigFilePath = path.join(userDataPath, USER_DEFAULT_CONFIG_FILE_NAME);
const configFilePath = path.join(userDataPath, CONFIG_FILE_NAME);

const afterStopServer = () => {
    oldIndexAndDecided = [-9, {}]
    activeProfileIndex = -9; // Mark no profile as active
    decided = {};
}

function loadConfig() {
    try {
        if (fs.existsSync(configFilePath)) {
            const fileData = fs.readFileSync(configFilePath, 'utf-8');
            currentConfig[0] = JSON.parse(fileData);
            logInfo('Configuration loaded from:', configFilePath);
        } else {
            currentConfig[0] = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            fs.writeFileSync(configFilePath, JSON.stringify(currentConfig[0], null, 2));
            logInfo('Default configuration created at:', configFilePath);
        }
    } catch (error) {
        logError('Error loading or creating config:', error);
        dialog.showErrorBox('Configuration Error', `Failed to load configuration: ${error.message}. Using default.`);
        currentConfig[0] = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    // Ensure appPort exists and has two numbers
    if (isPortInvalid(currentConfig[0])) {
        logWarn('Invalid appPort in config, resetting to default.');
        currentConfig[0].appPort = [...DEFAULT_CONFIG.appPort];
    }
    if (!currentConfig[0].profile || !Array.isArray(currentConfig[0].profile)) {
        currentConfig[0].profile = [];
    }
    reusableHackFunctions = instantiateReusableFunction(currentConfig[0]);
}

function instantiateReusableFunction(newConfig) {
    const copyiedreusableHackFunctions = JSON.parse(JSON.stringify(newConfig.reusableHackFunctions || {}));
    return getReusableHackFunctions(copyiedreusableHackFunctions);
}

function saveConfig(newConfig) {
    try {
        fs.writeFileSync(configFilePath, JSON.stringify(newConfig, null, 2));
        logInfo('Configuration saved to:', configFilePath);
    } catch (error) {
        logError('Error saving config:', error);
        throw error;
    }
    return newConfig;
}

async function stopServers() {
    return new Promise((resolve) => {
        let httpStopped = !httpServer;
        let httpsStopped = !httpsServer;

        const checkDone = () => {
            if (httpStopped && httpsStopped) {
                clearAgentCache()
                logInfo("All servers stopped.");
                httpServer = null;
                httpsServer = null;
                resolve();
            }
        };

        if (httpServer) {
            httpServer.forceShutdown((e) => {
                if (e) logInfo('HTTP Proxy server close error: ', e);
                httpStopped = true;
                checkDone();
            })
            httpServer.unref();
        }
        if (httpsServer) {
            httpsServer.forceShutdown((e) => {
                if (e) logInfo('HTTPS Proxy server close error: ', e);
                httpsStopped = true;
                checkDone();
            })
            httpsServer.unref();
        }
        checkDone(); // In case servers were already null
    }).catch(e => logError('Error occurred on stop proxy server:', e));
}

export function handleServerError(err, serverType, port) {
    logError(`Error with ${serverType} server on port ${port}:`, err);
    let userMessage = `An error occurred with the ${serverType} server.`;
    if (err.code === 'EADDRINUSE') {
        userMessage = `Port ${port} for the ${serverType} server is already in use. Please change it in the configuration.`;
    } else if (err.message && err.message.includes("Root CA not loaded")) {
        userMessage = `Can not start ${serverType} server: Root CA is not loaded. HTTPS proxying will fail. Please check console.`;
    } else if (err.message && err.message.includes("Root CA is not exist")) {
        userMessage = `Can not start ${serverType} server: ${err.message}`;
    } else {
        userMessage = `Error occurred on ${serverType} server on port ${port}: ${err.message}.`;
    }

    // Attempt to stop servers cleanly if one fails to start
    stopServers().finally(() => {
        afterStopServer()
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy-status-update', {activeProfileIndex, error: userMessage});
        } else {
            dialog.showErrorBox(`${serverType} Server Error`, userMessage);
        }
    });
}

function attachFileOrUrlToWindow(window, fileName) {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${fileName}`)
    } else {
        window.loadFile(path.join(__dirname, `../renderer/${fileName}`))
    }
}

function addCommandToClipboard(downloadPath) {
    if (!downloadPath) return;
    const platform = os.platform();
    if (platform === 'darwin') {
        clipboard.clear()
        clipboard.writeText(`security delete-certificate -c "${CERT_COMMON_NAME}" ~/Library/Keychains/login.keychain-db 2> /dev/null || true; security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ${downloadPath}`)
    } else if (platform === 'win32') {
        clipboard.clear()
        clipboard.writeText(`Get-ChildItem Cert: -Recurse | Where-Object {$_.Subject -match "${CERT_COMMON_NAME}"} | Remove-Item 2>$null; certutil.exe -addstore -f "Root" "${downloadPath}"`)
    }
}

function createMainWindow(extraTask) {
    mainWindow = new BrowserWindow({
        width: 650,
        height: 700,
        resizable: false,
        fullscreenable: false,
        autoHideMenuBar: true,
        webPreferences: {
            devTools: !app.isPackaged,
            spellcheck: false,
            partition,
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    attachFileOrUrlToWindow(mainWindow, 'index.html');
    // mainWindow.webContents.openDevTools(); // For debugging

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (editorWindow) editorWindow.close();
        if (helpWindow) helpWindow.close();
    });

    mainWindow.webContents.on('did-finish-load', () => {
        if (firstRun) {
            loadConfig();
        }
        mainWindow.webContents.send('config-updated', currentConfig[0], {
            activeProfileIndex,
            ...(isConfigVersionOutdated(currentConfig[0], DEFAULT_CONFIG) ? {error: CONFIG_OUTDATED_MESSAGE}
                : {message: firstRun ? 'App loaded. Select a profile to start proxy.' : activeProfileIndex === -9 ? 'Proxy servers stopped. Select a profile to start.' : 'Proxy is running.'}),
        });
        firstRun = false;
        extraTask?.();
    });
}

const stopServerTask = (message) => async () => {
    await stopServers();
    afterStopServer();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proxy-status-update', {
            activeProfileIndex,
            message
        });
    }
}

const clearPartialData = async () => {
    return Promise.all([temporarySession.clearStorageData(), temporarySession.clearCache(), temporarySession.clearHostResolverCache()])
}

app.whenReady().then(() => {
    temporarySession = session.fromPartition(partition, {cache: false});
    createMainWindow(async () => {
        try {
            const ca = loadRootCA()
            const deadline = new Date(ca.validity.notAfter);
            deadline.setDate(deadline.getDate() - 30)
            if (deadline <= new Date()) {
                const options = {
                    type: 'warning',
                    title: 'CA is expiring',
                    message: `Your CA certificate is about to expire or already expired!\n${ASK_TO_RENEW_CA_LONG}`,
                };
                await dialog.showMessageBox(mainWindow, options);
            }
        } catch (e) {
            mainWindow.webContents.send('proxy-status-update', {error: e.message});
        } finally {
            startServers = getStartServers(mainWindow);
        }
    });

    powerMonitor.on('suspend', async () => {
        logInfo('System is about to suspend.');
        oldIndexAndDecided = [activeProfileIndex, decided];
        await clearPartialData();
    });

    powerMonitor.on('resume', async () => {
        logInfo('System has resumed from suspend.');
        const [localIndex, localDecided] = [...oldIndexAndDecided]
        await clearPartialData();
        if (localIndex !== -9) {
            await stopServers().finally(() => afterStopServer());
            await startProfile(localIndex, localDecided, RESTART.HIBERNATION);
        }
    });

    app.on('activate', async () => {
        await clearPartialData();
        if (!mainWindow || mainWindow?.isDestroyed()) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

const clearSession = async () => {
    await stopServers();
    afterStopServer();
    clearCertCache();
    await Promise.all([temporarySession, session.defaultSession].flatMap(session => [session.clearData(), session.clearCache(), session.clearHostResolverCache(),
        session.clearAuthCache(), session.clearSharedDictionaryCache(), session.clearCodeCaches({})]))
}

app.on('will-quit', async (event) => {
    // This is a final chance to stop servers if not already done
    event.preventDefault(); // Prevent immediate quit
    logInfo("Application is about to quit. Stopping servers...");
    await stopServers().finally(() => afterStopServer());
    app.exit(); // Now actually exit
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion() + ' R';
});

ipcMain.on('open-help', () => {
    if (helpWindow) {
        helpWindow.focus();
        return;
    }
    helpWindow = new BrowserWindow({
        width: 800,
        height: 650,
        title: 'Checkout-Proxy Help',
        fullscreenable: false,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            devTools: !app.isPackaged,
            spellcheck: false,
            partition,
            preload: path.join(__dirname, '../preload/preload.js'), // Re-use preload for simplicity
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    attachFileOrUrlToWindow(helpWindow, 'help.html');
    helpWindow.on('closed', () => helpWindow = null);

    // Send markdown content
    helpWindow.webContents.on('did-finish-load', () => {
        try {
            const mdContent = fs.readFileSync(getResourceFilePath('README.md'), 'utf-8');
            helpWindow.webContents.send('markdown-content', mdContent);
        } catch (e) {
            helpWindow.webContents.send('markdown-content', `# Error loading help content, error:${e.message}\nCould not read README.md`);
            logError("Error reading README.md:", e);
        }
    });
});

ipcMain.on('download-root-ca', async (event) => {
    await downloadRootCa(event).then(({downloadPath}) => {
        addCommandToClipboard(downloadPath)
    }).catch(e => {
        mainWindow.webContents.send('proxy-status-update', {
            message: e.message
        });
    });
});

async function downloadRootCa(event) {
    let downloadPath;
    if (!fs.existsSync(rootCertPath)) {
        logError('Root CA certificate file not found at:', rootCertPath);
        const errorMessge = `Root CA certificate file not found. ${ASK_TO_RENEW_CA_LONG}`
        throw {message: errorMessge}
    }
    try {
        const {canceled, filePath} = await dialog.showSaveDialog({
            title: 'Save Root CA Certificate',
            defaultPath: 'checkout-proxy-rootCA.crt',
            filters: [
                {name: 'Certificates', extensions: ['crt', 'pem', 'cer']},
                {name: 'All Files', extensions: ['*']}
            ]
        });

        if (!canceled && filePath) {
            const certContent = fs.readFileSync(rootCertPath); // Read as buffer or utf-8 if you prefer
            fs.writeFileSync(filePath, certContent);
            downloadPath = filePath;
        }
    } catch (error) {
        logError('Error during Root CA download:', error.message);
        dialog.showErrorBox('Download Error', `Failed to download Root CA certificate: ${error.message}.`);
    }
    return {downloadPath};
}


ipcMain.on('open-config-editor', () => {
    if (editorWindow) {
        editorWindow.focus();
        return;
    }
    editorWindow = new BrowserWindow({
        width: 850,
        height: 700,
        title: 'Edit Configuration',
        fullscreenable: false,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: true,
        webPreferences: {
            devTools: !app.isPackaged,
            spellcheck: false,
            partition,
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });
    attachFileOrUrlToWindow(editorWindow, 'editor.html');
    editorWindow.webContents.on('did-finish-load', () => {
        editorWindow.webContents.send('load-config-for-editing', {
            currentConfig: currentConfig[0],
            defaultConfig: DEFAULT_CONFIG
        });
    });
    editorWindow.on('closed', () => editorWindow = null);
});

ipcMain.handle('save-edited-config', async (event, newConfigJson) => {
    try {
        const tempConfig = checkConfig(newConfigJson);
        currentConfig[0] = saveConfig(tempConfig);
        reusableHackFunctions = instantiateReusableFunction(currentConfig[0]);
        await stopServers(); // Stop current servers
        afterStopServer()
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-updated', currentConfig[0], {
                activeProfileIndex,
                ...(isConfigVersionOutdated(currentConfig[0], DEFAULT_CONFIG) ? {error: CONFIG_OUTDATED_MESSAGE} : {message: 'Config saved. Please select a profile to start.'}),
            });
        }
        return {success: true};
    } catch (e) {
        logError("Error saving edited config:", e);
        return {success: false, error: e.message};
    }
});

ipcMain.on('import-config', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{name: 'JSON Files', extensions: ['json']}]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        try {
            const filePath = result.filePaths[0];
            const fileData = fs.readFileSync(filePath, 'utf-8');
            const tempConfig = checkConfig(fileData);
            currentConfig[0] = saveConfig(tempConfig); // Overwrites the app's managed JSON and sends 'config-updated'
            reusableHackFunctions = instantiateReusableFunction(currentConfig[0]);
            await stopServers();
            afterStopServer();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('config-updated', currentConfig[0], {
                    activeProfileIndex,
                    message: 'Proxy stopped due to new config imported. Select a profile to start.'
                });
            }
            await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Import Successful',
                message: 'Configuration imported successfully.'
            });
        } catch (e) {
            logError('Error importing config:', e);
            dialog.showErrorBox('Import Error', `Failed to import configuration: ${e.message}`);
        }
    }
});

ipcMain.on('export-config', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Configuration',
        defaultPath: 'checkout-proxy-export.json',
        filters: [{name: 'JSON Files', extensions: ['json']}]
    });
    if (!result.canceled && result.filePath) {
        try {
            fs.writeFileSync(result.filePath, JSON.stringify(currentConfig[0], null, 2));
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Export Successful',
                message: `Configuration exported to ${result.filePath}`
            });
        } catch (e) {
            logError('Error exporting config:', e);
            dialog.showErrorBox('Export Error', `Failed to export configuration: ${e.message}`);
        }
    }
});

ipcMain.on('stop-proxy-servers', stopServerTask('Proxy servers stopped by user.'));

ipcMain.on('close-window', (event, windowName) => {
    if (windowName === EDITOR_WINDOW_NAME && editorWindow) {
        editorWindow.close();
    } else if (windowName === PROFILE_EDITOR_WINDOW_NAME && profileEditorWindow) {
        profileEditorWindow.close();
    } else if (windowName === HELP_WINDOW_NAME && helpWindow) {
        helpWindow.close();
    }
});

const replaceForStringOrArray = (placeHolders, item, decorator) => {
    if (typeof item === 'string') {
        return Object.entries(placeHolders || {}).reduce((acc, [placeHolderKey, placeHolderValue]) => {
            return acc.replaceAll(`{{${placeHolderKey}}}`, decorator ? `{${placeHolderValue}}` : placeHolderValue);
        }, item);
    } else if (Array.isArray(item)) {
        return item.map(subItem => replaceForStringOrArray(placeHolders, subItem, decorator));
    }
    return item;
}

const replacePlaceholdersForRules = (placeHolders, defaultPort) => (acc, [ruleKey, ruleValue]) => {
    let newRuleKey = ruleKey;
    let newRuleValue = ruleValue;
    // replace placeholders in rule key and rule value
    newRuleKey = replaceForStringOrArray(placeHolders, newRuleKey)
    newRuleKey = newRuleKey.includes(':') ? newRuleKey : `${newRuleKey}:${defaultPort}`;
    newRuleValue = Object.entries(newRuleValue || {}).reduce((ruleItemAcc, [key, value]) => {
        ruleItemAcc[key] = replaceForStringOrArray(placeHolders, value);
        return ruleItemAcc;
    }, Object.create(null));
    newRuleValue.hackRequest = replaceForStringOrArray(placeHolders, newRuleValue.hackRequest) || [];
    newRuleValue.hackResponse = replaceForStringOrArray(placeHolders, newRuleValue.hackResponse) || [];
    acc[newRuleKey] = newRuleValue;
    return acc;
}

function prepareProfile(config, profileIndex, toBeDecided, reusableHackFunctions) {
    let profile = config.profile[profileIndex];
    if (!profile) {
        return null;
    }
    profile = JSON.parse(JSON.stringify(profile));
    profile.proxy = profile.proxy || {};
    const placeholders = {...(config.globalSettings?.substitute ?? {}), ...(profile.substitute ?? {}), ...(toBeDecided ?? {})};

    //copy and filter global profile set
    const globalProfileSet = (profile.proxy.globalProfile || []).reduce((acc, value) => {
        const newValue = replaceForStringOrArray(placeholders, value);
        if (config.globalSettings?.profileSet?.[newValue]) acc[newValue] = JSON.parse(JSON.stringify(config.globalSettings.profileSet[newValue]));
        return acc;
    }, Object.create(null));

    // replace placeholders in profile
    profile.name = replaceForStringOrArray(placeholders, profile.name, true);
    profile.proxy.proxyUrl = replaceForStringOrArray(placeholders, profile.proxy.proxyUrl);
    profile.proxy.hostUsingProxy = replaceForStringOrArray(placeholders, profile.proxy.hostUsingProxy);
    profile.proxy.hostBypassProxy = replaceForStringOrArray(placeholders, profile.proxy.hostBypassProxy);
    profile.proxy.httpsFixedRule = Object.entries(profile.proxy.httpsFixedRule || {}).reduce(replacePlaceholdersForRules(placeholders, '443'), Object.create(null));
    profile.proxy.httpFixedRule = Object.entries(profile.proxy.httpFixedRule || {}).reduce(replacePlaceholdersForRules(placeholders, '80'), Object.create(null));
    Object.entries(globalProfileSet).forEach(([ruleName, rule]) => {
        globalProfileSet[ruleName].httpsFixedRule = Object.entries(globalProfileSet[ruleName].httpsFixedRule || {}).reduce(replacePlaceholdersForRules(placeholders, '443'), Object.create(null));
        globalProfileSet[ruleName].httpFixedRule = Object.entries(globalProfileSet[ruleName].httpFixedRule || {}).reduce(replacePlaceholdersForRules(placeholders, '80'), Object.create(null));
    });

    // merge global profile set to profile
    (profile.proxy.globalProfile || []).filter(g => globalProfileSet[g]).forEach((globalRuleName) => {
        const globalRule = globalProfileSet[globalRuleName];
        [[globalRule.httpFixedRule, profile.proxy.httpFixedRule], [globalRule.httpsFixedRule, profile.proxy.httpsFixedRule]].forEach(
            ([globalFixedRule, profileFixedRule]) => {
                Object.entries(globalFixedRule || {}).forEach(([domain, globalFixedPerRule]) => {
                    const profileFixedPerRule = profileFixedRule[domain];
                    if (!profileFixedPerRule) {
                        profileFixedRule[domain] = globalFixedPerRule;
                    } else {
                        profileFixedPerRule.hackRequest = [...globalFixedPerRule.hackRequest || [], ...profileFixedPerRule.hackRequest || []];
                        profileFixedPerRule.hackResponse = [...globalFixedPerRule.hackResponse || [], ...profileFixedPerRule.hackResponse || []]
                    }
                })
            }
        )
    });

    // instantiate hack functions
    [...Object.values(profile.proxy.httpFixedRule), ...Object.values(profile.proxy.httpsFixedRule)].forEach((newRuleValue) => {
        newRuleValue.hackRequest = createHackFunction(reusableHackFunctions, newRuleValue.hackRequest);
        newRuleValue.hackResponse = createHackFunction(reusableHackFunctions, newRuleValue.hackResponse, (_, arg) => arg);
    });
    return profile;
}

async function startProfile(profileIndex, toBeDecided, isRestart) {
    oldIndexAndDecided = [-9, {}]
    logInfo(`Attempting to start profile index: ${profileIndex}`);
    if (profileIndex === -1 || (profileIndex >= 0 && profileIndex < currentConfig[0].profile.length)) {
        let profile;
        try {
            profile = prepareProfile(currentConfig[0], profileIndex, toBeDecided, reusableHackFunctions)
            logInfo(JSON.stringify(profile, null, 2))
        } catch (error) {
            logError(`Error preparing profile at index ${profileIndex}:`, error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('proxy-status-update', {error: `Failed to prepare placeholders and functions for profile: ${error.message}`});
            }
            return;
        }
        try {
            const {
                startedHttpServer,
                startedHttpsServer,
                usingFallbackCert
            } = await startServers(currentConfig[0].appPort, profile);
            httpServer = startedHttpServer;
            httpsServer = startedHttpsServer;
            activeProfileIndex = profileIndex;
            decided = toBeDecided || {};
            if (mainWindow && !mainWindow.isDestroyed()) {
                const message = {activeProfileIndex, toBeDecided, profileName: profile?.name ?? undefined};
                const configVersionOutdated = isConfigVersionOutdated(currentConfig[0], DEFAULT_CONFIG);
                const restartMessage = isRestart === RESTART.NORMAL ? 'restarted' : isRestart === RESTART.HIBERNATION ? 'restarted from hibernation' : 'started'
                if (usingFallbackCert || configVersionOutdated) {
                    message.warning = `Proxy service ${restartMessage} ${usingFallbackCert ? `with a fallback CA certificate. ${ASK_TO_RENEW_CA}` : '.'} ${configVersionOutdated ? CONFIG_OUTDATED_MESSAGE : ''}`
                } else {
                    message.message = `Proxy service ${restartMessage} successfully!`
                }
                mainWindow.webContents.send('proxy-status-update', message);
            }
        } catch (error) {
            handleServerError(error, 'HTTPS');
        }
    } else {
        logError(`Invalid profile index: ${profileIndex}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy-status-update', {error: `Invalid profile selected.`});
        }
    }
}

ipcMain.on('start-proxy-profile', async (event, profileIndex, toBeDecided) => {
    await stopServers();
    afterStopServer();
    await startProfile(profileIndex, toBeDecided, RESTART.NONE);
});

ipcMain.on('edit-proxy-profile', async (event, profileIndex) => {
    if (profileEditorWindow) {
        profileEditorWindow.focus();
        return;
    }
    profileEditorWindow = new BrowserWindow({
        width: 850,
        height: 700,
        title: 'Edit Profile',
        fullscreenable: false,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: true,
        webPreferences: {
            devTools: !app.isPackaged,
            spellcheck: false,
            partition,
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });
    attachFileOrUrlToWindow(profileEditorWindow, 'profile-editor.html');
    profileEditorWindow.webContents.on('did-finish-load', () => {
        profileEditorWindow.webContents.send('load-config-for-editing', {
            currentConfig: currentConfig[0],
            defaultConfig: DEFAULT_CONFIG,
            index: profileIndex
        });
    });
    profileEditorWindow.on('closed', () => profileEditorWindow = null);

});

ipcMain.handle('save-edited-profile', async (event, globalSettings, newProfileJson, index, asNew) => {
    let restartServers = false;
    const oldActiveProfileIndex = activeProfileIndex;
    try {
        const tempConfig = JSON.parse(JSON.stringify(currentConfig[0]));
        if (asNew === null) {
            tempConfig.profile.splice(index, 1); // Remove profile at index
        } else {
            const newProfile = checkProfile(newProfileJson);
            const newGlobalSettings = checkGlobalSettings(globalSettings);
            if (asNew) {
                tempConfig.profile.splice(index + 1, 0, newProfile); // Insert new profile at index
            } else {
                tempConfig.profile[index] = newProfile; // Update existing profile
                if (!newProfile.toBeDecided?.length > 0) restartServers = true;
            }
            tempConfig.globalSettings = newGlobalSettings;
        }
        currentConfig[0] = saveConfig(tempConfig);
        reusableHackFunctions = instantiateReusableFunction(currentConfig[0]);
        await stopServers();
        afterStopServer();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-updated', currentConfig[0], {
                    activeProfileIndex,
                    ...(isConfigVersionOutdated(currentConfig[0], DEFAULT_CONFIG) ? {error: CONFIG_OUTDATED_MESSAGE} : {message: 'Config saved. Please select a profile to start proxy.'})
                }
            );
        }
    } catch (e) {
        logError("Error saving edited profile:", e);
        return {success: false, error: e.message};
    }
    if (restartServers && oldActiveProfileIndex === index) {
        await startProfile(index, {}, RESTART.NORMAL);
    }
    return {success: true};
});

ipcMain.handle('open-reset-options', async () => {
    try {
        const focusedWindow = BrowserWindow.getFocusedWindow() || editorWindow;
        const options = {
            type: 'question',
            buttons: ['Reset text area to factory config', 'Restore text area from backup', 'Backup current text area', 'Cancel'],
            defaultId: 3,
            title: 'reset options',
            message: 'Please choose an option:',
        };
        const {response} = await dialog.showMessageBox(focusedWindow, options);
        return response;
    } catch (error) {
        logError('[open-reset-options] Failed to show choice dialog:', error);
        return -1;
    }
});

ipcMain.handle('minify-function', async (event, source) => {
    try {
        const functionObject = await compressToObject(source);
        return {success: true, content: functionObject};
    } catch (error) {
        return {success: false, error: error.message}
    }
});

ipcMain.handle('format-function', async (event, compressedObject) => {
    try {
        const formattedFunction = await restoreFromCompressedObject(compressedObject);
        return {success: true, content: formattedFunction};
    } catch (error) {
        return {success: false, error: error.message}
    }
});

ipcMain.handle('execute-reset-option', async (event, action, editedConfig) => {
    try {
        if (action === 0) {
            const defaultConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            logInfo('Configuration has been reset to Factory Config.');
            return {
                success: true,
                defaultConfig,
                message: 'Text area is reset to Factory Config. You can now click [Save and Close] to apply.'
            };
        } else if (action === 1) {
            if (!fs.existsSync(userDefaultConfigFilePath)) {
                return {
                    success: false,
                    error: 'Please do [Backup current text area] first, then you can recover from it.'
                };
            }
            const defaultConfigString = fs.readFileSync(userDefaultConfigFilePath, 'utf-8');
            const defaultConfig = JSON.parse(defaultConfigString);
            logInfo('Configuration has been restored from backup.');
            return {
                success: true,
                defaultConfig,
                message: 'Text area is restored from backup. You can now edit it or click [Save and Close].'
            };
        } else if (action === 2) {
            const configObj = checkConfig(editedConfig);
            fs.writeFileSync(userDefaultConfigFilePath, JSON.stringify(configObj, null, 2));
            logInfo('Current text is backed up to:', userDefaultConfigFilePath);
            return {success: true, message: 'Backup completed successfully.'};
        }
    } catch (error) {
        logError(`[execute-reset-option] Action ${action} failed due to:`, error);
        return {success: false, error: error.message};
    }
});

ipcMain.handle('open-more-options', async () => {
    try {
        const focusedWindow = BrowserWindow.getFocusedWindow() || profileEditorWindow;
        const options = {
            type: 'question',
            buttons: ['Save as new profile and Close', 'Remove current profile', 'Cancel'],
            defaultId: 2,
            title: 'more options',
            message: 'Please choose an option(changed global settings will be abolished if you remove current profile):',
        };
        const {response} = await dialog.showMessageBox(focusedWindow, options);
        return response;
    } catch (error) {
        logError('[open-more-options] Failed to show choice dialog:', error);
        return -1;
    }
});

ipcMain.handle('open-main-more-options', async () => {
    try {
        const focusedWindow = BrowserWindow.getFocusedWindow() || mainWindow;
        let systemProxyOn = null;
        try {
            const {isEnabled} = await systemProxyManager.getProxyStatus()
            systemProxyOn = isEnabled;
        } catch (e) {
            logError(e)
        }
        const options = {
            type: 'question',
            buttons: ['Open Help Window', GENERATE_CERT_BUTTON_NAME, 'Download CA Certificate', ...(systemProxyOn !== null ? [`Toggle System Proxy ${systemProxyOn ? 'OFF' : 'ON'}`] : []), 'Clear App Cache', 'Cancel'],
            defaultId: 0,
            title: 'more options',
            message: 'Please choose an option:',
        };
        const {response} = await dialog.showMessageBox(focusedWindow, options);
        if (response === 0) {
            ipcMain.emit('open-help')
        } else if (response === 1) {
            const options = {
                type: 'warning',
                buttons: ['Continue', 'Cancel'],
                defaultId: 1,
                title: 'Confirm',
                message: 'This will abolish the existing CA and generate a new one with a validity of 20 months.\n' +
                    'Are you sure to continue?',
            };
            const {response: response2} = await dialog.showMessageBox(focusedWindow, options);
            if (response2 === 0) {
                try {
                    const {key, cert, keyIdentifier} = generateRootCA();
                    await writeRootCA(key, cert);
                    loadRootCA(key, cert, keyIdentifier)
                    await stopServers();
                    afterStopServer();
                } catch (e) {
                    mainWindow.webContents.send('proxy-status-update', {
                        error: e.message
                    });
                    return response;
                }
                try {
                    clearCertCache();
                    startServers = getStartServers(mainWindow);
                    const command = getInstallCommand(rootCertPath);
                    await execute(command).catch(async e => {
                        dialog.showMessageBox({
                            type: 'warning',
                            title: 'Fail to trust',
                            message: `Fail to trust CA.\n You can still trust it manually by [Download CA certificate] or retry [${GENERATE_CERT_BUTTON_NAME}].`
                        });
                        throw {message: `New CA is not trusted. Browser may block the response.`}
                    })
                } catch (e) {
                    mainWindow.webContents.send('proxy-status-update', {
                        error: e.message, activeProfileIndex
                    });
                    return response;
                }
                mainWindow.webContents.send('proxy-status-update', {
                    message: 'CA is trusted successfully! Please choose a profile to restart proxy.',
                    activeProfileIndex
                })
            }
        } else if (response === 2) {
            await downloadRootCa().then(({downloadPath}) => {
                if (downloadPath) {
                    addCommandToClipboard(downloadPath);
                    dialog.showMessageBox({
                        type: 'info',
                        title: 'Downloaded',
                        message: `Succeeded.\nCommand for adding CA is copied!`
                    });
                }
            }).catch(e => {
                mainWindow.webContents.send('proxy-status-update', {
                    error: e.message
                });
            })
        } else if (response === 3 && systemProxyOn !== null) {
            try {
                if (systemProxyOn) {
                    await systemProxyManager.disableSystemProxy()
                } else {
                    await systemProxyManager.enableSystemProxy('127.0.0.1', currentConfig[0].appPort[0])
                }
                mainWindow.webContents.send('proxy-status-update', {message: `System proxy toggled ${systemProxyOn ? 'OFF' : 'ON'} successfully!`})
            } catch (e) {
                mainWindow.webContents.send('proxy-status-update', {error: e.message})
            }

        } else if ((response === (systemProxyOn !== null ? 4 : 3))) {
            await clearSession();
            mainWindow.webContents.send('proxy-status-update', {message: 'Cache cleared successfully! Please restart server.'})
        }
        return response;
    } catch (error) {
        logError('[open-main-more-options] Failed to show choice dialog:', error);
        return -1;
    }
});

ipcMain.on('open-external-link', (event, url) => {
    shell.openExternal(url).catch(err => logError('Failed to open external link:', err));
});

process.on('uncaughtException', (err) => {
    logError('uncaughtException occurred:', err);
});

process.on('unhandledRejection', (reason) => {
    logError('Unhandled rejection:', reason);
});

app.on('render-process-gone', (event, webContents, details) => {
    logError('Render process gone:', details);
    if (details.reason === 'crashed') {
        webContents.reload();
    }
});

app.on('child-process-gone', (event, details) => {
    logError('Child process gone:', details);
})

process.on('warning', e => console.warn(e.stack));
