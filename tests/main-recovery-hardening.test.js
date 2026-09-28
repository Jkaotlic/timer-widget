'use strict';

/**
 * R3 fix-round-1 (2026-09-28 ПСИ, findings from review of task-1): the flag
 * gating the periodic recovery-save interval must be the SAME `!isPackaged`
 * gate as the rest of R3 — a packaged app that inherited NODE_TEST_CONTEXT
 * from its environment must still schedule the interval (main-recovery.js
 * has no security stake in that env var; only isPackaged matters). That
 * means the interval WILL be created for real while running under
 * `node --test` whenever a test mocks `isPackaged = true` (see
 * tests/electron-main-load.test.js) — so it must be `.unref()`'d, or the test
 * process cannot exit (a real, unref-less 10s setInterval is exactly what
 * hung two background test runs during the first pass of this task).
 *
 * main-recovery.js requires no electron (deps are passed in) — tested here
 * directly, spying on the global setInterval.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecoverySnapshot } = require('../main-recovery');

function withSetIntervalSpy(fn) {
    const real = global.setInterval;
    const calls = [];
    let lastHandleUnrefed = false;
    global.setInterval = (cb, ms) => {
        const handle = {
            unref: () => { lastHandleUnrefed = true; },
            // node:test считает "активный хендл" через .hasRef, если он есть —
            // подставка честно говорит «не держу цикл», раз unref() был позван.
            hasRef: () => !lastHandleUnrefed
        };
        calls.push({ ms, handle });
        return handle;
    };
    try {
        fn();
    } finally {
        global.setInterval = real;
    }
    return { calls, get lastHandleUnrefed() { return lastHandleUnrefed; } };
}

function makeDeps(inTestMode) {
    return {
        getUserDataPath: () => '/dev/null',
        getTimerState: () => ({ finished: true, isRunning: false, isPaused: false }),
        flags: { isQuitting: false },
        isAtRest: () => true,
        log: { warn: () => {}, error: () => {} },
        inTestMode
    };
}

test('R3: inTestMode=false (собранное приложение) заводит периодическую запись восстановления', () => {
    const { calls } = withSetIntervalSpy(() => {
        createRecoverySnapshot(makeDeps(false));
    });
    assert.deepEqual(calls.map((c) => c.ms), [10000], 'inTestMode=false обязан планировать интервал в 10с — это ПРОДУКШН-путь, а не тестовый');
});

test('R3: интервал восстановления unref\'нут — сам по себе не держит процесс', () => {
    const { calls } = withSetIntervalSpy(() => {
        createRecoverySnapshot(makeDeps(false));
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].handle.hasRef(), false, 'setInterval() обязан быть unref\'нут: в Electron цикл событий держат окна/IPC, а не этот таймер; под node:test с подставным isPackaged=true он был бы единственным, что мешает процессу завершиться');
});

test('inTestMode=true (обычные unit-тесты) — интервал НЕ заводится', () => {
    const { calls } = withSetIntervalSpy(() => {
        createRecoverySnapshot(makeDeps(true));
    });
    assert.deepEqual(calls, [], 'обычные тесты (isPackaged=false) не должны заводить настоящий таймер');
});
