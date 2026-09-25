'use strict';

/**
 * BUG-18: список мониторов в панели.
 *
 * Сохранённый выбор (`selectedDisplay` из localStorage — чужие данные)
 * подставлялся в CSS-селектор `option[value="${saved}"]` без экранирования:
 * кавычка в значении роняла querySelector исключением (SyntaxError), и список
 * мониторов не строился вовсе. Теперь значение сравнивается со списком опций,
 * а не встраивается в селектор; код уехал из inline-скрипта в panel-display.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { codeOnly } = require('./helpers/source-scan');

const { fillDisplaySelect } = require('../panel-display.js');
const { readSource } = require('./helpers/window-source');

function fakeDoc() {
    return {
        createElement: () => ({ value: '', textContent: '' })
    };
}

function fakeSelect() {
    const options = [];
    return {
        options,
        value: '',
        replaceChildren() { options.length = 0; },
        appendChild(o) { options.push(o); },
        querySelector() { throw new Error('селектор строится из данных хранилища — так нельзя'); }
    };
}

const DISPLAYS = [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }
];

test('BUG-18: «Авто» и мониторы с подписями и размерами', () => {
    const select = fakeSelect();
    fillDisplaySelect(select, DISPLAYS, 'auto', fakeDoc());
    assert.deepEqual(select.options.map((o) => [o.value, o.textContent]), [
        ['auto', 'Авто'],
        ['0', 'Основной (1920×1080)'],
        ['1', 'Монитор 2 (2560×1440)']
    ]);
    assert.equal(select.value, 'auto');
});

test('BUG-18: сохранённый выбор восстанавливается, если такой монитор есть', () => {
    const select = fakeSelect();
    fillDisplaySelect(select, DISPLAYS, '1', fakeDoc());
    assert.equal(select.value, '1');
});

test('BUG-18: мусор и кавычки из хранилища не роняют список', () => {
    for (const saved of ['"]', '1"] , option[value="0', '5', '', null]) {
        const select = fakeSelect();
        assert.doesNotThrow(() => fillDisplaySelect(select, DISPLAYS, saved, fakeDoc()));
        assert.equal(select.options.length, 3);
        assert.equal(select.value, 'auto', JSON.stringify(saved));
    }
});

test('BUG-18: в панели не осталось селектора из данных хранилища', () => {
    const html = codeOnly(readSource('electron-control.html'));
    assert.doesNotMatch(html, /option\[value="\$\{savedDisplay\}"\]/);
    assert.doesNotMatch(html, /updateDisplaysList\(displays\)\s*\{/, 'метод снова живёт в inline-скрипте');
    const mod = codeOnly(readSource('panel-display.js'));
    assert.match(mod, /updateDisplaysList\(displays\)\s*\{/);
    // Самопроверка регулярки на старом тексте.
    assert.match('select.querySelector(`option[value="${savedDisplay}"]`)', /option\[value="\$\{savedDisplay\}"\]/);
});
