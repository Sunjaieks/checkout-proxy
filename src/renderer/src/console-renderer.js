// Console Renderer - Request logging console using JsonTableComponent
import { JsonTableComponent } from './components/json-table.js';
import { FindBarComponent } from './components/find-bar.js';
import { CONSOLE_ROW_SIZE, CONSOLE_WINDOW_NAME, STORE_DEFAULTS } from '../../constant/constant';

const container = document.getElementById('json-table-container');
const closeBtn = document.getElementById('close-btn');
const clearBtn = document.getElementById('clear-btn');

let jsonTable = null;
let findBar = null;

async function init() {
    // Load saved settings
    let initialSettings = {};
    try {
        initialSettings = (await window.electronAPI?.getConsoleSettings?.()) || {};
    } catch (e) {
        console.error('Failed to load console settings:', e);
    }

    // Default column order and widths
    const defaultColumnOrder = STORE_DEFAULTS.requestConsole.columnOrder;
    const defaultColumnWidths = STORE_DEFAULTS.requestConsole.columnWidths;
    const defaultVisibleColumns = STORE_DEFAULTS.requestConsole.visibleColumns;
    // Default wrap columns: all except headers
    const defaultWrapColumns = STORE_DEFAULTS.requestConsole.wrapColumns;

    // Initialize the JSON table component
    jsonTable = new JsonTableComponent(container, {
        initialSettings: {
            visibleColumns: initialSettings.visibleColumns || defaultVisibleColumns,
            columnWidths: initialSettings.columnWidths || defaultColumnWidths,
            columnOrder: initialSettings.columnOrder || defaultColumnOrder,
            wrapColumns: initialSettings.wrapColumns || defaultWrapColumns,
            wrapAll: initialSettings.wrapAll || false,
            autoScroll: initialSettings.autoScroll !== false,
            lastFilter: initialSettings.lastFilter || '',
            filterHistory: initialSettings.filterHistory || []
        },
        maxRows: CONSOLE_ROW_SIZE,
        fixedFirstColumn: 'timestamp',
        onSettingsChange: (settings) => {
            // Save settings when they change
            try {
                window.electronAPI?.saveConsoleSettings?.(settings);
            } catch (e) {
                console.error('Failed to save console settings:', e);
            }
        },
        onTableChange: () => {
            findBar?.invalidate?.();
        }
    });

    jsonTable.disableAutoScroll();

    window.electronAPI?.onConsoleRequestLog((logEntry) => {
        if (!jsonTable || !logEntry) return;
        const entryId = logEntry.__ID__;
        if (!entryId) return;

        if (jsonTable.hasEntry(entryId)) {
            jsonTable.updateDataById(entryId, logEntry);
            return;
        }
        if (!logEntry.timestamp) return;
        jsonTable.appendData(logEntry);
    });

    window.electronAPI?.onConsoleRequestAllLogs((logs) => {
        if (logs?.length && jsonTable) {
            jsonTable.prependData(new Map(logs));
        }
        jsonTable.enableAutoScroll();
    });

    findBar = new FindBarComponent({
        searchRoot: container,
        matchSelector: '.json-table td',
        placeholder: 'Find in page...',
        accentColor: '#e67e22'
    });
}

// Close button handler
closeBtn.addEventListener('click', () => {
    window.electronAPI?.closeWindow?.(CONSOLE_WINDOW_NAME);
});

// Clear button handler
clearBtn.addEventListener('click', () => {
    if (jsonTable) {
        jsonTable.clearData();
    }
    // Also clear the log buffer in main process
    window.electronAPI?.clearConsoleLogs?.();
});

// Console info modal handlers
const consoleInfoBtn = document.getElementById('console-info-btn');
const consoleInfoModal = document.getElementById('console-info-modal');
const consoleInfoClose = document.getElementById('console-info-close');

consoleInfoBtn.addEventListener('click', () => {
    consoleInfoModal.classList.add('visible');
});

consoleInfoClose.addEventListener('click', () => {
    consoleInfoModal.classList.remove('visible');
});

consoleInfoModal.addEventListener('click', (e) => {
    if (e.target === consoleInfoModal) {
        consoleInfoModal.classList.remove('visible');
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        clearBtn?.click();
        return;
    }
    if (jsonTable?.isEntryModalOpen()) return;
    if (jsonTable.escapeCallback(event)) return;
    if (event.key === 'Escape') {
        // Close info modal first if visible
        if (consoleInfoModal.classList.contains('visible')) {
            consoleInfoModal.classList.remove('visible');
            return;
        }
        if (findBar && findBar.isVisible()) {
            findBar.close();
        } else {
            window.electronAPI?.closeWindow?.(CONSOLE_WINDOW_NAME);
        }
    }
    // Ctrl+F / Cmd+F to open find bar
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        findBar?.open();
    }
});

// Initialize
init();
