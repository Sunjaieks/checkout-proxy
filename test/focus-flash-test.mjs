import { app, BrowserWindow } from 'electron';

let win = null;

function simulateEditClick(label) {
    if (win) {
        console.log(`[${label}] window already exists. isVisible() before focus():`, win.isVisible());
        win.focus();
        console.log(`[${label}] isVisible() AFTER focus():`, win.isVisible());
        return;
    }
    console.log(`[${label}] creating new hidden window`);
    win = new BrowserWindow({ show: false, width: 400, height: 300 });
    win.on('ready-to-show', () => console.log('>>> ready-to-show EVENT FIRED <<<'));
    win.webContents.on('did-finish-load', () => console.log('>>> did-finish-load fired <<<'));
    win.loadURL('data:text/html,<h1>hi</h1>');
    win.once('ready-to-show', () => {
        console.log('[ready-to-show once-handler] isVisible() before show():', win.isVisible());
        win.show();
        console.log('[ready-to-show once-handler] isVisible() after show():', win.isVisible());
    });
    win.on('closed', () => (win = null));
    console.log(`[${label}] isVisible() right after construction:`, win.isVisible());
}

app.whenReady().then(() => {
    simulateEditClick('click-1'); // creates the hidden window
    simulateEditClick('click-2'); // rapid second click, BEFORE ready-to-show has fired
    simulateEditClick('click-3'); // a third, for good measure

    setTimeout(() => {
        console.log('[+3000ms settle] isVisible():', win?.isVisible());
        app.quit();
    }, 3000);
});

app.on('window-all-closed', () => console.log('window-all-closed fired'));
