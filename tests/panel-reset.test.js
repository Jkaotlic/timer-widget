'use strict';

/**
 * «Сбросить всё» у окна: сброс КОНТРОЛА обязан доехать до ВЛАДЕЛЬЦА значения.
 *
 * resetOwnedSettings() (settings-schema.js) ставит el.checked и событий не
 * порождает. Значит всё, что панель держит ПОЛЕМ контроллера или выводит из
 * контрола побочным эффектом, сброс сам не увидит — это и было PANEL-004
 * (аудит 27.10.2026):
 *  (а) синхронизация стиля часов: чекбокс снят, а this.syncClockStyle остался
 *      true — часам уходил стиль ВИДЖЕТА, хотя UI говорит «не синхронизировано»;
 *  (б) замок 47-го этажа: тумблер снят, дисплей получил floor47Unlocked:false,
 *      а секция, секретные раскладки и ряды подписей оставались видимыми.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { PanelResetMixin } = require('../panel-reset.js');
const { PanelClockMixin } = require('../panel-clock.js');
const SettingsSchema = require('../settings-schema.js');
const { installToastDom } = require('./helpers/toast-dom.js');

/**
 * Сброс идёт через НАСТОЯЩУЮ схему (panel-reset.js импортирует её): она
 * находит контролы по id в document и снимает их без событий — как в окне.
 * Поэтому контролы кладутся в поддельный document по id строки схемы, а не
 * подменяется сама схема: подмена через `window.SettingsSchema` модулю больше
 * не видна, а настоящая схема заодно доказывает, что строка контрола есть.
 * @param {string} target
 * @param {{controls: Record<string, object>, panel: object}} init — controls: id → контрол
 */
function runReset(target, init) {
    const prev = { window: global.window, document: global.document, localStorage: global.localStorage };
    const sent = [];
    const trace = [];
    const controls = init.controls;
    global.document = { getElementById: (id) => controls[id] || null };
    const toastDom = installToastDom(global.document);
    global.localStorage = { setItem: () => {}, getItem: () => null };
    // Крючок, который примесь по-прежнему берёт из window: шим IPC (Toast — настоящий, import).
    global.window = {
        ipcRenderer: { send: (channel, payload) => sent.push([channel, payload]) }
    };
    try {
        const panel = Object.assign({
            setHeroMode: () => {},
            updateColors: () => {},
            saveExtSettings: () => trace.push('save'),
            pushDisplaySettings: () => trace.push('push'),
            pushClockSettings: () => trace.push('pushClock'),
            refreshPresetMarks: () => {},
            widgetStylePayload: () => ({}),
            clockShowTicksEl: null,
            timerStyleEl: { value: 'flip' },
            clockStyleEl: controls.clockStyle || { value: 'circle' },
            updateStyleDependentRows: () => {},
            updateClockAnalogNumbersVisibility: () => {},
            highlightActiveThemes: () => {},
            renderSurfaceControls: () => {}
        }, init.panel, PanelResetMixin, { sendClockStyle: PanelClockMixin.sendClockStyle,
            effectiveClockStyle: PanelClockMixin.effectiveClockStyle });
        panel.resetWindowSettings(target);
        return { panel, trace, sent };
    } finally {
        toastDom.restore();
        Object.assign(global, prev);
    }
}

/** Умолчание строки схемы — харнесс сверяет, что сброс поставил ИМЕННО его. */
const schemaDefault = (key) => SettingsSchema.SETTINGS_DESCRIPTORS.find((d) => d.key === key).def;

test('PANEL-004(а): сброс часов снимает синхронизацию и в поле контроллера', () => {
    const syncClockStyleEl = { checked: true };
    // Свой стиль часов до сброса — НЕ умолчание: тогда «ушёл сброшенный свой»
    // отличим и от стиля виджета, и от несброшенного своего.
    const clockStyleEl = { value: 'analog' };
    assert.equal(schemaDefault('syncClockStyle'), false, 'харнесс: умолчание синхронизации');
    assert.equal(schemaDefault('clockStyle'), 'circle', 'харнесс: умолчание стиля часов');
    const { panel, sent } = runReset('clock', {
        controls: { syncClockStyle: syncClockStyleEl, clockStyle: clockStyleEl },
        panel: { syncClockStyle: true, syncClockStyleEl }
    });
    assert.equal(syncClockStyleEl.checked, false, 'харнесс: схема обязана снять чекбокс');
    assert.equal(clockStyleEl.value, 'circle', 'харнесс: схема обязана сбросить стиль часов');
    assert.equal(panel.syncClockStyle, false,
        'чекбокс снят, а поле синхронизации осталось включённым');
    const style = sent.find(([channel]) => channel === 'clock-widget-set-style');
    assert.ok(style, 'часам не ушёл стиль после сброса');
    assert.equal(style[1], 'circle', 'часам ушёл стиль ВИДЖЕТА вместо сброшенного своего');
});

test('PANEL-004(б): сброс дисплея перерисовывает секцию 47-го этажа ДО посылки', () => {
    const floor47UnlockedEl = { checked: true };
    const renders = [];
    const { trace } = runReset('display', {
        controls: { floor47Unlocked: floor47UnlockedEl },
        panel: {
            floor47UnlockedEl,
            renderFloor47() { renders.push(floor47UnlockedEl.checked); },
            pushDisplaySettings() { renders.push('push'); }
        }
    });
    assert.equal(schemaDefault('floor47Unlocked'), false, 'харнесс: умолчание замка');
    assert.equal(floor47UnlockedEl.checked, false, 'харнесс: схема обязана снять тумблер');
    assert.ok(trace.includes('save'), 'харнесс: сброс не записал профиль');
    assert.deepEqual(renders, [false, 'push'],
        'секция 47-го этажа не перерисована (или перерисована после посылки): ' + renders.join(' → '));
});
