'use strict';

/**
 * R5 (docs/superpowers/specs/2026-09-28-psi-hardening.md, добивка перед
 * повторной сдачей ПСИ): упавший рендерер перезагружается не более
 * CONFIG.CRASH_RELOAD_LIMIT раз за CONFIG.CRASH_RELOAD_WINDOW_MS на окно.
 *
 * Лимит — СКОЛЬЗЯЩЕЕ окно 60 с, а не счётчик на жизнь окна (constraints.md,
 * review focus #4): окно, упавшее один раз в час, обязано перезагружаться
 * всегда. Поэтому метки времени перезагрузок держатся МАССИВОМ на самом окне
 * (`win.__crashReloads`), а не одним счётчиком, который только растёт.
 *
 * main-window-hooks.js electron не требует — подставка окна собрана вручную,
 * без запуска Electron.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWindowHooks } = require('../main-window-hooks');

function makeHooks() {
    const windows = { controlWindow: null, widgetWindow: null, displayWindow: null, clockWidgetWindow: null };
    const errors = [];
    const CONFIG = { CRASH_RELOAD_LIMIT: 3, CRASH_RELOAD_WINDOW_MS: 60000 };
    const hooks = createWindowHooks({
        windows,
        CONFIG,
        log: { info: () => {}, warn: () => {}, error: (...a) => errors.push(a) },
        safelySendToWindow: () => {},
        appPageUrls: [],
        logBlockedNavigation: () => {},
        updateTrayMenu: () => {}
    });
    return { hooks, errors };
}

// Подставка окна: единственный слушатель render-process-gone запоминается,
// чтобы тест мог вызвать его напрямую — как это делает Electron при крахе.
function fakeWin() {
    let handler = null;
    const win = {
        reloadCalls: 0,
        isDestroyed: () => false,
        reload: () => { win.reloadCalls++; },
        webContents: {
            on: (event, cb) => { if (event === 'render-process-gone') { handler = cb; } }
        }
    };
    win.fire = (details) => handler(null, details);
    return win;
}

test('R5: перезагрузка не чаще CRASH_RELOAD_LIMIT раз за CRASH_RELOAD_WINDOW_MS', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const { hooks } = makeHooks();
    const win = fakeWin();
    hooks.bindRenderCrashHandler(win, 'widget');

    // Четыре краха подряд в ОДИН и тот же момент времени: перезагрузка только
    // на первые три (CRASH_RELOAD_LIMIT), четвёртая — отказ.
    win.fire({ reason: 'crashed' });
    win.fire({ reason: 'crashed' });
    win.fire({ reason: 'crashed' });
    win.fire({ reason: 'crashed' });
    assert.equal(win.reloadCalls, 3, 'четвёртый краш в том же окне 60 с не должен перезагружать');

    // Сдвиг времени за пределы скользящего окна — лимит не счётчик на жизнь,
    // а именно окно 60 с: следующий краш обязан снова перезагрузить.
    t.mock.timers.tick(61000);
    win.fire({ reason: 'crashed' });
    assert.equal(win.reloadCalls, 4, 'краш через 61 с после серии обязан перезагрузить — лимит скользящий, не пожизненный');
});

test('R5: лимит достигнут — лог называет окно и перезагрузки нет, окно не закрывается', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const { hooks, errors } = makeHooks();
    const win = fakeWin();
    let destroyCalled = false;
    win.destroy = () => { destroyCalled = true; };
    win.close = () => { destroyCalled = true; };
    hooks.bindRenderCrashHandler(win, 'control');

    win.fire({ reason: 'crashed' });
    win.fire({ reason: 'crashed' });
    win.fire({ reason: 'crashed' });
    errors.length = 0;
    win.fire({ reason: 'crashed' });

    assert.equal(win.reloadCalls, 3);
    assert.equal(destroyCalled, false, 'при достижении лимита окно остаётся как есть, а не закрывается');
    const logged = errors.some((a) => String(a.join(' ')).includes('control'));
    assert.ok(logged, 'лог отказа обязан называть метку окна');
});

test('R5: clean-exit никогда не перезагружает и не считается крахом', () => {
    const { hooks } = makeHooks();
    const win = fakeWin();
    hooks.bindRenderCrashHandler(win, 'display');

    win.fire({ reason: 'clean-exit' });
    win.fire({ reason: 'clean-exit' });
    assert.equal(win.reloadCalls, 0);
});
