import Store from 'electron-store';
import { STORE_DEFAULTS } from '../constant/constant';

const store = new Store.default({
    name: 'checkout-proxy-store',
    defaults: STORE_DEFAULTS
});

export function getStore() {
    return store;
}

export function getUpdaterState() {
    return store.get('updaterState') ?? STORE_DEFAULTS.updaterState;
}

export function setUpdaterState(state) {
    store.set('updaterState', state);
}

export function setUpdaterLastChecked(value) {
    store.set('updaterState.lastChecked', value);
}

export function setUpdaterSnoozedUntil(value) {
    store.set('updaterState.snoozedUntil', value);
}

export function clearUpdaterSnoozedUntil() {
    store.set('updaterState.snoozedUntil', null);
}

export function getUrlToolSettings() {
    return store.get('urlTool') ?? STORE_DEFAULTS.urlTool;
}

export function saveUrlToolSettings(settings) {
    const current = store.get('urlTool') ?? STORE_DEFAULTS.urlTool;
    store.set('urlTool', {
        ...current,
        ...settings
    });
}

export function getConsoleSettings() {
    return store.get('requestConsole') ?? STORE_DEFAULTS.requestConsole;
}

export function saveConsoleSettings(settings) {
    const current = store.get('requestConsole') ?? STORE_DEFAULTS.requestConsole;
    store.set('requestConsole', {
        ...current,
        ...settings
    });
}

export function getLastActiveProfile() {
    return store.get('lastActiveProfile') ?? STORE_DEFAULTS.lastActiveProfile;
}

export function saveLastActiveProfile(index, decided) {
    store.set('lastActiveProfile', { index, decided: decided || {} });
}
