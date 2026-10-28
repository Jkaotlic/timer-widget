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
 * Проверка поведенческая: метод вынимается из исходника и исполняется на
 * поддельном `this`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { balancedBlockAt, maskNonCode } = require('./helpers/source-scan');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'display-script.js'), 'utf8');

function methodFn(name) {
    const mask = maskNonCode(SRC);
    const re = new RegExp(`\\n\\s+${name}\\(\\)\\s*\\{`);
    const m = re.exec(mask);
    assert.ok(m, `метод ${name} не найден`);
    const block = balancedBlockAt(SRC, m.index, name);
    const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
     
    return new Function(body);
}

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
        self: {
            movableElements: rows,
            elementFractions: {},
            _safeSetItem: (key, value) => writes.push([key, value])
        }
    };
}

const saveElementPositions = methodFn('saveElementPositions');

test.before(() => {
    global.window = {
        innerWidth: 1000,
        innerHeight: 800,
        DisplayLayouts: require('../display-layouts.js')
    };
});
test.after(() => { delete global.window; });

test('ничего не сдвинуто: записывается пустой набор, а не пропуск', () => {
    const { self, writes } = display([row('timerBox', false), row('currentTime', false)]);
    saveElementPositions.call(self);
    assert.deepStrictEqual(writes, [['displayBlockPositions', '{}']],
        'пустой набор не записан — прежние места воскресят при открытии окна');
});

test('сдвинутый элемент по-прежнему записывается с долей', () => {
    const { self, writes } = display([row('timerBox', true, 100, 200), row('currentTime', false)]);
    saveElementPositions.call(self);
    assert.strictEqual(writes.length, 1);
    const [key, raw] = writes[0];
    assert.strictEqual(key, 'displayBlockPositions');
    const saved = JSON.parse(raw);
    assert.deepStrictEqual(Object.keys(saved), ['timerBox']);
    assert.strictEqual(saved.timerBox.left, 100);
    assert.ok(Number.isFinite(saved.timerBox.cx));
});
