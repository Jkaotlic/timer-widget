'use strict';

/**
 * perf.test.js — performance benchmarks for timer-engine and core utilities.
 *
 * Each benchmark measures wall-time (via performance.now()) for a batch of
 * calls and asserts a generous upper bound that should pass on any machine,
 * including slow CI runners. The console.log output is the actual baseline —
 * capture it into docs/PERFORMANCE.md after a run.
 *
 * Run only the benchmarks:
 *   node --test tests/perf.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { tick, adjust, reset, setPreset, start, pause } = require('../timer-engine.js');
const { formatTime, debounce } = require('../utils.js');

function makeRunningState(seconds) {
    let state = {
        totalSeconds: 0,
        remainingSeconds: 0,
        presetSeconds: 0,
        isRunning: false,
        isPaused: false,
        finished: false,
        updateCounter: 0
    };
    state = setPreset(state, seconds);
    state = start(state);
    return state;
}

test('benchmark: tick() 1M iterations (positive countdown)', () => {
    let state = makeRunningState(3600);
    const config = { allowNegative: false, overrunLimitSeconds: 0, overrunIntervalMinutes: 1 };

    const ITERATIONS = 1_000_000;
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        const result = tick(state, config);
        state = result.state;
        if (state.remainingSeconds <= 0) {
            // Refill so we don't measure the finished branch repeatedly
            state = start(setPreset(state, 3600));
        }
    }
    const elapsed = performance.now() - t0;
    const perCallUs = (elapsed * 1000) / ITERATIONS;
    console.log(`[perf] tick() x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms (${perCallUs.toFixed(4)}µs/call)`);

    // Very generous threshold. Expected ~100-300ms on a modern laptop.
    assert.ok(elapsed < 5000, `tick() too slow: ${elapsed.toFixed(2)}ms for ${ITERATIONS} iterations`);
});

test('benchmark: tick() 500k iterations with allowNegative (overrun branch)', () => {
    let state = makeRunningState(10);
    const config = { allowNegative: true, overrunLimitSeconds: 3600, overrunIntervalMinutes: 1 };

    const ITERATIONS = 500_000;
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        const result = tick(state, config);
        state = result.state;
        if (result.finished) {
            state = start(setPreset(state, 10));
        }
    }
    const elapsed = performance.now() - t0;
    const perCallUs = (elapsed * 1000) / ITERATIONS;
    console.log(`[perf] tick(overrun) x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms (${perCallUs.toFixed(4)}µs/call)`);

    assert.ok(elapsed < 5000, `tick(overrun) too slow: ${elapsed.toFixed(2)}ms`);
});

test('benchmark: adjust() 100k iterations', () => {
    let state = makeRunningState(300);
    const ITERATIONS = 100_000;

    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        state = adjust(state, (i % 2 === 0) ? 30 : -30, true);
    }
    const elapsed = performance.now() - t0;
    const perCallUs = (elapsed * 1000) / ITERATIONS;
    console.log(`[perf] adjust() x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms (${perCallUs.toFixed(4)}µs/call)`);

    assert.ok(elapsed < 1000, `adjust() too slow: ${elapsed.toFixed(2)}ms`);
});

test('benchmark: reset() 100k iterations', () => {
    let state = makeRunningState(300);
    const ITERATIONS = 100_000;

    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        state = reset(state);
    }
    const elapsed = performance.now() - t0;
    const perCallUs = (elapsed * 1000) / ITERATIONS;
    console.log(`[perf] reset() x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms (${perCallUs.toFixed(4)}µs/call)`);

    assert.ok(elapsed < 1000, `reset() too slow: ${elapsed.toFixed(2)}ms`);
});

test('benchmark: setPreset() + start() + pause() cycle 100k iterations', () => {
    let state = makeRunningState(0);
    const ITERATIONS = 100_000;

    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        state = setPreset(state, 60 + (i % 3600));
        state = start(state);
        state = pause(state);
    }
    const elapsed = performance.now() - t0;
    const perCycleUs = (elapsed * 1000) / ITERATIONS;
    console.log(`[perf] setPreset+start+pause x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms (${perCycleUs.toFixed(4)}µs/cycle)`);

    assert.ok(elapsed < 1500, `lifecycle cycle too slow: ${elapsed.toFixed(2)}ms`);
});

test('benchmark: formatTime() 1M iterations', () => {
    const ITERATIONS = 1_000_000;
    let sink = '';

    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        // Mix of positive, zero, and overrun values
        const seconds = ((i % 7200) - 1800);
        sink = formatTime(seconds);
    }
    const elapsed = performance.now() - t0;
    const perCallUs = (elapsed * 1000) / ITERATIONS;
    console.log(`[perf] formatTime() x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms (${perCallUs.toFixed(4)}µs/call)`);

    // Keep sink reachable so the call isn't optimized away
    assert.equal(typeof sink, 'string');
    assert.ok(elapsed < 5000, `formatTime() too slow: ${elapsed.toFixed(2)}ms`);
});

test('benchmark: debounce() dispatch overhead 100k immediate calls', () => {
    let hits = 0;
    const fn = debounce(() => { hits++; }, 50);
    const ITERATIONS = 100_000;

    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        fn(i);
    }
    const elapsed = performance.now() - t0;
    const perCallUs = (elapsed * 1000) / ITERATIONS;
    console.log(`[perf] debounce() x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms (${perCallUs.toFixed(4)}µs/call), hits=${hits}`);

    assert.ok(elapsed < 2000, `debounce() too slow: ${elapsed.toFixed(2)}ms`);
});

test('benchmark: state immutability — no memory leak across 1M ticks', () => {
    // Warm up + force a GC if exposed (node --expose-gc)
    let state = makeRunningState(3600);
    const config = { allowNegative: true, overrunLimitSeconds: 0, overrunIntervalMinutes: 5 };

    // Warmup (prime the JIT, stabilize heap)
    for (let i = 0; i < 50_000; i++) {
        const r = tick(state, config);
        state = r.state;
        if (r.finished) { state = start(setPreset(state, 3600)); }
    }
    if (global.gc) { global.gc(); }

    const memBefore = process.memoryUsage();

    const ITERATIONS = 1_000_000;
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        const r = tick(state, config);
        state = r.state;
        if (r.finished) { state = start(setPreset(state, 3600)); }
    }
    const elapsed = performance.now() - t0;

    if (global.gc) { global.gc(); }
    const memAfter = process.memoryUsage();

    const heapDeltaMB = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
    const rssDeltaMB = (memAfter.rss - memBefore.rss) / 1024 / 1024;

    console.log(
        `[perf] immutability x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms, ` +
        `heapΔ=${heapDeltaMB.toFixed(2)}MB rssΔ=${rssDeltaMB.toFixed(2)}MB`
    );

    // Each tick allocates a new state object. After 1M ticks + GC, retained
    // heap growth should stay modest. Without --expose-gc the numbers can be
    // noisier, so the bound is intentionally very generous.
    assert.ok(heapDeltaMB < 100, `heap grew too much: ${heapDeltaMB.toFixed(2)}MB`);
    assert.ok(elapsed < 10_000, `immutability run too slow: ${elapsed.toFixed(2)}ms`);
});

test('benchmark: broadcast simulation — emitTimerState shape build x100k', () => {
    // Simulate the object-spread + timestamp pattern used in electron-main.js
    // emitTimerState() — measures pure JS overhead (no IPC).
    let timerState = {
        totalSeconds: 0,
        remainingSeconds: 0,
        presetSeconds: 0,
        isRunning: false,
        isPaused: false,
        finished: false,
        timestamp: Date.now(),
        updateCounter: 0
    };
    const timerConfig = { allowNegative: true, overrunLimitSeconds: 3600, overrunIntervalMinutes: 1 };
    let counter = 0;

    const ITERATIONS = 100_000;
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        counter++;
        timerState = {
            ...timerState,
            remainingSeconds: i,
            overrunLimitSeconds: timerConfig.overrunLimitSeconds,
            allowNegative: timerConfig.allowNegative,
            timestamp: Date.now(),
            updateCounter: counter
        };
    }
    const elapsed = performance.now() - t0;
    const perBuildUs = (elapsed * 1000) / ITERATIONS;
    console.log(`[perf] emitTimerState build x${ITERATIONS.toLocaleString()}: ${elapsed.toFixed(2)}ms (${perBuildUs.toFixed(4)}µs/build)`);

    assert.equal(timerState.updateCounter, ITERATIONS);
    assert.ok(elapsed < 2000, `state-build too slow: ${elapsed.toFixed(2)}ms`);
});
