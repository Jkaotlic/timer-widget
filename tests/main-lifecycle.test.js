'use strict';

/**
 * main-lifecycle.js — startApp() на минимальных подставках (как в
 * main-lifecycle-hardening.test.js): события приложения ХРАНЯТСЯ и
 * вызываются, проверяется, что стало с окнами и меню.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../main-lifecycle');

function makeDeps() {
    const appHandlers = new Map();
    const windows = { controlWindow: null, widgetWindow: null, displayWindow: null, clockWidgetWindow: null };
    const all = [];
    let created = 0;
    const menus = [];
    const makeControl = () => {
        const win = {
            _visible: true, _focused: 0, _minimized: false,
            webContents: { once: () => {} },
            isDestroyed: () => false,
            isVisible() { return this._visible; },
            isMinimized() { return this._minimized; },
            restore() { this._minimized = false; },
            show() { this._visible = true; },
            hide() { this._visible = false; },
            focus() { this._focused++; }
        };
        all.push(win);
        windows.controlWindow = win;
        created++;
        return win;
    };
    const deps = {
        app: {
            on: (event, fn) => { appHandlers.set(event, fn); },
            whenReady: () => Promise.resolve(),
            requestSingleInstanceLock: () => true
        },
        BrowserWindow: { getAllWindows: () => all },
        Menu: {
            setApplicationMenu: (m) => menus.push(m),
            buildFromTemplate: (template) => ({ template })
        },
        powerMonitor: {},
        nativeImage: {},
        log: { info: () => {}, warn: () => {}, error: () => {} },
        safelySendToWindow: () => {},
        getSession: () => ({ defaultSession: {} }),
        registerProtocol: () => {},
        prepareStorage: async () => ({ dispose: () => {} }),
        windows,
        flags: { isQuitting: false },
        timer: { bindPowerMonitor: () => {}, restoreState: () => {}, getState: () => ({ remainingSeconds: 0 }), clearTimerInterval: () => {} },
        recoverySnapshot: {
            loadSavedTimerState: () => null, isRecoveryValid: () => false,
            stopPeriodicSave: () => {}, clearSavedTimerState: () => {}, persistRecoverySnapshot: () => {}
        },
        events: { loadOnStart: () => {}, foldPendingOnStart: () => {}, closeTalkOnQuit: () => {} },
        creators: {
            createControlWindow: makeControl,
            createWidgetWindow: () => {}, createClockWidgetWindow: () => {}, createDisplayWindow: () => {}
        },
        tray: { createTray: () => {} },
        inTestMode: false,
        screenshotMode: false,
        startupT0: Date.now()
    };
    return { deps, appHandlers, windows, menus, createdCount: () => created };
}

async function until(cond) {
    for (let i = 0; i < 200 && !cond(); i++) {
        await new Promise((r) => setImmediate(r));
    }
    assert.ok(cond(), 'условие не наступило');
}

test('MAIN-06: activate (клик по Dock) показывает спрятанную в трей панель', async () => {
    const h = makeDeps();
    startApp(h.deps);
    await until(() => h.appHandlers.has('activate'));

    const win = h.windows.controlWindow;
    assert.ok(win, 'старт создал панель');
    // Крестик при трее — hide(), окно остаётся в getAllWindows().
    win.hide();
    h.appHandlers.get('activate')();

    assert.equal(win.isVisible(), true, 'панель показана');
    assert.ok(win._focused > 0, 'и получила фокус');
    assert.equal(h.createdCount(), 1, 'вторая панель не создаётся');
});

test('MAIN-06: activate без панели создаёт её', async () => {
    const h = makeDeps();
    startApp(h.deps);
    await until(() => h.appHandlers.has('activate'));
    h.windows.controlWindow = null;
    h.appHandlers.get('activate')();
    assert.equal(h.createdCount(), 2);
    assert.ok(h.windows.controlWindow);
});
