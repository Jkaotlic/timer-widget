'use strict';

/**
 * digits-style.js — стиль таймера «Цифры»: реестр шрифтов, белый список и
 * арифметика подгонки размера.
 *
 * Зачем модуль. Стиль живёт в ТРЁХ окнах, и без общего владельца реестр из
 * шести шрифтов и замер эталона существовали бы в трёх копиях. В этом проекте
 * так уже было: window-geometry.js до извлечения был двумя дословными клонами,
 * различавшимися четырьмя значениями.
 *
 * Почему размер считается по ЭТАЛОНУ, а не по живому тексту. Существующий
 * updateScaling() в виджете подбирает кегль по формуле `charCount * 0.6`, то
 * есть предполагает моноширинный шрифт. Для Bebas Neue фактическое отношение
 * ~0.42, для Orbitron ~0.78: узкий шрифт рисовался бы заметно мельче доступного
 * места, широкий вылезал бы за край. Мерить надо, а не угадывать — но мерить
 * живой текст нельзя: цифры не у всех шести шрифтов одинаковой ширины, и кегль
 * пересчитывался бы каждую секунду, то есть цифры бы «дышали». Поэтому меряется
 * эталон «88:88» / «8:88:88» — один раз на пару (шрифт, формат), с кэшем.
 *
 * Двойной экспорт, как в window-geometry.js / renderer-shared.js:
 *   - Node (тесты):     module.exports
 *   - Браузер (окна):   window.DigitsStyle
 */

// ---------------------------------------------------------------------------
// Реестр
// ---------------------------------------------------------------------------
/**
 * Поля строки:
 *   id        — значение настройки, оно же ключ белого списка;
 *   label     — подпись в списке панели;
 *   family    — значение для CSS font-family, с запасным семейством;
 *   weight    — начертание, подобранное под крупные цифры;
 *   files     — имена woff2 в fonts/; по ним тест сверяет реестр с диском и с
 *               fonts.css, а генератор NOTICE понимает, что шрифт встроен;
 *   license,
 *   copyright — атрибуция. OFL требует прикладывать и то и другое, а
 *               scripts/generate-notice.js обходит node_modules и шрифтов,
 *               лежащих файлами, не видит. `copyright` переписан из строки
 *               в LICENSE каждого пакета @fontsource/* — первая версия была
 *               написана по памяти при планировании и разошлась с источником
 *               на 9 лет у двух шрифтов из шести (Bebas Neue, Orbitron).
 *               Строка про Italic-файл в LICENSE вырезана: проект не грузит
 *               курсив ни одного из шести шрифтов, и она не несёт новой
 *               информации — тот же год и тот же держатель. Ссылка на
 *               репозиторий шрифта, которая в LICENSE идёт следом за именем
 *               держателя, тоже вырезана — не потому что не по существу
 *               (это часть исходной строки), а потому что `tests/release-
 *               gates.test.js` запрещает shipped-файлам содержать
 *               http(s)-адреса ЛЮБОГО происхождения (гейт против phone-home,
 *               не только против реальных сетевых вызовов), и заводить
 *               исключение под собственный текстовый выбор — не повод.
 */
const DIGIT_FONTS = [
    {
        id: 'inter',
        label: 'Inter',
        family: "'Inter', -apple-system, sans-serif",
        weight: 300,
        files: ['inter-latin-300-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright 2016 The Inter Project Authors'
    },
    {
        id: 'mono',
        label: 'JetBrains Mono',
        family: "'JetBrains Mono', 'SF Mono', monospace",
        weight: 400,
        files: ['jetbrains-mono-latin-400-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright 2020 The JetBrains Mono Project Authors'
    },
    {
        id: 'bebas',
        label: 'Bebas Neue',
        family: "'Bebas Neue', Impact, sans-serif",
        weight: 400,
        files: ['bebas-neue-latin-400-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright 2019 The Bebas Neue Project Authors'
    },
    {
        id: 'oswald',
        label: 'Oswald',
        family: "'Oswald', 'Arial Narrow', sans-serif",
        weight: 500,
        files: ['oswald-latin-500-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright 2016 The Oswald Project Authors'
    },
    {
        id: 'orbitron',
        label: 'Orbitron',
        family: "'Orbitron', 'JetBrains Mono', monospace",
        weight: 700,
        files: ['orbitron-latin-700-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright 2018 The Orbitron Project Authors'
    },
    {
        id: 'playfair',
        label: 'Playfair Display',
        family: "'Playfair Display', Georgia, serif",
        weight: 600,
        files: ['playfair-display-latin-600-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright 2017 The Playfair Display Project Authors, with Reserved Font Name "Playfair Display".'
    }
];

const DEFAULT_FONT_ID = 'inter';

// Базовый кегль замера. Кегль отрисовки = PROBE_FONT_SIZE * fitScale(...).
const PROBE_FONT_SIZE = 100;

// Эталоны. Восьмёрка, а не ноль: у пропорциональных шрифтов ноль не всегда
// самый широкий знак, а восьмёрка в цифровых начертаниях — почти всегда.
const PROBE_MINUTES = '88:88';
const PROBE_HOURS = '8:88:88';
const PROBE_SIGN = '−';

// Знак меньше цифр и отделён отступом — те же значения стоят в CSS всех трёх
// окон. Держим их здесь, потому что запас под знак считает эта арифметика.
const SIGN_FONT_RATIO = 0.62;
const SIGN_GAP_EM = 0.1;

// ---------------------------------------------------------------------------
// Белый список
// ---------------------------------------------------------------------------
/**
 * Строка реестра по идентификатору; неизвестное значение откатывается к
 * умолчанию.
 *
 * Значение приходит ДВУМЯ путями и оба без проверки: из localStorage при старте
 * и по IPC от панели. Дальше оно попадает прямо в style.fontFamily. У часов
 * такой же белый список уже стоит на стиле, и в комментарии рядом описано, чем
 * кончалось его отсутствие.
 */
function resolveFont(id) {
    if (typeof id === 'string') {
        const hit = DIGIT_FONTS.find((font) => font.id === id);
        if (hit) { return hit; }
    }
    return DIGIT_FONTS.find((font) => font.id === DEFAULT_FONT_ID);
}

// ---------------------------------------------------------------------------
// Арифметика подгонки
// ---------------------------------------------------------------------------
/**
 * Во сколько раз замеренный эталон нужно увеличить, чтобы он уложился в
 * доступный прямоугольник.
 *
 * `signWidth` вычитается из доступной ширины: знак минуса вынесен из потока
 * (`position: absolute; right: 100%`) и в ширину блока цифр не входит, но за
 * край окна вылезти может. Существующий код решает это грубее — прибавляет
 * один символ к длине строки.
 *
 * Мусор на входе даёт 0, а не Infinity и не NaN: и то и другое, попав в
 * font-size, схлопывает цифры до невидимых.
 */
function fitScale(options) {
    const opts = options || {};
    const availableWidth = Number(opts.availableWidth);
    const availableHeight = Number(opts.availableHeight);
    const probeWidth = Number(opts.probeWidth);
    const probeHeight = Number(opts.probeHeight);
    const signWidth = Number(opts.signWidth) || 0;

    if (!(availableWidth > 0) || !(availableHeight > 0)) { return 0; }
    if (!(probeWidth > 0) || !(probeHeight > 0)) { return 0; }

    const byWidth = availableWidth / (probeWidth + Math.max(0, signWidth));
    const byHeight = availableHeight / probeHeight;
    const scale = Math.min(byWidth, byHeight);
    return Number.isFinite(scale) && scale > 0 ? scale : 0;
}

/** Кегль отрисовки в пикселях. */
function fitFontSize(options) {
    return PROBE_FONT_SIZE * fitScale(options);
}

// ---------------------------------------------------------------------------
// Замер (DOM)
// ---------------------------------------------------------------------------
// Кэш живёт на модуль, а модуль — на окно: у каждого рендерера свой realm.
const probeCache = new Map();

/** Сбросить кэш замеров. Зовётся после document.fonts.ready и из тестов. */
function clearProbeCache() {
    probeCache.clear();
}

/**
 * Размеры эталона для пары (шрифт, формат) на базовом кегле.
 *
 * ВАЖНО: звать только после `document.fonts.ready`. С `font-display: swap`
 * замер до загрузки woff2 меряет запасное начертание и кэширует чужие цифры.
 * В этом проекте такая ошибка уже стоила фантомной регрессии 2.43% в
 * визуальной сверке.
 *
 * @param {HTMLElement} probeEl — скрытый span, живущий в том же окне
 * @param {string} fontId
 * @param {boolean} hasHours
 * @returns {{width: number, height: number, signWidth: number}|null}
 */
function measureDigits(probeEl, fontId, hasHours) {
    const font = resolveFont(fontId);
    const key = font.id + '|' + (hasHours ? 'h' : 'm');
    const cached = probeCache.get(key);
    if (cached) { return cached; }

    if (!probeEl || typeof probeEl.getBoundingClientRect !== 'function') { return null; }

    probeEl.style.fontFamily = font.family;
    probeEl.style.fontWeight = String(font.weight);
    probeEl.style.fontSize = PROBE_FONT_SIZE + 'px';

    probeEl.textContent = hasHours ? PROBE_HOURS : PROBE_MINUTES;
    const digitsRect = probeEl.getBoundingClientRect();

    probeEl.textContent = PROBE_SIGN;
    const signRect = probeEl.getBoundingClientRect();

    probeEl.textContent = '';

    const measured = {
        width: digitsRect.width,
        height: digitsRect.height,
        signWidth: signRect.width * SIGN_FONT_RATIO + PROBE_FONT_SIZE * SIGN_GAP_EM
    };

    // Нулевой замер не кэшируем: окно могло быть ещё не разложено.
    if (measured.width > 0 && measured.height > 0) { probeCache.set(key, measured); }
    return measured;
}

/**
 * Проставить элементу семейство и начертание выбранного шрифта.
 * Возвращает применённую строку реестра — вызывающему она нужна для эталона.
 */
function applyFont(el, fontId) {
    const font = resolveFont(fontId);
    if (el && el.style) {
        el.style.fontFamily = font.family;
        el.style.fontWeight = String(font.weight);
    }
    return font;
}

const DigitsStyle = {
    DIGIT_FONTS,
    DEFAULT_FONT_ID,
    PROBE_FONT_SIZE,
    PROBE_MINUTES,
    PROBE_HOURS,
    PROBE_SIGN,
    SIGN_FONT_RATIO,
    SIGN_GAP_EM,
    resolveFont,
    fitScale,
    fitFontSize,
    measureDigits,
    clearProbeCache,
    applyFont
};

// Node.js (тесты)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DigitsStyle;
}

// Браузер (все три окна и панель)
if (typeof window !== 'undefined') {
    window.DigitsStyle = DigitsStyle;
}
