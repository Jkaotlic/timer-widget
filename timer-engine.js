'use strict';

/**
 * timer-engine.js
 *
 * Pure timer arithmetic — no Electron APIs, no side effects, no IPC.
 * Returns new state objects + a list of events for the caller to broadcast.
 *
 * State shape:
 *   {
 *     totalSeconds: number,      // Original preset duration
 *     remainingSeconds: number,  // Current remaining (negative = overrun)
 *     presetSeconds: number,     // Preset for reset (survives adjustments)
 *     isRunning: boolean,
 *     isPaused: boolean,
 *     finished: boolean
 *   }
 *
 * Config shape:
 *   {
 *     allowNegative: boolean,          // Allow overrun past zero
 *     overrunLimitSeconds: number,     // Hard stop at -overrunLimitSeconds (0 = no limit)
 *     overrunIntervalMinutes: number   // Fire 'timer-overrun-minute' every N minutes
 *   }
 *
 * Events (strings, fired by tick):
 *   'timer-reached-zero'    — emitted once when crossing 0 with allowNegative
 *   'timer-minute'          — emitted when crossing 60s threshold (one minute left)
 *   'timer-overrun-minute'  — emitted every overrunIntervalMinutes in overrun
 */

/**
 * Advance the timer by `stepSeconds` whole seconds (default 1).
 *
 * The step is supplied by the caller, which derives it from wall-clock time
 * (see electron-main `reconcileTimer`) instead of assuming exactly one second
 * elapsed per interval fire. This keeps the countdown anchored to real time
 * across event-loop jitter, CPU stalls, and OS sleep/resume. All boundary
 * events use single prev-vs-next crossing checks, so each fires AT MOST ONCE
 * per call regardless of how many seconds the step spans (no event spam after
 * a long sleep, no missed zero crossing).
 *
 * @param {Object} state Current timer state
 * @param {Object} config Timer config
 * @param {number} [stepSeconds=1] Whole seconds to advance (clamped to >= 1)
 * @returns {{state: Object, events: string[], finished: boolean}}
 *   - state: new state after tick
 *   - events: array of event names to fire
 *   - finished: true when the timer should stop (caller clears interval)
 */
function tick(state, config = {}, stepSeconds = 1) {
    const events = [];
    const prevRemaining = state.remainingSeconds;
    let step = Math.floor(Number(stepSeconds));
    if (!Number.isFinite(step) || step < 1) { step = 1; }
    let nextRemaining = prevRemaining - step;
    let shouldFinish = false;

    const allowNegative = !!config.allowNegative;
    const overrunLimit = Math.max(0, Number(config.overrunLimitSeconds) || 0);
    const overrunIntervalMinutes = Math.max(1, Number(config.overrunIntervalMinutes) || 1);

    // Hard floor when overrun is not allowed
    if (!allowNegative && nextRemaining <= 0) {
        nextRemaining = 0;
        shouldFinish = true;
    }

    // Event: timer reached zero (only meaningful in overrun mode — regular mode finishes)
    if (prevRemaining > 0 && nextRemaining <= 0 && allowNegative) {
        events.push('timer-reached-zero');
    }

    // Event: one minute remaining (crossing 60s threshold going down, still positive)
    if (prevRemaining > 60 && nextRemaining <= 60 && nextRemaining >= 0) {
        events.push('timer-minute');
    }

    // Event: overrun minute reminder (every N minutes while in overrun)
    if (nextRemaining < 0 && allowNegative) {
        const intervalSec = overrunIntervalMinutes * 60;
        const absNext = Math.abs(nextRemaining);
        // Перелимит «до шага» — ноль, если таймер ещё был в плюсе. Модуль
        // прежде брал |prev|: шаг 130 → -120 сравнивал две «минуты» до нуля с
        // двумя минутами после и терял пересечение отметки -60 (BUG-11).
        const absPrev = Math.max(0, -prevRemaining);
        if (Math.floor(absNext / intervalSec) > Math.floor(absPrev / intervalSec)) {
            events.push('timer-overrun-minute');
        }
    }

    // Hard stop at overrun limit (caller should clear interval)
    if (allowNegative && overrunLimit > 0 && nextRemaining <= -overrunLimit) {
        nextRemaining = -overrunLimit;
        shouldFinish = true;
    }

    const newState = {
        ...state,
        remainingSeconds: nextRemaining,
        finished: shouldFinish ? true : false
    };

    if (shouldFinish) {
        newState.isRunning = false;
        newState.isPaused = false;
    }

    return { state: newState, events, finished: shouldFinish };
}

// Потолок таймера — 99:59:59, тот же, что у ручного ввода (utils.js parseTime).
// Главный процесс принимал любое конечное число: `set 90.5` показывал
// «00:01:30.5», а `adjust 1e308` дважды давал Infinity и дальше NaN во всех
// окнах (BUG-12). Минус ограничен тем же модулем: формат ЧЧ:ММ:СС не покажет
// больше и со знаком.
const MAX_SECONDS = 359999;

/**
 * Целые секунды из присланного значения или null.
 *
 * Только настоящее число: `true` — не «одна секунда», а '90' — не число
 * (окна шлют числа; строка здесь — чужая посылка). Дробь режется К НУЛЮ:
 * поправка -0.5 не должна становиться -1.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toWholeSeconds(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) { return null; }
    return Math.trunc(value);
}

function clampSeconds(value, min) {
    return Math.min(MAX_SECONDS, Math.max(min, value));
}

/**
 * Adjust remaining by delta seconds.
 * totalSeconds grows to match if new remaining exceeds it (so progress bars remain sane).
 *
 * @param {Object} state
 * @param {number} deltaSeconds
 * @param {boolean} allowNegative
 * @returns {Object} new state
 */
function adjust(state, deltaSeconds, allowNegative = false) {
    const delta = toWholeSeconds(deltaSeconds) || 0;
    const nextRemaining = clampSeconds(state.remainingSeconds + delta, allowNegative ? -MAX_SECONDS : 0);
    const nextTotal = Math.min(MAX_SECONDS, Math.max(state.totalSeconds, nextRemaining));
    return {
        ...state,
        totalSeconds: nextTotal,
        remainingSeconds: nextRemaining,
        finished: false
    };
}

/**
 * Reset to presetSeconds (falls back to totalSeconds if preset is 0/undefined).
 * Clears isRunning/isPaused/finished.
 *
 * @param {Object} state
 * @returns {Object} new state
 */
function reset(state) {
    const resetTo = state.presetSeconds || state.totalSeconds || 0;
    return {
        ...state,
        totalSeconds: resetTo,
        remainingSeconds: resetTo,
        isRunning: false,
        isPaused: false,
        finished: false
    };
}

/**
 * Set a new preset. Updates all three time fields and clears running state.
 *
 * @param {Object} state
 * @param {number} seconds
 * @returns {Object} new state
 */
function setPreset(state, seconds) {
    const whole = toWholeSeconds(seconds);
    const next = whole === null ? 0 : clampSeconds(whole, 0);
    return {
        ...state,
        totalSeconds: next,
        remainingSeconds: next,
        presetSeconds: next,
        isRunning: false,
        isPaused: false,
        finished: false
    };
}

/**
 * Mark timer as running. Does NOT start an interval — caller must do that.
 *
 * @param {Object} state
 * @returns {Object} new state
 */
function start(state) {
    return {
        ...state,
        isRunning: true,
        isPaused: false,
        finished: false
    };
}

/**
 * Mark timer as paused.
 *
 * @param {Object} state
 * @returns {Object} new state
 */
function pause(state) {
    return {
        ...state,
        isRunning: false,
        isPaused: true,
        finished: false
    };
}

module.exports = {
    MAX_SECONDS,
    toWholeSeconds,
    tick,
    adjust,
    reset,
    setPreset,
    start,
    pause
};
