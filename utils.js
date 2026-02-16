// Utility functions для Timer Widget

/**
 * Форматирует секунды в строку HH:MM:SS
 * @param {number} totalSeconds - количество секунд (может быть отрицательным)
 * @returns {string} - отформатированное время в формате HH:MM:SS
 */
function formatTime(totalSeconds) {
    const isNegative = totalSeconds < 0;
    const absSeconds = Math.abs(totalSeconds);

    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const seconds = absSeconds % 60;

    const sign = isNegative ? '-' : '';
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');

    return `${sign}${hh}:${mm}:${ss}`;
}

/**
 * Форматирует секунды в короткий формат (MM:SS или HH:MM:SS)
 * @param {number} totalSeconds - количество секунд
 * @returns {string} - отформатированное время
 */
function formatTimeShort(totalSeconds) {
    const isNegative = totalSeconds < 0;
    const absSeconds = Math.abs(totalSeconds);

    if (absSeconds >= 3600) {
        const hours = Math.floor(absSeconds / 3600);
        const minutes = Math.floor((absSeconds % 3600) / 60);
        const seconds = absSeconds % 60;
        return `${isNegative ? '-' : ''}${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    const minutes = Math.floor(absSeconds / 60);
    const seconds = absSeconds % 60;
    return `${isNegative ? '-' : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Парсит строку времени HH:MM:SS в секунды
 * @param {string} timeString - время в формате HH:MM:SS или MM:SS
 * @returns {number} - количество секунд
 */
function parseTime(timeString) {
    if (!timeString || typeof timeString !== 'string') {return 0;}

    const isNegative = timeString.startsWith('-');
    const cleaned = timeString.replace('-', '').trim();
    const parts = cleaned.split(':').map(p => parseInt(p) || 0);

    let total = 0;
    if (parts.length === 3) {
        // HH:MM:SS
        total = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        // MM:SS
        total = parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
        // SS
        total = parts[0];
    }

    return isNegative ? -total : total;
}

/**
 * Debounce функция
 * Откладывает выполнение функции до тех пор, пока не пройдет delay мс с последнего вызова
 * @param {Function} func - функция для debounce
 * @param {number} delay - задержка в миллисекундах
 * @returns {Function} - debounced функция
 */
function debounce(func, delay = 120) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}


/**
 * Получает статус таймера на основе оставшегося времени
 * @param {number} remainingSeconds - оставшиеся секунды
 * @param {number} totalSeconds - общее время
 * @returns {string} - 'normal' | 'warning' | 'danger' | 'overtime'
 */
function getTimerStatus(remainingSeconds, totalSeconds = 0) {
    if (remainingSeconds < 0) {return 'overtime';}
    if (remainingSeconds === 0 && totalSeconds > 0) {return 'danger';}
    if (remainingSeconds <= 60 && remainingSeconds > 0) {return 'warning';}
    return 'normal';
}

/**
 * Вычисляет прогресс таймера (0.0 - 1.0)
 * @param {number} remainingSeconds - оставшиеся секунды
 * @param {number} totalSeconds - общее время
 * @returns {number} - прогресс от 0 до 1
 */
function calculateProgress(remainingSeconds, totalSeconds) {
    if (totalSeconds === 0) {return 0;}
    if (remainingSeconds < 0) {return 0;} // Overtime - прогресс 0
    return Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
}

/**
 * Безопасно отправляет IPC сообщение если окно существует
 * @param {BrowserWindow} window - окно Electron
 * @param {string} channel - канал IPC
 * @param {...any} args - аргументы для отправки
 * @returns {boolean} - успех операции
 */
function safelySendToWindow(window, channel, ...args) {
    if (!window || window.isDestroyed()) {
        return false;
    }

    try {
        if (window.webContents && !window.webContents.isDestroyed()) {
            window.webContents.send(channel, ...args);
            return true;
        }
    } catch (error) {
        console.error(`Failed to send IPC message to ${channel}:`, error);
    }

    return false;
}

/**
 * Проверяет является ли значение валидным числом
 * @param {any} value - значение для проверки
 * @returns {boolean}
 */
function isValidNumber(value) {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

/**
 * Ограничивает число в заданном диапазоне
 * @param {number} value - значение
 * @param {number} min - минимум
 * @param {number} max - максимум
 * @returns {number} - ограниченное значение
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Экспорт для Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatTime,
        formatTimeShort,
        parseTime,
        debounce,
        getTimerStatus,
        calculateProgress,
        safelySendToWindow,
        isValidNumber,
        clamp
    };
}

// Экспорт для браузера (renderer process)
if (typeof window !== 'undefined') {
    window.TimeUtils = {
        formatTime,
        formatTimeShort,
        parseTime,
        getTimerStatus,
        calculateProgress,
        isValidNumber,
        clamp,
        debounce
    };
}
