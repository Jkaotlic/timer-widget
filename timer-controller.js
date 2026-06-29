'use strict';

/**
 * timer-controller.js
 *
 * The timer state machine, extracted from electron-main.js so it can be unit
 * tested with a fake clock. NO Electron APIs, NO IPC, NO real setInterval.
 *
 * It owns the mutable timer state, the timer config, the monotonic update
 * counter, and the wall-clock anchors used for drift-free countdown. It does
 * NOT own the real interval — electron-main keeps `setInterval(...)` and calls
 * `controller.reconcile()` each tick. This keeps the controller synchronously
 * testable with an injected `now()` clock.
 *
 * Dependencies are injected via the factory so tests can supply a fake clock
 * and spy callbacks:
 *
 *   createTimerController({ engine, now, onState, onEvent, scheduler })
 *
 *   - engine    : require('./timer-engine') — the pure arithmetic module.
 *   - now       : () => number — wall-clock source (electron-main: Date.now).
 *   - onState   : (state) => void — fired on every state emit with the FULL,
 *                 broadcast-ready state object. electron-main does the actual
 *                 safelySendToWindow(...) to the 4 windows + tray update here.
 *   - onEvent   : (name) => void — fired for boundary events
 *                 ('timer-reached-zero' / 'timer-minute' / 'timer-overrun-minute')
 *                 so electron-main can broadcast them.
 *   - scheduler : { setTimeout, clearTimeout } — optional; defaults to global
 *                 timers. Used only for the reset race-guard window so tests can
 *                 drive it deterministically.
 *
 * patch() is the emitTimerState equivalent: merge partial → stamp
 * overrunLimitSeconds/allowNegative/timestamp/updateCounter → bump counter →
 * onState. The broadcast payload shape is byte-identical to the previous
 * inline emitTimerState in electron-main.js.
 */

function createTimerController(deps = {}) {
    const engine = deps.engine;
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const onState = typeof deps.onState === 'function' ? deps.onState : () => {};
    const onEvent = typeof deps.onEvent === 'function' ? deps.onEvent : () => {};
    const scheduler = deps.scheduler || { setTimeout, clearTimeout };

    if (!engine || typeof engine.tick !== 'function') {
        throw new Error('createTimerController requires an engine with a tick() method');
    }

    // FIX BUG-012: monotonic counter instead of timestamp for reliable sync.
    let timerUpdateCounter = 0;

    let timerState = {
        totalSeconds: 0,
        remainingSeconds: 0,
        presetSeconds: 0,  // Оригинальное время пресета (для корректного сброса)
        isRunning: false,
        isPaused: false,
        finished: false,
        timestamp: now(),
        updateCounter: 0   // Монотонный счетчик для надежной синхронизации
    };

    let timerConfig = {
        allowNegative: false,
        overrunLimitSeconds: 0,
        overrunIntervalMinutes: 1
    };

    // Wall-clock anchor for drift-free countdown. We never assume exactly one
    // second elapsed per interval fire; instead each reconcile computes how many
    // whole seconds SHOULD have passed since the anchor and advances the engine
    // by that step. This keeps the timer accurate across event-loop jitter and
    // OS sleep/resume.
    let timerAnchorReal = 0;       // now() captured when the run/anchor began
    let timerAnchorRemaining = 0;  // remainingSeconds at that anchor

    function reanchor() {
        timerAnchorReal = now();
        timerAnchorRemaining = timerState.remainingSeconds;
    }

    function getState() {
        return timerState;
    }

    function getConfig() {
        return timerConfig;
    }

    // emitTimerState equivalent: merge + stamp + bump counter + notify.
    function patch(partial = {}) {
        // FIX BUG-012: Увеличиваем монотонный счетчик при каждом обновлении
        timerUpdateCounter++;

        timerState = {
            ...timerState,
            ...partial,
            overrunLimitSeconds: timerConfig.overrunLimitSeconds,
            allowNegative: timerConfig.allowNegative,
            timestamp: now(),
            updateCounter: timerUpdateCounter  // Монотонный счетчик
        };

        onState(timerState);
        return timerState;
    }

    // Mirror of the timer-command config-merge block. Returns true when the
    // config actually changed (the "configChanged" semantics in electron-main).
    function setConfig(partial = {}) {
        if (partial === null || typeof partial !== 'object') { return false; }
        const { allowNegative, overrunLimitSeconds, overrunIntervalMinutes } = partial;
        let configChanged = false;

        if (typeof allowNegative === 'boolean') {
            if (timerConfig.allowNegative !== allowNegative) {
                timerConfig = { ...timerConfig, allowNegative };
                configChanged = true;
            }
        }
        if (overrunLimitSeconds !== null && overrunLimitSeconds !== undefined) {
            const limitNum = Number(overrunLimitSeconds);
            const newLimit = Number.isFinite(limitNum) ? Math.max(0, limitNum) : 0;
            if (timerConfig.overrunLimitSeconds !== newLimit) {
                timerConfig = { ...timerConfig, overrunLimitSeconds: newLimit };
                configChanged = true;
            }
        }
        if (overrunIntervalMinutes !== null && overrunIntervalMinutes !== undefined) {
            const intervalNum = Number(overrunIntervalMinutes);
            const newVal = Number.isFinite(intervalNum) ? Math.max(1, intervalNum) : 1;
            if (timerConfig.overrunIntervalMinutes !== newVal) {
                timerConfig = { ...timerConfig, overrunIntervalMinutes: newVal };
                configChanged = true;
            }
        }

        return configChanged;
    }

    // finishTimer equivalent. Does NOT touch any real interval (electron-main
    // clears its interval when start()/reconcile() report a non-running state).
    function finish(finalRemaining) {
        const remaining = finalRemaining !== undefined
            ? finalRemaining
            : (timerConfig.allowNegative
                ? timerState.remainingSeconds
                : Math.max(0, timerState.remainingSeconds));
        patch({
            isRunning: false,
            isPaused: false,
            finished: true,
            remainingSeconds: remaining
        });
    }

    // handleTimerStart equivalent. Guard: remaining<=0 && !allowNegative → finish
    // (no run). Otherwise mark running + re-anchor. Returns true when the timer
    // actually transitions to running, so electron-main can set up its interval.
    function start() {
        if (timerState.remainingSeconds <= 0 && !timerConfig.allowNegative) {
            finish();
            return false;
        }
        // Защита от повторного запуска на уровне state.
        if (timerState.isRunning) { return false; }

        const started = engine.start(timerState);
        patch({
            isRunning: started.isRunning,
            isPaused: started.isPaused,
            finished: started.finished
        });

        // Anchor the countdown to wall-clock time at the moment we start running.
        reanchor();
        return true;
    }

    // handleTimerPause equivalent.
    function pause() {
        const paused = engine.pause(timerState);
        patch({
            isRunning: paused.isRunning,
            isPaused: paused.isPaused,
            finished: paused.finished
        });
    }

    // handleTimerReset equivalent, including the ~100ms race guard so concurrent
    // reset requests cannot overlap. The guard window is driven by the injected
    // scheduler (defaults to global setTimeout) so tests stay deterministic.
    let isResetting = false;
    function reset() {
        if (isResetting) { return; }
        isResetting = true;
        try {
            const resetState = engine.reset(timerState);
            patch({
                totalSeconds: resetState.totalSeconds,
                remainingSeconds: resetState.remainingSeconds,
                isRunning: resetState.isRunning,
                isPaused: resetState.isPaused,
                finished: resetState.finished
            });
        } finally {
            scheduler.setTimeout(() => { isResetting = false; }, 100);
        }
    }

    // 'set' command equivalent. Ignored while running (matches the original
    // `if (timerState.isRunning) break;` guard in the timer-command switch).
    // Returns true when it emitted, false when it was a running no-op — so the
    // caller can replicate the original `emittedByCommand` bookkeeping (a config
    // change still gets its own emit when set was skipped while running).
    function setPreset(seconds) {
        if (timerState.isRunning) { return false; }
        const presetState = engine.setPreset(timerState, seconds);
        patch({
            totalSeconds: presetState.totalSeconds,
            remainingSeconds: presetState.remainingSeconds,
            presetSeconds: presetState.presetSeconds,
            isRunning: presetState.isRunning,
            isPaused: presetState.isPaused,
            finished: presetState.finished
        });
        return true;
    }

    // 'adjust' command equivalent. Re-anchors while running so the next
    // reconcile continues from the new value instead of "correcting" the
    // on-the-fly adjustment away.
    function adjust(deltaSeconds) {
        const adjustedState = engine.adjust(timerState, deltaSeconds, timerConfig.allowNegative);
        patch({
            totalSeconds: adjustedState.totalSeconds,
            remainingSeconds: adjustedState.remainingSeconds,
            finished: adjustedState.finished
        });
        if (timerState.isRunning) { reanchor(); }
    }

    // reconcileTimer equivalent: advance the timer to match real elapsed
    // wall-clock time since the anchor. Returns true when the timer finished
    // (so electron-main can clear its interval), false otherwise.
    function reconcile() {
        if (!timerState.isRunning) { return false; }

        const target = timerAnchorRemaining - Math.floor((now() - timerAnchorReal) / 1000);
        const step = timerState.remainingSeconds - target;
        // Less than a whole second has elapsed since the last visible decrement.
        if (step < 1) { return false; }

        const { state: nextState, events, finished } = engine.tick(timerState, timerConfig, step);

        // Broadcast events (timer-reached-zero / timer-minute / timer-overrun-minute).
        // Each fires at most once per reconcile, even when the step spans many seconds.
        for (const eventName of events) {
            onEvent(eventName);
        }

        if (finished) {
            finish(nextState.remainingSeconds);
            return true;
        }

        patch({
            remainingSeconds: nextState.remainingSeconds,
            finished: false
        });
        return false;
    }

    // Restore a persisted snapshot (crash recovery). Mutates the owned state
    // directly without emitting — mirrors the inline recovery block that wrote
    // straight to the timerState globals before any window existed. No counter
    // bump, no onState (nothing is listening yet at startup).
    function restoreState(partial = {}) {
        if (partial === null || typeof partial !== 'object') { return; }
        if (partial.presetSeconds !== undefined) {
            timerState.presetSeconds = partial.presetSeconds;
        }
        if (Number.isFinite(partial.totalSeconds)) {
            timerState.totalSeconds = partial.totalSeconds;
        }
        if (Number.isFinite(partial.remainingSeconds)) {
            timerState.remainingSeconds = partial.remainingSeconds;
        }
    }

    return {
        getState,
        getConfig,
        patch,
        setConfig,
        start,
        pause,
        reset,
        setPreset,
        adjust,
        reconcile,
        finish,
        restoreState
    };
}

module.exports = { createTimerController };
