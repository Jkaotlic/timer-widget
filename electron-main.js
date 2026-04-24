// [perf] Capture process start as early as possible for startup timing.
const __startupT0 = Date.now();

// Guard: ELECTRON_RUN_AS_NODE в окружении превращает electron.exe в голой Node
// без Chromium/main-process API, и require('electron') возвращает строку-путь,
// а не API-модуль. Сообщаем ясно вместо непонятного 'Cannot read app.getVersion'.
if (process.env.ELECTRON_RUN_AS_NODE) {
    console.error(
        '\n[TimerWidget] ELECTRON_RUN_AS_NODE=%s is set in the environment.\n' +
        '  Это переменная Electron для запуска electron.exe как обычной Node.js.\n' +
        '  Приложение не может стартовать в таком режиме. Снимите её:\n' +
        '    PowerShell: $env:ELECTRON_RUN_AS_NODE=""\n' +
        '    cmd.exe:    set ELECTRON_RUN_AS_NODE=\n' +
        '    bash/zsh:   unset ELECTRON_RUN_AS_NODE\n',
        process.env.ELECTRON_RUN_AS_NODE
    );
    process.exit(1);
}

const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log/main');
const { safelySendToWindow } = require('./utils');
const CONFIG = require('./constants');
const timerEngine = require('./timer-engine');
const recovery = require('./recovery');

// Logger setup
log.initialize();
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB per file
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.level = process.argv.includes('--dev') ? 'debug' : 'warn';
log.info(`TimerWidget starting — version ${app.getVersion()}, platform ${process.platform}`);

// Crash handlers
process.on('uncaughtException', (err) => {
    log.error('UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
    try { saveTimerStateToFile(); } catch { /* best effort */ }
});
process.on('unhandledRejection', (reason) => {
    log.error('UNHANDLED REJECTION:', reason);
    try { saveTimerStateToFile(); } catch { /* best effort */ }
});

// Chromium phones home by default: Component Updater → update.googleapis.com /
// redirector.gvt1.com (Widevine, Safe Browsing, CRLSet, …), Variations Service →
// clientservices.googleapis.com, Optimization Hints → optimizationguide-pa.
// Таймер-виджет не использует ни один из этих компонентов, поэтому глушим
// фоновую сеть целиком — иначе отчёты security-аудита фиксируют исходящий
// трафик на Google-инфраструктуру при чисто офлайновом приложении.
// Switches должны быть применены до app ready, поэтому ставим на импорте.
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-features', 'ChromeVariations,OptimizationHints');

// Test-mode guard — node:test stubs 'electron', we skip runtime side-effects.
const __inTestMode = process.env.NODE_TEST_CONTEXT !== undefined;

// Screenshot mode — scripted capture sequence (see scripts/screenshot-runner.js).
// When active, all windows boot hidden/offscreen so the desktop isn't disturbed.
const __screenshotMode = process.argv.includes('--screenshot');

// Runtime memory monitor (dev only, not in tests)
if (process.argv.includes('--dev') && !__inTestMode) {
    setInterval(() => {
        const mem = process.memoryUsage();
        log.debug(`[perf] heap: ${(mem.heapUsed/1024/1024).toFixed(1)}MB rss: ${(mem.rss/1024/1024).toFixed(1)}MB`);
    }, 60000);
}

let controlWindow = null;
let widgetWindow = null;
let displayWindow = null;
let clockWidgetWindow = null;

// Состояние таймера
// FIX BUG-012: Используем монотонный счетчик вместо timestamp
let timerUpdateCounter = 0;

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
let timerConfig = {
    allowNegative: false,
    overrunLimitSeconds: 0,
    overrunIntervalMinutes: 1
};
let timerInterval = null;

// Сохраняем последние настройки дисплея для синхронизации
let lastDisplaySettings = null;
let lastDisplayIndex = 'auto';

// Per-window colors (independent themes)
let lastWidgetColors = null;
let lastClockColors = null;
let lastDisplayColors = null;
let lastWidgetStyle = null;

// Block Ctrl+=/- keyboard zoom and Ctrl+Wheel page zoom on all windows
function blockZoom(win) {
    if (!win || !win.webContents) {return;}
    win.webContents.on('before-input-event', (event, input) => {
        if (win.isDestroyed()) {return;}
        if (input.control && (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')) {
            event.preventDefault();
        }
    });
    // Reset zoom and block Ctrl+Wheel page zoom
    win.webContents.setZoomFactor(1);
    win.webContents.setZoomLevel(0);
    win.webContents.setVisualZoomLevelLimits(1, 1);
}

// Защита от навигации и открытия новых окон
function hardenWindow(win) {
    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
        }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function clearTimerInterval() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function emitTimerState(partial = {}) {
    // FIX BUG-012: Увеличиваем монотонный счетчик при каждом обновлении
    timerUpdateCounter++;

    timerState = {
        ...timerState,
        ...partial,
        overrunLimitSeconds: timerConfig.overrunLimitSeconds,
        allowNegative: timerConfig.allowNegative,
        timestamp: Date.now(),
        updateCounter: timerUpdateCounter  // Монотонный счетчик
    };

    // FIX BUG-013: Безопасная отправка IPC сообщений
    safelySendToWindow(widgetWindow, 'timer-state', timerState);
    safelySendToWindow(displayWindow, 'timer-state', timerState);
    safelySendToWindow(controlWindow, 'timer-state', timerState);
    // F-022: cheap path on every tick — just update the tooltip.
    // updateTrayMenu() handles Menu rebuild only when running state actually changes.
    if (typeof updateTrayMenu === 'function') { updateTrayMenu(); }
}

// Broadcast window state to all windows
function broadcastWindowState(channel, data) {
    safelySendToWindow(controlWindow, channel, data);
    safelySendToWindow(widgetWindow, channel, data);
    safelySendToWindow(displayWindow, channel, data);
    safelySendToWindow(clockWidgetWindow, channel, data);
    // F-022: widget/clock open-close changes tray menu checkboxes; trigger rebuild.
    if (typeof updateTrayMenu === 'function') { updateTrayMenu(); }
}

function finishTimer(finalRemaining) {
    clearTimerInterval();
    const remaining = finalRemaining !== undefined
        ? finalRemaining
        : (timerConfig.allowNegative ? timerState.remainingSeconds : Math.max(0, timerState.remainingSeconds));
    emitTimerState({
        isRunning: false,
        isPaused: false,
        finished: true,
        remainingSeconds: remaining
    });
}

function broadcastEvent(eventName) {
    safelySendToWindow(controlWindow, eventName);
    safelySendToWindow(widgetWindow, eventName);
    safelySendToWindow(displayWindow, eventName);
}

function startTimer() {
    // Защита от повторного запуска: проверяем и state, и наличие интервала
    if (timerState.isRunning || timerInterval) {return;}

    // Убедиться что предыдущий интервал полностью очищен
    clearTimerInterval();

    const started = timerEngine.start(timerState);
    emitTimerState({
        isRunning: started.isRunning,
        isPaused: started.isPaused,
        finished: started.finished
    });

    timerInterval = setInterval(() => {
        const { state: nextState, events, finished } = timerEngine.tick(timerState, timerConfig);

        // Broadcast events (timer-reached-zero / timer-minute / timer-overrun-minute)
        for (const eventName of events) {
            broadcastEvent(eventName);
        }

        if (finished) {
            finishTimer(nextState.remainingSeconds);
            return;
        }

        emitTimerState({
            remainingSeconds: nextState.remainingSeconds,
            finished: false
        });
    }, CONFIG.TIMER_TICK_INTERVAL || 1000);
}

// Единые функции управления таймером (используются из timer-command и timer-control)
function handleTimerStart() {
    if (timerState.remainingSeconds <= 0 && !timerConfig.allowNegative) {
        finishTimer();
        return;
    }
    startTimer();
}

function handleTimerPause() {
    clearTimerInterval();
    const paused = timerEngine.pause(timerState);
    emitTimerState({
        isRunning: paused.isRunning,
        isPaused: paused.isPaused,
        finished: paused.finished
    });
}

// Race guard — prevent concurrent reset requests from overlapping
let isResetting = false;
function handleTimerReset() {
    if (isResetting) { return; }
    isResetting = true;
    try {
        clearTimerInterval();
        const resetState = timerEngine.reset(timerState);
        emitTimerState({
            totalSeconds: resetState.totalSeconds,
            remainingSeconds: resetState.remainingSeconds,
            isRunning: resetState.isRunning,
            isPaused: resetState.isPaused,
            finished: resetState.finished
        });
    } finally {
        setTimeout(() => { isResetting = false; }, 100);
    }
}

function createControlWindow() {
    const __ctrlT0 = Date.now();
    // Get screen dimensions for adaptive sizing
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Default size of the control panel WITHOUT drawer (drawer adds ~320px when opened).
    // Settings live in the drawer, so the panel itself can be narrow and short.
    const windowWidth = Math.min(380, Math.max(340, screenWidth - 100));
    const windowHeight = Math.min(720, Math.max(640, screenHeight - 100));

    controlWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: 340,
        minHeight: 640,
        maxWidth: 1200,  // 880 (panel max) + 320 (drawer) leaves room for resize
        maxHeight: 1100,
        // Control is opaque. Without `backgroundColor`, Electron paints the
        // window white, and any translucent surface (.control-panel uses
        // `rgba(28,28,30,0.72)` with backdrop-blur) shows that white through
        // — the panel renders bright/washed-out instead of dark glass. Match
        // the darkest stop so glass stays glass.
        backgroundColor: '#000000',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            devTools: false
        },
        title: 'Управление Таймером',
        icon: path.join(__dirname, 'icon.ico'),
        frame: false,
        resizable: true, // Allow user to resize if needed
        show: !__screenshotMode
    });

    controlWindow.loadFile('electron-control.html').catch(err => log.error('loadFile failed:', err));
    hardenWindow(controlWindow);
    bindRenderConsole(controlWindow, 'control');

    // Enable Ctrl+Wheel window resizing
    controlWindow.webContents.once('did-finish-load', () => {
        blockZoom(controlWindow);
    });

    controlWindow.once('ready-to-show', () => {
        log.info(`[perf] control window ready in ${Date.now() - __ctrlT0}ms`);
    });

    controlWindow.on('closed', () => {
        controlWindow = null;
    });
}

function createWidgetWindow() {
    const __widgetT0 = Date.now();
    const { width } = screen.getPrimaryDisplay().workAreaSize;

    widgetWindow = new BrowserWindow({
        width: 250,
        height: 280,
        // Allow smaller and larger dynamic scaling; we will resize via IPC rather than CSS transforms
        minWidth: 120,
        minHeight: 140,
        // Remove explicit max constraints so user scaling isn't capped artificially
        x: __screenshotMode ? -2500 : width - 270,
        y: __screenshotMode ? -2500 : 20,
        frame: false,
        transparent: !__screenshotMode,
        backgroundColor: __screenshotMode ? '#1c1c1e' : undefined,
        alwaysOnTop: !__screenshotMode,
        skipTaskbar: true,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            devTools: false
        },
        hasShadow: false
    });
    widgetWindow.loadFile('electron-widget.html').catch(err => log.error('loadFile failed:', err));
    hardenWindow(widgetWindow);
    bindRenderCrashHandler(widgetWindow, 'widget');
    bindRenderConsole(widgetWindow, 'widget');

    widgetWindow.webContents.once('did-finish-load', () => {
        blockZoom(widgetWindow);
    });

    widgetWindow.once('ready-to-show', () => {
        log.info(`[perf] widget window ready in ${Date.now() - __widgetT0}ms`);
    });

    widgetWindow.on('closed', () => {
        widgetWindow = null;
        // Уведомляем окно управления что виджет закрыт
        broadcastWindowState('widget-window-state', { isOpen: false });
    });
}

function createClockWidgetWindow() {
    const __clockT0 = Date.now();
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    clockWidgetWindow = new BrowserWindow({
        width: 220,
        height: 220,
        minWidth: 120,
        minHeight: 120,
        x: __screenshotMode ? -2800 : width - 240,
        y: __screenshotMode ? -2500 : height - 260,
        frame: false,
        transparent: !__screenshotMode,
        backgroundColor: __screenshotMode ? '#1c1c1e' : undefined,
        alwaysOnTop: !__screenshotMode,
        skipTaskbar: true,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            devTools: false
        },
        hasShadow: false
    });
    clockWidgetWindow.loadFile('electron-clock-widget.html').catch(err => log.error('loadFile failed:', err));
    hardenWindow(clockWidgetWindow);
    bindRenderCrashHandler(clockWidgetWindow, 'clock');
    bindRenderConsole(clockWidgetWindow, 'clock');

    clockWidgetWindow.webContents.once('did-finish-load', () => {
        blockZoom(clockWidgetWindow);
    });

    clockWidgetWindow.once('ready-to-show', () => {
        log.info(`[perf] clock window ready in ${Date.now() - __clockT0}ms`);
    });

    clockWidgetWindow.on('closed', () => {
        clockWidgetWindow = null;
        // Уведомляем окно управления что виджет часов закрыт
        broadcastWindowState('clock-window-state', { isOpen: false });
    });
}

function createDisplayWindow(displayIndex) {
    const __displayT0 = Date.now();
    const displays = screen.getAllDisplays();
    let targetDisplay;
    
    if (displayIndex === 'auto' || displayIndex === undefined) {
        // Авто: предпочитаем внешний монитор
        targetDisplay = displays.find(display => display.bounds.x !== 0 || display.bounds.y !== 0) 
            || screen.getPrimaryDisplay();
    } else {
        // Выбранный монитор по индексу (с валидацией)
        const idx = parseInt(displayIndex, 10);
        targetDisplay = (!isNaN(idx) && idx >= 0 && idx < displays.length)
            ? displays[idx]
            : screen.getPrimaryDisplay();
    }
    
    const displayBounds = targetDisplay.bounds;

    displayWindow = new BrowserWindow({
        width: __screenshotMode ? 1280 : displayBounds.width,
        height: __screenshotMode ? 720 : displayBounds.height,
        x: __screenshotMode ? -2000 : displayBounds.x,
        y: __screenshotMode ? -2000 : displayBounds.y,
        fullscreen: !__screenshotMode,
        frame: false,
        // `frame: false` на Windows по умолчанию оставляет WS_THICKFRAME —
        // DWM рисует поверх содержимого тонкую светлую рамку по периметру
        // (это и есть «белая обводка по краям» в полноэкранном режиме).
        // Убираем стиль: resize-ручки не нужны — окно и так fullscreen.
        thickFrame: false,
        hasShadow: false,
        show: !__screenshotMode,
        // Match the gradient's darkest stop so the underlying compositor
        // surface never paints white on the sides when the body's gradient
        // hasn't fully covered yet (initial paint, repaint glitches,
        // sub-pixel rounding on fractional DPI).
        backgroundColor: '#000000',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            devTools: false
        }
    });

    displayWindow.loadFile('display.html').catch(err => log.error('loadFile failed:', err));
    hardenWindow(displayWindow);
    bindRenderCrashHandler(displayWindow, 'display');
    bindRenderConsole(displayWindow, 'display');
    blockZoom(displayWindow);

    displayWindow.once('ready-to-show', () => {
        log.info(`[perf] display window ready in ${Date.now() - __displayT0}ms`);
    });

    const thisWindow = displayWindow;
    displayWindow.on('closed', () => {
        // Защита от race condition: не обнуляем если уже создано новое окно
        if (displayWindow === thisWindow) {
            displayWindow = null;
        }
        broadcastWindowState('display-window-state', { isOpen: false });
    });
}

// ============================================================================
// Crash recovery — persist timer state to file so we can offer to resume after crash
// Implementation lives in ./recovery.js (pure, no electron deps) — thin wrappers
// below inject the userData path & electron-log logger.
// ============================================================================
function saveTimerStateToFile() {
    return recovery.saveTimerStateToFile(app.getPath('userData'), timerState, log);
}

function loadSavedTimerState() {
    return recovery.loadSavedTimerState(app.getPath('userData'), log);
}

function clearSavedTimerState() {
    recovery.clearSavedTimerState(app.getPath('userData'));
}

// Persist state every 10 seconds while timer is running
if (!__inTestMode) {
    setInterval(() => {
        if (timerState.isRunning) { saveTimerStateToFile(); }
    }, 10000);
}

// ============================================================================
// System Tray
// ============================================================================
let tray = null;
let isQuitting = false;

// F-022: cache last-seen booleans; only rebuild Menu when they actually change.
// Remaining-seconds updates every tick are routed through the tooltip only.
let _trayLastRunning = null;
let _trayLastWidgetOpen = null;
let _trayLastClockOpen = null;

function createTray() {
    try {
        const iconPath = path.join(__dirname, 'build', 'icon.png');
        const icon = nativeImage.createFromPath(iconPath);
        const trayIcon = icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 });
        tray = new Tray(trayIcon);
        tray.setToolTip('Timer Widget');
        rebuildTrayMenu();
        updateTrayTime();
        tray.on('click', () => {
            if (!controlWindow) { createControlWindow(); return; }
            if (controlWindow.isVisible()) { controlWindow.hide(); }
            else { controlWindow.show(); controlWindow.focus(); }
        });
        log.info('System tray created');
    } catch (err) {
        log.warn('Tray creation failed (no tray support?):', err);
    }
}

function formatTrayTime(secs) {
    const neg = secs < 0;
    const abs = Math.abs(secs);
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = abs % 60;
    const pad = (n) => String(n).padStart(2, '0');
    const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return (neg ? '-' : '') + body;
}

// Full Menu rebuild — only when boolean state changes (isRunning / widget open / clock open).
function rebuildTrayMenu() {
    if (!tray) { return; }
    const running = timerState.isRunning;
    const widgetOpen = !!widgetWindow;
    const clockOpen = !!clockWidgetWindow;
    _trayLastRunning = running;
    _trayLastWidgetOpen = widgetOpen;
    _trayLastClockOpen = clockOpen;

    const remaining = formatTrayTime(timerState.remainingSeconds || 0);
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
            if (!controlWindow) { createControlWindow(); return; }
            controlWindow.show();
            controlWindow.focus();
        }},
        { label: 'Виджет', type: 'checkbox', checked: widgetOpen, click: () => {
            if (widgetWindow) { widgetWindow.close(); }
            else { createWidgetWindow(); }
            setTimeout(updateTrayMenu, 200);
        }},
        { label: 'Часы', type: 'checkbox', checked: clockOpen, click: () => {
            if (clockWidgetWindow) { clockWidgetWindow.close(); }
            else { createClockWidgetWindow(); }
            setTimeout(updateTrayMenu, 200);
        }},
        { type: 'separator' },
        { label: 'Выход', click: () => { isQuitting = true; app.quit(); }}
    ]);
    tray.setContextMenu(menu);
}

// Lightweight per-tick update — only touches the tooltip (no Menu rebuild).
function updateTrayTime() {
    if (!tray) { return; }
    const remaining = formatTrayTime(timerState.remainingSeconds || 0);
    try { tray.setToolTip(`Timer Widget — ${remaining}`); } catch { /* tray destroyed */ }
}

// Decide whether to rebuild the Menu. Called from tray-click handlers & window close.
// emitTimerState calls updateTrayTime directly (cheap path).
function updateTrayMenu() {
    if (!tray) { return; }
    const running = timerState.isRunning;
    const widgetOpen = !!widgetWindow;
    const clockOpen = !!clockWidgetWindow;
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
        if (!isQuitting && tray) {
            event.preventDefault();
            win.hide();
        }
    });
}

// Render process crash handler
function bindRenderCrashHandler(win, label) {
    if (!win || !win.webContents) { return; }
    win.webContents.on('render-process-gone', (_event, details) => {
        log.error(`Render process gone in ${label}: ${JSON.stringify(details)}`);
        if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
            try { win.reload(); } catch (err) { log.error('Reload failed:', err); }
        }
    });
}

// Forward renderer console + preload + responsiveness events into electron-log.
// Lets us see inline-script errors (which otherwise die silently) in the log file.
function bindRenderConsole(win, label) {
    if (!win || !win.webContents) { return; }
    win.webContents.on('console-message', (e) => {
        try {
            const level = (e && e.level) || 'info';
            const src = e && e.sourceId ? ` @ ${e.sourceId}:${e.lineNumber || '?'}` : '';
            const msg = `[renderer:${label}] ${(e && e.message) || ''}${src}`;
            if (level === 'error') { log.error(msg); }
            else if (level === 'warning' || level === 'warn') { log.warn(msg); }
            else if (level === 'debug' || level === 'verbose') { log.debug(msg); }
            else { log.info(msg); }
        } catch { /* best effort */ }
    });
    win.webContents.on('preload-error', (_e, preloadPath, error) => {
        log.error(`[renderer:${label}] preload-error in ${preloadPath}: ${error && error.message}`);
    });
    win.on('unresponsive', () => log.warn(`[renderer:${label}] window unresponsive`));
    win.on('responsive', () => log.info(`[renderer:${label}] window responsive again`));
}

app.on('before-quit', () => { isQuitting = true; clearSavedTimerState(); });

app.whenReady().then(() => {
    // Remove default Electron menu (File, Edit, View, Help)
    Menu.setApplicationMenu(null);

    // Recovery check before UI
    const saved = loadSavedTimerState();
    const hasRecovery = recovery.isRecoveryValid(saved, Date.now());
    if (hasRecovery) {
        log.info(`Recovery candidate found (age ${Math.round((Date.now() - saved.savedAt) / 1000)}s)`);
        timerState.presetSeconds = saved.presetSeconds;
        // We don't auto-start — control window will offer resume via IPC timer-recovery-available
    }

    createControlWindow();
    bindRenderCrashHandler(controlWindow, 'control');

    if (__screenshotMode) {
        const runner = require('./scripts/screenshot-runner');
        controlWindow.webContents.once('did-finish-load', () => {
            runner.run({
                app, log,
                ctx: () => ({
                    control: controlWindow, widget: widgetWindow,
                    clock: clockWidgetWindow, display: displayWindow
                }),
                applyTimerState: (s) => emitTimerState(s),
                openWidget: () => { if (!widgetWindow) { createWidgetWindow(); } },
                openClock: () => { if (!clockWidgetWindow) { createClockWidgetWindow(); } },
                openDisplay: () => { if (!displayWindow) { createDisplayWindow('auto'); } },
                outDir: path.join(__dirname, 'screenshots')
            }).catch((err) => {
                log.error('[screenshot] sequence failed:', err);
                app.exit(1);
            });
        });
        return; // skip tray + normal activate hooks in screenshot mode
    }

    createTray();
    bindTrayBehavior(controlWindow);

    // F-005: broadcast recovery snapshot to control window once it has loaded.
    // Renderer may ignore it for now, but the channel is no longer dead code.
    if (hasRecovery && controlWindow) {
        controlWindow.webContents.once('did-finish-load', () => {
            safelySendToWindow(controlWindow, 'timer-recovery-available', saved);
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
    clearTimerInterval(); // Очищаем интервал таймера при закрытии
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC обработчики для синхронизации
ipcMain.on('timer-command', (_event, payload = {}) => {
    const { type, seconds, deltaSeconds, allowNegative, overrunLimitSeconds, overrunIntervalMinutes } = payload;

    // Обновляем конфиг до выполнения команды
    let configChanged = false;

    if (typeof allowNegative === 'boolean') {
        if (timerConfig.allowNegative !== allowNegative) {
            timerConfig = { ...timerConfig, allowNegative };
            configChanged = true;
        }
    }
    if (overrunLimitSeconds !== null && overrunLimitSeconds !== undefined) {
        const newLimit = Math.max(0, Number(overrunLimitSeconds) || 0);
        if (timerConfig.overrunLimitSeconds !== newLimit) {
            timerConfig = { ...timerConfig, overrunLimitSeconds: newLimit };
            configChanged = true;
        }
    }
    if (overrunIntervalMinutes !== null && overrunIntervalMinutes !== undefined) {
        const newVal = Math.max(1, Number(overrunIntervalMinutes) || 1);
        if (timerConfig.overrunIntervalMinutes !== newVal) {
            timerConfig = { ...timerConfig, overrunIntervalMinutes: newVal };
            configChanged = true;
        }
    }

    // Отслеживаем, сделал ли switch emit (чтобы не дублировать)
    let emittedByCommand = false;

    switch (type) {
        case 'set': {
            if (timerState.isRunning) {break;}
            const presetState = timerEngine.setPreset(timerState, seconds);
            emitTimerState({
                totalSeconds: presetState.totalSeconds,
                remainingSeconds: presetState.remainingSeconds,
                presetSeconds: presetState.presetSeconds,
                isRunning: presetState.isRunning,
                isPaused: presetState.isPaused,
                finished: presetState.finished
            });
            emittedByCommand = true;
            break;
        }
        case 'adjust': {
            const adjustedState = timerEngine.adjust(timerState, deltaSeconds, timerConfig.allowNegative);
            emitTimerState({
                totalSeconds: adjustedState.totalSeconds,
                remainingSeconds: adjustedState.remainingSeconds,
                finished: adjustedState.finished
            });
            emittedByCommand = true;
            break;
        }
        case 'start': {
            handleTimerStart();
            emittedByCommand = true;
            break;
        }
        case 'pause': {
            handleTimerPause();
            emittedByCommand = true;
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

// Изменение размера окна управления
// size.width / size.height опциональны: если поле не передано (или не Finite),
// соответствующее измерение не меняется. Это нужно, чтобы drawer open/close
// менял ТОЛЬКО ширину — иначе перезапись height=window.innerHeight округляется
// при каждом setSize (HiDPI) и сбивает ручную высоту, которую выставил юзер.
ipcMain.on('resize-control-window', (event, size) => {
    if (!controlWindow || !size || typeof size !== 'object') { return; }
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const [curW, curH] = controlWindow.getSize();
    const w = Number.isFinite(size.width) ? size.width : curW;
    const h = Number.isFinite(size.height) ? size.height : curH;
    // Нижний clamp = BrowserWindow min (см. createControlWindow): 340×640.
    const targetWidth = Math.max(CONFIG.CONTROL_WINDOW_MIN_WIDTH, Math.min(w, screenWidth - 50));
    const targetHeight = Math.max(640, Math.min(h, screenHeight - 50));

    // No-op если ничего не меняется — избегаем лишнего setSize (WM на Windows
    // иногда округляет outer на 1px при каждом вызове, что даёт дрейф).
    if (targetWidth === curW && targetHeight === curH) { return; }

    const [x, y] = controlWindow.getPosition();
    controlWindow.setSize(targetWidth, targetHeight);

    if (y + targetHeight > screenHeight) {
        controlWindow.setPosition(x, Math.max(0, screenHeight - targetHeight - 20));
    }
});

// Рассылка обновления цветов всем окнам
ipcMain.on('colors-update', (event, colors) => {
    safelySendToWindow(widgetWindow, 'colors-update', colors);
    safelySendToWindow(displayWindow, 'colors-update', colors);

    // Не отправляем обратно в controlWindow если событие пришло от него
    if (controlWindow && event.sender !== controlWindow.webContents) {
        safelySendToWindow(controlWindow, 'colors-update', colors);
    }
});

// Per-window color updates (independent themes)
ipcMain.on('widget-colors-update', (_event, colors) => {
    lastWidgetColors = colors;
    safelySendToWindow(widgetWindow, 'widget-colors-update', colors);
    safelySendToWindow(controlWindow, 'widget-colors-update', colors);
});

ipcMain.on('clock-colors-update', (_event, colors) => {
    lastClockColors = colors;
    safelySendToWindow(clockWidgetWindow, 'clock-colors-update', colors);
});

ipcMain.on('display-colors-update', (_event, colors) => {
    lastDisplayColors = colors;
    safelySendToWindow(displayWindow, 'display-colors-update', colors);
});

// Widget style update (independent from display style)
ipcMain.on('widget-style-update', (_event, settings) => {
    lastWidgetStyle = settings;
    safelySendToWindow(widgetWindow, 'widget-style-update', settings);
});

// Рассылка настроек отображения fullscreen и widget (clockStyle/background)
ipcMain.on('display-settings-update', (event, settings) => {
    // Сохраняем настройки для синхронизации при открытии новых окон
    lastDisplaySettings = settings;

    safelySendToWindow(displayWindow, 'display-settings-update', settings);
    safelySendToWindow(clockWidgetWindow, 'display-settings-update', settings);
});

ipcMain.on('open-widget', () => {
    if (!widgetWindow) {
        createWidgetWindow();
        if (widgetWindow) {
            widgetWindow.webContents.on('did-finish-load', () => {
                safelySendToWindow(widgetWindow, 'timer-state', timerState);
                // Отправляем сохранённые настройки дисплея (включая стиль)
                if (lastDisplaySettings) {
                    safelySendToWindow(widgetWindow, 'display-settings-update', lastDisplaySettings);
                }
                // Per-window colors and style
                if (lastWidgetColors) {
                    safelySendToWindow(widgetWindow, 'widget-colors-update', lastWidgetColors);
                }
                if (lastWidgetStyle) {
                    safelySendToWindow(widgetWindow, 'widget-style-update', lastWidgetStyle);
                }
            });
            // Уведомляем окно управления что виджет открыт
            broadcastWindowState('widget-window-state', { isOpen: true });
        }
    } else {
        widgetWindow.focus();
    }
});

ipcMain.on('close-widget', () => {
    if (widgetWindow) {
        widgetWindow.close();
        // Уведомление отправится в обработчике 'closed' события окна
    }
});

// Управление окном панели управления
ipcMain.on('minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) { win.minimize(); }
});

ipcMain.on('display-move', (_event, { deltaX, deltaY }) => {
    if (displayWindow && Number.isFinite(deltaX) && Number.isFinite(deltaY)) {
        const [currentX, currentY] = displayWindow.getPosition();
        displayWindow.setPosition(Math.round(currentX + deltaX), Math.round(currentY + deltaY), true);
    }
});

ipcMain.on('toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) { win.setFullScreen(!win.isFullScreen()); }
});

ipcMain.on('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) { win.close(); }
});

ipcMain.on('quit-app', () => {
    clearTimerInterval();
    app.quit();
});

ipcMain.on('reset-and-relaunch', async () => {
    clearTimerInterval();
    const { session } = require('electron');
    try {
        await Promise.all([
            session.defaultSession.clearStorageData(),
            session.defaultSession.clearCache()
        ]);
    } catch (err) {
        log.error('Storage clear failed:', err);
    }
    app.quit();
});

// Виджет часов
ipcMain.on('open-clock-widget', () => {
    if (!clockWidgetWindow) {
        createClockWidgetWindow();
        if (clockWidgetWindow) {
            clockWidgetWindow.webContents.on('did-finish-load', () => {
                // Отправляем сохранённые настройки дисплея (включая стиль часов)
                if (lastDisplaySettings) {
                    safelySendToWindow(clockWidgetWindow, 'display-settings-update', lastDisplaySettings);
                }
                // Per-window colors
                if (lastClockColors) {
                    safelySendToWindow(clockWidgetWindow, 'clock-colors-update', lastClockColors);
                }
            });
            // Уведомляем окно управления что виджет часов открыт
            broadcastWindowState('clock-window-state', { isOpen: true });
        }
    } else {
        clockWidgetWindow.focus();
    }
});

ipcMain.on('close-clock-widget', () => {
    if (clockWidgetWindow) {
        clockWidgetWindow.close();
        // Уведомление отправится в обработчике 'closed' события окна
    }
});

ipcMain.on('clock-widget-resize', (_event, { width, height }) => {
    if (clockWidgetWindow && !clockWidgetWindow.isDestroyed()) {
        const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
        const w = Math.max(100, Math.min(screenW, Number(width) || 220));
        const h = Math.max(100, Math.min(screenH, Number(height) || 220));
        clockWidgetWindow.setSize(w, h);
    }
});



ipcMain.on('clock-widget-move', (_event, { deltaX, deltaY }) => {
    if (clockWidgetWindow && Number.isFinite(deltaX) && Number.isFinite(deltaY)) {
        const [currentX, currentY] = clockWidgetWindow.getPosition();
        clockWidgetWindow.setPosition(Math.round(currentX + deltaX), Math.round(currentY + deltaY), true);
    }
});

ipcMain.on('clock-widget-set-style', (event, style) => {
    safelySendToWindow(clockWidgetWindow, 'set-clock-style', style);
});

// Настройки виджета часов (дата, часовой пояс и т.д.)
ipcMain.on('clock-widget-settings', (event, settings) => {
    safelySendToWindow(clockWidgetWindow, 'clock-settings', settings);
});

// Получение списка мониторов
ipcMain.on('get-displays', (event) => {
    const displays = screen.getAllDisplays();
    event.sender.send('displays-list', displays);
});

ipcMain.on('open-display', (event, options = {}) => {
    // Use provided displayIndex, or fall back to last used
    const displayIndex = options.displayIndex !== undefined ? options.displayIndex : lastDisplayIndex;
    lastDisplayIndex = displayIndex;

    // Если дисплей уже открыт и запрос на тот же монитор - просто фокус
    if (displayWindow && displayIndex === displayWindow._displayIndex) {
        displayWindow.focus();
        return;
    }

    // Закрываем старое окно если оно открыто (переключение монитора)
    if (displayWindow) {
        displayWindow.close();
        displayWindow = null;
    }

    createDisplayWindow(displayIndex);
    if (displayWindow) {
        // Сохраняем индекс монитора для проверки
        displayWindow._displayIndex = displayIndex;

        displayWindow.webContents.on('did-finish-load', () => {
            safelySendToWindow(displayWindow, 'timer-state', timerState);
            // Отправляем сохранённые настройки дисплея (включая стиль)
            if (lastDisplaySettings) {
                safelySendToWindow(displayWindow, 'display-settings-update', lastDisplaySettings);
            }
            // Per-window colors
            if (lastDisplayColors) {
                safelySendToWindow(displayWindow, 'display-colors-update', lastDisplayColors);
            }
        });
        // Уведомляем окно управления что дисплей открыт
        broadcastWindowState('display-window-state', { isOpen: true });
    }
});

ipcMain.on('close-display', () => {
    if (displayWindow) {
        displayWindow.close();
        // Уведомление отправится в обработчике 'closed' события окна
    }
});

// Управление виджетом
ipcMain.on('widget-set-opacity', (event, opacity) => {
    if (widgetWindow && typeof opacity === 'number' && opacity >= 0 && opacity <= 1) {
        widgetWindow.setOpacity(opacity);
    }
});

ipcMain.on('widget-set-position', (event, { x, y }) => {
    if (widgetWindow && Number.isFinite(x) && Number.isFinite(y)) {
        widgetWindow.setPosition(Math.round(x), Math.round(y));
    }
});

ipcMain.on('widget-resize', (_event, data) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        const { width, height } = data;
        const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
        const w = Math.max(100, Math.min(screenW, Number(width) || 220));
        const h = Math.max(100, Math.min(screenH, Number(height) || 220));
        widgetWindow.setSize(w, h);
    }
});



ipcMain.on('widget-move', (event, { deltaX, deltaY }) => {
    if (widgetWindow && Number.isFinite(deltaX) && Number.isFinite(deltaY)) {
        const [currentX, currentY] = widgetWindow.getPosition();
        widgetWindow.setPosition(Math.round(currentX + deltaX), Math.round(currentY + deltaY), true);
    }
});

// Управление таймером через виджет (делегирует в единые функции)
ipcMain.on('timer-control', (_event, action) => {
    switch (action) {
        case 'start': handleTimerStart(); break;
        case 'pause': handleTimerPause(); break;
        case 'reset': handleTimerReset(); break;
    }
});

// Autostart (open at login)
ipcMain.on('set-autostart', (_event, enabled) => {
    try {
        app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: true });
        log.info(`Autostart: ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
        log.error('set-autostart failed:', err);
    }
});
ipcMain.handle('get-autostart', () => {
    try { return app.getLoginItemSettings().openAtLogin; }
    catch { return false; }
});

// Export logs for diagnostics
ipcMain.handle('export-logs', async () => {
    try {
        const logPath = log.transports.file.getFile().path;
        const stamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const result = await dialog.showSaveDialog({
            defaultPath: `timer-widget-logs-${stamp}.log`,
            filters: [{ name: 'Log files', extensions: ['log'] }]
        });
        if (result.canceled || !result.filePath) { return { ok: false, canceled: true }; }
        fs.copyFileSync(logPath, result.filePath);
        log.info(`Logs exported to ${result.filePath}`);
        return { ok: true, path: result.filePath };
    } catch (err) {
        log.error('export-logs failed:', err);
        return { ok: false, error: String(err) };
    }
});
