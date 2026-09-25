const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../utils');
const { formatTime, formatTimeShort, parseManualTime } = utils;

test('formatTime formats HH:MM:SS with sign', () => {
    assert.equal(formatTime(0), '00:00:00');
    assert.equal(formatTime(5), '00:00:05');
    assert.equal(formatTime(65), '00:01:05');
    assert.equal(formatTime(3665), '01:01:05');
    assert.equal(formatTime(-3665), '-01:01:05');
});

test('formatTimeShort outputs MM:SS or H:MM:SS', () => {
    assert.equal(formatTimeShort(5), '00:05');
    assert.equal(formatTimeShort(65), '01:05');
    assert.equal(formatTimeShort(3665), '1:01:05');
    assert.equal(formatTimeShort(-3665), '-1:01:05');
});

// parseTime удалён 25.09.2026: в приложении его не звал никто, кроме
// тестов, и он же обещал «99:99:99» как законный ввод. Разбор ручного
// ввода — ОДИН, parseManualTime.
test('parseTime удалён: разбор ручного ввода один', () => {
    assert.equal(utils.parseTime, undefined);
});

test('parseManualTime: bare number = seconds', () => {
    assert.equal(parseManualTime('5'), 5);
    assert.equal(parseManualTime('90'), 90);
    assert.equal(parseManualTime('0'), 0);
});

test('parseManualTime: X:Y = min:sec', () => {
    assert.equal(parseManualTime('1:05'), 65);
    assert.equal(parseManualTime('10:00'), 600);
    assert.equal(parseManualTime('0:30'), 30);
});

test('parseManualTime: X:Y:Z = hr:min:sec', () => {
    assert.equal(parseManualTime('1:01:05'), 3665);
    assert.equal(parseManualTime('0:05:00'), 300);
    assert.equal(parseManualTime('2:00:00'), 7200);
});

test('parseManualTime: 99:59:59 clamp boundary', () => {
    // 99:59:59 = 359999 is the max accepted value
    assert.equal(parseManualTime('99:59:59'), 359999);
    // 100:00:00 = 360000 exceeds max → null
    assert.equal(parseManualTime('100:00:00'), null);
});

// BUG-13: разбор был «выкинь всё, кроме цифр и двоеточий, и сложи» — и
// потому соглашался с чем угодно: «1,5» → 15, «99:99» → 6039, «5 мин» → 5,
// «-5» → 5, «::» → 0. Поле лимита показывало «стоп на −00:15» там, где
// человек имел в виду полторы минуты. Теперь формат строгий, а всё прочее —
// null, то есть подсветка «не понял формат».
test('BUG-13: минуты и секунды после двоеточия — меньше 60', () => {
    assert.equal(parseManualTime('5:99'), null);
    assert.equal(parseManualTime('99:99'), null);
    assert.equal(parseManualTime('1:60:00'), null);
    assert.equal(parseManualTime('1:59:59'), 7199);
    // Ведущая часть не ограничена 59: «90:00» — полтора часа минутами.
    assert.equal(parseManualTime('90:00'), 5400);
});

test('BUG-13: мусор — null, а не число из обрывков', () => {
    for (const bad of ['', '   ', 'abc', '::', ':', '1:', ':30', '1,5', '1.5', '5 мин',
        '-5', '1m30s', '1:2:3:4', '1:5:', '1::5', '+5', '1:123']) {
        assert.equal(parseManualTime(bad), null, JSON.stringify(bad));
    }
});

test('BUG-13: пробелы по краям законны, одна цифра в поле минут/секунд тоже', () => {
    assert.equal(parseManualTime('1:30 '), 90);
    assert.equal(parseManualTime(' 1:5'), 65);
    assert.equal(parseManualTime('0:0:5'), 5);
});

test('BUG-13: не-строка — null, а не исключение', () => {
    assert.equal(parseManualTime(null), null);
    assert.equal(parseManualTime(undefined), null);
    assert.equal(parseManualTime(5), null);
});
