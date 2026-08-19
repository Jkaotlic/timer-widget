'use strict';

/**
 * Размеры окна, которые МОЖНО проверить на этой машине.
 *
 * Спека, задающая размер окна числом, проверяет ровно то, что задала, — но
 * только если система этот размер дала. Больше экрана окно не станет: запрос
 * обрежется молча, и проверка будет подписывать кадр «1920×1080», меряя
 * 1440×877. Именно так регрессия 19.08.2026 доехала до main: на мониторе
 * разработчика (3440×1440) все размеры были настоящими, а на раннерах CI —
 * ни один (1280×1024 на Linux, 1024×720 на Windows, 1024×737 на macOS).
 *
 * Отсюда две части ответа:
 *   1. из желаемого списка берётся то, что ПОМЕЩАЕТСЯ;
 *   2. если помещается меньше двух, добавляются размеры, ВЫВЕДЕННЫЕ из
 *      рабочей области, — иначе на маленьком экране инвариант не проверялся бы
 *      вовсе, а «проверка не выполнена» ничем не лучше «проверка соврала».
 *
 * Ниже пола (по умолчанию 800×560) размеры не выводятся: окно, в котором не
 * помещается сам таймер, меряет не композицию, а предел вёрстки.
 *
 * Чистая функция — проверяется в tests/e2e-window-sizes.test.js.
 *
 * @param {{width:number,height:number}} area рабочая область экрана
 * @param {Array<{w:number,h:number}>} preferred желаемые размеры, от большего
 * @param {{pad?:number,min?:{w:number,h:number}}} [opts]
 * @returns {Array<{w:number,h:number}>} размеры, которые машина точно даст
 */
function pickWindowSizes(area, preferred, opts = {}) {
    const pad = Number.isFinite(opts.pad) ? opts.pad : 80;
    const min = opts.min || { w: 800, h: 560 };
    if (!area || !Number.isFinite(area.width) || !Number.isFinite(area.height)) { return []; }

    const maxW = Math.floor(area.width - pad);
    const maxH = Math.floor(area.height - pad);
    const fits = (preferred || []).filter((s) => s.w <= maxW && s.h <= maxH);
    if (fits.length >= 2) { return fits; }

    const out = fits.slice();
    const candidates = [
        { w: maxW, h: maxH },
        { w: Math.floor(maxW * 0.8), h: Math.floor(maxH * 0.8) }
    ];
    for (const c of candidates) {
        if (c.w < min.w || c.h < min.h) { continue; }
        if (out.some((s) => s.w === c.w && s.h === c.h)) { continue; }
        out.push(c);
    }
    return out;
}

module.exports = { pickWindowSizes };
