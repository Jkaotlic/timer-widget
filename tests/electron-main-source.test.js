'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(repoRoot, 'electron-main.js'), 'utf8');

test('IPC handlers do not destructure renderer payloads in parameters', () => {
    const unsafeHandlers = [
        'display-move',
        'clock-widget-resize',
        'clock-widget-move',
        'widget-set-position',
        'widget-resize',
        'widget-move'
    ];

    for (const channel of unsafeHandlers) {
        const handlerPattern = new RegExp(
            `ipcMain\\.on\\('${channel}',\\s*\\([^)]*\\{[^)]*\\}[^)]*\\)\\s*=>`
        );
        assert.equal(
            handlerPattern.test(source),
            false,
            `${channel} must validate payload object before reading fields`
        );
    }
});

test('BrowserWindow DevTools are enabled only in unpackaged --dev runs', () => {
    const devToolsMatches = source.match(/devTools:\s*process\.argv\.includes\('--dev'\)\s*&&\s*!app\.isPackaged/g) || [];

    assert.equal(
        devToolsMatches.length,
        4,
        'all BrowserWindow instances should keep DevTools disabled in packaged releases'
    );
});

test('control window uses packaged PNG app icon', () => {
    assert.equal(source.includes("path.join(__dirname, 'icon.ico')"), false);
    assert.equal(source.includes("path.join(__dirname, 'build', 'icon.png')"), true);
});

test('app icon resolves from process.resourcesPath when packaged (not inside asar)', () => {
    // build/icon.png is buildResources, NOT packed into app.asar — the packaged
    // build ships it via extraResources, so the runtime path must branch on
    // app.isPackaged and read process.resourcesPath. Using __dirname there would
    // point inside the asar where the file doesn't exist (blank tray icon).
    assert.match(source, /app\.isPackaged/);
    assert.match(source, /process\.resourcesPath/);
    // Both the window icon and the tray icon go through the shared helper.
    const helperUses = source.match(/getAppIconPath\(\)/g) || [];
    assert.ok(helperUses.length >= 2, 'window icon and tray icon should both use getAppIconPath()');
});

test('control window uses a transparent native surface for rounded corners', () => {
    assert.match(source, /transparent:\s*!__screenshotMode/);
    assert.match(source, /backgroundColor:\s*__screenshotMode\s*\?\s*'#000000'\s*:\s*'#00000000'/);
    assert.match(source, /hasShadow:\s*false/);
});
