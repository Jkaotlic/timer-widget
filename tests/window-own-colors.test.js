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
const { ownColors, LEGACY_COLORS_KEY } = require('../renderer-shared');

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
