'use strict';

/**
 * Окно на старте читает цвета СВОЕГО ключа (renderer-shared.ownColors).
 *
 * До 29.10.2026 дисплей и виджет брали `timerColors` — а это цвета ВИДЖЕТА,
 * которые панель пишет туда ради отката на прошлую версию. Дисплей со своими
 * цветами открывался в чужих до досылки main. Запасной путь на `timerColors`
 * законен только для профиля старше поканальных цветов: своего ключа нет ВОВСЕ.
 *
 * Хранилище — поддельное: функция обязана работать с тем, что ей дали, а не
 * с глобальным localStorage.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ownColors, storedColors, LEGACY_COLORS_KEY } = require('../renderer-shared');
const { codeOnly } = require('./helpers/source-scan');

function store(entries) {
    const map = new Map(Object.entries(entries));
    return { getItem: (k) => (map.has(k) ? map.get(k) : null) };
}

const WIDGET = JSON.stringify({ timer: '#ff0000' });
const DISPLAY = JSON.stringify({ timer: '#00ff00' });

test('запасной ключ — timerColors (его пишет панель ради отката)', () => {
    assert.equal(LEGACY_COLORS_KEY, 'timerColors');
});

test('свой ключ есть → его значение, а не timerColors', () => {
    const s = store({ displayColors: DISPLAY, timerColors: WIDGET });
    assert.deepEqual(ownColors(s, 'displayColors'), { timer: '#00ff00' });
});

test('свой ключ — пустой объект → {} («всё по CSS»), запасной путь не срабатывает', () => {
    const s = store({ displayColors: '{}', timerColors: WIDGET });
    assert.deepEqual(ownColors(s, 'displayColors'), {});
});

test('своего ключа нет, есть timerColors (старый профиль) → timerColors', () => {
    const s = store({ timerColors: WIDGET });
    assert.deepEqual(ownColors(s, 'displayColors'), { timer: '#ff0000' });
    assert.deepEqual(ownColors(s, 'widgetColors'), { timer: '#ff0000' });
});

test('нет ни своего, ни timerColors → null (владелец умолчания — CSS)', () => {
    assert.equal(ownColors(store({}), 'displayColors'), null);
});

test('битый JSON своего ключа → как safeJSONParse: null, значит запасной путь', () => {
    const s = store({ displayColors: '{не json', timerColors: WIDGET });
    assert.deepEqual(ownColors(s, 'displayColors'), { timer: '#ff0000' });
    assert.equal(ownColors(store({ displayColors: '{не json' }), 'displayColors'), null);
});

test('битый timerColors при отсутствии своего → null', () => {
    assert.equal(ownColors(store({ timerColors: 'oops' }), 'widgetColors'), null);
});

test('нет хранилища или ключа → null, а не исключение', () => {
    assert.equal(ownColors(null, 'displayColors'), null);
    assert.equal(ownColors(store({ timerColors: WIDGET }), ''), null);
});

test('свой ключ — массив или примитив → не объект цветов, запасной путь (как parseColors панели)', () => {
    const s = store({ displayColors: '[1,2]', timerColors: WIDGET });
    assert.deepEqual(ownColors(s, 'displayColors'), { timer: '#ff0000' });
    assert.deepEqual(ownColors(store({ displayColors: '42', timerColors: WIDGET }), 'displayColors'), { timer: '#ff0000' });
});

// ---------------------------------------------------------------------------
// Дисплей: ТОЛЬКО свой ключ, без запасного пути.
//
// Панель досылает дисплею `displayColors || {}` — без запасного пути на
// timerColors (panel-colors.loadWindowColors), main помнит это и шлёт при
// открытии. Значит осевшее состояние дисплея без своего ключа — CSS-умолчание,
// и первый кадр обязан совпасть с ним. Запасной путь давал вспышку цветов
// виджета на самом частом профиле (меняли только цвета виджета).
// ---------------------------------------------------------------------------

test('storedColors: свой ключ → объект; нет / битый / массив → null; timerColors НЕ берётся', () => {
    assert.deepEqual(storedColors(store({ displayColors: DISPLAY }), 'displayColors'), { timer: '#00ff00' });
    assert.deepEqual(storedColors(store({ displayColors: '{}' }), 'displayColors'), {});
    assert.equal(storedColors(store({ timerColors: WIDGET }), 'displayColors'), null);
    assert.equal(storedColors(store({ displayColors: '{не json', timerColors: WIDGET }), 'displayColors'), null);
    assert.equal(storedColors(store({ displayColors: '[1]' }), 'displayColors'), null);
    assert.equal(storedColors(null, 'displayColors'), null);
});

test('дисплей читает цвета storedColors(displayColors), а не ownColors с запасным путём', () => {
    const read = (f) => codeOnly(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    const OWN = /\bownColors\s*\(/;
    // Самопроверка регулярки: вызов ownColors в виджете она обязана видеть.
    assert.match(read('widget-app.js'), OWN, 'регулярка не видит ownColors( в виджете — тест слеп');
    const display = read('display-script.js');
    assert.doesNotMatch(display, OWN, 'дисплей снова берёт запасной путь на timerColors');
    assert.match(display, /storedColors\(\s*localStorage,\s*'displayColors'\s*\)/);
});
