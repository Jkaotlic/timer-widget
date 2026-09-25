'use strict';

/**
 * main-lifecycle.js — жизненный цикл приложения: единственный экземпляр,
 * старт (восстановление, первое окно, трей), выход.
 *
 * Здесь ничего не создаётся «про запас»: модули уже собраны точкой входа, а
 * этот модуль решает, КОГДА что звать. Порядок старта несущий и записан в
 * комментариях ниже — накопитель читается до окон, восстановление до панели.
 *
 * Модуль не требует electron: app, BrowserWindow, Menu, powerMonitor и
 * nativeImage передаёт точка входа.
 */

const path = require('path');
const { FULLSCREEN_EXIT_TIMEOUT_MS } = require('./main-window-closing');

/**
 * @param {object} deps
 * @param {object} deps.app
 * @param {Function} deps.BrowserWindow
 * @param {object} deps.Menu
 * @param {object} deps.powerMonitor
 * @param {object} deps.nativeImage
 * @param {object} deps.log
 * @param {Function} deps.safelySendToWindow
 * @param {() => object} deps.getSession — electron.session, берётся в момент вызова
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.flags — флаги приложения (main-state.js)
 * @param {object} deps.timer — main-timer.js
 * @param {object} deps.recoverySnapshot — main-recovery.js
 * @param {object} deps.events — main-event-overrun.js
 * @param {object} deps.creators — main-windows.js
 * @param {object} deps.tray — main-tray.js
 * @param {boolean} deps.inTestMode
 * @param {boolean} deps.screenshotMode
 * @param {number} deps.startupT0 — метка начала процесса (perf)
 */
function startApp(deps) {
    const {
        app, BrowserWindow, Menu, powerMonitor, nativeImage, log, safelySendToWindow, getSession,
        windows, flags, timer, recoverySnapshot, events, creators, tray
    } = deps;
    const __inTestMode = deps.inTestMode;
    const __screenshotMode = deps.screenshotMode;
    const __startupT0 = deps.startupT0;
    const { createControlWindow, createWidgetWindow, createClockWidgetWindow, createDisplayWindow } = creators;

    /**
     * Выход из приложения при открытом полноэкранном дисплее.
     *
     * Та же авария, что и у `closeDisplayWindow`, только вход другой: на выходе
     * окна разрушаются, macOS запускает анимацию выхода из полноэкранного режима и
     * обходит все окна — по освобождённой памяти. В прогоне e2e приложение гасят
     * больше двух сотен раз, и падение выглядело нестабильностью случайного теста.
     *
     * Выход ОТКЛАДЫВАЕТСЯ ровно один раз и не дольше страховки: приложение,
     * которое не закрывается, хуже приложения, которое падает при закрытии.
     * `before-quit` после этого сработает второй раз — оба его действия
     * (`isQuitting`, удаление снимка восстановления) идемпотентны.
     */
    let __leavingFullScreenToQuit = false;

    app.on('before-quit', (event) => {
        const win = windows.displayWindow;
        if (!__leavingFullScreenToQuit && win && !win.isDestroyed() && win.isFullScreen()) {
            __leavingFullScreenToQuit = true;
            event.preventDefault();
            const again = () => app.quit();
            const timer = setTimeout(again, FULLSCREEN_EXIT_TIMEOUT_MS);
            win.once('leave-full-screen', () => {
                clearTimeout(timer);
                setTimeout(again, 120);
            });
            win.setFullScreen(false);
            return;
        }

        flags.isQuitting = true;
        // Живой перелимит — в накопитель до выхода (BUG-04). Снимок
        // восстановления ниже стирается, таймер не вернётся — значит, доклад
        // кончился вместе с приложением.
        events.closeTalkOnQuit();
        // Stop the periodic save BEFORE unlinking, so an in-flight 10s tick can't
        // re-create the recovery file after we delete it.
        recoverySnapshot.stopPeriodicSave();
        recoverySnapshot.clearSavedTimerState();
    });

    // Single-instance lock: a tray utility with autostart is easy to launch twice.
    // A duplicate instance would spawn a second tray + timer and race the shared
    // recovery file. Take the primary lock and focus the existing window instead.
    const __singleInstance = __inTestMode || __screenshotMode
        || typeof app.requestSingleInstanceLock !== 'function'
        || app.requestSingleInstanceLock();
    if (!__singleInstance) {
        app.quit();
    } else {
        app.on('second-instance', () => {
            if (!windows.controlWindow) { createControlWindow(); return; }
            if (windows.controlWindow.isMinimized()) { windows.controlWindow.restore(); }
            if (!windows.controlWindow.isVisible()) { windows.controlWindow.show(); }
            windows.controlWindow.focus();
        });
    }

    app.whenReady().then(() => {
        // Duplicate instance — we already called app.quit() above; do nothing.
        if (!__singleInstance) { return; }

        // Remove default Electron menu (File, Edit, View, Help)
        Menu.setApplicationMenu(null);

        // Сон машины — см. bindPowerMonitor в main-timer.js.
        timer.bindPowerMonitor(powerMonitor, log);

        // Deny every renderer permission request (camera/mic/geo/notifications/…).
        // This is a purely offline timer — it never needs any web/device permission.
        // Defense-in-depth on top of sandbox/contextIsolation/CSP/will-navigate.
        try {
            const session = getSession();
            session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
            session.defaultSession.setPermissionCheckHandler(() => false);
        } catch (err) {
            log.warn('Permission handler setup failed:', err);
        }

        // Recovery check before UI. Restore the FULL snapshot (remaining/total/preset)
        // so a crash mid-countdown comes back with the in-progress time intact. We never
        // auto-start (isRunning stays false); the timer simply shows where it was paused.
        // Накопитель мероприятия читается ДО открытия окон: гидратация окна
        // дисплея снимает ему уже прочитанное значение.
        events.loadOnStart();

        const saved = recoverySnapshot.loadSavedTimerState();
        const hasRecovery = recoverySnapshot.isRecoveryValid(saved, Date.now());
        if (hasRecovery) {
            log.info(`Recovery candidate found (age ${Math.round((Date.now() - saved.savedAt) / 1000)}s)`);
            timer.restoreState(saved);
            // control window may also offer an explicit resume via timer-recovery-available
        }

        // Живой перелимит, записанный при сбое (BUG-04), — в итог ровно один раз
        // (см. foldPendingOnStart в main-event-overrun.js).
        events.foldPendingOnStart(hasRecovery ? timer.getState().remainingSeconds : null);

        createControlWindow();

        if (__screenshotMode) {
            const runner = require('./scripts/screenshot-runner');
            windows.controlWindow.webContents.once('did-finish-load', () => {
                runner.run({
                    app, log, nativeImage,
                    ctx: () => ({
                        control: windows.controlWindow, widget: windows.widgetWindow,
                        clock: windows.clockWidgetWindow, display: windows.displayWindow
                    }),
                    applyTimerState: (s) => timer.emitTimerState(s),
                    openWidget: () => { if (!windows.widgetWindow) { createWidgetWindow(); } },
                    openClock: () => { if (!windows.clockWidgetWindow) { createClockWidgetWindow(); } },
                    openDisplay: () => { if (!windows.displayWindow) { createDisplayWindow('auto'); } },
                    outDir: path.join(__dirname, 'screenshots')
                }).catch((err) => {
                    log.error('[screenshot] sequence failed:', err);
                    app.exit(1);
                });
            });
            return; // skip tray + normal activate hooks in screenshot mode
        }

        tray.createTray();
        // bindTrayBehavior вызывается внутри createControlWindow — здесь повторять
        // нельзя: второй обработчик 'close' навесился бы на то же окно.

        // F-005: broadcast recovery snapshot to control window once it has loaded.
        // Renderer may ignore it for now, but the channel is no longer dead code.
        if (hasRecovery && windows.controlWindow) {
            windows.controlWindow.webContents.once('did-finish-load', () => {
                safelySendToWindow(windows.controlWindow, 'timer-recovery-available', saved);
            });
        }

        log.info(`[perf] app ready in ${Date.now() - __startupT0}ms`);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createControlWindow();
            }
        });
    });

    app.on('window-all-closed', () => {
        timer.clearTimerInterval(); // Очищаем интервал таймера при закрытии
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}

module.exports = { startApp };
