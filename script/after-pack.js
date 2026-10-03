#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

/**
 * electron-builder afterPack hook.
 * Removes all Chromium locale files except English to reduce installer size.
 *
 * Windows/Linux: locales/<lang>.pak  (kept: en-US.pak)
 * macOS:         <App>/Contents/Frameworks/Electron Framework.framework/
 *                Versions/A/Resources/<lang>.lproj/  (kept: en.lproj)
 */
exports.default = async function afterPack({ appOutDir, electronPlatformName, packager }) {
    const productName = packager.appInfo.productName;

    if (electronPlatformName === 'darwin') {
        const resourcesDir = path.join(
            appOutDir,
            `${productName}.app`,
            'Contents',
            'Frameworks',
            'Electron Framework.framework',
            'Versions',
            'A',
            'Resources'
        );
        if (!fs.existsSync(resourcesDir)) {
            console.log('[after-pack] macOS Resources dir not found:', resourcesDir);
            return;
        }
        const keep = new Set(['en.lproj']);
        const entries = fs.readdirSync(resourcesDir).filter((f) => f.endsWith('.lproj'));
        let removed = 0;
        for (const entry of entries) {
            if (!keep.has(entry)) {
                fs.rmSync(path.join(resourcesDir, entry), { recursive: true });
                removed++;
            }
        }
        console.log(`[after-pack] darwin: removed ${removed} .lproj(s), kept ${keep.size}`);
    } else {
        const localesDir = path.join(appOutDir, 'locales');
        if (!fs.existsSync(localesDir)) {
            console.log('[after-pack] locales dir not found:', localesDir);
            return;
        }
        const keep = new Set(['en-US.pak']);
        const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.pak'));
        let removed = 0;
        for (const file of files) {
            if (!keep.has(file)) {
                fs.rmSync(path.join(localesDir, file));
                removed++;
            }
        }
        console.log(`[after-pack] ${electronPlatformName}: removed ${removed} locale(s), kept ${keep.size}`);
    }
};
