const test = require('node:test');
const assert = require('node:assert/strict');
const { getTimerStatus, calculateProgress } = require('../utils');

test('getTimerStatus returns correct status', () => {
    assert.equal(getTimerStatus(120, 300), 'normal');
    assert.equal(getTimerStatus(60, 300), 'warning');
    assert.equal(getTimerStatus(1, 300), 'warning');
    assert.equal(getTimerStatus(0, 300), 'danger');
    assert.equal(getTimerStatus(-1, 300), 'overtime');
});

test('calculateProgress clamps 0..1 and handles edge cases', () => {
    assert.equal(calculateProgress(0, 0), 0);
    assert.equal(calculateProgress(10, 0), 0);
    assert.equal(calculateProgress(-1, 100), 0);
    assert.equal(calculateProgress(100, 100), 1);
    assert.equal(calculateProgress(50, 100), 0.5);
    assert.equal(calculateProgress(150, 100), 1);
});
