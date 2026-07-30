'use strict';

/**
 * visual-diff.js — сравнение двух растров попиксельно.
 *
 * Чистый модуль без Electron и без зависимостей: принимает уже декодированные
 * RGBA-буферы, поэтому тестируется обычным `node --test`. Декодирование PNG
 * делает вызывающая сторона (в нашем случае — Electron через
 * nativeImage.createFromPath(...).toBitmap(), см. scripts/screenshot-runner.js).
 *
 * Зачем вообще: «жёлтый ноль» и зелёная плашка «ВРЕМЯ ВЫШЛО!» прожили в проекте
 * месяцами, потому что поймать их можно было только глазами. Эталонные снимки
 * превращают такую регрессию в падение CI.
 *
 * Допуск нужен обязательно: сглаживание шрифтов и композитинг стекла дают
 * расхождение в младших битах между запусками, и побайтовое сравнение давало бы
 * ложные срабатывания на ровном месте.
 */

// Пиксель считается изменившимся, если хотя бы один канал отличается сильнее,
// чем на channelTolerance. 8 из 255 — заметно меньше любой смысловой смены
// цвета (жёлтый → красный это сотни единиц), но выше шума антиалиасинга.
const DEFAULT_CHANNEL_TOLERANCE = 8;

// Доля изменившихся пикселей, ниже которой картинки считаются одинаковыми.
// 0.1% на 1280×720 — это ~920 пикселей: хватит поглотить дрожание субпикселей,
// но не хватит спрятать перекрашенный элемент.
const DEFAULT_MAX_DIFF_RATIO = 0.001;

/**
 * Сравнивает два RGBA-буфера одинакового размера.
 *
 * @param {Buffer|Uint8Array} a
 * @param {Buffer|Uint8Array} b
 * @param {{channelTolerance?:number}} [opts]
 * @returns {{equalSize:boolean, diffPixels:number, totalPixels:number, ratio:number}}
 *   equalSize === false означает, что сравнивать нечего — размеры разошлись,
 *   и это само по себе регрессия (окно поехало по размеру).
 */
function diffBitmaps(a, b, opts = {}) {
    const tolerance = Number.isFinite(Number(opts.channelTolerance))
        ? Number(opts.channelTolerance)
        : DEFAULT_CHANNEL_TOLERANCE;

    if (!a || !b || a.length !== b.length || a.length === 0) {
        return { equalSize: false, diffPixels: 0, totalPixels: 0, ratio: 1 };
    }

    const totalPixels = Math.floor(a.length / 4);
    let diffPixels = 0;

    for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) > tolerance
            || Math.abs(a[i + 1] - b[i + 1]) > tolerance
            || Math.abs(a[i + 2] - b[i + 2]) > tolerance
            || Math.abs(a[i + 3] - b[i + 3]) > tolerance) {
            diffPixels++;
        }
    }

    return {
        equalSize: true,
        diffPixels,
        totalPixels,
        ratio: totalPixels === 0 ? 1 : diffPixels / totalPixels
    };
}

/**
 * Решает, считать ли расхождение регрессией.
 *
 * @param {ReturnType<typeof diffBitmaps>} result
 * @param {{maxDiffRatio?:number}} [opts]
 * @returns {boolean}
 */
function isRegression(result, opts = {}) {
    if (!result || result.equalSize === false) { return true; }
    const maxRatio = Number.isFinite(Number(opts.maxDiffRatio))
        ? Number(opts.maxDiffRatio)
        : DEFAULT_MAX_DIFF_RATIO;
    return result.ratio > maxRatio;
}

/**
 * Снимки, которые НЕЛЬЗЯ сравнивать с эталоном: виджет часов показывает
 * реальное текущее время, поэтому отличается при каждом запуске by design.
 *
 * @param {string} name — имя файла снимка
 * @returns {boolean}
 */
function isTimeDependent(name) {
    return /^clock-/.test(String(name || ''));
}

module.exports = {
    diffBitmaps,
    isRegression,
    isTimeDependent,
    DEFAULT_CHANNEL_TOLERANCE,
    DEFAULT_MAX_DIFF_RATIO
};
