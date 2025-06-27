import {isConfigVersionOutdated} from "../../util/sharedUtil.js";

const jsonEditorEl = document.getElementById('jsonEditor');
const messageEl = document.getElementById('infoOrErrorMessage');

window.electronAPI.loadConfigForEditing(async ({currentConfig, defaultConfig}) => {
    if (isConfigVersionOutdated(currentConfig, defaultConfig)) {
        messageEl.style.color = 'red';
        messageEl.textContent = 'Config version outdated! This might cause potential issues. Please backup your current config and click [Reset Option] ' +
            '-> [Reset to Original Default Config] -> [OK] -> [Save and Close] to retrieve the newest default config and apply.';
    }
    jsonEditorEl.value = JSON.stringify(currentConfig, null, 2);
});

document.getElementById('btnSaveAndClose').addEventListener('click', async () => {
    const newConfigJson = jsonEditorEl.value;
    try {
        const result = await window.electronAPI.saveEditedConfig(newConfigJson);
        if (result.success) {
            window.close();
        } else {
            messageEl.style.color = 'red';
            messageEl.textContent = `Error: ${result.error || 'Failed to save configuration.'}`;
        }
    } catch (e) {
        messageEl.style.color = 'red';
        messageEl.textContent = `Invalid JSON: ${e.message}`;
    }
});

document.getElementById('btnReset').addEventListener('click', async () => {
    const response = await window.electronAPI.openResetOptions();
    if (response < 0 || response === 3) return;

    messageEl.textContent = '';
    try {
        const result = await window?.electronAPI.executeResetOption(response, jsonEditorEl.value);
        if (!result) return;
        if (result.success) {
            if (result.defaultConfig) jsonEditorEl.value = JSON.stringify(result.defaultConfig, null, 2);
            messageEl.style.color = 'green';
            messageEl.textContent = result.message || '';
        } else {
            messageEl.style.color = 'red';
            messageEl.textContent = `Error: ${result.error || 'Failed to reset configuration.'}`;
        }
    } catch (e) {
        messageEl.style.color = 'red';
        messageEl.textContent = `Error during reset: ${e.message}`;
    }
});

document.getElementById('btnAbort').addEventListener('click', () => {
    window.close();
});
