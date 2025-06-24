import { toColorString, escapeHtml } from '../../../util/sharedUtil';

class ConfigForm {
    static MERGE_BEHAVIOR = `                
                <p><b>Merge behavior</b> 🧩</p>
                <ul>
                    <li>
                        If a rule key(domain:port) exists only in the global profile → it is copied into the profile.
                    </li>
                    <li>
                        If the same key(domain:port) exists in both → 
                          <ul>Only <code>hackRequest</code>/<code>hackResponse</code> are merged. And global's one runs first </ul>
                          <ul>Other fields(<code>target</code>, <code>customizedProxy</code>, <code>keepHostHeader</code>, <code>bypassCors</code>) in the rule of global profile are <b>IGNORED</b>.</ul>
                    </li>
                </ul>`;
    static HELP_CONTENT = {
        others: {
            title: 'Others',
            body: `
                <p>⚙️ Global switches (apply to every profile).</p>
                <ul>
                    <li>
                        <code>addAgentHeader</code> 🏷️ Add response header <code>checkout-proxy-use-agent</code>.
                        <br/>
                        It indicates which upstream proxy was used for this request: <code>proxyUrl</code> / <code>customizedProxy</code> / <code>none</code>.
                    </li>
                    <li><code>recording</code> 🧾 Log requests/responses in the <b>Console</b> window. Requests without matching any rule are not recorded</li>
                </ul>
            `
        },
        substitute: {
            title: 'Global Substitute Variables',
            body: `
                <p>🧷 Define global placeholders and use them as <code>{{key}}</code>.</p>
                <p><b>Priority</b> (high → low):</p>
                <ul>
                    <li><code>toBeDecided</code></li>
                    <li>Profile <code>substitute</code></li>
                    <li>Global <code>substitute</code></li>
                </ul>

                <p><b>Where placeholders work</b> ✅</p>
                <ul>
                    <li>Profile name</li>
                    <li><code>proxy.proxyUrl</code></li>
                    <li><code>hostUsingProxy</code> / <code>hostBypassProxy</code></li>
                    <li>Fixed-rule keys (host[:port])</li>
                    <li>Fixed-rule values: <code>target</code>, <code>customizedProxy</code>, hacks, etc.</li>
                </ul>

                <p><b>Notes</b> 📌</p>
                <ul>
                    <li>
                        Value of <code>substitute</code> can refer the key of <code>toBeDecided</code> by placeholder.
                    </li>
                    <li>
                        For <code>bypassCors</code> / <code>keepHostHeader</code>: after replacement, <code>""</code> (empty string) means <b>OFF</b>, any other string means <b>ON</b>.
                    </li>
                </ul>
                <p>💡 Example: <code>globalStgProxyHost</code>=<code>example-proxy.com</code> → <code>http://{{globalStgProxyHost}}:5702</code></p>
            `
        },
        profileSet: {
            title: 'Profile Sets (Global Profiles)',
            body: `
                <p>🌍 A <b>Profile Set</b> is a reusable pack of fixed rules.</p>
                <p>Use it in a profile via <code>proxy.globalProfile</code> (by name).</p>
                <ul>
                    <li>Contains: <code>httpsFixedRule</code> and <code>httpFixedRule</code></li>
                    <li>All rule keys are normalized to <code>host:port</code> when you start a profile</li>
                </ul>
                ${ConfigForm.MERGE_BEHAVIOR}
            `
        },
        fixedRules: {
            title: 'Fixed Rules (HTTP / HTTPS)',
            body: `
                <p>🎯 Fixed rules match a <code>host:port</code> and define what to do.</p>

                <p><b>Key format</b> 🔑</p>
                <ul>
                    <li>
                        Port is optional while editing: <code>example.com</code> → auto becomes <code>example.com:80</code> (HTTP) or <code>example.com:443</code> (HTTPS) when starting.
                    </li>
                    <li>
                        Wildcard <code>*</code> must be at the beginning/end of the domain part (also allowed right before <code>:port</code>), e.g.
                        <code>*.example.com:443</code>, <code>api.*:443</code>
                    </li>
                </ul>

                <p><b>Matching priority</b> ⭐️</p>
                <ul>
                    <li>Exact rule &gt; wildcard rule. And if multiple wildcard rules match, the chosen one is not guaranteed — prefer exact rules.</li>
                </ul>

                <p><b>Rule fields</b> 🧱</p>
                <ul>
                    <li>
                        <code>target</code> 🔁 Forward to another destination (supports <code>http</code> and <code>https</code>).
                    </li>
                    <li>
                        <code>customizedProxy</code> 🚇 Secondary upstream proxy for this rule.
                        <br/>
                        Supports <code>http://</code> and <code>https://</code> (basic auth allowed: <code>https://user:pass@proxy:port</code>).
                    </li>
                    <li><code>keepHostHeader</code> 🧷 Keep the original <code>Host</code> header (default: off).</li>
                    <li>
                        <code>bypassCors</code> 🧪 Inject permissive CORS headers for bypassing CORS restriction of browser.
                        <br/>
                        For <code>OPTIONS</code> preflight, the proxy will reply locally.
                    </li>
                    <li><code>hackRequest</code> ✍️ Run before sending to upstream/target (one per line).</li>
                    <li><code>hackResponse</code> 🧩 Run after receiving the response (one per line).</li>
                </ul>

                <p>🪄 Tip: an empty rule <code>{}</code> means <b>pass-through</b> (no target change, no upstream proxy). It also prevents using <code>proxyUrl</code> for that host.</p>
            `
        },
        profileBasic: {
            title: 'Basic Profile Info',
            body: `
                <p>🪪 Basic identity + startup choices.</p>
                <ul>
                    <li>
                        <code>name</code> Profile name (supports <code>{{var}}</code>).
                    </li>
                    <li>
                        <code>toBeDecided</code> Ask the user to choose values when starting.
                        <br/>
                        Format: <code>varName=val1,val2,val3</code>
                    </li>
                </ul>
                <p>⚠️ Limit: at most <b>2</b> items in <code>toBeDecided</code>.</p>
                <p>💡 Example: <code>proxyPort=9504,9506</code> → use <code>{{proxyPort}}</code> anywhere.</p>
            `
        },
        profileSubstitute: {
            title: 'Profile Substitute Variables',
            body: `
                <p>🧩 Variables only for this profile (override global ones with the same key).</p>
                <ul>
                    <li>Use <code>{{key}}</code> anywhere placeholders are supported.</li>
                    <li>
                        Values inside profile's <code>substitute</code> can refer the key of <code>toBeDecided</code>.
                    </li>
                    <li>
                        Priority: <code>toBeDecided</code> &gt; profile <code>substitute</code> &gt; global <code>substitute</code>
                    </li>
                </ul>
                <p>🪄 Tip: use the dropdown blow to copy global substitute variables.</p>
                <p>🪄 Tip: use "⧉" to copy local substitute variables.</p>
            `
        },
        globalProfiles: {
            title: 'Global Profiles',
            body: `
                <p>🌍 Add <b>Profile Set</b> names here (defined in <b>Global Settings → Profile Sets</b>).</p>
                <ul>
                    <li>Those sets are merged into this profile when you start it.</li>
                </ul>
                ${ConfigForm.MERGE_BEHAVIOR}
            `
        },
        proxySettings: {
            title: 'Proxy Settings',
            body: `
                <p>🚦 Configure the default upstream proxy, and which hosts should use it.</p>

                <ul>
                    <li>
                        <code>proxyUrl</code> 🌐 Upstream proxy URL.
                        <br/>
                        Supports <code>http://</code> and <code>https://</code> (basic auth allowed: <code>https://user:pass@proxy:port</code>).
                    </li>
                    <li><code>hostUsingProxy</code> ✅ Hosts that should use <code>proxyUrl</code> (one per line).</li>
                    <li><code>hostBypassProxy</code> ⛔️ Hosts that should bypass proxy (one per line).</li>
                </ul>

                <p><b>Patterns</b> ✨</p>
                <ul>
                    <li>Wildcard <code>*</code> at the beginning or end, e.g. <code>*.example.com</code></li>
                    <li>Reqeusts whose target is Local hosts (<code>localhost</code>, <code>127.0.0.1</code>, <code>::1</code>) are never sent to an upstream proxy.</li>
                </ul>

                <p><b>Overall priority</b> ⭐️</p>
                <ul>
                    <li>Fixed rule (exact &gt; wildcard) &gt; <code>hostBypassProxy</code> &gt; <code>hostUsingProxy</code></li>
                    <li>If a fixed rule matches, <code>proxyUrl</code> is not used. Use <code>customizedProxy</code> inside the rule if you still want an upstream proxy.</li>
                </ul>
            `
        }
    };

    static helpModal = null;
    static copiedToast = null;
    static ruleCopied = false;
    constructor(container, ruleCopied) {
        this.container = container;
        this.iconColor = '';
        this.profileColor = '';
        if (ruleCopied !== undefined) {
            ConfigForm.ruleCopied = !!ruleCopied;
        }
        if (!ConfigForm.copiedToast) {
            ConfigForm.copiedToast = document.createElement('div');
            ConfigForm.copiedToast.className = 'config-form-copied-toast';
            document.body.appendChild(ConfigForm.copiedToast);
        }
    }

    getHelpModal() {
        if (ConfigForm.helpModal) return ConfigForm.helpModal;
        ConfigForm.helpModal = document.createElement('div');
        ConfigForm.helpModal.className = 'config-form-help-modal';
        ConfigForm.helpModal.innerHTML = `
            <div class="config-form-help-content">
                <div class="config-form-help-header">
                    <span class="config-form-help-title"></span>
                    <button class="config-form-help-close">✕</button>
                </div>
                <div class="config-form-help-body"></div>
            </div>
        `;
        document.body.appendChild(ConfigForm.helpModal);
        ConfigForm.helpModal.querySelector('.config-form-help-close').addEventListener('click', () => {
            ConfigForm.helpModal.classList.remove('visible');
        });
        ConfigForm.helpModal.addEventListener('click', (e) => {
            if (e.target === ConfigForm.helpModal) ConfigForm.helpModal.classList.remove('visible');
        });
        document.addEventListener(
            'keydown',
            (e) => {
                if (e.key === 'Escape' && ConfigForm.helpModal.classList.contains('visible')) {
                    e.stopPropagation();
                    ConfigForm.helpModal.classList.remove('visible');
                }
            },
            true
        );
        return ConfigForm.helpModal;
    }

    showHelp(helpKey) {
        const modal = this.getHelpModal();
        if (!modal) return;
        const content = ConfigForm.HELP_CONTENT[helpKey];
        if (!content) return;
        modal.querySelector('.config-form-help-title').textContent = content.title;
        modal.querySelector('.config-form-help-body').innerHTML = content.body;

        // Ensure the initial (hidden) styles are applied before toggling visible,
        // otherwise the first open may skip the transition due to style batching.
        requestAnimationFrame(() => modal.classList.add('visible'));
    }

    showCopiedToast(text) {
        ConfigForm.copiedToast.textContent = text;
        ConfigForm.copiedToast.classList.add('visible');
        setTimeout(() => ConfigForm.copiedToast.classList.remove('visible'), 1800);
    }

    renderSectionHeader(title, helpKey) {
        return `<div class="config-form-section-header">
            <span class="config-form-section-title">${escapeHtml(title)}</span>
            ${helpKey ? `<button class="config-form-help-btn" data-help="${helpKey}" title="Help">?</button>` : ''}
        </div>`;
    }

    renderToggleConfig(...toggles) {
        const renderItem = ({ label, checked, dataPath }) =>
            `<div class="config-form-toggle-item">
                <span class="config-form-label">${escapeHtml(label)}</span>
                <label class="config-form-switch">
                    <input type="checkbox" data-path="${dataPath}" ${checked ? 'checked' : ''}>
                    <span class="config-form-slider"></span>
                </label>
            </div>`;
        const rows = [];
        for (let i = 0; i < toggles.length; i += 2) {
            const items = toggles
                .slice(i, i + 2)
                .map(renderItem)
                .join('');
            rows.push(`<div class="config-form-toggles-row">${items}</div>`);
        }
        return rows.join('');
    }

    renderTextField(label, value, dataPath, placeholder) {
        return `<div class="config-form-field">
            <label class="config-form-label">${escapeHtml(label)}</label>
            <input type="text" class="config-form-input" data-path="${dataPath}"
                   value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder || '')}">
        </div>`;
    }

    renderTextarea(label, items, dataPath, placeholder) {
        const value = Array.isArray(items) ? items.join('\n') : items || '';
        return `<div class="config-form-field">
            <label class="config-form-label">${escapeHtml(label)}</label>
            <textarea class="config-form-textarea" data-path="${dataPath}"
                      placeholder="${escapeHtml(placeholder || '')}">${escapeHtml(value)}</textarea>
        </div>`;
    }

    renderKvRow(key, value) {
        return `<div class="config-form-kv-row">
            <input type="text" class="config-form-kv-key" value="${escapeHtml(key)}" placeholder="Key">
            <input type="text" class="config-form-kv-value" value="${escapeHtml(String(value ?? ''))}" placeholder="Value">
            <button class="config-form-copy-btn config-form-rule-copy" title="Copy">⧉</button>
            <button class="config-form-delete-btn config-form-kv-delete" title="Remove">✕</button>
        </div>`;
    }

    renderKvEditor(kvPairs, dataPath) {
        const rows = Object.entries(kvPairs || {})
            .map(([k, v]) => this.renderKvRow(k, v))
            .join('');
        return `<div class="config-form-kv-editor" data-path="${dataPath}">
            ${rows}
            <button class="config-form-add-btn config-form-kv-add">+ Add</button>
        </div>`;
    }

    renderTbdRow(key, value) {
        return `<div class="config-form-kv-row config-form-tbd-row">
            <input type="text" class="config-form-kv-key" value="${escapeHtml(key)}" placeholder="Variable name">
            <input type="text" class="config-form-kv-value" value="${escapeHtml(value)}" placeholder="val1,val2,val3">
            <button class="config-form-copy-btn config-form-rule-copy" title="Copy">⧉</button>
            <button class="config-form-delete-btn config-form-tbd-delete" title="Remove">✕</button>
        </div>`;
    }

    renderTbdEditor(toBeDecided) {
        const items = toBeDecided || [];
        const rows = items
            .map((item) => {
                const eqIdx = item.indexOf('=');
                const key = eqIdx >= 0 ? item.substring(0, eqIdx) : item;
                const value = eqIdx >= 0 ? item.substring(eqIdx + 1) : '';
                return this.renderTbdRow(key, value);
            })
            .join('');
        return `<div class="config-form-kv-editor config-form-tbd-editor" data-path="toBeDecided">
            ${rows}
            <button class="config-form-add-btn config-form-tbd-add" ${items.length >= 2 ? 'disabled' : ''}>+ Add (max 2)</button>
        </div>`;
    }

    renderGlobalProfileSelect(profileSetNames) {
        if (!profileSetNames || !profileSetNames.length) return '';
        const options = profileSetNames
            .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
            .join('');
        return `<select class="config-form-profile-select">
            <option value="">-- select to add --</option>
            ${options}
        </select>`;
    }

    renderTagsEditor(items, dataPath, placeholder, selector) {
        const tags = (items || [])
            .map(
                (item) =>
                    `<span class="config-form-tag">${escapeHtml(item)}<button class="config-form-delete-btn config-form-tag-delete">✕</button></span>`
            )
            .join('');
        return `<div class="config-form-tags-editor" data-path="${dataPath}">
            ${selector}
            ${tags}
            <input type="text" class="config-form-tag-input" placeholder="${escapeHtml(placeholder || 'Add...')}">
        </div>`;
    }

    renderRuleCard(host, rule) {
        const r = rule || {};
        return `<div class="config-form-rule-card">
            <div class="config-form-rule-header">
                <span class="config-form-rule-arrow">▶</span>
                <input type="text" class="config-form-rule-host" value="${escapeHtml(host)}" placeholder="host:port">
                <span style="flex:1"></span>
                <button class="config-form-clone-btn config-form-rule-clone" title="Clone">⧉</button>
                <button class="config-form-delete-btn config-form-rule-delete" title="Remove">✕</button>
            </div>
            <div class="config-form-rule-body">
                <div class="config-form-toggles-row">
                    <div class="config-form-toggle-item">
                        <span class="config-form-label">Keep Host Header:</span>
                        <label class="config-form-switch">
                            <input type="checkbox" data-prop="keepHostHeader" ${r.keepHostHeader ? 'checked' : ''}>
                            <span class="config-form-slider"></span>
                        </label>
                    </div>
                    <div class="config-form-toggle-item">
                        <span class="config-form-label">Bypass CORS:</span>
                        <label class="config-form-switch">
                            <input type="checkbox" data-prop="bypassCors" ${r.bypassCors ? 'checked' : ''}>
                            <span class="config-form-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="config-form-field">
                    <label class="config-form-label">Customized Proxy:</label>
                    <input type="text" class="config-form-input" data-prop="customizedProxy"
                           value="${escapeHtml(r.customizedProxy || '')}" placeholder="http://proxy:port">
                </div>
                <div class="config-form-field">
                    <label class="config-form-label">Target:</label>
                    <input type="text" class="config-form-input" data-prop="target"
                           value="${escapeHtml(r.target || '')}" placeholder="http://target:port">
                </div>
                <div class="config-form-hack-row">
                    <div class="config-form-field">
                        <label class="config-form-label">Hack Request (one per line):</label>
                        <textarea class="config-form-mini-textarea" data-prop="hackRequest"
                                  placeholder="functionName(args)">${escapeHtml((r.hackRequest || []).join('\n'))}</textarea>
                    </div>
                    <div class="config-form-field">
                        <label class="config-form-label">Hack Response (one per line):</label>
                        <textarea class="config-form-mini-textarea" data-prop="hackResponse"
                                  placeholder="functionName(args)">${escapeHtml((r.hackResponse || []).join('\n'))}</textarea>
                    </div>
                </div>
            </div>
        </div>`;
    }

    renderRulesEditor(rules, dataPath, ruleCopied) {
        const cards = Object.entries(rules || {})
            .map(([host, rule]) => this.renderRuleCard(host, rule))
            .join('');
        return `<div class="config-form-rules-editor" ${dataPath ? `data-path="${dataPath}"` : ''}>
            ${cards}
            <div class="config-form-add-btn-group">
                <button class="config-form-add-btn config-form-rule-add">+ Add Rule</button>
                <button class="config-form-add-btn config-form-rule-add-from-copy" ${ruleCopied ? '' : 'disabled'} >+ Add from Copy</button>
            </div>
        </div>`;
    }

    renderProfileSetEntry(name, profileSet, ruleCopied) {
        const ps = profileSet || {};
        return `<div class="config-form-collapsible">
            <div class="config-form-collapsible-header">
                <span class="config-form-collapsible-arrow">▶</span>
                <input type="text" class="config-form-collapsible-name" value="${escapeHtml(name)}" placeholder="Profile set name">
                <span style="flex:1"></span>
                <button class="config-form-delete-btn config-form-collapsible-delete" title="Remove">✕</button>
            </div>
            <div class="config-form-collapsible-body">
                <div class="config-form-subsection">
                    <div class="config-form-subsection-header">HTTPS Fixed Rules:</div>
                    ${this.renderRulesEditor(ps.httpsFixedRule, '', ruleCopied)}
                </div>
                <div class="config-form-subsection">
                    <div class="config-form-subsection-header">HTTP Fixed Rules:</div>
                    ${this.renderRulesEditor(ps.httpFixedRule, '', ruleCopied)}
                </div>
            </div>
        </div>`;
    }

    renderProfileSetEditor(profileSet, ruleCopied) {
        const entries = Object.entries(profileSet || {})
            .map(([name, ps]) => this.renderProfileSetEntry(name, ps, ruleCopied))
            .join('');
        return `<div class="config-form-profile-sets">
            ${entries}
            <button class="config-form-add-btn config-form-profile-set-add">+ Add Profile Set</button>
        </div>`;
    }

    renderGlobalVarDropdown(globalSubstitute) {
        const entries = Object.entries(globalSubstitute || {});
        if (entries.length === 0) {
            return `<div class="config-form-copy-dropdown">
                <span style="font-size:0.82em;color:#888">No global variables available</span>
            </div>`;
        }
        const options = entries
            .map(
                ([key, value]) =>
                    `<option value="${escapeHtml(key)}">${escapeHtml(key)} = ${escapeHtml(String(value).substring(0, 40))}</option>`
            )
            .join('');
        return `<div class="config-form-copy-dropdown">
            <label>Global Substitude Variables (click to copy <code>{{varName}}</code>):</label>
            <select class="config-form-global-var-select">
                <option value="">-- select to copy --</option>
                ${options}
            </select>
        </div>`;
    }

    collectKvEditor(container) {
        if (!container) return {};
        const result = {};
        container.querySelectorAll('.config-form-kv-row').forEach((row) => {
            const key = row.querySelector('.config-form-kv-key').value.trim();
            const value = row.querySelector('.config-form-kv-value').value;
            if (key) result[key] = value;
        });
        return result;
    }

    collectTbdEditor(container) {
        if (!container) return [];
        const result = [];
        container.querySelectorAll('.config-form-tbd-row').forEach((row) => {
            const key = row.querySelector('.config-form-kv-key').value.trim();
            if (!key) return;
            const value = row.querySelector('.config-form-kv-value').value.trim();
            result.push(value ? `${key}=${value}` : key);
        });
        return result;
    }

    updateTbdAddButton(editor) {
        const addBtn = editor.querySelector('.config-form-tbd-add');
        if (addBtn) {
            addBtn.disabled = editor.querySelectorAll('.config-form-tbd-row').length >= 2;
        }
    }

    updateAddFromCopyButton() {
        const addBtn = document.querySelectorAll('.config-form-rule-add-from-copy');
        (addBtn ?? []).forEach((btn) => {
            btn.disabled = !ConfigForm.ruleCopied;
        });
    }

    collectTagsEditor(container) {
        if (!container) return [];
        const tags = [];
        container.querySelectorAll('.config-form-tag').forEach((tag) => {
            const text = tag.childNodes[0]?.textContent?.trim();
            if (text) tags.push(text);
        });
        return tags;
    }

    collectTextareaArray(container) {
        if (!container) return [];
        const text = container.value?.trim();
        if (!text) return [];
        return text
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
    }

    collectRuleCard(card) {
        const host = card.querySelector('.config-form-rule-host').value.trim();
        if (!host) return null;
        const body = card.querySelector('.config-form-rule-body');
        const rule = {};

        const customizedProxy = body.querySelector('[data-prop="customizedProxy"]')?.value?.trim();
        if (customizedProxy) rule.customizedProxy = customizedProxy;

        const target = body.querySelector('[data-prop="target"]')?.value?.trim();
        if (target) rule.target = target;

        const keepHostHeader = body.querySelector('[data-prop="keepHostHeader"]')?.checked;
        if (keepHostHeader) rule.keepHostHeader = true;

        const bypassCors = body.querySelector('[data-prop="bypassCors"]')?.checked;
        if (bypassCors) rule.bypassCors = true;

        const hackRequest = body.querySelector('[data-prop="hackRequest"]')?.value?.trim();
        if (hackRequest)
            rule.hackRequest = hackRequest
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);

        const hackResponse = body.querySelector('[data-prop="hackResponse"]')?.value?.trim();
        if (hackResponse)
            rule.hackResponse = hackResponse
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);

        return { host, rule };
    }

    collectRulesEditor(container) {
        if (!container) return {};
        const result = {};
        container.querySelectorAll('.config-form-rule-card').forEach((card) => {
            const entry = this.collectRuleCard(card);
            if (entry) result[entry.host] = entry.rule;
        });
        return result;
    }

    collectOthers(form) {
        const result = {};
        form.querySelectorAll('[data-path^="others."]').forEach((el) => {
            const key = el.dataset.path.replace('others.', '');
            result[key] = !!el.checked;
        });
        return result;
    }

    collectProfileSetEditor(container) {
        if (!container) return {};
        const result = {};
        container.querySelectorAll(':scope > .config-form-collapsible').forEach((entry) => {
            const name = entry.querySelector('.config-form-collapsible-name').value.trim();
            if (!name) return;
            const subsections = entry.querySelectorAll('.config-form-subsection');
            const profileSet = {};
            if (subsections[0]) {
                const re = subsections[0].querySelector('.config-form-rules-editor');
                if (re) profileSet.httpsFixedRule = this.collectRulesEditor(re);
            }
            if (subsections[1]) {
                const re = subsections[1].querySelector('.config-form-rules-editor');
                if (re) profileSet.httpFixedRule = this.collectRulesEditor(re);
            }
            result[name] = profileSet;
        });
        return result;
    }

    copyAndShowToast(text, message) {
        (text ? navigator.clipboard.writeText(text) : Promise.resolve())
            .then(() => {
                this.showCopiedToast(message);
            })
            .catch(() => {});
    }

    bindEvents() {
        this.container.addEventListener('click', (e) => {
            const target = e.target;

            // Help button
            const helpBtn = target.closest('.config-form-help-btn');
            if (helpBtn) {
                e.stopPropagation();
                this.showHelp(helpBtn.dataset.help);
                return;
            }

            // TBD delete
            if (target.closest('.config-form-tbd-delete')) {
                const editor = target.closest('.config-form-tbd-editor');
                target.closest('.config-form-tbd-row').remove();
                if (editor) this.updateTbdAddButton(editor);
                return;
            }

            // TBD copy
            if (target.closest('.config-form-rule-copy')) {
                const key = target.previousElementSibling?.previousElementSibling?.value;
                if (key) this.copyAndShowToast(`{{${key}}}`, `"{{${key}}}" copied`);
                return;
            }

            // TBD add
            const tbdAdd = target.closest('.config-form-tbd-add');
            if (tbdAdd && !tbdAdd.disabled) {
                const editor = tbdAdd.closest('.config-form-tbd-editor');
                tbdAdd.insertAdjacentHTML('beforebegin', this.renderTbdRow('', ''));
                tbdAdd.previousElementSibling.querySelector('.config-form-kv-key').focus();
                this.updateTbdAddButton(editor);
                return;
            }

            // KV delete
            if (target.closest('.config-form-kv-delete')) {
                target.closest('.config-form-kv-row').remove();
                return;
            }

            // KV add
            const kvAdd = target.closest('.config-form-kv-add');
            if (kvAdd) {
                kvAdd.insertAdjacentHTML('beforebegin', this.renderKvRow('', ''));
                kvAdd.previousElementSibling.querySelector('.config-form-kv-key').focus();
                return;
            }

            // Tag delete
            if (target.closest('.config-form-tag-delete')) {
                target.closest('.config-form-tag').remove();
                return;
            }

            // Rule delete
            if (target.closest('.config-form-rule-delete')) {
                target.closest('.config-form-rule-card').remove();
                return;
            }

            // Rule clone
            if (target.closest('.config-form-rule-clone')) {
                const card = target.closest('.config-form-rule-card');
                const entry = this.collectRuleCard(card);
                window.electronAPI.copyRule(entry);
                ConfigForm.ruleCopied = true;
                this.copyAndShowToast(null, `rule copied, click "Add from Copy" to apply.`);
                this.updateAddFromCopyButton();
                return;
            }

            // Rule header click to toggle expand (except input, delete, clone)
            const ruleHeader = target.closest('.config-form-rule-header');
            if (
                ruleHeader &&
                !target.closest('.config-form-rule-delete') &&
                !target.closest('.config-form-rule-clone') &&
                !target.closest('.config-form-rule-host')
            ) {
                ruleHeader.closest('.config-form-rule-card').classList.toggle('expanded');
                return;
            }

            // Rule add
            const ruleAdd = target.closest('.config-form-rule-add');
            if (ruleAdd) {
                ruleAdd.parentElement.insertAdjacentHTML('beforebegin', this.renderRuleCard('', {}));
                const newCard = ruleAdd.parentElement.previousElementSibling;
                newCard.classList.add('expanded');
                newCard.querySelector('.config-form-rule-host').focus();
                return;
            }

            const ruleAddFromCopy = target.closest('.config-form-rule-add-from-copy');
            if (ruleAddFromCopy) {
                window.electronAPI.pasteRule().then((entry) => {
                    if (!entry?.rule) return;
                    const newHost = (entry.rule.host ?? '') + '_new';
                    const newRule = entry ? entry.rule.rule : {};
                    ruleAddFromCopy.parentElement.insertAdjacentHTML(
                        'beforebegin',
                        this.renderRuleCard(newHost, newRule)
                    );
                    const newCard = ruleAddFromCopy.parentElement.previousElementSibling;
                    const hostInput = newCard.querySelector('.config-form-rule-host');
                    hostInput.setSelectionRange(hostInput.value.length, hostInput.value.length);
                    hostInput.focus();
                });
                return;
            }

            // Collapsible toggle
            const collapsibleHeader = target.closest('.config-form-collapsible-header');
            if (
                collapsibleHeader &&
                !target.closest('.config-form-collapsible-delete') &&
                !target.closest('.config-form-collapsible-name')
            ) {
                const collapsible = collapsibleHeader.closest('.config-form-collapsible');
                if (collapsible.classList.contains('expanded')) {
                    Array.from(
                        collapsibleHeader.nextElementSibling?.querySelectorAll('.config-form-rule-card') || []
                    ).forEach((card) => card.classList.remove('expanded'));
                }
                collapsible.classList.toggle('expanded');
                return;
            }

            // Collapsible delete
            if (target.closest('.config-form-collapsible-delete')) {
                target.closest('.config-form-collapsible').remove();
                return;
            }

            // Profile set add
            const psAdd = target.closest('.config-form-profile-set-add');
            if (psAdd) {
                psAdd.insertAdjacentHTML('beforebegin', this.renderProfileSetEntry('', {}, ConfigForm.ruleCopied));
                const newEntry = psAdd.previousElementSibling;
                newEntry.classList.add('expanded');
                newEntry.querySelector('.config-form-collapsible-name').focus();
                return;
            }
        });

        // Tag input: add on Enter
        this.container.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('config-form-tag-input') && e.key === 'Enter') {
                e.preventDefault();
                const input = e.target;
                const value = input.value.trim();
                if (value) {
                    const tag = document.createElement('span');
                    tag.className = 'config-form-tag';
                    tag.innerHTML = `${escapeHtml(value)}<button class="config-form-delete-btn config-form-tag-delete">✕</button>`;
                    input.parentElement.insertBefore(tag, input);
                    input.value = '';
                }
            }
        });

        // Global profile select: add tag
        this.container.addEventListener('change', (e) => {
            if (e.target.classList.contains('config-form-profile-select')) {
                const value = e.target.value;
                if (value) {
                    const tagsEditor = e.target
                        .closest('.config-form-field')
                        ?.querySelector('.config-form-tags-editor');
                    if (tagsEditor) {
                        const input = tagsEditor.querySelector('.config-form-tag-input');
                        const tag = document.createElement('span');
                        tag.className = 'config-form-tag';
                        tag.innerHTML = `${escapeHtml(value)}<button class="config-form-delete-btn config-form-tag-delete">✕</button>`;
                        if (input) {
                            tagsEditor.insertBefore(tag, input);
                        } else {
                            tagsEditor.appendChild(tag);
                        }
                    }
                    e.target.value = '';
                }
                return;
            }

            // Global var select: copy to clipboard
            if (e.target.classList.contains('config-form-global-var-select')) {
                const varName = e.target.value;
                if (varName) {
                    this.copyAndShowToast(`{{${varName}}}`, `"{{${varName}}}" copied`);
                    e.target.value = '';
                }
            }
        });
    }
}

export class GlobalSettingsForm extends ConfigForm {
    constructor(container, ruleCopied) {
        super(container, ruleCopied);
        this.bindEvents();
    }

    populate(globalSettings) {
        const gs = globalSettings || {};
        const others = gs.others || {};
        const substitute = gs.substitute || {};
        const profileSet = gs.profileSet || {};

        this.container.innerHTML = `<div class="config-form">
            <div class="config-form-section">
                ${this.renderSectionHeader('Others', 'others')}
                <div class="config-form-section-body">
                    ${this.renderToggleConfig(
                        {
                            label: 'Add Agent Header:',
                            checked: others.addAgentHeader,
                            dataPath: 'others.addAgentHeader'
                        },
                        { label: 'Recording:', checked: others.recording, dataPath: 'others.recording' }
                    )}
                </div>
            </div>
            <div class="config-form-section">
                ${this.renderSectionHeader('Global Substitute Variables', 'substitute')}
                <div class="config-form-section-body">
                    ${this.renderKvEditor(substitute, 'substitute')}
                </div>
            </div>
            <div class="config-form-section">
                ${this.renderSectionHeader('Profile Sets', 'profileSet')}
                <div class="config-form-section-body">
                    ${this.renderProfileSetEditor(profileSet, ConfigForm.ruleCopied)}
                </div>
            </div>
        </div>`;
    }

    collect() {
        const form = this.container.querySelector('.config-form');
        if (!form) return {};
        const globalSettings = {};

        // Others
        globalSettings.others = this.collectOthers(form);

        // Substitute
        globalSettings.substitute = this.collectKvEditor(
            form.querySelector('.config-form-kv-editor[data-path="substitute"]')
        );

        // ProfileSet
        globalSettings.profileSet = this.collectProfileSetEditor(form.querySelector('.config-form-profile-sets'));

        return globalSettings;
    }
}

export class ProfileForm extends ConfigForm {
    constructor(container, color, ruleCopied) {
        super(container, ruleCopied);
        this.profileColor = toColorString(color);
        this.iconColor = toColorString([color[0], color[1], color[2] + 10]);
        this.bindEvents();
    }

    populate(profile, globalSubstitute, profileSetNames) {
        const p = profile || {};
        const proxy = p.proxy || {};
        this.container.innerHTML = `<div class="config-form" style="--icon-color: ${this.profileColor}">
            <div class="config-form-section">
                ${this.renderSectionHeader('Basic Info', 'profileBasic')}
                <div class="config-form-section-body">
                    ${this.renderTextField('Profile Name:', p.name, 'name', 'Profile name (supports {{var}})')}
                    <div class="config-form-field">
                        <label class="config-form-label">To Be Decided:</label>
                        ${this.renderTbdEditor(p.toBeDecided)}
                    </div>
                </div>
            </div>
            <div class="config-form-section">
                ${this.renderSectionHeader('Substitute Variables', 'profileSubstitute')}
                <div class="config-form-section-body">
                    ${this.renderGlobalVarDropdown(globalSubstitute)}
                    <label class="config-form-label">Local Substitute Variables:</label>
                    ${this.renderKvEditor(p.substitute, 'substitute')}
                </div>
            </div>
            <div class="config-form-section">
                ${this.renderSectionHeader('Proxy Settings', 'proxySettings')}
                <div class="config-form-section-body">
                    ${this.renderTextField('Proxy URL:', proxy.proxyUrl, 'proxy.proxyUrl', 'http://proxy:port')}
                    <div class="config-form-host-rules-row">
                        ${this.renderTextarea('Hosts Using Proxy (one per line):', proxy.hostUsingProxy, 'proxy.hostUsingProxy', '*.example.com')}
                        ${this.renderTextarea('Hosts Bypassing Proxy (one per line):', proxy.hostBypassProxy, 'proxy.hostBypassProxy', '*.local')}
                    </div>
                </div>
            </div>
            <div class="config-form-section">
                ${this.renderSectionHeader('Global Profiles', 'globalProfiles')}
                <div class="config-form-section-body">
                    <div class="config-form-field">
                    ${this.renderTagsEditor(proxy.globalProfile, 'proxy.globalProfile', 'Profile set name  (Enter to add)', this.renderGlobalProfileSelect(profileSetNames))}
                    </div>
                </div>
            </div>
            <div class="config-form-section">
                ${this.renderSectionHeader('HTTPS Fixed Rules', 'fixedRules')}
                <div class="config-form-section-body">
                    ${this.renderRulesEditor(proxy.httpsFixedRule, 'proxy.httpsFixedRule', ConfigForm.ruleCopied)}
                </div>
            </div>
            <div class="config-form-section">
                ${this.renderSectionHeader('HTTP Fixed Rules', 'fixedRules')}
                <div class="config-form-section-body">
                    ${this.renderRulesEditor(proxy.httpFixedRule, 'proxy.httpFixedRule', ConfigForm.ruleCopied)}
                </div>
            </div>
        </div>`;
    }

    collect() {
        const form = this.container.querySelector('.config-form');
        if (!form) return {};
        const profile = {};

        // Name
        profile.name = form.querySelector('[data-path="name"]')?.value || '';

        // toBeDecided
        const tbd = this.collectTbdEditor(form.querySelector('.config-form-tbd-editor[data-path="toBeDecided"]'));
        if (tbd.length > 0) profile.toBeDecided = tbd;

        // Substitute
        const sub = this.collectKvEditor(form.querySelector('.config-form-kv-editor[data-path="substitute"]'));
        if (Object.keys(sub).length > 0) profile.substitute = sub;

        // Proxy
        profile.proxy = {};
        profile.proxy.proxyUrl = form.querySelector('[data-path="proxy.proxyUrl"]')?.value || '';
        profile.proxy.globalProfile = this.collectTagsEditor(
            form.querySelector('.config-form-tags-editor[data-path="proxy.globalProfile"]')
        );
        profile.proxy.hostUsingProxy = this.collectTextareaArray(
            form.querySelector('.config-form-textarea[data-path="proxy.hostUsingProxy"]')
        );
        profile.proxy.hostBypassProxy = this.collectTextareaArray(
            form.querySelector('.config-form-textarea[data-path="proxy.hostBypassProxy"]')
        );

        // Fixed rules
        const httpsRE = form.querySelector('.config-form-rules-editor[data-path="proxy.httpsFixedRule"]');
        profile.proxy.httpsFixedRule = this.collectRulesEditor(httpsRE);
        const httpRE = form.querySelector('.config-form-rules-editor[data-path="proxy.httpFixedRule"]');
        profile.proxy.httpFixedRule = this.collectRulesEditor(httpRE);

        return profile;
    }
}
