'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tick, adjust, reset, setPreset, start, pause } = require('../timer-engine');

// Helper to build a fresh state object
function makeState(overrides = {}) {
    return {
        totalSeconds: 300,
        remainingSeconds: 300,
        presetSeconds: 300,
        isRunning: false,
        isPaused: false,
        finished: false,
        ...overrides
    };
}

// --- tick ---

test('tick: decrements remainingSeconds by 1 when > 0', () => {
    const state = makeState({ remainingSeconds: 100 });
    const { state: next, events, finished } = tick(state, { allowNegative: false });
    assert.equal(next.remainingSeconds, 99);
    assert.equal(finished, false);
    assert.deepEqual(events, []);
});

test('tick: at remainingSeconds=1, goes to 0 and finishes (no allowNegative)', () => {
    const state = makeState({ remainingSeconds: 1 });
    const { state: next, events, finished } = tick(state, { allowNegative: false });
    assert.equal(next.remainingSeconds, 0);
    assert.equal(finished, true);
    assert.equal(next.finished, true);
    assert.equal(next.isRunning, false);
    // No 'timer-reached-zero' in non-overrun mode — finishing is the signal
    assert.deepEqual(events, []);
});

test('tick: at remainingSeconds=1 with allowNegative, emits timer-reached-zero and continues', () => {
    const state = makeState({ remainingSeconds: 1 });
    const { state: next, events, finished } = tick(state, { allowNegative: true });
    assert.equal(next.remainingSeconds, 0);
    assert.equal(finished, false);
    assert.ok(events.includes('timer-reached-zero'));
});

test('tick: at remainingSeconds=0 with allowNegative=false, stays 0 and finished=true', () => {
    const state = makeState({ remainingSeconds: 0 });
    const { state: next, finished } = tick(state, { allowNegative: false });
    assert.equal(next.remainingSeconds, 0);
    assert.equal(finished, true);
    assert.equal(next.finished, true);
});

test('tick: at remainingSeconds=0 with allowNegative=true, transitions to -1 (overrun)', () => {
    const state = makeState({ remainingSeconds: 0 });
    const { state: next, events, finished } = tick(state, { allowNegative: true });
    assert.equal(next.remainingSeconds, -1);
    assert.equal(finished, false);
    // reached-zero fires only on the crossing (prevRemaining > 0), not when starting at 0
    assert.ok(!events.includes('timer-reached-zero'));
});

test('tick: during overrun, fires timer-overrun-minute every N minutes (default 1 min)', () => {
    // Crossing -60: absNext=60, absPrev=59, 60/60 > 59/60 → fires
    const state = makeState({ remainingSeconds: -59 });
    const { state: next, events } = tick(state, { allowNegative: true, overrunIntervalMinutes: 1 });
    assert.equal(next.remainingSeconds, -60);
    assert.ok(events.includes('timer-overrun-minute'));
});

test('tick: during overrun, does NOT fire overrun-minute mid-interval', () => {
    const state = makeState({ remainingSeconds: -30 });
    const { state: next, events } = tick(state, { allowNegative: true, overrunIntervalMinutes: 1 });
    assert.equal(next.remainingSeconds, -31);
    assert.ok(!events.includes('timer-overrun-minute'));
});

test('tick: overrun-minute respects overrunIntervalMinutes=5', () => {
    // 5-minute interval = 300s. Crossing -300.
    const state = makeState({ remainingSeconds: -299 });
    const { events } = tick(state, { allowNegative: true, overrunIntervalMinutes: 5 });
    assert.ok(events.includes('timer-overrun-minute'));

    // Not at -60 (would fire only if 1-min interval)
    const state2 = makeState({ remainingSeconds: -59 });
    const { events: events2 } = tick(state2, { allowNegative: true, overrunIntervalMinutes: 5 });
    assert.ok(!events2.includes('timer-overrun-minute'));
});

test('tick: overrun reaching -overrunLimitSeconds stops timer (isRunning=false)', () => {
    const state = makeState({ remainingSeconds: -299, isRunning: true });
    const { state: next, finished } = tick(state, {
        allowNegative: true,
        overrunLimitSeconds: 300
    });
    assert.equal(next.remainingSeconds, -300);
    assert.equal(finished, true);
    assert.equal(next.isRunning, false);
    assert.equal(next.finished, true);
});

test('tick: overrunLimitSeconds=0 means no limit (timer keeps going)', () => {
    const state = makeState({ remainingSeconds: -3599 });
    const { state: next, finished } = tick(state, {
        allowNegative: true,
        overrunLimitSeconds: 0
    });
    assert.equal(next.remainingSeconds, -3600);
    assert.equal(finished, false);
});

test('tick: crossing 60s threshold fires timer-minute (prev=61 → 60)', () => {
    const state = makeState({ remainingSeconds: 61 });
    const { state: next, events } = tick(state, { allowNegative: false });
    assert.equal(next.remainingSeconds, 60);
    assert.ok(events.includes('timer-minute'));
});

test('tick: timer-minute NOT fired when already below 60s', () => {
    const state = makeState({ remainingSeconds: 45 });
    const { events } = tick(state, { allowNegative: false });
    assert.ok(!events.includes('timer-minute'));
});

// --- adjust ---

test('adjust: +50 from remainingSeconds=100 → 150, totalSeconds grows if needed', () => {
    const state = makeState({ remainingSeconds: 100, totalSeconds: 100 });
    const next = adjust(state, 50, false);
    assert.equal(next.remainingSeconds, 150);
    assert.equal(next.totalSeconds, 150);
    assert.equal(next.finished, false);
});

test('adjust: +10 when totalSeconds is already larger → totalSeconds unchanged', () => {
    const state = makeState({ remainingSeconds: 100, totalSeconds: 300 });
    const next = adjust(state, 10, false);
    assert.equal(next.remainingSeconds, 110);
    assert.equal(next.totalSeconds, 300);
});

test('adjust: -20 from remainingSeconds=10, allowNegative=false → clamped to 0', () => {
    const state = makeState({ remainingSeconds: 10 });
    const next = adjust(state, -20, false);
    assert.equal(next.remainingSeconds, 0);
});

test('adjust: -20 from remainingSeconds=10, allowNegative=true → -10', () => {
    const state = makeState({ remainingSeconds: 10 });
    const next = adjust(state, -20, true);
    assert.equal(next.remainingSeconds, -10);
});

test('adjust: presetSeconds is preserved through adjustments', () => {
    const state = makeState({ remainingSeconds: 100, presetSeconds: 200 });
    const next = adjust(state, 50, false);
    assert.equal(next.presetSeconds, 200);
});

// --- reset ---

test('reset: restores remainingSeconds to presetSeconds (not totalSeconds)', () => {
    const state = makeState({
        totalSeconds: 500,       // grew via adjust
        remainingSeconds: 350,
        presetSeconds: 300       // original
    });
    const next = reset(state);
    assert.equal(next.remainingSeconds, 300);
    assert.equal(next.totalSeconds, 300);
    assert.equal(next.presetSeconds, 300);
});

test('reset: falls back to totalSeconds when presetSeconds is 0', () => {
    const state = makeState({
        totalSeconds: 120,
        remainingSeconds: 45,
        presetSeconds: 0
    });
    const next = reset(state);
    assert.equal(next.remainingSeconds, 120);
    assert.equal(next.totalSeconds, 120);
});

test('reset: clears isRunning/isPaused/finished', () => {
    const state = makeState({ isRunning: true, isPaused: false, finished: true });
    const next = reset(state);
    assert.equal(next.isRunning, false);
    assert.equal(next.isPaused, false);
    assert.equal(next.finished, false);
});

// --- setPreset ---

test('setPreset: updates all three time fields (total, remaining, preset)', () => {
    const state = makeState({ totalSeconds: 100, remainingSeconds: 50, presetSeconds: 100 });
    const next = setPreset(state, 600);
    assert.equal(next.totalSeconds, 600);
    assert.equal(next.remainingSeconds, 600);
    assert.equal(next.presetSeconds, 600);
});

test('setPreset: negative input clamped to 0', () => {
    const state = makeState();
    const next = setPreset(state, -42);
    assert.equal(next.totalSeconds, 0);
    assert.equal(next.remainingSeconds, 0);
    assert.equal(next.presetSeconds, 0);
});

test('setPreset: clears isRunning/isPaused/finished', () => {
    const state = makeState({ isRunning: true, finished: true });
    const next = setPreset(state, 120);
    assert.equal(next.isRunning, false);
    assert.equal(next.isPaused, false);
    assert.equal(next.finished, false);
});

// --- start / pause ---

test('start: sets isRunning=true, isPaused=false, finished=false', () => {
    const state = makeState({ isRunning: false, isPaused: true, finished: true });
    const next = start(state);
    assert.equal(next.isRunning, true);
    assert.equal(next.isPaused, false);
    assert.equal(next.finished, false);
});

test('pause: sets isRunning=false, isPaused=true, finished=false', () => {
    const state = makeState({ isRunning: true, isPaused: false });
    const next = pause(state);
    assert.equal(next.isRunning, false);
    assert.equal(next.isPaused, true);
    assert.equal(next.finished, false);
});

test('start/pause: do not mutate remainingSeconds or presetSeconds', () => {
    const state = makeState({ remainingSeconds: 175, presetSeconds: 300 });
    const afterStart = start(state);
    assert.equal(afterStart.remainingSeconds, 175);
    assert.equal(afterStart.presetSeconds, 300);
    const afterPause = pause(afterStart);
    assert.equal(afterPause.remainingSeconds, 175);
    assert.equal(afterPause.presetSeconds, 300);
});

// --- purity checks ---

test('all functions return new state objects (no mutation)', () => {
    const state = Object.freeze(makeState({ remainingSeconds: 100 }));
    // All of these would throw if they mutated state
    assert.doesNotThrow(() => tick(state, { allowNegative: false }));
    assert.doesNotThrow(() => adjust(state, 10, false));
    assert.doesNotThrow(() => reset(state));
    assert.doesNotThrow(() => setPreset(state, 60));
    assert.doesNotThrow(() => start(state));
    assert.doesNotThrow(() => pause(state));
});
