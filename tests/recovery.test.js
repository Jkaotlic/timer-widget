'use strict';

/**
 * Crash-recovery validation tests.
 *
 * Exercises the pure isRecoveryValid() helper exported from electron-main.js.
 * That helper decides whether a saved last-state.json is worth restoring,
 * without any Electron APIs — so we can import it in plain node --test.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// electron-main.js requires 'electron'. We stub it minimally so the require
// doesn't crash in node --test (no actual Electron runtime here).
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
    if (request === 'electron') { return require.resolve('./stubs/electron-stub.js'); }
    if (request === 'electron-log/main') { return require.resolve('./stubs/electron-log-stub.js'); }
    return originalResolve.call(this, request, parent, ...rest);
};

// Create stub files on demand
const fs = require('node:fs');
const path = require('node:path');
const stubDir = path.join(__dirname, 'stubs');
if (!fs.existsSync(stubDir)) { fs.mkdirSync(stubDir); }

const electronStub = `
'use strict';
const noop = () => {};
const chainable = new Proxy(function() {}, {
    get: () => chainable,
    apply: () => chainable
});
module.exports = {
    app: {
        getVersion: () => '0.0.0-test',
        getPath: () => require('os').tmpdir(),
        whenReady: () => Promise.resolve(),
        on: noop,
        setLoginItemSettings: noop,
        getLoginItemSettings: () => ({ openAtLogin: false }),
        quit: noop,
        setAsDefaultProtocolClient: noop
    },
    BrowserWindow: class {
        constructor() { this.webContents = { on: noop, once: noop, setWindowOpenHandler: noop, setZoomFactor: noop, setZoomLevel: noop, setVisualZoomLevelLimits: noop }; }
        loadFile() { return { catch: noop }; }
        on() {} once() {} isDestroyed() { return false; } getPosition() { return [0, 0]; } setPosition() {} setSize() {} setOpacity() {} setBounds() {} show() {} hide() {} focus() {} close() {} isVisible() { return false; } setAlwaysOnTop() {} setIgnoreMouseEvents() {}
        static getAllWindows() { return []; }
    },
    ipcMain: { on: noop, handle: noop, removeHandler: noop },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), getAllDisplays: () => [], on: noop },
    Menu: { setApplicationMenu: noop, buildFromTemplate: () => ({}) },
    Tray: class { constructor() {} setToolTip() {} setContextMenu() {} on() {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }), createEmpty: () => ({}) },
    dialog: { showSaveDialog: () => Promise.resolve({ canceled: true }) },
    session: { defaultSession: { clearStorageData: () => Promise.resolve(), clearCache: () => Promise.resolve() } }
};
`;
if (!fs.existsSync(path.join(stubDir, 'electron-stub.js'))) {
    fs.writeFileSync(path.join(stubDir, 'electron-stub.js'), electronStub);
}

const logStub = `
'use strict';
const noop = () => {};
module.exports = {
    initialize: noop,
    info: noop, warn: noop, error: noop, debug: noop,
    transports: {
        file: { level: 'info', maxSize: 0, format: '', getFile: () => ({ path: '/tmp/x.log' }) },
        console: { level: 'info' }
    }
};
`;
if (!fs.existsSync(path.join(stubDir, 'electron-log-stub.js'))) {
    fs.writeFileSync(path.join(stubDir, 'electron-log-stub.js'), logStub);
}

const main = require('../electron-main.js');
const { isRecoveryValid } = main;

const NOW = 1_700_000_000_000;

test('isRecoveryValid: null / undefined / non-object → false', () => {
    assert.equal(isRecoveryValid(null, NOW), false);
    assert.equal(isRecoveryValid(undefined, NOW), false);
    assert.equal(isRecoveryValid('string', NOW), false);
    assert.equal(isRecoveryValid(42, NOW), false);
});

test('isRecoveryValid: missing savedAt → false', () => {
    assert.equal(isRecoveryValid({ presetSeconds: 300 }, NOW), false);
});

test('isRecoveryValid: savedAt in the future → false', () => {
    const data = { savedAt: NOW + 10_000, presetSeconds: 300 };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: savedAt older than 5 minutes → false', () => {
    const data = { savedAt: NOW - 6 * 60 * 1000, presetSeconds: 300 };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: savedAt exactly 5 minutes → false (strictly older than)', () => {
    const data = { savedAt: NOW - 5 * 60 * 1000 - 1, presetSeconds: 300 };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: fresh savedAt + valid preset → true', () => {
    const data = { savedAt: NOW - 30_000, presetSeconds: 300 };
    assert.equal(isRecoveryValid(data, NOW), true);
});

test('isRecoveryValid: negative presetSeconds → false', () => {
    const data = { savedAt: NOW - 10_000, presetSeconds: -1 };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: non-number presetSeconds → false', () => {
    const data = { savedAt: NOW - 10_000, presetSeconds: 'oops' };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: presetSeconds=0 accepted (valid edge)', () => {
    const data = { savedAt: NOW - 10_000, presetSeconds: 0 };
    assert.equal(isRecoveryValid(data, NOW), true);
});

test('isRecoveryValid: uses Date.now() when now arg omitted', () => {
    const data = { savedAt: Date.now() - 1000, presetSeconds: 60 };
    assert.equal(isRecoveryValid(data), true);
});
