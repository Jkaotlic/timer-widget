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

function runReset(target, init) {
    const prev = { window: global.window, document: global.document, localStorage: global.localStorage };
    const trace = [];
    const sent = [];
    const controls = init.controls;
    global.document = { getElementById: () => null };
    global.localStorage = { setItem: () => {}, getItem: () => null };
    global.window = {
        // Сброс схемы снимает ВСЕ чекбоксы окна — без событий, как настоящий.
        SettingsSchema: {
            SETTINGS_DESCRIPTORS: SettingsSchema.SETTINGS_DESCRIPTORS,
            resetOwnedSettings: (owner) => {
                trace.push('schema');
                for (const el of Object.values(controls[owner] || {})) { el.checked = false; }
            }
        },
        ClockSettingsSchema: { applyClockSettings: () => {} },
        SecurityUtils: { safeJSONParse: (raw, fallback) => (raw ? JSON.parse(raw) : fallback) },
        PanelColorFields: [],
        HeroModes: { DEFAULT_MODE: 'timer' },
        ipcRenderer: { send: (channel, payload) => sent.push([channel, payload]) },
        Toast: null
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
            clockStyleEl: { value: 'circle' },
            updateStyleDependentRows: () => {},
            updateClockAnalogNumbersVisibility: () => {},
            highlightActiveThemes: () => {},
            renderSurfaceControls: () => {}
        }, init.panel, PanelResetMixin, { sendClockStyle: PanelClockMixin.sendClockStyle,
            effectiveClockStyle: PanelClockMixin.effectiveClockStyle });
        panel.resetWindowSettings(target);
        return { panel, trace, sent };
    } finally {
        Object.assign(global, prev);
    }
}

test('PANEL-004(а): сброс часов снимает синхронизацию и в поле контроллера', () => {
    const syncClockStyleEl = { checked: true };
    const { panel, sent } = runReset('clock', {
        controls: { clock: { syncClockStyleEl } },
        panel: { syncClockStyle: true, syncClockStyleEl }
    });
    assert.equal(syncClockStyleEl.checked, false, 'харнесс: схема обязана снять чекбокс');
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
        controls: { display: { floor47UnlockedEl } },
        panel: {
            floor47UnlockedEl,
            renderFloor47() { renders.push(floor47UnlockedEl.checked); },
            pushDisplaySettings() { renders.push('push'); }
        }
    });
    assert.ok(trace.includes('schema'), 'харнесс: сброс схемы не вызван');
    assert.deepEqual(renders, [false, 'push'],
        'секция 47-го этажа не перерисована (или перерисована после посылки): ' + renders.join(' → '));
});
