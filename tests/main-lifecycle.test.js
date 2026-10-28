'use strict';

/**
 * main-lifecycle.js — startApp() на минимальных подставках (как в
 * main-lifecycle-hardening.test.js): события приложения ХРАНЯТСЯ и
 * вызываются, проверяется, что стало с окнами и меню.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../main-lifecycle');

function makeDeps({ platform = 'darwin' } = {}) {
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
        startupT0: Date.now(),
        platform
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

// Роли, за которыми в Electron стоят инструменты разработчика или перезагрузка.
const DEV_ROLES = ['toggleDevTools', 'viewMenu', 'reload', 'forceReload'];

function flatRoles(template) {
    const out = [];
    for (const item of template || []) {
        if (item.role) { out.push(item.role); }
        if (Array.isArray(item.submenu)) { out.push(...flatRoles(item.submenu)); }
    }
    return out;
}

test('MAIN-10: на macOS меню приложения — appMenu и editMenu (Cmd+C/V/Q), без инструментов разработчика', async () => {
    // С меню null у macOS нет ни Cmd+C/V/X/A/Z в полях панели, ни Cmd+Q/H:
    // эти клавиши в Electron идут через роли меню приложения.
    const h = makeDeps({ platform: 'darwin' });
    startApp(h.deps);
    await until(() => h.menus.length > 0);

    const menu = h.menus[h.menus.length - 1];
    assert.ok(menu && Array.isArray(menu.template), 'на macOS меню задано шаблоном, а не null');
    const roles = flatRoles(menu.template);
    assert.deepEqual(roles.sort(), ['appMenu', 'editMenu']);
    for (const r of DEV_ROLES) {
        assert.ok(!roles.includes(r), `в меню роль ${r} — путь к инструментам разработчика`);
    }
});

test('MAIN-10: на Windows и Linux меню приложения по-прежнему нет', async () => {
    for (const platform of ['win32', 'linux']) {
        const h = makeDeps({ platform });
        startApp(h.deps);
        await until(() => h.menus.length > 0);
        assert.equal(h.menus[h.menus.length - 1], null, platform);
    }
});

test('MAIN-10: проверка себя — зонд видит роль инструментов разработчика', () => {
    assert.deepEqual(flatRoles([{ role: 'appMenu' }, { label: 'V', submenu: [{ role: 'toggleDevTools' }] }]),
        ['appMenu', 'toggleDevTools']);
});
