import {loadRootCA, startServers} from "../proxy/proxy-server.js";
import DEFAULT_CONFIG from "../constant/default-config.json" with {type: 'json'};
import {isConfigVersionOutdated, isPortInvalid} from "../util/sharedUtil.js";
import {getResourceFilePath, logError, logInfo, logWarn} from "../util/nodeUtil";
import {app, BrowserWindow, ipcMain, dialog, shell} from 'electron';
import path from 'path';
import fs from 'fs';

let mainWindow;
let editorWindow;
let instructionsWindow;

let httpServer;
let httpsServer;
let currentConfig;
let activeProfileIndex = -9;

const userDataPath = app.getPath('userData');
const CONFIG_FILE_NAME = 'checkout-proxy-config-v1.json';
const USER_DEFAULT_CONFIG_FILE_NAME = 'checkout-proxy-user-default-config-v1.json';
const userDefaultConfigFilePath = path.join(userDataPath, USER_DEFAULT_CONFIG_FILE_NAME);
const configFilePath = path.join(userDataPath, CONFIG_FILE_NAME);
const CONFIG_OUTDATED_MESSAGE = 'Configuration is outdated. Please use Edit Config -> Reset to Default to update your configuration.';

function loadConfig() {
    try {
        if (fs.existsSync(configFilePath)) {
            const fileData = fs.readFileSync(configFilePath, 'utf-8');
            currentConfig = JSON.parse(fileData);
            logInfo('Configuration loaded from:', configFilePath);
        } else {
            currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            fs.writeFileSync(configFilePath, JSON.stringify(currentConfig, null, 2));
            logInfo('Default configuration created at:', configFilePath);
        }
    } catch (error) {
        logError('Error loading or creating config:', error);
        dialog.showErrorBox('Configuration Error', `Failed to load configuration: ${error.message}. Using default.`);
        currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    // Ensure appPort exists and has two numbers
    if (isPortInvalid(currentConfig)) {
        logWarn('Invalid appPort in config, resetting to default.');
        currentConfig.appPort = [...DEFAULT_CONFIG.appPort];
    }
    if (!currentConfig.profile || !Array.isArray(currentConfig.profile)) {
        currentConfig.profile = [];
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(configFilePath, JSON.stringify(currentConfig, null, 2));
        logInfo('Configuration saved to:', configFilePath);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-updated', currentConfig, activeProfileIndex);
        }
    } catch (error) {
        logError('Error saving config:', error);
        dialog.showErrorBox('Configuration Save Error', `Failed to save configuration: ${error.message}`);
    }
}

async function stopServers() {
    return new Promise((resolve) => {
        let httpStopped = !httpServer;
        let httpsStopped = !httpsServer;

        const checkDone = () => {
            if (httpStopped && httpsStopped) {
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
    });
}

export function handleServerError(err, serverType, port) {
    logError(`Error with ${serverType} server on port ${port}:`, err);
    let userMessage = `An error occurred with the ${serverType} server.`;
    if (err.code === 'EADDRINUSE') {
        userMessage = `Port ${port} for the ${serverType} server is already in use. Please change it in the configuration.`;
    } else if (err.message && err.message.includes("Root CA not loaded")) {
        userMessage = `Cannot start ${serverType} server: Root CA is not loaded. HTTPS proxying will fail. Check console.`;
    } else {
        userMessage = `Error with ${serverType} server on port ${port}: ${err.message}. Check console for details.`;
    }

    // Attempt to stop servers cleanly if one fails to start
    stopServers().finally(() => {
        activeProfileIndex = -9; // Mark no profile as active
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

function createMainWindow(firstRun) {
    mainWindow = new BrowserWindow({
        width: 700,
        height: 700,
        resizable: false,
        fullscreenable: false,
        autoHideMenuBar: true,
        webPreferences: {
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
        if (instructionsWindow) instructionsWindow.close();
    });

    mainWindow.webContents.on('did-finish-load', () => {
        loadConfig();
        mainWindow.webContents.send('config-updated', currentConfig, activeProfileIndex);
        mainWindow.webContents.send('proxy-status-update', {
            httpPort: currentConfig.appPort[0], httpsPort: currentConfig.appPort[1], activeProfileIndex,
            ...(isConfigVersionOutdated(currentConfig, DEFAULT_CONFIG) ? {error: CONFIG_OUTDATED_MESSAGE}
                : {message: firstRun ? 'App loaded. Select a profile to start proxy.' : 'Proxy servers stopped. Select a profile to start.'}),
        });
    });
}


app.whenReady().then(() => {
    loadRootCA();
    createMainWindow(true);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', async () => {
    await stopServers();
    activeProfileIndex = -9;
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', async (event) => {
    // This is a final chance to stop servers if not already done
    event.preventDefault(); // Prevent immediate quit
    logInfo("Application is about to quit. Stopping servers...");
    await stopServers();
    app.exit(); // Now actually exit
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.on('open-instructions', () => {
    if (instructionsWindow) {
        instructionsWindow.focus();
        return;
    }
    instructionsWindow = new BrowserWindow({
        width: 670,
        height: 600,
        title: 'Checkout-Proxy Instructions',
        fullscreenable: false,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: false, // Can be true if you want it to block main window
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'), // Re-use preload for simplicity
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    attachFileOrUrlToWindow(instructionsWindow, 'instructions.html');
    instructionsWindow.on('closed', () => instructionsWindow = null);

    // Send markdown content
    instructionsWindow.webContents.on('did-finish-load', () => {
        try {
            const mdContent = fs.readFileSync(getResourceFilePath('README.md'), 'utf-8');
            instructionsWindow.webContents.send('markdown-content', mdContent);
        } catch (e) {
            instructionsWindow.webContents.send('markdown-content', `# Error loading instructions, error:${e.message}\nCould not read README.md`);
            logError("Error reading README.md:", e);
        }
    });
});

ipcMain.on('download-root-ca', async (event) => {
    try {
        const rootCACertPath = path.join(getResourceFilePath('resources/rootCA.crt'));

        if (!fs.existsSync(rootCACertPath)) {
            logError('Root CA certificate file not found at:', rootCACertPath);
            dialog.showErrorBox('Download Error', 'Root CA certificate file (rootCA.crt) not found in resources.');
            return; // Exit if file doesn't exist
        }

        const {canceled, filePath} = await dialog.showSaveDialog({
            title: 'Save Root CA Certificate',
            defaultPath: 'checkout-proxy-rootCA.crt',
            filters: [
                {name: 'Certificates', extensions: ['crt', 'pem', 'cer']},
                {name: 'All Files', extensions: ['*']}
            ]
        });

        if (!canceled && filePath) {
            const certContent = fs.readFileSync(rootCACertPath); // Read as buffer or utf-8 if you prefer
            fs.writeFileSync(filePath, certContent);
            dialog.showMessageBox({
                type: 'info',
                title: 'Download Successful',
                message: `Root CA certificate saved to: ${filePath}`
            });
        }
    } catch (error) {
        logError('Error during Root CA download:', error);
        dialog.showErrorBox('Download Error', `Failed to download Root CA certificate: ${error.message}`);
    }
});

ipcMain.on('open-config-editor', () => {
    if (editorWindow) {
        editorWindow.focus();
        return;
    }
    editorWindow = new BrowserWindow({
        width: 670,
        height: 620,
        title: 'Edit Configuration',
        fullscreenable: false,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: true,
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });
    attachFileOrUrlToWindow(editorWindow, 'editor.html');
    editorWindow.webContents.on('did-finish-load', () => {
        editorWindow.webContents.send('load-config-for-editing', {currentConfig, defaultConfig: DEFAULT_CONFIG});
    });
    editorWindow.on('closed', () => editorWindow = null);
});

ipcMain.handle('save-edited-config', async (event, newConfigJson) => {
    try {
        const newConfig = JSON.parse(newConfigJson);
        // Basic validation (can be more thorough)
        if (isPortInvalid(newConfig)) {
            throw new Error("Invalid appPort format. Must be an array of two numbers.");
        }
        if (!Array.isArray(newConfig.profile)) {
            throw new Error("Invalid profile format. Must be an array.");
        }
        if (newConfig.profile.find(item => !item?.name)) {
            throw new Error("Invalid profile name. Name is required for each profile.");
        }

        currentConfig = newConfig;
        saveConfig(); // This will also send 'config-updated' to mainWindow
        await stopServers(); // Stop current servers
        activeProfileIndex = -9; // Reset active profile, user needs to pick one
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-updated', currentConfig, activeProfileIndex);
            mainWindow.webContents.send('proxy-status-update', {
                httpPort: currentConfig.appPort[0], httpsPort: currentConfig.appPort[1], activeProfileIndex,
                ...(isConfigVersionOutdated(currentConfig, DEFAULT_CONFIG) ? {error: CONFIG_OUTDATED_MESSAGE} : {message: 'Config saved. Proxy stopped. Select a profile to start.'}),
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
            const newConfig = JSON.parse(fileData);

            // Basic validation
            if (isPortInvalid(newConfig)) {
                throw new Error("Invalid appPort format in imported file.");
            }
            if (!newConfig.profile || !Array.isArray(newConfig.profile)) {
                throw new Error("Invalid profile format in imported file.");
            }

            currentConfig = newConfig;
            saveConfig(); // Overwrites the app's managed JSON and sends 'config-updated'
            await stopServers();
            activeProfileIndex = -9;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('config-updated', currentConfig, activeProfileIndex);
                mainWindow.webContents.send('proxy-status-update', {
                    httpPort: currentConfig.appPort[0], httpsPort: currentConfig.appPort[1], activeProfileIndex,
                    message: 'Proxy stopped due to new config imported. Select a profile to start.'
                });
            }
            dialog.showMessageBox(mainWindow, {
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
            fs.writeFileSync(result.filePath, JSON.stringify(currentConfig, null, 2));
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

ipcMain.on('stop-proxy-servers', async () => {
    await stopServers();
    activeProfileIndex = -9;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proxy-status-update', {
            httpPort: currentConfig.appPort[0], httpsPort: currentConfig.appPort[1], activeProfileIndex,
            message: 'Proxy servers stopped by user.'
        });
    }
});

ipcMain.on('start-proxy-profile', async (event, profileIndex) => {
    logInfo(`Attempting to start profile index: ${profileIndex}`);
    await stopServers();
    activeProfileIndex = -9;
    if (profileIndex === -1 || (profileIndex >= 0 && profileIndex < currentConfig.profile.length)) {
        try {
            const {startedHttpServer, startedHttpsServer} = await startServers(mainWindow, currentConfig, profileIndex);
            httpServer = startedHttpServer;
            httpsServer = startedHttpsServer;
            activeProfileIndex = profileIndex;
            if (mainWindow && !mainWindow.isDestroyed()) {
                const httpPort = currentConfig.appPort[0];
                const httpsPort = currentConfig.appPort[1];
                mainWindow.webContents.send('proxy-status-update', {
                    httpPort, httpsPort, activeProfileIndex: profileIndex,
                    message: `Proxy service started successfully!`
                });
            }
        } catch (error) {
            handleServerError(error, 'Initialization');
        }
    } else {
        logError(`Invalid profile index: ${profileIndex}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('proxy-status-update', {error: `Invalid profile selected.`});
        }
    }
});

ipcMain.handle('open-reset-option', async () => {
    try {
        const focusedWindow = BrowserWindow.getFocusedWindow() || editorWindow;
        const options = {
            type: 'question',
            buttons: ['Reset to Original Default Config', 'Reset to User Default Config', 'Save as User Default Config', 'Cancel'],
            defaultId: 3,
            title: 'reset option',
            message: 'Please choose an action:',
        };
        const {response} = await dialog.showMessageBox(focusedWindow, options);
        return response;
    } catch (error) {
        logError('[open-reset-option] Failed to show choice dialog:', error);
        return -1;
    }
});

ipcMain.handle('execute-reset-option', async (event, action, editedConfig) => {
    try {
        if (action === 0) {
            const defaultConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            logInfo('Configuration has been reset to Original Default Config.');
            return {
                success: true,
                defaultConfig,
                message: 'Reset to Original Default Config successfully. You can now edit it or click [Save and Close].'
            };
        } else if (action === 1) {
            if (!fs.existsSync(userDefaultConfigFilePath)) {
                return {
                    success: false,
                    error: 'Please do [Save as User Default Config] first, then you can reset to it.'
                };
            }
            const defaultConfigString = fs.readFileSync(userDefaultConfigFilePath, 'utf-8');
            const defaultConfig = JSON.parse(defaultConfigString);
            logInfo('Configuration has been reset to User Default Config.');
            return {
                success: true,
                defaultConfig,
                message: 'Reset to User Default Config successfully. You can now edit it or click [Save and Close].'
            };
        } else if (action === 2) {
            fs.writeFileSync(userDefaultConfigFilePath, JSON.stringify(editedConfig, null, 2));
            logInfo('User Default Configuration saved to:', userDefaultConfigFilePath);
            return {success: true, message: 'Save as User Default Config successfully.'};
        }
    } catch (error) {
        logError(`[execute-reset-option] Action ${action} failed due to:`, error);
        return {success: false, error: error.message};
    }
});


ipcMain.on('open-external-link', (event, url) => {
    shell.openExternal(url).catch(err => logError('Failed to open external link:', err));
});

process.on('uncaughtException', (err) => {
    logError('uncaughtException occurred:', err);
});
