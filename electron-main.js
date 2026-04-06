const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { safelySendToWindow } = require('./utils');
const CONFIG = require('./constants');

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

// Per-window colors (independent themes)
let lastWidgetColors = null;
let lastClockColors = null;
let lastDisplayColors = null;
let lastWidgetStyle = null;

// Enable Ctrl+Wheel to resize window
function enableWindowResizeOnScroll(win) {
    if (!win || !win.webContents) {return;}

    const onBeforeInput = (event, input) => {
        if (win.isDestroyed()) {return;}
        // Prevent default zoom behavior
        if (input.control && (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')) {
            event.preventDefault();
        }
    };

    const onZoomChanged = (_event, zoomDirection) => {
        if (win.isDestroyed()) {return;}
        const [currentWidth, currentHeight] = win.getSize();
        const increment = CONFIG.SCALE_STEP || 20;

        if (zoomDirection === 'in') {
            win.setSize(currentWidth + increment, currentHeight + increment);
        } else {
            const [minWidth, minHeight] = win.getMinimumSize();
            const newWidth = Math.max(currentWidth - increment, minWidth);
            const newHeight = Math.max(currentHeight - increment, minHeight);
            win.setSize(newWidth, newHeight);
        }
    };

    win.webContents.on('before-input-event', onBeforeInput);
    win.webContents.on('zoom-changed', onZoomChanged);
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

function startTimer() {
    // Защита от повторного запуска: проверяем и state, и наличие интервала
    if (timerState.isRunning || timerInterval) {return;}

    // Убедиться что предыдущий интервал полностью очищен
    clearTimerInterval();

    emitTimerState({ isRunning: true, isPaused: false, finished: false });

    timerInterval = setInterval(() => {
        const prevRemaining = timerState.remainingSeconds;
        let nextRemaining = prevRemaining - 1;
        let shouldFinish = false;

        if (!timerConfig.allowNegative && nextRemaining <= 0) {
            nextRemaining = 0;
            shouldFinish = true;
        }
        // Перерасход без ограничений — таймер продолжает считать в минус
        // (лимит перерасхода убран по запросу пользователя)

        // Событие "таймер достиг нуля" (для звука финиша в режиме перерасхода)
        if (prevRemaining > 0 && nextRemaining <= 0 && timerConfig.allowNegative) {
            safelySendToWindow(controlWindow, 'timer-reached-zero');
            safelySendToWindow(widgetWindow, 'timer-reached-zero');
            safelySendToWindow(displayWindow, 'timer-reached-zero');
        }

        // Событие "осталась минута"
        if (prevRemaining > 60 && nextRemaining <= 60 && nextRemaining >= 0) {
            safelySendToWindow(controlWindow, 'timer-minute');
            safelySendToWindow(widgetWindow, 'timer-minute');
            safelySendToWindow(displayWindow, 'timer-minute');
        }

        // Событие "перерасход - напоминание"
        if (nextRemaining < 0 && timerConfig.allowNegative) {
            const intervalSec = (timerConfig.overrunIntervalMinutes || 1) * 60;
            const absNext = Math.abs(nextRemaining);
            const absPrev = Math.abs(prevRemaining);
            if (Math.floor(absNext / intervalSec) > Math.floor(absPrev / intervalSec)) {
                safelySendToWindow(controlWindow, 'timer-overrun-minute');
                safelySendToWindow(widgetWindow, 'timer-overrun-minute');
                safelySendToWindow(displayWindow, 'timer-overrun-minute');
            }
        }

        if (shouldFinish) {
            finishTimer(nextRemaining);
            return;
        }

        emitTimerState({
            remainingSeconds: nextRemaining,
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
    emitTimerState({ isRunning: false, isPaused: true, finished: false });
}

function handleTimerReset() {
    clearTimerInterval();
    const resetTo = timerState.presetSeconds || timerState.totalSeconds;
    emitTimerState({
        totalSeconds: resetTo,
        remainingSeconds: resetTo,
        isRunning: false,
        isPaused: false,
        finished: false
    });
}

function createControlWindow() {
    // Get screen dimensions for adaptive sizing
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Calculate optimal window size (adapt to screen size)
    const windowWidth = Math.min(700, Math.max(600, screenWidth - 100));
    const windowHeight = Math.min(760, Math.max(700, screenHeight - 100));

    controlWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: 600,
        minHeight: 700,
        maxWidth: 800,
        maxHeight: 920,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            devTools: true
        },
        title: 'Управление Таймером',
        icon: path.join(__dirname, 'icon.ico'),
        frame: false,
        resizable: true // Allow user to resize if needed
    });

    controlWindow.loadFile('electron-control.html');
    hardenWindow(controlWindow);

    // Enable Ctrl+Wheel window resizing
    controlWindow.webContents.once('did-finish-load', () => {
        enableWindowResizeOnScroll(controlWindow);
    });

    controlWindow.on('closed', () => {
        controlWindow = null;
    });
}

function createWidgetWindow() {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    
    widgetWindow = new BrowserWindow({
        width: 250,
        height: 280,
        // Allow smaller and larger dynamic scaling; we will resize via IPC rather than CSS transforms
        minWidth: 120,
        minHeight: 140,
        // Remove explicit max constraints so user scaling isn't capped artificially
        x: width - 270,
        y: 20,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
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

    widgetWindow.loadFile('electron-widget.html');
    hardenWindow(widgetWindow);

    // Enable Ctrl+Wheel window resizing
    widgetWindow.webContents.once('did-finish-load', () => {
        enableWindowResizeOnScroll(widgetWindow);
    });

    widgetWindow.on('closed', () => {
        widgetWindow = null;
        // Уведомляем окно управления что виджет закрыт
        safelySendToWindow(controlWindow, 'widget-window-state', { isOpen: false });
    });
}

function createClockWidgetWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    clockWidgetWindow = new BrowserWindow({
        width: 220,
        height: 220,
        minWidth: 120,
        minHeight: 120,
        x: width - 240,
        y: height - 260,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
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

    clockWidgetWindow.loadFile('electron-clock-widget.html');
    hardenWindow(clockWidgetWindow);

    // Enable Ctrl+Wheel window resizing
    clockWidgetWindow.webContents.once('did-finish-load', () => {
        enableWindowResizeOnScroll(clockWidgetWindow);
    });

    clockWidgetWindow.on('closed', () => {
        clockWidgetWindow = null;
        // Уведомляем окно управления что виджет часов закрыт
        safelySendToWindow(controlWindow, 'clock-window-state', { isOpen: false });
    });
}

function createDisplayWindow(displayIndex) {
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
        width: displayBounds.width,
        height: displayBounds.height,
        x: displayBounds.x,
        y: displayBounds.y,
        fullscreen: true,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            devTools: false
        }
    });

    displayWindow.loadFile('display.html');
    hardenWindow(displayWindow);

    const thisWindow = displayWindow;
    displayWindow.on('closed', () => {
        // Защита от race condition: не обнуляем если уже создано новое окно
        if (displayWindow === thisWindow) {
            displayWindow = null;
        }
        safelySendToWindow(controlWindow, 'display-window-state', { isOpen: false });
    });
}

app.whenReady().then(() => {
    createControlWindow();

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
            const next = Math.max(0, Number(seconds) || 0);
            emitTimerState({
                totalSeconds: next,
                remainingSeconds: next,
                presetSeconds: next,  // Сохраняем оригинальное время пресета
                isRunning: false,
                isPaused: false,
                finished: false
            });
            emittedByCommand = true;
            break;
        }
        case 'adjust': {
            const delta = Number(deltaSeconds) || 0;
            const nextRemaining = timerConfig.allowNegative ? timerState.remainingSeconds + delta : Math.max(0, timerState.remainingSeconds + delta);
            const nextTotal = Math.max(timerState.totalSeconds, nextRemaining);
            emitTimerState({
                totalSeconds: nextTotal,
                remainingSeconds: nextRemaining,
                finished: false
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
ipcMain.on('resize-control-window', (event, size) => {
    if (controlWindow && size && typeof size === 'object') {
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const w = Number.isFinite(size.width) ? size.width : 700;
        const h = Number.isFinite(size.height) ? size.height : 760;
        const targetWidth = Math.max(600, Math.min(w, screenWidth - 50));
        const targetHeight = Math.max(700, Math.min(h, screenHeight - 50));
        
        // Получаем текущую позицию окна
        const [x, y] = controlWindow.getPosition();
        
        // Устанавливаем размер
        controlWindow.setSize(targetWidth, targetHeight);
        
        // Проверяем, не выходит ли окно за экран
        if (y + targetHeight > screenHeight) {
            controlWindow.setPosition(x, Math.max(0, screenHeight - targetHeight - 20));
        }
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
            safelySendToWindow(controlWindow, 'widget-window-state', { isOpen: true });
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

ipcMain.on('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) { win.close(); }
});

ipcMain.on('quit-app', () => {
    clearTimerInterval();
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
            safelySendToWindow(controlWindow, 'clock-window-state', { isOpen: true });
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

ipcMain.on('clock-widget-resize', (event, { width, height }) => {
    if (clockWidgetWindow) {
        const w = Math.max(120, Math.min(800, Number(width) || 220));
        const h = Math.max(120, Math.min(800, Number(height) || 220));
        clockWidgetWindow.setSize(w, h, true);
    }
});

// Масштабирование окна часов через Ctrl+колесико
ipcMain.on('clock-widget-scale', (event, delta) => {
    if (clockWidgetWindow && Number.isFinite(delta)) {
        const [currentWidth] = clockWidgetWindow.getSize();
        const newSize = Math.max(150, Math.min(600, currentWidth + delta));
        clockWidgetWindow.setSize(newSize, newSize, true);
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
    // Если дисплей уже открыт и запрос на тот же монитор - просто фокус
    if (displayWindow && options.displayIndex === displayWindow._displayIndex) {
        displayWindow.focus();
        return;
    }

    // Закрываем старое окно если оно открыто (переключение монитора)
    if (displayWindow) {
        displayWindow.close();
        displayWindow = null;
    }

    createDisplayWindow(options.displayIndex);
    if (displayWindow) {
        // Сохраняем индекс монитора для проверки
        displayWindow._displayIndex = options.displayIndex;

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
        safelySendToWindow(controlWindow, 'display-window-state', { isOpen: true });
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

ipcMain.on('widget-resize', (event, { width, height }) => {
    if (widgetWindow) {
        const w = Math.max(120, Math.min(1920, Number(width) || 220));
        const h = Math.max(120, Math.min(1080, Number(height) || 220));
        widgetWindow.setSize(w, h, true);
    }
});

// Масштабирование окна таймера через Ctrl+колесико
ipcMain.on('widget-scale', (event, delta) => {
    if (widgetWindow && Number.isFinite(delta)) {
        const [currentWidth] = widgetWindow.getSize();
        const newSize = Math.max(150, Math.min(600, currentWidth + delta));
        widgetWindow.setSize(newSize, newSize, true);
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
