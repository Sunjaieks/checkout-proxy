import {isConfigVersionOutdated} from "../../util/sharedUtil.js";
import ace from 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/ext-searchbox';
import "ace-builds/src-min-noconflict/mode-javascript";
import "ace-builds/src-min-noconflict/mode-json";
import "ace-builds/src-min-noconflict/theme-xcode";
import jsWorker from "ace-builds/src-min-noconflict/worker-javascript?url";
import jsonWorker from "ace-builds/src-min-noconflict/worker-json?url";
import {config} from "ace-builds";
import {CONFIG_OUTDATED_MESSAGE, EDITOR_WINDOW_NAME} from "../../constant/constant.js";

config.setModuleUrl("ace/mode/json_worker", jsonWorker)
config.setModuleUrl("ace/mode/javascript_worker", jsWorker)

const editorEl = document.getElementById('configEditor');
const tabButtonEl = [document.getElementById('fullConfigButton'), document.getElementById('globalSettingsButton'), document.getElementById('hackFunctionsButton')];
const messageEl = document.getElementById('infoOrErrorMessage');
const editorCursorScroll = [0, 0, 0];
const editorCursorPosition = [{row: 0, column: 0}, {row: 0, column: 0}, {row: 0, column: 0}];
let editor;

let initialTotalConfig;
let currentTabIndex = 0;

const showSyncInfo = () => {
    messageEl.style.color = 'green';
    messageEl.textContent = 'Changes among different tab will be synced in realtime.';
}

const tabSwitchData = async (newTabIndex) => {
    if (currentTabIndex === newTabIndex) return {success: false};
    messageEl.textContent = ''
    const current0 = currentTabIndex === 0;
    const new0 = newTabIndex === 0;
    if (current0 || currentTabIndex === 1) {
        const newConfigJsonString = editor.getValue();
        let newConfigJson;
        try {
            newConfigJson = JSON.parse(newConfigJsonString || {})
        } catch (e) {
            messageEl.style.color = 'red';
            messageEl.textContent = `Can not switch tab due to Invalid JSON: ${e.message}`;
            return {success: false};
        }
        if (newTabIndex === 2) {
            const result = await window.electronAPI.formatFunction((current0 ? newConfigJson : initialTotalConfig).reusableHackFunctions || {});
            if (result.success) {
                initialTotalConfig = current0 ? newConfigJson : {
                    ...initialTotalConfig,
                    globalSettings: newConfigJson
                };
                editorCursorScroll[currentTabIndex] = editor.renderer.getScrollTop()
                editorCursorPosition[currentTabIndex] = editor.getSelection().getCursor()
                editor.setValue(result.content, -1);
            } else {
                messageEl.style.color = 'red';
                messageEl.textContent = `Failed to convert reusableHackFunctions: ${result.error}`;
                return {success: false};
            }
        } else {
            if (current0) {
                initialTotalConfig = newConfigJson;
                editorCursorScroll[0] = editor.renderer.getScrollTop()
                editorCursorPosition[0] = editor.getSelection().getCursor()
                editor.setValue(JSON.stringify(newConfigJson.globalSettings || {}, null, 2), -1);
            } else {
                editorCursorScroll[1] = editor.renderer.getScrollTop()
                editorCursorPosition[1] = editor.getSelection().getCursor()
                initialTotalConfig = {...initialTotalConfig, globalSettings: newConfigJson};
                editor.setValue(JSON.stringify(initialTotalConfig, null, 2), -1);
            }
        }
    } else if (currentTabIndex === 2) {
        const result = await window.electronAPI.minifyFunction(editor.getValue() || '');
        if (result.success) {
            initialTotalConfig.reusableHackFunctions = result.content;
            editorCursorScroll[2] = editor.renderer.getScrollTop()
            editorCursorPosition[2] = editor.getSelection().getCursor()
            editor.setValue(JSON.stringify(new0 ? initialTotalConfig : initialTotalConfig.globalSettings, null, 2), -1)
        } else {
            messageEl.style.color = 'red';
            messageEl.textContent = `Failed to minify reusableHackFunctions: ${result.error}`;
            return {success: false};
        }
    }
    editor.getSession().setMode(`ace/mode/${newTabIndex === 2 ? 'javascript' : 'json'}`)
    editor.getSession().setUndoManager(new ace.UndoManager())
    editor.moveCursorToPosition(editorCursorPosition[newTabIndex]);
    editor.renderer.scrollToY(editorCursorScroll[newTabIndex]);
    currentTabIndex = newTabIndex;
    editor.focus()
    return {success: true};
}

const tabSwitchDisplay = (newTabIndex) => {
    [0, 1, 2].forEach(v => {
        tabButtonEl[v].classList[v === newTabIndex ? 'add' : 'remove']('selected')
    })
    showSyncInfo()
}

window.electronAPI.loadConfigForEditing(async ({currentConfig, defaultConfig}) => {
    initialTotalConfig = currentConfig;
    if (isConfigVersionOutdated(currentConfig, defaultConfig)) {
        messageEl.style.color = 'red';
        messageEl.textContent = CONFIG_OUTDATED_MESSAGE;
    }
    editor = ace.edit(editorEl, {
        wrap: true,
        theme: 'ace/theme/xcode',
        mode: 'ace/mode/json',
        newLineMode: 'unix'
    });
    editor.setValue(JSON.stringify(initialTotalConfig, null, 2), -1);
    editor.getSession().setUndoManager(new ace.UndoManager())
    editor.focus()
});

tabButtonEl[0].addEventListener('click', async () => {
    const {success} = await tabSwitchData(0);
    if (success) {
        tabSwitchDisplay(0)
    }
});

tabButtonEl[1].addEventListener('click', async () => {
    const {success} = await tabSwitchData(1);
    if (success) {
        tabSwitchDisplay(1)
    }
});

tabButtonEl[2].addEventListener('click', async () => {
    const {success} = await tabSwitchData(2);
    if (success) {
        tabSwitchDisplay(2)
    }
});

document.getElementById('btnSaveAndClose').addEventListener('click', async () => {
    if (currentTabIndex !== 0) {
        const {success} = await tabSwitchData(0);
        if (!success) return;
        tabSwitchDisplay(0)
    }
    const newConfigJson = editor.getValue();
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
        if (currentTabIndex !== 0) {
            const {success} = await tabSwitchData(0);
            if (!success) return;
            tabSwitchDisplay(0)
        }
        const result = await window.electronAPI.executeResetOption(response, editor.getValue());
        if (!result) return;
        if (result.success) {
            if (result.defaultConfig) {
                editor.setValue(JSON.stringify(result.defaultConfig, null, 2), -1);
            }
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

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.electronAPI.closeWindow(EDITOR_WINDOW_NAME);
    }
});
