const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Main window to Main process
    openConfigEditor: () => ipcRenderer.send('open-config-editor'),
    importConfig: () => ipcRenderer.invoke('import-config'),
    exportConfig: () => ipcRenderer.invoke('export-config'),
    stopProxyServers: () => ipcRenderer.send('stop-proxy-servers'),
    startProxyProfile: (index, toBeDecided) => ipcRenderer.send('start-proxy-profile', index, toBeDecided),
    editProxyProfile: (index) => ipcRenderer.send('edit-proxy-profile', index),

    // More popup actions
    openHelp: () => ipcRenderer.invoke('open-help'),
    generateCA: () => ipcRenderer.invoke('generate-ca'),
    downloadCA: () => ipcRenderer.invoke('download-root-ca'),
    clearAppCache: () => ipcRenderer.invoke('clear-app-cache'),
    checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
    getCADownloadLink: () => ipcRenderer.invoke('get-ca-download-link'),

    // Tools popup actions
    openUrlTool: () => ipcRenderer.send('open-url-tool'),
    getSystemProxyStatus: () => ipcRenderer.invoke('get-system-proxy-status'),
    toggleSystemProxy: (enable) => ipcRenderer.invoke('toggle-system-proxy', enable),

    // Console window
    openConsole: () => ipcRenderer.send('open-console'),

    // URL Tool settings
    getUrlToolSettings: () => ipcRenderer.invoke('get-url-tool-settings'),
    saveUrlToolSettings: (settings) => ipcRenderer.invoke('save-url-tool-settings', settings),
    computeMd5: (text, encoding) => ipcRenderer.invoke('compute-md5', text, encoding),
    encodeUrlEucJp: (text, options) => ipcRenderer.invoke('encode-url-eucjp', text, options),
    decodeUrlEucJp: (text) => ipcRenderer.invoke('decode-url-eucjp', text),

    // Console settings
    getConsoleSettings: () => ipcRenderer.invoke('get-console-settings'),
    saveConsoleSettings: (settings) => ipcRenderer.invoke('save-console-settings', settings),

    // Console request log listener
    onConsoleRequestLog: (callback) => ipcRenderer.on('console-request-log', (_event, logEntry) => callback(logEntry)),
    onConsoleRequestAllLogs: (callback) =>
        ipcRenderer.on('console-request-all-logs', (_event, logEntries) => callback(logEntries)),
    clearConsoleLogs: () => ipcRenderer.send('clear-console-logs'),
    getEntryBody: (entryId) => ipcRenderer.invoke('get-entry-body', entryId),

    // Editor window to Main process
    loadConfigForEditing: (callback) => ipcRenderer.on('load-config-for-editing', (_event, value) => callback(value)),
    saveEditedConfig: (jsonString) => ipcRenderer.invoke('save-edited-config', jsonString),
    saveEditedProfile: (globalSettings, newProfileJson, profileIndex, asNew) =>
        ipcRenderer.invoke('save-edited-profile', globalSettings, newProfileJson, profileIndex, asNew),
    copyRule: (entry) => ipcRenderer.invoke('copy-rule', entry),
    pasteRule: () => ipcRenderer.invoke('paste-rule'),

    // Profile viewer window
    openProfileViewer: () => ipcRenderer.invoke('open-profile-viewer'),
    onLoadProfileViewer: (callback) =>
        ipcRenderer.on('load-profile-viewer', (_event, profileJson, decided) => callback(profileJson, decided)),

    // Help window to Main process
    getMarkdownContent: (callback) => ipcRenderer.on('markdown-content', (_event, content) => callback(content)),

    // Main process to Renderer(s)
    onConfigUpdated: (callback) =>
        ipcRenderer.on('config-updated', (_event, config, profileColors, status) =>
            callback(config, profileColors, status)
        ),
    onProxyStatusUpdate: (callback) => ipcRenderer.on('proxy-status-update', (_event, status) => callback(status)),

    openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
    openResetOptions: () => ipcRenderer.invoke('open-reset-options'),
    openMoreOptions: () => ipcRenderer.invoke('open-more-options'),
    executeResetOption: (action, editedConfig) => ipcRenderer.invoke('execute-reset-option', action, editedConfig),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    closeWindow: (windowName) => ipcRenderer.send('close-window', windowName),

    minifyFunction: (formattedFunctionString) => ipcRenderer.invoke('minify-function', formattedFunctionString),
    formatFunction: (minifiedFunctionString) => ipcRenderer.invoke('format-function', minifiedFunctionString),

    // Update-related
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_event, updateInfo) => callback(updateInfo)),
    skipUpdateVersion: (version) => ipcRenderer.send('skip-update-version', version),
    snoozeUpdate: (days) => ipcRenderer.send('snooze-update', days),
    conditionalSnoozeUpdate: (days) => ipcRenderer.send('conditional-snooze-update', days),
    openDownloadPage: (url) => ipcRenderer.send('open-external-link', url),
    copyQuarantineCommand: () => ipcRenderer.invoke('copy-quarantine-command'),
    copyToClipboard: (toCopy) => ipcRenderer.invoke('copy-to-clipboard', toCopy)
});

contextBridge.exposeInMainWorld('myUtil', {});
