const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Main window to Main process
    openConfigEditor: () => ipcRenderer.send('open-config-editor'),
    importConfig: () => ipcRenderer.send('import-config'),
    exportConfig: () => ipcRenderer.send('export-config'),
    stopProxyServers: () => ipcRenderer.send('stop-proxy-servers'),
    startProxyProfile: (index, toBeDecided) => ipcRenderer.send('start-proxy-profile', index, toBeDecided),
    editProxyProfile: (index) => ipcRenderer.send('edit-proxy-profile', index),

    // Editor window to Main process
    loadConfigForEditing: (callback) => ipcRenderer.on('load-config-for-editing', (_event, value) => callback(value)),
    saveEditedConfig: (jsonString) => ipcRenderer.invoke('save-edited-config', jsonString),
    saveEditedProfile: (globalSettings, newProfileJson, profileIndex, asNew) => ipcRenderer.invoke('save-edited-profile', globalSettings, newProfileJson, profileIndex, asNew),

    // Help window to Main process
    getMarkdownContent: (callback) => ipcRenderer.on('markdown-content', (_event, content) => callback(content)),

    // Main process to Renderer(s)
    onConfigUpdated: (callback) => ipcRenderer.on('config-updated', (_event, config, activeProfile) => callback(config, activeProfile)),
    onProxyStatusUpdate: (callback) => ipcRenderer.on('proxy-status-update', (_event, status) => callback(status)),

    openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
    openResetOptions: () => ipcRenderer.invoke('open-reset-options'),
    openMoreOptions: () => ipcRenderer.invoke('open-more-options'),
    openMainMoreOptions: () => ipcRenderer.invoke('open-main-more-options'),
    executeResetOption: (action, editedConfig) => ipcRenderer.invoke('execute-reset-option', action, editedConfig),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    closeWindow: (windowName) => ipcRenderer.send('close-window', windowName),

    minifyFunction: (formattedFunctionString) => ipcRenderer.invoke('minify-function', formattedFunctionString),
    formatFunction: (minifiedFunctionString) => ipcRenderer.invoke('format-function', minifiedFunctionString),
});

contextBridge.exposeInMainWorld(
    'myUtil',
    {}
);
