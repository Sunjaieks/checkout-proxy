import {
    clearAgentCache,
    clearCertCache,
    generateRootCA,
    getRootCAString,
    getStartServers,
    loadRootCA,
    setConsoleLogCallback,
    setBodyStorageCallback,
    writeRootCA,
    setPaths
} from '../proxy/proxy-server.js';
import DEFAULT_CONFIG from '../constant/default-config.json' with { type: 'json' };
import {
    checkConfig,
    checkGlobalSettings,
    checkProfile,
    createHackFunction,
    getAiGuiSettings,
    getMcpServerSettings,
    isMcpServerSettingsChanged,
    getReusableHackFunctions,
    isConfigVersionOutdated,
    isPortInvalid,
    stringToColorArray,
    setDefaultField,
    isPortValid
} from '../util/sharedUtil.js';
import {
    activateTool,
    CERT_COMMON_NAME,
    execute,
    getInstallCommand,
    getResourceFilePath,
    getUserDataPath,
    logError,
    logInfo,
    logWarn
} from '../util/nodeUtil.js';
import { installCloudCliPreload, removeCloudCliPreload } from '../util/cloudcliPreload.js';
import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, session, shell } from 'electron';
import path from 'path';
import * as sudo from '@vscode/sudo-prompt';
import fs from 'fs';
import {
    AI_DESKTOP_WINDOW_NAME,
    AI_GUI_DEFAULT_COMMAND,
    AI_GUI_DEFAULT_PORT,
    ASK_TO_RENEW_CA,
    ASK_TO_RENEW_CA_LONG,
    CONFIG_OUTDATED_MESSAGE,
    CONSOLE_ROW_SIZE,
    CONSOLE_WINDOW_NAME,
    EDITOR_WINDOW_NAME,
    HELP_WINDOW_NAME,
    MCP_ENDPOINT_PATH,
    MCP_SERVER_NAME,
    PROFILE_EDITOR_WINDOW_NAME,
    PROFILE_VIEWER_WINDOW_NAME,
    RESTART,
    ONE_DAY_MS,
    ROOT_CA_NAME,
    ROOT_KEY_NAME,
    TOOLS_WINDOW_NAME,
    APPLY_DEFAULT_AI_DESKTOP
} from '../constant/constant.js';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { systemProxyManager } from '../proxy/system-proxy.js';
import { compressToObject, restoreFromCompressedObject } from '../generator/generator.js';
import * as dns from 'node:dns';
import crypto from 'node:crypto';
import iconv from 'iconv-lite';
import {
    checkForUpdates,
    conditionalSnooze,
    getDownloadPageUrl,
    skipVersion,
    snoozeUpdates
} from '../updater/updater.js';
import {
    getConsoleSettings,
    getLastActiveProfile,
    getUrlToolSettings,
    saveConsoleSettings,
    saveLastActiveProfile,
    saveUrlToolSettings
} from '../store/app-store.js';
import {
    createProxyMcpController,
    toSerializableProfile,
    EDITABLE_GLOBAL_SETTINGS_KEYS
} from '../mcp/proxy-mcp-controller.js';
import { createMcpServer } from '../mcp/mcp-server.js';

app.commandLine.appendSwitch('disable-http2');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('dns-result-order', 'ipv4first');
app.commandLine.appendSwitch('disable-autofill');
app.commandLine.appendSwitch('disable-password-generation');
// Chromium >=M149 (cc/base/features.cc kSnapFlingNearExtremes, crbug.com/507028423) lets a fling
// that reaches the first/last scroll-snap-align target coast in on the native fling curve
// instead of the tuned snap-back animation. Our single-snap-point ".profiles-area-inner" bounce
// hack is always "the extreme", so every scroll there got a long, slow native-feeling coast
// instead of the crisp snap-back it had on Chromium 148 (Electron 42). This is an internal,
// unstable flag name (no --disable-features contract) that Chromium may rename or remove once
// the feature ships to 100%/is cleaned up — if the bounce slows down again after an Electron
// bump, check whether this flag still exists/does anything before re-diagnosing from scratch.
app.commandLine.appendSwitch('disable-features', 'SnapFlingNearExtremes');

dns.setDefaultResultOrder('ipv4first');

activateTool(app, sudo);

let temporarySession;
let mainWindow;
let editorWindow;
let profileEditorWindow;
let profileViewerWindow;
let helpWindow;
let urlToolWindow;
let consoleWindow;
let aiDesktopWindow;

let cloudcliProcess = null;
let cloudcliConfig = { command: null, port: null };
const aiDesktopPartition = 'persist:ai-desktop';

let httpServer;
let httpsServer;
const currentConfig = [null, null];
let profileColors = [];
let reusableHackFunctions = {};
let activeProfileIndex = -9;
let decided = {};
let currentPreparedProfile = null;
let startServers;
let oldIndexAndDecided = [-9, {}];
let firstRun = true;
let startedProfileName = null;
let copiedRule = null;
let consoleLogBuffer = new Map();
let bodyStorage = new Map(); // Separate storage for request/response bodies

// MCP (Model Context Protocol) server: lets AI clients control proxy profiles.
// Lives for the whole app session, independent of which proxy profile is running.
let mcpServerInstance = null;
// The MCP settings the server was last (re)configured with, and whether that attempt
// failed — together they decide when a configuration save has to rebind the server.
let mcpAppliedSettings = null;
let mcpStartFailed = false;
let mcpController = null;

const partition = 'temporary-session';
const userDataPath = getUserDataPath();
const CONFIG_FILE_NAME = 'checkout-proxy-config-v1.json';
const USER_DEFAULT_CONFIG_FILE_NAME = 'checkout-proxy-user-default-config-v1.json';
const userDefaultConfigFilePath = path.join(userDataPath, USER_DEFAULT_CONFIG_FILE_NAME);
const configFilePath = path.join(userDataPath, CONFIG_FILE_NAME);
const rootCertPath = path.join(userDataPath, ROOT_CA_NAME);
const rootKeyPath = path.join(userDataPath, ROOT_KEY_NAME);
const mdContent = fs.readFileSync(getResourceFilePath('README.md'), 'utf-8');

setPaths(rootCertPath, rootKeyPath);

// Set up console log callback to send request logs to console window
setConsoleLogCallback((logEntry) => {
    const normalizedEntry = { ...logEntry };
    const entryId = normalizedEntry.__ID__;
    if (typeof entryId === 'undefined' || entryId === null) {
        return;
    }

    if (consoleLogBuffer.has(entryId)) {
        consoleLogBuffer.set(entryId, {
            ...consoleLogBuffer.get(entryId),
            ...normalizedEntry
        });
    } else {
        // Only create a new buffer entry for initial entries (those with a timestamp).
        // Late updates for entries already evicted from the buffer are discarded to
        // prevent incomplete "zombie" entries that lack timestamp/host/method/etc.
        if (!normalizedEntry.timestamp) return;
        consoleLogBuffer.set(entryId, normalizedEntry);
    }

    if (consoleLogBuffer.size % 2 === 0) {
        while (consoleLogBuffer.size > CONSOLE_ROW_SIZE) {
            const oldestKey = consoleLogBuffer.keys().next().value;
            consoleLogBuffer.delete(oldestKey);
            // Also clean up body storage for removed entries
            bodyStorage.delete(oldestKey);
        }
    }
    // Send to console window if open
    if (consoleWindow && !consoleWindow.isDestroyed()) {
        consoleWindow.webContents.send('console-request-log', logEntry);
    }
});

// Set up body storage callback to store request/response bodies separately
setBodyStorageCallback((entryId, type, body) => {
    if (typeof entryId === 'undefined' || entryId === null) return;
    if (!consoleLogBuffer.has(entryId)) return;

    let entryBodies = bodyStorage.get(entryId);
    if (!entryBodies) {
        entryBodies = {};
        bodyStorage.set(entryId, entryBodies);
    }
    entryBodies[type] = body;
});

const afterStopServer = () => {
    const oldIndex = activeProfileIndex;
    oldIndexAndDecided = [-9, {}];
    activeProfileIndex = -9; // Mark no profile as active
    decided = {};
    currentPreparedProfile = null;
    startedProfileName = null;
    return oldIndex;
};

function loadConfig() {
    try {
        if (fs.existsSync(configFilePath)) {
            const fileData = fs.readFileSync(configFilePath, 'utf-8');
            currentConfig[0] = JSON.parse(fileData);
            profileColors = getProfileColorArray(currentConfig[0]);
            logInfo('Configuration loaded from:', configFilePath);
        } else {
            currentConfig[0] = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            profileColors = getProfileColorArray(currentConfig[0]);
            fs.writeFileSync(configFilePath, JSON.stringify(currentConfig[0], null, 2));
            logInfo('Default configuration created at:', configFilePath);
        }
    } catch (error) {
        logError('Error loading or creating config:', error);
        dialog.showErrorBox('Configuration Error', `Failed to load configuration: ${error.message}. Using default.`);
        currentConfig[0] = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        profileColors = getProfileColorArray(currentConfig[0]);
    }
    // Ensure appPort is valid
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

function getProfileColorArray(config) {
    return (config.profile ?? []).reduce((acc, cur) => {
        acc.push(stringToColorArray(cur.name));
        return acc;
    }, []);
}

function saveConfig(newConfig) {
    try {
        setDefaultField(newConfig);
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
                clearAgentCache();
                logInfo('All servers stopped.');
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
            });
            httpServer.unref();
        }
        if (httpsServer) {
            httpsServer.forceShutdown((e) => {
                if (e) logInfo('HTTPS Proxy server close error: ', e);
                httpsStopped = true;
                checkDone();
            });
            httpsServer.unref();
        }
        checkDone(); // In case servers were already null
    }).catch((e) => logError('Error occurred on stop proxy server:', e));
}

function serverErrorCallback(err, serverType, port) {
    logError(`Error with ${serverType} server on port ${port}:`, err);
    let userMessage = `An error occurred with the ${serverType} server.`;
    if (err.code === 'EADDRINUSE') {
        userMessage = `Port ${port} for the ${serverType} server is already in use. Please change it in the configuration.`;
    } else if (err.message && err.message.includes('Root CA not loaded')) {
        userMessage = `Can not start ${serverType} server: Root CA is not loaded. HTTPS proxying will fail. Please check console.`;
    } else if (err.message && err.message.includes('Root CA is not exist')) {
        userMessage = `Can not start ${serverType} server: ${err.message}`;
    } else {
        userMessage = `Error occurred on ${serverType} server on port ${port}: ${err.message}.`;
    }

    // Attempt to stop servers cleanly if one fails to start
    stopServers().finally(() => {
        afterStopServer();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy-status-update', { activeProfileIndex, error: userMessage });
        } else {
            dialog.showErrorBox(`${serverType} Server Error`, userMessage);
        }
    });
}

function errorStateCallback(error, keepIconColor) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proxy-status-update', {
            error,
            keepIconColor
        });
    }
}

function attachFileOrUrlToWindow(window, fileName) {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${fileName}`);
    } else {
        window.loadFile(path.join(__dirname, `../renderer/${fileName}`));
    }
}

function addCommandToClipboard(downloadPath) {
    if (!downloadPath) return;
    const platform = os.platform();
    if (platform === 'darwin') {
        clipboard.clear();
        clipboard.writeText(
            `security delete-certificate -c "${CERT_COMMON_NAME}" ~/Library/Keychains/login.keychain-db 2> /dev/null || true; security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ${downloadPath}`
        );
    } else if (platform === 'win32') {
        clipboard.clear();
        clipboard.writeText(
            `Get-ChildItem Cert: -Recurse | Where-Object {$_.Subject -match "${CERT_COMMON_NAME}"} | Remove-Item 2>$null; certutil.exe -addstore -f "Root" "${downloadPath}"`
        );
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
        editorWindow?.close();
        helpWindow?.close();
        consoleWindow?.close();
        urlToolWindow?.close();
        profileViewerWindow?.close();
        if (process.platform !== 'darwin') {
            aiDesktopWindow?.close();
        }
    });

    mainWindow.webContents.on('did-finish-load', () => {
        if (firstRun) {
            loadConfig();
        }
        mainWindow.webContents.send('config-updated', currentConfig[0], profileColors, {
            activeProfileIndex,
            toBeDecided: decided,
            profileName: startedProfileName,
            ...(isConfigVersionOutdated(currentConfig[0], DEFAULT_CONFIG)
                ? { error: CONFIG_OUTDATED_MESSAGE }
                : {
                      message: firstRun
                          ? 'App loaded. Select a profile to start proxy.'
                          : activeProfileIndex === -9
                            ? 'Proxy servers stopped. Select a profile to start.'
                            : 'Proxy is running.'
                  })
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
};

const clearPartialData = async () => {
    return Promise.all([
        temporarySession.clearStorageData(),
        temporarySession.clearCache(),
        temporarySession.clearHostResolverCache()
    ]);
};

app.whenReady().then(() => {
    temporarySession = session.fromPartition(partition, { cache: false });
    createMainWindow(async () => {
        // Bring up the MCP server as soon as config is loaded; it is independent
        // of the proxy/CA lifecycle and should stay available for the whole session.
        await restartMcpServer();
        let preventRestart = false;
        try {
            const ca = loadRootCA();
            if (ca.validity.notAfter.getTime() - Date.now() < 30 * ONE_DAY_MS) {
                preventRestart = true;
                const options = {
                    type: 'warning',
                    title: 'CA is expiring',
                    message: `Your CA certificate is about to expire or already expired!\n${ASK_TO_RENEW_CA_LONG}`
                };
                await dialog.showMessageBox(mainWindow, options);
            }
        } catch (e) {
            preventRestart = true;
            mainWindow.webContents.send('proxy-status-update', { error: e.message });
        } finally {
            startServers = getStartServers(errorStateCallback, serverErrorCallback);
        }

        // Auto-start last active profile
        if (!preventRestart) {
            try {
                const lastActive = getLastActiveProfile();
                if (lastActive && lastActive.index >= -1 && currentConfig[0]?.profile?.length > lastActive.index) {
                    logInfo('Auto-starting last active profile:', lastActive.index, lastActive.decided);
                    await startProfile(lastActive.index, lastActive.decided || {}, RESTART.NONE);
                }
            } catch (error) {
                logError('Error auto-starting last active profile:', error);
            }
        }

        // Check for updates
        setTimeout(async () => {
            try {
                const updateInfo = await checkForUpdates();
                if (updateInfo && mainWindow && !mainWindow.isDestroyed()) {
                    // Send update notification to renderer
                    mainWindow.webContents.send('update-available', updateInfo);
                    logInfo('Update notification sent to renderer:', updateInfo);
                }
            } catch (error) {
                logError('Error checking for updates:', error);
            }
        });
    });

    powerMonitor.on('suspend', async () => {
        logInfo('System is about to suspend.');
        oldIndexAndDecided = [activeProfileIndex, decided];
        await clearPartialData();
    });

    powerMonitor.on('resume', async () => {
        logInfo('System has resumed from suspend.');
        const [localIndex, localDecided] = [...oldIndexAndDecided];
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
    // Shut down the AI Desktop service and close its window before wiping its session.
    stopCloudCli();
    cloudcliConfig = { command: null, port: null };
    if (aiDesktopWindow && !aiDesktopWindow.isDestroyed()) {
        aiDesktopWindow.close();
    }
    try {
        removeCloudCliPreload(userDataPath);
    } catch (e) {
        logWarn('Could not delete the cloudcli preload script:', e);
    }
    const aiDesktopSession = session.fromPartition(aiDesktopPartition);
    await Promise.all(
        [temporarySession, session.defaultSession, aiDesktopSession].flatMap((s) => [
            s.clearData(),
            s.clearCache(),
            s.clearHostResolverCache(),
            s.clearAuthCache(),
            s.clearSharedDictionaryCache(),
            s.clearCodeCaches({})
        ])
    );
};

app.on('will-quit', async (event) => {
    // This is a final chance to stop servers if not already done
    event.preventDefault(); // Prevent immediate quit
    logInfo('Application is about to quit. Stopping servers...');
    // Save active profile state before quitting
    saveLastActiveProfile(activeProfileIndex, decided);
    await stopMcpServer();
    stopCloudCli();
    await stopServers().finally(() => afterStopServer());
    app.exit(); // Now actually exit
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion() + ' R';
});

ipcMain.handle('open-help', async () => {
    if (helpWindow) {
        helpWindow.focus();
        return { focused: true };
    }
    helpWindow = new BrowserWindow({
        width: 900,
        height: 800,
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
    helpWindow.on('closed', () => (helpWindow = null));

    // Send markdown content
    helpWindow.webContents.on('did-finish-load', () => {
        try {
            helpWindow.webContents.send('markdown-content', mdContent);
        } catch (e) {
            helpWindow.webContents.send(
                'markdown-content',
                `# Error loading help content, error:${e.message}\nCould not read README.md`
            );
            logError('Error reading README.md:', e);
        }
    });
    return { opened: true };
});

ipcMain.handle('download-root-ca', async (event) => {
    try {
        const { downloadPath } = await downloadRootCa(event);
        if (downloadPath) {
            addCommandToClipboard(downloadPath);
            dialog.showMessageBox({
                type: 'info',
                title: 'Downloaded',
                message: `Succeeded.\nCommand for adding CA is copied!`
            });
        }
        return { downloadPath };
    } catch (e) {
        mainWindow.webContents.send('proxy-status-update', {
            message: e.message
        });
        return { error: e.message };
    }
});

async function downloadRootCa(event) {
    let downloadPath;
    if (!fs.existsSync(rootCertPath)) {
        logError('Root CA certificate file not found at:', rootCertPath);
        const errorMessge = `Root CA certificate file not found. ${ASK_TO_RENEW_CA_LONG}`;
        throw { message: errorMessge };
    }
    try {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Root CA Certificate',
            defaultPath: 'checkout-proxy-rootCA.crt',
            filters: [
                { name: 'Certificates', extensions: ['crt', 'pem', 'cer'] },
                { name: 'All Files', extensions: ['*'] }
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
    return { downloadPath };
}

ipcMain.on('open-config-editor', () => {
    if (editorWindow) {
        editorWindow.focus();
        return;
    }
    editorWindow = new BrowserWindow({
        width: 850,
        height: 750,
        title: 'Edit Configuration',
        fullscreenable: false,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: true,
        show: false,
        webPreferences: {
            devTools: !app.isPackaged,
            spellcheck: false,
            partition,
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    // editorWindow.webContents.openDevTools();
    attachFileOrUrlToWindow(editorWindow, 'editor.html');
    // Defer showing until the form/editor has actually painted, so the window doesn't
    // appear as a blank/white flash while Ace and the config form finish initializing.
    editorWindow.once('ready-to-show', () => editorWindow.show());
    editorWindow.webContents.on('did-finish-load', () => {
        editorWindow.webContents.send('load-config-for-editing', {
            currentConfig: currentConfig[0],
            profileColor: profileColors,
            defaultConfig: DEFAULT_CONFIG,
            ruleCopied: !!copiedRule
        });
    });
    editorWindow.on('closed', () => (editorWindow = null));
});

ipcMain.handle('save-edited-config', async (event, newConfigJson) => {
    try {
        const tempConfig = checkConfig(newConfigJson);
        currentConfig[0] = saveConfig(tempConfig);
        profileColors = getProfileColorArray(currentConfig[0]);
        reusableHackFunctions = instantiateReusableFunction(currentConfig[0]);
        await stopServers(); // Stop current servers
        afterStopServer();
        applyMcpServerConfig().catch((e) => logError('Error applying MCP server config:', e));
        applyAiGuiOnConfigChange(); // Stop AI Desktop if guiCommand/guiPort changed
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-updated', currentConfig[0], profileColors, {
                activeProfileIndex,
                ...(isConfigVersionOutdated(currentConfig[0], DEFAULT_CONFIG)
                    ? { error: CONFIG_OUTDATED_MESSAGE }
                    : { message: 'Config saved. Please select a profile to start.' })
            });
        }
        return { success: true };
    } catch (e) {
        logError('Error saving edited config:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('copy-rule', (event, entry) => {
    copiedRule = entry;
    return { success: true };
});

ipcMain.handle('paste-rule', (event) => {
    return { rule: copiedRule };
});

ipcMain.handle('import-config', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        try {
            const filePath = result.filePaths[0];
            const fileData = fs.readFileSync(filePath, 'utf-8');
            const tempConfig = checkConfig(fileData);
            currentConfig[0] = saveConfig(tempConfig); // Overwrites the app's managed JSON and sends 'config-updated'
            profileColors = getProfileColorArray(currentConfig[0]);
            reusableHackFunctions = instantiateReusableFunction(currentConfig[0]);
            await stopServers();
            afterStopServer();
            applyMcpServerConfig().catch((e) => logError('Error applying MCP server config:', e));
            applyAiGuiOnConfigChange(); // Stop AI Desktop if guiCommand/guiPort changed
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('config-updated', currentConfig[0], profileColors, {
                    activeProfileIndex,
                    message: 'Proxy stopped due to new config imported. Select a profile to start.'
                });
            }
            await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Import Successful',
                message: 'Configuration imported successfully.'
            });
            return { success: true };
        } catch (e) {
            logError('Error importing config:', e);
            dialog.showErrorBox('Import Error', `Failed to import configuration: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
    return { success: false, canceled: true };
});

ipcMain.handle('export-config', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Configuration',
        defaultPath: 'checkout-proxy-export.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (!result.canceled && result.filePath) {
        try {
            fs.writeFileSync(result.filePath, JSON.stringify(currentConfig[0], null, 2));
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Export Successful',
                message: `Configuration exported to ${result.filePath}`
            });
            return { success: true, filePath: result.filePath };
        } catch (e) {
            logError('Error exporting config:', e);
            dialog.showErrorBox('Export Error', `Failed to export configuration: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
    return { success: false, canceled: true };
});

ipcMain.on('stop-proxy-servers', stopServerTask('Proxy servers stopped by user.'));

ipcMain.on('close-window', (event, windowName) => {
    if (windowName === EDITOR_WINDOW_NAME && editorWindow) {
        editorWindow.close();
    } else if (windowName === PROFILE_EDITOR_WINDOW_NAME && profileEditorWindow) {
        profileEditorWindow.close();
    } else if (windowName === HELP_WINDOW_NAME && helpWindow) {
        helpWindow.close();
    } else if (windowName === TOOLS_WINDOW_NAME && urlToolWindow) {
        urlToolWindow.close();
    } else if (windowName === CONSOLE_WINDOW_NAME && consoleWindow) {
        consoleWindow.close();
    } else if (windowName === PROFILE_VIEWER_WINDOW_NAME && profileViewerWindow) {
        profileViewerWindow.close();
    } else if (windowName === AI_DESKTOP_WINDOW_NAME && aiDesktopWindow) {
        aiDesktopWindow.close();
    }
});

const replaceForStringOrArray = (placeHolders, item, decorator) => {
    if (typeof item === 'string') {
        return Object.entries(placeHolders || {}).reduce((acc, [placeHolderKey, placeHolderValue]) => {
            return acc.replaceAll(`{{${placeHolderKey}}}`, decorator ? `{${placeHolderValue}}` : placeHolderValue);
        }, item);
    } else if (Array.isArray(item)) {
        return item.map((subItem) => replaceForStringOrArray(placeHolders, subItem, decorator));
    }
    return item;
};

const replacePlaceholdersForRules =
    (placeHolders, defaultPort) =>
    (acc, [ruleKey, ruleValue]) => {
        let newRuleKey = ruleKey;
        let newRuleValue = ruleValue;
        // replace placeholders in rule key and rule value
        newRuleKey = replaceForStringOrArray(placeHolders, newRuleKey);
        newRuleKey = newRuleKey.includes(':') ? newRuleKey : `${newRuleKey}:${defaultPort}`;
        newRuleValue = Object.entries(newRuleValue || {}).reduce((ruleItemAcc, [key, value]) => {
            ruleItemAcc[key] = replaceForStringOrArray(placeHolders, value);
            return ruleItemAcc;
        }, Object.create(null));
        newRuleValue.hackRequest = replaceForStringOrArray(placeHolders, newRuleValue.hackRequest) || [];
        newRuleValue.hackResponse = replaceForStringOrArray(placeHolders, newRuleValue.hackResponse) || [];
        acc[newRuleKey] = newRuleValue;
        return acc;
    };

function prepareProfile(config, profileIndex, toBeDecided, reusableHackFunctions) {
    let profile = config.profile[profileIndex];
    if (!profile) {
        return null;
    }
    profile = JSON.parse(JSON.stringify(profile));
    profile.proxy = profile.proxy || {};

    const globalSubstitute = Object.entries(config.globalSettings?.substitute ?? {}).reduce((acc, cur) => {
        acc[cur[0]] = replaceForStringOrArray(toBeDecided ?? {}, cur[1]);
        return acc;
    }, {});
    const profileSubstitute = Object.entries(profile.substitute ?? {}).reduce((acc, cur) => {
        acc[cur[0]] = replaceForStringOrArray(toBeDecided ?? {}, cur[1]);
        return acc;
    }, {});

    const placeholders = { ...globalSubstitute, ...profileSubstitute, ...(toBeDecided ?? {}) };

    //copy and filter global profile set
    const globalProfileSet = (profile.proxy.globalProfile || []).reduce((acc, value) => {
        const newValue = replaceForStringOrArray(placeholders, value);
        if (config.globalSettings?.profileSet?.[newValue])
            acc[newValue] = JSON.parse(JSON.stringify(config.globalSettings.profileSet[newValue]));
        return acc;
    }, Object.create(null));

    // replace placeholders in profile
    profile.name = replaceForStringOrArray(placeholders, profile.name, true);
    profile.color = profileColors[profileIndex];
    profile.proxy.proxyUrl = replaceForStringOrArray(placeholders, profile.proxy.proxyUrl);
    profile.proxy.hostUsingProxy = replaceForStringOrArray(placeholders, profile.proxy.hostUsingProxy);
    profile.proxy.hostBypassProxy = replaceForStringOrArray(placeholders, profile.proxy.hostBypassProxy);
    profile.proxy.httpsFixedRule = Object.entries(profile.proxy.httpsFixedRule || {}).reduce(
        replacePlaceholdersForRules(placeholders, '443'),
        Object.create(null)
    );
    profile.proxy.httpFixedRule = Object.entries(profile.proxy.httpFixedRule || {}).reduce(
        replacePlaceholdersForRules(placeholders, '80'),
        Object.create(null)
    );
    Object.entries(globalProfileSet).forEach(([ruleName, rule]) => {
        globalProfileSet[ruleName].httpsFixedRule = Object.entries(
            globalProfileSet[ruleName].httpsFixedRule || {}
        ).reduce(replacePlaceholdersForRules(placeholders, '443'), Object.create(null));
        globalProfileSet[ruleName].httpFixedRule = Object.entries(
            globalProfileSet[ruleName].httpFixedRule || {}
        ).reduce(replacePlaceholdersForRules(placeholders, '80'), Object.create(null));
    });

    // merge global profile set to profile
    (profile.proxy.globalProfile || [])
        .filter((g) => globalProfileSet[g])
        .forEach((globalRuleName) => {
            const globalRule = globalProfileSet[globalRuleName];
            [
                [globalRule.httpFixedRule, profile.proxy.httpFixedRule],
                [globalRule.httpsFixedRule, profile.proxy.httpsFixedRule]
            ].forEach(([globalFixedRule, profileFixedRule]) => {
                Object.entries(globalFixedRule || {}).forEach(([domain, globalFixedPerRule]) => {
                    const profileFixedPerRule = profileFixedRule[domain];
                    if (!profileFixedPerRule) {
                        profileFixedRule[domain] = globalFixedPerRule;
                    } else {
                        profileFixedPerRule.hackRequest = [
                            ...(globalFixedPerRule.hackRequest || []),
                            ...(profileFixedPerRule.hackRequest || [])
                        ];
                        profileFixedPerRule.hackResponse = [
                            ...(globalFixedPerRule.hackResponse || []),
                            ...(profileFixedPerRule.hackResponse || [])
                        ];
                    }
                });
            });
        });

    // instantiate hack functions
    [...Object.values(profile.proxy.httpFixedRule), ...Object.values(profile.proxy.httpsFixedRule)].forEach(
        (newRuleValue) => {
            newRuleValue.rawHackRequest = newRuleValue.hackRequest;
            newRuleValue.rawHackResponse = newRuleValue.hackResponse;
            newRuleValue.hackRequest = createHackFunction(reusableHackFunctions, newRuleValue.hackRequest);
            newRuleValue.hackResponse = createHackFunction(
                reusableHackFunctions,
                newRuleValue.hackResponse,
                (_, arg) => arg
            );
        }
    );

    profile.fromGlobal = { ...config.globalSettings?.others };
    return profile;
}

async function startProfile(profileIndex, toBeDecided, isRestart, extraMessage) {
    oldIndexAndDecided = [-9, {}];
    logInfo(`Attempting to start profile index: ${profileIndex}`);
    if (profileIndex === -1 || (profileIndex >= 0 && profileIndex < currentConfig[0].profile.length)) {
        let profile;
        try {
            profile = prepareProfile(currentConfig[0], profileIndex, toBeDecided, reusableHackFunctions);
            currentPreparedProfile = profile;
            logInfo(JSON.stringify(profile, null, 2));
        } catch (error) {
            logError(`Error preparing profile at index ${profileIndex}:`, error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('proxy-status-update', {
                    error: `Failed to prepare placeholders and functions for profile: ${error.message}`
                });
            }
            return { success: false, error: `Failed to prepare profile: ${error.message}` };
        }
        try {
            const { startedHttpServer, startedHttpsServer, usingFallbackCert } = await startServers(
                currentConfig[0].listenOn,
                currentConfig[0].appPort,
                profile
            );
            httpServer = startedHttpServer;
            httpsServer = startedHttpsServer;
            activeProfileIndex = profileIndex;
            decided = toBeDecided || {};
            // Must update unconditionally — this is read later by createMainWindow()'s
            // did-finish-load handler.
            startedProfileName = profile?.name;
            if (mainWindow && !mainWindow.isDestroyed()) {
                const message = { activeProfileIndex, toBeDecided: decided, profileName: startedProfileName };
                const configVersionOutdated = isConfigVersionOutdated(currentConfig[0], DEFAULT_CONFIG);
                const restartMessage =
                    isRestart === RESTART.NORMAL
                        ? 'restarted'
                        : isRestart === RESTART.HIBERNATION
                          ? 'restarted from hibernation'
                          : 'started';
                const firstMessage = extraMessage ? extraMessage + '<br/>' : '';
                if (usingFallbackCert || configVersionOutdated) {
                    message.warning = `${firstMessage}Proxy service ${restartMessage} ${usingFallbackCert ? `with a fallback CA certificate. ${ASK_TO_RENEW_CA}` : '.'} ${configVersionOutdated ? CONFIG_OUTDATED_MESSAGE : ''}`;
                } else {
                    message.message = `${firstMessage}Proxy service ${restartMessage} successfully!`;
                }
                mainWindow.webContents.send('proxy-status-update', message);
            }
            return { success: true };
        } catch (error) {
            serverErrorCallback(error, 'HTTPS');
            return { success: false, error: error?.message || 'Failed to start proxy servers.' };
        }
    } else {
        logError(`Invalid profile index: ${profileIndex}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy-status-update', { error: `Invalid profile selected.` });
        }
        return { success: false, error: 'Invalid profile selected.' };
    }
}

// Stop any running proxy, reset state, then start the requested profile fresh.
// Shared by the renderer IPC path and the MCP server so both behave identically.
// Returns startProfile's result object: { success, error? }.
async function startProfileFresh(profileIndex, toBeDecided, extraMessage) {
    await stopServers();
    const oldIndex = afterStopServer();
    return await startProfile(
        profileIndex,
        toBeDecided,
        oldIndex === profileIndex ? RESTART.NORMAL : RESTART.NONE,
        extraMessage
    );
}

ipcMain.on('start-proxy-profile', async (event, profileIndex, toBeDecided) => {
    await startProfileFresh(profileIndex, toBeDecided);
});

// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) server lifecycle.
// The controller bridges MCP tool calls to the very same operations the UI uses.
// The server runs for the whole app session so AI clients can drive the proxy.
// ---------------------------------------------------------------------------
function ensureMcpController() {
    if (mcpController) return mcpController;
    mcpController = createProxyMcpController({
        // Available profiles (name + toBeDecided spec) from the current config.
        getProfiles: () =>
            (currentConfig[0]?.profile ?? []).map((p) => ({ name: p?.name, toBeDecided: p?.toBeDecided })),
        // Current run status.
        getState: () => ({
            activeProfileIndex,
            profileName: startedProfileName,
            decided,
            isRunning: activeProfileIndex !== -9
        }),
        // Effective (prepared) profile of the running proxy, serialized for transport.
        getEffectiveProfile: () => toSerializableProfile(currentPreparedProfile),
        // Whole configuration JSON as stored on disk (deep-cloned so the MCP layer can
        // never mutate the live app config).
        getConfiguration: () => (currentConfig[0] ? JSON.parse(JSON.stringify(currentConfig[0])) : null),
        // The user guide (README) that teaches how to configure and use the app. Bundled as
        // an app resource and read on demand; the renderer's Help window uses the same file.
        getUsageGuide: () => {
            return mdContent || '';
        },
        // Reusable hack functions a profile can call. The live map is what is actually
        // registered at runtime; the factory map (default-config.json) is only used to mark
        // which of them are the shipped built-ins.
        getHackFunctions: () => ({
            current: currentConfig[0]?.reusableHackFunctions ?? {},
            factory: DEFAULT_CONFIG.reusableHackFunctions ?? {}
        }),
        // Start a profile (index -1 == Direct Connect) exactly like the UI does.
        start: async (index, toBeDecided) =>
            (await startProfileFresh(index, toBeDecided)) || { success: false, error: 'Unknown error.' },
        // Stop the proxy exactly like the UI "Stop" button.
        stop: async () => {
            await stopServerTask('Proxy servers stopped by MCP client.')();
            return { success: true };
        },
        // Add / replace / remove a single profile through the very same save operation the
        // profile-editor window uses. The current globalSettings are passed straight back in
        // (deep-cloned), so an MCP client can only ever rewrite the `profile` array —
        // globalSettings and reusableHackFunctions are structurally out of its reach.
        // One atomic write for a `manage_profile` call: the profile mutation (when `asNew` is
        // defined) and/or the editable globalSettings sections. `ai`, reusableHackFunctions
        // and appPort are preserved by saveMcpConfigChange, so they stay out of reach.
        saveProfile: async ({ index, profileJson, asNew, globalSettingsJson }) =>
            await saveMcpConfigChange({
                index,
                profileJson,
                asNew,
                globalSettingsJson:
                    globalSettingsJson === undefined || globalSettingsJson === null
                        ? undefined
                        : JSON.parse(JSON.stringify(globalSettingsJson))
            })
    });
    return mcpController;
}

async function stopMcpServer() {
    if (!mcpServerInstance) return;
    try {
        await mcpServerInstance.stop();
        logInfo('MCP server stopped.');
    } catch (e) {
        logError('Error stopping MCP server:', e);
    }
    mcpServerInstance = null;
}

// Bring the MCP server in line with the saved configuration, but only when its own
// settings actually changed. Every other save leaves it running untouched — restarting it
// from a save that an MCP client itself triggered (manage_profile) would deadlock: closing
// the server waits for the in-flight request, which is waiting for this save to return.
// `mcpStartFailed` still forces a retry so a save after freeing a busy port recovers.
async function applyMcpServerConfig() {
    const next = getMcpServerSettings(currentConfig[0]);
    if (!mcpStartFailed && !isMcpServerSettingsChanged(mcpAppliedSettings, next)) {
        logInfo('MCP server settings unchanged; leaving it running.');
        return;
    }
    await restartMcpServer();
}

// (Re)start the MCP server to match the current `ai.mcp*` config. Failure to
// bind (e.g. port in use) is non-fatal: proxy features keep working.
async function restartMcpServer() {
    await stopMcpServer();
    const settings = getMcpServerSettings(currentConfig[0]);
    mcpAppliedSettings = settings;
    mcpStartFailed = false;
    if (!settings.enabled || !isPortValid(settings.port)) {
        logInfo('MCP server is disabled by configuration or port is invalid; not starting.');
        return;
    }
    try {
        const controller = ensureMcpController();
        mcpServerInstance = createMcpServer({
            controller,
            host: settings.host,
            port: settings.port,
            serverInfo: { name: MCP_SERVER_NAME, version: app.getVersion() + ' R' },
            logger: { info: logInfo, error: logError }
        });
        await mcpServerInstance.start();
        logInfo(`MCP server available at http://${settings.host}:${settings.port}${MCP_ENDPOINT_PATH}`);
    } catch (e) {
        mcpServerInstance = null;
        mcpStartFailed = true;
        logError(`Failed to start MCP server on port ${settings.port}:`, e?.message || e);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy-status-update', {
                warning: `MCP server could not start on port ${settings.port}: ${e?.message || e}. Proxy features still work.`,
                activeProfileIndex
            });
        }
    }
}

ipcMain.on('edit-proxy-profile', async (event, profileIndex) => {
    if (profileEditorWindow) {
        profileEditorWindow.focus();
        return;
    }
    profileEditorWindow = new BrowserWindow({
        width: 850,
        height: 750,
        title: 'Edit Profile',
        fullscreenable: false,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: true,
        show: false,
        webPreferences: {
            devTools: !app.isPackaged,
            spellcheck: false,
            partition,
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    attachFileOrUrlToWindow(profileEditorWindow, 'profile-editor.html');
    // Defer showing until the profile form has actually painted, so the window doesn't
    // appear as a blank/white flash while the form finishes initializing.
    profileEditorWindow.once('ready-to-show', () => profileEditorWindow.show());
    profileEditorWindow.webContents.on('did-finish-load', () => {
        profileEditorWindow.webContents.send('load-config-for-editing', {
            currentConfig: currentConfig[0],
            profileColors,
            defaultConfig: DEFAULT_CONFIG,
            index: profileIndex,
            ruleCopied: !!copiedRule
        });
    });
    profileEditorWindow.on('closed', () => (profileEditorWindow = null));
});

// Apply one profile mutation to the configuration, persist it, and bring the proxy back
// to a consistent state. Shared by the profile-editor window and the MCP `manage_profile`
// tool so both behave identically.
//   asNew === null  -> remove the profile at `index`
//   asNew === true  -> insert `newProfileJson` immediately after `index`
//   asNew === false -> replace the profile at `index`
// Returns { success: true } or { success: false, error }.
// Persist one configuration change and bring the app back to a consistent state: validate,
// save to disk, refresh derived state, stop the proxy, re-apply the AI/MCP settings, notify
// the window, and restart the previously running profile when the change warrants it.
//
// `mutate` receives a deep clone of the live config plus the pre-change run state, applies
// the change, and returns whether the running profile should be restarted afterwards.
// Every write path (profile editor, MCP tools) goes through here so none of them can drift.
async function commitConfigChange(mutate, errorLabel) {
    const oldActiveProfileIndex = activeProfileIndex;
    const oldDecided = decided;
    let restartServers = false;
    try {
        const tempConfig = JSON.parse(JSON.stringify(currentConfig[0]));
        restartServers = mutate(tempConfig, { oldActiveProfileIndex, oldDecided }) === true;
        currentConfig[0] = saveConfig(tempConfig);
        profileColors = getProfileColorArray(currentConfig[0]);
        reusableHackFunctions = instantiateReusableFunction(currentConfig[0]);
        await stopServers();
        afterStopServer();
        applyMcpServerConfig().catch((e) => logError('Error applying MCP server config:', e));
        applyAiGuiOnConfigChange(); // Stop AI Desktop if guiCommand/guiPort changed
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-updated', currentConfig[0], profileColors, {
                activeProfileIndex,
                keepHistoryFor: restartServers ? oldActiveProfileIndex : -9,
                ...(isConfigVersionOutdated(currentConfig[0], DEFAULT_CONFIG)
                    ? { error: CONFIG_OUTDATED_MESSAGE }
                    : { message: 'Config saved. Please select a profile to start proxy.' })
            });
        }
    } catch (e) {
        logError(errorLabel, e);
        return { success: false, error: e.message };
    }
    if (restartServers) {
        await startProfile(oldActiveProfileIndex, oldDecided, RESTART.NORMAL);
    }
    return { success: true };
}

// Apply one profile mutation to the configuration. Shared by the profile-editor window and
// the MCP `manage_profile` tool so both behave identically.
//   asNew === null  -> remove the profile at `index`
//   asNew === true  -> insert `newProfileJson` immediately after `index`
//   asNew === false -> replace the profile at `index`
// Returns { success: true } or { success: false, error }.
async function saveEditedProfile(globalSettings, newProfileJson, index, asNew) {
    return commitConfigChange((tempConfig, { oldActiveProfileIndex, oldDecided }) => {
        if (asNew === null) {
            tempConfig.profile.splice(index, 1); // Remove profile at index
            return false;
        }
        let restartServers = false;
        const newProfile = checkProfile(newProfileJson);
        const newGlobalSettings = checkGlobalSettings(globalSettings);
        if (asNew) {
            tempConfig.profile.splice(index + 1, 0, newProfile); // Insert new profile at index
        } else {
            tempConfig.profile[index] = newProfile; // Update existing profile
            if (oldActiveProfileIndex === index) {
                if ((newProfile.toBeDecided?.length ?? 0) === Object.keys(oldDecided ?? {}).length) {
                    const newToBeDecided = (newProfile.toBeDecided ?? []).reduce((acc, cur) => {
                        const keyAndValue = cur?.split('=');
                        if (keyAndValue?.length > 1) acc[keyAndValue[0]] = new Set((keyAndValue[1] ?? '').split(','));
                        return acc;
                    }, {});
                    restartServers = Object.entries(oldDecided).reduce((acc, [key, value]) => {
                        return acc && newToBeDecided[key]?.has(value);
                    }, true);
                }
            } else {
                restartServers = oldActiveProfileIndex >= -1;
            }
        }
        tempConfig.globalSettings = newGlobalSettings;
        return restartServers;
    }, 'Error saving edited profile:');
}

// Serve one MCP `manage_profile` call as a SINGLE atomic write: an optional profile mutation
// and/or an optional replacement of the editable `globalSettings` sections. Doing both in one
// `commitConfigChange` is what makes "define a shared rule set and point this profile at it"
// safe — it either fully applies or fully fails, and the proxy stops/restarts once.
//
// globalSettings is a section-level replace: a section present in `globalSettingsJson`
// overwrites the stored one, anything absent is preserved — `ai` included, so an MCP client
// can never change the MCP server's own enable flag/port or the AI Desktop command. The key
// filter is repeated here on purpose: the controller already rejects other keys, but this is
// the layer that actually writes the file.
async function saveMcpConfigChange({ index, profileJson, asNew, globalSettingsJson }) {
    const editsProfile = asNew !== undefined;
    const editsGlobalSettings = globalSettingsJson !== undefined && globalSettingsJson !== null;
    let savedGlobalSettings = null;
    const result = await commitConfigChange((tempConfig, { oldActiveProfileIndex, oldDecided }) => {
        let restartServers = false;
        let indicesShifted = false;

        if (editsProfile) {
            if (asNew === null) {
                tempConfig.profile.splice(index, 1); // Remove profile at index
                indicesShifted = true;
            } else {
                const newProfile = checkProfile(profileJson);
                if (asNew) {
                    tempConfig.profile.splice(index + 1, 0, newProfile); // Insert after index
                    indicesShifted = true;
                } else {
                    tempConfig.profile[index] = newProfile; // Update existing profile
                    if (oldActiveProfileIndex === index) {
                        if ((newProfile.toBeDecided?.length ?? 0) === Object.keys(oldDecided ?? {}).length) {
                            const newToBeDecided = (newProfile.toBeDecided ?? []).reduce((acc, cur) => {
                                const keyAndValue = cur?.split('=');
                                if (keyAndValue?.length > 1)
                                    acc[keyAndValue[0]] = new Set((keyAndValue[1] ?? '').split(','));
                                return acc;
                            }, {});
                            restartServers = Object.entries(oldDecided).reduce((acc, [key, value]) => {
                                return acc && newToBeDecided[key]?.has(value);
                            }, true);
                        }
                    } else {
                        restartServers = oldActiveProfileIndex >= -1;
                    }
                }
            }
        }

        if (editsGlobalSettings) {
            const merged = { ...(tempConfig.globalSettings || {}) };
            EDITABLE_GLOBAL_SETTINGS_KEYS.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(globalSettingsJson, key)) {
                    merged[key] = globalSettingsJson[key];
                }
            });
            tempConfig.globalSettings = checkGlobalSettings(merged);
            savedGlobalSettings = tempConfig.globalSettings;
            // profileSet/substitute/others feed every profile's resolved rules, so whatever
            // was running has to be restarted for the change to take effect.
            restartServers = restartServers || oldActiveProfileIndex >= -1;
        }

        // An add/remove renumbers the array, so `oldActiveProfileIndex` no longer identifies
        // the same profile — restarting it would start the wrong one. Leave the proxy stopped.
        return restartServers && !indicesShifted;
    }, 'Error saving MCP configuration change:');
    return result.success && savedGlobalSettings
        ? { ...result, globalSettings: JSON.parse(JSON.stringify(savedGlobalSettings)) }
        : result;
}

ipcMain.handle('save-edited-profile', async (event, globalSettings, newProfileJson, index, asNew) =>
    saveEditedProfile(globalSettings, newProfileJson, index, asNew)
);

ipcMain.handle('open-reset-options', async () => {
    try {
        const focusedWindow = BrowserWindow.getFocusedWindow() || editorWindow;
        const options = {
            type: 'question',
            buttons: [
                'Reset text area to factory config',
                'Restore text area from backup',
                'Backup current text area',
                'Cancel'
            ],
            defaultId: 3,
            title: 'reset options',
            message: 'Please choose an option:'
        };
        const { response } = await dialog.showMessageBox(focusedWindow, options);
        return response;
    } catch (error) {
        logError('[open-reset-options] Failed to show choice dialog:', error);
        return -1;
    }
});

ipcMain.handle('minify-function', async (event, source) => {
    try {
        const functionObject = await compressToObject(source);
        return { success: true, content: functionObject };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('format-function', async (event, compressedObject) => {
    try {
        const formattedFunction = await restoreFromCompressedObject(compressedObject);
        return { success: true, content: formattedFunction };
    } catch (error) {
        return { success: false, error: error.message };
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
            return { success: true, message: 'Backup completed successfully.' };
        }
    } catch (error) {
        logError(`[execute-reset-option] Action ${action} failed due to:`, error);
        return { success: false, error: error.message };
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
            message: 'Please choose an option(changed global settings will be abolished if you remove current profile):'
        };
        const { response } = await dialog.showMessageBox(focusedWindow, options);
        return response;
    } catch (error) {
        logError('[open-more-options] Failed to show choice dialog:', error);
        return -1;
    }
});

// New IPC handlers for More popup actions
ipcMain.handle('generate-ca', async () => {
    try {
        const focusedWindow = BrowserWindow.getFocusedWindow() || mainWindow;
        const options = {
            type: 'warning',
            buttons: ['Continue', 'Cancel'],
            defaultId: 1,
            title: 'Confirm',
            message:
                'This will abolish the existing CA and generate a new one with a validity of 20 months.\nAre you sure to continue?'
        };
        const { response } = await dialog.showMessageBox(focusedWindow, options);
        if (response === 0) {
            try {
                const { key, cert, keyIdentifier } = generateRootCA();
                await writeRootCA(key, cert);
                loadRootCA(key, cert, keyIdentifier);
                await stopServers();
                afterStopServer();
            } catch (e) {
                mainWindow.webContents.send('proxy-status-update', { error: e.message });
                return { success: false, error: e.message };
            }
            try {
                startServers = getStartServers(errorStateCallback, serverErrorCallback);
                const command = getInstallCommand(rootCertPath);
                await execute(command).catch(async (e) => {
                    dialog.showMessageBox({
                        type: 'warning',
                        title: 'Fail to trust',
                        message: `Fail to trust CA.\nYou can still trust it manually by [Download CA certificate] or retry [Generate/Renew CA].`
                    });
                    throw { message: `New CA is not trusted. Browser may block the response.` };
                });
            } catch (e) {
                mainWindow.webContents.send('proxy-status-update', { error: e.message, activeProfileIndex });
                return { success: false, error: e.message };
            }
            mainWindow.webContents.send('proxy-status-update', {
                message: 'CA is trusted successfully! Please choose a profile to restart proxy.',
                activeProfileIndex
            });
            return { success: true };
        }
        return { success: false, cancelled: true };
    } catch (error) {
        logError('[generate-ca] Failed:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-ca-download-link', () => {
    try {
        const caString = getRootCAString();
        if (!caString) {
            return { success: false, error: 'No CA certificate available.' };
        }
        const httpPort = currentConfig[0]?.appPort?.[0];
        if (!httpPort) {
            return { success: false, error: 'HTTP port is not configured.' };
        }
        // Get local IP address (works on both macOS and Windows)
        const nets = os.networkInterfaces();
        let localIp = '127.0.0.1';
        for (const name of Object.keys(nets)) {
            for (const iface of nets[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    localIp = iface.address;
                    break;
                }
            }
            if (localIp !== '127.0.0.1') break;
        }
        const downloadLink = `http://${localIp}:${httpPort}/download-ca`;
        return { success: true, link: downloadLink };
    } catch (error) {
        logError('[get-ca-download-link] Failed:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-app-cache', async () => {
    try {
        await clearSession();
        mainWindow.webContents.send('proxy-status-update', {
            message: 'Cache cleared successfully! Please restart server.',
            activeProfileIndex
        });
        return { success: true };
    } catch (error) {
        logError('[clear-app-cache] Failed:', error);
        mainWindow.webContents.send('proxy-status-update', { error: error.message, activeProfileIndex });
        return { success: false, error: error.message };
    }
});

ipcMain.handle('check-for-update', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow() || mainWindow;
    try {
        const updateInfo = await checkForUpdates(true);
        if (updateInfo) {
            mainWindow.webContents.send('update-available', updateInfo);
            logInfo('Manual update check: Update available', updateInfo.version);
            return { success: true, hasUpdate: true };
        } else {
            await dialog.showMessageBox(focusedWindow, {
                type: 'info',
                title: 'No Update Available',
                message: 'You are using the latest version!',
                buttons: ['OK']
            });
            logInfo('Manual update check: Already up to date');
            return { success: true, hasUpdate: false };
        }
    } catch (error) {
        logError('Manual update check failed:', error);
        const { response } = await dialog.showMessageBox(focusedWindow, {
            type: 'warning',
            title: 'Update Check Failed',
            message: 'Unable to check update with bitbucket server.\nWould you like to check manually?',
            buttons: ['Open Download Page', 'Cancel'],
            defaultId: 0
        });
        if (response === 0) {
            await shell.openExternal(getDownloadPageUrl()).catch((err) => {
                logError('Failed to open download page:', err);
                mainWindow.webContents.send('proxy-status-update', { error: 'Failed to open download page.' });
            });
        }
        return { success: false, error: error.message };
    }
});

// System proxy status and toggle
ipcMain.handle('get-system-proxy-status', async () => {
    try {
        const status = await systemProxyManager.getProxyStatus();
        return status;
    } catch (error) {
        logError('Failed to get system proxy status:', error);
        return { isEnabled: null, error: error.message };
    }
});

ipcMain.handle('toggle-system-proxy', async (event, enable) => {
    try {
        if (enable) {
            await systemProxyManager.enableSystemProxy(
                currentConfig[0].listenOn || '127.0.0.1',
                currentConfig[0].appPort[0]
            );
        } else {
            await systemProxyManager.disableSystemProxy();
        }
        mainWindow.webContents.send('proxy-status-update', {
            message: `System proxy ${enable ? 'enabled' : 'disabled'} successfully!`
        });
        return { success: true };
    } catch (error) {
        logError('Failed to toggle system proxy:', error);
        mainWindow.webContents.send('proxy-status-update', { error: error.message });
        return { success: false, error: error.message };
    }
});

// URL Tool Window
let restartingTool;
const createToolWindow = () => {
    urlToolWindow = new BrowserWindow({
        width: 550,
        height: 650,
        title: 'Encode/Decode Tool',
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
    attachFileOrUrlToWindow(urlToolWindow, 'url-tool.html');
    urlToolWindow.on('closed', () => {
        urlToolWindow = null;
        if (restartingTool) {
            restartingTool = false;
            createToolWindow();
        }
    });
};
ipcMain.on('open-url-tool', () => {
    if (restartingTool) return;
    restartingTool = true;
    if (urlToolWindow) {
        urlToolWindow.close();
    } else {
        createToolWindow();
        restartingTool = false;
    }
});

// ---------------------------------------------------------------------------
// AI Desktop (cloudcli) lifecycle.
// `guiCommand` is a full command (may carry an inline env prefix, e.g. `SERVER_PORT=18887
// cloudcli`) launched in this main process; a full-screen window then loads
// `http://localhost:<guiPort>` in an independent session, where `guiPort` is the plain port
// that command serves on. Requires Node.js + `npm install -g @cloudcli-ai/cloudcli`.
// ---------------------------------------------------------------------------
function resolveAiGui() {
    const { command, port } = getAiGuiSettings(currentConfig[0]);
    return { command, port };
}

// Resolve true only once an HTTP GET to 127.0.0.1:<port>/ returns a real response whose
// status is < 500 — i.e. the GUI server is actually *serving pages*, not merely that the TCP
// port is open. A bare TCP check can succeed while the HTTP app is still initializing (or is
// briefly returning 5xx), which makes the window open too early and render an error page.
function probeHttp(port) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
            const ready = typeof res.statusCode === 'number' && res.statusCode < 500;
            res.resume(); // drain the response so the socket can be freed
            resolve(ready);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

// First-run startup (native module build, SPA warmup) can take a while.
const AI_GUI_READY_TIMEOUT_MS = 10000;

// A start attempt that a newer request (or stopCloudCli()) replaced while it was still waiting.
// Not a failure: the replacement owns the port and the outcome, so this attempt must end quietly.
class CloudCliStartSupersededError extends Error {
    constructor() {
        super('AI Desktop start was superseded by a newer request.');
        this.name = 'CloudCliStartSupersededError';
    }
}

// Launch the AI GUI command so it runs under the user's *default* Node — the one their
// terminal uses — and NOT Electron's bundled Node. Electron's Node has a different ABI
// (NODE_MODULE_VERSION), so cloudcli's native modules (built for the user's Node) crash
// with a "compiled against a different Node.js version" error when run under Electron.
//
// On macOS/Linux we execute the command through a login + interactive shell so the user's
// profile (e.g. nvm / Homebrew, usually configured in ~/.zshrc) loads and `node` resolves
// to their default version — exactly as if they typed the command in Terminal.
function spawnCloudCli(command) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // never let Electron's runtime act as `node`
    try {
        installCloudCliPreload(env, userDataPath); // keeps cloudcli's `npm show` update check from stalling startup
    } catch (e) {
        logWarn('Could not install the cloudcli preload; starting AI Desktop without it.', e);
    }
    const stdio = ['ignore', 'pipe', 'pipe'];
    if (process.platform === 'win32') {
        return spawn(command, { shell: true, env, stdio });
    }
    const shell = process.env.SHELL || '/bin/zsh';
    // Run the user's command via `env` so an inline env prefix (e.g. `SERVER_PORT=18887
    // cloudcli`) is honored, and `exec` so the shell is replaced — a single PID to manage/kill.
    // (`exec <VAR=val cmd>` would fail to apply the assignment, hence `exec env <command>`.)
    const inner = `exec env ${command}`;
    return spawn(shell, ['-ilc', inner], { env, stdio });
}

// Spawn the AI GUI command and resolve only once its HTTP server is actually
// accepting connections on `port`. Rejects (with any captured stderr) if the process
// cannot launch, exits before the server comes up, or never becomes reachable. Probing
// for readiness means the window is opened only when the page will actually load — so
// there is no need to retry the navigation afterwards.
//
// An attempt is current only while `cloudcliProcess === child`. Once stopCloudCli() replaces it, the
// attempt rejects with CloudCliStartSupersededError instead of polling the port its replacement is
// starting on and reporting that server's readiness, or a timeout, as its own.
function startCloudCli(command, port) {
    return new Promise((resolve, reject) => {
        if (!command) {
            reject(new Error('AI Desktop command (guiCommand) is not configured.'));
            return;
        }
        let settled = false;
        const settle = (fn, arg) => {
            if (settled) return;
            settled = true;
            fn(arg);
        };
        let stderrBuf = '';
        let child;
        try {
            child = spawnCloudCli(command);
        } catch (e) {
            reject(e);
            return;
        }
        cloudcliProcess = child;
        child.stdout?.on('data', (d) => {
            if (!app.isPackaged) process.stdout.write(d);
        });
        child.stderr?.on('data', (d) => {
            stderrBuf = (stderrBuf + d.toString()).slice(-4000);
            if (!app.isPackaged) process.stderr.write(d);
        });
        child.on('error', (err) => {
            logError('cloudcli failed to start:', err);
            if (cloudcliProcess === child) cloudcliProcess = null;
            settle(reject, err);
        });
        child.on('exit', (code, signal) => {
            logInfo(`cloudcli exited (code=${code}, signal=${signal}).`);
            if (cloudcliProcess === child) cloudcliProcess = null;
            // Exiting before the server was reachable means startup failed; surface the
            // captured stderr (e.g. a native-module ABI mismatch) so the user can act.
            const detail = stderrBuf.trim();
            settle(
                reject,
                new Error(`AI Desktop process exited (code ${code}).${detail ? `\n\n${detail.slice(-1200)}` : ''}`)
            );
        });
        // Wait for the GUI server to accept connections (or the process to die / time out).
        const deadline = Date.now() + AI_GUI_READY_TIMEOUT_MS;
        const poll = async () => {
            if (settled) return;
            const ready = await probeHttp(port);
            // After the probe on purpose: whatever answered it belongs to the replacement. If our own child
            // exited meanwhile, its exit handler has settled this attempt and settle() ignores the call below.
            if (cloudcliProcess !== child) {
                settle(reject, new CloudCliStartSupersededError());
                return;
            }
            if (ready) {
                settle(resolve, child);
                return;
            }
            if (Date.now() > deadline) {
                settle(reject, new Error(`AI Desktop server did not become ready on port ${port} in time.`));
                return;
            }
            setTimeout(poll, 400);
        };
        poll();
    });
}

// Collect a process' descendants without relying on a process group, so `spawnCloudCli`
// does not need `detached`. cloudcli normally `exec`s into a single PID, but if it ever
// forks a helper this keeps the helper from being orphaned.
// Windows has no pgrep and is handled by `taskkill /T` instead (see killProcessTree).
function collectDescendantPids(pid) {
    if (process.platform === 'win32') return [];
    const found = [];
    const walk = (parent) => {
        let out = '';
        try {
            out = execFileSync('pgrep', ['-P', String(parent)], { encoding: 'utf8' });
        } catch (e) {
            return; // no children (pgrep exits 1) or pgrep unavailable
        }
        out.split('\n')
            .map((line) => Number(line.trim()))
            .filter((child) => Number.isInteger(child) && child > 0)
            .forEach((child) => {
                found.push(child);
                walk(child);
            });
    };
    walk(pid);
    return found;
}

const isPidAlive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e.code === 'EPERM'; // exists but owned by someone else
    }
};

const signalPid = (pid, signal) => {
    try {
        process.kill(pid, signal);
    } catch (e) {
        /* already gone */
    }
};

/**
 * Kill a process and everything it spawned, synchronously.
 *
 * On Windows the command runs under `cmd.exe` (`spawn(command, { shell: true })`), so
 * `child.kill()` would only take out the shell and leave cloudcli behind; `taskkill /T /F`
 * walks the tree and forces every process in it.
 *
 * On macOS/Linux SIGKILL is used deliberately rather than SIGTERM. `spawnCloudCli` launches
 * through an *interactive* shell (`zsh -ilc`) so the user's `~/.zshrc` (nvm, Homebrew) is
 * loaded — and an interactive shell sets SIGTERM to SIG_IGN. POSIX preserves SIG_IGN across
 * `exec`, so the cloudcli process the shell execs into inherits that and ignores SIGTERM
 * outright. Sending SIGTERM first and waiting would therefore only add a window in which the
 * still-running process can be re-detected and "reused" by `ensureCloudCli`'s port probe,
 * just before the delayed kill lands. SIGKILL cannot be ignored and settles it immediately.
 */
function killProcessTree(pid) {
    if (process.platform === 'win32') {
        try {
            execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } catch (e) {
            // taskkill exits non-zero when the process is already gone — nothing to do.
        }
        return;
    }
    // Children first, so a parent cannot outlive the walk and re-parent them.
    [...collectDescendantPids(pid), pid].forEach((p) => signalPid(p, 'SIGKILL'));
}

// Terminate the cloudcli process (and any helper it spawned). See killProcessTree for why
// this is an immediate, forced kill rather than a graceful SIGTERM with a grace period.
function stopCloudCli() {
    if (!cloudcliProcess) return;
    const child = cloudcliProcess;
    const pid = child.pid;
    cloudcliProcess = null;
    cloudcliConfig = { command: null, port: null };
    try {
        child.removeAllListeners('exit');
        killProcessTree(pid);
        const survivors = process.platform === 'win32' ? [] : [pid, ...collectDescendantPids(pid)].filter(isPidAlive);
        if (survivors.length > 0) logError(`cloudcli did not stop; still alive: ${survivors.join(', ')}.`);
        else logInfo('cloudcli stopped.');
    } catch (e) {
        logError('Error stopping cloudcli:', e);
    }
}

// Auto-fill `globalSettings.ai.guiCommand`/`guiPort` with the built-in defaults the first
// time AI Desktop is used, so users don't have to configure them manually. Persists the
// change and, if a proxy profile is currently running, restarts it (via the same
// `startProfileFresh` path used by the renderer's 'start-proxy-profile' IPC), consistent with
// how other globalSettings.ai edits are applied.
async function ensureAiGuiConfigured() {
    const ai = currentConfig[0]?.globalSettings?.ai;
    const guiCommand = typeof ai?.guiCommand === 'string' ? ai.guiCommand.trim() : '';
    const guiPort = Number.isInteger(ai?.guiPort) && ai?.guiPort > 0 ? ai.guiPort : 0;
    if (guiCommand && guiPort) return; // already configured, nothing to do

    logInfo('AI Desktop guiCommand is not configured; applying built-in defaults.');
    const tempConfig = JSON.parse(JSON.stringify(currentConfig[0]));
    tempConfig.globalSettings = tempConfig.globalSettings || {};
    tempConfig.globalSettings.ai = {
        ...tempConfig.globalSettings.ai,
        guiCommand: AI_GUI_DEFAULT_COMMAND,
        guiPort: guiPort || AI_GUI_DEFAULT_PORT
    };
    currentConfig[0] = saveConfig(tempConfig);

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config-updated', currentConfig[0], profileColors, {
            activeProfileIndex,
            toBeDecided: decided,
            profileName: startedProfileName,
            message: APPLY_DEFAULT_AI_DESKTOP
        });
    }

    // Restart any running profile before (re)starting cloudcli, matching the requested flow.
    if (activeProfileIndex !== -9) {
        await startProfileFresh(activeProfileIndex, decided, APPLY_DEFAULT_AI_DESKTOP);
    }
}

// Ensure cloudcli is running with the current config's command/port (used by the
// AI Desktop button). Restarts the process when settings changed. Throws on failure.
async function ensureCloudCli() {
    const { command, port } = resolveAiGui();
    // Already launched by us with the same settings → reuse.
    if (cloudcliProcess && cloudcliConfig.command === command && cloudcliConfig.port === port) {
        return port;
    }
    // Something is already serving on `port` — most likely a CloudCli the user started
    // themselves (e.g. in a terminal). Reuse it instead of spawning a competing process
    // that would just fail to bind the port. We deliberately do NOT set `cloudcliProcess`
    // here, so this app never kills an externally-owned process on quit (see stopCloudCli).
    if (await probeHttp(port)) {
        cloudcliConfig = { command, port };
        return port;
    }
    if (!command) {
        throw new Error('AI Desktop command (guiCommand) is not configured.');
    }
    stopCloudCli();
    await startCloudCli(command, port);
    cloudcliConfig = { command, port };
    return port;
}

// On config save/import: shut down the AI Desktop service and window if:
//   (a) guiCommand or guiPort was cleared to empty, OR
//   (b) the command/port changed from what the running service was started with.
// We do NOT auto-restart — AI Desktop only (re)starts when the user opens it from
// Tools → AI Desktop, so it launches fresh with the new settings then.
function applyAiGuiOnConfigChange() {
    // Nothing was ever started or reused → nothing to close.
    if (!cloudcliProcess && (cloudcliConfig.command === null || cloudcliConfig.port === null)) return;
    const { command, port } = resolveAiGui();
    // Stop if command or port is now empty/unconfigured.
    const unconfigured = !command || !Number.isInteger(port) || port <= 0;
    // Stop if the settings changed from what the running service was started with.
    const changed = cloudcliConfig.command !== command || cloudcliConfig.port !== port;
    if (!unconfigured && !changed) return;
    logInfo(`AI Desktop shutting down on config save (unconfigured=${unconfigured}, changed=${changed}).`);
    stopCloudCli();
    cloudcliConfig = { command: null, port: null };
    if (aiDesktopWindow && !aiDesktopWindow.isDestroyed()) {
        aiDesktopWindow.close();
    }
}

ipcMain.handle('open-ai-desktop', async () => {
    let port;
    try {
        await ensureAiGuiConfigured();
        port = await ensureCloudCli();
    } catch (e) {
        // A newer click or a config change replaced this attempt; that request owns the outcome
        // (window or failure popup). The renderer shows the popup only for `success === false`.
        if (e instanceof CloudCliStartSupersededError) {
            logInfo('AI Desktop start was superseded by a newer request; dropping the stale attempt.');
            return { success: true, superseded: true };
        }
        logError('AI Desktop could not start:', e);
        // The renderer shows a custom in-page overlay (same style as the Tools popup) with
        // the shared AI Desktop help + this detail — no system dialog / separate window.
        return { success: false, error: e.message };
    }

    if (aiDesktopWindow && !aiDesktopWindow.isDestroyed()) {
        aiDesktopWindow.focus();
        return { success: true, focused: true };
    }

    aiDesktopWindow = new BrowserWindow({
        autoHideMenuBar: true,
        title: 'AI Desktop',
        webPreferences: {
            devTools: true,
            spellcheck: false,
            partition: aiDesktopPartition,
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    aiDesktopWindow.maximize();

    aiDesktopWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url).catch((err) => logError('Failed to open external link:', err));
        return { action: 'deny' };
    });

    const targetUrl = `http://localhost:${port}`;
    // Readiness was confirmed by an HTTP probe (see startCloudCli), so the first load should
    // succeed. Keep a small retry as a safety net in case the very first navigation still
    // races the server (e.g. it drops the initial connection while finishing warmup).
    let loadRetries = 4;
    aiDesktopWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // errorCode -3 (ABORTED) happens on normal client-side redirects; ignore it.
        if (!isMainFrame || errorCode === -3) return;
        if (loadRetries-- <= 0 || !aiDesktopWindow || aiDesktopWindow.isDestroyed()) return;
        logWarn(`AI Desktop load failed (${errorCode} ${errorDescription}); retrying in 600ms...`);
        setTimeout(() => {
            if (aiDesktopWindow && !aiDesktopWindow.isDestroyed()) aiDesktopWindow.loadURL(targetUrl);
        }, 400);
    });
    aiDesktopWindow.loadURL(targetUrl);
    aiDesktopWindow.on('closed', () => (aiDesktopWindow = null));
    return { success: true };
});

// Console Window
let restartingConsole;
const createConsoleWindow = () => {
    consoleWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        title: 'Request Console',
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

    attachFileOrUrlToWindow(consoleWindow, 'console.html');
    // Send buffered logs when console window is ready
    consoleWindow.webContents.on('did-finish-load', () => {
        if (consoleWindow && !consoleWindow.isDestroyed()) {
            consoleWindow.webContents.send('console-request-all-logs', Array.from(consoleLogBuffer.entries()));
        }
    });

    consoleWindow.on('closed', () => {
        consoleWindow = null;
        if (restartingConsole) {
            restartingConsole = false;
            createConsoleWindow();
        }
    });
};
ipcMain.on('open-console', () => {
    if (restartingConsole) return;
    restartingConsole = true;
    if (consoleWindow) {
        consoleWindow.close();
    } else {
        createConsoleWindow();
        restartingConsole = false;
    }
});

// URL Tool settings
ipcMain.handle('get-url-tool-settings', () => {
    return getUrlToolSettings();
});

ipcMain.handle('save-url-tool-settings', (event, settings) => {
    saveUrlToolSettings(settings);
    return { success: true };
});

// Console settings
ipcMain.handle('get-console-settings', () => {
    return getConsoleSettings();
});

ipcMain.handle('save-console-settings', (event, settings) => {
    saveConsoleSettings(settings);
    return { success: true };
});

// MD5 hash computation using Node.js crypto module
ipcMain.handle('compute-md5', (event, text, encoding = 'utf-8') => {
    try {
        const normalizedEncoding = (encoding || 'utf-8').toLowerCase();
        const buffer = normalizedEncoding === 'euc-jp' ? iconv.encode(text, 'euc-jp') : Buffer.from(text, 'utf-8');
        return crypto.createHash('md5').update(buffer).digest('hex');
    } catch (e) {
        throw new Error('MD5 computation failed: ' + e.message);
    }
});

const URL_UNRESERVED = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~'.split(''));
const URL_RESERVED = new Set(";/?:@&=+$,#!~*'()".split(''));

function shouldLeaveUnescaped(byte, componentOnly) {
    if (byte < 0x80) {
        const char = String.fromCharCode(byte);
        if (URL_UNRESERVED.has(char)) return true;
        if (!componentOnly && URL_RESERVED.has(char)) return true;
    }
    return false;
}

ipcMain.handle('encode-url-eucjp', (event, text, options = {}) => {
    try {
        const { componentOnly = true } = options;
        const buffer = iconv.encode(text, 'euc-jp');
        let result = '';
        for (const byte of buffer) {
            if (shouldLeaveUnescaped(byte, componentOnly)) {
                result += String.fromCharCode(byte);
            } else {
                result += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
            }
        }
        return result;
    } catch (e) {
        throw new Error('EUC-JP encoding failed: ' + e.message);
    }
});

ipcMain.handle('decode-url-eucjp', (event, text) => {
    try {
        const bytes = [];
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '%' && i + 2 < text.length) {
                const hex = text.slice(i + 1, i + 3);
                if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                    bytes.push(parseInt(hex, 16));
                    i += 2;
                    continue;
                }
            }
            bytes.push(text.charCodeAt(i));
        }
        return iconv.decode(Buffer.from(bytes), 'euc-jp');
    } catch (e) {
        throw new Error('EUC-JP decoding failed: ' + e.message);
    }
});

// Clear console log buffer
ipcMain.on('clear-console-logs', () => {
    consoleLogBuffer = new Map();
    bodyStorage = new Map();
});

// Fetch body data for a specific entry
ipcMain.handle('get-entry-body', (event, entryId) => {
    if (typeof entryId === 'undefined' || entryId === null) {
        return { reqBody: null, resBody: null };
    }

    const bodies = bodyStorage.get(entryId);
    if (!bodies) {
        // Entry might not have bodies yet
        return { reqBody: null, resBody: null };
    }

    return {
        reqBody: bodies.reqBody,
        resBody: bodies.resBody
    };
});

ipcMain.on('open-external-link', (event, url) => {
    shell.openExternal(url).catch((err) => logError('Failed to open external link:', err));
});

ipcMain.handle('open-profile-viewer', () => {
    if (activeProfileIndex < 0 || !currentPreparedProfile) {
        return { success: false };
    }
    if (profileViewerWindow) {
        profileViewerWindow.focus();
        return { success: true, focused: true };
    }
    const profileJson = JSON.stringify(currentPreparedProfile, null, 2);
    profileViewerWindow = new BrowserWindow({
        width: 850,
        height: 750,
        title: 'Effective Profile',
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
            nodeIntegration: false
        }
    });
    attachFileOrUrlToWindow(profileViewerWindow, 'profile-viewer.html');
    profileViewerWindow.webContents.on('did-finish-load', () => {
        profileViewerWindow.webContents.send('load-profile-viewer', profileJson, decided);
    });
    profileViewerWindow.on('closed', () => (profileViewerWindow = null));
    return { success: true };
});

ipcMain.handle('copy-quarantine-command', () => {
    const platform = os.platform();
    if (platform === 'darwin') {
        const command = 'sudo xattr -r -d com.apple.quarantine /Applications/CheckoutProxy\\ R.app';
        clipboard.clear();
        clipboard.writeText(command);
        return { copied: true, command };
    }
    return { copied: false };
});

ipcMain.handle('copy-to-clipboard', (event, toCopy) => {
    clipboard.clear();
    clipboard.writeText(toCopy);
});

// Update-related IPC handlers
ipcMain.on('skip-update-version', (event, version) => {
    try {
        skipVersion(version);
        logInfo('User skipped version:', version);
    } catch (error) {
        logError('Error skipping version:', error);
    }
});

ipcMain.on('snooze-update', (event, days) => {
    try {
        snoozeUpdates(days);
        logInfo('User snoozed updates for', days, 'days');
    } catch (error) {
        logError('Error snoozing updates:', error);
    }
});

ipcMain.on('conditional-snooze-update', (event, days) => {
    try {
        conditionalSnooze(days);
    } catch (error) {
        logError('Error conditionally snoozing updates:', error);
    }
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
});

process.on('warning', (e) => logWarn(e.stack));
