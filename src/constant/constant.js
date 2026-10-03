export const RESTART = { NONE: 0, NORMAL: 1, HIBERNATION: 2 };
export const MAIN_WINDOW_NAME = 'index';
export const HELP_WINDOW_NAME = 'help';
export const EDITOR_WINDOW_NAME = 'editor';
export const PROFILE_EDITOR_WINDOW_NAME = 'profile-editor';
export const PROFILE_VIEWER_WINDOW_NAME = 'profile-viewer';
export const TOOLS_WINDOW_NAME = 'url-tool';
export const CONSOLE_WINDOW_NAME = 'console';
export const AI_DESKTOP_WINDOW_NAME = 'ai-desktop';
export const GENERATE_CERT_BUTTON_NAME = 'Create and Trust new CA';
export const APPLY_DEFAULT_AI_DESKTOP = 'AI Desktop command/port is not configured; applied defaults automatically.';
export const CONFIG_OUTDATED_MESSAGE =
    'Configuration is outdated. This might cause potential issue. Please use [Edit Config(from main window)]->[Reset Options]->[Reset text area to factory config] to update your configuration.';
export const ASK_TO_RENEW_CA = `Please retry [More]->[${GENERATE_CERT_BUTTON_NAME}].`;
export const ASK_TO_RENEW_CA_LONG = `Please retry [More]->[${GENERATE_CERT_BUTTON_NAME}], otherwise browser may block the response.`;
export const IGNORED_ERROR_CODE = { ERR_STREAM_PREMATURE_CLOSE: true, ECONNRESET: true };
export const REPO_LINK = '';
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
// MCP (Model Context Protocol) server defaults. The MCP server lets AI clients
// control proxy profiles (start/stop/direct-connect/inspect) over local HTTP.
// It always binds to loopback for safety; only `enabled` and `port` are configurable.
export const MCP_DEFAULT_HOST = '127.0.0.1';
export const MCP_DEFAULT_PORT = 18888;
export const MCP_ENDPOINT_PATH = '/mcp';
export const MCP_SERVER_NAME = 'checkout-proxy-mcp';

// AI Desktop (cloudcli) defaults. The AI Desktop tool launches a local AI GUI server via
// `guiCommand` — a full command that may carry an inline env prefix, e.g.
// `SERVER_PORT=18887 cloudcli`. `guiPort` is the plain port that command serves on; the AI
// Desktop window loads `http://localhost:<guiPort>`. Requires Node.js + `@cloudcli-ai/cloudcli`.
export const AI_GUI_DEFAULT_COMMAND = 'SERVER_PORT=18887 cloudcli';
export const AI_GUI_DEFAULT_PORT = 18887;

// Official Node.js download page. Referenced by the AI Desktop help/error content.
export const NODEJS_DOWNLOAD_LINK = 'https://nodejs.org/en/download';

export const PUBLIC_INSTALLER_PATH = 'https://raw.githubusercontent.com/Sunjaieks/installer/refs/heads/main/cloud-cli';
export const CLOUDCLI_INSTALL_SCRIPT_MAC_URL = `${PUBLIC_INSTALLER_PATH}/mac-install.sh`;
export const CLOUDCLI_INSTALL_SCRIPT_WINDOWS_URL = `${PUBLIC_INSTALLER_PATH}/windows-install.ps1`;

// One-line install commands shown (and copied) in the AI Desktop help content below.
const CLOUDCLI_INSTALL_CMD_MAC = `curl -fsSL ${CLOUDCLI_INSTALL_SCRIPT_MAC_URL} | bash`;
const CLOUDCLI_INSTALL_CMD_WINDOWS = `$env:CLOUDCLI_INSECURE='1'; iex (curl.exe -k -fsSL ${CLOUDCLI_INSTALL_SCRIPT_WINDOWS_URL} | Out-String)`;

// Encode a command as a JS string literal safe to embed inside a double-quoted HTML
// `onclick="..."` attribute below. JSON.stringify quotes/escapes it as a JS literal (needed
// because the Windows command's `='1'` would otherwise close the onclick's own single-quoted
// argument early); escaping `&`/`"` afterwards stops that literal from closing the
// double-quoted HTML attribute itself.
const toOnclickArg = (command) => JSON.stringify(command).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Shared AI Desktop help HTML. Rendered both inside [Global Settings] -> [AI] help and in
// the custom "AI Desktop unavailable" overlay popup, so keep it self-contained. External
// links carry class `ai-help-ext-link` so the host renderer opens them in the system browser.
// The copy icons use an inline `onclick` (self-contained: copies via `navigator.clipboard`
// and briefly flashes a background as feedback) so this HTML works standalone in either host
// window without extra JS wiring; requires 'unsafe-inline' in those windows' script-src CSP.
export const AI_DESKTOP_HELP_HTML = `
                <style>
                    .ai-help-copy-icon {
                        cursor: pointer;
                        color: #8a95a2;
                        font-size: 1.1em;
                        padding: 0 2px;
                        border-radius: 4px;
                        user-select: none;
                    }
                    .ai-help-copy-icon:hover {
                        color: #3498db;
                        background: rgba(52, 152, 219, 0.15);
                    }
                    .ai-help-copy-icon.ai-help-copy-flash {
                        color: #3498db;
                        background: rgba(52, 152, 219, 0.4);
                    }
                </style>
                <p><b style="font-size: 1.2em">AI Desktop</b> 🖥️ Open a local AI workspace from <b>Tools → AI Desktop</b>. It requires Node.js and <code>@cloudcli-ai/cloudcli</code> to be installed.</p>

                <p><b>Setup</b> ⚙️</p>
                <ul>
                    <li>
                        <p>Copy and run following command — it installs Node.js (if missing) and <code>@cloudcli-ai/cloudcli</code> for you:<p>
                        <p>⚠️You need to rerun it if you update the major version of Node.js<p>
                        <ul>
                            <li>🍎 <b>macOS</b> (Terminal): <span class="ai-help-copy-icon" title="Copy to clipboard" onclick="navigator.clipboard.writeText(${toOnclickArg(CLOUDCLI_INSTALL_CMD_MAC)});this.classList.add('ai-help-copy-flash');setTimeout(()=>this.classList.remove('ai-help-copy-flash'),500)">⧉</span>
                                <pre class="config-form-help-pre"><code>${CLOUDCLI_INSTALL_CMD_MAC}</code></pre>
                            </li>
                            <li>🪟 <b>Windows</b> (PowerShell): <span class="ai-help-copy-icon" title="Copy to clipboard" onclick="navigator.clipboard.writeText(${toOnclickArg(CLOUDCLI_INSTALL_CMD_WINDOWS)});this.classList.add('ai-help-copy-flash');setTimeout(()=>this.classList.remove('ai-help-copy-flash'),500)">⧉</span>
                                <pre class="config-form-help-pre"><code>${CLOUDCLI_INSTALL_CMD_WINDOWS}</code></pre>
                            </li>
                        </ul>
                     </li>
                    <li>
                        <p>That's it — click <b>Tools → AI Desktop</b> to start.</p>
                    </li>
                </ul>
                <p>(or manually install Node.js from <a href="${NODEJS_DOWNLOAD_LINK}" class="ai-help-ext-link">${NODEJS_DOWNLOAD_LINK}</a>, and install cloudcli via <code>npm install -g @cloudcli-ai/cloudcli</code> from command line)</p>
                <p>Saving the config restarts the process of AI Desktop only when <code>globalSettings.ai.guiCommand</code> or <code>globalSettings.ai.guiPort</code> changed.</p>
                <p>If an AI Desktop is already running on the same port (e.g. one you started in a terminal), the app reuses it instead of starting another.</p>`;

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
