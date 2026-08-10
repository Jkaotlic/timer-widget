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
const { fitScaledBounds } = require('./window-geometry');
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

// Изменение размера безрамочного окна. Держит неподвижным ЦЕНТР окна и
// укладывает результат в рабочую область ТОГО монитора, где окно находится.
//
// Раньше здесь был `win.setSize()`: он оставляет неподвижным левый-верхний
// угол, а позицию после него не правил никто, — поэтому окно росло вниз-вправо
// и уезжало за край экрана, унося с собой отцентрированный внутри циферблат
// (замерено: виджет при 400 % занимал x = 3170…4170 при ширине экрана 3440).
// Поджатие шло вдобавок по getPrimaryDisplay(), то есть на втором мониторе по
// чужим размерам.
//
// setBounds, а не setSize + setPosition: два вызова дают промежуточный кадр
// «уже большое, ещё не сдвинутое».
//
// Вся арифметика — в чистой fitScaledBounds() из window-geometry.js, чтобы
// проверяться в Node без запуска Electron.
function resizeWindowClamped(win, payload) {
    if (!isPayloadObject(payload)) { return; }
    if (!win || win.isDestroyed()) { return; }

    const current = win.getBounds();
    // Минимум берётся у самого окна, а не из литерала: у виджета minHeight 140,
    // и посчитанный по литералу центр промахнулся бы мимо настоящего.
    const [minWidth, minHeight] = win.getMinimumSize();
    const { workArea } = screen.getDisplayMatching(current);

    win.setBounds(fitScaledBounds(current, payload, workArea, { width: minWidth, height: minHeight }));
}

// Shared position restore for a frameless widget window. Reads x/y from the
// payload INSIDE the body (never destructured in the IPC handler params — see
// tests/electron-main-source.test.js).
//
// Positions are persisted by the renderers across sessions, so a saved point can
// reference a monitor that is no longer attached (docked laptop, unplugged TV).
// Restoring it verbatim would drop the widget somewhere invisible with no way to
// drag it back, so we require the window to land on a real display and otherwise
// clamp it into the primary work area.
function positionWindowClamped(win, payload) {
    if (!isPayloadObject(payload)) { return; }
    const { x, y } = payload;
    if (!win || win.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) { return; }

    const [width, height] = win.getSize();
    const [minWidth, minHeight] = win.getMinimumSize();
    const targetX = Math.round(x);
    const targetY = Math.round(y);

    // Какому монитору принадлежит сохранённая точка. Если ни одному — монитор
    // отключили — берём главный.
    const host = screen.getAllDisplays().find(({ bounds }) =>
        targetX >= bounds.x && targetX < bounds.x + bounds.width
        && targetY >= bounds.y && targetY < bounds.y + bounds.height)
        || screen.getPrimaryDisplay();

    // Поджимается ВЕСЬ прямоугольник, а не только угол. Прежняя версия считала
    // окно видимым, если на дисплее лежал левый-верхний угол, и размер в проверке
    // не участвовал вовсе — замерено: сохранённая точка (3320, 70) при размере
    // 1000 px давала 880 px за правым краем, на экране оставалось 12 % окна.
    // Точка попадала в хранилище буквально: так писала геометрию версия, у
    // которой масштабирование росло вниз-вправо, поэтому испорченные профили
    // существуют и правкой одного лишь масштабирования не лечатся.
    //
    // Арифметика переиспользуется из fitScaledBounds: передавая текущий размер и
    // как размер, и как «запрошенный», получаем «поставить в точку и поджать»,
    // потому что функция сохраняет центр переданного прямоугольника. Новой
    // арифметики здесь нет намеренно — она уже проверена юнит-тестами.
    win.setBounds(fitScaledBounds(
        { x: targetX, y: targetY, width, height },
        { width, height },
        host.workArea,
        { width: minWidth, height: minHeight }
    ));
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

// Полный СНИМОК состояния окон одному адресату — досылается каждому окну сразу
// после загрузки его содержимого.
//
// Зачем: решение «открыть или закрыть» и в горячих клавишах W/C/D, и в кнопках
// панели принимается по ЛОКАЛЬНОМУ флагу окна, а тот инициализируется в false и
// обновляется только сообщениями `*-window-state`. Рассылались они лишь в момент
// открытия/закрытия, поэтому окно, загрузившееся ПОЗЖЕ, о ранее открытых окнах не
// узнавало никогда. Сценарий из обычной работы: открыть часы, потом виджет и
// нажать в виджете C — виджет считает часы закрытыми и шлёт open-clock-widget,
// главный процесс лишь фокусирует уже открытое окно, и тоггл не работает.
// Тот же провал после перезагрузки рендерера краш-обработчиком
// (bindRenderCrashHandler → win.reload()) и после повторного создания панели из трея.
//
// Слушатель именно `on`, а не `once`: перезагрузка окна обязана получить снимок заново.
function sendWindowStatesTo(win) {
    safelySendToWindow(win, 'widget-window-state', { isOpen: !!widgetWindow });
    safelySendToWindow(win, 'clock-window-state', { isOpen: !!clockWidgetWindow });
    safelySendToWindow(win, 'display-window-state', { isOpen: !!displayWindow });
}

function bindWindowStateSnapshot(win) {
    if (!win || !win.webContents) { return; }
    win.webContents.on('did-finish-load', () => sendWindowStatesTo(win));
}

// Обратная сторона снимка: остальные окна узнают, что появилось новое, а само
// новое окно получает накопленное состояние.
//
// Живёт здесь, а НЕ в обработчике `ipcMain.on('open-*')`, потому что у события
// «окно открылось» должен быть один владелец — функция создания окна. Пункты
// трея зовут create-функции напрямую, и всё, что лежало в обработчике канала,
// мимо них проходило: панель не подсвечивала кнопку, горячая клавиша W/C
// считала окно закрытым и слала `open-*`, а главный процесс лишь фокусировал
// уже живое окно — переключатель выглядел мёртвым.
//
// Слушатель `on`, а не `once`, по той же причине, что и у снимка: рендерер,
// перезагруженный краш-обработчиком, обязан получить данные заново.
function announceWindowOpened(win, stateChannel, hydrate) {
    if (!win || !win.webContents) { return; }
    win.webContents.on('did-finish-load', () => {
        if (win.isDestroyed()) { return; }
        hydrate(win);
    });
    broadcastWindowState(stateChannel, { isOpen: true });
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
        // Потолок один и тот же для главного процесса и для панели: панель
        // вычитает из него ширину ящика, когда считает свою колонку.
        maxWidth: CONFIG.CONTROL_WINDOW_MAX_WIDTH,
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
    bindWindowStateSnapshot(controlWindow);
    // Привязка живёт здесь, а не в whenReady: панель пересоздаётся из трея, из
    // second-instance и по 'activate'. Вызванная один раз при старте, привязка
    // доставалась только самому первому экземпляру окна, и пересозданная панель
    // теряла поведение «закрытие = скрытие в трей» — она просто закрывалась.
    bindTrayBehavior(controlWindow);

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
        width: CONFIG.WIDGET_DEFAULT_WIDTH,
        height: CONFIG.WIDGET_DEFAULT_HEIGHT,
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
    bindWindowStateSnapshot(widgetWindow);
    announceWindowOpened(widgetWindow, 'widget-window-state', (win) => {
        safelySendToWindow(win, 'timer-state', timerState);
        // Сохранённые настройки дисплея (виджет берёт оттуда фон)
        if (lastDisplaySettings) {
            safelySendToWindow(win, 'display-settings-update', lastDisplaySettings);
        }
        // Цвета и стиль — только свои, адресными каналами
        if (lastWidgetColors) {
            safelySendToWindow(win, 'widget-colors-update', lastWidgetColors);
        }
        if (lastWidgetStyle) {
            safelySendToWindow(win, 'widget-style-update', lastWidgetStyle);
        }
    });

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
    bindWindowStateSnapshot(clockWidgetWindow);
    announceWindowOpened(clockWidgetWindow, 'clock-window-state', (win) => {
        // Настройки дисплея несут стиль часов (clockStyle) и цифры циферблата
        if (lastDisplaySettings) {
            safelySendToWindow(win, 'display-settings-update', lastDisplaySettings);
        }
        if (lastClockColors) {
            safelySendToWindow(win, 'clock-colors-update', lastClockColors);
        }
    });

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
    bindWindowStateSnapshot(displayWindow);
    blockZoom(displayWindow);

    // Монитор запоминается здесь же: обработчик `open-display` сверяет его,
    // чтобы отличить «тот же экран — просто сфокусировать» от «другой экран —
    // пересоздать окно».
    displayWindow._displayIndex = displayIndex;
    announceWindowOpened(displayWindow, 'display-window-state', (win) => {
        safelySendToWindow(win, 'timer-state', timerState);
        if (lastDisplaySettings) {
            safelySendToWindow(win, 'display-settings-update', lastDisplaySettings);
        }
        if (lastDisplayColors) {
            safelySendToWindow(win, 'display-colors-update', lastDisplayColors);
        }
    });

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
                app, log, nativeImage,
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
    // bindTrayBehavior вызывается внутри createControlWindow — здесь повторять
    // нельзя: второй обработчик 'close' навесился бы на то же окно.

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

// Обработчик намеренно тонкий: рассылка состояния и досылка настроек живут в
// createWidgetWindow, потому что окно открывают ещё и из трея — мимо этого канала.
ipcMain.on('open-widget', () => {
    if (!widgetWindow) {
        createWidgetWindow();
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

// Здесь жил обработчик 'close-window' — «закрой окно отправителя». Его никто не
// слал: окна закрываются адресными close-widget / close-clock-widget /
// close-display, а панель — quit-app. Канал стоял в обоих белых списках, то есть
// расширял поверхность IPC ради несуществующей команды.

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
// Тонкий обработчик — см. комментарий у open-widget.
ipcMain.on('open-clock-widget', () => {
    if (!clockWidgetWindow) {
        createClockWidgetWindow();
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

ipcMain.on('clock-widget-set-position', (_event, payload) => {
    positionWindowClamped(clockWidgetWindow, payload);
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

ipcMain.on('open-display', (event, options) => {
    // Payload здесь НЕОБЯЗАТЕЛЕН: виджет и часы по клавише D шлют канал без
    // аргументов, и это значит «взять последний выбранный монитор». Поэтому
    // мусор нормализуем к пустому объекту, а не отбрасываем сообщение целиком —
    // ранний выход убил бы клавишу D. Значение по умолчанию `= {}` спасало
    // только от undefined: явный null доходил до чтения поля и ронял обработчик.
    const opts = isPayloadObject(options) ? options : {};
    // Use provided displayIndex, or fall back to last used
    const displayIndex = opts.displayIndex !== undefined ? opts.displayIndex : lastDisplayIndex;
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

    // Индекс монитора, рассылка состояния и досылка настроек — внутри
    // createDisplayWindow (см. комментарий у open-widget).
    createDisplayWindow(displayIndex);
});

ipcMain.on('close-display', () => {
    if (displayWindow) {
        displayWindow.close();
        // Уведомление отправится в обработчике 'closed' события окна
    }
});

// Управление виджетом
//
// Здесь жил обработчик 'widget-set-opacity'. Прозрачностью виджета не управляет
// ничто: ни одного отправителя в проекте нет, контрола в панели нет, и виджет
// сам её не трогает. Часы читали `opacity` из своих настроек, но записать её
// тоже было некому — обе половины удалены вместе.
ipcMain.on('widget-set-position', (_event, payload) => {
    positionWindowClamped(widgetWindow, payload);
});

ipcMain.on('widget-resize', (_event, payload) => {
    resizeWindowClamped(widgetWindow, payload);
});

ipcMain.on('widget-move', (_event, payload) => {
    moveWindowBy(widgetWindow, payload);
});

// Обратный канал масштаба: окно → панель управления.
//
// Раньше поток был односторонним — панель диктовала масштаб, а Ctrl+колесо на
// самом виджете/дисплее меняло его молча. Ползунок в панели после этого показывал
// старое значение, то есть два источника правды расходились, и следующая посылка
// настроек могла вернуть масштаб назад. Теперь окно сообщает о своём новом
// масштабе, панель подтягивает ползунок — и расхождению неоткуда взяться.
//
// Пересылается ТОЛЬКО в панель: широковещание вернуло бы значение отправителю и
// могло закольцеваться.
const SCALE_REPORT_SOURCES = new Set(['widget', 'clock', 'display', 'display-blocks']);
ipcMain.on('report-scale', (_event, payload) => {
    if (!isPayloadObject(payload)) { return; }
    const { source, scalePct } = payload;
    if (!SCALE_REPORT_SOURCES.has(source)) { return; }
    if (!Number.isFinite(scalePct)) { return; }
    safelySendToWindow(controlWindow, 'scale-report', { source, scalePct });
});

// Тема интерфейса. Переключается только из панели, но применяется во ВСЕХ окнах,
// поэтому здесь именно рассылка, а не адресная отправка (в отличие от цветов,
// которые у каждого окна свои и разослать их всем нельзя).
// Отправителя не исключаем: применение темы ничего обратно не посылает, цикла
// быть не может, а повторное применение того же значения идемпотентно.
const UI_THEME_VALUES = new Set(['dark', 'light']);
ipcMain.on('ui-theme-update', (_event, payload) => {
    if (!isPayloadObject(payload)) { return; }
    const theme = payload.theme;
    if (typeof theme !== 'string' || !UI_THEME_VALUES.has(theme)) { return; }
    for (const win of [controlWindow, widgetWindow, displayWindow, clockWidgetWindow]) {
        safelySendToWindow(win, 'ui-theme-update', { theme });
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
