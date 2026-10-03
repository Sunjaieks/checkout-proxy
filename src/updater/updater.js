import { app } from 'electron';
import { logError, logInfo } from '../util/nodeUtil.js';
import os from 'node:os';
import { BITBUCKET_TOKEN, DOWNLOAD_LINK, LATEST_JSON_URL } from '../constant/constant.js';
import {
    clearUpdaterSnoozedUntil,
    getUpdaterState,
    setUpdaterLastChecked,
    setUpdaterSnoozedUntil,
    setUpdaterState
} from '../store/app-store.js';

/**
 * Compare semantic versions
 * @param {string} v1 - version 1 (e.g., "1.4.8")
 * @param {string} v2 - version 2 (e.g., "1.5.0")
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;

        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }

    return 0;
}

/**
 * Get the appropriate filename for the current platform and architecture
 * @param {string} version - version string
 * @returns {string|null} filename or null if platform not supported
 */
function getFilenameForPlatform(version) {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'darwin') {
        if (arch === 'arm64') {
            return `CheckoutProxy-${version}-arm64.dmg`;
        } else if (arch === 'x64') {
            return `CheckoutProxy-${version}-x64.dmg`;
        }
    } else if (platform === 'win32' && arch === 'x64') {
        return `CheckoutProxy-${version}-x64.exe`;
    }

    return null;
}

/**
 * Fetch latest.json from the repository
 * @returns {Promise<Object>} latest.json content
 */
async function fetchLatestJson() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(LATEST_JSON_URL, {
            headers: {
                Authorization: `Bearer ${BITBUCKET_TOKEN}`
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`Failed to fetch latest.json: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        logInfo('Fetched latest.json:', data);
        return data;
    } catch (error) {
        logError('Error fetching latest.json:', error);
        throw error;
    }
}

/**
 * Check if an update is available
 * @returns {Promise<Object|null>} Update info or null if no update available
 */
export async function checkForUpdates(ignoreSnooze = false) {
    const currentVersion = app.getVersion();
    logInfo('Current version:', currentVersion);

    const updaterState = getUpdaterState();

    // Check if snoozed
    if (!ignoreSnooze && updaterState.snoozedUntil) {
        const snoozedUntil = new Date(updaterState.snoozedUntil);
        if (new Date() < snoozedUntil) {
            logInfo('Update check snoozed until:', snoozedUntil);
            return null;
        } else {
            // Snooze expired, clear it
            clearUpdaterSnoozedUntil();
        }
    }

    const latestData = await fetchLatestJson();
    const latestVersion = latestData.version;

    // Update last checked timestamp
    setUpdaterLastChecked(new Date().toISOString());

    // Compare versions
    const comparison = compareVersions(latestVersion, currentVersion);

    if (comparison <= 0) {
        logInfo('No update available. Latest version:', latestVersion);
        return null;
    }

    // Check if this version is skipped
    if (updaterState.skippedVersions && updaterState.skippedVersions.includes(latestVersion)) {
        logInfo('Update available but skipped by user:', latestVersion);
        return null;
    }

    // Check if the file for this platform exists
    const expectedFilename = getFilenameForPlatform(latestVersion);
    if (!expectedFilename) {
        logInfo('Platform not supported for auto-update');
        return null;
    }

    if (!latestData.files.includes(expectedFilename)) {
        logInfo('Update file not found for this platform:', expectedFilename);
        return null;
    }

    logInfo('Update available:', latestVersion);
    return {
        version: latestVersion,
        currentVersion,
        filename: expectedFilename,
        buildDate: latestData.buildDate,
        downloadPageUrl: DOWNLOAD_LINK
    };
}

/**
 * Skip a specific version
 * @param {string} version - version to skip
 */
export function skipVersion(version) {
    const updaterState = getUpdaterState();
    if (!updaterState.skippedVersions) {
        updaterState.skippedVersions = [];
    }

    if (!updaterState.skippedVersions.includes(version)) {
        updaterState.skippedVersions.push(version);
        setUpdaterState(updaterState);
        logInfo('Version skipped:', version);
    }
}

/**
 * Snooze update notifications for a specified number of days
 * @param {number} days - number of days to snooze
 */
export function snoozeUpdates(days = 4) {
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);
    setUpdaterSnoozedUntil(snoozedUntil.toISOString());
    logInfo('Updates snoozed until:', snoozedUntil);
}

/**
 * Get remaining snooze days
 * @returns {number} remaining days, 0 if not snoozed or expired
 */
export function getRemainingSnoozedays() {
    const updaterState = getUpdaterState();
    if (!updaterState.snoozedUntil) {
        return 0;
    }

    const snoozedUntil = new Date(updaterState.snoozedUntil);
    const now = new Date();

    if (now >= snoozedUntil) {
        return 0;
    }

    const diffTime = snoozedUntil - now;
    return Math.ceil(diffTime / (1000 * 3600 * 24));
}

/**
 * Conditionally snooze - only snooze if remaining days is less than the specified days
 * @param {number} days - number of days to snooze
 */
export function conditionalSnooze(days) {
    const remainingDays = getRemainingSnoozedays();

    if (remainingDays > days) {
        logInfo(`Snooze not updated: ${remainingDays} days remaining (more than ${days} days)`);
        return;
    }
    logInfo('User conditionally snoozed updates for', days, 'days');
    snoozeUpdates(days);
}

/**
 * Get the download page URL
 * @returns {string} download page URL
 */
export function getDownloadPageUrl() {
    return DOWNLOAD_LINK;
}
