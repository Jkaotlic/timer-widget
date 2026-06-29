const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTime, formatTimeShort, parseTime, parseManualTime } = require('../utils');

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

test('parseTime parses HH:MM:SS, MM:SS, SS with sign', () => {
    assert.equal(parseTime('01:01:05'), 3665);
    assert.equal(parseTime('1:05'), 65);
    assert.equal(parseTime('5'), 5);
    assert.equal(parseTime('-00:00:05'), -5);
    assert.equal(parseTime('-1:01:05'), -3665);
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

test('parseManualTime: 5:99 normalization (no clamp on parts, sums raw)', () => {
    // The original sums parts without per-field clamping: 5*60 + 99 = 399
    assert.equal(parseManualTime('5:99'), 399);
});

test('parseManualTime: empty/garbage → null', () => {
    assert.equal(parseManualTime(''), null);
    assert.equal(parseManualTime('   '), null);
    // 'abc' has no digits/colons after cleaning → clean is '' → null
    assert.equal(parseManualTime('abc'), null);
    // '::' cleans to '::' (colons kept) → split ['','',''], parts of 3 → parseInt('')||0 = 0 → 0
    assert.equal(parseManualTime('::'), 0);
});

test('parseManualTime: strips non-digit/non-colon chars then parses', () => {
    // 'm' and 's' removed, no colon survives → '130' → length 1 → 130 seconds
    assert.equal(parseManualTime('1m30s'), 130);
    // trailing space trimmed, colon kept → '1:30' → 90
    assert.equal(parseManualTime('1:30 '), 90);
});

test('parseManualTime: too many parts → null', () => {
    assert.equal(parseManualTime('1:2:3:4'), null);
});

test('parseManualTime: negative input cannot occur (minus stripped)', () => {
    // '-' is stripped by the non-digit filter, so '-5' becomes '5'
    assert.equal(parseManualTime('-5'), 5);
});
