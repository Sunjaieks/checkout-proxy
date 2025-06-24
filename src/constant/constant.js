export const RESTART = { NONE: 0, NORMAL: 1, HIBERNATION: 2 };
export const MAIN_WINDOW_NAME = 'index';
export const HELP_WINDOW_NAME = 'help';
export const EDITOR_WINDOW_NAME = 'editor';
export const PROFILE_EDITOR_WINDOW_NAME = 'profile-editor';
export const PROFILE_VIEWER_WINDOW_NAME = 'profile-viewer';
export const TOOLS_WINDOW_NAME = 'url-tool';
export const CONSOLE_WINDOW_NAME = 'console';
export const GENERATE_CERT_BUTTON_NAME = 'Create and Trust new CA';
export const CONFIG_OUTDATED_MESSAGE =
    'Configuration is outdated. This might cause potential issue. Please use [Edit Config(from main window)]->[Reset Options]->[Reset text area to factory config] to update your configuration.';
export const ASK_TO_RENEW_CA = `Please retry [More]->[${GENERATE_CERT_BUTTON_NAME}].`;
export const ASK_TO_RENEW_CA_LONG = `Please retry [More]->[${GENERATE_CERT_BUTTON_NAME}], otherwise browser may block the response.`;
export const IGNORED_ERROR_CODE = { ERR_STREAM_PREMATURE_CLOSE: true, ECONNRESET: true };
export const REPO_LINK = 'https://XXXXX/repos/checkout-proxy';
export const DOWNLOAD_LINK = `${REPO_LINK}/browse/dist/latest`;
export const LATEST_JSON_URL = `${REPO_LINK}/raw/dist/latest.json`;
//this token will expire on 2027-05
export const BITBUCKET_TOKEN = '';
export const CONSOLE_ROW_SIZE = 1000;
export const HEADER_CHECKOUT_PROXY_USE_AGENT = 'checkout-proxy-use-agent';
export const DEFAULT_GRACEFUL_TIMEOUT_MS = 100;
export const MAX_HEADER_SIZE = 32 * 1024;
export const STANDARD_SATURATION = 70;
export const USE_NO_AGENT = ['none', 'reversed', null, undefined];
export const STANDARD_LIGHTNESS = 45;
export const ROOT_CA_NAME = 'rootCA.crt';
export const ROOT_KEY_NAME = 'rootCA.key';
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const STORE_DEFAULTS = {
    updaterState: {
        skippedVersions: [],
        snoozedUntil: null,
        lastChecked: null
    },
    urlTool: {
        mode: 'encode',
        encoding: 'utf-8',
        spaceAsPlus: false,
        componentOnly: true
    },
    lastActiveProfile: {
        index: -9,
        decided: {}
    },
    requestConsole: {
        visibleColumns: ['timestamp', 'method', 'host', 'path', 'proxyUrl', 'code'],
        columnWidths: {
            timestamp: 200,
            path: 220,
            method: 84,
            code: 70,
            host: 220,
            proxyUrl: 300,
            protocol: 'auto', // minimum to show column name
            reqHeaders: 200,
            resHeaders: 200,
            resTrailer: 150,
            port: 60
        },
        columnOrder: [
            'timestamp',
            'method',
            'host',
            'path',
            'proxyUrl',
            'code',
            'protocol',
            'port',
            'reqHeaders',
            'resHeaders',
            'resTrailer'
        ],
        wrapColumns: [],
        wrapAll: false,
        autoScroll: true,
        lastFilter: '',
        filterHistory: []
    }
};
