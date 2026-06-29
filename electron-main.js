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

const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const log = require('electron-log/main');
const { safelySendToWindow, formatTimeShort } = require('./utils');
const CONFIG = require('./constants');
const timerEngine = require('./timer-engine');
const { createTimerController } = require('./timer-controller');
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
    try { saveTimerStateToFileSync(); } catch { /* best effort */ }
});
process.on('unhandledRejection', (reason) => {
    log.error('UNHANDLED REJECTION:', reason);
    try { saveTimerStateToFileSync(); } catch { /* best effort */ }
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
// The timer state machine lives in ./timer-controller.js (Electron-free, unit
// tested with a fake clock). The controller OWNS timerState/timerConfig, the
// monotonic update counter, and the wall-clock anchors. This process keeps the
// real setInterval (timerInterval) and feeds the controller a real clock + the
// IPC broadcast callbacks. `timerState` below is a read-only mirror kept in sync
// via the onState callback so the rest of this file (tray, recovery, IPC reply,
// window-open snapshots) can read it synchronously exactly as before.
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

const timerController = createTimerController({
    engine: timerEngine,
    now: Date.now,
    // FIX BUG-013: Безопасная отправка IPC сообщений
    onState: (state) => {
        timerState = state;
        safelySendToWindow(widgetWindow, 'timer-state', state);
        safelySendToWindow(displayWindow, 'timer-state', state);
        safelySendToWindow(controlWindow, 'timer-state', state);
        // F-022: cheap path on every tick — just update the tooltip.
        // updateTrayMenu() handles Menu rebuild only when running state changes.
        if (typeof updateTrayMenu === 'function') { updateTrayMenu(); }
    },
    onEvent: (eventName) => broadcastEvent(eventName)
});
// Keep the local mirror pointed at the controller's initial state.
timerState = timerController.getState();

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

// Защита от навигации и открытия новых окон.
// will-navigate ловит обычную навигацию, will-redirect — серверные/meta редиректы,
// will-frame-navigate — навигацию субфреймов; блокируем всё, что не file://.
function hardenWindow(win) {
    const blockNonFile = (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
        }
    };
    win.webContents.on('will-navigate', blockNonFile);
    win.webContents.on('will-redirect', blockNonFile);
    // will-frame-navigate передаёт WebFrameMain-событие, целевой URL в event.url
    win.webContents.on('will-frame-navigate', (event) => blockNonFile(event, event.url));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function isPayloadObject(payload) {
    return payload !== null && typeof payload === 'object';
}

// Shared delta-move for a frameless window. Reads deltaX/deltaY from the payload
// INSIDE the body (never destructured in the IPC handler params — see
// tests/electron-main-source.test.js). Validates the payload object + finite deltas.
function moveWindowBy(win, payload) {
    if (!isPayloadObject(payload)) { return; }
    const { deltaX, deltaY } = payload;
    if (win && Number.isFinite(deltaX) && Number.isFinite(deltaY)) {
        const [currentX, currentY] = win.getPosition();
        win.setPosition(Math.round(currentX + deltaX), Math.round(currentY + deltaY), true);
    }
}

// Shared clamped resize for a frameless window. Clamps width/height to
// [100, workArea] with a 220px default when the field is missing/non-numeric.
function resizeWindowClamped(win, payload) {
    if (!isPayloadObject(payload)) { return; }
    if (win && !win.isDestroyed()) {
        const { width, height } = payload;
        const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
        const w = Math.max(100, Math.min(screenW, Number(width) || 220));
        const h = Math.max(100, Math.min(screenH, Number(height) || 220));
        win.setSize(w, h);
    }
}

// Runtime app icon path. In dev it lives in build/icon.png (buildResources),
// but build/ is NOT packed into app.asar — so in a packaged build the icon is
// shipped via electron-builder `extraResources` and resolved from
// process.resourcesPath. Using __dirname there would point inside the asar
// where the file doesn't exist (blank tray/window icon).
function getAppIconPath() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(__dirname, 'build', 'icon.png');
}

function clearTimerInterval() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Thin wrapper preserved so the screenshot-runner's applyTimerState and any
// other caller keep working. Delegates to the controller's patch() (which owns
// the counter bump + stamping + the onState broadcast above).
function emitTimerState(partial = {}) {
    timerController.patch(partial);
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

function broadcastEvent(eventName) {
    safelySendToWindow(controlWindow, eventName);
    safelySendToWindow(widgetWindow, eventName);
    safelySendToWindow(displayWindow, eventName);
}

// Advance the timer to match real elapsed wall-clock time since the anchor.
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
        timerInterval = setInterval(reconcileTimer, CONFIG.TIMER_TICK_INTERVAL || 1000);
    }
}

function handleTimerPause() {
    clearTimerInterval();
    timerController.pause();
}

function handleTimerReset() {
    clearTimerInterval();
    timerController.reset();
}

function createControlWindow() {
    const __ctrlT0 = Date.now();
    // Get screen dimensions for adaptive sizing
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Default size of the control panel WITHOUT drawer (drawer adds ~320px when opened).
    // Settings live in the drawer, so the panel itself can be narrow and short.
    const windowWidth = Math.min(CONFIG.CONTROL_WINDOW_WIDTH, Math.max(CONFIG.CONTROL_WINDOW_MIN_WIDTH, screenWidth - 100));
    const windowHeight = Math.min(740, Math.max(660, screenHeight - 100));

    controlWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: CONFIG.CONTROL_WINDOW_MIN_WIDTH,
        minHeight: 660,
        maxWidth: 1200,  // 880 (panel max) + 320 (drawer) leaves room for resize
        maxHeight: 1100,
        // Keep the control window visually rounded. The dark glass is painted
        // by electron-control.html inside a rounded shell; the native
        // BrowserWindow surface must stay transparent so the corners do not
        // render as a square black rectangle.
        transparent: !__screenshotMode,
        backgroundColor: __screenshotMode ? '#000000' : '#00000000',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            devTools: process.argv.includes('--dev') && !app.isPackaged
        },
        title: 'Управление Таймером',
        icon: getAppIconPath(),
        frame: false,
        hasShadow: false,
        resizable: true, // Allow user to resize if needed
        show: !__screenshotMode
    });

    controlWindow.loadFile('electron-control.html').catch(err => log.error('loadFile failed:', err));
    hardenWindow(controlWindow);
    bindRenderCrashHandler(controlWindow, 'control');
    bindRenderConsole(controlWindow, 'control');

    // Enable Ctrl+Wheel window resizing
    controlWindow.webContents.once('did-finish-load', () => {
        blockZoom(controlWindow);
        if (process.argv.includes('--dev') && !app.isPackaged) {
            controlWindow.webContents.openDevTools({ mode: 'detach' });
        }
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
            devTools: process.argv.includes('--dev') && !app.isPackaged
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
            devTools: process.argv.includes('--dev') && !app.isPackaged
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
            devTools: process.argv.includes('--dev') && !app.isPackaged
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
        // Защита от race condition при переключении монитора: если новое окно
        // дисплея уже заменило это, НЕ обнуляем ref и НЕ шлём isOpen:false —
        // иначе stale-broadcast перетрёт актуальный isOpen:true нового окна и
        // рассинхронит тоггл/кнопку D в панели управления.
        if (displayWindow === thisWindow) {
            displayWindow = null;
            broadcastWindowState('display-window-state', { isOpen: false });
        }
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

// Synchronous variant for crash handlers — guarantees the snapshot hits disk
// before the handler returns (the async path may not flush before the process dies).
function saveTimerStateToFileSync() {
    recovery.saveTimerStateToFileSync(app.getPath('userData'), timerState, log);
}

function loadSavedTimerState() {
    return recovery.loadSavedTimerState(app.getPath('userData'), log);
}

function clearSavedTimerState() {
    recovery.clearSavedTimerState(app.getPath('userData'));
}

// Set early so the recovery interval and before-quit can both see it.
let isQuitting = false;

// Persist state every 10 seconds while timer is running.
// Keep the id so we can stop it on quit — otherwise a fire during teardown can
// re-create last-state.json after before-quit already unlinked it (phantom resume).
let recoverySaveInterval = null;
if (!__inTestMode) {
    recoverySaveInterval = setInterval(() => {
        if (isQuitting) { return; }
        if (timerState.isRunning) { saveTimerStateToFile(); }
    }, 10000);
}

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
        const iconPath = getAppIconPath();
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

// Full Menu rebuild — only when boolean state changes (isRunning / widget open / clock open).
function rebuildTrayMenu() {
    if (!tray) { return; }
    const running = timerState.isRunning;
    const widgetOpen = !!widgetWindow;
    const clockOpen = !!clockWidgetWindow;
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
    const remaining = formatTimeShort(timerState.remainingSeconds || 0);
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

app.on('before-quit', () => {
    isQuitting = true;
    // Stop the periodic save BEFORE unlinking, so an in-flight 10s tick can't
    // re-create the recovery file after we delete it.
    if (recoverySaveInterval) { clearInterval(recoverySaveInterval); recoverySaveInterval = null; }
    clearSavedTimerState();
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
        if (!controlWindow) { createControlWindow(); return; }
        if (controlWindow.isMinimized()) { controlWindow.restore(); }
        if (!controlWindow.isVisible()) { controlWindow.show(); }
        controlWindow.focus();
    });
}

app.whenReady().then(() => {
    // Duplicate instance — we already called app.quit() above; do nothing.
    if (!__singleInstance) { return; }

    // Remove default Electron menu (File, Edit, View, Help)
    Menu.setApplicationMenu(null);

    // Snap the countdown back to real time the instant the machine wakes from
    // sleep (setInterval doesn't fire while suspended). Safe no-op when stopped.
    try { powerMonitor.on('resume', reconcileTimer); } catch (err) { log.warn('powerMonitor resume hook failed:', err); }

    // Deny every renderer permission request (camera/mic/geo/notifications/…).
    // This is a purely offline timer — it never needs any web/device permission.
    // Defense-in-depth on top of sandbox/contextIsolation/CSP/will-navigate.
    try {
        const { session } = require('electron');
        session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        session.defaultSession.setPermissionCheckHandler(() => false);
    } catch (err) {
        log.warn('Permission handler setup failed:', err);
    }

    // Recovery check before UI. Restore the FULL snapshot (remaining/total/preset)
    // so a crash mid-countdown comes back with the in-progress time intact. We never
    // auto-start (isRunning stays false); the timer simply shows where it was paused.
    const saved = loadSavedTimerState();
    const hasRecovery = recovery.isRecoveryValid(saved, Date.now());
    if (hasRecovery) {
        log.info(`Recovery candidate found (age ${Math.round((Date.now() - saved.savedAt) / 1000)}s)`);
        // Restore the snapshot into the controller (preset always, total/remaining
        // only when finite). No emit/counter bump — nothing is listening yet.
        timerController.restoreState({
            presetSeconds: saved.presetSeconds,
            totalSeconds: saved.totalSeconds,
            remainingSeconds: saved.remainingSeconds
        });
        timerState = timerController.getState();
        // control window may also offer an explicit resume via timer-recovery-available
    }

    createControlWindow();

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
    const { type, seconds, deltaSeconds } = payload;

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
    // Нижний clamp = BrowserWindow min (см. createControlWindow).
    const targetWidth = Math.max(CONFIG.CONTROL_WINDOW_MIN_WIDTH, Math.min(w, screenWidth - 50));
    const targetHeight = Math.max(660, Math.min(h, screenHeight - 50));

    // No-op если ничего не меняется — избегаем лишнего setSize (WM на Windows
    // иногда округляет outer на 1px при каждом вызове, что даёт дрейф).
    if (targetWidth === curW && targetHeight === curH) { return; }

    const [x, y] = controlWindow.getPosition();
    controlWindow.setSize(targetWidth, targetHeight);

    if (y + targetHeight > screenHeight) {
        controlWindow.setPosition(x, Math.max(0, screenHeight - targetHeight - 20));
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

ipcMain.on('display-move', (_event, payload) => {
    moveWindowBy(displayWindow, payload);
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

ipcMain.on('clock-widget-resize', (_event, payload) => {
    resizeWindowClamped(clockWidgetWindow, payload);
});

ipcMain.on('clock-widget-move', (_event, payload) => {
    moveWindowBy(clockWidgetWindow, payload);
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

ipcMain.on('widget-set-position', (_event, payload) => {
    if (!isPayloadObject(payload)) { return; }
    const { x, y } = payload;
    if (widgetWindow && Number.isFinite(x) && Number.isFinite(y)) {
        widgetWindow.setPosition(Math.round(x), Math.round(y));
    }
});

ipcMain.on('widget-resize', (_event, payload) => {
    resizeWindowClamped(widgetWindow, payload);
});

ipcMain.on('widget-move', (_event, payload) => {
    moveWindowBy(widgetWindow, payload);
});

// Управление таймером через виджет (делегирует в единые функции)
ipcMain.on('timer-control', (_event, action) => {
    switch (action) {
        case 'start': handleTimerStart(); break;
        case 'pause': handleTimerPause(); break;
        case 'reset': handleTimerReset(); break;
    }
});
