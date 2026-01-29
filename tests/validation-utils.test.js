const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidNumber, clamp } = require('../utils');

test('isValidNumber accepts finite numbers only', () => {
    assert.equal(isValidNumber(0), true);
    assert.equal(isValidNumber(1.5), true);
    assert.equal(isValidNumber(-10), true);
    assert.equal(isValidNumber(NaN), false);
    assert.equal(isValidNumber(Infinity), false);
    assert.equal(isValidNumber('1'), false);
});

test('clamp restricts values to range', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(11, 0, 10), 10);
});
