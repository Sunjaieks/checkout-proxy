const httpPortEl = document.getElementById('httpPort');
const httpsPortEl = document.getElementById('httpsPort');
const activeProfileNameEl = document.getElementById('activeProfileName');
const activeProfileIndicatorEl = document.getElementById('activeProfileIndicator');
const statusMessageEl = document.getElementById('statusMessage');
const profilesListEl = document.getElementById('profilesList');
const appVersionDisplayEl = document.getElementById('app-version-display');

let currentConfigData = null;
let currentActiveProfileIndex = -9;

let debounceTimer;

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
        console.error('Failed to load app version:', error);
        if (appVersionDisplayEl) {
            appVersionDisplayEl.textContent = 'Version: N/A';
        }
    }
}

function renderProfilesStatus() {
    document.getElementById('btnDirectConnect').classList[currentActiveProfileIndex === -1 ? 'add' : 'remove']('on');
    const allIndicator = profilesListEl.querySelectorAll('.profile-indicator-container .indicator');
    allIndicator?.forEach((node, index) => {
        node.classList.remove('on');
        node.classList.remove('error');
        if (node.dataset.profile === `${currentActiveProfileIndex}`) {
            node.classList.add('on');
        }
    });
}

function updateStatusDisplay(status) {
    if (status.httpPort) {
        httpPortEl.textContent = status.httpPort;
    }
    if (status.httpsPort) {
        httpsPortEl.textContent = status.httpsPort;
    }

    if (!(status.activeProfileIndex == null)) {
        currentActiveProfileIndex = status.activeProfileIndex;
        renderProfilesStatus();
    }

    if (currentActiveProfileIndex === -1) {
        activeProfileNameEl.textContent = 'Direct Connect';
        activeProfileIndicatorEl.className = 'indicator on';
    } else if (currentActiveProfileIndex >= 0 && currentConfigData?.profile?.[currentActiveProfileIndex]) {
        activeProfileNameEl.textContent = currentConfigData.profile[currentActiveProfileIndex].name;
        activeProfileIndicatorEl.className = 'indicator on';
    } else {
        activeProfileNameEl.textContent = 'None';
        activeProfileIndicatorEl.className = 'indicator';
    }

    if (status.message) {
        statusMessageEl.textContent = status.message;
        statusMessageEl.style.color = 'green';
    }
    if (status.error) {
        statusMessageEl.textContent = status.error;
        statusMessageEl.style.color = 'red';
        // If error, ensure main indicator is off or error state
        activeProfileIndicatorEl.className = 'indicator error';
    }
}


function renderProfiles() {
    if (!currentConfigData || !currentConfigData.profile) {
        profilesListEl.innerHTML = '<p>No profiles configured.</p>';
        return;
    }

    profilesListEl.innerHTML = ''; // Clear existing
    if (currentConfigData.profile.length === 0) {
        profilesListEl.innerHTML = '<p>No profiles configured. Click "Edit Config" to add some.</p>';
        return;
    }

    currentConfigData.profile.forEach((profile, index) => {
        const item = document.createElement('div');
        item.className = 'profile-item';

        const nameEl = document.createElement('span');
        nameEl.className = 'profile-name';
        nameEl.textContent = profile.name || `Profile ${index + 1}`;

        const actionsEl = document.createElement('div');
        actionsEl.className = 'profile-actions';

        const startButton = document.createElement('button');
        startButton.textContent = 'Start';
        startButton.addEventListener('click', debounce((event) => {
            event.preventDefault();
            window.electronAPI.startProxyProfile(index);
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

        item.appendChild(nameEl);
        item.appendChild(actionsEl);
        item.appendChild(indicatorContainer);
        profilesListEl.appendChild(item);
    });
}

document.getElementById('btnDirectConnect').addEventListener('click', debounce(() => {
    window.electronAPI.startProxyProfile(-1);
}));

document.getElementById('btnInstructions').addEventListener('click', debounce(() => {
    window.electronAPI.openInstructions();
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


window.electronAPI.onConfigUpdated((config, activeProfile) => {
    currentConfigData = config;
    updateStatusDisplay({
        activeProfileIndex: activeProfile,
        httpPort: config.appPort?.[0],
        httpsPort: config.appPort?.[1]
    });
    renderProfiles();
});

window.electronAPI.onProxyStatusUpdate((status) => {
    updateStatusDisplay(status);
});

function init() {
    loadAppVersion();
}

init();
