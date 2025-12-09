// Security utilities для Timer Widget

/**
 * Валидация Data URL
 * Проверяет что строка является корректным data URL изображения
 */
function isValidDataURL(str) {
    if (!str || typeof str !== 'string') return false;

    // Проверка формата data URL для изображений
    const dataURLPattern = /^data:image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
    return dataURLPattern.test(str);
}

/**
 * Валидация HTTP/HTTPS URL
 * Проверяет что строка является валидным HTTP(S) URL
 */
function isValidURL(str) {
    if (!str || typeof str !== 'string') return false;

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
 * Валидация звукового файла
 * @param {File} file - объект файла
 * @returns {Promise<Object>} { valid: boolean, error: string }
 */
async function validateAudioFile(file) {
    if (!file) {
        return { valid: false, error: 'Файл не выбран' };
    }

    // Проверка размера (максимум 5MB)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
        return { valid: false, error: 'Файл слишком большой (максимум 5 MB)' };
    }

    // Проверка MIME type
    const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3'];
    if (!allowedTypes.includes(file.type)) {
        return { valid: false, error: 'Неподдерживаемый формат. Разрешены: MP3, WAV, OGG' };
    }

    // Проверка magic bytes (первые байты файла)
    try {
        const buffer = await file.slice(0, 12).arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Magic bytes для разных форматов
        const signatures = {
            mp3: [
                [0xFF, 0xFB], // MP3 с MPEG-1 Layer 3
                [0xFF, 0xF3], // MP3 с MPEG-2 Layer 3
                [0xFF, 0xF2], // MP3 с MPEG-2.5 Layer 3
                [0x49, 0x44, 0x33] // ID3 tag (часто в начале MP3)
            ],
            wav: [[0x52, 0x49, 0x46, 0x46]], // "RIFF"
            ogg: [[0x4F, 0x67, 0x67, 0x53]]  // "OggS"
        };

        let isValid = false;
        for (const [format, sigs] of Object.entries(signatures)) {
            for (const sig of sigs) {
                if (sig.every((byte, i) => bytes[i] === byte)) {
                    isValid = true;
                    break;
                }
            }
            if (isValid) break;
        }

        if (!isValid) {
            return { valid: false, error: 'Файл повреждён или не является аудио-файлом' };
        }

        return { valid: true, error: null };
    } catch (error) {
        return { valid: false, error: 'Ошибка при чтении файла' };
    }
}

/**
 * Валидация изображения
 * @param {File} file - объект файла
 * @returns {Promise<Object>} { valid: boolean, error: string }
 */
async function validateImageFile(file) {
    if (!file) {
        return { valid: false, error: 'Файл не выбран' };
    }

    // Проверка размера (максимум 10MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
        return { valid: false, error: 'Файл слишком большой (максимум 10 MB)' };
    }

    // Проверка MIME type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (!allowedTypes.includes(file.type)) {
        return { valid: false, error: 'Неподдерживаемый формат. Разрешены: JPEG, PNG, GIF, WebP, BMP' };
    }

    // Проверка magic bytes (первые байты файла)
    try {
        const buffer = await file.slice(0, 12).arrayBuffer();
        const bytes = new Uint8Array(buffer);

        const signatures = {
            jpeg: [[0xFF, 0xD8, 0xFF]],
            png: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
            gif: [[0x47, 0x49, 0x46, 0x38]],
            webp: [[0x52, 0x49, 0x46, 0x46]], // "RIFF" + "WEBP" на позиции 8-11
            bmp: [[0x42, 0x4D]]
        };

        let isValid = false;
        for (const [format, sigs] of Object.entries(signatures)) {
            for (const sig of sigs) {
                if (sig.every((byte, i) => bytes[i] === byte)) {
                    // Дополнительная проверка для WebP
                    if (format === 'webp') {
                        const webpMarker = String.fromCharCode(...bytes.slice(8, 12));
                        isValid = webpMarker === 'WEBP';
                    } else {
                        isValid = true;
                    }
                    break;
                }
            }
            if (isValid) break;
        }

        if (!isValid) {
            return { valid: false, error: 'Файл повреждён или не является изображением' };
        }

        return { valid: true, error: null };
    } catch (error) {
        return { valid: false, error: 'Ошибка при чтении файла' };
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
    if (!str || typeof str !== 'string') return '';

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

/**
 * Sanitize CSS value
 * Удаляет потенциально опасные конструкции из CSS значений
 */
function sanitizeCSS(value) {
    if (!value || typeof value !== 'string') return '';

    // Удаляем expression, url с javascript:, и другие опасные конструкции
    const dangerous = [
        /expression\s*\(/gi,
        /javascript:/gi,
        /vbscript:/gi,
        /@import/gi,
        /behavior:/gi
    ];

    let sanitized = value;
    dangerous.forEach(pattern => {
        sanitized = sanitized.replace(pattern, '');
    });

    return sanitized;
}

// Экспорт для Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isValidDataURL,
        isValidURL,
        validateImageSource,
        safeSetBackgroundImage,
        validateAudioFile,
        validateImageFile,
        safeJSONParse,
        escapeHTML,
        sanitizeCSS
    };
}

// Экспорт для браузера (renderer process)
if (typeof window !== 'undefined') {
    window.SecurityUtils = {
        isValidDataURL,
        isValidURL,
        validateImageSource,
        safeSetBackgroundImage,
        validateAudioFile,
        validateImageFile,
        safeJSONParse,
        escapeHTML,
        sanitizeCSS
    };
}
