import { getProfileByIndex, isConfigVersionOutdated, toColorString } from '../../util/sharedUtil.js';
import ace from 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/ext-searchbox';
import 'ace-builds/src-min-noconflict/mode-json';
import 'ace-builds/src-min-noconflict/theme-xcode';
import jsonWorker from 'ace-builds/src-min-noconflict/worker-json?url';
import { config } from 'ace-builds';
import { CONFIG_OUTDATED_MESSAGE, PROFILE_EDITOR_WINDOW_NAME } from '../../constant/constant.js';
import { GlobalSettingsForm, ProfileForm } from './components/config-form.js';

config.setModuleUrl('ace/mode/json_worker', jsonWorker);

const TAB_COUNT = 4;

const title = document.getElementById('title');
const profileEditIcon = document.getElementById('profileEditIcon');
const editorEl = document.getElementById('configEditor');
const profileFormContainerEl = document.getElementById('profileFormContainer');
const globalSettingsFormContainerEl = document.getElementById('globalSettingsFormContainer');
const messageEl = document.getElementById('infoOrErrorMessage');
const tabButtonEl = [
    document.getElementById('profileUIButton'),
    document.getElementById('configButton'),
    document.getElementById('globalSettingsUIButton'),
    document.getElementById('globalSettingsButton')
];
const editorCursorScroll = new Array(TAB_COUNT).fill(0);
const editorCursorPosition = new Array(TAB_COUNT).fill(null).map(() => ({ row: 0, column: 0 }));

let editor;
let profileForm;
let globalSettingsForm;
let currentProfileColor;
let profileIndex = -1;
let currentTabIndex = 0;
let profileJson;
let globalSettingsJson;

const showSyncInfo = () => {
    messageEl.style.color = 'green';
    messageEl.textContent = 'Changes among different tab will be synced in realtime.';
};

// Save current tab's data to memory
const saveCurrentTab = () => {
    if (currentTabIndex === 1 || currentTabIndex === 3) {
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
        if (currentTabIndex === 1) {
            profileJson = parsed;
        } else {
            globalSettingsJson = parsed;
        }
        editorCursorScroll[currentTabIndex] = editor.renderer.getScrollTop();
        editorCursorPosition[currentTabIndex] = editor.getSelection().getCursor();
    } else if (currentTabIndex === 0) {
        // Profile UI form - collect data
        profileJson = profileForm.collect();
    } else if (currentTabIndex === 2) {
        // Global settings UI form - collect data
        globalSettingsJson = globalSettingsForm.collect();
    }
    return true;
};

// Populate new tab from memory
const populateTab = (tabIndex) => {
    const isUITab = tabIndex === 0 || tabIndex === 2;

    // Show/hide containers
    editorEl.style.display = isUITab ? 'none' : '';
    profileFormContainerEl.style.display = tabIndex === 0 ? 'block' : 'none';
    globalSettingsFormContainerEl.style.display = tabIndex === 2 ? 'block' : 'none';
    if (tabIndex === 0) {
        profileForm.populate(
            profileJson,
            globalSettingsJson?.substitute,
            Object.keys(globalSettingsJson?.profileSet || {})
        );
        return;
    } else if (tabIndex === 1) {
        editor.setValue(JSON.stringify(profileJson, null, 2), -1);
    } else if (tabIndex === 2) {
        globalSettingsForm.populate(globalSettingsJson);
        return;
    } else if (tabIndex === 3) {
        editor.setValue(JSON.stringify(globalSettingsJson, null, 2), -1);
    }
    if (!isUITab) {
        editor.getSession().setMode('ace/mode/json');
        editor.getSession().setUndoManager(new ace.UndoManager());
        editor.moveCursorToPosition(editorCursorPosition[tabIndex]);
        editor.renderer.scrollToY(editorCursorScroll[tabIndex]);
        editor.focus();
    }
};

const tabSwitchData = async (newTabIndex) => {
    if (currentTabIndex === newTabIndex) return { success: false };
    messageEl.textContent = '';

    // Save current tab
    const saved = saveCurrentTab();
    if (!saved) return { success: false };

    // Populate new tab
    populateTab(newTabIndex);
    currentTabIndex = newTabIndex;
    return { success: true };
};

const tabSwitchDisplay = (newTabIndex) => {
    for (let i = 0; i < TAB_COUNT; i++) {
        tabButtonEl[i].classList[i === newTabIndex ? 'add' : 'remove']('selected');
    }
    showSyncInfo();
};

window.electronAPI.loadConfigForEditing(async ({ currentConfig, profileColors, defaultConfig, index, ruleCopied }) => {
    profileJson = getProfileByIndex(currentConfig, index) || {};
    globalSettingsJson = currentConfig?.globalSettings || {};
    const ordinal = index === 0 ? '1st' : index === 1 ? '2nd' : index === 2 ? '3rd' : index + 1 + 'th';
    title.textContent = `Edit ${ordinal} Profile`;
    profileIndex = index;
    currentProfileColor = profileColors[index];
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

    title.closest('.editor-container-title-inner').nextElementSibling.textContent = profileJson.name ?? '';

    // Initialize form instances
    profileForm = new ProfileForm(profileFormContainerEl, currentProfileColor, ruleCopied);
    globalSettingsForm = new GlobalSettingsForm(globalSettingsFormContainerEl, ruleCopied);

    // Default tab is 0 (current profile UI)
    editorEl.style.display = 'none';
    profileFormContainerEl.style.display = 'block';
    profileForm.populate(
        profileJson,
        globalSettingsJson?.substitute,
        Object.keys(globalSettingsJson?.profileSet || {})
    );

    profileEditIcon.style.backgroundColor = toColorString(currentProfileColor);
});

// Sync current tab data to memory (for save action)
const syncCurrentTabToMemory = () => {
    if (currentTabIndex === 0) {
        profileJson = profileForm.collect();
    } else if (currentTabIndex === 1) {
        try {
            profileJson = JSON.parse(editor.getValue());
        } catch (e) {
            throw new Error(`Invalid JSON: ${e.message}`);
        }
    } else if (currentTabIndex === 2) {
        globalSettingsJson = globalSettingsForm.collect();
    } else if (currentTabIndex === 3) {
        try {
            globalSettingsJson = JSON.parse(editor.getValue());
        } catch (e) {
            throw new Error(`Invalid JSON: ${e.message}`);
        }
    }
};

const saveAction = async (asNew) => {
    try {
        syncCurrentTabToMemory();
        const result = await window.electronAPI.saveEditedProfile(
            asNew === null ? null : globalSettingsJson,
            asNew === null ? null : profileJson,
            profileIndex,
            asNew
        );
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
};

// Tab click handlers
for (let i = 0; i < TAB_COUNT; i++) {
    tabButtonEl[i].addEventListener('click', async () => {
        const { success } = await tabSwitchData(i);
        if (success) tabSwitchDisplay(i);
    });
}

document.getElementById('btnSaveAndClose').addEventListener('click', async () => {
    await saveAction(false);
});

document.getElementById('btnMore').addEventListener('click', async () => {
    const response = await window.electronAPI.openMoreOptions();
    if (response < 0 || response >= 2) return;
    if (response === 0) await saveAction(true);
    if (response === 1) await saveAction(null); // null means to remove current profile
});

document.getElementById('btnAbort').addEventListener('click', () => {
    window.close();
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.electronAPI.closeWindow(PROFILE_EDITOR_WINDOW_NAME);
    }
});
