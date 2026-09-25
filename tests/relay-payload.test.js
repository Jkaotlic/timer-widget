'use strict';

/**
 * SEC-10: payload каналов-ретрансляторов проверяется ДО того, как главный
 * процесс его запомнит и разошлёт.
 *
 * Эти каналы не просто передают сообщение — они кладут его в `last*` и
 * досылают каждому окну при открытии. Непроверенный payload становился
 * постоянным: мусор или 500-мегабайтная строка жили в памяти главного процесса
 * и заново уходили в окно на каждом открытии.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeRelayPayload, RELAY_LIMITS, EVENT_TITLE_MAX } = require('../relay-payload');
const CONFIG = require('../constants');

test('плоский объект примитивов проходит как есть', () => {
    const p = { timerStyle: 'flip', timerScale: 120, statusLabel: false, digitsFont: null };
    assert.deepEqual(sanitizeRelayPayload('widget-style-update', p), p);
});

test('не объект — отказ (null, строка, массив, число, класс)', () => {
    for (const bad of [undefined, null, 'строка', 42, true, [], [1, 2], new Date(), new Map()]) {
        assert.equal(sanitizeRelayPayload('widget-colors-update', bad), null, String(bad));
    }
});

test('вложенные объекты, функции и нечисла отбрасываются по ключу', () => {
    const out = sanitizeRelayPayload('display-colors-update', {
        timer: '#ffffff', nested: { a: 1 }, list: [1], nan: NaN, inf: Infinity, big: 10n
    });
    assert.deepEqual(out, { timer: '#ffffff' });
});

test('__proto__ из сообщения не становится прототипом', () => {
    // Структурное клонирование IPC даёт СОБСТВЕННОЕ свойство «__proto__»;
    // присвоенное в обычный объект, оно подменило бы прототип.
    const payload = JSON.parse('{"__proto__": "x", "constructor": "y", "ok": 1}');
    const out = sanitizeRelayPayload('clock-widget-settings', payload);
    assert.deepEqual(Object.keys(out), ['ok']);
    assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test('название мероприятия режется до 60 символов и в главном процессе', () => {
    assert.equal(EVENT_TITLE_MAX, 60);
    const out = sanitizeRelayPayload('display-settings-update', { eventTitle: 'Я'.repeat(500) });
    assert.equal(out.eventTitle.length, 60);
});

test('картинка фона предельного размера проходит в настройках дисплея', () => {
    // local-background.js пускает файл до MAX_IMAGE_FILE_SIZE; base64 — это 4/3
    // от байтов плюс префикс data URL. Потолок ниже этого сломал бы законный фон.
    const base64 = Math.ceil(CONFIG.MAX_IMAGE_FILE_SIZE / 3) * 4;
    const image = 'data:image/jpeg;base64,' + 'A'.repeat(base64);
    const out = sanitizeRelayPayload('display-settings-update', { bgMode: 'local', bgLocalImage: image });
    assert.ok(out, 'законная картинка 10 МБ отвергнута');
    assert.equal(out.bgLocalImage.length, image.length);
});

test('сверх потолка — отказ целиком, а не обрезка', () => {
    // Обрезанная картинка или цвет — это ДРУГОЕ значение, которое окно
    // покажет как настоящее. Честнее не принять вовсе.
    const over = 'A'.repeat(RELAY_LIMITS['display-settings-update'] + 1);
    assert.equal(sanitizeRelayPayload('display-settings-update', { bgLocalImage: over }), null);
    const small = 'A'.repeat(RELAY_LIMITS.default + 1);
    assert.equal(sanitizeRelayPayload('widget-colors-update', { timer: small }), null);
    // Потолок у цветов — не потолок дисплея.
    assert.ok(RELAY_LIMITS.default < 1024 * 1024);
});

test('слишком много ключей — отказ', () => {
    const many = {};
    for (let i = 0; i < 1000; i++) { many['k' + i] = i; }
    assert.equal(sanitizeRelayPayload('clock-widget-settings', many), null);
});

test('стиль часов — короткая строка, иначе отказ', () => {
    assert.equal(sanitizeRelayPayload('clock-widget-set-style', 'flip'), 'flip');
    for (const bad of [null, 42, {}, 'x'.repeat(100)]) {
        assert.equal(sanitizeRelayPayload('clock-widget-set-style', bad), null);
    }
});

test('канал без правила — ошибка программиста, а не молчаливый пропуск', () => {
    assert.throws(() => sanitizeRelayPayload('timer-command', {}), /нет правила/);
});
