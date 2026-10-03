import { CONSOLE_ROW_SIZE, USE_NO_AGENT } from '../../../constant/constant';
import { parseFilterInfo, matchesFilter as evaluateFilter } from './filter-parser.js';
import ace from 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/ext-searchbox';
import 'ace-builds/src-min-noconflict/mode-json';
import 'ace-builds/src-min-noconflict/theme-xcode';
import { stripHopByHopHeaders } from '../../../util/sharedUtil';

ace.config.set('loadWorkerFromBlob', false);

const EXPAND_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z" stroke="#1C274C" stroke-width="1.5"/><path d="M17 7H14M17 7V10M17 7L13.5 10.5M7 17H10M7 17V14M7 17L10.5 13.5" stroke="#1C274C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * JsonTableComponent - A reusable component for displaying JSON arrays as tables
 * Kibana-style UI with filtering, column management, and auto-scroll
 */
export class JsonTableComponent {
    constructor(containerElement, options = {}) {
        this.container = containerElement;
        this.hasExplicitVisibleColumns = Array.isArray(options.initialSettings?.visibleColumns);
        this.options = {
            onSettingsChange: options.onSettingsChange || (() => {}),
            onTableChange: options.onTableChange || null,
            initialSettings: options.initialSettings || {},
            maxRows: options.maxRows || CONSOLE_ROW_SIZE,
            fixedFirstColumn: options.fixedFirstColumn || 'timestamp'
        };

        // Data storage
        this.dataMap = new Map();
        this.filteredMap = new Map();
        this.allKeys = new Set();

        // Settings
        this.settings = {
            visibleColumns: this.options.initialSettings.visibleColumns || [this.options.fixedFirstColumn],
            columnWidths: this.options.initialSettings.columnWidths || {},
            columnOrder: this.options.initialSettings.columnOrder || [this.options.fixedFirstColumn],
            wrapColumns: this.options.initialSettings.wrapColumns || [],
            wrapAll: this.options.initialSettings.wrapAll || false,
            autoScroll: this.options.initialSettings.autoScroll !== false,
            lastFilter: '',
            filterHistory: this.options.initialSettings.filterHistory || []
        };

        // State
        this.filterAst = null;
        this.dragState = null;
        this.resizeState = null;
        this.idToRow = new Map();
        this.entryModal = null;
        this.entryEditor = null;
        this.entryModalKeydown = null;

        this.init();
    }

    isInternalKey(key) {
        return typeof key === 'string' && key.startsWith('__') && key.endsWith('__');
    }

    rebuildFilteredMap() {
        this.filteredMap.clear();
        for (const [id, item] of this.dataMap) {
            if (!this.filterAst || this.matchesFilter(item)) {
                this.filteredMap.set(id, item);
            }
        }
    }

    init() {
        this.container.innerHTML = '';
        this.container.className = 'json-table-wrapper';

        // Create toolbar
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'json-table-toolbar';
        this.toolbar.innerHTML = `
            <div class="json-table-toolbar-left">
                <div class="json-table-filter-container">
                    <button class="json-table-filter-history-btn" title="Filter history">
                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none">
                            <g fill="#000000">
                                <path d="M1.5 1.25a.75.75 0 011.5 0v1.851A7 7 0 111 8a.75.75 0 011.5 0 5.5 5.5 0 101.725-4H5.75a.75.75 0 010 1.5h-3.5a.75.75 0 01-.75-.75v-3.5z"/>
                                <path d="M8.25 4a.75.75 0 01.75.75v3.763l1.805.802a.75.75 0 01-.61 1.37l-2.25-1A.75.75 0 017.5 9V4.75A.75.75 0 018.25 4z"/>
                            </g>
                        </svg>
                    </button>
                    <div class="json-table-filter-history-menu"></div>
                    <input type="text" class="json-table-filter-input" placeholder="Filter (regex)..." value="${this.escapeHtml(this.settings.lastFilter)}">
                    <span class="json-table-filter-clear" title="Clear filter">✕</span>
                </div>
                <button class="json-table-filter-help-btn" title="Filter & Table Help">?</button>
            </div>
            <div class="json-table-toolbar-right">
                <div class="json-table-columns-dropdown">
                    <button class="json-table-columns-btn">Columns ▼</button>
                    <div class="json-table-columns-menu"></div>
                </div>
                <label class="json-table-wrap-toggle">
                    <input type="checkbox" ${this.settings.wrapAll ? 'checked' : ''}>
                    <span>Wrap All</span>
                </label>
            </div>
        `;
        this.container.appendChild(this.toolbar);

        // Create help modal (append to body to be above everything)
        this.helpModal = document.createElement('div');
        this.helpModal.className = 'json-table-help-modal';
        this.helpModal.innerHTML = `
            <div class="json-table-help-content">
                <div class="json-table-help-header">
                    <span class="json-table-help-title">Table Usage Guide</span>
                    <button class="json-table-help-close">✕</button>
                </div>
                <div class="json-table-help-body">
                    <section>
                        <h3>🔍 Filter Syntax</h3>
                        <table class="help-syntax-table">
                            <tr><td><code>text</code></td><td>Search all columns for "text"</td></tr>
                            <tr><td><code>column:value</code></td><td>Search specific column (case-insensitive)</td></tr>
                            <tr><td><code>column:""</code></td><td>Match empty string value</td></tr>
                            <tr><td><code>column:</code></td><td>Match entries without this column or where value is null/undefined</td></tr>
                            <tr><td><code>A AND B</code></td><td>Both conditions must match</td></tr>
                            <tr><td><code>A OR B</code></td><td>Either condition matches</td></tr>
                            <tr><td><code>(A OR B) AND C</code></td><td>Group with parentheses</td></tr>
                            <tr><td><code>path:"hello world"</code></td><td>Use quotes for values with spaces</td></tr>
                        </table>
                        <p class="help-note">💡 Filter values support regular expressions (case-insensitive)</p>
                    </section>
                    <section>
                        <h3>📊 Column Management</h3>
                        <ul>
                            <li><b>Resize:</b> Drag column border to adjust width</li>
                            <li><b>Reorder:</b> Drag column header to change position</li>
                            <li><b>Show/Hide:</b> Use "Columns" dropdown to select visible columns</li>
                            <li><b>Wrap:</b> Toggle text wrapping per column or use "Wrap All"</li>
                        </ul>
                    </section>
                </div>
            </div>
        `;
        document.body.appendChild(this.helpModal);
        this.initEntryModal();

        // Create status bar
        this.statusBar = document.createElement('div');
        this.statusBar.className = 'json-table-status-bar';
        this.statusBar.innerHTML = `
            <div class="json-table-status-left">
                <label class="json-table-autoscroll-toggle">
                    <input type="checkbox" ${this.settings.autoScroll ? 'checked' : ''}>
                    <span>Auto-scroll</span>
                </label>
                <span class="json-table-go-to-top">go to top</span>
            </div>
            <div class="json-table-status-right">
                <span class="json-table-record-count">Showing 0 of 0 records</span>
            </div>
        `;
        this.container.appendChild(this.statusBar);

        // Create table container
        this.tableContainer = document.createElement('div');
        this.tableContainer.className = 'json-table-container';
        this.container.appendChild(this.tableContainer);

        // Create table
        this.table = document.createElement('table');
        this.table.className = 'json-table';
        this.tableContainer.appendChild(this.table);

        // Create thead and tbody
        this.thead = document.createElement('thead');
        this.tbody = document.createElement('tbody');
        this.table.appendChild(this.thead);
        this.table.appendChild(this.tbody);

        this.bindEvents();
        this.renderTable();
        this.updateColumnsMenu();
        this.updateRecordCount();

        // Apply initial filter if exists
        if (this.settings.lastFilter) {
            this.setFilter(this.settings.lastFilter);
        }
    }

    escapeCallback(e) {
        if (e.key === 'Escape' && this.helpModal.classList.contains('visible')) {
            this.helpModal.classList.remove('visible');
            e.preventDefault();
            e.stopPropagation();
            return true;
        }
        return false;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    bindEvents() {
        // Filter input
        const filterInput = this.toolbar.querySelector('.json-table-filter-input');
        this.filterInput = filterInput;
        const historyBtn = this.toolbar.querySelector('.json-table-filter-history-btn');
        const historyMenu = this.toolbar.querySelector('.json-table-filter-history-menu');
        let filterTimeout = null;
        filterInput.addEventListener('input', (e) => {
            clearTimeout(filterTimeout);
            filterTimeout = setTimeout(() => {
                this.setFilter(e.target.value);
            }, 300);
        });
        filterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(filterTimeout);
                this.setFilter(filterInput.value);
                this.addFilterHistory(filterInput.value);
            } else if (e.key === 'Escape') {
                historyMenu.classList.remove('visible');
            }
        });

        // Filter clear
        this.toolbar.querySelector('.json-table-filter-clear').addEventListener('click', () => {
            filterInput.value = '';
            this.setFilter('');
        });

        // Filter help button - show internal help modal
        this.toolbar.querySelector('.json-table-filter-help-btn').addEventListener('click', () => {
            this.helpModal.classList.add('visible');
        });

        historyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.renderFilterHistory();
            historyMenu.classList.toggle('visible');
        });

        historyMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = e.target.closest('.json-table-filter-history-item');
            if (!item) return;
            const value = item.dataset.value || '';
            filterInput.value = value;
            this.setFilter(value);
            this.addFilterHistory(value);
            historyMenu.classList.remove('visible');
        });

        // Help modal close button
        this.helpModal.querySelector('.json-table-help-close').addEventListener('click', () => {
            this.helpModal.classList.remove('visible');
        });

        // Close help modal when clicking overlay
        this.helpModal.addEventListener('click', (e) => {
            if (e.target === this.helpModal) {
                this.helpModal.classList.remove('visible');
            }
        });

        // Columns dropdown
        const columnsBtn = this.toolbar.querySelector('.json-table-columns-btn');
        const columnsMenu = this.toolbar.querySelector('.json-table-columns-menu');
        columnsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            columnsMenu.classList.toggle('visible');
        });

        document.addEventListener('click', () => {
            columnsMenu.classList.remove('visible');
            historyMenu.classList.remove('visible');
        });

        columnsMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Wrap all toggle
        this.toolbar.querySelector('.json-table-wrap-toggle input').addEventListener('change', (e) => {
            this.settings.wrapAll = e.target.checked;
            // Sync individual column wraps
            if (e.target.checked) {
                // Add all columns to wrapColumns
                this.allKeys.forEach((key) => {
                    if (!this.settings.wrapColumns.includes(key)) {
                        this.settings.wrapColumns.push(key);
                    }
                });
            } else {
                // Clear all column wraps
                this.settings.wrapColumns = [];
            }
            // Update column menu icons
            this.updateColumnsMenu();
            this.renderTableBody();
            this.notifySettingsChange();
        });

        // Auto-scroll toggle
        this.statusBar.querySelector('.json-table-autoscroll-toggle input').addEventListener('change', (e) => {
            this.settings.autoScroll = e.target.checked;
            this.notifySettingsChange();
            if (this.settings.autoScroll) {
                this.tableContainer.scrollTo({ top: this.tableContainer.scrollHeight, behavior: 'smooth' });
            }
        });

        // Scroll to top
        this.statusBar.querySelector('.json-table-go-to-top').addEventListener('click', () => {
            this.settings.autoScroll = false;
            this.statusBar.querySelector('.json-table-autoscroll-toggle input').checked = false;
            this.notifySettingsChange();
            this.tableContainer.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Column resize and drag events
        this.thead.addEventListener('mousedown', (e) => this.handleHeaderMouseDown(e));
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', () => this.handleMouseUp());
    }

    initEntryModal() {
        this.entryModal = document.createElement('div');
        this.entryModal.className = 'json-table-entry-modal';
        this.entryModal.innerHTML = `
            <div class="json-table-entry-content">
                <div class="json-table-entry-header">
                    <span class="json-table-entry-title">Entry Details</span>
                    <button class="json-table-entry-close" title="Close">✕</button>
                </div>
                <div class="json-table-entry-body">
                    <div class="json-table-entry-main-editor"></div>
                    <div class="json-table-entry-body-editors">
                        <div class="json-table-entry-body-panel" data-panel="req">
                            <div class="json-table-entry-body-toolbar">
                                <div class="json-table-entry-body-toolbar-left">
                                    <button class="json-table-entry-expand-btn" data-target="req" title="Expand">${EXPAND_ICON_SVG}</button>
                                    <span class="json-table-entry-body-label">Request Body</span>
                                </div>
                                <div class="json-table-entry-body-controls">
                                    <span class="json-table-entry-copy-curl" title="Copy request as cURL command"></span>
                                    <select class="json-table-entry-encoding-select" data-target="req">
                                        <option value="raw" selected>Raw</option>
                                        <option value="url-utf8">UTF-8 URL Decode</option>
                                        <option value="url-eucjp">EUC-JP URL Decode</option>
                                        <option value="unicode">Unicode Decode</option>
                                    </select>
                                    <label class="json-table-entry-format-toggle" data-target="req">
                                        <input type="checkbox" />
                                        <span>Format JSON</span>
                                    </label>
                                </div>
                            </div>
                            <div class="json-table-entry-body-editor" data-editor="req"></div>
                        </div>
                        <div class="json-table-entry-body-panel" data-panel="res">
                            <div class="json-table-entry-body-toolbar">
                                <div class="json-table-entry-body-toolbar-left">
                                    <button class="json-table-entry-expand-btn" data-target="res" title="Expand">${EXPAND_ICON_SVG}</button>
                                    <span class="json-table-entry-body-label">Response Body</span>
                                </div>
                                <div class="json-table-entry-body-controls">
                                    <select class="json-table-entry-encoding-select" data-target="res">
                                        <option value="raw" selected>Raw</option>
                                        <option value="url-utf8">UTF-8 URL Decode</option>
                                        <option value="url-eucjp">EUC-JP URL Decode</option>
                                        <option value="unicode">Unicode Decode</option>
                                    </select>
                                    <label class="json-table-entry-format-toggle" data-target="res">
                                        <input type="checkbox" />
                                        <span>Format JSON</span>
                                    </label>
                                </div>
                            </div>
                            <div class="json-table-entry-body-editor" data-editor="res"></div>
                        </div>
                    </div>
                </div>
                <div class="json-table-entry-footer">
                    <span class="json-table-entry-hint">Press Ctrl+F / Cmd+F for search</span>
                </div>
            </div>
        `;
        document.body.appendChild(this.entryModal);

        // Cache entry modal DOM elements
        this.entryEditorEl = this.entryModal.querySelector('.json-table-entry-main-editor');
        this.entryCloseBtn = this.entryModal.querySelector('.json-table-entry-close');

        // Cache panel elements, then query children from panel scope
        this.reqPanelEl = this.entryModal.querySelector('.json-table-entry-body-panel[data-panel="req"]');
        this.resPanelEl = this.entryModal.querySelector('.json-table-entry-body-panel[data-panel="res"]');

        this.reqBodyEditorEl = this.reqPanelEl.querySelector('.json-table-entry-body-editor');
        this.resBodyEditorEl = this.resPanelEl.querySelector('.json-table-entry-body-editor');
        this.reqExpandBtn = this.reqPanelEl.querySelector('.json-table-entry-expand-btn');
        this.resExpandBtn = this.resPanelEl.querySelector('.json-table-entry-expand-btn');
        this.reqEncodingSelect = this.reqPanelEl.querySelector('.json-table-entry-encoding-select');
        this.resEncodingSelect = this.resPanelEl.querySelector('.json-table-entry-encoding-select');
        this.reqFormatToggle = this.reqPanelEl.querySelector('.json-table-entry-format-toggle');
        this.resFormatToggle = this.resPanelEl.querySelector('.json-table-entry-format-toggle');
        this.reqFormatCheckbox = this.reqFormatToggle.querySelector('input');
        this.resFormatCheckbox = this.resFormatToggle.querySelector('input');
        this.copyCurlBtn = this.reqPanelEl.querySelector('.json-table-entry-copy-curl');

        // Body editor state
        this.bodyEditorState = {
            req: { decodeMode: 'raw', format: false, rawBody: null, decodedBody: null, isJson: false },
            res: { decodeMode: 'raw', format: false, rawBody: null, decodedBody: null, isJson: false }
        };

        this.entryCloseBtn.addEventListener('click', () => {
            this.closeEntryModal();
        });
        this.entryModal.addEventListener('click', (e) => {
            if (e.target === this.entryModal) {
                this.closeEntryModal();
            }
        });

        // Decode mode dropdown handlers
        [this.reqEncodingSelect, this.resEncodingSelect].forEach((select) => {
            select.addEventListener('change', (e) => {
                const target = e.target.dataset.target;
                this.bodyEditorState[target].decodeMode = e.target.value;
                this.updateBodyEditor(target);
            });
        });

        // Format toggle handlers
        [this.reqFormatCheckbox, this.resFormatCheckbox].forEach((checkbox) => {
            checkbox.addEventListener('change', (e) => {
                const target = e.target.closest('.json-table-entry-format-toggle').dataset.target;
                this.bodyEditorState[target].format = e.target.checked;
                this.updateBodyEditorContent(target);
            });
        });

        // Copy as cURL handler
        this.copyCurlBtn.addEventListener('click', async () => {
            const item = this._currentModalItem;
            if (!item) return;
            const reqBody = this.bodyEditorState.req.rawBody ?? '';
            const curlCmd = this.buildCurlCommand(item, reqBody);
            await window.electronAPI.copyToClipboard(curlCmd);
            const btn = this.copyCurlBtn;
            btn.classList.add('copied');
            clearTimeout(this._copyCurlTimer);
            this._copyCurlTimer = setTimeout(() => {
                btn.classList.remove('copied');
            }, 1000);
        });

        // Expand/collapse state: null = normal, 'req' or 'res' = that panel is expanded
        this.expandedPanel = null;

        // Expand button handlers
        [this.reqExpandBtn, this.resExpandBtn].forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = btn.dataset.target;
                if (this.expandedPanel === target) {
                    // Same button clicked again → restore
                    this.setExpandState(null);
                } else {
                    // Different panel or first expand → expand this panel
                    this.setExpandState(target);
                }
            });
            btn.nextElementSibling.addEventListener('dblclick', (e) => {
                btn.click();
            });
        });
    }

    setExpandState(panel) {
        this.expandedPanel = panel;

        if (!panel) {
            // Restore normal state
            this.entryEditorEl.classList.remove('shrunk');
            this.reqPanelEl.classList.remove('panel-expanded', 'panel-collapsed');
            this.resPanelEl.classList.remove('panel-expanded', 'panel-collapsed');
            this.reqExpandBtn.classList.remove('active');
            this.resExpandBtn.classList.remove('active');
        } else if (panel === 'req') {
            this.entryEditorEl.classList.add('shrunk');
            this.reqPanelEl.classList.add('panel-expanded');
            this.reqPanelEl.classList.remove('panel-collapsed');
            this.resPanelEl.classList.add('panel-collapsed');
            this.resPanelEl.classList.remove('panel-expanded');
            this.reqExpandBtn.classList.add('active');
            this.resExpandBtn.classList.remove('active');
        } else if (panel === 'res') {
            this.entryEditorEl.classList.add('shrunk');
            this.resPanelEl.classList.add('panel-expanded');
            this.resPanelEl.classList.remove('panel-collapsed');
            this.reqPanelEl.classList.add('panel-collapsed');
            this.reqPanelEl.classList.remove('panel-expanded');
            this.resExpandBtn.classList.add('active');
            this.reqExpandBtn.classList.remove('active');
        }

        // Resize all ace editors after transition
        setTimeout(() => {
            this.entryEditor?.resize();
            this.reqBodyEditor?.resize();
            this.resBodyEditor?.resize();
        }, 320);
    }

    isEntryModalOpen() {
        return this.entryModal?.classList.contains('visible');
    }

    openEntryModal(item) {
        if (!this.entryModal) return;
        this._currentModalItem = item;

        // Reset Copy as cURL button state
        if (this.copyCurlBtn) {
            clearTimeout(this._copyCurlTimer);
            this.copyCurlBtn.classList.remove('copied');
        }

        // Initialize main editor
        if (!this.entryEditor) {
            this.entryEditor = ace.edit(this.entryEditorEl, {
                wrap: true,
                theme: 'ace/theme/xcode',
                mode: 'ace/mode/json',
                readOnly: true,
                newLineMode: 'unix',
                useWorker: false
            });
            this.entryEditor.renderer.setShowGutter(true);
            this.entryEditor.setHighlightGutterLine(false);
        }

        // Initialize body editors
        if (!this.reqBodyEditor) {
            this.reqBodyEditor = ace.edit(this.reqBodyEditorEl, {
                wrap: true,
                theme: 'ace/theme/xcode',
                mode: 'ace/mode/json',
                readOnly: true,
                newLineMode: 'unix',
                useWorker: false
            });
            this.reqBodyEditor.renderer.setShowGutter(true);
            this.reqBodyEditor.setHighlightGutterLine(false);
        }

        if (!this.resBodyEditor) {
            this.resBodyEditor = ace.edit(this.resBodyEditorEl, {
                wrap: true,
                theme: 'ace/theme/xcode',
                mode: 'ace/mode/json',
                readOnly: true,
                newLineMode: 'unix',
                useWorker: false
            });
            this.resBodyEditor.renderer.setShowGutter(true);
            this.resBodyEditor.setHighlightGutterLine(false);
        }

        // Bind focus handlers for expand/collapse restore (only once)
        if (!this._expandFocusBound) {
            this._expandFocusBound = true;
            // When main editor gets focus, restore from any expansion
            this.entryEditor.on('focus', () => {
                if (this.expandedPanel) this.setExpandState(null);
            });
            // When req body editor gets focus while res is expanded, restore
            this.reqBodyEditor.on('focus', () => {
                if (this.expandedPanel === 'res') this.setExpandState(null);
            });
            // When res body editor gets focus while req is expanded, restore
            this.resBodyEditor.on('focus', () => {
                if (this.expandedPanel === 'req') this.setExpandState(null);
            });
        }

        // Prepare main JSON data (excluding internal keys and bodies)
        const modalItem = Object.entries(item).reduce((acc, [key, value]) => {
            if (!this.isInternalKey(key)) acc[key] = value;
            return acc;
        }, {});
        const jsonText = JSON.stringify(modalItem, null, 2);
        this.entryEditor.setValue(jsonText || '', -1);
        this.entryEditor.clearSelection();

        // Reset body editor state
        this.bodyEditorState.req = {
            decodeMode: 'raw',
            format: false,
            rawBody: null,
            decodedBody: null,
            isJson: false
        };
        this.bodyEditorState.res = {
            decodeMode: 'raw',
            format: false,
            rawBody: null,
            decodedBody: null,
            isJson: false
        };

        // Reset decode mode selects and format toggles
        this.reqEncodingSelect.value = 'raw';
        this.resEncodingSelect.value = 'raw';
        this.reqFormatCheckbox.checked = false;
        this.resFormatCheckbox.checked = false;

        // Show loading state for body editors
        this.reqBodyEditor.setValue('[Checkout-Proxy]Loading...', -1);
        this.reqBodyEditor.clearSelection();
        this.resBodyEditor.setValue('[Checkout-Proxy]Loading...', -1);
        this.resBodyEditor.clearSelection();

        // Disable format toggles initially
        this.setFormatToggleEnabled('req', false);
        this.setFormatToggleEnabled('res', false);

        // Reset expand state (no transitions yet, so it's instant)
        this.entryModal.classList.remove('transitions-enabled');
        this.setExpandState(null);

        // Force reflow so the browser registers opacity:0 as the "before" state,
        void this.entryModal.getBoundingClientRect();

        this.entryModal.classList.add('visible');

        // Enable transitions after modal is rendered
        this.entryModal.classList.add('transitions-enabled');

        // Fetch body data
        const entryId = item?.__ID__;
        const reqHasJson = this.hasJsonContentType(item?.reqHeaders);
        const resHasJson = this.hasJsonContentType(item?.resHeaders);
        if (entryId) {
            setTimeout(() => {
                window.electronAPI
                    .getEntryBody(entryId)
                    .then((bodies) => {
                        this.bodyEditorState.req.rawBody = bodies.reqBody;
                        this.bodyEditorState.res.rawBody = bodies.resBody;

                        // Check if bodies are JSON
                        this.bodyEditorState.req.isJson = this.isValidJson(bodies.reqBody);
                        this.bodyEditorState.res.isJson = this.isValidJson(bodies.resBody);

                        // Update format toggle states
                        this.setFormatToggleEnabled('req', this.bodyEditorState.req.isJson);
                        this.setFormatToggleEnabled('res', this.bodyEditorState.res.isJson);

                        // Auto-format if content-type contains json and body is valid JSON
                        if (reqHasJson && this.bodyEditorState.req.isJson) {
                            this.bodyEditorState.req.format = true;
                            this.reqFormatCheckbox.checked = true;
                        }
                        if (resHasJson && this.bodyEditorState.res.isJson) {
                            this.bodyEditorState.res.format = true;
                            this.resFormatCheckbox.checked = true;
                        }

                        // Display bodies
                        this.updateBodyEditorContent('req');
                        this.updateBodyEditorContent('res');
                    })
                    .catch((err) => {
                        console.error('[Checkout-Proxy]Failed to fetch body data:', err);
                        this.reqBodyEditor.setValue('[Checkout-Proxy]Error loading body...', -1);
                        this.reqBodyEditor.clearSelection();
                        this.resBodyEditor.setValue('[Checkout-Proxy]Error loading body...', -1);
                        this.resBodyEditor.clearSelection();
                    });
            });
        } else {
            // No body data available
            this.reqBodyEditor.setValue('[Checkout-Proxy]Failed to sync body data...', -1);
            this.reqBodyEditor.clearSelection();
            this.resBodyEditor.setValue('[Checkout-Proxy]Failed to sync body data...', -1);
            this.resBodyEditor.clearSelection();
        }

        this.entryModalKeydown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();

            // Get all editors
            const editors = [
                { editor: this.entryEditor },
                { editor: this.reqBodyEditor },
                { editor: this.resBodyEditor }
            ].filter((e) => e.editor?.container);

            const activeElement = document.activeElement;
            const hideSearchBox = [];
            // Check if any editor has focus (not search box)
            for (const { editor } of editors) {
                const editorEl = editor.container;
                if (!editorEl) continue;
                const searchBox = editorEl.querySelector('.ace_search');
                if (searchBox && searchBox.style.display !== 'none') {
                    if (searchBox.contains(activeElement) || editorEl.contains(activeElement)) {
                        editor.searchBox?.hide();
                        return; // If focus is in search box, just close search box and do not close modal
                    }
                    hideSearchBox.push(() => editor.searchBox?.hide());
                }
            }
            hideSearchBox.forEach((fn) => fn());
            this.closeEntryModal();
        };
        document.addEventListener('keydown', this.entryModalKeydown, true);
        this.entryEditor.focus();
    }

    hasJsonContentType(headers) {
        if (!headers) return false;
        let headerObj = headers;
        if (typeof headerObj !== 'object') return false;
        for (const [key, value] of Object.entries(headerObj)) {
            if (
                key.toLowerCase() === 'content-type' &&
                typeof value === 'string' &&
                value.toLowerCase().includes('json')
            ) {
                return true;
            }
        }
        return false;
    }

    isValidJson(str) {
        if (!str || typeof str !== 'string') return false;
        const trimmed = str.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
        try {
            JSON.parse(str);
            return true;
        } catch {
            return false;
        }
    }

    setFormatToggleEnabled(target, enabled) {
        const toggle = target === 'req' ? this.reqFormatToggle : this.resFormatToggle;
        const checkbox = target === 'req' ? this.reqFormatCheckbox : this.resFormatCheckbox;
        toggle.classList.toggle('disabled', !enabled);
        checkbox.disabled = !enabled;
        if (!enabled) {
            checkbox.checked = false;
            this.bodyEditorState[target].format = false;
        }
    }

    async updateBodyEditor(target) {
        const state = this.bodyEditorState[target];
        if (typeof state.rawBody === 'undefined' || state.rawBody === null) return;

        // Apply decode mode
        const decodeMode = state.decodeMode;

        if (decodeMode === 'raw') {
            state.decodedBody = state.rawBody;
        } else if (decodeMode === 'url-utf8') {
            // UTF-8 URL decode using decodeURIComponent
            try {
                state.decodedBody = decodeURIComponent(state.rawBody);
            } catch (e) {
                state.decodedBody = `[Checkout-Proxy]URL decode error: ${e.message}\n\n${state.rawBody}`;
            }
        } else if (decodeMode === 'url-eucjp' && window.electronAPI?.decodeUrlEucJp) {
            // EUC-JP URL decode using existing IPC handler
            try {
                state.decodedBody = await window.electronAPI.decodeUrlEucJp(state.rawBody);
            } catch (e) {
                state.decodedBody = `[Checkout-Proxy]EUC-JP decode error: ${e.message}]\n\n${state.rawBody}`;
            }
        } else if (decodeMode === 'unicode') {
            // Unicode escape decode: \uXXXX → actual characters
            try {
                state.decodedBody = state.rawBody.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
                    String.fromCharCode(parseInt(hex, 16))
                );
            } catch (e) {
                state.decodedBody = `[Checkout-Proxy]Unicode decode error: ${e.message}\n\n${state.rawBody}`;
            }
        } else {
            state.decodedBody = state.rawBody;
        }

        // Re-check if it's valid JSON after decoding
        state.isJson = this.isValidJson(state.decodedBody);
        this.setFormatToggleEnabled(target, state.isJson);

        this.updateBodyEditorContent(target);
    }

    updateBodyEditorContent(target) {
        const state = this.bodyEditorState[target];
        const editor = target === 'req' ? this.reqBodyEditor : this.resBodyEditor;
        if (!editor) return;

        // Use decodedBody if available (including ""), otherwise fall back to rawBody
        let content = state.decodedBody !== null && state.decodedBody !== undefined ? state.decodedBody : state.rawBody;

        if (typeof content === 'undefined' || content === null) {
            // null/undefined = unable to obtain body (error, not yet available, etc.)
            content = '[Checkout-Proxy]Unavailable...';
        } else if (content === '') {
            // empty string = body exists but is empty (Content-Length: 0)
            content = '';
        } else if (state.format && state.isJson) {
            try {
                const parsed = JSON.parse(content);
                content = JSON.stringify(parsed, null, 2);
            } catch {
                // Keep original
            }
        }

        editor.setValue(content, -1);
        editor.clearSelection();
    }

    buildCurlCommand(item, reqBody) {
        const method = (item.method || 'GET').toUpperCase();
        const host = item.host || '';
        const port = item.port != null ? String(item.port) : '';
        const path = item.path || '/';
        const protocol = item.protocol || '';
        const proxyUrl = USE_NO_AGENT.includes(item.proxyUrl) ? null : item.proxyUrl;
        const reqHeaders = { ...item.reqHeaders };

        // Determine URL scheme from protocol label or port
        const isHttps = /https/i.test(protocol) || port === '443';
        const scheme = isHttps ? 'https' : 'http';
        const defaultPort = isHttps ? '443' : '80';
        const portStr = port && port !== defaultPort ? `:${port}` : '';
        const url = `${scheme}://${host}${portStr}${path}`;

        // Shell-safe single-quote escape: replace ' with '\''
        const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

        const parts = ['curl'];

        parts.push('-i --insecure --compressed');

        if (method !== 'GET') {
            parts.push(`-X ${method}`);
        }

        parts.push(sq(url));
        stripHopByHopHeaders(reqHeaders);
        // Request headers (skip HTTP/2 pseudo-headers and host, already in URL)
        for (const [key, value] of Object.entries(reqHeaders)) {
            if (key.startsWith(':') || ['accept-encoding', 'content-length'].includes(key.toLowerCase())) continue;
            parts.push(`-H ${sq(`${key}: ${value}`)}`);
        }

        // Request body
        if (reqBody && reqBody.length > 0) {
            parts.push(`--data-raw ${sq(reqBody)}`);
        }

        // Upstream proxy
        if (proxyUrl) {
            parts.push(`--proxy ${sq(proxyUrl)}`);
        }

        return parts.join(' \\\n  ');
    }

    closeEntryModal() {
        if (!this.entryModal) return;
        [this.entryEditor, this.reqBodyEditor, this.resBodyEditor].forEach((editor) => editor?.searchBox?.hide());
        this.entryModal.classList.remove('visible');
        if (this.entryModalKeydown) {
            document.removeEventListener('keydown', this.entryModalKeydown, true);
            this.entryModalKeydown = null;
        }
    }

    attachRowEvents(tr, item) {
        tr.addEventListener('dblclick', (e) => {
            if (!e.target.closest('td')) return;
            this.openEntryModal(item);
        });
    }

    handleHeaderMouseDown(e) {
        const th = e.target.closest('th');
        if (!th) return;

        const resizer = e.target.closest('.json-table-resizer');
        if (resizer) {
            // Start column resize
            e.preventDefault();
            const column = th.dataset.column;
            const startX = e.clientX;
            const startWidth = th.offsetWidth;

            // Lock all column widths before resizing to prevent other columns from changing
            const allThs = Array.from(this.thead.querySelectorAll('th'));
            allThs.forEach((otherTh) => {
                const otherColumn = otherTh.dataset.column;
                if (otherColumn) {
                    const currentWidth = otherTh.offsetWidth;
                    otherTh.style.width = currentWidth + 'px';
                    this.settings.columnWidths[otherColumn] = currentWidth;
                }
            });

            this.resizeState = { column, startX, startWidth, th };
            document.documentElement.classList.add('json-table-col-resizing');
            return;
        }

        // Start column drag (with threshold - actual drag activates in handleMouseMove)
        if (th.dataset.column && th.dataset.column !== this.options.fixedFirstColumn) {
            e.preventDefault();
            this.dragState = {
                column: th.dataset.column,
                startX: e.clientX,
                th: th,
                originalIndex: Array.from(th.parentNode.children).indexOf(th),
                activated: false, // drag not visually activated until threshold met
                lastSwapTarget: null,
                lastMoveX: e.clientX // track direction for lastSwapTarget reset
            };
        }
    }

    handleMouseMove(e) {
        if (this.resizeState) {
            e.preventDefault();
            const diff = e.clientX - this.resizeState.startX;
            const newWidth = Math.max(50, this.resizeState.startWidth + diff);
            this.resizeState.th.style.width = newWidth + 'px';
            this.settings.columnWidths[this.resizeState.column] = newWidth;
            return;
        }

        if (this.dragState) {
            e.preventDefault();

            // Activate drag only after moving past threshold (5px)
            if (!this.dragState.activated) {
                if (Math.abs(e.clientX - this.dragState.startX) < 5) return;
                this.dragState.activated = true;
                this.dragState.th.classList.add('dragging');
            }

            // Detect direction change and reset lastSwapTarget so user can drag back
            const movingRight = e.clientX > this.dragState.lastMoveX;
            const movingLeft = e.clientX < this.dragState.lastMoveX;
            if (this.dragState.lastSwapTarget) {
                // If the user has changed direction, allow re-swapping with the previous target
                const dragRect = this.dragState.th.getBoundingClientRect();
                const dragCenter = dragRect.left + dragRect.width / 2;
                // Direction reversal check: cursor crossed back past the dragged column's own center
                if ((movingLeft && e.clientX < dragCenter) || (movingRight && e.clientX > dragCenter)) {
                    this.dragState.lastSwapTarget = null;
                }
            }
            this.dragState.lastMoveX = e.clientX;

            const ths = Array.from(this.thead.querySelectorAll('th'));
            const dragIndex = ths.indexOf(this.dragState.th);
            // Find target column based on mouse position relative to dragged column center
            let targetTh = null;
            let targetIndex = -1;

            for (let i = 0; i < ths.length; i++) {
                const th = ths[i];
                if (th === this.dragState.th) continue;
                if (th.dataset.column === this.options.fixedFirstColumn) continue;

                const rect = th.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;

                if (i < dragIndex) {
                    // Target is to the left: swap when mouse crosses left past target's center
                    if (e.clientX < centerX) {
                        targetTh = th;
                        targetIndex = i;
                        break; // Take the first (leftmost) match
                    }
                } else if (i > dragIndex) {
                    // Target is to the right: swap when mouse crosses right past target's center
                    if (e.clientX > centerX) {
                        targetTh = th;
                        targetIndex = i;
                        // Don't break - continue to find the rightmost match
                    }
                }
            }

            // Only swap if we found a valid target and it's different from last swap target
            if (targetTh && targetIndex !== dragIndex && this.dragState.lastSwapTarget !== targetTh.dataset.column) {
                // Swap columns
                const parent = this.dragState.th.parentNode;
                if (targetIndex < dragIndex) {
                    parent.insertBefore(this.dragState.th, targetTh);
                } else {
                    parent.insertBefore(this.dragState.th, targetTh.nextSibling);
                }

                // Track which column we swapped with to prevent immediate re-swap
                this.dragState.lastSwapTarget = targetTh.dataset.column;

                // Update column order
                this.updateColumnOrderFromDOM();
                this.renderTableBody();
            }
        }
    }

    handleMouseUp() {
        if (this.resizeState) {
            document.documentElement.classList.remove('json-table-col-resizing');
            this.notifySettingsChange();
            this.resizeState = null;
        }

        if (this.dragState) {
            this.dragState.th.classList.remove('dragging');
            this.notifySettingsChange();
            this.dragState = null;
        }
    }

    updateColumnOrderFromDOM() {
        const ths = Array.from(this.thead.querySelectorAll('th'));
        this.settings.columnOrder = ths.map((th) => th.dataset.column).filter(Boolean);
    }

    setFilter(filterText) {
        this.settings.lastFilter = filterText;

        if (!filterText || !filterText.trim()) {
            this.filterAst = null;
            this.setFilterValidity(true);
            this.rebuildFilteredMap();
        } else {
            const { ast, isValid } = parseFilterInfo(filterText);
            this.filterAst = ast;
            this.setFilterValidity(isValid);
            this.rebuildFilteredMap();
        }

        this.renderTableBody();
        this.updateRecordCount();
        this.notifySettingsChange();
    }

    matchesFilter(item) {
        if (!this.filterAst) return true;
        return evaluateFilter(this.filterAst, item);
    }

    setFilterValidity(isValid) {
        if (!this.filterInput) return;
        this.filterInput.classList.toggle('invalid', !isValid);
    }

    trackKeys(item) {
        let changed = false;
        Object.keys(item).forEach((key) => {
            if (this.isInternalKey(key)) return;
            if (!this.allKeys.has(key)) {
                this.allKeys.add(key);
                if (!this.settings.columnOrder.includes(key)) {
                    this.settings.columnOrder.push(key);
                }
                if (!this.hasExplicitVisibleColumns && !this.settings.visibleColumns.includes(key)) {
                    this.settings.visibleColumns.push(key);
                }
                changed = true;
            }
        });
        return changed;
    }

    scrollToBottom() {
        if (this._autoScrollRaf) cancelAnimationFrame(this._autoScrollRaf);
        this._autoScrollRaf = requestAnimationFrame(() => {
            this.tableContainer.scrollTop = this.tableContainer.scrollHeight;
            this._autoScrollRaf = null;
        });
    }

    appendData(jsonObject) {
        // Add timestamp if not present
        if (!jsonObject[this.options.fixedFirstColumn]) {
            jsonObject[this.options.fixedFirstColumn] = '';
        }

        // Track all keys
        if (this.trackKeys(jsonObject)) {
            this.updateColumnsMenu();
            this.renderTableHeader();
        }

        let entryId = jsonObject?.__ID__;
        if (typeof entryId === 'undefined' || entryId === null) {
            entryId = crypto.randomUUID();
            jsonObject.__ID__ = entryId;
        }

        const matchesFilter = !this.filterAst || this.matchesFilter(jsonObject);
        if (matchesFilter) this.filteredMap.set(entryId, jsonObject);
        this.dataMap.set(entryId, jsonObject);

        if (this.dataMap.size % 2 === 0) {
            while (this.dataMap.size > this.options.maxRows) {
                const oldestKey = this.dataMap.keys().next().value;
                this.dataMap.delete(oldestKey);
                this.filteredMap.delete(oldestKey);
            }
        }

        if (matchesFilter) this.appendRow(jsonObject);

        this.updateRecordCount();

        // debounced per animation frame
        if (this.settings.autoScroll) {
            this.scrollToBottom();
        }
    }

    disableAutoScroll() {
        this.statusBar.querySelector('.json-table-autoscroll-toggle')?.classList.add('disabled');
    }

    enableAutoScroll() {
        this.statusBar.querySelector('.json-table-autoscroll-toggle')?.classList.remove('disabled');
    }

    prependData(incomingMap) {
        const entriesMap = incomingMap instanceof Map ? incomingMap : new Map(incomingMap || []);
        if (entriesMap.size === 0) {
            return;
        }

        const nextDataMap = new Map();
        const nextFilteredMap = new Map();
        let keysChanged = false;
        const dataRoom = this.options.maxRows - this.dataMap.size;
        const filteredRoom = this.options.maxRows - this.filteredMap.size;
        let filteredAdded = 0;

        if (dataRoom <= 0) {
            return;
        }

        const entries = Array.from(entriesMap.entries());
        const toAdd = entries.slice(-dataRoom);

        for (const [id, item] of toAdd) {
            if (!item[this.options.fixedFirstColumn]) {
                item[this.options.fixedFirstColumn] = '';
            }
            keysChanged = this.trackKeys(item) || keysChanged;
            nextDataMap.set(id, item);
            if (!this.filterAst || this.matchesFilter(item)) {
                if (filteredRoom > 0 && filteredAdded < filteredRoom) {
                    nextFilteredMap.set(id, item);
                    filteredAdded += 1;
                }
            }
        }

        for (const [id, item] of this.dataMap) {
            if (nextDataMap.has(id)) continue;
            nextDataMap.set(id, item);
        }

        for (const [id, item] of this.filteredMap) {
            if (nextFilteredMap.has(id)) continue;
            nextFilteredMap.set(id, item);
        }

        this.dataMap = nextDataMap;
        this.filteredMap = nextFilteredMap;

        if (keysChanged) {
            this.updateColumnsMenu();
            this.renderTableHeader();
        }

        this.renderTableBody();
        this.updateRecordCount();
        this.notifyTableChange();

        this.scrollToBottom();
    }

    updateDataById(id, updates = {}) {
        if (typeof id === 'undefined' || id === null) return false;
        const target = this.dataMap.get(id);
        if (!target) return false;

        const sanitizedUpdates = { ...updates };

        Object.assign(target, sanitizedUpdates);

        if (this.trackKeys(sanitizedUpdates)) {
            this.updateColumnsMenu();
            this.renderTableHeader();
        }

        const matches = !this.filterAst || this.matchesFilter(target);
        const inFiltered = this.filteredMap.has(id);

        if (matches && !inFiltered) {
            // Entry now matches filter but wasn't in filteredMap — add it and rebuild DOM
            this.rebuildFilteredMap();
            this.renderTableBody();
            this.updateRecordCount();
            return true;
        } else if (!matches && inFiltered) {
            // Entry no longer matches filter — remove it and rebuild DOM
            this.rebuildFilteredMap();
            this.renderTableBody();
            this.updateRecordCount();
            return true;
        } else if (!this.filterAst) {
            this.filteredMap.set(id, target);
        }

        // Update existing DOM row in-place if it exists; skip if row was evicted from DOM
        const row = this.idToRow.get(String(id));
        if (!row) {
            return true;
        }

        const visibleOrderedColumns = this.settings.columnOrder.filter(
            (c) => this.settings.visibleColumns.includes(c) && this.allKeys.has(c) && !this.isInternalKey(c)
        );
        if (
            !visibleOrderedColumns.includes(this.options.fixedFirstColumn) &&
            this.allKeys.has(this.options.fixedFirstColumn)
        ) {
            visibleOrderedColumns.unshift(this.options.fixedFirstColumn);
        }

        visibleOrderedColumns.forEach((column) => {
            const cell = row.querySelector(`td[data-column="${column}"]`);
            if (!cell) return;
            const isWrapped = this.settings.wrapAll || this.settings.wrapColumns.includes(column);
            const value = target[column];
            const displayValue = this.formatValueForDisplay(column, value, isWrapped);
            cell.textContent = displayValue;
            cell.title = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
            cell.classList.toggle('wrap', !!isWrapped);
        });

        this.updateRecordCount();
        return true;
    }

    hasEntry(id) {
        return this.dataMap.has(id);
    }

    clearData() {
        this.dataMap.clear();
        this.filteredMap.clear();
        this.idToRow.clear();
        this.tbody.innerHTML = '';
        this.updateRecordCount();
    }

    getSettings() {
        return { ...this.settings };
    }

    updateRecordCount() {
        const countEl = this.statusBar.querySelector('.json-table-record-count');
        if (countEl) {
            countEl.textContent = `Showing ${this.tbody.children.length} of ${this.dataMap.size}`;
        }
    }

    getWrapIconSvg(isActive) {
        const color = isActive ? '#3498db' : '#999';
        return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="${color}" width="14" height="14"><path d="M1 4h11a4 4 0 010 8H9.414l.293.293a1 1 0 11-1.414 1.414L5.586 11l2.707-2.707a1 1 0 011.414 1.414L9.414 10H12a2 2 0 100-4H1a1 1 0 010-2z" fill="${color}"></path><path d="M0 11a1 1 0 011-1h3a1 1 0 110 2H1a1 1 0 01-1-1z" fill="${color}"></path></svg>`;
    }

    updateColumnsMenu() {
        const menu = this.toolbar.querySelector('.json-table-columns-menu');
        menu.innerHTML = '';

        // Get ordered columns
        const orderedColumns = [...this.settings.columnOrder].filter((c) => this.allKeys.has(c));

        // Add any missing columns
        this.allKeys.forEach((key) => {
            if (!orderedColumns.includes(key)) {
                orderedColumns.push(key);
            }
        });

        orderedColumns.forEach((key) => {
            const item = document.createElement('div');
            item.className = 'json-table-column-item';
            const isFixed = key === this.options.fixedFirstColumn;
            const isChecked = this.settings.visibleColumns.includes(key);
            const isWrapped = this.settings.wrapAll || this.settings.wrapColumns.includes(key);

            item.innerHTML = `
                <input type="checkbox" class="col-visible" value="${this.escapeHtml(key)}" ${isChecked ? 'checked' : ''} ${isFixed ? 'disabled' : ''} title="Show column">
                <span class="col-name">${this.escapeHtml(key)}</span>
                <span class="col-wrap-icon" title="Wrap column">${this.getWrapIconSvg(isWrapped)}</span>
            `;

            // Visibility checkbox
            const visibleCheckbox = item.querySelector('.col-visible');
            if (!isFixed) {
                visibleCheckbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        if (!this.settings.visibleColumns.includes(key)) {
                            this.settings.visibleColumns.push(key);
                        }
                    } else {
                        this.settings.visibleColumns = this.settings.visibleColumns.filter((c) => c !== key);
                    }
                    this.renderTable();
                    this.notifySettingsChange();
                });
            }

            item.addEventListener('click', (e) => {
                if (isFixed || e.target.closest('.col-wrap-icon') || e.target.closest('.col-visible')) return;
                visibleCheckbox?.click();
            });

            // Wrap icon click
            const wrapIcon = item.querySelector('.col-wrap-icon');
            wrapIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                const currentlyWrapped = this.settings.wrapColumns.includes(key);
                if (currentlyWrapped) {
                    this.settings.wrapColumns = this.settings.wrapColumns.filter((c) => c !== key);
                } else {
                    this.settings.wrapColumns.push(key);
                }
                // Update icon color
                wrapIcon.innerHTML = this.getWrapIconSvg(!currentlyWrapped);
                // Update Wrap All checkbox state
                this.syncWrapAllState();
                this.renderTableBody();
                this.notifySettingsChange();
            });

            wrapIcon.addEventListener('mousedown', (event) => {
                event.stopPropagation();
            });

            menu.appendChild(item);
        });
    }

    syncWrapAllState() {
        // Check if all visible columns are wrapped
        const visibleColumns = this.settings.columnOrder.filter(
            (c) => this.settings.visibleColumns.includes(c) && this.allKeys.has(c) && !this.isInternalKey(c)
        );
        const allWrapped =
            visibleColumns.length > 0 && visibleColumns.every((col) => this.settings.wrapColumns.includes(col));

        // Update Wrap All checkbox
        const wrapAllCheckbox = this.toolbar.querySelector('.json-table-wrap-toggle input');
        if (wrapAllCheckbox) {
            wrapAllCheckbox.checked = allWrapped;
            this.settings.wrapAll = allWrapped;
        }
    }

    renderTable() {
        this.renderTableHeader();
        this.renderTableBody();
    }

    renderTableHeader() {
        this.thead.innerHTML = '';
        const tr = document.createElement('tr');

        // Get visible columns in order
        const visibleOrderedColumns = this.settings.columnOrder.filter(
            (c) => this.settings.visibleColumns.includes(c) && this.allKeys.has(c) && !this.isInternalKey(c)
        );

        // Ensure fixed column is first
        if (
            !visibleOrderedColumns.includes(this.options.fixedFirstColumn) &&
            this.allKeys.has(this.options.fixedFirstColumn)
        ) {
            visibleOrderedColumns.unshift(this.options.fixedFirstColumn);
        }

        visibleOrderedColumns.forEach((column) => {
            const th = document.createElement('th');
            th.dataset.column = column;
            th.textContent = column;

            const width = this.settings.columnWidths[column];
            // Only set explicit width if it's a number (not 'auto')
            if (width && typeof width === 'number') {
                th.style.width = width + 'px';
            }
            // 'auto' or undefined: let browser determine minimum width

            // Add resizer
            const resizer = document.createElement('div');
            resizer.className = 'json-table-resizer';
            th.appendChild(resizer);

            tr.appendChild(th);
        });

        this.thead.appendChild(tr);
        this.notifyTableChange();
    }

    formatValueForDisplay(column, value, isWrapped) {
        if (typeof value === 'undefined' || value === null) {
            return '';
        }

        // For header columns, format as pretty JSON when wrapped
        const headerColumns = ['reqHeaders', 'resHeaders', 'resTrailer', 'headers'];
        if (headerColumns.includes(column) && isWrapped) {
            if (typeof value === 'string') {
                try {
                    const parsed = JSON.parse(value);
                    return JSON.stringify(parsed, null, 2);
                } catch (e) {
                    return value;
                }
            } else if (typeof value === 'object') {
                return JSON.stringify(value, null, 2);
            }
        }

        if (typeof value === 'object') {
            return isWrapped ? JSON.stringify(value, null, 2) : JSON.stringify(value);
        }

        return String(value);
    }

    addFilterHistory(value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return;
        const existingIndex = this.settings.filterHistory.findIndex((v) => v === trimmed);
        if (existingIndex !== -1) {
            this.settings.filterHistory.splice(existingIndex, 1);
        }
        this.settings.filterHistory.unshift(trimmed);
        this.settings.filterHistory = this.settings.filterHistory.slice(0, 10);
        this.notifySettingsChange();
    }

    renderFilterHistory() {
        const historyMenu = this.toolbar.querySelector('.json-table-filter-history-menu');
        historyMenu.innerHTML = '';
        if (!this.settings.filterHistory.length) {
            const empty = document.createElement('div');
            empty.className = 'json-table-filter-history-item';
            empty.textContent = 'No history';
            historyMenu.appendChild(empty);
            return;
        }
        this.settings.filterHistory.forEach((value) => {
            const item = document.createElement('div');
            item.className = 'json-table-filter-history-item';
            item.dataset.value = value;
            item.textContent = value;
            historyMenu.appendChild(item);
        });
    }

    renderTableBody() {
        this.tbody.innerHTML = '';
        this.idToRow.clear();

        const visibleOrderedColumns = this.settings.columnOrder.filter(
            (c) => this.settings.visibleColumns.includes(c) && this.allKeys.has(c) && !this.isInternalKey(c)
        );

        if (
            !visibleOrderedColumns.includes(this.options.fixedFirstColumn) &&
            this.allKeys.has(this.options.fixedFirstColumn)
        ) {
            visibleOrderedColumns.unshift(this.options.fixedFirstColumn);
        }

        for (const item of this.filteredMap.values()) {
            const tr = document.createElement('tr');
            if (item?.__ID__ !== undefined && item?.__ID__ !== null) {
                tr.dataset.rowId = String(item.__ID__);
                this.idToRow.set(String(item.__ID__), tr);
            }
            if (item?.__ID__ !== undefined && item?.__ID__ !== null) {
                tr.dataset.rowId = String(item.__ID__);
            }

            visibleOrderedColumns.forEach((column) => {
                const td = document.createElement('td');
                td.dataset.column = column;

                const isWrapped = this.settings.wrapAll || this.settings.wrapColumns.includes(column);
                const value = item[column];
                const displayValue = this.formatValueForDisplay(column, value, isWrapped);
                td.textContent = displayValue;
                td.title = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');

                // Apply wrap
                if (isWrapped) {
                    td.classList.add('wrap');
                }

                tr.appendChild(td);
            });

            this.attachRowEvents(tr, item);
            this.tbody.appendChild(tr);
        }
        this.notifyTableChange();
    }

    appendRow(item) {
        const visibleOrderedColumns = this.settings.columnOrder.filter(
            (c) => this.settings.visibleColumns.includes(c) && this.allKeys.has(c) && !this.isInternalKey(c)
        );

        if (
            !visibleOrderedColumns.includes(this.options.fixedFirstColumn) &&
            this.allKeys.has(this.options.fixedFirstColumn)
        ) {
            visibleOrderedColumns.unshift(this.options.fixedFirstColumn);
        }

        const tr = document.createElement('tr');
        if (item?.__ID__ !== undefined && item?.__ID__ !== null) {
            tr.dataset.rowId = String(item.__ID__);
            this.idToRow.set(String(item.__ID__), tr);
        }
        if (item?.__ID__ !== undefined && item?.__ID__ !== null) {
            tr.dataset.rowId = String(item.__ID__);
        }

        visibleOrderedColumns.forEach((column) => {
            const td = document.createElement('td');
            td.dataset.column = column;

            const isWrapped = this.settings.wrapAll || this.settings.wrapColumns.includes(column);
            const value = item[column];
            const displayValue = this.formatValueForDisplay(column, value, isWrapped);
            td.textContent = displayValue;
            td.title = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');

            if (isWrapped) {
                td.classList.add('wrap');
            }

            tr.appendChild(td);
        });

        this.attachRowEvents(tr, item);
        this.tbody.appendChild(tr);
        this.notifyTableChange();
        // Remove old rows if exceeding max and prevent flick of background color
        if (this.tbody.children.length % 2 === 0) {
            while (this.tbody.children.length > this.options.maxRows) {
                const removedRow = this.tbody.firstChild;
                const removedId = removedRow?.dataset?.rowId;
                if (typeof removedId !== 'undefined') {
                    this.idToRow.delete(String(removedId));
                }
                this.tbody.removeChild(removedRow);
            }
        }
    }

    notifySettingsChange() {
        this.options.onSettingsChange(this.getSettings());
    }

    notifyTableChange() {
        if (typeof this.options.onTableChange === 'function') {
            this.options.onTableChange();
        }
    }

    destroy() {
        this.container.innerHTML = '';
        this.dataMap.clear();
        this.allKeys.clear();
        this.filteredMap.clear();
        this.idToRow.clear();
    }
}
