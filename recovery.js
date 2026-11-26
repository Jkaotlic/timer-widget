'use strict';

/**
 * Crash-recovery utilities.
 *
 * Pure helpers that persist / load / validate the last-known timer state
 * to disk, so a restart after a crash can offer to resume. No Electron
 * imports — we accept the userData path as a parameter so this module
 * is trivially testable under plain `node --test`.
 *
 * Stale threshold: 5 minutes. Anything older is discarded.
 */

const { isTimerSeconds, MAX_SECONDS } = require('./timer-engine');
const path = require('path');
const { writeFileAtomicSync, readProfileJson, removeProfileFile, errorCode } = require('./atomic-write');

const STATE_FILENAME = 'last-state.json';
const MAX_AGE_MS = 5 * 60 * 1000;

/** @typedef {{savedAt: number, presetSeconds: number, totalSeconds?: number, remainingSeconds?: number}} RecoverySnapshot */
/** @typedef {Partial<Pick<import('electron-log').LogFunctions, 'error' | 'warn'>>} RecoveryLogger */

function getRecoveryStatePath(userDataPath) {
    return path.join(userDataPath, STATE_FILENAME);
}

/**
 * Write timer state to disk SYNCHRONOUSLY and atomically.
 *
 * Асинхронного варианта больше нет. Он писал НЕ атомарно, а главное —
 * завершался когда угодно: запись, начатая тиком за миг до сброса, ложилась
 * на диск ПОСЛЕ удаления снимка и воскрешала его (снимок «идёт» после
 * сброса — BUG-07). Файл — полторы сотни байт; синхронная запись раз в
 * десять секунд цикл событий не держит, зато порядок записей и удалений
 * теперь тот, в котором их позвали.
 *
 * @param {string} userDataPath
 * @param {Pick<TimerState, 'totalSeconds' | 'remainingSeconds' | 'presetSeconds' | 'isRunning'>} timerState
 * @param {RecoveryLogger} [logger]
 */
function saveTimerStateToFileSync(userDataPath, timerState, logger) {
    try {
        const statePath = getRecoveryStatePath(userDataPath);
        const data = JSON.stringify({
            totalSeconds: timerState.totalSeconds,
            remainingSeconds: timerState.remainingSeconds,
            presetSeconds: timerState.presetSeconds,
            isRunning: timerState.isRunning,
            savedAt: Date.now()
        });
        // Атомарно (BUG-09): сорвавшаяся запись оставляет прежний снимок, а
        // не обрезанный JSON.
        writeFileAtomicSync(statePath, data);
    } catch (err) {
        if (logger && logger.error) { logger.error('saveTimerStateToFileSync:', errorCode(err)); }
    }
}

/**
 * Load saved timer state from disk (sync — runs once at startup).
 * Returns null if no file, stale, or unreadable. Deletes stale files.
 *
 * @param {string} userDataPath
 * @param {RecoveryLogger} [logger]
 * @returns {unknown}
 */
function loadSavedTimerState(userDataPath, logger) {
    try {
        const statePath = getRecoveryStatePath(userDataPath);
        const parsed = readProfileJson(statePath, 4096);
        const ageMs = Date.now() - (parsed.savedAt || 0);
        if (ageMs > MAX_AGE_MS) {
            clearSavedTimerState(userDataPath, logger);
            return null;
        }
        return parsed;
    } catch (err) {
        if (err.code !== 'ENOENT' && logger && logger.warn) { logger.warn('loadSavedTimerState failed:', errorCode(err)); }
        return null;
    }
}

/** @param {string} userDataPath @param {RecoveryLogger} [logger] */
function clearSavedTimerState(userDataPath, logger) {
    try {
        removeProfileFile(getRecoveryStatePath(userDataPath));
        return true;
    } catch (err) {
        if (logger && logger.warn) { logger.warn('clearSavedTimerState failed:', errorCode(err)); }
        // Some filesystem locks block unlink but still allow replacement.
        // Leave an invalid snapshot if possible so the old timer cannot resume.
        try { writeFileAtomicSync(getRecoveryStatePath(userDataPath), '{}'); } catch (writeErr) {
            if (logger && logger.warn) { logger.warn('invalidateSavedTimerState failed:', errorCode(writeErr)); }
        }
        return false;
    }
}

/**
 * Pure validator — decides whether `data` describes a usable recovery
 * snapshot at time `now`. No I/O, no side effects.
 *
 * Rules: object w/ finite savedAt in [now - 5m, now], presetSeconds ≥ 0.
 * @param {unknown} data
 * @param {number} [now]
 * @returns {data is RecoverySnapshot}
 */
function isRecoveryValid(data, now) {
    if (!data || typeof data !== 'object') { return false; }
    const { savedAt, presetSeconds, totalSeconds, remainingSeconds } = /** @type {Record<string, unknown>} */ (data);
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) { return false; }
    const age = (now || Date.now()) - savedAt;
    if (age < 0 || age > MAX_AGE_MS) { return false; }
    return isTimerSeconds(presetSeconds)
        && (totalSeconds === undefined || isTimerSeconds(totalSeconds))
        && (remainingSeconds === undefined || isTimerSeconds(remainingSeconds, -MAX_SECONDS));
}

module.exports = {
    getRecoveryStatePath,
    saveTimerStateToFileSync,
    loadSavedTimerState,
    clearSavedTimerState,
    isRecoveryValid,
    MAX_AGE_MS
};
