const httpPortEl = document.getElementById('httpPort');
const httpsPortEl = document.getElementById('httpsPort');
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

const STANDARD_SATURATION = 70;
const STANDARD_LIGHTNESS = 45;
let placeHolderOptionsMap = {};
let currentConfigData = null;
let currentActiveProfileIndex = -9;
let currentInput = null;
let debounceTimer;
let placeholderModalTabFocusIndex = 0;
let placeholderModalTabEls = [];
let disableMouseEvents = false;
let communicating = false;
const placeholderDialogOnClickHandler = [];
const recentUsedMap = new Map();

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
    }
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
        const placeholderContainer = node.querySelector('.profile-left-bottom-container')
        const anchorContainer = node.querySelector('.profile-anchor-icon')
        const profileNameContainer = anchorContainer.nextElementSibling;
        const colorArray = anchorContainer.dataset.anchorcolor.split(',').map(v => parseInt(v, 10));
        const lineColorArray = [...colorArray];
        profileNameContainer.classList.remove('bold');
        indicator.classList.remove('on');
        line.classList.remove("on")
        indicator.classList.remove('error');
        if (placeholderContainer) placeholderContainer.outerHTML = '';
        if (indicator.dataset.profile === `${activeProfileIndex}`) {
            lineColorArray[2] += 42;
            profileNameContainer.classList.add('bold');
            indicator.classList.add('on');
            line.classList.add("on")
            if (Object.keys(placeholders || {}).length > 0) {
                const leftBottomContainer = document.createElement('div');
                leftBottomContainer.className = 'profile-left-bottom-container';
                leftBottomContainer.textContent = '=> ' + Object.entries(placeholders).map(([key, value]) => `${key}:${value}`).join(', ')
                node.append(leftBottomContainer)
            }
        }
        anchorContainer.style.setProperty('--icon-color', toColorString(colorArray));
        line.style.setProperty('--line-color', toColorString(lineColorArray));
    });
}

function updateStatusDisplay(status) {
    if (status.httpPort) {
        httpPortEl.textContent = status.httpPort;
    }
    if (status.httpsPort) {
        httpsPortEl.textContent = status.httpsPort;
    }

    currentActiveProfileIndex = status.activeProfileIndex ?? currentActiveProfileIndex;
    renderProfilesStatus(currentActiveProfileIndex, status.toBeDecided);

    if (currentActiveProfileIndex === -1) {
        activeProfileNameEl.textContent = 'Direct Connect';
        activeProfileIndicatorEl.className = 'indicator on';
        activePlaceholderEl.textContent = '';
    } else if (currentActiveProfileIndex >= 0 && currentConfigData?.profile?.[currentActiveProfileIndex]) {
        activeProfileNameEl.textContent = status.profileName ?? currentConfigData.profile[currentActiveProfileIndex].name;
        activeProfileIndicatorEl.className = 'indicator on';
        const placeholderString = Object.entries(status.toBeDecided || {}).map(([key, value]) => `${key}:${value}`).join(', ');
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
        activeProfileIndicatorEl.className = 'indicator error';
    }
    if (statusMessageEl.scrollHeight > 31) {
        statusMessageEl.classList.add('big')
    } else {
        statusMessageEl.classList.remove('big')
    }
    statusMessageEl.style.visibility = true;
}

function hashStringSegment(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
}

function stringToColorArray(str) {
    const segments = str.split(/[\s,|.;:/_-]+/);
    let finalHash = 0;

    const weights = [1.0, 0.5, 0.3, 0.1, 0.05];
    const FALLBACK_WEIGHT = 0.01;

    segments.forEach((segment, index) => {
        const segmentHash = hashStringSegment(segment);
        const weight = weights[index] !== undefined ? weights[index] : FALLBACK_WEIGHT;
        finalHash += segmentHash * weight;
    });

    const hue = Math.abs(Math.round(finalHash) % 360);
    return [hue, STANDARD_SATURATION, STANDARD_LIGHTNESS]
}

function toColorString(obj) {
    return `hsl(${obj[0]}, ${obj[1]}%, ${obj[2]}%)`;
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
        const colorObj = stringToColorArray(nameEl.textContent);
        anchorEl.style.setProperty('--icon-color', toColorString(colorObj));
        anchorEl.dataset.anchorcolor = colorObj.join(',');

        const editEl = document.createElement('span');
        editEl.className = 'profile-edit-icon';
        editEl.addEventListener('click', debounce((event) => {
            event.preventDefault();
            window.electronAPI.editProxyProfile(index);
        }));
        profileLeftTopContainer.append(anchorEl, nameEl, editEl);
        profileLeftContainer.append(profileLeftTopContainer)

        const rightContainer = document.createElement('div');
        rightContainer.className = 'profile-right-container';
        const rightTopContainer = document.createElement('div');
        rightTopContainer.className = 'profile-right-top-container';

        const actionsEl = document.createElement('div');
        actionsEl.className = 'profile-actions';

        const startButton = document.createElement('button');
        startButton.textContent = 'Start';
        startButton.addEventListener('click', debounce((event) => {
            event.preventDefault();
            if (profile.toBeDecided?.length > 0) {
                showPlaceholderDialog(index, profile.toBeDecided, startButton);
            } else {
                window.electronAPI.startProxyProfile(index);
            }
        }));

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
        rightTopContainer.append(actionsEl, indicatorContainer)
        rightContainer.append(rightTopContainer)

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
        optionsContainer.style.maxWidth = (inputRect.width - 30) + 'px';

        if (spaceBelow >= preferredHeight || spaceBelow > spaceAbove) {
            optionsContainer.style.top = `${inputRect.bottom + margin}px`;
            if (spaceBelow < preferredHeight) {
                optionsContainer.style.maxHeight = `${spaceBelow - (margin * 2)}px`;
            }
        } else {
            optionsContainer.style.bottom = `${viewportHeight - inputRect.top + margin}px`;
            if (spaceAbove < preferredHeight) {
                optionsContainer.style.maxHeight = `${spaceAbove - (margin * 2)}px`;
            }
        }
        optionsContainer.style.left = `${inputRect.left}px`;
        optionsContainer.style.width = `${inputRect.width}px`;
    }
    optionsContainer.classList.add('visible');
}

function updateHighlight(input, allOptions, selectedOption, keyboard, placeholderName) {
    allOptions.forEach(option => option.classList.remove('selected'));
    let option = selectedOption || placeHolderOptionsMap[placeholderName]?.[1];
    if (!option) {
        option = keyboard === 'ArrowUp' ? allOptions[allOptions.length - 1] : allOptions[0];
        option.classList.add('selected');
        placeHolderOptionsMap[placeholderName] = [input, option]
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
    option?.scrollIntoView({block: 'nearest'});
}

function showPlaceholderDialog(profileIndex, rawPlaceholders, startButton) {
    placeHolderOptionsMap = {}
    placeholderModalTabEls = []
    placeholderModalTabFocusIndex = 0;
    const placeholders = [];
    for (let i = 0; i < 2; i++) {
        if (!rawPlaceholders[i]) break;
        const [name, options = ''] = rawPlaceholders[i].split('=');
        placeholders.push({name: name, options: options.split(',')});
    }
    placeholders.forEach((p, index) => {
        const group = document.createElement('div');
        group.className = 'combo-box'
        group.id = "placeholder-input-group-" + p.name;
        const input = document.createElement('input');
        placeholderModalTabEls.push(input);
        placeHolderOptionsMap[p.name] = [input, undefined];
        input.type = 'text'
        input.id = "placeholder-input-" + p.name;
        input.className = "placeholder-input";
        input.name = p.name;
        input.value = recentUsedMap.get(profileIndex)?.get(p.name) ?? (p.options?.[0] || '');
        const label = document.createElement('label');
        label.textContent = `${p.name}:`;
        label.setAttribute('for', input.id);
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'options-container'
        optionsContainer.id = "placeholder-optons-container-" + p.name;
        (p.options || []).forEach(opt => {
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
            })
            option.onmouseover = (event) => {
                if (disableMouseEvents) {
                    disableMouseEvents = false;
                    return
                }
                updateHighlight(input, Array.from(optionsContainer.children), option, null, p.name);
            }
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
        }
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
        }
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

    placeholderDialogEl.style.visibility = 'visible'
    placeholderInputsEl.querySelector('input')?.focus();

    placeholderModalTabEls.push(placeholderOkBtn);
    placeholderOkBtn.onclick = debounce(() => submitPlaceholder(profileIndex));
    placeholderOkBtn.onkeydown = debounce((event) => {
        if (event.keyCode === 13) {
            submitPlaceholder(profileIndex);
        }
    })
}

function submitPlaceholder(profileIndex) {
    const selectedPlaceholders = {};
    Object.entries(placeHolderOptionsMap).forEach(([placeholder, inputAndOption]) => {
        selectedPlaceholders[placeholder] = inputAndOption[0].value;
        inputAndOption[1]?.parentNode?.classList.remove('visible');
        inputAndOption[1] = undefined;
    })
    recentUsedMap.set(profileIndex, new Map(Object.entries(selectedPlaceholders)));
    window.electronAPI.startProxyProfile(profileIndex, selectedPlaceholders);
    hidePlaceholderDialog();
}

function hidePlaceholderDialog() {
    placeholderOverlayEl.classList.remove("active");
    placeholderDialogEl.style.display = 'none';
    placeholderInputsEl.innerHTML = '';
    while (placeholderDialogOnClickHandler.length > 0) {
        placeholderDialogEl.removeEventListener('click', placeholderDialogOnClickHandler.pop());
    }
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        event.preventDefault();
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
        })
        if (!showList) hidePlaceholderDialog();
    } else if (event.key === 'Tab') {
        if (placeholderOverlayEl.classList.contains("active")) {
            event.preventDefault();
            if (event.shiftKey) {
                placeholderModalTabFocusIndex = placeholderModalTabFocusIndex === 0 ? placeholderModalTabEls.length - 1 : placeholderModalTabFocusIndex - 1;
            } else {
                placeholderModalTabFocusIndex = placeholderModalTabFocusIndex >= placeholderModalTabEls.length - 1 ? 0 : placeholderModalTabFocusIndex + 1;
            }
            placeholderModalTabEls[placeholderModalTabFocusIndex].focus();
        }
    }
});

placeholderOverlayEl.addEventListener('click', (event) => {
    if (!communicating && event.target === placeholderOverlayEl) {
        hidePlaceholderDialog();
    }
});

document.getElementById('btnDirectConnect').addEventListener('click', debounce(() => {
    window.electronAPI.startProxyProfile(-1);
}));

document.getElementById('btnMainMoreOptions').addEventListener('click', debounce(async () => {
    communicating = true;
    placeholderOverlayEl.classList.add("active")
    await window.electronAPI.openMainMoreOptions();
    communicating = false;
    placeholderOverlayEl.classList.remove("active")
}));

document.getElementById('btnEditConfig').addEventListener('click', debounce(() => {
    window.electronAPI.openConfigEditor();
}));

document.getElementById('btnImportConfig').addEventListener('click', debounce(() => {
    window.electronAPI.importConfig();
}));

document.getElementById('btnExportConfig').addEventListener('click', debounce(() => {
    window.electronAPI.exportConfig();
}));

document.getElementById('btnStopProxy').addEventListener('click', debounce(() => {
    window.electronAPI.stopProxyServers();
}));

window.electronAPI.onConfigUpdated((config, status) => {
    currentConfigData = config;
    recentUsedMap.clear()
    renderProfiles();
    updateStatusDisplay({
        httpPort: config.appPort?.[0],
        httpsPort: config.appPort?.[1],
        ...status
    });
});

window.electronAPI.onProxyStatusUpdate((status) => {
    updateStatusDisplay(status);
});

function init() {
    loadAppVersion();
}

init();
