'use strict';

/**
 * Пустой набор мест дисплея ЗАПИСЫВАЕТСЯ (аудит 27.10.2026, RENDERERS-02).
 *
 * Сценарий: сдвинут только таймер (`displayBlockPositions` = {timerBox:…}),
 * карточки не трогали. Раскладка «Минимум» (elements: {}) возвращает таймер в
 * поток, на экране ничего не сдвинуто — а saveElementPositions() пропускал
 * запись пустого набора (`Object.keys(positions).length > 0`). В хранилище
 * оставалось старое место таймера, и при следующем открытии окна
 * _restoreBlockPositionsPass() утаскивал таймер обратно.
 *
 * Раскладка — действие, и сохраняются её ПОСЛЕДСТВИЯ (docs/lessons.md, «A
 * layout is an action, not a setting»): «ничего не сдвинуто» — тоже
 * последствие. '{}' читается восстановлением и пресетами как «ничего не
 * сдвинуто» (presets.js matchesPreset).
 *
 * Метод приложения исполняется на
 * поддельном `this`.
 */

const test = require('node:test');
const assert = require('node:assert');
const { DisplayTimer } = require('../display-script.js');

function row(id, custom, left = 0, top = 0) {
    return {
        id,
        el: {
            classList: { contains: (c) => c === 'custom-position' && custom },
            style: { left: `${left}px`, top: `${top}px` },
            getBoundingClientRect: () => ({ left, top, width: 100, height: 50 })
        }
    };
}

function display(rows) {
    const writes = [];
    return {
        writes,
        self: Object.assign(Object.create(DisplayTimer.prototype), {
            movableElements: rows,
            elementFractions: {},
            _safeSetItem: (key, value) => writes.push([key, value])
        })
    };
}

test.before(() => {
    global.window = {
        innerWidth: 1000,
        innerHeight: 800
    };
});
test.after(() => { delete global.window; });

test('ничего не сдвинуто: записывается пустой набор, а не пропуск', () => {
    const { self, writes } = display([row('timerBox', false), row('currentTime', false)]);
    self.saveElementPositions();
    assert.deepStrictEqual(writes, [['displayBlockPositions', '{}']],
        'пустой набор не записан — прежние места воскресят при открытии окна');
});

test('сдвинутый элемент по-прежнему записывается с долей', () => {
    const { self, writes } = display([row('timerBox', true, 100, 200), row('currentTime', false)]);
    self.saveElementPositions();
    assert.strictEqual(writes.length, 1);
    const [key, raw] = writes[0];
    assert.strictEqual(key, 'displayBlockPositions');
    assert.deepStrictEqual(JSON.parse(raw), { timerBox: { left: 100, top: 200, cx: 0.15, cy: 0.2813 } });
    assert.deepStrictEqual(self.elementFractions.timerBox, { cx: 0.15, cy: 0.28125 });
});

test('скрытый сдвинутый элемент сохраняет пиксели без нового замера доли', () => {
    const hidden = row('timerBox', true, 100, 200);
    hidden.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    const { self, writes } = display([hidden]);
    self.elementFractions.timerBox = { cx: 0.9, cy: 0.7 };
    self.saveElementPositions();
    assert.deepStrictEqual(JSON.parse(writes[0][1]), { timerBox: { left: 100, top: 200 } });
    assert.deepStrictEqual(self.elementFractions.timerBox, { cx: 0.9, cy: 0.7 });
});

test('перераскладка сохраняет исходную долю и пропускает пустой набор', () => {
    const { self, writes } = display([row('timerBox', true, 100, 200)]);
    self.elementFractions.timerBox = { cx: 0.9, cy: 0.7 };
    self.saveElementPositionsKeepingFractions();
    assert.deepStrictEqual(JSON.parse(writes[0][1]).timerBox, { left: 100, top: 200, cx: 0.9, cy: 0.7 });
    self.movableElements = [];
    self.saveElementPositionsKeepingFractions();
    assert.strictEqual(writes.length, 1);
});
