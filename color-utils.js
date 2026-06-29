// Color conversion utilities для Timer Widget
// Чистые функции конвертации цветов (HSV ↔ RGB ↔ HEX), без DOM.
// Портировано из ColorPicker (electron-control.html) без изменения логики.

/**
 * HSV → RGB.
 * @param {number} h - оттенок (0-360)
 * @param {number} s - насыщенность (0-1)
 * @param {number} v - яркость (0-1)
 * @returns {number[]} - [r, g, b] (0-255)
 */
function hsvToRgb(h, s, v) {
    let r, g, b;
    const i = Math.floor(h / 60) % 6;
    const f = h / 60 - Math.floor(h / 60);
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * RGB → HEX.
 * @param {number} r - красный (0-255)
 * @param {number} g - зелёный (0-255)
 * @param {number} b - синий (0-255)
 * @returns {string} - '#rrggbb'
 */
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * HSV → HEX.
 * @param {number} h - оттенок (0-360)
 * @param {number} s - насыщенность (0-1)
 * @param {number} v - яркость (0-1)
 * @returns {string} - '#rrggbb'
 */
function hsvToHex(h, s, v) {
    const [r, g, b] = hsvToRgb(h, s, v);
    return rgbToHex(r, g, b);
}

/**
 * HEX → RGB.
 * @param {string} hex - '#rrggbb'
 * @returns {number[]} - [r, g, b] (0-255)
 */
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

/**
 * HEX → HSV.
 * @param {string} hex - '#rrggbb'
 * @returns {number[]} - [h (0-360), s (0-1), v (0-1)]
 */
function hexToHsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) { h = ((g - b) / d + 6) % 6 * 60; }
        else if (max === g) { h = ((b - r) / d + 2) * 60; }
        else { h = ((r - g) / d + 4) * 60; }
    }
    const s = max === 0 ? 0 : d / max;
    return [h, s, max];
}

// Экспорт для Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        hsvToRgb,
        rgbToHex,
        hsvToHex,
        hexToRgb,
        hexToHsv
    };
}

// Экспорт для браузера (renderer process)
if (typeof window !== 'undefined') {
    window.ColorUtils = {
        hsvToRgb,
        rgbToHex,
        hsvToHex,
        hexToRgb,
        hexToHsv
    };
}
