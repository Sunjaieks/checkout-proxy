import {isConfigVersionOutdated} from "../../util/sharedUtil.js";

const jsonEditorEl = document.getElementById('jsonEditor');
const messageEl = document.getElementById('infoOrErrorMessage');

window.electronAPI.loadConfigForEditing(async ({currentConfig, defaultConfig}) => {
    if (isConfigVersionOutdated(currentConfig, defaultConfig)) {
        messageEl.style.color = 'red';
        messageEl.textContent = `Config version outdated! This might cause potential issues. Please backup your current config and click [Reset to Default] -> [Save and Close] to retrieve the newest default config and apply.`;
    }
    jsonEditorEl.value = JSON.stringify(currentConfig, null, 2);
});

document.getElementById('btnSaveAndClose').addEventListener('click', async () => {
    const newConfigJson = jsonEditorEl.value;
    try {
        JSON.parse(newConfigJson); // Validate JSON
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
    const confirmed = window.confirm( // Standard browser confirm dialog
        "Are you sure to reset?\nThis will overwrite your edited configuration with the newest default.\n" +
        "You still need to click [Save and Close] to apply the changes"
    );
    if (confirmed) {
        messageEl.textContent = ''; // Clear previous errors
        try {
            const result = await window.electronAPI.resetConfigToDefault();
            if (result.success) {
                jsonEditorEl.value = JSON.stringify(result.defaultConfig, null, 2);
                messageEl.style.color = 'green';
                messageEl.textContent = 'Reset to default configuration successfully. You can now edit it or click [Save and Close].';
                // window.close(); // Close editor window on successful reset
            } else {
                messageEl.style.color = 'red';
                messageEl.textContent = `Error: ${result.error || 'Failed to reset configuration.'}`;
            }
        } catch (e) {
            messageEl.style.color = 'red';
            messageEl.textContent = `Error during reset: ${e.message}`;
        }
    }
});


document.getElementById('btnAbort').addEventListener('click', () => {
    window.close();
});
