'use strict';

/**
 * R6 (docs/superpowers/specs/2026-09-28-psi-hardening.md, добивка перед
 * повторной сдачей ПСИ): moveWindowBy игнорирует дельту за порогом
 * CONFIG.MAX_MOVE_DELTA — ни setBounds, ни исключение.
 *
 * Испорченный или подменённый payload IPC-канала `*-move` мог унести окно на
 * координату вне int32 — setBounds на таком значении либо бросает, либо
 * утаскивает окно за пределы всех мониторов без возврата. Законная дельта
 * одного движения мыши кратно меньше порога.
 *
 * main-geometry.js electron не требует (screen передаёт точка входа) —
 * подставки собраны вручную, без запуска Electron.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWindowGeometry } = require('../main-geometry');

const CONFIG = { MAX_MOVE_DELTA: 100000, WINDOW_MIN_VISIBLE_PX: 64 };

function makeGeometry() {
    const screen = {
        getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
        getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    };
    return createWindowGeometry({ screen, CONFIG, safelySendToWindow: () => {} });
}

function fakeWin(bounds) {
    const win = {
        destroyed: false,
        setBoundsCalls: [],
        isDestroyed: () => win.destroyed,
        getBounds: () => bounds,
        getMinimumSize: () => [64, 64],
        setBounds: (b) => { win.setBoundsCalls.push(b); }
    };
    return win;
}

test('R6: дельта за порогом MAX_MOVE_DELTA игнорируется — ни setBounds, ни исключение', () => {
    const geo = makeGeometry();
    const win = fakeWin({ x: 100, y: 100, width: 250, height: 250 });

    assert.doesNotThrow(() => geo.moveWindowBy(win, { deltaX: 1e12, deltaY: 0, first: true }));
    assert.equal(win.setBoundsCalls.length, 0, 'подделанная дельта не обязана двигать окно');
});

test('R6: дельта в пределах порога отрабатывает как обычно', () => {
    const geo = makeGeometry();
    const win = fakeWin({ x: 100, y: 100, width: 250, height: 250 });

    geo.moveWindowBy(win, { deltaX: 50, deltaY: 0, first: true });
    assert.equal(win.setBoundsCalls.length, 1, 'законная дельта обязана двигать окно как раньше');
    assert.equal(win.setBoundsCalls[0].x, 150);
});

test('R6: отрицательная дельта за порогом тоже игнорируется', () => {
    const geo = makeGeometry();
    const win = fakeWin({ x: 100, y: 100, width: 250, height: 250 });

    geo.moveWindowBy(win, { deltaX: -1e12, deltaY: 0, first: true });
    assert.equal(win.setBoundsCalls.length, 0);
});
