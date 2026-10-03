import { isConfigVersionOutdated } from '../../util/sharedUtil.js';
import ace from 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/ext-searchbox';
import 'ace-builds/src-min-noconflict/mode-javascript';
import 'ace-builds/src-min-noconflict/mode-json';
import 'ace-builds/src-min-noconflict/theme-xcode';
import jsWorker from 'ace-builds/src-min-noconflict/worker-javascript?url';
import jsonWorker from 'ace-builds/src-min-noconflict/worker-json?url';
import { config } from 'ace-builds';
import { CONFIG_OUTDATED_MESSAGE, EDITOR_WINDOW_NAME } from '../../constant/constant.js';
import { GlobalSettingsForm } from './components/config-form.js';

config.setModuleUrl('ace/mode/json_worker', jsonWorker);
config.setModuleUrl('ace/mode/javascript_worker', jsWorker);

const TAB_COUNT = 4;

const editorEl = document.getElementById('configEditor');
const formContainerEl = document.getElementById('globalSettingsFormContainer');
const tabButtonEl = [
    document.getElementById('fullConfigButton'),
    document.getElementById('globalSettingsUIButton'),
    document.getElementById('globalSettingsButton'),
    document.getElementById('hackFunctionsButton')
];
const messageEl = document.getElementById('infoOrErrorMessage');
const editorCursorScroll = new Array(TAB_COUNT).fill(0);
const editorCursorPosition = new Array(TAB_COUNT).fill(null).map(() => ({ row: 0, column: 0 }));
let editor;
let globalSettingsForm;

let initialTotalConfig;
let currentTabIndex = 0;

const showSyncInfo = () => {
    messageEl.style.color = 'green';
    messageEl.textContent = 'Changes among different tab will be synced in realtime.';
};

// Save current tab's data to memory (initialTotalConfig)
const saveCurrentTab = async () => {
    if (currentTabIndex === 0 || currentTabIndex === 2) {
        // JSON tab - parse editor content
        const jsonStr = editor.getValue();
        let parsed;
        try {
            parsed = JSON.parse(jsonStr || '{}');
        } catch (e) {
            messageEl.style.color = 'red';
            messageEl.textContent = `Can not switch tab due to Invalid JSON: ${e.message}`;
            return false;
        }
        if (currentTabIndex === 0) {
            initialTotalConfig = parsed;
        } else {
            initialTotalConfig = { ...initialTotalConfig, globalSettings: parsed };
        }
        editorCursorScroll[currentTabIndex] = editor.renderer.getScrollTop();
        editorCursorPosition[currentTabIndex] = editor.getSelection().getCursor();
    } else if (currentTabIndex === 1) {
        // UI form - collect data
        initialTotalConfig.globalSettings = globalSettingsForm.collect();
    } else if (currentTabIndex === 3) {
        // Hack functions - minify
        const result = await window.electronAPI.minifyFunction(editor.getValue() || '');
        if (result.success) {
            initialTotalConfig.reusableHackFunctions = result.content;
        } else {
            messageEl.style.color = 'red';
            messageEl.textContent = `Failed to minify reusableHackFunctions: ${result.error}`;
            return false;
        }
        editorCursorScroll[3] = editor.renderer.getScrollTop();
        editorCursorPosition[3] = editor.getSelection().getCursor();
    }
    return true;
};

// Populate new tab from memory
const populateTab = async (tabIndex) => {
    const isUITab = tabIndex === 1;

    // Show/hide editor vs form
    editorEl.style.display = isUITab ? 'none' : '';
    formContainerEl.style.display = isUITab ? 'block' : 'none';

    if (tabIndex === 0) {
        editor.setValue(JSON.stringify(initialTotalConfig, null, 2), -1);
        editor.getSession().setMode('ace/mode/json');
    } else if (tabIndex === 1) {
        globalSettingsForm.populate(initialTotalConfig.globalSettings || {});
        return true;
    } else if (tabIndex === 2) {
        editor.setValue(JSON.stringify(initialTotalConfig.globalSettings || {}, null, 2), -1);
        editor.getSession().setMode('ace/mode/json');
    } else if (tabIndex === 3) {
        const result = await window.electronAPI.formatFunction(initialTotalConfig.reusableHackFunctions || {});
        if (result.success) {
            editor.setValue(result.content, -1);
        } else {
            messageEl.style.color = 'red';
            messageEl.textContent = `Failed to convert reusableHackFunctions: ${result.error}`;
            return false;
        }
        editor.getSession().setMode('ace/mode/javascript');
    }
    if (!isUITab) {
        editor.getSession().setUndoManager(new ace.UndoManager());
        editor.moveCursorToPosition(editorCursorPosition[tabIndex]);
        editor.renderer.scrollToY(editorCursorScroll[tabIndex]);
        editor.focus();
    }
    return true;
};

const tabSwitchData = async (newTabIndex) => {
    if (currentTabIndex === newTabIndex) return { success: false };
    messageEl.textContent = '';

    // Save current tab
    const saved = await saveCurrentTab();
    if (!saved) return { success: false };

    // Populate new tab
    const populated = await populateTab(newTabIndex);
    if (!populated) return { success: false };

    currentTabIndex = newTabIndex;
    return { success: true };
};

const tabSwitchDisplay = (newTabIndex) => {
    for (let i = 0; i < TAB_COUNT; i++) {
        tabButtonEl[i].classList[i === newTabIndex ? 'add' : 'remove']('selected');
    }
    showSyncInfo();
};

window.electronAPI.loadConfigForEditing(async ({ currentConfig, defaultConfig, ruleCopied }) => {
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
    editor.getSession().setUndoManager(new ace.UndoManager());
    editor.focus();

    // Initialize global settings form
    globalSettingsForm = new GlobalSettingsForm(formContainerEl, ruleCopied);
});

// Tab click handlers
for (let i = 0; i < TAB_COUNT; i++) {
    tabButtonEl[i].addEventListener('click', async () => {
        const { success } = await tabSwitchData(i);
        if (success) tabSwitchDisplay(i);
    });
}

document.getElementById('btnSaveAndClose').addEventListener('click', async () => {
    if (currentTabIndex !== 0) {
        const { success } = await tabSwitchData(0);
        if (!success) return;
        tabSwitchDisplay(0);
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
            const { success } = await tabSwitchData(0);
            if (!success) return;
            tabSwitchDisplay(0);
        }
        const result = await window.electronAPI.executeResetOption(response, editor.getValue());
        if (!result) return;
        if (result.success) {
            if (result.defaultConfig) {
                initialTotalConfig = result.defaultConfig;
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
