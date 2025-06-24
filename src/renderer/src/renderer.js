import { toColorString } from '../../util/sharedUtil';
import { generateQR } from './module/qr-code';

const httpPortEl = document.getElementById('httpPort');
const activeProfileNameEl = document.getElementById('activeProfileName');
const activePlaceholderEl = document.getElementById('activePlaceholder');
const activeProfileIndicatorEl = document.getElementById('activeProfileIndicator');
const statusMessageEl = document.getElementById('statusMessage');
const profilesAreaEl = document.getElementById('profilesArea');
const profilesAreaInnerEl = profilesAreaEl.firstElementChild;
const appVersionDisplayEl = document.getElementById('app-version-display');

const placeholderOverlayEl = document.getElementById('placeholder-overlay');
const placeholderDialogEl = document.getElementById('placeholder-dialog');
const placeholderInputsEl = document.getElementById('placeholder-inputs');
const placeholderOkBtn = document.getElementById('placeholder-ok-btn');
const directConnectBtn = document.getElementById('btnDirectConnect');

// More popup elements
const moreOverlayEl = document.getElementById('more-overlay');
const morePopupEl = document.getElementById('more-popup');

// Tools popup elements
const toolsOverlayEl = document.getElementById('tools-overlay');
const toolsPopupEl = document.getElementById('tools-popup');
const toolsProxyStatusEl = document.getElementById('tools-proxy-status');
const toolsToggleProxyBtn = document.getElementById('tools-toggle-proxy');

let placeHolderOptionsMap = {};
let currentConfigData = null;
let currentConfigColor = [];
let currentActiveProfileIndex = -9;
let currentDecided = {};
let currentInput = null;
let debounceTimer;
let placeholderModalTabFocusIndex = 0;
let placeholderModalTabEls = [];
let disableMouseEvents = false;
const placeholderDialogOnClickHandler = [];
const recentUsedMap = new Map();
let moreActionInProgress = 0;

function debounce(func) {
    return function () {
        let context = this;
        let args = arguments;
        let isImmediately = !debounceTimer;
        if (!debounceTimer) {
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
            }, 400);
        }
        isImmediately ? func.apply(context, args) : null;
    };
}

async function loadAppVersion() {
    try {
        const version = await window.electronAPI.getAppVersion();
        if (appVersionDisplayEl) {
            appVersionDisplayEl.textContent = `Version: ${version}`;
        }
    } catch (error) {
        if (appVersionDisplayEl) {
            appVersionDisplayEl.textContent = 'Version: N/A';
        }
    }
}

function renderProfilesStatus(activeProfileIndex, placeholders) {
    directConnectBtn?.classList[activeProfileIndex === -1 ? 'add' : 'remove']('on');
    const allLeftContainer = profilesAreaInnerEl.querySelectorAll('.profile-left-container');
    allLeftContainer?.forEach((node, index) => {
        const line = node.parentNode;
        const indicator = node.nextSibling.querySelector('.profile-indicator-container .indicator');
        const placeholderContainer = node.querySelector('.profile-left-bottom-container');
        const anchorContainer = node.querySelector('.profile-anchor-icon');
        const profileNameContainer = anchorContainer.nextElementSibling;
        const colorArray = anchorContainer.dataset.anchorcolor.split(',').map((v) => parseInt(v, 10));
        const lineColorArray = [...colorArray];
        profileNameContainer.classList.remove('bold');
        indicator.classList.remove('on');
        line.classList.remove('on');
        indicator.classList.remove('error');
        if (placeholderContainer) placeholderContainer.outerHTML = '';
        if (indicator.dataset.profile === `${activeProfileIndex}`) {
            lineColorArray[2] += 42;
            profileNameContainer.classList.add('bold');
            indicator.classList.add('on');
            line.classList.add('on');
            if (Object.keys(placeholders || {}).length > 0) {
                const leftBottomContainer = document.createElement('div');
                leftBottomContainer.className = 'profile-left-bottom-container';
                leftBottomContainer.textContent =
                    '=> ' +
                    Object.entries(placeholders)
                        .map(([key, value]) => `${key}:${value}`)
                        .join(', ');
                node.append(leftBottomContainer);
            }
        }
        anchorContainer.style.setProperty('--icon-color', toColorString(colorArray));
        line.style.setProperty('--line-color', toColorString(lineColorArray));
    });
}

function updateStatusDisplay(status) {
    if (status.appPort) {
        httpPortEl.textContent = status.appPort[0];
    }

    currentActiveProfileIndex = status.activeProfileIndex ?? currentActiveProfileIndex;
    currentDecided = status.toBeDecided ?? (currentActiveProfileIndex >= -1 ? currentDecided : {});
    renderProfilesStatus(currentActiveProfileIndex, currentDecided);

    if (currentActiveProfileIndex === -1) {
        activeProfileNameEl.textContent = 'Direct Connect';
        activeProfileIndicatorEl.className = 'indicator on';
        activePlaceholderEl.textContent = '';
    } else if (currentActiveProfileIndex >= 0 && currentConfigData?.profile?.[currentActiveProfileIndex]) {
        activeProfileNameEl.textContent = status.profileName ?? activeProfileNameEl.textContent;
        activeProfileIndicatorEl.className = 'indicator on';
        const placeholderString = Object.entries(currentDecided || {})
            .map(([key, value]) => `${key}:${value}`)
            .join(', ');
        activePlaceholderEl.textContent = placeholderString ? `<${placeholderString}>` : '';
    } else {
        activeProfileNameEl.textContent = 'None';
        activeProfileIndicatorEl.className = 'indicator';
        activePlaceholderEl.textContent = '';
    }

    statusMessageEl.style.visibility = false;
    if (status.message) {
        statusMessageEl.textContent = status.message;
        statusMessageEl.style.color = 'green';
    }
    if (status.warning) {
        statusMessageEl.textContent = status.warning;
        statusMessageEl.style.color = 'brown';
    }
    if (status.error) {
        statusMessageEl.textContent = status.error;
        statusMessageEl.style.color = 'red';
        // If error, ensure main indicator is off or error state
        if (!status.keepIconColor) {
            activeProfileIndicatorEl.className = 'indicator error';
        }
    }
    if (statusMessageEl.scrollHeight > 31) {
        statusMessageEl.classList.add('big');
    } else {
        statusMessageEl.classList.remove('big');
    }
    statusMessageEl.style.visibility = true;
}

function renderProfiles() {
    profilesAreaInnerEl.classList.remove('bouncy');
    if (!currentConfigData || !currentConfigData.profile) {
        profilesAreaInnerEl.innerHTML = '<p>No profiles configured.</p>';
        return;
    }

    profilesAreaInnerEl.innerHTML = ''; // Clear existing
    if (currentConfigData.profile.length === 0) {
        profilesAreaInnerEl.innerHTML = '<p>No profiles configured. Click "Edit Config" to add some.</p>';
        return;
    }

    currentConfigData.profile.forEach((profile, index, array) => {
        const item = document.createElement('div');
        item.className = 'profile-item';

        const profileLeftContainer = document.createElement('div');
        profileLeftContainer.className = 'profile-left-container';
        const profileLeftTopContainer = document.createElement('div');
        profileLeftTopContainer.className = 'profile-left-top-container';

        const nameEl = document.createElement('span');
        nameEl.className = 'profile-name';
        nameEl.textContent = profile.name || `Profile ${index}`;

        const anchorEl = document.createElement('span');
        anchorEl.className = 'profile-anchor-icon';
        anchorEl.classList.add(profile.toBeDecided?.length > 0 ? 'anchors' : 'anchor');
        const colorObj = currentConfigColor[index];
        anchorEl.style.setProperty('--icon-color', toColorString(colorObj));
        anchorEl.dataset.anchorcolor = colorObj.join(',');

        const editEl = document.createElement('span');
        editEl.className = 'profile-edit-icon';
        editEl.addEventListener(
            'click',
            debounce((event) => {
                event.preventDefault();
                window.electronAPI.editProxyProfile(index);
            })
        );
        profileLeftTopContainer.append(anchorEl, nameEl, editEl);
        profileLeftContainer.append(profileLeftTopContainer);

        const rightContainer = document.createElement('div');
        rightContainer.className = 'profile-right-container';
        const rightTopContainer = document.createElement('div');
        rightTopContainer.className = 'profile-right-top-container';

        const actionsEl = document.createElement('div');
        actionsEl.className = 'profile-actions';

        const startButton = document.createElement('button');
        startButton.textContent = 'Start';
        startButton.addEventListener(
            'click',
            debounce((event) => {
                event.preventDefault();
                if (profile.toBeDecided?.length > 0) {
                    showPlaceholderDialog(index, profile.toBeDecided, startButton);
                } else {
                    window.electronAPI.startProxyProfile(index);
                }
            })
        );

        const indicatorContainer = document.createElement('div');
        indicatorContainer.className = 'profile-indicator-container';
        const indicator = document.createElement('span');
        indicator.dataset.profile = index;
        indicator.className = 'indicator';
        if (index === currentActiveProfileIndex) {
            // Check status message for errors. If an error occurred during start, show red.
            if (statusMessageEl.style.color === 'red') {
                indicator.classList.add('error');
            } else {
                indicator.classList.add('on');
            }
        }

        indicatorContainer.appendChild(indicator);
        actionsEl.appendChild(startButton);
        rightTopContainer.append(actionsEl, indicatorContainer);
        rightContainer.append(rightTopContainer);

        item.appendChild(profileLeftContainer);
        item.appendChild(rightContainer);
        profilesAreaInnerEl.appendChild(item);
    });
    if (profilesAreaInnerEl.scrollHeight > profilesAreaEl.clientHeight) {
        profilesAreaInnerEl.classList.add('bouncy');
    }
}

function repositionAndShowOptions(placeholderName, optionsContainer, alwaysShow = false) {
    if (!currentInput || (!alwaysShow && optionsContainer.classList.contains('visible'))) {
        optionsContainer.classList.remove('visible');
        placeHolderOptionsMap[placeholderName]?.[1]?.classList?.remove('selected');
        placeHolderOptionsMap[placeholderName] = [placeHolderOptionsMap[placeholderName][0], undefined];
        return;
    }
    if (optionsContainer.dataset.repositioned !== '1') {
        optionsContainer.dataset.repositioned = '1';
        const inputRect = currentInput.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const preferredHeight = 200;
        const margin = 8;

        const spaceBelow = viewportHeight - inputRect.bottom;
        const spaceAbove = inputRect.top;

        optionsContainer.style.bottom = '';
        optionsContainer.style.top = '';
        optionsContainer.style.maxHeight = `${preferredHeight}px`;
        optionsContainer.style.maxWidth = inputRect.width - 30 + 'px';

        if (spaceBelow >= preferredHeight || spaceBelow > spaceAbove) {
            optionsContainer.style.top = `${inputRect.bottom + margin}px`;
            if (spaceBelow < preferredHeight) {
                optionsContainer.style.maxHeight = `${spaceBelow - margin * 2}px`;
            }
        } else {
            optionsContainer.style.bottom = `${viewportHeight - inputRect.top + margin}px`;
            if (spaceAbove < preferredHeight) {
                optionsContainer.style.maxHeight = `${spaceAbove - margin * 2}px`;
            }
        }
        optionsContainer.style.left = `${inputRect.left}px`;
        optionsContainer.style.width = `${inputRect.width}px`;
    }
    optionsContainer.classList.add('visible');
}

function updateHighlight(input, allOptions, selectedOption, keyboard, placeholderName) {
    allOptions.forEach((option) => option.classList.remove('selected'));
    let option = selectedOption || placeHolderOptionsMap[placeholderName]?.[1];
    if (!option) {
        option = keyboard === 'ArrowUp' ? allOptions[allOptions.length - 1] : allOptions[0];
        option.classList.add('selected');
        placeHolderOptionsMap[placeholderName] = [input, option];
        input.value = option?.textContent ?? input.value;
    } else {
        if (keyboard === 'ArrowUp') {
            option = option.previousElementSibling === null ? undefined : option.previousElementSibling;
            option?.classList.add('selected');
            placeHolderOptionsMap[placeholderName] = [input, option];
            input.value = option?.textContent ?? input.value;
        } else if (keyboard === 'ArrowDown') {
            option = option.nextElementSibling === null ? undefined : option.nextElementSibling;
            option?.classList.add('selected');
            placeHolderOptionsMap[placeholderName] = [input, option];
            input.value = option?.textContent ?? input.value;
        } else {
            //mouse
            option.classList.add('selected');
            placeHolderOptionsMap[placeholderName] = [input, option];
        }
    }
    option?.scrollIntoView({ block: 'nearest' });
}

function showPlaceholderDialog(profileIndex, rawPlaceholders, startButton) {
    placeHolderOptionsMap = {};
    placeholderModalTabEls = [];
    placeholderModalTabFocusIndex = 0;
    const placeholders = [];
    for (let i = 0; i < 2; i++) {
        if (!rawPlaceholders[i]) break;
        const [name, options = ''] = rawPlaceholders[i].split('=');
        placeholders.push({ name: name, options: options.split(',') });
    }
    placeholders.forEach((p, index) => {
        const group = document.createElement('div');
        group.className = 'combo-box';
        group.id = 'placeholder-input-group-' + p.name;
        const input = document.createElement('input');
        placeholderModalTabEls.push(input);
        placeHolderOptionsMap[p.name] = [input, undefined];
        input.type = 'text';
        input.id = 'placeholder-input-' + p.name;
        input.className = 'placeholder-input';
        input.name = p.name;
        input.value = recentUsedMap.get(profileIndex)?.get(p.name) ?? (p.options?.[0] || '');
        const label = document.createElement('label');
        label.textContent = `${p.name}:`;
        label.setAttribute('for', input.id);
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'options-container';
        optionsContainer.id = 'placeholder-optons-container-' + p.name;
        (p.options || []).forEach((opt) => {
            const option = document.createElement('div');
            option.className = 'option';
            option.textContent = opt;
            option.onclick = debounce((event) => {
                input.value = option.textContent;
                optionsContainer.classList.remove('visible');
                placeHolderOptionsMap[p.name] = [input, undefined];
                if (index === placeholders.length - 1) {
                    submitPlaceholder(profileIndex);
                }
            });
            option.onmouseover = (event) => {
                if (disableMouseEvents) {
                    disableMouseEvents = false;
                    return;
                }
                updateHighlight(input, Array.from(optionsContainer.children), option, null, p.name);
            };
            optionsContainer.appendChild(option);
        });
        group.appendChild(label);
        group.appendChild(input);
        group.appendChild(optionsContainer);
        input.onfocus = (e) => {
            currentInput = e.target;
        };
        input.onclick = (e) => {
            currentInput = e.target;
            placeHolderOptionsMap[p.name] = [input, undefined];
            placeholderModalTabFocusIndex = index;
            repositionAndShowOptions(p.name, optionsContainer, false);
        };
        input.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (index === placeholders.length - 1) {
                    submitPlaceholder(profileIndex);
                } else {
                    repositionAndShowOptions(p.name, optionsContainer, false);
                }
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                disableMouseEvents = true;
                event.preventDefault();
                repositionAndShowOptions(p.name, optionsContainer, true);
                updateHighlight(input, Array.from(optionsContainer.children), undefined, event.key, p.name);
            } else if (event.key === 'Tab') {
                placeHolderOptionsMap[p.name] = [input, undefined];
                optionsContainer.classList.remove('visible');
            }
        };
        input.oninput = (e) => {
            currentInput = e.target;
            placeHolderOptionsMap[p.name][1] = undefined;
            repositionAndShowOptions(p.name, optionsContainer, true);
        };
        const dialogOnClick = (event) => {
            if (event.target !== input) {
                optionsContainer.classList.remove('visible');
                if (placeHolderOptionsMap[p.name]) placeHolderOptionsMap[p.name][1] = undefined;
            }
        };
        placeholderDialogOnClickHandler.push(dialogOnClick);
        placeholderDialogEl.addEventListener('click', dialogOnClick);
        placeholderInputsEl.appendChild(group);
    });

    placeholderDialogEl.style.visibility = 'hidden';
    placeholderDialogEl.style.display = 'block';
    placeholderOverlayEl.classList.add('active');

    const buttonRect = startButton.getBoundingClientRect();
    const dialogRect = placeholderDialogEl.getBoundingClientRect();
    const viewportHeight = document.documentElement.clientHeight;
    const viewportWidth = document.documentElement.clientWidth;

    let top = buttonRect.bottom + 8;
    let left = buttonRect.left;

    if (top + dialogRect.height >= viewportHeight) {
        top = buttonRect.top - dialogRect.height - 8;
    }
    if (left + dialogRect.width >= viewportWidth) {
        left = viewportWidth - dialogRect.width - 20;
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    placeholderDialogEl.style.top = `${top}px`;
    placeholderDialogEl.style.left = `${left}px`;

    placeholderDialogEl.style.visibility = 'visible';
    placeholderInputsEl.querySelector('input')?.focus();

    placeholderModalTabEls.push(placeholderOkBtn);
    placeholderOkBtn.onclick = debounce(() => submitPlaceholder(profileIndex));
    placeholderOkBtn.onkeydown = debounce((event) => {
        if (event.keyCode === 13) {
            submitPlaceholder(profileIndex);
        }
    });
}

function submitPlaceholder(profileIndex) {
    const selectedPlaceholders = {};
    Object.entries(placeHolderOptionsMap).forEach(([placeholder, inputAndOption]) => {
        selectedPlaceholders[placeholder] = inputAndOption[0].value;
        inputAndOption[1]?.parentNode?.classList.remove('visible');
        inputAndOption[1] = undefined;
    });
    recentUsedMap.set(profileIndex, new Map(Object.entries(selectedPlaceholders)));
    window.electronAPI.startProxyProfile(profileIndex, selectedPlaceholders);
    hidePlaceholderDialog();
}

function hidePlaceholderDialog() {
    placeholderOverlayEl.classList.remove('active');
    placeholderDialogEl.style.display = 'none';
    placeholderInputsEl.innerHTML = '';
    while (placeholderDialogOnClickHandler.length > 0) {
        placeholderDialogEl.removeEventListener('click', placeholderDialogOnClickHandler.pop());
    }
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        event.preventDefault();
        // Close More popup / QR popup if open
        if (moreOverlayEl.classList.contains('active')) {
            if (qrPopupEl.style.display === 'flex') {
                hideQRPopup();
                return;
            }
            if (canCloseMoreOverlay()) {
                hideMorePopup();
                hideMoreOverlay();
            }
            return;
        }
        // Close Tools popup if open
        if (toolsOverlayEl.classList.contains('active')) {
            hideToolsPopup();
            return;
        }
        let showList = false;
        Object.values(placeHolderOptionsMap).forEach((inputAndOption) => {
            if (inputAndOption[1]) {
                showList = true;
                inputAndOption[1].classList.remove('selected');
                inputAndOption[1] = undefined;
            }
            if (inputAndOption[0]?.nextElementSibling?.classList.contains('visible')) {
                showList = true;
                inputAndOption[0].nextElementSibling.classList.remove('visible');
            }
        });
        if (!showList) hidePlaceholderDialog();
    } else if (event.key === 'Tab') {
        if (!canCloseMoreOverlay()) {
            event.preventDefault();
            return;
        }
        if (placeholderOverlayEl.classList.contains('active')) {
            event.preventDefault();
            if (event.shiftKey) {
                placeholderModalTabFocusIndex =
                    placeholderModalTabFocusIndex === 0
                        ? placeholderModalTabEls.length - 1
                        : placeholderModalTabFocusIndex - 1;
            } else {
                placeholderModalTabFocusIndex =
                    placeholderModalTabFocusIndex >= placeholderModalTabEls.length - 1
                        ? 0
                        : placeholderModalTabFocusIndex + 1;
            }
            placeholderModalTabEls[placeholderModalTabFocusIndex].focus();
        }
    }
});

placeholderOverlayEl.addEventListener('click', (event) => {
    if (event.target === placeholderOverlayEl) {
        hidePlaceholderDialog();
    }
});

document.getElementById('btnDirectConnect').addEventListener(
    'click',
    debounce(() => {
        window.electronAPI.startProxyProfile(-1);
    })
);

function showMorePopup() {
    moreOverlayEl.classList.add('active');
    morePopupEl.classList.add('active');
}

function hideMorePopup() {
    morePopupEl.classList.remove('active');
}

function hideMoreOverlay() {
    moreOverlayEl.classList.remove('active');
}

function startMoreAction() {
    moreActionInProgress += 1;
}

function endMoreAction() {
    moreActionInProgress = Math.max(0, moreActionInProgress - 1);
}

function canCloseMoreOverlay() {
    return moreActionInProgress === 0;
}

document.getElementById('btnMainMoreOptions').addEventListener(
    'click',
    debounce(() => {
        showMorePopup();
    })
);

// More popup overlay click to close
moreOverlayEl.addEventListener('click', (event) => {
    if (event.target === moreOverlayEl) {
        if (qrPopupEl.style.display === 'flex') {
            hideQRPopup();
            return;
        }
        if (!canCloseMoreOverlay()) return;
        hideMorePopup();
        hideMoreOverlay();
    }
});

// More popup button handlers
document.getElementById('more-import-config').addEventListener(
    'click',
    debounce(async () => {
        hideMorePopup();
        startMoreAction();
        try {
            await window.electronAPI.importConfig();
        } finally {
            endMoreAction();
            hideMoreOverlay();
        }
    })
);

document.getElementById('more-export-config').addEventListener(
    'click',
    debounce(async () => {
        hideMorePopup();
        startMoreAction();
        try {
            await window.electronAPI.exportConfig();
        } finally {
            endMoreAction();
            hideMoreOverlay();
        }
    })
);

document.getElementById('more-open-help').addEventListener(
    'click',
    debounce(async () => {
        hideMorePopup();
        startMoreAction();
        try {
            await window.electronAPI.openHelp();
        } finally {
            endMoreAction();
            hideMoreOverlay();
        }
    })
);

document.getElementById('more-generate-ca').addEventListener(
    'click',
    debounce(async () => {
        hideMorePopup();
        startMoreAction();
        try {
            await window.electronAPI.generateCA();
        } finally {
            endMoreAction();
            hideMoreOverlay();
        }
    })
);

document.getElementById('more-download-ca').addEventListener(
    'click',
    debounce(async () => {
        hideMorePopup();
        startMoreAction();
        try {
            await window.electronAPI.downloadCA();
        } finally {
            endMoreAction();
            hideMoreOverlay();
        }
    })
);

// QR Code popup elements (reuse more-overlay)
const qrPopupEl = document.getElementById('qr-popup');
const qrLinkEl = document.getElementById('qr-link');
const qrCanvasEl = document.getElementById('qr-canvas');

function showQRPopup(link) {
    qrLinkEl.textContent = link;
    generateQR(link, qrCanvasEl, 4);
    hideMorePopup();
    qrPopupEl.style.display = 'flex';
    moreOverlayEl.classList.add('active');
}

function hideQRPopup() {
    qrPopupEl.style.display = 'none';
    hideMoreOverlay();
}

document.getElementById('more-show-ca-link').addEventListener(
    'click',
    debounce(async () => {
        hideMorePopup();
        try {
            const result = await window.electronAPI.getCADownloadLink();
            if (result.success) {
                statusMessageEl.textContent = `Access from your mobile device => ${result.link}`;
                statusMessageEl.style.color = 'green';
                showQRPopup(result.link);
            } else {
                hideMoreOverlay();
                statusMessageEl.textContent = result.error || 'Failed to get CA download link.';
                statusMessageEl.style.color = 'red';
            }
        } catch (e) {
            console.error(e);
            hideMoreOverlay();
            statusMessageEl.textContent = `Failed to get CA download link: ${e.message}`;
            statusMessageEl.style.color = 'red';
        }
    })
);

document.getElementById('more-clear-cache').addEventListener(
    'click',
    debounce(async () => {
        hideMorePopup();
        startMoreAction();
        try {
            await window.electronAPI.clearAppCache();
        } finally {
            endMoreAction();
            hideMoreOverlay();
        }
    })
);

document.getElementById('more-check-update').addEventListener(
    'click',
    debounce(async () => {
        hideMorePopup();
        startMoreAction();
        try {
            await window.electronAPI.checkForUpdate();
        } finally {
            endMoreAction();
            hideMoreOverlay();
        }
    })
);

// Tools popup functions
let systemProxyStatus = null;

async function updateProxyStatus() {
    try {
        const status = await window.electronAPI.getSystemProxyStatus();
        systemProxyStatus = status.isEnabled;
        if (toolsProxyStatusEl) {
            toolsProxyStatusEl.textContent = `Status: ${status.isEnabled ? 'ON' : 'OFF'}`;
        }
        if (toolsToggleProxyBtn) {
            toolsToggleProxyBtn.classList.toggle('on', status.isEnabled);
        }
    } catch (e) {
        systemProxyStatus = null;
        if (toolsProxyStatusEl) {
            toolsProxyStatusEl.textContent = 'Status: Unknown';
        }
    }
}

async function showToolsPopup() {
    toolsOverlayEl.classList.add('active');
    await updateProxyStatus();
}

function hideToolsPopup() {
    toolsOverlayEl.classList.remove('active');
}

// Tools popup overlay click to close
toolsOverlayEl.addEventListener('click', (event) => {
    if (event.target === toolsOverlayEl) {
        hideToolsPopup();
    }
});

// Tools popup button handlers
document.getElementById('tools-url-encode').addEventListener(
    'click',
    debounce(() => {
        hideToolsPopup();
        window.electronAPI.openUrlTool();
    })
);

document.getElementById('tools-toggle-proxy').addEventListener(
    'click',
    debounce(async () => {
        if (systemProxyStatus !== null) {
            await window.electronAPI.toggleSystemProxy(!systemProxyStatus);
            await updateProxyStatus();
        }
    })
);

document.getElementById('btnEditConfig').addEventListener(
    'click',
    debounce(() => {
        window.electronAPI.openConfigEditor();
    })
);

document.getElementById('btnTools').addEventListener(
    'click',
    debounce(() => {
        showToolsPopup();
    })
);

document.getElementById('btnConsole').addEventListener(
    'click',
    debounce(() => {
        window.electronAPI.openConsole();
    })
);

document.getElementById('btnStopProxy').addEventListener(
    'click',
    debounce(() => {
        window.electronAPI.stopProxyServers();
    })
);

window.electronAPI.onConfigUpdated((config, profileColors, status) => {
    currentConfigData = config;
    currentConfigColor = profileColors;
    const history = recentUsedMap.get(status?.keepHistoryFor);
    recentUsedMap.clear();
    if (history !== undefined && history !== null) {
        recentUsedMap.set(status.keepHistoryFor, history);
    }
    renderProfiles();
    updateStatusDisplay({
        appPort: config.appPort,
        ...status
    });
});

window.electronAPI.onProxyStatusUpdate((status) => {
    updateStatusDisplay(status);
});

// Update notification handling
const updateOverlayEl = document.getElementById('update-overlay');
const updateNotificationEl = updateOverlayEl.firstElementChild;
const updateVersionEl = updateOverlayEl.querySelector('#update-version');
const currentVersionEl = updateOverlayEl.querySelector('#current-version');
const updateDownloadBtn = updateOverlayEl.querySelector('#update-download-btn');
const updateSkipBtn = updateOverlayEl.querySelector('#update-skip-btn');
const updateSnoozeBtn = updateOverlayEl.querySelector('#update-snooze-btn');

let currentUpdateInfo = null;

async function showUpdateNotification(updateInfo) {
    currentUpdateInfo = updateInfo;
    updateVersionEl.textContent = updateInfo.version;
    currentVersionEl.textContent = updateInfo.currentVersion;
    const result = await window.electronAPI.copyQuarantineCommand();
    // On macOS, show hint that xattr command will be copied
    if (result.copied && !updateDownloadBtn.querySelector('.update-btn-hint')) {
        const hint = document.createElement('span');
        hint.className = 'update-btn-hint';
        hint.textContent = `"${result.command.slice(0, 25)}..." will be copied`;
        updateDownloadBtn.appendChild(hint);
    }

    updateOverlayEl.classList.add('active');
    updateNotificationEl.classList.add('active');
}

function hideUpdateNotification() {
    updateNotificationEl.classList.remove('active');
    updateOverlayEl.classList.remove('active');
}

updateDownloadBtn.addEventListener('click', async () => {
    if (currentUpdateInfo) {
        window.electronAPI.openDownloadPage(currentUpdateInfo.downloadPageUrl);
        hideUpdateNotification();
    }
});

updateSkipBtn.addEventListener('click', () => {
    if (currentUpdateInfo) {
        window.electronAPI.skipUpdateVersion(currentUpdateInfo.version);
        hideUpdateNotification();
    }
});

updateSnoozeBtn.addEventListener('click', () => {
    window.electronAPI.snoozeUpdate(21);
    hideUpdateNotification();
});

// Clicking on overlay conditionally snoozes for 4 days if remaining snooze <= 4 days
updateOverlayEl.addEventListener('click', (event) => {
    if (event.target === updateOverlayEl) {
        window.electronAPI.conditionalSnoozeUpdate(4);
        hideUpdateNotification();
    }
});

activeProfileNameEl.addEventListener(
    'click',
    debounce(() => {
        if (currentActiveProfileIndex >= 0) {
            window.electronAPI.openProfileViewer();
        }
    })
);

window.electronAPI.onUpdateAvailable(async (updateInfo) => {
    await showUpdateNotification(updateInfo);
});

function init() {
    loadAppVersion();
}

init();
