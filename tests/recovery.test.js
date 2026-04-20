'use strict';

/**
 * Crash-recovery validation tests.
 *
 * Exercises the pure isRecoveryValid() helper exported from recovery.js.
 * The helper decides whether a saved last-state.json is worth restoring,
 * with no Electron APIs — so we require recovery.js directly under
 * plain `node --test`, no stubs needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { isRecoveryValid } = require('../recovery.js');

const NOW = 1_700_000_000_000;

test('isRecoveryValid: null / undefined / non-object → false', () => {
    assert.equal(isRecoveryValid(null, NOW), false);
    assert.equal(isRecoveryValid(undefined, NOW), false);
    assert.equal(isRecoveryValid('string', NOW), false);
    assert.equal(isRecoveryValid(42, NOW), false);
});

test('isRecoveryValid: missing savedAt → false', () => {
    assert.equal(isRecoveryValid({ presetSeconds: 300 }, NOW), false);
});

test('isRecoveryValid: savedAt in the future → false', () => {
    const data = { savedAt: NOW + 10_000, presetSeconds: 300 };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: savedAt older than 5 minutes → false', () => {
    const data = { savedAt: NOW - 6 * 60 * 1000, presetSeconds: 300 };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: savedAt exactly 5 minutes → false (strictly older than)', () => {
    const data = { savedAt: NOW - 5 * 60 * 1000 - 1, presetSeconds: 300 };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: fresh savedAt + valid preset → true', () => {
    const data = { savedAt: NOW - 30_000, presetSeconds: 300 };
    assert.equal(isRecoveryValid(data, NOW), true);
});

test('isRecoveryValid: negative presetSeconds → false', () => {
    const data = { savedAt: NOW - 10_000, presetSeconds: -1 };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: non-number presetSeconds → false', () => {
    const data = { savedAt: NOW - 10_000, presetSeconds: 'oops' };
    assert.equal(isRecoveryValid(data, NOW), false);
});

test('isRecoveryValid: presetSeconds=0 accepted (valid edge)', () => {
    const data = { savedAt: NOW - 10_000, presetSeconds: 0 };
    assert.equal(isRecoveryValid(data, NOW), true);
});

test('isRecoveryValid: uses Date.now() when now arg omitted', () => {
    const data = { savedAt: Date.now() - 1000, presetSeconds: 60 };
    assert.equal(isRecoveryValid(data), true);
});
