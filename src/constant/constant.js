export const RESTART = {NONE: 0, NORMAL: 1, HIBERNATION: 2};
export const MAIN_WINDOW_NAME = 'index';
export const HELP_WINDOW_NAME = 'help';
export const EDITOR_WINDOW_NAME = 'editor';
export const PROFILE_EDITOR_WINDOW_NAME = 'profile-editor';
export const GENERATE_CERT_BUTTON_NAME = "Create and Trust new CA Certificate";
export const CERT_COMMON_NAME = 'www.checkoutproxy.com(self-signed)'
export const CONFIG_OUTDATED_MESSAGE = 'Configuration is outdated. This might cause potential issue. Please use [Edit Config(from main window)]->[Reset Options]->[Reset text area to factory config] to update your configuration.';
export const ASK_TO_RENEW_CA = `Please retry [More]->[${GENERATE_CERT_BUTTON_NAME}].`
export const ASK_TO_RENEW_CA_LONG = `Please retry [More]->[${GENERATE_CERT_BUTTON_NAME}], otherwise browser may block the response.`
export const IGNORED_ERROR_CODE = {'ERR_STREAM_PREMATURE_CLOSE': true, 'ECONNRESET': true};
export const REPO_LINK = 'https://XXXXX/repos/checkout-proxy';
export const DOWNLOAD_LINK = `${REPO_LINK}/browse/dist/latest`;
export const LATEST_JSON_URL = `${REPO_LINK}/raw/dist/latest.json`;
//this token will expire on 2026-12
export const BITBUCKET_TOKEN = 'YYYYY';

