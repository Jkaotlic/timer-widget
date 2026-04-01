const test = require('node:test');
const assert = require('node:assert/strict');
const { getTimerStatus, calculateProgress, parseTime, isValidNumber, clamp } = require('../utils');

// --- getTimerStatus edge cases ---

test('getTimerStatus: totalSeconds=0 and remainingSeconds=0 returns normal', () => {
    assert.equal(getTimerStatus(0, 0), 'normal');
});

test('getTimerStatus: very large remaining returns normal', () => {
    assert.equal(getTimerStatus(1_000_000, 2_000_000), 'normal');
});

test('getTimerStatus: exactly 60 seconds returns warning', () => {
    assert.equal(getTimerStatus(60, 300), 'warning');
});

test('getTimerStatus: 61 seconds returns normal', () => {
    assert.equal(getTimerStatus(61, 300), 'normal');
});

test('getTimerStatus: fractional seconds', () => {
    assert.equal(getTimerStatus(0.5, 100), 'warning');
    assert.equal(getTimerStatus(-0.1, 100), 'overtime');
});

// --- calculateProgress edge cases ---

test('calculateProgress: overtime returns 0', () => {
    assert.equal(calculateProgress(-10, 100), 0);
});

test('calculateProgress: remaining exceeds total clamps to 1', () => {
    assert.equal(calculateProgress(200, 100), 1);
});

test('calculateProgress: halfway', () => {
    assert.equal(calculateProgress(50, 100), 0.5);
});

test('calculateProgress: both zero returns 0', () => {
    assert.equal(calculateProgress(0, 0), 0);
});

// --- parseTime edge cases ---

test('parseTime: empty string returns 0', () => {
    assert.equal(parseTime(''), 0);
});

test('parseTime: null returns 0', () => {
    assert.equal(parseTime(null), 0);
});

test('parseTime: non-string returns 0', () => {
    assert.equal(parseTime(123), 0);
    assert.equal(parseTime(undefined), 0);
});

test('parseTime: non-numeric parts treated as 0', () => {
    assert.equal(parseTime('abc:xyz'), 0);
});

test('parseTime: large values beyond normal range', () => {
    assert.equal(parseTime('99:99:99'), 99 * 3600 + 99 * 60 + 99);
});

// --- isValidNumber ---

test('isValidNumber: accepts finite numbers', () => {
    assert.equal(isValidNumber(0), true);
    assert.equal(isValidNumber(42), true);
    assert.equal(isValidNumber(-1.5), true);
});

test('isValidNumber: rejects NaN, Infinity, non-numbers', () => {
    assert.equal(isValidNumber(NaN), false);
    assert.equal(isValidNumber(Infinity), false);
    assert.equal(isValidNumber(-Infinity), false);
    assert.equal(isValidNumber('42'), false);
    assert.equal(isValidNumber(null), false);
    assert.equal(isValidNumber(undefined), false);
});

// --- clamp ---

test('clamp: restricts within range', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
    assert.equal(clamp(0, 0, 0), 0);
});
