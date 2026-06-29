'use strict';

/**
 * timer-controller.test.js
 *
 * Tests the timer state machine extracted from electron-main.js. Uses the REAL
 * timer-engine (injected) plus a fake clock + fake scheduler so the reconcile /
 * reset-race-guard / anchor logic is fully deterministic and synchronous.
 *
 * The glue covered here (reconcile wall-clock catch-up, reset race-guard,
 * adjust+re-anchor, start guard, setConfig merge, updateCounter monotonicity,
 * single-fire boundary events) was previously untestable inline in electron-main.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../timer-engine');
const { createTimerController } = require('../timer-controller');

// Build a controller wired to a fake clock + spies. Returns the controller plus
// the spy buffers and clock controls.
function makeHarness(initial = {}) {
    let nowMs = initial.startMs !== undefined ? initial.startMs : 1_000_000;
    const states = [];   // every onState payload, in order
    const events = [];   // every onEvent name, in order
    // Fake scheduler: capture pending callbacks so tests can flush them on demand.
    const pending = [];
    const scheduler = {
        setTimeout: (fn, _ms) => { pending.push(fn); return pending.length - 1; },
        clearTimeout: () => {}
    };

    const controller = createTimerController({
        engine,
        now: () => nowMs,
        onState: (s) => states.push(s),
        onEvent: (n) => events.push(n),
        scheduler
    });

    return {
        controller,
        states,
        events,
        // Advance the fake clock by N seconds (wall-clock).
        advance: (sec) => { nowMs += sec * 1000; },
        advanceMs: (ms) => { nowMs += ms; },
        setNow: (ms) => { nowMs = ms; },
        // Run all captured scheduler callbacks (e.g. the reset-guard release).
        flushTimers: () => { const fns = pending.splice(0); fns.forEach((fn) => fn()); },
        pendingCount: () => pending.length
    };
}

// --- factory contract ---

test('factory throws without a valid engine', () => {
    assert.throws(() => createTimerController({}), /requires an engine/);
    assert.throws(() => createTimerController({ engine: {} }), /requires an engine/);
});

test('initial state has the broadcast-ready shape', () => {
    const { controller } = makeHarness();
    const s = controller.getState();
    for (const key of ['totalSeconds', 'remainingSeconds', 'presetSeconds',
        'isRunning', 'isPaused', 'finished', 'timestamp', 'updateCounter']) {
        assert.ok(key in s, `missing key ${key}`);
    }
    assert.equal(s.updateCounter, 0);
});

// --- patch / emitTimerState equivalent ---

test('patch: stamps config fields, timestamp, and bumps counter once', () => {
    const h = makeHarness({ startMs: 5000 });
    h.controller.setConfig({ allowNegative: true, overrunLimitSeconds: 120 });
    const out = h.controller.patch({ remainingSeconds: 42 });
    assert.equal(out.remainingSeconds, 42);
    assert.equal(out.overrunLimitSeconds, 120);
    assert.equal(out.allowNegative, true);
    assert.equal(out.timestamp, 5000);
    assert.equal(out.updateCounter, 1);
    assert.equal(h.states.length, 1);
    assert.equal(h.states[0], out);
});

test('updateCounter is strictly monotonic — one increment per emit', () => {
    const h = makeHarness();
    h.controller.patch({});
    h.controller.patch({});
    h.controller.setPreset(60);   // one emit
    h.controller.patch({});
    const counters = h.states.map((s) => s.updateCounter);
    assert.deepEqual(counters, [1, 2, 3, 4]);
    // strictly increasing
    for (let i = 1; i < counters.length; i++) {
        assert.ok(counters[i] > counters[i - 1]);
    }
});

// --- setConfig merge + Infinity guards ---

test('setConfig: merges booleans/numbers and reports change', () => {
    const h = makeHarness();
    assert.equal(h.controller.setConfig({ allowNegative: true }), true);
    assert.equal(h.controller.getConfig().allowNegative, true);
    // Same value again → no change reported.
    assert.equal(h.controller.setConfig({ allowNegative: true }), false);
    // overrun limit: 120 differs from the default 0 → change reported.
    assert.equal(h.controller.setConfig({ overrunLimitSeconds: 120 }), true);
    assert.equal(h.controller.getConfig().overrunLimitSeconds, 120);
    // clamps to >= 0; -50 → 0, which now differs from 120 → change reported.
    assert.equal(h.controller.setConfig({ overrunLimitSeconds: -50 }), true);
    assert.equal(h.controller.getConfig().overrunLimitSeconds, 0);
    // interval minutes: 5 differs from default 1 → change reported.
    assert.equal(h.controller.setConfig({ overrunIntervalMinutes: 5 }), true);
    assert.equal(h.controller.getConfig().overrunIntervalMinutes, 5);
    // clamps to >= 1; 0 → 1, which differs from current 5 → change reported.
    assert.equal(h.controller.setConfig({ overrunIntervalMinutes: 0 }), true);
    assert.equal(h.controller.getConfig().overrunIntervalMinutes, 1);
});

test('setConfig: Infinity / NaN guards fall back to safe defaults', () => {
    const h = makeHarness();
    h.controller.setConfig({ overrunLimitSeconds: Infinity, overrunIntervalMinutes: NaN });
    assert.equal(h.controller.getConfig().overrunLimitSeconds, 0);
    assert.equal(h.controller.getConfig().overrunIntervalMinutes, 1);
    // String numbers coerce; non-numeric → default.
    h.controller.setConfig({ overrunLimitSeconds: '90', overrunIntervalMinutes: 'abc' });
    assert.equal(h.controller.getConfig().overrunLimitSeconds, 90);
    assert.equal(h.controller.getConfig().overrunIntervalMinutes, 1);
});

test('setConfig: ignores null / non-object payloads', () => {
    const h = makeHarness();
    assert.equal(h.controller.setConfig(null), false);
    assert.equal(h.controller.setConfig(undefined), false);
    assert.equal(h.controller.setConfig(42), false);
});

test('setConfig: does NOT emit on its own (no onState call)', () => {
    const h = makeHarness();
    h.controller.setConfig({ allowNegative: true });
    assert.equal(h.states.length, 0);
});

// --- setPreset ---

test('setPreset: sets all three time fields and emits; reports true', () => {
    const h = makeHarness();
    const acted = h.controller.setPreset(300);
    assert.equal(acted, true);
    const s = h.controller.getState();
    assert.equal(s.totalSeconds, 300);
    assert.equal(s.remainingSeconds, 300);
    assert.equal(s.presetSeconds, 300);
    assert.equal(h.states.length, 1);
});

test('setPreset: is a no-op while running and reports false', () => {
    const h = makeHarness();
    h.controller.setPreset(300);
    h.controller.start();
    const before = h.controller.getState().updateCounter;
    const acted = h.controller.setPreset(999);
    assert.equal(acted, false);
    assert.equal(h.controller.getState().remainingSeconds, 300);
    assert.equal(h.controller.getState().updateCounter, before); // no emit
});

// --- start guard (handleTimerStart) ---

test('start: remaining=0 and no overrun → finishes, does NOT run, returns false', () => {
    const h = makeHarness();
    // remaining stays 0 (default)
    const ran = h.controller.start();
    assert.equal(ran, false);
    const s = h.controller.getState();
    assert.equal(s.isRunning, false);
    assert.equal(s.finished, true);
    assert.equal(s.remainingSeconds, 0);
});

test('start: remaining>0 → runs and returns true', () => {
    const h = makeHarness();
    h.controller.setPreset(60);
    const ran = h.controller.start();
    assert.equal(ran, true);
    assert.equal(h.controller.getState().isRunning, true);
});

test('start: remaining=0 but allowNegative → runs (overrun mode)', () => {
    const h = makeHarness();
    h.controller.setConfig({ allowNegative: true });
    const ran = h.controller.start();
    assert.equal(ran, true);
    assert.equal(h.controller.getState().isRunning, true);
});

test('start: already running → returns false, no second emit', () => {
    const h = makeHarness();
    h.controller.setPreset(60);
    assert.equal(h.controller.start(), true);
    const counter = h.controller.getState().updateCounter;
    assert.equal(h.controller.start(), false);
    assert.equal(h.controller.getState().updateCounter, counter);
});

// --- pause ---

test('pause: clears running, sets paused', () => {
    const h = makeHarness();
    h.controller.setPreset(60);
    h.controller.start();
    h.controller.pause();
    const s = h.controller.getState();
    assert.equal(s.isRunning, false);
    assert.equal(s.isPaused, true);
    assert.equal(s.finished, false);
});

// --- reconcile: wall-clock catch-up ---

test('reconcile: no-op when not running', () => {
    const h = makeHarness();
    h.controller.setPreset(60);
    assert.equal(h.controller.reconcile(), false);
    assert.equal(h.states.length, 1); // only the setPreset emit
});

test('reconcile: no whole second elapsed → no-op (no emit)', () => {
    const h = makeHarness();
    h.controller.setPreset(60);
    h.controller.start();
    const counter = h.controller.getState().updateCounter;
    h.advanceMs(500); // half a second
    assert.equal(h.controller.reconcile(), false);
    assert.equal(h.controller.getState().updateCounter, counter); // nothing emitted
    assert.equal(h.controller.getState().remainingSeconds, 60);
});

test('reconcile: single second elapsed decrements by exactly one', () => {
    const h = makeHarness();
    h.controller.setPreset(60);
    h.controller.start();
    h.advance(1);
    assert.equal(h.controller.reconcile(), false);
    assert.equal(h.controller.getState().remainingSeconds, 59);
});

test('reconcile: multi-second catch-up after sleep advances by elapsed whole seconds', () => {
    const h = makeHarness();
    h.controller.setPreset(600);
    h.controller.start();
    // Simulate a 125-second sleep before the next tick fires.
    h.advance(125);
    assert.equal(h.controller.reconcile(), false);
    assert.equal(h.controller.getState().remainingSeconds, 475);
});

test('reconcile: catch-up past zero (no overrun) floors at 0, finishes, returns true', () => {
    const h = makeHarness();
    h.controller.setPreset(10);
    h.controller.start();
    h.advance(600); // way past zero
    assert.equal(h.controller.reconcile(), true);
    const s = h.controller.getState();
    assert.equal(s.remainingSeconds, 0);
    assert.equal(s.finished, true);
    assert.equal(s.isRunning, false);
});

test('reconcile: repeated calls keep wall-clock accuracy (no drift)', () => {
    const h = makeHarness();
    h.controller.setPreset(100);
    h.controller.start();
    // Tick 3 times, 1s each.
    for (let i = 0; i < 3; i++) { h.advance(1); h.controller.reconcile(); }
    assert.equal(h.controller.getState().remainingSeconds, 97);
    // Now a 10s gap, then a normal tick.
    h.advance(10);
    h.controller.reconcile();
    assert.equal(h.controller.getState().remainingSeconds, 87);
});

// --- boundary events fire once ---

test('reconcile: timer-minute fires exactly once on the 60s crossing', () => {
    const h = makeHarness();
    h.controller.setPreset(62);
    h.controller.start();
    h.advance(2); // 62 → 60
    h.controller.reconcile();
    assert.equal(h.events.filter((e) => e === 'timer-minute').length, 1);
    assert.equal(h.controller.getState().remainingSeconds, 60);
});

test('reconcile: a long sleep across the 60s boundary still fires timer-minute once', () => {
    const h = makeHarness();
    h.controller.setPreset(120);
    h.controller.start();
    h.advance(90); // 120 → 30, crossing 60 once
    h.controller.reconcile();
    assert.equal(h.events.filter((e) => e === 'timer-minute').length, 1);
});

test('reconcile: timer-reached-zero fires once when crossing zero in overrun', () => {
    const h = makeHarness();
    h.controller.setConfig({ allowNegative: true });
    h.controller.setPreset(5);
    h.controller.start();
    h.advance(20); // 5 → -15
    assert.equal(h.controller.reconcile(), false); // overrun, not finished
    assert.equal(h.events.filter((e) => e === 'timer-reached-zero').length, 1);
    assert.equal(h.controller.getState().remainingSeconds, -15);
});

test('reconcile: overrun-minute fires once even after a long sleep', () => {
    const h = makeHarness();
    h.controller.setConfig({ allowNegative: true, overrunIntervalMinutes: 1 });
    h.controller.setPreset(0);
    h.controller.start();
    h.advance(630); // 0 → -630, would be 10 minutes of overrun
    h.controller.reconcile();
    // Single crossing comparison — never one event per skipped minute.
    assert.equal(h.events.filter((e) => e === 'timer-overrun-minute').length, 1);
});

test('reconcile: overrun hard limit finishes and returns true', () => {
    const h = makeHarness();
    h.controller.setConfig({ allowNegative: true, overrunLimitSeconds: 30 });
    h.controller.setPreset(0);
    h.controller.start();
    h.advance(100);
    assert.equal(h.controller.reconcile(), true);
    const s = h.controller.getState();
    assert.equal(s.remainingSeconds, -30);
    assert.equal(s.isRunning, false);
    assert.equal(s.finished, true);
});

// --- adjust + re-anchor ---

test('adjust: while running re-anchors so the next reconcile does not undo it', () => {
    const h = makeHarness();
    h.controller.setPreset(100);
    h.controller.start();
    // 3 seconds pass and a tick lands → 97.
    h.advance(3);
    h.controller.reconcile();
    assert.equal(h.controller.getState().remainingSeconds, 97);
    // User adds 30s on the fly. New remaining = 127, and we re-anchor at "now".
    h.controller.adjust(30);
    assert.equal(h.controller.getState().remainingSeconds, 127);
    // Immediately reconciling (no wall-clock time passed since adjust) must NOT
    // "correct" the +30 away.
    assert.equal(h.controller.reconcile(), false);
    assert.equal(h.controller.getState().remainingSeconds, 127);
    // One more real second → 126 (counts from the new anchor, not the old one).
    h.advance(1);
    h.controller.reconcile();
    assert.equal(h.controller.getState().remainingSeconds, 126);
});

test('adjust: while paused does not re-anchor but still updates state', () => {
    const h = makeHarness();
    h.controller.setPreset(100);
    // not running
    h.controller.adjust(-40);
    assert.equal(h.controller.getState().remainingSeconds, 60);
    assert.equal(h.controller.getState().totalSeconds, 100);
});

test('adjust: non-finite delta is treated as 0 (engine guard preserved)', () => {
    const h = makeHarness();
    h.controller.setPreset(100);
    h.controller.adjust(Infinity);
    assert.equal(h.controller.getState().remainingSeconds, 100);
    h.controller.adjust(NaN);
    assert.equal(h.controller.getState().remainingSeconds, 100);
});

// --- reset + race guard ---

test('reset: restores to presetSeconds and clears flags', () => {
    const h = makeHarness();
    h.controller.setPreset(300);
    h.controller.start();
    h.advance(50);
    h.controller.reconcile(); // → 250
    h.controller.reset();
    const s = h.controller.getState();
    assert.equal(s.remainingSeconds, 300);
    assert.equal(s.totalSeconds, 300);
    assert.equal(s.isRunning, false);
    assert.equal(s.finished, false);
});

test('reset: race guard blocks a second reset within the ~100ms window', () => {
    const h = makeHarness();
    h.controller.setPreset(300);
    h.controller.adjust(100); // remaining 400, total 400, preset still 300
    const counterBefore = h.controller.getState().updateCounter;

    h.controller.reset();              // first reset emits
    const counterAfterFirst = h.controller.getState().updateCounter;
    assert.equal(counterAfterFirst, counterBefore + 1);
    assert.equal(h.controller.getState().remainingSeconds, 300);

    // Mutate again then attempt a concurrent reset — should be ignored (guarded).
    h.controller.adjust(100); // remaining 400 again
    const counterMid = h.controller.getState().updateCounter;
    h.controller.reset();
    assert.equal(h.controller.getState().updateCounter, counterMid); // no emit
    assert.equal(h.controller.getState().remainingSeconds, 400);     // unchanged

    // Release the guard (scheduler callback) → reset works again.
    h.flushTimers();
    h.controller.reset();
    assert.equal(h.controller.getState().remainingSeconds, 300);
});

test('reset: guard schedules exactly one release per reset', () => {
    const h = makeHarness();
    h.controller.setPreset(60);
    h.controller.reset();
    assert.equal(h.pendingCount(), 1);
    h.flushTimers();
    assert.equal(h.pendingCount(), 0);
});

// --- restoreState (crash recovery) ---

test('restoreState: writes preset/total/remaining without emitting or bumping counter', () => {
    const h = makeHarness();
    const before = h.controller.getState().updateCounter;
    h.controller.restoreState({ presetSeconds: 200, totalSeconds: 200, remainingSeconds: 150 });
    const s = h.controller.getState();
    assert.equal(s.presetSeconds, 200);
    assert.equal(s.totalSeconds, 200);
    assert.equal(s.remainingSeconds, 150);
    assert.equal(s.updateCounter, before); // no bump
    assert.equal(h.states.length, 0);      // no emit
});

test('restoreState: ignores non-finite total/remaining but keeps preset', () => {
    const h = makeHarness();
    h.controller.restoreState({ presetSeconds: 90, totalSeconds: Infinity, remainingSeconds: NaN });
    const s = h.controller.getState();
    assert.equal(s.presetSeconds, 90);
    assert.equal(s.totalSeconds, 0);       // unchanged default
    assert.equal(s.remainingSeconds, 0);   // unchanged default
});

test('restoreState: ignores null / non-object input', () => {
    const h = makeHarness();
    assert.doesNotThrow(() => h.controller.restoreState(null));
    assert.doesNotThrow(() => h.controller.restoreState(42));
});

// --- integration: a full run cycle drives onState correctly ---

test('integration: set → start → tick → pause → reset emits a coherent sequence', () => {
    const h = makeHarness();
    h.controller.setPreset(5);          // emit 1
    assert.equal(h.controller.start(), true); // emit 2 (running)
    h.advance(1); h.controller.reconcile();   // emit 3 → 4
    h.advance(1); h.controller.reconcile();   // emit 4 → 3
    h.controller.pause();               // emit (paused)
    assert.equal(h.controller.getState().remainingSeconds, 3);
    assert.equal(h.controller.getState().isPaused, true);
    h.controller.reset();               // emit (reset to 5)
    assert.equal(h.controller.getState().remainingSeconds, 5);
    // counters strictly increasing across the whole sequence
    const counters = h.states.map((s) => s.updateCounter);
    for (let i = 1; i < counters.length; i++) {
        assert.ok(counters[i] > counters[i - 1], `counter not monotonic at ${i}`);
    }
});
