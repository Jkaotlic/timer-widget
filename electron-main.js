const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

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
    isRunning: false,
    isPaused: false,
    finished: false,
    timestamp: Date.now(),
    updateCounter: 0  // Монотонный счетчик для надежной синхронизации
};
let timerConfig = {
    allowNegative: false,
    overrunLimitSeconds: 0
};
let timerInterval = null;

// Сохраняем последние настройки дисплея для синхронизации
let lastDisplaySettings = null;

// Enable Ctrl+Wheel to resize window
function enableWindowResizeOnScroll(window) {
    if (!window || !window.webContents) return;

    window.webContents.on('before-input-event', (event, input) => {
        // Prevent default zoom behavior
        if (input.control && (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')) {
            event.preventDefault();
        }
    });

    // Handle mouse wheel with Ctrl for window resizing
    window.webContents.on('zoom-changed', (event, zoomDirection) => {
        const [currentWidth, currentHeight] = window.getSize();
        const increment = 20; // Pixels to grow/shrink

        if (zoomDirection === 'in') {
            // Increase window size
            window.setSize(currentWidth + increment, currentHeight + increment);
        } else {
            // Decrease window size (respect minimum)
            const [minWidth, minHeight] = window.getMinimumSize();
            const newWidth = Math.max(currentWidth - increment, minWidth);
            const newHeight = Math.max(currentHeight - increment, minHeight);
            window.setSize(newWidth, newHeight);
        }
    });
}

function clearTimerInterval() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// FIX BUG-013: Безопасная отправка IPC сообщений
function safelySendToWindow(window, channel, ...args) {
    if (!window || window.isDestroyed()) {
        return false;
    }

    try {
        // Проверить что webContents существует и не уничтожен
        if (window.webContents && !window.webContents.isDestroyed()) {
            window.webContents.send(channel, ...args);
            return true;
        }
    } catch (error) {
        console.error(`Failed to send IPC message to ${channel}:`, error.message);
    }

    return false;
}

function emitTimerState(partial = {}) {
    // FIX BUG-012: Увеличиваем монотонный счетчик при каждом обновлении
    timerUpdateCounter++;

    timerState = {
        ...timerState,
        ...partial,
        timestamp: Date.now(),
        updateCounter: timerUpdateCounter  // Монотонный счетчик
    };

    // FIX BUG-013: Безопасная отправка IPC сообщений
    safelySendToWindow(widgetWindow, 'timer-state', timerState);
    safelySendToWindow(displayWindow, 'timer-state', timerState);
    safelySendToWindow(controlWindow, 'timer-state', timerState);
}

function finishTimer() {
    clearTimerInterval();
    const remaining = timerConfig.allowNegative ? timerState.remainingSeconds : Math.max(0, timerState.remainingSeconds);
    emitTimerState({
        isRunning: false,
        isPaused: false,
        finished: true,
        remainingSeconds: remaining
    });
}

let timerLock = false;

function startTimer() {
    // Атомарная проверка с lock для предотвращения race condition
    if (timerLock || timerState.isRunning) return;
    timerLock = true;

    try {
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
            // ИСПРАВЛЕНО: изменено <= на < для корректной работы overtime limit
            if (timerConfig.allowNegative && timerConfig.overrunLimitSeconds > 0 && nextRemaining < -timerConfig.overrunLimitSeconds) {
                shouldFinish = true;
            }

            // Событие "осталась минута"
            if (prevRemaining > 60 && nextRemaining <= 60 && nextRemaining >= 0) {
                safelySendToWindow(controlWindow, 'timer-minute');
                safelySendToWindow(widgetWindow, 'timer-minute');
                safelySendToWindow(displayWindow, 'timer-minute');
            }

            if (shouldFinish) {
                emitTimerState({ remainingSeconds: nextRemaining });
                finishTimer();
                return;
            }

            emitTimerState({
                remainingSeconds: nextRemaining,
                finished: false
            });
        }, 1000);
    } finally {
        timerLock = false;
    }
}

function createControlWindow() {
    // Get screen dimensions for adaptive sizing
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Calculate optimal window size (adapt to screen size)
    const windowWidth = Math.min(420, Math.max(340, screenWidth - 100));
    const windowHeight = Math.min(700, Math.max(550, screenHeight - 100));

    controlWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: 340,  // Increased for better layout
        minHeight: 550, // Increased to fit all content
        maxWidth: 500,  // Prevent too wide on large screens
        maxHeight: 900, // Increased for larger screens
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true
        },
        title: 'Управление Таймером',
        icon: path.join(__dirname, 'icon.ico'),
        resizable: true // Allow user to resize if needed
    });

    controlWindow.loadFile('electron-control.html');

    // Enable Ctrl+Wheel window resizing
    controlWindow.webContents.once('did-finish-load', () => {
        enableWindowResizeOnScroll(controlWindow);
    });

    controlWindow.on('closed', () => {
        controlWindow = null;
    });
}

function createWidgetWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
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
            sandbox: true
        },
        hasShadow: false
    });

    widgetWindow.loadFile('electron-widget.html');

    // Enable Ctrl+Wheel window resizing
    widgetWindow.webContents.once('did-finish-load', () => {
        enableWindowResizeOnScroll(widgetWindow);
    });

    widgetWindow.on('closed', () => {
        widgetWindow = null;
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
            sandbox: true
        },
        hasShadow: false
    });

    clockWidgetWindow.loadFile('electron-clock-widget.html');

    // Enable Ctrl+Wheel window resizing
    clockWidgetWindow.webContents.once('did-finish-load', () => {
        enableWindowResizeOnScroll(clockWidgetWindow);
    });

    clockWidgetWindow.on('closed', () => {
        clockWidgetWindow = null;
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
        // Выбранный монитор по индексу
        const idx = parseInt(displayIndex);
        targetDisplay = displays[idx] || screen.getPrimaryDisplay();
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
            sandbox: true
        }
    });

    displayWindow.loadFile('display.html');

    // Enable Ctrl+Wheel window resizing
    displayWindow.webContents.once('did-finish-load', () => {
        enableWindowResizeOnScroll(displayWindow);
    });

    displayWindow.on('closed', () => {
        displayWindow = null;
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
    const { type, seconds, deltaSeconds, allowNegative, overrunLimitSeconds } = payload;

    // FIX BUG-017: Track if config changed to sync immediately
    let configChanged = false;

    if (typeof allowNegative === 'boolean') {
        if (timerConfig.allowNegative !== allowNegative) {
            timerConfig.allowNegative = allowNegative;
            configChanged = true;
        }
    }
    if (overrunLimitSeconds != null) {
        const newLimit = Math.max(0, Number(overrunLimitSeconds) || 0);
        if (timerConfig.overrunLimitSeconds !== newLimit) {
            timerConfig.overrunLimitSeconds = newLimit;
            configChanged = true;
        }
    }

    switch (type) {
        case 'set': {
            if (timerState.isRunning) break;
            const next = Math.max(0, Number(seconds) || 0);
            emitTimerState({
                totalSeconds: next,
                remainingSeconds: next,
                isRunning: false,
                isPaused: false,
                finished: false
            });
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
            break;
        }
        case 'start': {
            if (timerState.remainingSeconds <= 0 && !timerConfig.allowNegative) {
                finishTimer();
                break;
            }
            startTimer();
            break;
        }
        case 'pause': {
            clearTimerInterval();
            emitTimerState({ isRunning: false, isPaused: true, finished: false });
            break;
        }
        case 'reset': {
            clearTimerInterval();
            emitTimerState({
                remainingSeconds: timerState.totalSeconds,
                isRunning: false,
                isPaused: false,
                finished: false
            });
            break;
        }
        default:
            break;
    }

    // FIX BUG-017: If config changed, broadcast state immediately
    if (configChanged) {
        emitTimerState({});
    }
});

ipcMain.on('get-timer-state', (event) => {
    event.reply('timer-state', timerState);
});

// Изменение размера окна управления
ipcMain.on('resize-control-window', (event, size) => {
    if (controlWindow) {
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const targetWidth = Math.min(size.width || 420, screenWidth - 50);
        const targetHeight = Math.min(size.height || 400, screenHeight - 50);
        
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

// Рассылка настроек отображения fullscreen и widget (clockStyle/background)
ipcMain.on('display-settings-update', (event, settings) => {
    // Сохраняем настройки для синхронизации при открытии новых окон
    lastDisplaySettings = settings;

    safelySendToWindow(displayWindow, 'display-settings-update', settings);
    safelySendToWindow(widgetWindow, 'display-settings-update', settings);
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
            });
        }
    } else {
        widgetWindow.focus();
    }
});

ipcMain.on('close-widget', () => {
    if (widgetWindow) {
        widgetWindow.close();
    }
});

// Виджет часов
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
    }
});

ipcMain.on('clock-widget-resize', (event, { width, height }) => {
    if (clockWidgetWindow) {
        clockWidgetWindow.setSize(width, height, true);
    }
});

// Масштабирование окна часов через Ctrl+колесико
ipcMain.on('clock-widget-scale', (event, delta) => {
    if (clockWidgetWindow) {
        const [currentWidth, currentHeight] = clockWidgetWindow.getSize();
        const newWidth = Math.max(100, Math.min(800, currentWidth + delta));
        const newHeight = Math.max(100, Math.min(800, currentHeight + delta));
        clockWidgetWindow.setSize(newWidth, newHeight, true);
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
    if (!displayWindow) {
        createDisplayWindow(options.displayIndex);
        if (displayWindow) {
            displayWindow.webContents.on('did-finish-load', () => {
                safelySendToWindow(displayWindow, 'timer-state', timerState);
                // Отправляем сохранённые настройки дисплея (включая стиль)
                if (lastDisplaySettings) {
                    safelySendToWindow(displayWindow, 'display-settings-update', lastDisplaySettings);
                }
            });
        }
    } else {
        displayWindow.focus();
    }
});

ipcMain.on('close-display', () => {
    if (displayWindow) {
        displayWindow.close();
    }
});

// Управление виджетом
ipcMain.on('widget-set-opacity', (event, opacity) => {
    if (widgetWindow) {
        widgetWindow.setOpacity(opacity);
    }
});

ipcMain.on('widget-set-position', (event, { x, y }) => {
    if (widgetWindow) {
        widgetWindow.setPosition(x, y);
    }
});

ipcMain.on('widget-resize', (event, { width, height }) => {
    if (widgetWindow) {
        widgetWindow.setSize(width, height, true);
    }
});

// Масштабирование окна таймера через Ctrl+колесико
ipcMain.on('widget-scale', (event, delta) => {
    if (widgetWindow) {
        const [currentWidth, currentHeight] = widgetWindow.getSize();
        const newWidth = Math.max(100, Math.min(800, currentWidth + delta));
        const newHeight = Math.max(100, Math.min(800, currentHeight + delta));
        widgetWindow.setSize(newWidth, newHeight, true);
    }
});

// Provide current widget size to renderer for relative scaling logic
ipcMain.handle('widget-get-size', () => {
    if (widgetWindow) {
        return widgetWindow.getSize();
    }
    return [0, 0];
});

ipcMain.on('widget-move', (event, { deltaX, deltaY }) => {
    if (widgetWindow) {
        const [currentX, currentY] = widgetWindow.getPosition();
        widgetWindow.setPosition(currentX + deltaX, currentY + deltaY, true);
    }
});

// Управление таймером через виджет
ipcMain.on('timer-control', (event, action) => {
    switch (action) {
        case 'start':
            if (timerState.remainingSeconds <= 0 && !timerConfig.allowNegative) {
                finishTimer();
                break;
            }
            startTimer();
            break;
        case 'pause':
            clearTimerInterval();
            emitTimerState({ isRunning: false, isPaused: true, finished: false });
            break;
        case 'reset':
            clearTimerInterval();
            emitTimerState({
                remainingSeconds: timerState.totalSeconds,
                isRunning: false,
                isPaused: false,
                finished: false
            });
            break;
    }
});
