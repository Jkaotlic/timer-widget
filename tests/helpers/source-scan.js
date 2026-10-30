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
 * Два режима для проверок ОТСУТСТВИЯ (tests/main-no-dom.test.js), по умолчанию
 * выключены — балансировка скобок у остальных тестов не меняется:
 *   - `keepSubstitutions: true` оставляет КОДОМ подстановки `${…}` внутри
 *     шаблонов (вложенные строки и шаблоны в них маскируются по тем же
 *     правилам): без этого `\`${window.X}\`` выглядит строкой;
 *   - `regexLiterals: true` гасит литералы регулярок: кавычка внутри
 *     `/"([^"]*)"/` иначе открывает «строку» до конца файла, и всё, что ниже,
 *     для проверки невидимо (так было с app-scheme.js и security.js).
 *     Эвристика: `/` — начало регулярки, если перед ней (без пробелов) нет
 *     значения — оператор, скобка, запятая, начало текста или слово
 *     `return`/`typeof`/`case`/….
 *   - `comments: []` — массив, куда складываются диапазоны `[from, to)`
 *     комментариев (tests/e2e-pauses.test.js ищет пометку ТОЛЬКО в них, а не
 *     в строковых литералах). Маску не меняет.
 *
 * @param {string} src
 * @param {{keepSubstitutions?: boolean, regexLiterals?: boolean, comments?: Array<[number, number]>|null}} [options]
 * @returns {string}
 */
function maskNonCode(src, { keepSubstitutions = false, regexLiterals = false, comments = null } = {}) {
    const out = src.split('');
    const blank = (from, to) => {
        for (let k = from; k < to && k < out.length; k++) {
            if (out[k] !== '\n') { out[k] = ' '; }
        }
    };

    // Код от `i`. С `untilBrace` — до `}`, закрывающей подстановку (глубина 0);
    // возвращает индекс сразу за ней (или конец текста).
    function code(i, untilBrace) {
        let depth = 0;
        while (i < src.length) {
            const ch = src[i];
            const next = src[i + 1];

            if (ch === '/' && next === '/') {
                const end = src.indexOf('\n', i);
                const stop = end === -1 ? src.length : end;
                if (comments) { comments.push([i, stop]); }
                blank(i, stop);
                i = stop;
                continue;
            }
            if (ch === '/' && next === '*') {
                const end = src.indexOf('*/', i + 2);
                const stop = end === -1 ? src.length : end + 2;
                if (comments) { comments.push([i, stop]); }
                blank(i, stop);
                i = stop;
                continue;
            }
            if (ch === '/' && regexLiterals && regexMayStart(i)) {
                i = regex(i);
                continue;
            }
            if (ch === '`' && keepSubstitutions) {
                i = template(i);
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
            if (untilBrace) {
                if (ch === '{') { depth++; }
                else if (ch === '}') {
                    if (depth === 0) { return i + 1; }
                    depth--;
                }
            }
            i++;
        }
        return i;
    }

    // Перед `/` на `i` — не значение (иначе это деление).
    function regexMayStart(i) {
        let k = i - 1;
        while (k >= 0 && /\s/.test(out[k])) { k--; }
        if (k < 0) { return true; }
        if ('(,=:[!&|?{};+-*%<>~^'.includes(out[k])) { return true; }
        let w = k;
        while (w >= 0 && /[A-Za-z_$]/.test(out[w])) { w--; }
        return ['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'new', 'throw', 'else', 'do']
            .includes(out.slice(w + 1, k + 1).join(''));
    }

    // Регулярка с `/` на `i`: тело гасится (класс `[...]` может содержать `/`).
    function regex(i) {
        let k = i + 1;
        let inClass = false;
        while (k < src.length && src[k] !== '\n') {
            if (src[k] === '\\') { k += 2; continue; }
            if (src[k] === '[') { inClass = true; }
            else if (src[k] === ']') { inClass = false; }
            else if (src[k] === '/' && !inClass) { break; }
            k++;
        }
        blank(i + 1, k);
        return k + 1;
    }

    // Шаблон с открывающей `\`` на `i`: текст гасится, `${…}` — код.
    // Возвращает индекс за закрывающей `\``.
    function template(i) {
        let k = i + 1;
        let from = k;
        while (k < src.length) {
            if (src[k] === '\\') { k += 2; continue; }
            if (src[k] === '`') { blank(from, k); return k + 1; }
            if (src[k] === '$' && src[k + 1] === '{') {
                blank(from, k + 2);
                const close = code(k + 2, true);
                blank(close - 1, close);
                k = close;
                from = k;
                continue;
            }
            k++;
        }
        blank(from, k);
        return k;
    }

    code(0, false);
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

/**
 * Теги `<script src>` страницы: порядок, тип, defer и место (head/вне него).
 *
 * Зачем. Тесты искали подключение файла литералом `<script src="x.js"></script>`,
 * то есть проверяли ПИСЬМО тега, а не факт подключения: `defer` или
 * `type="module"` ломали их все разом. Здесь тег разбирается по атрибутам.
 * HTML-комментарии не считаются (слово `<script src=` в прозе не тег);
 * тег без src (инлайн) в результат не входит.
 *
 * @param {string} html
 * @returns {{src: string, type: string|null, defer: boolean, inHead: boolean}[]}
 */
function scriptTags(html) {
    const clean = html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
    const headEnd = clean.search(/<\/head\s*>/i);
    const out = [];
    for (const m of clean.matchAll(/<script\b([^>]*)>/gi)) {
        const attrs = m[1];
        const attr = (name) => {
            const a = new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+)))?(?=\\s|/|$)`, 'i').exec(attrs);
            return a ? (a[1] ?? a[2] ?? a[3] ?? '') : null;
        };
        const src = attr('src');
        if (src === null) { continue; }
        out.push({
            src,
            type: attr('type'),
            defer: attr('defer') !== null,
            inHead: headEnd === -1 || m.index < headEnd
        });
    }
    return out;
}

module.exports = {
    maskNonCode, balancedBlockAt, afterBalanced, functionBody, constructorBlocks, ipcHandlerBody, codeOnly, styleToken, scriptTags
};
