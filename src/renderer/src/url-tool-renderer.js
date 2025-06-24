// Encode/Decode Tool Renderer

import { TOOLS_WINDOW_NAME } from '../../constant/constant';

const inputTextEl = document.getElementById('input-text');
const outputTextEl = document.getElementById('output-text');
const statusMessageEl = document.getElementById('status-message');
const convertBtn = document.getElementById('convert-btn');
const swapBtn = document.getElementById('swap-btn');
const clearInputBtn = document.getElementById('clear-input');
const copyOutputBtn = document.getElementById('copy-output');
const closeBtn = document.getElementById('close-btn');
const urlOptionsEl = document.getElementById('url-options');
const encodingOptionsEl = document.getElementById('encoding-options');

// Mode and encoding radio buttons
const modeUrlEncodeEl = document.getElementById('mode-url-encode');
const modeUrlDecodeEl = document.getElementById('mode-url-decode');
const modeMd5El = document.getElementById('mode-md5');
const modeUnicodeEncodeEl = document.getElementById('mode-unicode-encode');
const modeUnicodeDecodeEl = document.getElementById('mode-unicode-decode');
const modeBase64EncodeEl = document.getElementById('mode-base64-encode');
const modeBase64DecodeEl = document.getElementById('mode-base64-decode');
const encodingUtf8El = document.getElementById('encoding-utf8');
const encodingEucJpEl = document.getElementById('encoding-eucjp');
const spaceAsPlusEl = document.getElementById('option-space-plus');
const componentOnlyEl = document.getElementById('option-component-only');

let statusTimeout = null;

function showStatus(message, isError = false) {
    if (statusTimeout) {
        clearTimeout(statusTimeout);
    }
    statusMessageEl.textContent = message;
    statusMessageEl.classList.toggle('error', isError);
    statusMessageEl.classList.add('visible');
    statusTimeout = setTimeout(() => {
        statusMessageEl.classList.remove('visible');
    }, 3000);
}

function getMode() {
    if (modeUrlEncodeEl.checked) return 'url-encode';
    if (modeUrlDecodeEl.checked) return 'url-decode';
    if (modeMd5El.checked) return 'md5';
    if (modeUnicodeEncodeEl.checked) return 'unicode-encode';
    if (modeUnicodeDecodeEl.checked) return 'unicode-decode';
    if (modeBase64EncodeEl.checked) return 'base64-encode';
    if (modeBase64DecodeEl.checked) return 'base64-decode';
    return 'url-encode';
}

function setMode(mode) {
    if (mode === 'md5') modeMd5El.checked = true;
    else if (mode === 'url-encode') modeUrlEncodeEl.checked = true;
    else if (mode === 'url-decode') modeUrlDecodeEl.checked = true;
    else if (mode === 'unicode-encode') modeUnicodeEncodeEl.checked = true;
    else if (mode === 'unicode-decode') modeUnicodeDecodeEl.checked = true;
    else if (mode === 'base64-encode') modeBase64EncodeEl.checked = true;
    else if (mode === 'base64-decode') modeBase64DecodeEl.checked = true;
    else modeMd5El.checked = true;
    updateOptionsVisibility();
}

function getSettings() {
    return {
        mode: getMode(),
        encoding: encodingUtf8El.checked ? 'utf-8' : 'euc-jp',
        spaceAsPlus: spaceAsPlusEl.checked,
        componentOnly: componentOnlyEl.checked
    };
}

function applySettings(settings) {
    setMode(settings.mode || 'url-encode');

    if (settings.encoding === 'euc-jp') {
        encodingEucJpEl.checked = true;
    } else {
        encodingUtf8El.checked = true;
    }

    spaceAsPlusEl.checked = settings.spaceAsPlus || false;
    componentOnlyEl.checked = settings.componentOnly !== false; // Default true
}

function updateOptionsVisibility() {
    const mode = getMode();
    const isUnicode = mode === 'unicode-encode' || mode === 'unicode-decode';
    const isBase64 = mode === 'base64-encode' || mode === 'base64-decode';
    const isUrl = mode === 'url-encode' || mode === 'url-decode';

    if (isUrl || mode === 'md5') {
        encodingOptionsEl.classList.remove('disabled');
    } else {
        encodingOptionsEl.classList.add('disabled');
    }

    if (isUrl) {
        urlOptionsEl.classList.remove('disabled');
        spaceAsPlusEl.parentElement.classList.remove('disabled');
        componentOnlyEl.parentElement.classList.remove('disabled');
        spaceAsPlusEl.parentElement.style.opacity = '';
        componentOnlyEl.parentElement.style.opacity = '';
    } else if (isBase64) {
        urlOptionsEl.classList.remove('disabled');
        spaceAsPlusEl.parentElement.classList.add('disabled');
        componentOnlyEl.parentElement.classList.remove('disabled');
        spaceAsPlusEl.parentElement.style.opacity = '0.4';
        componentOnlyEl.parentElement.style.opacity = '';
    } else {
        urlOptionsEl.classList.add('disabled');
        spaceAsPlusEl.parentElement.classList.add('disabled');
        componentOnlyEl.parentElement.classList.add('disabled');
        spaceAsPlusEl.parentElement.style.opacity = '';
        componentOnlyEl.parentElement.style.opacity = '';
    }
}

async function encodeUrl(input, settings) {
    try {
        let result;

        if (settings.encoding === 'utf-8') {
            if (settings.componentOnly) {
                result = encodeURIComponent(input);
            } else {
                result = encodeURI(input);
            }
        } else {
            // EUC-JP encoding via IPC (no UTF-8 fallback)
            result = await window.electronAPI.encodeUrlEucJp(input, {
                componentOnly: settings.componentOnly
            });
        }

        // Handle space as plus
        if (settings.spaceAsPlus) {
            result = result.replace(/%20/g, '+');
        }

        return result;
    } catch (e) {
        throw new Error('Encoding failed: ' + e.message);
    }
}

async function decodeUrl(input, settings) {
    try {
        let result = input;

        // Handle plus as space first
        if (settings.spaceAsPlus) {
            result = result.replace(/\+/g, ' ');
        }

        if (settings.encoding === 'utf-8') {
            if (settings.componentOnly) {
                result = decodeURIComponent(result);
            } else {
                result = decodeURI(result);
            }
        } else {
            // EUC-JP decoding via IPC (no UTF-8 fallback)
            result = await window.electronAPI.decodeUrlEucJp(result);
        }

        return result;
    } catch (e) {
        throw new Error('Decoding failed: ' + e.message);
    }
}

function unicodeEncode(input) {
    let result = '';
    for (const char of input) {
        const code = char.codePointAt(0);
        if (code > 0x7e) {
            // Non-ASCII → \uXXXX (or \uXXXX\uXXXX for surrogate pairs)
            const encoded = char
                .split('')
                .map((unit) => {
                    return '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0');
                })
                .join('');
            result += encoded;
        } else {
            result += char;
        }
    }
    return result;
}

function unicodeDecode(input) {
    return input.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function base64Encode(input, urlSafe = false) {
    try {
        const bytes = new TextEncoder().encode(input);
        const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
        let result = btoa(binString);
        if (urlSafe) {
            result = result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        return result;
    } catch (e) {
        throw new Error('Base64 encoding failed: ' + e.message);
    }
}

function base64Decode(input, urlSafe = false) {
    try {
        let decoded = input;
        if (urlSafe) {
            try {
                decoded = decodeURIComponent(decoded);
            } catch (_) {}
            decoded = decoded.replace(/-/g, '+').replace(/_/g, '/');
            const pad = decoded.length % 4;
            if (pad) {
                decoded += '='.repeat(4 - pad);
            }
        }
        const binString = atob(decoded);
        const bytes = Uint8Array.from(binString, (m) => m.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch (e) {
        throw new Error('Base64 decoding failed: ' + e.message);
    }
}

async function convert() {
    const input = inputTextEl.value;
    if (!input) {
        showStatus('Please enter some text to convert', true);
        return;
    }

    const settings = getSettings();

    try {
        let result;
        if (settings.mode === 'url-encode') {
            result = await encodeUrl(input, settings);
        } else if (settings.mode === 'url-decode') {
            result = await decodeUrl(input, settings);
        } else if (settings.mode === 'md5') {
            // Use Node.js crypto module via IPC with selected encoding
            result = await window.electronAPI.computeMd5(input, settings.encoding);
        } else if (settings.mode === 'unicode-encode') {
            result = unicodeEncode(input);
        } else if (settings.mode === 'unicode-decode') {
            result = unicodeDecode(input);
        } else if (settings.mode === 'base64-encode') {
            result = base64Encode(input, settings.componentOnly);
        } else if (settings.mode === 'base64-decode') {
            result = base64Decode(input, settings.componentOnly);
        } else {
            throw new Error('Unknown mode selected');
        }
        outputTextEl.value = result;
        showStatus('Conversion successful!');

        // Save settings
        saveSettings();
    } catch (e) {
        showStatus(e.message, true);
    }
}

function swap() {
    const temp = inputTextEl.value;
    inputTextEl.value = outputTextEl.value;
    outputTextEl.value = temp;

    const mode = getMode();

    // For MD5 mode, just swap input/output without toggling mode
    if (mode === 'md5') {
        showStatus('Input and output swapped');
    } else if (mode === 'unicode-encode') {
        setMode('unicode-decode');
        showStatus('Input and output swapped, mode toggled');
    } else if (mode === 'unicode-decode') {
        setMode('unicode-encode');
        showStatus('Input and output swapped, mode toggled');
    } else if (mode === 'base64-encode') {
        setMode('base64-decode');
        showStatus('Input and output swapped, mode toggled');
    } else if (mode === 'base64-decode') {
        setMode('base64-encode');
        showStatus('Input and output swapped, mode toggled');
    } else {
        // For URL modes, toggle between encode and decode
        if (mode === 'url-encode') {
            setMode('url-decode');
        } else {
            setMode('url-encode');
        }
        showStatus('Input and output swapped, mode toggled');
    }
}

function clearInput() {
    inputTextEl.value = '';
    inputTextEl.focus();
}

async function copyOutput() {
    const output = outputTextEl.value;
    if (!output) {
        showStatus('Nothing to copy', true);
        return;
    }

    try {
        await navigator.clipboard.writeText(output);
        showStatus('Copied to clipboard!');
    } catch (e) {
        showStatus('Failed to copy: ' + e.message, true);
    }
}

function saveSettings() {
    const settings = getSettings();
    window.electronAPI?.saveUrlToolSettings?.(settings);
}

async function loadSettings() {
    try {
        const settings = await window.electronAPI?.getUrlToolSettings?.();
        if (settings) {
            applySettings(settings);
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

// Event listeners
convertBtn.addEventListener('click', convert);
swapBtn.addEventListener('click', swap);
clearInputBtn.addEventListener('click', clearInput);
copyOutputBtn.addEventListener('click', copyOutput);
closeBtn.addEventListener('click', () => {
    window.electronAPI?.closeWindow?.(TOOLS_WINDOW_NAME);
});

// Mode change handler
[
    modeUrlEncodeEl,
    modeUrlDecodeEl,
    modeMd5El,
    modeUnicodeEncodeEl,
    modeUnicodeDecodeEl,
    modeBase64EncodeEl,
    modeBase64DecodeEl
].forEach((el) => {
    el.addEventListener('change', () => {
        updateOptionsVisibility();
        if (inputTextEl.value) {
            convert();
        }
        saveSettings();
    });
});

// Other settings change handler
[encodingUtf8El, encodingEucJpEl, spaceAsPlusEl, componentOnlyEl].forEach((el) => {
    el.addEventListener('change', () => {
        if (inputTextEl.value) {
            convert();
        }
        saveSettings();
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        convert();
    } else if (event.key === 'Escape') {
        window.electronAPI?.closeWindow?.(TOOLS_WINDOW_NAME);
    }
});

// Initialize
loadSettings();
updateOptionsVisibility();
