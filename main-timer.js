'use strict';

/**
 * main-timer.js — таймер в главном процессе: контроллер, настоящий интервал,
 * рассылка состояния окнам, сон машины и каналы управления таймером.
 *
 * Главный процесс — единственный источник правды о таймере (CLAUDE.md,
 * Architecture). Сама машина состояний — в timer-controller.js (без
 * electron, проверяется на поддельных часах); здесь — её проводка: реальный
 * setInterval, монотонные часы и что делать с каждым новым состоянием.
 *
 * Модуль не требует electron: окна, powerMonitor и соседние модули приходят
 * параметрами.
 */

const timerEngine = require('./timer-engine');
const { createTimerController } = require('./timer-controller');
const { isPayloadObject } = require('./relay-payload');

/**
 * @param {object} deps
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.CONFIG
 * @param {Function} deps.safelySendToWindow
 * @param {(state: object) => void} deps.accrueOverrun — учёт перелимита (main-event-overrun.js)
 * @param {() => void} deps.persistRecoverySnapshot — снимок восстановления (main-recovery.js)
 * @param {() => void} deps.updateTrayMenu — трей (main-tray.js)
 */
function createTimer({ windows, CONFIG, safelySendToWindow, accrueOverrun, persistRecoverySnapshot, updateTrayMenu }) {
    // Состояние таймера
    // The timer state machine lives in ./timer-controller.js (Electron-free, unit
    // tested with a fake clock). The controller OWNS timerState/timerConfig, the
    // monotonic update counter, and the countdown anchors. This process keeps the
    // real setInterval (timerInterval) and feeds the controller a real clock + the
    // IPC broadcast callbacks. `timerState` below is a read-only mirror kept in sync
    // via the onState callback so the rest of the main process (tray, recovery, IPC
    // reply, window-open snapshots) can read it synchronously exactly as before —
    // через getState() этого модуля.
    let timerState = {
        totalSeconds: 0,
        remainingSeconds: 0,
        presetSeconds: 0,  // Оригинальное время пресета (для корректного сброса)
        isRunning: false,
        isPaused: false,
        finished: false,
        timestamp: Date.now(),
        updateCounter: 0  // Монотонный счетчик для надежной синхронизации
    };
    let timerInterval = null;

    function broadcastEvent(eventName) {
        safelySendToWindow(windows.controlWindow, eventName);
        safelySendToWindow(windows.widgetWindow, eventName);
        safelySendToWindow(windows.displayWindow, eventName);
    }

    const timerController = createTimerController({
        engine: timerEngine,
        now: Date.now,
        // Отсчёт — по монотонным часам: перевод системных часов не должен ни
        // замораживать таймер, ни проваливать его в минус (BUG-03). Сон машины
        // controller узнаёт от powerMonitor (suspend/resume ниже).
        monotonic: () => performance.now(),
        // FIX BUG-013: Безопасная отправка IPC сообщений
        onState: (state, meta) => {
            timerState = state;
            accrueOverrun(state);
            // Снимок восстановления следует за КОМАНДАМИ, а не за ходом секунд:
            // ход досыпает периодическая запись раз в 10 с (BUG-07).
            if (!(meta && meta.tick)) { persistRecoverySnapshot(); }
            safelySendToWindow(windows.widgetWindow, 'timer-state', state);
            safelySendToWindow(windows.displayWindow, 'timer-state', state);
            safelySendToWindow(windows.controlWindow, 'timer-state', state);
            // Часам состояние таймера нужно ради одной клавиши: Space решает
            // «старт или пауза» по isRunning. Без рассылки пробел в часах только
            // запускал и никогда не ставил на паузу (BUG-01).
            safelySendToWindow(windows.clockWidgetWindow, 'timer-state', state);
            // F-022: cheap path on every tick — just update the tooltip.
            // updateTrayMenu() handles Menu rebuild only when running state changes.
            updateTrayMenu();
        },
        onEvent: (eventName) => broadcastEvent(eventName)
    });
    // Keep the local mirror pointed at the controller's initial state.
    timerState = timerController.getState();

    /** Зеркало состояния таймера — то, что читают трей, снимок, окна и отчёт. */
    function getState() { return timerState; }

    function clearTimerInterval() {
        if (timerInterval) {
            clearTimeout(timerInterval);
            timerInterval = null;
        }
    }

    // Тик ставится на границу секунды от якоря отсчёта плюс запас, а не
    // setInterval(1000): тот на Windows срабатывает на миллисекунды раньше целой
    // секунды, сверка давала нулевой шаг, и секунда засчитывалась тиком позже —
    // отсчёт перескакивал, а доклад, законченный через 1,3 с, не считался начатым.
    // Следующий тик ставится после каждого, пока таймер идёт.
    function scheduleTimerTick() {
        const wait = timerController.msUntilNextSecond();
        if (wait === null) { timerInterval = null; return; }
        timerInterval = setTimeout(() => {
            timerInterval = null;
            reconcileTimer();
            if (timerController.getState().isRunning && !timerInterval) { scheduleTimerTick(); }
        }, wait + (CONFIG.TIMER_TICK_MARGIN_MS || 25));
    }

    // Thin wrapper preserved so the screenshot-runner's applyTimerState and any
    // other caller keep working. Delegates to the controller's patch() (which owns
    // the counter bump + stamping + the onState broadcast above).
    function emitTimerState(partial = {}) {
        timerController.patch(partial);
    }

    // Advance the timer to match real elapsed time since the anchor.
    // Called every interval tick AND on powerMonitor 'resume' so the displayed time
    // snaps back to reality immediately after the machine wakes from sleep. The
    // controller does the arithmetic + event/emit; here we just clear the real
    // interval when it reports the timer finished.
    function reconcileTimer() {
        if (timerController.reconcile()) { clearTimerInterval(); }
    }

    // Единые функции управления таймером (используются из timer-command и timer-control)
    function handleTimerStart() {
        // Mirrors the old handleTimerStart()/startTimer() split exactly. The
        // remaining<=0 && !allowNegative → finish path runs INSIDE controller.start()
        // before any state/interval guard (returns false in that case). The old
        // `if (isRunning || timerInterval) return` double-run guard lives here: when
        // a real interval is already counting, controller.start() returns false
        // (state isRunning), so no second interval is created.
        if (timerController.start()) {
            clearTimerInterval(); // belt-and-suspenders: never leak a prior interval
            scheduleTimerTick();
        }
    }

    function handleTimerPause() {
        // Сначала пауза, потом интервал: пауза сверяет натикавшее (BUG-05), и
        // таймер обязан успеть досчитать. Интервал снимается в любом исходе — после
        // pause() таймер не идёт, даже если это был финиш при сверке.
        const paused = timerController.pause();
        clearTimerInterval();
        return paused;
    }

    function handleTimerReset() {
        clearTimerInterval();
        timerController.reset();
    }

    /**
     * Сон машины. Отсчёт идёт по монотонным часам, а они во сне стоят (macOS,
     * Linux), поэтому сон controller засчитывает сам: suspend запоминает обе
     * пары часов, resume добавляет разницу (BUG-03). После пробуждения сразу
     * сверяемся — setInterval во сне не тикал. Safe no-op when stopped.
     */
    function bindPowerMonitor(powerMonitor, log) {
        try {
            powerMonitor.on('suspend', () => timerController.suspend());
            powerMonitor.on('resume', () => {
                timerController.resume();
                reconcileTimer();
            });
        } catch (err) { log.warn('powerMonitor hooks failed:', err); }
    }

    /**
     * Восстановление после сбоя: снимок (preset always, total/remaining only
     * when finite) — в controller. No emit/counter bump — nothing is listening
     * yet. Автостарта нет: таймер просто показывает, где его прервали.
     */
    function restoreState(saved) {
        timerController.restoreState({
            presetSeconds: saved.presetSeconds,
            totalSeconds: saved.totalSeconds,
            remainingSeconds: saved.remainingSeconds
        });
        timerState = timerController.getState();
    }

    function registerIpc(ipcMain) {
        // IPC обработчики для синхронизации
        ipcMain.on('timer-command', (_event, payload) => {
            // `payload = {}` спасал только от undefined — явный null доходил до
            // деструктуризации и ронял обработчик. Нормализуем к пустому объекту:
            // поведение при отсутствующем payload остаётся прежним (все поля undefined).
            const { type, seconds, deltaSeconds } = isPayloadObject(payload) ? payload : {};

            // Обновляем конфиг до выполнения команды (Number.isFinite guards live in
            // the controller's setConfig, which returns whether anything changed).
            const configChanged = timerController.setConfig(payload);

            // Отслеживаем, сделал ли switch emit (чтобы не дублировать)
            let emittedByCommand = false;

            switch (type) {
                case 'set': {
                    // setPreset() is a no-op while running (same guard as before); it
                    // reports whether it actually emitted so a config-only change still
                    // gets its own broadcast below.
                    emittedByCommand = timerController.setPreset(seconds);
                    break;
                }
                case 'adjust': {
                    // Re-anchor (when running) is handled inside controller.adjust() so
                    // the wall-clock reconcile continues from the new value instead of
                    // "correcting" the on-the-fly adjustment away on the next tick.
                    timerController.adjust(deltaSeconds);
                    // Поправка сперва сверяет натикавшее, и сверка может закончить
                    // таймер — тогда интервалу тикать больше нечего.
                    if (!timerController.getState().isRunning) { clearTimerInterval(); }
                    emittedByCommand = true;
                    break;
                }
                case 'start': {
                    handleTimerStart();
                    emittedByCommand = true;
                    break;
                }
                case 'pause': {
                    // Пауза не идущего таймера ничего не рассылает (BUG-02) — тогда
                    // смену настроек из этой же посылки разошлёт общий emit ниже.
                    emittedByCommand = handleTimerPause();
                    break;
                }
                case 'reset': {
                    handleTimerReset();
                    emittedByCommand = true;
                    break;
                }
                default:
                    break;
            }

            // Broadcast при изменении конфига, только если команда сама не сделала emit
            if (configChanged && !emittedByCommand) {
                emitTimerState({});
            }
        });

        ipcMain.on('get-timer-state', (event) => {
            event.reply('timer-state', timerState);
        });

        // Управление таймером через виджет (делегирует в единые функции)
        ipcMain.on('timer-control', (_event, action) => {
            switch (action) {
                case 'start': handleTimerStart(); break;
                case 'pause': handleTimerPause(); break;
                case 'reset': handleTimerReset(); break;
            }
        });
    }

    return {
        getState, restoreState, emitTimerState, clearTimerInterval, reconcileTimer,
        handleTimerStart, handleTimerPause, handleTimerReset, bindPowerMonitor, registerIpc
    };
}

module.exports = { createTimer };
