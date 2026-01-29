const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTime, formatTimeShort, parseTime } = require('../utils');

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
