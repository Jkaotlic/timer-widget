'use strict';

/**
 * R2 (docs/superpowers/specs/2026-09-28-psi-hardening.md, добивка перед
 * повторной сдачей ПСИ): в whenReady главный процесс обязан явно выключить
 * орфографию (сеть) — поверх уже стоящего запрета разрешений
 * (setPermissionRequestHandler/setPermissionCheckHandler).
 *
 * main-lifecycle.js electron не требует (аргументы передаёт точка входа) —
 * поэтому startApp() тестируется здесь напрямую, минимальными подставками, а
 * не через загрузку всего electron-main.js (там app.whenReady() специально
 * никогда не резолвится — иначе тесты создавали бы настоящие окна и трей).
 * Момент «whenReady дошёл до createControlWindow» ловится подставкой самого
 * createControlWindow — к этому месту try-блок с обработчиками сессии уже
 * исполнился (он стоит раньше await prepareStorage()).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../main-lifecycle');

// Минимальные подставки. `session` — параметр: варианты теста дают ей разный
// набор методов (полный шпион / часть методов отсутствует, как у стаба
// electron-main-load.test.js).
function makeDeps(session) {
    let resolveReady;
    const ready = new Promise((res) => { resolveReady = res; });
    const windows = { controlWindow: null, widgetWindow: null, displayWindow: null, clockWidgetWindow: null };
    const warnings = [];
    const deps = {
        app: {
            on: () => {},
            whenReady: () => Promise.resolve(),
            requestSingleInstanceLock: () => true
        },
        BrowserWindow: { getAllWindows: () => [] },
        Menu: { setApplicationMenu: () => {} },
        powerMonitor: {},
        nativeImage: {},
        log: { info: () => {}, warn: (...a) => warnings.push(a), error: () => {} },
        safelySendToWindow: () => {},
        getSession: () => ({ defaultSession: session }),
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
            createControlWindow: () => {
                windows.controlWindow = { webContents: { once: () => {} } };
                resolveReady();
            },
            createWidgetWindow: () => {}, createClockWidgetWindow: () => {}, createDisplayWindow: () => {}
        },
        tray: { createTray: () => {} },
        inTestMode: false,
        screenshotMode: false,
        startupT0: Date.now()
    };
    return { deps, ready, warnings };
}

test('R2: whenReady выключает орфографию — setSpellCheckerEnabled(false)', async () => {
    const calls = [];
    const session = {
        setSpellCheckerEnabled: (v) => calls.push(['setSpellCheckerEnabled', v]),
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {}
    };
    const { deps, ready } = makeDeps(session);
    startApp(deps);
    await ready;
    assert.deepEqual(calls.find((c) => c[0] === 'setSpellCheckerEnabled'), ['setSpellCheckerEnabled', false]);
});

test('R2: отсутствие setSpellCheckerEnabled не обрывает регистрацию остальных обработчиков той же сессии', () => {
    // Оба вызова стоят в ОДНОМ try (main-lifecycle.js): без typeof-гарда
    // обращение к отсутствующему методу бросило бы TypeError, и всё, что
    // написано в try ПОСЛЕ него — включая уже существовавший
    // setPermissionRequestHandler, — не выполнилось бы вовсе, поймай его
    // общий catch или нет. Гард важен не только чтобы whenReady не упал, а
    // чтобы одно отсутствующее необязательное поле не гасило остальные.
    const calls = [];
    const session = {
        // setSpellCheckerEnabled нет — как в старых стабах тестов.
        setPermissionRequestHandler: () => calls.push('setPermissionRequestHandler'),
        setPermissionCheckHandler: () => calls.push('setPermissionCheckHandler')
    };
    const { deps, ready } = makeDeps(session);
    startApp(deps);
    return ready.then(() => {
        assert.deepEqual(calls, ['setPermissionRequestHandler', 'setPermissionCheckHandler']);
    });
});

test('R2: подставка без setSpellCheckerEnabled/setPermissionRequestHandler/setPermissionCheckHandler не роняет whenReady (constraints.md review focus #5)', () => {
    // У старых стабов тестов (createStubs() в electron-main-load.test.js)
    // `session.defaultSession` — вовсе `{}`. whenReady обязан дойти до
    // createControlWindow, а не оборваться на первом отсутствующем методе
    // (существующий catch уже это гарантировал — тест фиксирует, что R2 его
    // не сломал).
    const { deps, ready } = makeDeps({});
    startApp(deps);
    return ready; // резолвится только если createControlWindow был вызван — whenReady дошёл до конца
});
