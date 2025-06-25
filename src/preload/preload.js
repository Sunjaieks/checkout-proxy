const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Main window to Main process
    openInstructions: () => ipcRenderer.send('open-instructions'),
    openConfigEditor: () => ipcRenderer.send('open-config-editor'),
    importConfig: () => ipcRenderer.send('import-config'),
    exportConfig: () => ipcRenderer.send('export-config'),
    stopProxyServers: () => ipcRenderer.send('stop-proxy-servers'),
    startProxyProfile: (index) => ipcRenderer.send('start-proxy-profile', index),

    // Editor window to Main process
    loadConfigForEditing: (callback) => ipcRenderer.on('load-config-for-editing', (_event, value) => callback(value)),
    saveEditedConfig: (jsonString) => ipcRenderer.invoke('save-edited-config', jsonString),

    // Instructions window to Main process
    getMarkdownContent: (callback) => ipcRenderer.on('markdown-content', (_event, content) => callback(content)),

    // Main process to Renderer(s)
    onConfigUpdated: (callback) => ipcRenderer.on('config-updated', (_event, config, activeProfile) => callback(config, activeProfile)),
    onProxyStatusUpdate: (callback) => ipcRenderer.on('proxy-status-update', (_event, status) => callback(status)),

    openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
    downloadRootCA: () => ipcRenderer.send('download-root-ca'),
    openResetOption: () => ipcRenderer.invoke('open-reset-option'),
    executeResetOption: (action, editedConfig) => ipcRenderer.invoke('execute-reset-option', action, editedConfig),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});

contextBridge.exposeInMainWorld(
    'myUtil',
    {}
);
