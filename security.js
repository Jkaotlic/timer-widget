// Security utilities для Timer Widget

/**
 * Валидация Data URL
 * Проверяет что строка является корректным data URL изображения
 */
function isValidDataURL(str) {
    if (!str || typeof str !== 'string') {return false;}

    // Проверка формата data URL для изображений
    const dataURLPattern = /^data:image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
    return dataURLPattern.test(str);
}

/**
 * Валидация HTTP/HTTPS URL
 * Проверяет что строка является валидным HTTP(S) URL
 */
function isValidURL(str) {
    if (!str || typeof str !== 'string') {return false;}

    try {
        const url = new URL(str);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Валидация изображения из любого источника
 * @param {string} imageData - URL или data URL изображения
 * @returns {Object} { valid: boolean, sanitized: string, error: string }
 */
function validateImageSource(imageData) {
    if (!imageData || typeof imageData !== 'string') {
        return {
            valid: false,
            sanitized: '',
            error: 'Пустое или некорректное значение'
        };
    }

    // Проверка data URL
    if (imageData.startsWith('data:')) {
        if (!isValidDataURL(imageData)) {
            return {
                valid: false,
                sanitized: '',
                error: 'Некорректный data URL. Поддерживаются только base64 изображения.'
            };
        }
        return { valid: true, sanitized: imageData, error: null };
    }

    // Проверка HTTP(S) URL
    if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
        if (!isValidURL(imageData)) {
            return {
                valid: false,
                sanitized: '',
                error: 'Некорректный URL'
            };
        }
        // Экранируем специальные символы для безопасной вставки в CSS
        const sanitized = imageData.replace(/["'()]/g, '\\$&');
        return { valid: true, sanitized: sanitized, error: null };
    }

    return {
        valid: false,
        sanitized: '',
        error: 'URL должен начинаться с http://, https:// или data:'
    };
}

/**
 * Безопасная установка background image
 * @param {HTMLElement} element - элемент для установки фона
 * @param {string} imageData - URL или data URL изображения
 * @returns {boolean} успех операции
 */
function safeSetBackgroundImage(element, imageData) {
    if (!element) {
        console.error('safeSetBackgroundImage: element is null');
        return false;
    }

    // Очистка фона если imageData пустой
    if (!imageData) {
        element.style.backgroundImage = '';
        return true;
    }

    // Валидация
    const validation = validateImageSource(imageData);
    if (!validation.valid) {
        console.error('safeSetBackgroundImage: validation failed -', validation.error);
        return false;
    }

    // Безопасная установка через двойные кавычки и экранирование
    try {
        element.style.backgroundImage = `url("${validation.sanitized.replace(/"/g, '\\"')}")`;
        return true;
    } catch (error) {
        console.error('safeSetBackgroundImage: failed to set style -', error);
        return false;
    }
}

/**
 * Безопасный JSON parse с fallback
 * @param {string} jsonString - JSON строка
 * @param {*} defaultValue - значение по умолчанию при ошибке
 * @returns {*} распарсенный объект или defaultValue
 */
function safeJSONParse(jsonString, defaultValue = null) {
    if (!jsonString || typeof jsonString !== 'string') {
        return defaultValue;
    }

    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.error('JSON parse error:', error.message);
        return defaultValue;
    }
}

/**
 * Escape HTML специальных символов
 * Предотвращает XSS при вставке пользовательского текста в HTML
 */
function escapeHTML(str) {
    if (!str || typeof str !== 'string') {return '';}

    const htmlEscapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;'
    };

    return str.replace(/[&<>"'/]/g, char => htmlEscapeMap[char]);
}

// Экспорт для Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isValidDataURL,
        isValidURL,
        validateImageSource,
        safeSetBackgroundImage,
        safeJSONParse,
        escapeHTML
    };
}

// Экспорт для браузера (renderer process)
if (typeof window !== 'undefined') {
    window.SecurityUtils = {
        isValidDataURL,
        isValidURL,
        validateImageSource,
        safeSetBackgroundImage,
        safeJSONParse,
        escapeHTML
    };
}
