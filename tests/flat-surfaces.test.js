'use strict';

/**
 * Владелец инварианта «плоско» — системного правила редизайна 2026-08-12.
 *
 * Редизайн снял стекло и свечения во всех окнах. Это ровно тот класс правил,
 * который ломается незаметно: один `backdrop-filter` в новом правиле не выдаёт
 * себя ни падением, ни ошибкой — он просто возвращает блюр в одно место, и
 * окно начинает отличаться от остальных трёх.
 *
 * Проверок четыре, и все читают ИСХОДНИК: стекло живёт в CSS, а не в логике,
 * импортировать тут нечего.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./helpers/source-scan');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Окна и таблицы, в которых редизайн запретил стекло. */
const SURFACE_FILES = [
    'control.css',
    'display.css',
    'electron-widget.html',
    'electron-clock-widget.html'
];

/**
 * Тело тёмной темы из design-tokens.css.
 *
 * Тёмная тема живёт в общем `:root` в начале файла, светлая — ниже, в
 * `[data-theme="light"]`, и этот порядок обязателен (docs/lessons.md, «A theme
 * block must sit BELOW the shared :root»). Поэтому «тёмные значения» — это всё,
 * что стоит ДО первого вхождения селектора светлой темы.
 */
function darkBlock(css) {
    const cut = css.indexOf('[data-theme="light"]');
    assert.ok(cut > 0, 'блок светлой темы исчез из design-tokens.css');
    return css.slice(0, cut);
}

/**
 * Все объявления одного свойства в исходнике, без комментариев.
 * Возвращает сами значения — не номера строк: codeOnly() срезает комментарии
 * вместе с переносами, поэтому номер строки после него врёт. Значение точнее:
 * по нему находишь место одним grep.
 */
function declarations(src, property) {
    const code = codeOnly(src)
        // Условие @supports содержит `backdrop-filter: blur(1px)` внутри
        // круглых скобок — это ПРОВЕРКА поддержки, а не применение стекла.
        // Само тело блока (сплошные запасные заливки) остаётся под проверкой.
        .replace(/@supports[^{]*/g, ' ');
    const re = new RegExp(`${property}\\s*:\\s*([^;{}]+);`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(code)) !== null) {
        out.push(m[1].trim());
    }
    return out;
}

/**
 * Ахроматичен ли цвет слоя, то есть тень это или ореол.
 *
 * Отличить удаётся только у явных rgb/rgba/#hex. `currentColor`, `var(…)` и
 * `color-mix(…)` не разрешаются на уровне исходника и считаются ЦВЕТНЫМИ —
 * это осознанно строгая сторона: пропустить ореол хуже, чем лишний раз
 * потребовать объяснения.
 */
function isAchromatic(layer) {
    const rgb = layer.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
        const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
        return Math.max(r, g, b) - Math.min(r, g, b) <= 8;
    }
    const hex = layer.match(/#([0-9a-f]{6})\b/i);
    if (hex) {
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
        return Math.max(r, g, b) - Math.min(r, g, b) <= 8;
    }
    return false;
}

/**
 * Разбирает значение box-shadow на слои и оставляет только СВЕЧЕНИЯ.
 *
 * Свечение — это слой, у которого оба смещения нулевые, размытие ненулевое,
 * а цвет ЦВЕТНОЙ. Такое определение отделяет его от четырёх вещей, которые
 * редизайн СОХРАНЯЕТ:
 *   `0 0 0 2px …`            — кольцо фокуса: размытие нулевое, это форма;
 *   `inset 0 0 …`            — внутренняя тень: она внутри, а не ореол;
 *   `0 1px 3px …`            — подъём ручки тумблера: смещение по Y ненулевое;
 *   `0 0 4px rgba(0,0,0,.5)` — нейтральная мягкая тень: она серая, а не цветная.
 *
 * Первая версия была регуляркой `0\s+0\s+([1-9]\d*)px` и находила «свечение
 * 2px» в `0 0 0 2px`, то есть объявляла стеклом кольцо фокуса. Вторая ловила
 * нейтральные тени. Отсюда разбор по слоям И проверка цветности.
 */
function glowLayers(value) {
    // Запятые ВНЕ скобок разделяют слои; запятые внутри rgba() — нет.
    return value.split(/,(?![^()]*\))/)
        .map((layer) => layer.trim())
        .filter((layer) => {
            if (/\binset\b/i.test(layer)) { return false; }
            const lengths = layer
                .replace(/(rgba?|hsla?)\([^)]*\)/gi, ' ')
                .replace(/var\([^)]*\)/gi, ' ')
                .replace(/#[0-9a-f]{3,8}/gi, ' ')
                .replace(/\b(currentColor|transparent|none)\b/gi, ' ')
                .trim()
                .split(/\s+/)
                .filter(Boolean);
            if (lengths.length < 3) { return false; }
            const num = (t) => parseFloat(t) || 0;
            if (!(num(lengths[0]) === 0 && num(lengths[1]) === 0 && num(lengths[2]) > 0)) { return false; }
            return !isAchromatic(layer);
        });
}

test('тёмные поверхности непрозрачны: без блюра полупрозрачность станет дырой', () => {
    // Полупрозрачная поверхность читалась только потому, что под ней работал
    // backdrop-filter. Снять блюр, не сделав её плотной, — значит превратить
    // панель в дыру на рабочий стол.
    const dark = darkBlock(read('design-tokens.css'));
    const SURFACES = ['--tw-bg-surface', '--tw-bg-glass', '--tw-bg-timer', '--tw-bg-led'];

    for (const token of SURFACES) {
        const m = dark.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
        assert.ok(m, `токен ${token} исчез из тёмной темы`);
        const value = m[1].trim();
        assert.ok(
            !/rgba\s*\(/i.test(value),
            `${token} в тёмной теме полупрозрачен (${value}), а блюра под ним больше нет`
        );
    }
});

test('токены блюра погашены в обеих темах', () => {
    const css = read('design-tokens.css');
    const decls = css.match(/--tw-blur[a-z-]*\s*:\s*[^;]+;/g) || [];
    assert.ok(
        decls.length >= 6,
        'объявления блюра исчезли целиком. Их читают 46 мест в четырёх файлах — ' +
        'удаление превратит каждое в невалидное `backdrop-filter: ;`. Ожидалось none'
    );
    for (const d of decls) {
        assert.match(d, /:\s*none\s*;/, `блюр вернулся: ${d.trim()}`);
    }
});

test('живого backdrop-filter не осталось: только none или погашенный токен', () => {
    // Допустимы ровно два значения. `none` — явное снятие. `var(--tw-blur…)` —
    // обращение к токену, который СОСЕДНИЙ тест прибивает к none; 46 таких
    // объявлений живут в четырёх файлах, и вычищать их здесь значило бы трогать
    // ровно те файлы, которые перепишет этап D. Вдвоём эти два теста и
    // доказывают, что живого стекла в приложении нет.
    // Хардкод вида `blur(20px) saturate(180%)` не проходит ни под одно из двух:
    // он обходит токен и вернул бы стекло в одно место, не тронув остальные.
    for (const file of SURFACE_FILES) {
        for (const value of declarations(read(file), '(?:-webkit-)?backdrop-filter')) {
            const ok = value === 'none' || /^var\(--tw-blur[a-z-]*\)$/.test(value);
            assert.ok(ok, `${file}: стекло вернулось в обход токена — backdrop-filter: ${value}`);
        }
    }
});

test('внешних цветных свечений не осталось', () => {
    for (const file of SURFACE_FILES) {
        for (const value of declarations(read(file), 'box-shadow')) {
            const glows = glowLayers(value);
            assert.deepEqual(
                glows, [],
                `${file}: свечение вернулось — box-shadow: ${value}`
            );
        }
    }
});

/**
 * Свечения через text-shadow и filter: drop-shadow — тот же ореол, но другим
 * свойством. Их находит тот же разбор слоёв.
 */
function textGlowCount(src) {
    const code = codeOnly(src);
    let count = 0;
    let m;

    const drop = /drop-shadow\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
    while ((m = drop.exec(code)) !== null) {
        if (glowLayers(m[1]).length > 0) { count += 1; }
    }

    const text = /text-shadow\s*:\s*([^;{}]+);/g;
    while ((m = text.exec(code)) !== null) {
        count += glowLayers(m[1]).length;
    }
    return count;
}

test('свечения через text-shadow/drop-shadow только УБЫВАЮТ', () => {
    // Храповик, а не запрет. Этап A снял ореолы, живущие в box-shadow; те же
    // ореолы, написанные через text-shadow и drop-shadow, — это неоновые стили
    // LED и «Цифры» в трёх окнах, и снимает их этап D, который эти окна и
    // переписывает. Досрочная зачистка означала бы переписать LED посреди
    // этапа про токены.
    //
    // Числа — зафиксированный ДОЛГ. Меньше — снять потолок и записать новый;
    // больше — свечение вернули, и это регрессия. Ноль во всех четырёх строках
    // означает, что этап D закрыт и тест пора превратить в запрет.
    const DEBT = {
        'control.css': 0,
        'display.css': 25,
        'electron-widget.html': 10,
        'electron-clock-widget.html': 6
    };

    for (const [file, ceiling] of Object.entries(DEBT)) {
        const actual = textGlowCount(read(file));
        assert.ok(
            actual <= ceiling,
            `${file}: свечений через text-shadow/drop-shadow стало ${actual} при потолке ${ceiling} — ореол вернули`
        );
        assert.equal(
            actual, ceiling,
            `${file}: свечений осталось ${actual}, потолок ${ceiling}. Долг уменьшился — опустить число здесь`
        );
    }
});

test('разбор слоёв тени не путает свечение с кольцом, подъёмом и внутренней тенью', () => {
    // Проверка самой проверки. Без неё три предыдущих теста могли бы быть
    // зелёными потому, что ничего не находят в принципе.
    assert.deepEqual(glowLayers('0 0 0 2px rgba(0,0,0,0.35)'), [], 'кольцо фокуса — не свечение');
    assert.deepEqual(glowLayers('0 1px 3px rgba(0,0,0,0.2)'), [], 'подъём ручки тумблера — не свечение');
    assert.deepEqual(glowLayers('inset 0 0 15px rgba(0,0,0,0.5)'), [], 'внутренняя тень — не свечение');
    assert.deepEqual(glowLayers('none'), [], '`none` — не свечение');
    assert.deepEqual(glowLayers('0 0 4px rgba(0,0,0,0.5)'), [], 'нейтральная мягкая тень — не свечение');
    assert.deepEqual(glowLayers('0 0 6px #222222'), [], 'серая тень через hex — не свечение');

    assert.equal(glowLayers('0 0 25px rgba(48, 209, 88, 0.2)').length, 1, 'ореол обязан находиться');
    assert.equal(glowLayers('0 0 8px currentColor').length, 1, 'ореол через currentColor обязан находиться');
    assert.equal(
        glowLayers('0 1px 2px rgba(0,0,0,0.06), 0 0 20px rgba(255,0,0,0.5)').length, 1,
        'из двух слоёв обязан находиться ровно свечение'
    );
});
