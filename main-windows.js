'use strict';

/**
 * main-windows.js — создание четырёх окон приложения.
 *
 * У события «окно открылось» ОДИН владелец — create-функция (docs/lessons.md,
 * «Opening a window has ONE owner»): она строит окно, ставит запреты, привязки
 * и досылку состояния. Обработчики `open-*` (main-window-ipc.js), трей
 * (main-tray.js) и стенд съёмки зовут эти функции — и получают одно и то же.
 *
 * Ссылки на окна пишутся в реестр (main-state.js) и читаются из него же — в
 * том числе внутри колбэков, как читались прежние глобалы: колбэк видит окно,
 * которое записано в реестре В МОМЕНТ события.
 *
 * Модуль не требует electron: BrowserWindow и screen передаёт точка входа.
 */

const path = require('path');
const { withoutBgImage } = require('./relay-payload');
// Роль окна — аргумент его рендерера: по ней preload.js открывает только
// каналы этого окна (таблица — ipc-senders.js). Без аргумента мост закрыт.
const { windowArgument } = require('./ipc-senders');
// Окна грузятся со своей схемы app://timer-widget/ (SEC-12), а не с file://:
// адрес страницы строит app-scheme.js — та же формула, по которой
// navigation-guard.js и проверка отправителя узнают свою страницу.
const { pageUrl } = require('./app-scheme');

// Уровень окна для виджета и часов — ВЫШЕ полоски меню macOS.
//
// Обычный alwaysOnTop даёт `floating` (уровень 3), полоска меню — 24, поэтому
// окно, поставленное к верхнему краю экрана, уходило ПОД неё: замерено съёмкой
// экрана — на `floating` верхние 30 px окна закрыты меню, на `status` (25) окно
// видно целиком. Выше не берём намеренно: `pop-up-menu` (101) перекрыл бы
// раскрытые меню и системные подсказки.
//
// На Windows и Linux значение игнорируется — там окно и так не поджимается к
// рабочей области.
const WINDOW_LEVEL_ABOVE_MENU_BAR = 'status';

/**
 * @param {object} deps
 * @param {Function} deps.BrowserWindow
 * @param {object} deps.screen
 * @param {object} deps.app
 * @param {object} deps.log
 * @param {object} deps.CONFIG
 * @param {Function} deps.safelySendToWindow
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.relay — память ретрансляторов (main-state.js)
 * @param {object} deps.hooks — main-window-hooks.js
 * @param {object} deps.geometry — main-geometry.js
 * @param {boolean} deps.screenshotMode — `--screenshot`: окна скрыты и за экраном
 * @param {() => object} deps.getTimerState — зеркало состояния таймера
 * @param {() => object} deps.eventOverrunPayload — сборка payload накопителя
 * @param {(win: object) => void} deps.bindTrayBehavior — «закрытие панели = в трей»
 */
function createWindows(deps) {
    const {
        BrowserWindow, screen, app, log, CONFIG, safelySendToWindow,
        windows, relay, hooks, geometry, getTimerState, eventOverrunPayload, bindTrayBehavior
    } = deps;
    const __screenshotMode = deps.screenshotMode;
    const {
        blockZoom, hardenWindow, bindRenderCrashHandler, bindRenderConsole,
        bindWindowStateSnapshot, announceWindowOpened, broadcastWindowState
    } = hooks;
    const { bindGeometryReports } = geometry;

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

    function createControlWindow() {
        const __ctrlT0 = Date.now();
        // Get screen dimensions for adaptive sizing
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

        // Default size of the control panel WITHOUT drawer (drawer adds ~320px when opened).
        // Settings live in the drawer, so the panel itself can be narrow and short.
        const windowWidth = Math.min(CONFIG.CONTROL_WINDOW_WIDTH, Math.max(CONFIG.CONTROL_WINDOW_MIN_WIDTH, screenWidth - 100));
        const windowHeight = Math.min(CONFIG.CONTROL_WINDOW_HEIGHT, Math.max(CONFIG.CONTROL_WINDOW_MIN_HEIGHT, screenHeight - 100));

        windows.controlWindow = new BrowserWindow({
            width: windowWidth,
            height: windowHeight,
            minWidth: CONFIG.CONTROL_WINDOW_MIN_WIDTH,
            minHeight: CONFIG.CONTROL_WINDOW_MIN_HEIGHT,
            // Потолок один и тот же для главного процесса и для панели: панель
            // вычитает из него ширину ящика, когда считает свою колонку.
            // Стартовый уровень потолка — «без ящика». Открытие ящика поднимает его
            // каналом control-drawer, закрытие возвращает обратно.
            maxWidth: CONFIG.CONTROL_WINDOW_MAX_WIDTH,
            maxHeight: CONFIG.CONTROL_WINDOW_MAX_HEIGHT,
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
                additionalArguments: [windowArgument('control')],
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

        windows.controlWindow.loadURL(pageUrl('electron-control.html')).catch(err => log.error('loadURL failed:', err));
        hardenWindow(windows.controlWindow);
        bindRenderCrashHandler(windows.controlWindow, 'control');
        bindRenderConsole(windows.controlWindow, 'control');
        bindWindowStateSnapshot(windows.controlWindow);

        // Накопитель мероприятия — состояние, а не событие: панель, открытая
        // посреди мероприятия, обязана узнать, идёт оно или уже заморожено. Иначе
        // строка отчёта врёт до первого изменения, а изменения может не быть до
        // самого конца. Слушатель `on`, а не `once`, по той же причине, что у
        // снимка состояния окон: перезагруженный краш-обработчиком рендерер обязан
        // получить данные заново.
        windows.controlWindow.webContents.on('did-finish-load', () => {
            safelySendToWindow(windows.controlWindow, 'event-overrun-state', eventOverrunPayload());
        });

        // Привязка живёт здесь, а не в whenReady: панель пересоздаётся из трея, из
        // second-instance и по 'activate'. Вызванная один раз при старте, привязка
        // доставалась только самому первому экземпляру окна, и пересозданная панель
        // теряла поведение «закрытие = скрытие в трей» — она просто закрывалась.
        bindTrayBehavior(windows.controlWindow);

        // Enable Ctrl+Wheel window resizing
        windows.controlWindow.webContents.once('did-finish-load', () => {
            blockZoom(windows.controlWindow);
            if (process.argv.includes('--dev') && !app.isPackaged) {
                windows.controlWindow.webContents.openDevTools({ mode: 'detach' });
            }
        });

        windows.controlWindow.once('ready-to-show', () => {
            log.info(`[perf] control window ready in ${Date.now() - __ctrlT0}ms`);
        });

        windows.controlWindow.on('closed', () => {
            windows.controlWindow = null;
        });
    }

    function createWidgetWindow() {
        const __widgetT0 = Date.now();
        const { width } = screen.getPrimaryDisplay().workAreaSize;

        windows.widgetWindow = new BrowserWindow({
            width: CONFIG.WIDGET_DEFAULT_WIDTH,
            height: CONFIG.WIDGET_DEFAULT_HEIGHT,
            // Allow smaller and larger dynamic scaling; we will resize via IPC rather than CSS transforms
            minWidth: CONFIG.WIDGET_MIN_WIDTH,
            minHeight: CONFIG.WIDGET_MIN_HEIGHT,
            // Remove explicit max constraints so user scaling isn't capped artificially
            x: __screenshotMode ? -2500 : width - 270,
            y: __screenshotMode ? -2500 : 20,
            frame: false,
            transparent: !__screenshotMode,
            backgroundColor: __screenshotMode ? '#1c1c1e' : undefined,
            alwaysOnTop: !__screenshotMode,
            skipTaskbar: true,
            resizable: true,
            // Без этой опции macOS поджимает окно к рабочей области: `y` упирался в
            // 30 (край полоски меню) при любом уровне окна и через setPosition, и
            // через setBounds. Поджимает не система, а
            // `-[NSWindow constrainFrameRect:toScreen:]`, который Electron этой
            // опцией отключает — с ней замерено y = 0 и даже y = -60.
            enableLargerThanScreen: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                additionalArguments: [windowArgument('widget')],
                sandbox: true,
                devTools: process.argv.includes('--dev') && !app.isPackaged
            },
            hasShadow: false
        });
        // Уровень задаётся ПОСЛЕ конструктора: в опциях окна его задать нельзя.
        // В режиме съёмки окна намеренно не всплывают, поэтому и уровень не трогаем.
        if (!__screenshotMode) {
            windows.widgetWindow.setAlwaysOnTop(true, WINDOW_LEVEL_ABOVE_MENU_BAR);
        }
        windows.widgetWindow.loadURL(pageUrl('electron-widget.html')).catch(err => log.error('loadURL failed:', err));
        hardenWindow(windows.widgetWindow);
        bindRenderCrashHandler(windows.widgetWindow, 'widget');
        bindRenderConsole(windows.widgetWindow, 'widget');
        bindWindowStateSnapshot(windows.widgetWindow);
        announceWindowOpened(windows.widgetWindow, 'widget-window-state', (win) => {
            safelySendToWindow(win, 'timer-state', getTimerState());
            // Сохранённые настройки дисплея (виджет берёт оттуда фон) — без
            // картинки: её рисует только дисплей (BUG-10).
            if (relay.lastDisplaySettings) {
                safelySendToWindow(win, 'display-settings-update', withoutBgImage(relay.lastDisplaySettings));
            }
            // Цвета и стиль — только свои, адресными каналами
            if (relay.lastWidgetColors) {
                safelySendToWindow(win, 'widget-colors-update', relay.lastWidgetColors);
            }
            if (relay.lastWidgetStyle) {
                applyWidgetMinimumSize();
                safelySendToWindow(win, 'widget-style-update', relay.lastWidgetStyle);
            }
        });

        windows.widgetWindow.webContents.once('did-finish-load', () => {
            blockZoom(windows.widgetWindow);
        });

        windows.widgetWindow.once('ready-to-show', () => {
            log.info(`[perf] widget window ready in ${Date.now() - __widgetT0}ms`);
        });

        bindGeometryReports(windows.widgetWindow);

        windows.widgetWindow.on('closed', () => {
            windows.widgetWindow = null;
            // Уведомляем окно управления что виджет закрыт
            broadcastWindowState('widget-window-state', { isOpen: false });
        });
    }

    function createClockWidgetWindow() {
        const __clockT0 = Date.now();
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        windows.clockWidgetWindow = new BrowserWindow({
            width: CONFIG.CLOCK_WIDGET_DEFAULT_SIZE,
            height: CONFIG.CLOCK_WIDGET_DEFAULT_SIZE,
            minWidth: CONFIG.CLOCK_WIDGET_MIN_SIZE,
            minHeight: CONFIG.CLOCK_WIDGET_MIN_SIZE,
            x: __screenshotMode ? -2800 : width - 240,
            y: __screenshotMode ? -2500 : height - 260,
            frame: false,
            transparent: !__screenshotMode,
            backgroundColor: __screenshotMode ? '#1c1c1e' : undefined,
            alwaysOnTop: !__screenshotMode,
            skipTaskbar: true,
            resizable: true,
            // См. комментарий у виджета: без этого окно не поднимается выше
            // рабочей области.
            enableLargerThanScreen: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                additionalArguments: [windowArgument('clock')],
                sandbox: true,
                devTools: process.argv.includes('--dev') && !app.isPackaged
            },
            hasShadow: false
        });
        if (!__screenshotMode) {
            windows.clockWidgetWindow.setAlwaysOnTop(true, WINDOW_LEVEL_ABOVE_MENU_BAR);
        }
        windows.clockWidgetWindow.loadURL(pageUrl('electron-clock-widget.html')).catch(err => log.error('loadURL failed:', err));
        hardenWindow(windows.clockWidgetWindow);
        bindRenderCrashHandler(windows.clockWidgetWindow, 'clock');
        bindRenderConsole(windows.clockWidgetWindow, 'clock');
        bindWindowStateSnapshot(windows.clockWidgetWindow);
        announceWindowOpened(windows.clockWidgetWindow, 'clock-window-state', (win) => {
            // Снимок при загрузке, как у виджета и дисплея: часы, открытые при
            // идущем таймере, иначе считали бы его стоящим до первого тика — а
            // на паузе тика нет вовсе (BUG-01).
            safelySendToWindow(win, 'timer-state', getTimerState());
            // Настройки дисплея несут стиль часов (clockStyle) и цифры циферблата;
            // картинку фона часы не рисуют (BUG-10).
            if (relay.lastDisplaySettings) {
                safelySendToWindow(win, 'display-settings-update', withoutBgImage(relay.lastDisplaySettings));
            }
            // Свои настройки окна часов — тумблеры даты, пояса, секунд и формата.
            if (relay.lastClockSettings) {
                safelySendToWindow(win, 'clock-settings', relay.lastClockSettings);
            }
            if (relay.lastClockColors) {
                safelySendToWindow(win, 'clock-colors-update', relay.lastClockColors);
            }
        });

        windows.clockWidgetWindow.webContents.once('did-finish-load', () => {
            blockZoom(windows.clockWidgetWindow);
        });

        windows.clockWidgetWindow.once('ready-to-show', () => {
            log.info(`[perf] clock window ready in ${Date.now() - __clockT0}ms`);
        });

        bindGeometryReports(windows.clockWidgetWindow);

        windows.clockWidgetWindow.on('closed', () => {
            windows.clockWidgetWindow = null;
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

        windows.displayWindow = new BrowserWindow({
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
                additionalArguments: [windowArgument('display')],
                sandbox: true,
                devTools: process.argv.includes('--dev') && !app.isPackaged
            }
        });

        windows.displayWindow.loadURL(pageUrl('display.html')).catch(err => log.error('loadURL failed:', err));
        hardenWindow(windows.displayWindow);
        bindRenderCrashHandler(windows.displayWindow, 'display');
        bindRenderConsole(windows.displayWindow, 'display');
        bindWindowStateSnapshot(windows.displayWindow);
        blockZoom(windows.displayWindow);

        // Монитор запоминается здесь же: обработчик `open-display` сверяет его,
        // чтобы отличить «тот же экран — просто сфокусировать» от «другой экран —
        // пересоздать окно».
        windows.displayWindow._displayIndex = displayIndex;
        announceWindowOpened(windows.displayWindow, 'display-window-state', (win) => {
            safelySendToWindow(win, 'timer-state', getTimerState());
            // Накопитель мероприятия — состояние, а не событие: окно,
            // открытое посреди мероприятия, обязано узнать уже накопленное.
            // Рассылки на изменение для этого мало — изменения может не быть
            // до самого конца.
            safelySendToWindow(win, 'event-overrun-state', eventOverrunPayload());
            if (relay.lastDisplaySettings) {
                safelySendToWindow(win, 'display-settings-update', relay.lastDisplaySettings);
            }
            if (relay.lastDisplayColors) {
                safelySendToWindow(win, 'display-colors-update', relay.lastDisplayColors);
            }
        });

        windows.displayWindow.once('ready-to-show', () => {
            log.info(`[perf] display window ready in ${Date.now() - __displayT0}ms`);
        });

        const thisWindow = windows.displayWindow;
        windows.displayWindow.on('closed', () => {
            // Защита от race condition при переключении монитора: если новое окно
            // дисплея уже заменило это, НЕ обнуляем ref и НЕ шлём isOpen:false —
            // иначе stale-broadcast перетрёт актуальный isOpen:true нового окна и
            // рассинхронит тоггл/кнопку D в панели управления.
            if (windows.displayWindow === thisWindow) {
                windows.displayWindow = null;
                broadcastWindowState('display-window-state', { isOpen: false });
            }
        });
    }

    /**
     * «Поверх всех окон» — тумблер редизайна 2026-08-12.
     *
     * Едет каналом `widget-style-update`, а не своим: payload стиля уже проходит
     * через главный процесс, и заводить второй канал ради одного булева значило
     * бы расширить список разрешений без новой возможности. Канал в этом
     * проекте — разрешение, а не функция.
     *
     * Уровень при включении — WINDOW_LEVEL_ABOVE_MENU_BAR, тот же, что при
     * создании окна: обычный `floating` (3) ниже полоски меню (24), и окно у
     * верхнего края экрана уходило бы под неё. Это условие проверяет
     * tests/window-top-edge.test.js, и оно обязано пережить выключение-включение
     * тумблера, а не только запуск.
     */
    function applyWidgetAlwaysOnTop(on) {
        if (!windows.widgetWindow || windows.widgetWindow.isDestroyed()) { return; }
        // undefined — это «панель ничего не сказала» (например старый payload).
        // Молчание не должно опускать окно: трогаем уровень только по явному значению.
        if (typeof on !== 'boolean') { return; }
        // В режиме съёмки окна намеренно не всплывают.
        if (__screenshotMode) { return; }
        windows.widgetWindow.setAlwaysOnTop(on, on ? WINDOW_LEVEL_ABOVE_MENU_BAR : undefined);
    }

    // Пол размера окна виджета. Раньше он зависел от стиля: у LED окно
    // превращалось в полосу, и общий пол в 140 px делал её недостижимой. Стиля LED
    // больше нет (он слит с «Цифрами», где рамка обнимает цифры сама), поэтому пол
    // снова один на все стили.
    function applyWidgetMinimumSize() {
        if (!windows.widgetWindow || windows.widgetWindow.isDestroyed()) { return; }
        windows.widgetWindow.setMinimumSize(CONFIG.WIDGET_MIN_WIDTH, CONFIG.WIDGET_MIN_HEIGHT);
    }

    return {
        getAppIconPath,
        createControlWindow, createWidgetWindow, createClockWidgetWindow, createDisplayWindow,
        applyWidgetAlwaysOnTop, applyWidgetMinimumSize
    };
}

module.exports = { createWindows, WINDOW_LEVEL_ABOVE_MENU_BAR };
