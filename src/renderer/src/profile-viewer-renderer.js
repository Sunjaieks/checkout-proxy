import ace from 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/ext-searchbox';
import 'ace-builds/src-min-noconflict/mode-json';
import 'ace-builds/src-min-noconflict/theme-xcode';
import { PROFILE_VIEWER_WINDOW_NAME } from '../../constant/constant.js';

const editorEl = document.getElementById('profileViewerEditor');

const editor = ace.edit(editorEl, {
    wrap: true,
    theme: 'ace/theme/xcode',
    mode: 'ace/mode/json',
    readOnly: true,
    newLineMode: 'unix',
    useWorker: false
});
editor.renderer.setShowGutter(true);
editor.setHighlightGutterLine(false);

window.electronAPI.onLoadProfileViewer((profileJson, decided) => {
    try {
        const profile = JSON.parse(profileJson);
        [
            ...Object.values(profile?.proxy?.httpFixedRule || {}),
            ...Object.values(profile?.proxy?.httpsFixedRule || {})
        ].forEach((rule) => {
            if (rule.rawHackRequest) {
                delete rule.hackRequest;
                if (rule.rawHackRequest.length > 0) rule.hackRequest = rule.rawHackRequest;
                delete rule.rawHackRequest;
            }
            if (rule.rawHackResponse) {
                delete rule.hackResponse;
                if (rule.rawHackResponse.length > 0) rule.hackResponse = rule.rawHackResponse;
                delete rule.rawHackResponse;
            }
        });
        ['color', 'fromGlobal', 'toBeDecided'].forEach((field) => delete profile[field]);
        editor.setValue(JSON.stringify({ name: profile.name, decided, ...profile }, null, 2), -1);
    } catch (err) {
        editor.setValue(`...[[Checkout-Proxy] parse error]\n${JSON.stringify(err)}`, -1);
    }
    editor.moveCursorTo(0, 0);
});

document.getElementById('btnClose').addEventListener('click', () => {
    window.electronAPI.closeWindow(PROFILE_VIEWER_WINDOW_NAME);
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        event.preventDefault();
        window.electronAPI.closeWindow(PROFILE_VIEWER_WINDOW_NAME);
    }
});
