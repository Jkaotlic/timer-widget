'use strict';

/**
 * Разбор исходника по СТРУКТУРЕ, а не по форматированию.
 *
 * Зачем отдельный модуль: source-level тесты в этом проекте вырезали куски кода
 * поиском литерала закрывающей скобки с фиксированным отступом
 * (`source.indexOf('\n    });', start)`). Такой «парсер» проверяет не код, а
 * ширину отступа: объявление, попавшее внутрь `if (...) {`, склеивается с
 * соседним блоком и наследует его гарды — то есть тест остаётся зелёным на
 * заведомо дырявом окне. Балансировка скобок делает отступ несущественным.
 *
 * Скобки внутри строк, шаблонов и комментариев не считаются: балансировка идёт
 * по МАСКЕ (копии той же длины, где всё некодовое заменено пробелами), а
 * возвращается срез ИСХОДНОГО текста по найденным индексам. Поэтому в результате
 * сохраняются и строковые литералы, и комментарии — их ищут вызывающие тесты.
 */

/**
 * Копия исходника той же длины, где содержимое строк, шаблонов и комментариев
 * заменено пробелами. Индексы совпадают с исходником один в один.
 *
 * @param {string} src
 * @returns {string}
 */
function maskNonCode(src) {
    const out = src.split('');
    let i = 0;
    const blank = (from, to) => {
        for (let k = from; k < to && k < out.length; k++) {
            if (out[k] !== '\n') { out[k] = ' '; }
        }
    };

    while (i < src.length) {
        const ch = src[i];
        const next = src[i + 1];

        if (ch === '/' && next === '/') {
            const end = src.indexOf('\n', i);
            const stop = end === -1 ? src.length : end;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end === -1 ? src.length : end + 2;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            let k = i + 1;
            while (k < src.length) {
                if (src[k] === '\\') { k += 2; continue; }
                if (src[k] === quote) { k++; break; }
                k++;
            }
            // Содержимое гасим, сами кавычки оставляем — они не скобки и на
            // балансировку не влияют, зато граница остаётся видимой при отладке.
            blank(i + 1, k - 1);
            i = k;
            continue;
        }
        i++;
    }
    return out.join('');
}

/**
 * Срез исходника от `startIndex` до скобки, закрывающей первую `{` после
 * `braceSearchFrom` (по умолчанию — после `startIndex`).
 *
 * @param {string} src
 * @param {number} startIndex
 * @param {string} [what] — имя для сообщения об ошибке
 * @param {number} [braceSearchFrom] — откуда искать открывающую `{`
 * @returns {string}
 */
function balancedBlockAt(src, startIndex, what = 'блок', braceSearchFrom) {
    const mask = maskNonCode(src);
    const open = mask.indexOf('{', braceSearchFrom === undefined ? startIndex : braceSearchFrom);
    if (open === -1) { throw new Error(`${what}: не найдена открывающая скобка`); }

    let depth = 0;
    for (let i = open; i < mask.length; i++) {
        if (mask[i] === '{') { depth++; }
        else if (mask[i] === '}') {
            depth--;
            if (depth === 0) { return src.slice(startIndex, i + 1); }
        }
    }
    throw new Error(`${what}: не найдена закрывающая скобка`);
}

/**
 * Индекс сразу за скобкой, закрывающей пару, открытую на `openIdx`.
 *
 * @param {string} mask — исходник с погашенными строками и комментариями
 * @param {number} openIdx
 * @param {string} open
 * @param {string} close
 * @param {string} what
 * @returns {number}
 */
function afterBalanced(mask, openIdx, open, close, what) {
    let depth = 0;
    for (let i = openIdx; i < mask.length; i++) {
        if (mask[i] === open) { depth++; }
        else if (mask[i] === close) {
            depth--;
            if (depth === 0) { return i + 1; }
        }
    }
    throw new Error(`${what}: не найдена закрывающая «${close}»`);
}

/**
 * Тело объявленной функции `function имя(...) { ... }` вместе с сигнатурой.
 *
 * Список параметров пропускается балансировкой круглых скобок: параметр со
 * значением по умолчанию (`options = {}`) содержит фигурные скобки, и наивный
 * поиск первой `{` вырезал бы вместо тела пустой объект.
 *
 * @param {string} src
 * @param {string} name
 * @returns {string}
 */
function functionBody(src, name) {
    const mask = maskNonCode(src);
    const start = mask.indexOf(`function ${name}(`);
    if (start === -1) { throw new Error(`функция ${name} не найдена`); }
    const params = mask.indexOf('(', start);
    const afterParams = afterBalanced(mask, params, '(', ')', `функция ${name}`);
    return balancedBlockAt(src, start, `функция ${name}`, afterParams);
}

/**
 * Все блоки `new КЛАСС({ ... })` — по одному на каждое вхождение, независимо от
 * отступа и вложенности.
 *
 * @param {string} src
 * @param {string} className
 * @returns {string[]}
 */
function constructorBlocks(src, className) {
    const mask = maskNonCode(src);
    const needle = `new ${className}(`;
    const blocks = [];
    let from = 0;
    for (;;) {
        const at = mask.indexOf(needle, from);
        if (at === -1) { return blocks; }
        blocks.push(balancedBlockAt(src, at, needle));
        from = at + needle.length;
    }
}

/**
 * Тело обработчика `ipcMain.on('канал', ...)` вместе с сигнатурой колбэка.
 *
 * @param {string} src
 * @param {string} channel
 * @returns {string}
 */
function ipcHandlerBody(src, channel) {
    const mask = maskNonCode(src);
    // Сам канал в маске стёрт (это строковый литерал), поэтому позицию ищем в
    // исходнике, а балансируем по маске.
    const at = src.indexOf(`ipcMain.on('${channel}'`);
    if (at === -1) { throw new Error(`обработчик ${channel} не найден`); }
    if (mask.length !== src.length) { throw new Error('маска разошлась с исходником'); }
    // Тело начинается ПОСЛЕ стрелки: в сигнатуре `(event, options = {}) =>`
    // первая `{` принадлежит значению по умолчанию, и поиск «первой скобки»
    // вырезал бы пустой объект вместо обработчика — такой срез проходит любую
    // проверку отсутствия, потому что в нём нет ничего.
    const arrow = mask.indexOf('=>', at);
    if (arrow === -1) { throw new Error(`обработчик ${channel}: не найдена стрелка колбэка`); }
    return balancedBlockAt(src, at, `обработчик ${channel}`, arrow);
}

/**
 * Исходник без комментариев — единственная реализация на весь набор тестов.
 *
 * Нужна ОБЕИМ сторонам утверждения, а не только проверкам отсутствия:
 *   • `assert.match` по сырому тексту доказывает лишь то, что нужные слова
 *     где-то написаны — закомментированная строка удовлетворяет его так же, как
 *     живая, и тест сторожит вырезанное поведение;
 *   • `assert.doesNotMatch` по сырому тексту ложно срабатывает на пояснении,
 *     которое описывает старое сломанное поведение (CLAUDE.md, Gotchas).
 *
 * Копий этой функции было три, и они успели разойтись: две вырезали `<!-- -->`,
 * третья нет — из-за чего проверка по HTML принимала закомментированную
 * разметку. Держим одну.
 *
 * `[^:]` перед `//` сохраняет `http://` и `https://` в неймспейсах SVG и в
 * ссылках. Это эвристика, а не парсер: `//` внутри строкового литерала или
 * регулярного выражения она тоже срежет. Для утверждений о наличии/отсутствии
 * этого достаточно; если понадобится точность — есть maskNonCode() выше.
 */
function codeOnly(src) {
    return src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Значение токена поверхности из `surface-tones.css` для указанного ТОНА.
 *
 * Зачем в общем модуле. С 18.08.2026 пластина перекидыша, циферблат, деления и
 * стрелки записаны не литералами в трёх окнах, а токенами `--style-*` в одном
 * файле. Source-level тесты, которые эти литералы стерегли (непрозрачность
 * карточки, множитель --surface-alpha у циферблата, толщина трека), обязаны
 * ходить по той же ссылке, иначе они стерегут строку `var(--style-plate)` —
 * то есть ничего.
 *
 * @param {string} name  имя без `--`, например 'style-plate'
 * @param {'dark'|'light'} [tone]
 * @returns {string} значение объявления
 */
function styleToken(name, tone = 'dark') {
    const fs = require('node:fs');
    const path = require('node:path');
    // Комментарии срезаются ДО поиска селектора, и это не гигиена, а
    // задокументированная ловушка этого проекта: в шапке surface-tones.css оба
    // селектора названы прозой, и срез по подстроке уезжал на комментарий —
    // `styleToken('style-dial-inner', 'light')` возвращал ТЁМНОЕ значение.
    // Ровно так же однажды уехал срез тем в tests/contrast.test.js.
    const css = fs.readFileSync(path.join(__dirname, '..', '..', 'surface-tones.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const selector = tone === 'light' ? ':root.on-light-bg' : ':root:not(.on-light-bg)';
    const at = css.indexOf(selector);
    if (at === -1) { throw new Error(`surface-tones.css: не найден блок ${selector}`); }
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('\n}', at));
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(body);
    if (!m) { throw new Error(`surface-tones.css: в блоке ${selector} нет --${name}`); }
    return m[1].trim().replace(/\s+/g, ' ');
}

module.exports = { maskNonCode, balancedBlockAt, functionBody, constructorBlocks, ipcHandlerBody, codeOnly, styleToken };
