const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let controlWindow = null;
let widgetWindow = null;
let displayWindow = null;
let clockWidgetWindow = null;

// Состояние таймера
let timerState = {
    totalSeconds: 0,
    remainingSeconds: 0,
    isRunning: false,
    isPaused: false,
    finished: false,
    timestamp: Date.now()
};
let timerConfig = {
    allowNegative: false,
    overrunLimitSeconds: 0
};
let timerInterval = null;

// Сохраняем последние настройки дисплея для синхронизации
let lastDisplaySettings = null;

function clearTimerInterval() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function emitTimerState(partial = {}) {
    timerState = {
        ...timerState,
        ...partial,
        timestamp: Date.now()
    };
    if (widgetWindow) {
        widgetWindow.webContents.send('timer-state', timerState);
    }
    if (displayWindow) {
        displayWindow.webContents.send('timer-state', timerState);
    }
    if (controlWindow) {
        controlWindow.webContents.send('timer-state', timerState);
    }
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

function startTimer() {
    if (timerState.isRunning) return;
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
        if (timerConfig.allowNegative && timerConfig.overrunLimitSeconds > 0 && nextRemaining <= -timerConfig.overrunLimitSeconds) {
            shouldFinish = true;
        }

        // Событие "осталась минута"
        if (prevRemaining > 60 && nextRemaining <= 60 && nextRemaining >= 0) {
            if (controlWindow) controlWindow.webContents.send('timer-minute');
            if (widgetWindow) widgetWindow.webContents.send('timer-minute');
            if (displayWindow) displayWindow.webContents.send('timer-minute');
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
}

function createControlWindow() {
    controlWindow = new BrowserWindow({
        width: 420,
        height: 500,
        minWidth: 350,
        minHeight: 300,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        title: 'Управление Таймером',
        icon: path.join(__dirname, 'icon.ico')
    });

    controlWindow.loadFile('electron-control.html');

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
            nodeIntegration: true,
            contextIsolation: false
        },
        hasShadow: false
    });

    widgetWindow.loadFile('electron-widget.html');

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
            nodeIntegration: true,
            contextIsolation: false
        },
        hasShadow: false
    });

    clockWidgetWindow.loadFile('electron-clock-widget.html');

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
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    displayWindow.loadFile('display.html');

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

    if (typeof allowNegative === 'boolean') {
        timerConfig.allowNegative = allowNegative;
    }
    if (overrunLimitSeconds != null) {
        timerConfig.overrunLimitSeconds = Math.max(0, Number(overrunLimitSeconds) || 0);
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
    if (widgetWindow) {
        widgetWindow.webContents.send('colors-update', colors);
    }
    if (displayWindow) {
        displayWindow.webContents.send('colors-update', colors);
    }
    if (controlWindow && event.sender !== controlWindow.webContents) {
        controlWindow.webContents.send('colors-update', colors);
    }
});

// Рассылка настроек отображения fullscreen и widget (clockStyle/background)
ipcMain.on('display-settings-update', (event, settings) => {
    // Сохраняем настройки для синхронизации при открытии новых окон
    lastDisplaySettings = settings;
    
    if (displayWindow) {
        displayWindow.webContents.send('display-settings-update', settings);
    }
    if (widgetWindow) {
        widgetWindow.webContents.send('display-settings-update', settings);
    }
});

ipcMain.on('open-widget', () => {
    if (!widgetWindow) {
        createWidgetWindow();
        if (widgetWindow) {
            widgetWindow.webContents.on('did-finish-load', () => {
                widgetWindow.webContents.send('timer-state', timerState);
                // Отправляем сохранённые настройки дисплея (включая стиль)
                if (lastDisplaySettings) {
                    widgetWindow.webContents.send('display-settings-update', lastDisplaySettings);
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
    if (clockWidgetWindow) {
        clockWidgetWindow.webContents.send('set-clock-style', style);
    }
});

// Настройки виджета часов (дата, часовой пояс и т.д.)
ipcMain.on('clock-widget-settings', (event, settings) => {
    if (clockWidgetWindow) {
        clockWidgetWindow.webContents.send('clock-settings', settings);
    }
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
                displayWindow.webContents.send('timer-state', timerState);
                // Отправляем сохранённые настройки дисплея (включая стиль)
                if (lastDisplaySettings) {
                    displayWindow.webContents.send('display-settings-update', lastDisplaySettings);
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
