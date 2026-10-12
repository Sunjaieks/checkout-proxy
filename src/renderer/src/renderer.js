import { toColorString } from '../../util/sharedUtil';
import { generateQR } from './module/qr-code';
import { AI_DESKTOP_HELP_HTML } from '../../constant/constant';

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
const placeholderOptionsHostEl = document.getElementById('placeholder-options-host');
const directConnectBtn = document.getElementById('btnDirectConnect');

// More popup elements
const moreOverlayEl = document.getElementById('more-overlay');
const morePopupEl = document.getElementById('more-popup');

// Tools popup elements
const toolsOverlayEl = document.getElementById('tools-overlay');
const toolsPopupEl = document.getElementById('tools-popup');
const toolsProxyStatusEl = document.getElementById('tools-proxy-status');
const toolsToggleProxyBtn = document.getElementById('tools-toggle-proxy');

// AI Desktop failure popup elements (reuses the same .overlay as the Tools popup)
const aiHelpOverlayEl = document.getElementById('ai-help-overlay');
const aiHelpBodyEl = document.getElementById('ai-help-body');
const aiHelpDetailsEl = document.getElementById('ai-help-details');
const aiHelpDetailTextEl = document.getElementById('ai-help-detail-text');
// Render the shared help content (same as [Global Settings] -> [AI]) once.
aiHelpBodyEl.innerHTML = AI_DESKTOP_HELP_HTML;

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

// A press that travels more than a few pixels before release is a text-selection
// drag (e.g. highlighting a profile name to copy it), not a click on the row.
const DRAG_THRESHOLD_PX = 4;
let pressStartPoint = null;

document.addEventListener(
    'mousedown',
    (event) => {
        pressStartPoint = { x: event.clientX, y: event.clientY };
    },
    true
);

function isDragRelease(event) {
    // detail === 0 means the click was not produced by a pointer (keyboard, synthetic).
    if (!pressStartPoint || event.detail === 0) return false;
    return (
        Math.abs(event.clientX - pressStartPoint.x) > DRAG_THRESHOLD_PX ||
        Math.abs(event.clientY - pressStartPoint.y) > DRAG_THRESHOLD_PX
    );
}

// Lightweight "copied" toast, mirroring ConfigForm's toast in config-form.js.
let copiedToastEl = null;
let copiedToastTimer = null;
function showCopiedToast(text) {
    if (!copiedToastEl) {
        copiedToastEl = document.createElement('div');
        copiedToastEl.className = 'config-form-copied-toast';
        document.body.appendChild(copiedToastEl);
    }
    copiedToastEl.textContent = text;
    // Anchor the toast to the top-center of the profiles area (not the whole window).
    const rect = profilesAreaEl.getBoundingClientRect();
    copiedToastEl.style.top = `${rect.top + 8}px`;
    copiedToastEl.style.left = `${rect.left + rect.width / 2}px`;
    copiedToastEl.classList.add('visible');
    clearTimeout(copiedToastTimer);
    copiedToastTimer = setTimeout(() => copiedToastEl.classList.remove('visible'), 1000);
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
        statusMessageEl.innerHTML = status.message;
        statusMessageEl.style.color = 'green';
    }
    if (status.warning) {
        statusMessageEl.innerHTML = status.warning;
        statusMessageEl.style.color = 'brown';
    }
    if (status.error) {
        statusMessageEl.innerHTML = status.error;
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
        if (profile.decorator) {
            const decoratorEl = document.createElement('span');
            decoratorEl.className = 'profile-decorator';
            decoratorEl.textContent = profile.decorator;
            nameEl.appendChild(decoratorEl);
        }

        const anchorEl = document.createElement('span');
        anchorEl.className = 'profile-anchor-icon';
        anchorEl.classList.add(profile.toBeDecided?.length > 0 ? 'anchors' : 'anchor');
        const colorObj = currentConfigColor[index];
        anchorEl.style.setProperty('--icon-color', toColorString(colorObj));
        anchorEl.dataset.anchorcolor = colorObj.join(',');
        anchorEl.title = 'Click to copy profile name';
        anchorEl.addEventListener(
            'click',
            debounce((event) => {
                event.preventDefault();
                const nameToCopy = profile.name || `Profile ${index}`;
                window.electronAPI.copyToClipboard(nameToCopy);
                showCopiedToast(`"${nameToCopy}" copied`);
            })
        );

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

        const onProfileClick = debounce((event) => {
            if (event.target.closest('.profile-edit-icon') || event.target.closest('.profile-anchor-icon')) return;
            if (profile.toBeDecided?.length > 0) {
                showPlaceholderDialog(index, profile.toBeDecided, item, event.clientX);
            } else {
                window.electronAPI.startProxyProfile(index);
            }
        });
        item.addEventListener('click', (event) => {
            // Checked outside the debounce so a discarded drag does not consume the
            // debounce window of the click that follows it.
            if (isDragRelease(event)) return;
            onProfileClick(event);
        });

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
        const preferredHeight = Math.min(300, optionsContainer.childElementCount * 25);
        const margin = 4;

        const spaceBelow = viewportHeight - inputRect.bottom;
        const spaceAbove = inputRect.top;
        const needed = preferredHeight + margin * 2;

        optionsContainer.style.bottom = '';
        optionsContainer.style.top = '';
        optionsContainer.style.maxWidth = inputRect.width - 30 + 'px';

        const showBelow = spaceBelow >= needed || (spaceBelow >= spaceAbove && spaceAbove < needed);

        if (showBelow) {
            optionsContainer.style.top = `${inputRect.bottom + margin}px`;
        } else {
            optionsContainer.style.bottom = `${viewportHeight - inputRect.top + margin}px`;
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

function showPlaceholderDialog(profileIndex, rawPlaceholders, rowEl, clickX) {
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
        // The options dropdown is position:fixed and must escape the dialog's
        // backdrop-filter, which would otherwise become its containing block and
        // throw off its coordinates. The host lives directly under <body>.
        placeholderOptionsHostEl.appendChild(optionsContainer);
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

    const buttonRect = rowEl.getBoundingClientRect();
    const dialogRect = placeholderDialogEl.getBoundingClientRect();
    const viewportHeight = document.documentElement.clientHeight;
    const viewportWidth = document.documentElement.clientWidth;

    let top = buttonRect.bottom + 8;
    let left = typeof clickX === 'number' ? clickX - 20 : buttonRect.left;

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
    placeholderOptionsHostEl.innerHTML = '';
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
        // Close AI Desktop help popup if open
        if (aiHelpOverlayEl.classList.contains('active')) {
            hideAiHelpPopup();
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
        });
        // Escape closes any open dropdown first, and only then the dialog itself.
        placeholderOptionsHostEl.querySelectorAll('.options-container.visible').forEach((container) => {
            showList = true;
            container.classList.remove('visible');
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

async function launchAiDesktop() {
    const result = await window.electronAPI.openAiDesktop();
    if (result && result.success === false) {
        showAiHelpPopup(result.error);
    }
}

document.getElementById('tools-ai-desktop').addEventListener(
    'click',
    debounce(() => {
        hideToolsPopup();
        launchAiDesktop();
    })
);

document.getElementById('btnAiDesktop').addEventListener('click', debounce(launchAiDesktop));

// AI Desktop failure popup: same overlay/style as the Tools popup. Shows the shared
// help content plus the captured launch error under a collapsible.
function showAiHelpPopup(detail) {
    const detail0 = (detail || '').trim();
    if (detail0) {
        aiHelpDetailTextEl.textContent = detail0;
        aiHelpDetailsEl.style.display = '';
    } else {
        aiHelpDetailsEl.style.display = 'none';
    }
    aiHelpOverlayEl.classList.add('active');
}

function hideAiHelpPopup() {
    aiHelpOverlayEl.classList.remove('active');
}

// Open help links (e.g. the Node.js download link) in the system browser.
aiHelpBodyEl.addEventListener('click', (event) => {
    const extLink = event.target.closest('.ai-help-ext-link');
    if (extLink) {
        event.preventDefault();
        window.electronAPI.openExternalLink(extLink.getAttribute('href'));
    }
});

document.getElementById('ai-help-close-btn').addEventListener('click', hideAiHelpPopup);

aiHelpOverlayEl.addEventListener('click', (event) => {
    if (event.target === aiHelpOverlayEl) {
        hideAiHelpPopup();
    }
});

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

function reconcileUiWithProxyStatus(status) {
    if (!status || !Number.isInteger(status.activeProfileIndex)) return;
    if (placeholderOverlayEl.classList.contains('active')) {
        hidePlaceholderDialog();
        placeHolderOptionsMap = {};
    }
}

window.electronAPI.onProxyStatusUpdate((status) => {
    reconcileUiWithProxyStatus(status);
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
