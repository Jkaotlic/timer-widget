'use strict';

/**
 * main-tray.js — значок в трее: меню, подсказка с остатком времени,
 * «закрытие панели = скрытие в трей».
 *
 * Трей ходит МИМО IPC — зовёт функции главного процесса напрямую. Поэтому всё,
 * что обязано случиться при открытии и закрытии окна, живёт в create-функциях
 * и в main-window-closing.js, а не в обработчиках каналов: иначе трей прошёл
 * бы мимо (docs/lessons.md, «Opening a window has ONE owner»).
 *
 * Модуль не требует electron: Tray, Menu и nativeImage передаёт точка входа.
 */

const { formatTimeShort } = require('./utils');

/**
 * @param {object} deps
 * @param {Function} deps.Tray
 * @param {object} deps.Menu
 * @param {object} deps.nativeImage
 * @param {object} deps.app
 * @param {object} deps.log
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.flags — флаги приложения (main-state.js)
 * @param {() => object} deps.getTimerState
 * @param {object} deps.timer — handleTimerStart / handleTimerPause / handleTimerReset
 * @param {object} deps.creators — create-функции main-windows.js и getAppIconPath
 * @param {object} deps.closing — main-window-closing.js
 */
function createTrayController({ Tray, Menu, nativeImage, app, log, windows, flags, getTimerState, timer, creators, closing }) {
    const { handleTimerStart, handleTimerPause, handleTimerReset } = timer;
    const { markClosing, cancelQueuedOpen } = closing;

    // ============================================================================
    // System Tray
    // ============================================================================
    let tray = null;

    // F-022: cache last-seen booleans; only rebuild Menu when they actually change.
    // Remaining-seconds updates every tick are routed through the tooltip only.
    let _trayLastRunning = null;
    let _trayLastWidgetOpen = null;
    let _trayLastClockOpen = null;

    function createTray() {
        try {
            const iconPath = creators.getAppIconPath();
            const icon = nativeImage.createFromPath(iconPath);
            const trayIcon = icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 });
            tray = new Tray(trayIcon);
            tray.setToolTip('Timer Widget');
            rebuildTrayMenu();
            updateTrayTime();
            tray.on('click', () => {
                if (!windows.controlWindow) { creators.createControlWindow(); return; }
                if (windows.controlWindow.isVisible()) { windows.controlWindow.hide(); }
                else { windows.controlWindow.show(); windows.controlWindow.focus(); }
            });
            log.info('System tray created');
        } catch (err) {
            log.warn('Tray creation failed (no tray support?):', err);
        }
    }

    // Full Menu rebuild — only when boolean state changes (isRunning / widget open / clock open).
    function rebuildTrayMenu() {
        if (!tray) { return; }
        const timerState = getTimerState();
        const running = timerState.isRunning;
        const widgetOpen = !!windows.widgetWindow;
        const clockOpen = !!windows.clockWidgetWindow;
        _trayLastRunning = running;
        _trayLastWidgetOpen = widgetOpen;
        _trayLastClockOpen = clockOpen;

        const remaining = formatTimeShort(timerState.remainingSeconds || 0);
        const menu = Menu.buildFromTemplate([
            { label: `⏱  ${remaining}`, enabled: false },
            { type: 'separator' },
            { label: running ? 'Пауза' : 'Старт', click: () => {
                if (running) { handleTimerPause(); }
                else { handleTimerStart(); }
                updateTrayMenu();
            }},
            { label: 'Сбросить', click: () => { handleTimerReset(); updateTrayMenu(); }},
            { type: 'separator' },
            { label: 'Панель управления', click: () => {
                if (!windows.controlWindow) { creators.createControlWindow(); return; }
                windows.controlWindow.show();
                windows.controlWindow.focus();
            }},
            { label: 'Виджет', type: 'checkbox', checked: widgetOpen, click: () => {
                if (windows.widgetWindow) { cancelQueuedOpen('widget'); markClosing(windows.widgetWindow).close(); }
                else { creators.createWidgetWindow(); }
                setTimeout(updateTrayMenu, 200);
            }},
            { label: 'Часы', type: 'checkbox', checked: clockOpen, click: () => {
                if (windows.clockWidgetWindow) { cancelQueuedOpen('clock'); markClosing(windows.clockWidgetWindow).close(); }
                else { creators.createClockWidgetWindow(); }
                setTimeout(updateTrayMenu, 200);
            }},
            { type: 'separator' },
            { label: 'Выход', click: () => { flags.isQuitting = true; app.quit(); }}
        ]);
        tray.setContextMenu(menu);
    }

    // Lightweight per-tick update — only touches the tooltip (no Menu rebuild).
    function updateTrayTime() {
        if (!tray) { return; }
        const remaining = formatTimeShort(getTimerState().remainingSeconds || 0);
        try { tray.setToolTip(`Timer Widget — ${remaining}`); } catch { /* tray destroyed */ }
    }

    // Decide whether to rebuild the Menu. Called from tray-click handlers & window close.
    // emitTimerState calls updateTrayTime directly (cheap path).
    function updateTrayMenu() {
        if (!tray) { return; }
        const running = getTimerState().isRunning;
        const widgetOpen = !!windows.widgetWindow;
        const clockOpen = !!windows.clockWidgetWindow;
        if (running !== _trayLastRunning
            || widgetOpen !== _trayLastWidgetOpen
            || clockOpen !== _trayLastClockOpen) {
            rebuildTrayMenu();
        }
        updateTrayTime();
    }

    // Intercept control window close — hide to tray instead of quit
    function bindTrayBehavior(win) {
        if (!win) { return; }
        win.on('close', (event) => {
            if (!flags.isQuitting && tray) {
                event.preventDefault();
                win.hide();
            }
        });
    }

    return { createTray, rebuildTrayMenu, updateTrayTime, updateTrayMenu, bindTrayBehavior };
}

module.exports = { createTrayController };
