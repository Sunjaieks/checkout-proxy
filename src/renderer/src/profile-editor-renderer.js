import {getProfileByIndex, isConfigVersionOutdated} from "../../util/sharedUtil.js";
import ace from 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/ext-searchbox';
import "ace-builds/src-min-noconflict/mode-json";
import "ace-builds/src-min-noconflict/theme-xcode";
import jsonWorker from "ace-builds/src-min-noconflict/worker-json?url";
import {config} from "ace-builds";
import {CONFIG_OUTDATED_MESSAGE, PROFILE_EDITOR_WINDOW_NAME} from "../../constant/constant.js";

config.setModuleUrl("ace/mode/json_worker", jsonWorker)

const title = document.getElementById('title');
const editorEl = document.getElementById('configEditor');
const messageEl = document.getElementById('infoOrErrorMessage');
const tabButtonEl = [document.getElementById('configButton'), document.getElementById('globalSettingsButton')];
const editorCursorScroll = [0, 0];
const editorCursorPosition = [{row: 0, column: 0}, {row: 0, column: 0}];

let editor;
let profileIndex = -1;
let currentTabIndex = 0;
let profileJson;
let globalSettingsJson;

const tabSwitchData = async (newTabIndex) => {
    if (currentTabIndex === newTabIndex) return {success: false};
    messageEl.textContent = ''
    const newConfigJsonString = editor.getValue();
    let newConfigJson;
    try {
        newConfigJson = JSON.parse(newConfigJsonString || {})
    } catch (e) {
        messageEl.style.color = 'red';
        messageEl.textContent = `Can not switch tab due to Invalid JSON: ${e.message}`;
        return {success: false};
    }
    if (currentTabIndex === 0) {
        profileJson = newConfigJson;
        editorCursorScroll[0] = editor.renderer.getScrollTop()
        editorCursorPosition[0] = editor.getSelection().getCursor()
        editor.setValue(JSON.stringify(globalSettingsJson, null, 2), -1);
    } else {
        globalSettingsJson = newConfigJson;
        editorCursorScroll[1] = editor.renderer.getScrollTop()
        editorCursorPosition[1] = editor.getSelection().getCursor()
        editor.setValue(JSON.stringify(profileJson, null, 2), -1);
    }
    editor.getSession().setUndoManager(new ace.UndoManager())
    editor.moveCursorToPosition(editorCursorPosition[newTabIndex]);
    editor.renderer.scrollToY(editorCursorScroll[newTabIndex]);
    currentTabIndex = newTabIndex;
    editor.focus()
    return {success: true};
}

window.electronAPI.loadConfigForEditing(async ({currentConfig, defaultConfig, index}) => {
    title.textContent = `${title.textContent} (index:${index})`;
    profileIndex = index;
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
    profileJson = getProfileByIndex(currentConfig, index) || {}
    globalSettingsJson = currentConfig?.globalSettings || {}
    editor.setValue(JSON.stringify(profileJson, null, 2), -1);
    editor.getSession().setUndoManager(new ace.UndoManager())
    editor.focus()
});

const saveAction = async (asNew) => {
    try {
        const newProfileJson = asNew === null ? null : currentTabIndex === 0 ? JSON.parse(editor.getValue()) : profileJson;
        const globalSettings = asNew === null ? null : currentTabIndex === 1 ? JSON.parse(editor.getValue()) : globalSettingsJson;
        const result = await window.electronAPI.saveEditedProfile(globalSettings, newProfileJson, profileIndex, asNew);
        if (result.success) {
            window.close();
        } else {
            messageEl.style.color = 'red';
            messageEl.textContent = `Error: ${result?.error || 'Action failed.'}`;
        }
    } catch (e) {
        messageEl.style.color = 'red';
        messageEl.textContent = `Error: ${e.message}`;
    }
}

const showSyncInfo = () => {
    messageEl.style.color = 'green';
    messageEl.textContent = 'Changes among different tab will be synced in realtime.';
}

const tabSwitchDisplay = (newTabIndex) => {
    [0, 1, 2].forEach(v => {
        tabButtonEl[v].classList[v === newTabIndex ? 'add' : 'remove']('selected')
    })
    showSyncInfo()
}

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

document.getElementById('btnSaveAndClose').addEventListener('click', async () => {
    await saveAction(false)
});

document.getElementById('btnMore').addEventListener('click', async () => {
    const response = await window.electronAPI.openMoreOptions();
    if (response < 0 || response >= 2) return;
    if (response === 0) await saveAction(true);
    if (response === 1) await saveAction(null) // null means to remove current profile
});

document.getElementById('btnAbort').addEventListener('click', () => {
    window.close();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.electronAPI.closeWindow(PROFILE_EDITOR_WINDOW_NAME);
    }
});
