'use strict';

/**
 * main-tray.js на поддельных Tray и Menu: что трей ПОКАЗЫВАЕТ.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTrayController } = require('../main-tray');

function setup() {
    const state = { isRunning: false, remainingSeconds: 300 };
    const trays = [];
    class FakeTray {
        constructor() { this.tooltip = ''; this.menu = null; trays.push(this); }
        setToolTip(t) { this.tooltip = t; }
        setContextMenu(m) { this.menu = m; }
        on() {}
    }
    const noop = () => {};
    const ctl = createTrayController({
        Tray: FakeTray,
        Menu: { buildFromTemplate: (template) => ({ template }) },
        nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
        app: { quit: noop },
        log: { info: noop, warn: noop },
        windows: { controlWindow: null, widgetWindow: null, clockWidgetWindow: null },
        flags: { isQuitting: false },
        getTimerState: () => state,
        timer: { handleTimerStart: noop, handleTimerPause: noop, handleTimerReset: noop },
        creators: { getAppIconPath: () => 'x.png', createControlWindow: noop },
        closing: { markClosing: (w) => w, cancelQueuedOpen: noop }
    });
    ctl.createTray();
    return { ctl, state, tray: trays[0] };
}

const labels = (tray) => tray.menu.template.map((i) => i.label).filter(Boolean);

test('MAIN-08: меню трея не показывает остаток, который не обновляется на тиках', () => {
    const { ctl, state, tray } = setup();
    state.isRunning = true;
    ctl.updateTrayMenu();            // перестройка при смене isRunning
    state.remainingSeconds = 120;    // прошло три минуты
    ctl.updateTrayMenu();            // тик: меню НЕ перестраивается (F-022)

    const stale = labels(tray).filter((l) => /\d\d:\d\d/.test(l));
    assert.deepEqual(stale, [], `в меню время с момента перестройки: ${stale.join(', ')}`);
    // Остаток — в подсказке, и она свежая.
    assert.match(tray.tooltip, /02:00/);
});

test('MAIN-08: проверка себя — пункт со временем распознаётся', () => {
    assert.ok(/\d\d:\d\d/.test('⏱  05:00'), 'зонд не видит строку времени');
});
