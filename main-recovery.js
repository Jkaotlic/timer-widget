'use strict';

/**
 * main-recovery.js — снимок восстановления после сбоя: когда писать, когда
 * стирать, периодическая запись.
 *
 * Crash recovery — persist timer state to file so we can offer to resume after
 * crash. Implementation lives in ./recovery.js (pure, no electron deps) — thin
 * wrappers below inject the userData path & electron-log logger.
 *
 * Модуль не требует electron: путь к профилю и журнал приходят параметрами.
 */

const recovery = require('./recovery');

/**
 * @param {object} deps
 * @param {() => string} deps.getUserDataPath — app.getPath('userData')
 * @param {() => object} deps.getTimerState — зеркало состояния таймера
 * @param {object} deps.flags — флаги приложения (main-state.js), читается isQuitting
 * @param {(state: object) => boolean} deps.isAtRest — покой таймера (main-event-overrun.js)
 * @param {object} deps.log
 * @param {boolean} deps.inTestMode — под node:test периодической записи нет
 */
function createRecoverySnapshot({ getUserDataPath, getTimerState, flags, isAtRest, log, inTestMode }) {
    // Запись синхронная и атомарная (recovery.js объясняет, почему не async):
    // краш-обработчику она нужна до возврата, а периодической — порядок записей.
    function saveTimerStateToFileSync() {
        recovery.saveTimerStateToFileSync(getUserDataPath(), getTimerState(), log);
    }

    function loadSavedTimerState() {
        return recovery.loadSavedTimerState(getUserDataPath(), log);
    }

    function clearSavedTimerState() {
        recovery.clearSavedTimerState(getUserDataPath());
    }

    /**
     * Есть ли что восстанавливать после сбоя: таймер идёт, стоит на паузе или
     * остановлен посреди отсчёта. Покой (сброс, новый пресет) и финиш — нет.
     */
    function worthRecovering(state) {
        return !state.finished && (state.isRunning || state.isPaused || !isAtRest(state));
    }

    /**
     * ОДНО место, решающее судьбу снимка восстановления (BUG-07).
     *
     * Снимок писался только на ходу и не стирался ни паузой, ни сбросом, ни
     * финишем: сбой в течение пяти минут после сброса поднимал давно сброшенный
     * отсчёт с пометкой «восстановлено после сбоя», а пауза, длившаяся дольше
     * пяти минут, не восстанавливалась вовсе. Теперь каждая команда либо пишет
     * снимок, либо стирает его, а на выходе (isQuitting) не делается ничего:
     * before-quit стирает снимок сам и воскрешать его нельзя.
     */
    function persistRecoverySnapshot() {
        if (flags.isQuitting) { return; }
        if (worthRecovering(getTimerState())) { saveTimerStateToFileSync(); }
        else { clearSavedTimerState(); }
    }

    // Persist state every 10 seconds while there is something to recover —
    // на паузе тоже: иначе снимок паузы протухал бы через пять минут.
    // Keep the id so we can stop it on quit — otherwise a fire during teardown can
    // re-create last-state.json after before-quit already unlinked it (phantom resume).
    let recoverySaveInterval = null;
    if (!inTestMode) {
        recoverySaveInterval = setInterval(() => {
            if (flags.isQuitting) { return; }
            if (worthRecovering(getTimerState())) { saveTimerStateToFileSync(); }
        }, 10000);
    }

    /** Stop the periodic save BEFORE unlinking (before-quit). */
    function stopPeriodicSave() {
        if (recoverySaveInterval) { clearInterval(recoverySaveInterval); recoverySaveInterval = null; }
    }

    return {
        saveTimerStateToFileSync, loadSavedTimerState, clearSavedTimerState,
        worthRecovering, persistRecoverySnapshot, stopPeriodicSave,
        isRecoveryValid: recovery.isRecoveryValid
    };
}

module.exports = { createRecoverySnapshot };
