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
 * Advance timer by one second.
 *
 * @param {Object} state Current timer state
 * @param {Object} config Timer config
 * @returns {{state: Object, events: string[], finished: boolean}}
 *   - state: new state after tick
 *   - events: array of event names to fire
 *   - finished: true when the timer should stop (caller clears interval)
 */
function tick(state, config = {}) {
    const events = [];
    const prevRemaining = state.remainingSeconds;
    let nextRemaining = prevRemaining - 1;
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
        const absPrev = Math.abs(prevRemaining);
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
    const delta = Number(deltaSeconds) || 0;
    const rawNext = state.remainingSeconds + delta;
    const nextRemaining = allowNegative ? rawNext : Math.max(0, rawNext);
    const nextTotal = Math.max(state.totalSeconds, nextRemaining);
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
    const next = Math.max(0, Number(seconds) || 0);
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
    tick,
    adjust,
    reset,
    setPreset,
    start,
    pause
};
