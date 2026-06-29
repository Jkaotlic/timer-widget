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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isRecoveryValid, saveTimerStateToFileSync, loadSavedTimerState, getRecoveryStatePath } = require('../recovery.js');

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

// --- saveTimerStateToFileSync (crash-handler path) ---

test('saveTimerStateToFileSync: writes a readable snapshot synchronously', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-recovery-'));
    try {
        const state = { totalSeconds: 300, remainingSeconds: 142, presetSeconds: 300, isRunning: true };
        saveTimerStateToFileSync(dir, state, null);

        // File exists immediately after the call returns (no async flush to await).
        const statePath = getRecoveryStatePath(dir);
        assert.equal(fs.existsSync(statePath), true);

        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        assert.equal(parsed.totalSeconds, 300);
        assert.equal(parsed.remainingSeconds, 142);
        assert.equal(parsed.presetSeconds, 300);
        assert.equal(parsed.isRunning, true);
        assert.equal(typeof parsed.savedAt, 'number');

        // And it round-trips through the loader as a valid recovery candidate.
        const loaded = loadSavedTimerState(dir, null);
        assert.equal(loaded.remainingSeconds, 142);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('saveTimerStateToFileSync: swallows errors on a bad path (best-effort, no throw)', () => {
    const badDir = path.join(os.tmpdir(), 'tw-recovery-does-not-exist', 'nested', 'deeper');
    assert.doesNotThrow(() => {
        saveTimerStateToFileSync(badDir, { totalSeconds: 1, remainingSeconds: 1, presetSeconds: 1, isRunning: false }, null);
    });
});
