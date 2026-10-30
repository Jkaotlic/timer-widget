// Utility functions для Timer Widget

// CONFIG нужен здесь ровно ради одного порога — импортом: и в окне, и в Node
// (require(esm)) это один и тот же модуль, порядок тегов страницы роли больше
// не играет (на дисплее constants.js стоял ПОСЛЕ utils.js, и порог брался из
// литерала ниже — с тем же значением 60).
import * as __CONFIG from './constants.js';

// Порог «жёлтой» зоны в секундах. Здесь стоял литерал 60, а
// CONFIG.WARNING_THRESHOLD не читал НИ ОДИН рабочий файл — при этом тест
// назывался «CONFIG.WARNING_THRESHOLD aligns with getTimerStatus» и проверял
// `=== 60`, то есть сравнивал реестр сам с собой. Поменяй литерал здесь — не
// упало бы ничего; поменяй константу — упал бы тест, а поведение не сдвинулось
// бы ни на секунду. Теперь у значения один владелец.
const WARNING_THRESHOLD_SECONDS = (__CONFIG && Number.isFinite(__CONFIG.WARNING_THRESHOLD))
    ? __CONFIG.WARNING_THRESHOLD
    : 60;

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
 * Разбор ручного ввода времени.
 * Голое число = секунды; X:Y = мин:сек; X:Y:Z = час:мин:сек. Потолок 99:59:59
 * (359999 секунд).
 *
 * Формат СТРОГИЙ (BUG-13): прежний разбор выбрасывал всё, кроме цифр и
 * двоеточий, и складывал обрывки — «1,5» становилось 15 секундами, «99:99» —
 * 6039, «5 мин» — 5, «-5» — 5. Поле показывало уверенный ответ на то, чего
 * человек не писал. Всё, что не совпало с форматом, — null: поле подсветит
 * «не понял формат». Поля после двоеточия меньше 60, ведущее — любое.
 * @param {string} input - строка времени
 * @returns {number|null} - количество секунд или null при невалидном вводе
 */
const MANUAL_TIME_RE = /^\d+(?::\d{1,2}){0,2}$/;

function parseManualTime(input) {
    if (typeof input !== 'string') { return null; }
    const trimmed = input.trim();
    if (!MANUAL_TIME_RE.test(trimmed)) { return null; }

    const parts = trimmed.split(':').map((part) => parseInt(part, 10));
    // Ведущее поле — в своих единицах без потолка («90:00» — полтора часа
    // минутами), остальные — минуты и секунды, им 60 уже не бывает.
    if (parts.slice(1).some((n) => n >= 60)) { return null; }
    const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);

    // Max 99:59:59
    if (seconds > 359999) { return null; }
    return seconds;
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
    if (remainingSeconds <= WARNING_THRESHOLD_SECONDS && remainingSeconds > 0) {return 'warning';}
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
 *
 * Канал — параметр типа: литерал канала из карты (types/ipc-payloads.d.ts)
 * выбирает тип payload, и посылка сверяется с ним; прочие каналы — `any`.
 *
 * @template {string} C
 * @param {{ isDestroyed(): boolean, webContents?: { isDestroyed(): boolean, send(channel: string, ...args: any[]): void } }} window
 *   окно Electron (BrowserWindow). Тип описан по форме: модуль общий с
 *   рендерером, где типов electron нет и быть не должно.
 * @param {C} channel - канал IPC
 * @param {IpcArgs<C>} args - аргументы для отправки
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

export {
    formatTime,
    formatTimeShort,
    parseManualTime,
    debounce,
    getTimerStatus,
    calculateProgress,
    safelySendToWindow,
    isValidNumber,
    clamp
};

// Окно: всё, кроме safelySendToWindow (она — для main).
if (typeof window !== 'undefined') {
    // мост до задачи 6
    window.TimeUtils = {
        formatTime,
        formatTimeShort,
        parseManualTime,
        getTimerStatus,
        calculateProgress,
        isValidNumber,
        clamp,
        debounce
    };
}
