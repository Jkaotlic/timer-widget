'use strict';

/**
 * Масштаб перекидыша виджета считается ПОСЛЕ смены класса `has-hours`
 * (аудит 27.10.2026, RENDERERS-01).
 *
 * updateScaling() выбирает базовую ширину флипа по классу `has-hours`
 * (420 с часами, 320 без). Класс ставит updateFlipDisplay(). Раньше масштаб
 * пересчитывался только из гейта «Цифр» в updateDisplay() — ДО
 * updateFlipDisplay() и по другому условию (|secs| >= 3600, а у флипа
 * hours > 0 || total >= 3600). Итог: 5:00 → 90 минут — шесть карточек на базе
 * 320, флип на ~31 % шире окна; обратно — заниженный флип.
 *
 * Проверка поведенческая: метод updateFlipDisplay вынимается из исходника и
 * исполняется на поддельном `this`. Утверждается, что ПОСЛЕДНИЙ пересчёт
 * масштаба видит уже новый класс, и что без смены класса пересчёта на тике нет.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { balancedBlockAt, maskNonCode, codeOnly } = require('./helpers/source-scan');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'widget-app.js'), 'utf8');

function methodFn(name, params) {
    const mask = maskNonCode(SRC);
    const re = new RegExp(`\\n\\s+${name}\\(${params}\\)\\s*\\{`);
    const m = re.exec(mask);
    assert.ok(m, `метод ${name} не найден`);
    const block = balancedBlockAt(SRC, m.index, name);
    const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
     
    return new Function(params, body);
}

function fakeClassList(initial = []) {
    const set = new Set(initial);
    return {
        contains: (c) => set.has(c),
        toggle: (c, on) => { if (on) { set.add(c); } else { set.delete(c); } return on; },
        add: (c) => set.add(c),
        remove: (c) => set.delete(c)
    };
}

function fakeEl() {
    return { classList: fakeClassList(), style: {}, dataset: {} };
}

function makeWidget(totalSeconds, hadHours) {
    const calls = [];
    const self = {
        totalSeconds,
        widgetFlip: { classList: fakeClassList(hadHours ? ['has-hours'] : []) },
        wFlipMinus: fakeEl(),
        wFlipHoursGroup: fakeEl(),
        wFlipHoursSep: fakeEl(),
        wFlipHr1: fakeEl(), wFlipHr2: fakeEl(),
        wFlipMin1: fakeEl(), wFlipMin2: fakeEl(),
        wFlipSec1: fakeEl(), wFlipSec2: fakeEl(),
        wFlipContent: fakeEl(),
        _flip() {},
        updateScaling() {
            calls.push(this.widgetFlip.classList.contains('has-hours'));
        }
    };
    return { self, calls };
}

const updateFlipDisplay = methodFn('updateFlipDisplay', 'secs');

test.before(() => {
    global.window = { RendererShared: require('../renderer-shared.js') };
    global.document = { querySelectorAll: () => [] };
});
test.after(() => {
    delete global.window;
    delete global.document;
});

test('5:00 → 90 минут: масштаб пересчитан, и уже с классом has-hours', () => {
    const { self, calls } = makeWidget(5400, false);
    updateFlipDisplay.call(self, 5400);
    assert.ok(calls.length > 0, 'смена набора карточек не пересчитала масштаб');
    assert.strictEqual(calls[calls.length - 1], true,
        'масштаб посчитан по прежнему классу (база 320 при шести карточках)');
});

test('90 минут → 5:00: масштаб пересчитан, и уже без has-hours', () => {
    const { self, calls } = makeWidget(300, true);
    updateFlipDisplay.call(self, 300);
    assert.ok(calls.length > 0, 'смена набора карточек не пересчитала масштаб');
    assert.strictEqual(calls[calls.length - 1], false);
});

test('тотал >= часа при остатке < часа: класс и масштаб — с часами с первого тика', () => {
    // Условие гейта «Цифр» (|secs| >= 3600) здесь ложно — флипу оно не указ.
    const { self, calls } = makeWidget(4000, false);
    updateFlipDisplay.call(self, 1200);
    assert.strictEqual(calls[calls.length - 1], true);
});

test('без смены класса тик масштаб не трогает', () => {
    const { self, calls } = makeWidget(300, false);
    updateFlipDisplay.call(self, 299);
    updateFlipDisplay.call(self, 298);
    assert.strictEqual(calls.length, 0);
});

test('источник: пересчёт в updateFlipDisplay ключуется на СМЕНУ has-hours', () => {
    const code = codeOnly(SRC);
    const at = code.indexOf('updateFlipDisplay(secs) {');
    const body = balancedBlockAt(code, at, 'updateFlipDisplay');
    assert.match(body, /this\.updateScaling\(\)/);
    assert.match(body, /classList\.contains\('has-hours'\)/);
});
