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
 *   createTimerController({ engine, now, monotonic, onState, onEvent })
 *
 *   - engine    : require('./timer-engine') — the pure arithmetic module.
 *   - now       : () => number — wall-clock source (electron-main: Date.now).
 *                 Только для штампа `timestamp` и для замера СНА (suspend/resume).
 *   - monotonic : () => number — монотонные миллисекунды (electron-main:
 *                 performance.now). По ним идёт отсчёт — см. «Два вида часов».
 *   - onState   : (state, meta) => void — fired on every state emit with the
 *                 FULL, broadcast-ready state object. `meta.tick === true` —
 *                 это ход секунд, а не команда (главному процессу это нужно,
 *                 чтобы не писать снимок восстановления каждую секунду).
 *   - onEvent   : (name) => void — fired for boundary events
 *                 ('timer-reached-zero' / 'timer-minute' / 'timer-overrun-minute')
 *                 so electron-main can broadcast them.
 *
 * Два вида часов (BUG-03). Отсчёт шёл по Date.now — ради того, чтобы сон
 * машины засчитывался: во сне setInterval не тикает, а стенные часы идут. Но
 * стенные часы переводят: перевод на час назад замораживал таймер на час,
 * вперёд — проваливал его и начислял деньги за перелимит, которого не было.
 * Теперь ход меряется монотонными часами, а сон учитывается ЯВНО: главный
 * процесс зовёт suspend()/resume() по powerMonitor, и сколько стенных часов
 * прошло между ними, сверх того, что показали монотонные, — это и есть сон.
 *
 * patch() is the emitTimerState equivalent: merge partial → stamp
 * overrunLimitSeconds/allowNegative/timestamp/updateCounter → bump counter →
 * onState. The broadcast payload shape is byte-identical to the previous
 * inline emitTimerState in electron-main.js.
 */

function createTimerController(deps = {}) {
    const engine = deps.engine;
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const monotonic = typeof deps.monotonic === 'function' ? deps.monotonic : () => performance.now();
    const onState = typeof deps.onState === 'function' ? deps.onState : () => {};
    const onEvent = typeof deps.onEvent === 'function' ? deps.onEvent : () => {};

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

    // Anchor for drift-free countdown. We never assume exactly one second
    // elapsed per interval fire; instead each reconcile computes how many whole
    // seconds SHOULD have passed since the anchor and advances the engine by
    // that step. This keeps the timer accurate across event-loop jitter; OS
    // sleep is added explicitly (sleepCreditMs, see suspend/resume).
    let timerAnchorMono = 0;       // monotonic() captured when the run/anchor began
    let timerAnchorRemaining = 0;  // remainingSeconds at that anchor
    let sleepCreditMs = 0;         // сон машины с момента якоря (монотонные его не видят)
    let suspendMark = null;        // { wall, mono } — где застал suspend()

    // Доля секунды, натикавшая к следующему видимому шагу, — вне хода её нет.
    // Пауза забирала её с собой: каждый цикл «пауза — старт» удлинял таймер
    // почти на секунду (BUG-05). Теперь она переносится в новый якорь.
    let carryMs = 0;

    function elapsedMs() {
        return monotonic() - timerAnchorMono + sleepCreditMs;
    }

    // Натикавшее сверх целых секунд, уже показанных с момента якоря.
    function pendingFractionMs() {
        const shown = (timerAnchorRemaining - timerState.remainingSeconds) * 1000;
        return Math.min(999, Math.max(0, elapsedMs() - shown));
    }

    function reanchor(fractionMs = 0) {
        timerAnchorMono = monotonic() - fractionMs;
        timerAnchorRemaining = timerState.remainingSeconds;
        sleepCreditMs = 0;
    }

    function getState() {
        return timerState;
    }

    function getConfig() {
        return timerConfig;
    }

    // emitTimerState equivalent: merge + stamp + bump counter + notify.
    function patch(partial = {}, meta = {}) {
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

        onState(timerState, meta);
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
        carryMs = 0;
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

        // Якорь ставится С долей секунды, недотиканной до паузы (BUG-05).
        reanchor(carryMs);
        carryMs = 0;
        return true;
    }

    // handleTimerPause equivalent. Returns true when the timer actually paused.
    //
    // Пауза — только у идущего таймера (BUG-02). Без охраны пауза из финиша
    // снимала защёлку `finished` — и следующий старт повторял звук и вспышку
    // конца, — а из покоя рисовала «паузу», которой не было (клавиша S дисплея
    // шлёт pause безусловно).
    function pause() {
        if (!timerState.isRunning) { return false; }
        // Сначала забрать натикавшее: целые секунды, которые тик ещё не
        // показал, и долю следующей (BUG-05). Сверка может и закончить таймер —
        // тогда ставить на паузу уже нечего.
        if (reconcile()) { return false; }
        carryMs = pendingFractionMs();
        const paused = engine.pause(timerState);
        patch({
            isRunning: paused.isRunning,
            isPaused: paused.isPaused,
            finished: paused.finished
        });
        return true;
    }

    // handleTimerReset equivalent.
    //
    // Охраны «не чаще раза в 100 мс» больше нет (BUG-06). Сброс синхронен и
    // идемпотентен — перекрываться ему не с чем, — а главный процесс снимает
    // интервал ДО вызова: проглоченный охраной сброс оставлял isRunning=true
    // без единого тика, «идёт», который стоит.
    function reset() {
        carryMs = 0;
        const resetState = engine.reset(timerState);
        patch({
            totalSeconds: resetState.totalSeconds,
            remainingSeconds: resetState.remainingSeconds,
            isRunning: resetState.isRunning,
            isPaused: resetState.isPaused,
            finished: resetState.finished
        });
    }

    // 'set' command equivalent. Ignored while running (matches the original
    // `if (timerState.isRunning) break;` guard in the timer-command switch).
    // Returns true when it emitted, false when it was a running no-op — so the
    // caller can replicate the original `emittedByCommand` bookkeeping (a config
    // change still gets its own emit when set was skipped while running).
    function setPreset(seconds) {
        if (timerState.isRunning) { return false; }
        // Не-число — не команда (BUG-12). Движок превратил бы его в 0, и
        // посылка `seconds: true` молча обнуляла бы таймер.
        if (engine.toWholeSeconds(seconds) === null) { return false; }
        carryMs = 0;
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
        // Натикавшее до поправки — сначала в состояние: иначе новый якорь
        // молча выбросил бы и его, и долю секунды (та же потеря, что BUG-05).
        // Если сверка закончила таймер, поправка ложится на законченный —
        // как у любого остановленного: нажатие «+30» не проглатывается.
        let fractionMs = 0;
        if (timerState.isRunning && !reconcile()) {
            fractionMs = pendingFractionMs();
        }
        const adjustedState = engine.adjust(timerState, deltaSeconds, timerConfig.allowNegative);
        patch({
            totalSeconds: adjustedState.totalSeconds,
            remainingSeconds: adjustedState.remainingSeconds,
            finished: adjustedState.finished
        });
        if (timerState.isRunning) { reanchor(fractionMs); }
    }

    // Машина засыпает: запомнить обе пары часов. Зовётся всегда — таймер могут
    // запустить и остановить и после этого, решает resume().
    function suspend() {
        suspendMark = { wall: now(), mono: monotonic() };
    }

    // Машина проснулась: сон = стенной ход минус монотонный. Разность, а не
    // стенной ход целиком: там, где монотонные часы во сне идут (часть
    // Windows-машин), сон иначе посчитался бы дважды. Отрицательной она
    // бывает, если часы перевели во сне назад, — тогда сна не засчитываем.
    function resume() {
        const mark = suspendMark;
        suspendMark = null;
        if (!mark || !timerState.isRunning) { return; }
        const slept = (now() - mark.wall) - (monotonic() - mark.mono);
        if (Number.isFinite(slept) && slept > 0) { sleepCreditMs += slept; }
    }

    // reconcileTimer equivalent: advance the timer to match real elapsed
    // time since the anchor. Returns true when the timer finished
    // (so electron-main can clear its interval), false otherwise.
    function reconcile() {
        if (!timerState.isRunning) { return false; }

        const target = timerAnchorRemaining - Math.floor(elapsedMs() / 1000);
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
        }, { tick: true });
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
        suspend,
        resume,
        finish,
        restoreState
    };
}

module.exports = { createTimerController };
