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

const fs = require('fs');
const path = require('path');

const STATE_FILENAME = 'last-state.json';
const MAX_AGE_MS = 5 * 60 * 1000;

function getRecoveryStatePath(userDataPath) {
    return path.join(userDataPath, STATE_FILENAME);
}

/**
 * Write timer state to disk asynchronously — won't block the event loop
 * during the 10s periodic save.
 *
 * @param {string} userDataPath
 * @param {object} timerState     — { totalSeconds, remainingSeconds, presetSeconds, isRunning }
 * @param {object} [logger]       — optional electron-log-like object with .error
 * @returns {Promise<void>}
 */
function saveTimerStateToFile(userDataPath, timerState, logger) {
    try {
        const statePath = getRecoveryStatePath(userDataPath);
        const data = JSON.stringify({
            totalSeconds: timerState.totalSeconds,
            remainingSeconds: timerState.remainingSeconds,
            presetSeconds: timerState.presetSeconds,
            isRunning: timerState.isRunning,
            savedAt: Date.now()
        });
        return fs.promises.writeFile(statePath, data).catch(err => {
            if (logger && logger.error) { logger.error('saveTimerStateToFile:', err); }
        });
    } catch (err) {
        if (logger && logger.error) { logger.error('saveTimerStateToFile:', err); }
        return Promise.resolve();
    }
}

/**
 * Load saved timer state from disk (sync — runs once at startup).
 * Returns null if no file, stale, or unreadable. Deletes stale files.
 *
 * @param {string} userDataPath
 * @param {object} [logger]
 * @returns {object|null}
 */
function loadSavedTimerState(userDataPath, logger) {
    try {
        const statePath = getRecoveryStatePath(userDataPath);
        if (!fs.existsSync(statePath)) { return null; }
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const ageMs = Date.now() - (parsed.savedAt || 0);
        if (ageMs > MAX_AGE_MS) {
            try { fs.unlinkSync(statePath); } catch { /* ignore */ }
            return null;
        }
        return parsed;
    } catch (err) {
        if (logger && logger.warn) { logger.warn('loadSavedTimerState failed:', err); }
        return null;
    }
}

function clearSavedTimerState(userDataPath) {
    try {
        const statePath = getRecoveryStatePath(userDataPath);
        if (fs.existsSync(statePath)) { fs.unlinkSync(statePath); }
    } catch { /* ignore */ }
}

/**
 * Pure validator — decides whether `data` describes a usable recovery
 * snapshot at time `now`. No I/O, no side effects.
 *
 * Rules: object w/ finite savedAt in [now - 5m, now], presetSeconds ≥ 0.
 */
function isRecoveryValid(data, now) {
    if (!data || typeof data !== 'object') { return false; }
    if (typeof data.savedAt !== 'number' || !Number.isFinite(data.savedAt)) { return false; }
    const age = (now || Date.now()) - data.savedAt;
    if (age < 0 || age > MAX_AGE_MS) { return false; }
    if (typeof data.presetSeconds !== 'number' || data.presetSeconds < 0) { return false; }
    return true;
}

module.exports = {
    getRecoveryStatePath,
    saveTimerStateToFile,
    loadSavedTimerState,
    clearSavedTimerState,
    isRecoveryValid,
    MAX_AGE_MS
};
