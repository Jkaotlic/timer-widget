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
// Эталон ВЕРТИКАЛИ — весь набор цифр, а не одна и не '88:88'.
//
// Одной цифрой обойтись нельзя: у Playfair Display цифры СТАРОСТИЛЬНЫЕ, они
// разной высоты, и ответ зависит от того, какую взять — замер 17.08.2026 дал
// 0.028 кегля по «8» (она восходящая), 0.124 по «0» (она в высоту строчной) и
// 0.096 по всему набору. Набор описывает ПОЛОСУ, которую цифры занимают в
// принципе, поэтому не зависит от того, что сейчас на табло, — а зависеть от
// этого нельзя, иначе знак дёргался бы каждую секунду. У шрифтов с обычными
// цифрами все три ответа совпадают (Inter: −0.048 / −0.048 / −0.049).
//
// Двоеточие в эталон не входит: оно ниже цифр и утянуло бы знак вниз (по
// строке «00:03» получалось 0.192 — знак заметно ниже середины числа).
const PROBE_FIGURES = '0123456789';

// Знак меньше цифр и отделён отступом — те же значения стоят в CSS всех трёх
// окон. Держим их здесь, потому что запас под знак считает эта арифметика.
const SIGN_FONT_RATIO = 0.62;
const SIGN_GAP_EM = 0.1;

// Поля рамки вокруг цифр — в долях КЕГЛЯ, потому что рамка обязана расти
// вместе с ними. Эти же значения стоят в CSS всех трёх окон
// (`.widget-digits-time`, `.clock-digits-time`, `.digits-time`), и совпадение
// проверяется тестом: разойдутся — подогнанные цифры вылезут за рамку, ведь
// подгонка считает по этим числам.
//
// Рамка появилась при слиянии стилей: LED был теми же цифрами в тёмной
// коробке, и без полей у объединённого стиля фон лип бы вплотную к глифам.
const FRAME_PAD_X_EM = 0.34;
const FRAME_PAD_Y_EM = 0.18;

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

    // Поля рамки входят в габарит: цифры подгоняются вместе с ней, иначе при
    // заданном фоне рамка вылезала бы за окно ровно на свои поля.
    const frameX = PROBE_FONT_SIZE * 2 * FRAME_PAD_X_EM;
    const frameY = PROBE_FONT_SIZE * 2 * FRAME_PAD_Y_EM;
    const byWidth = availableWidth / (probeWidth + Math.max(0, signWidth) + frameX);
    const byHeight = availableHeight / (probeHeight + frameY);
    const scale = Math.min(byWidth, byHeight);
    return Number.isFinite(scale) && scale > 0 ? scale : 0;
}

/** Кегль отрисовки в пикселях. */
function fitFontSize(options) {
    return PROBE_FONT_SIZE * fitScale(options);
}

// ---------------------------------------------------------------------------
// Вертикаль знака
// ---------------------------------------------------------------------------
/**
 * Насколько центр ЧЕРНИЛ ниже центра бокса (в тех же пикселях, что метрики).
 *
 * Знак минуса стоит абсолютом и центрируется по своему боксу, а глаз видит
 * чернила. Где чернила сидят внутри бокса, решает шрифт, и для минуса это
 * особенно своевольно: он висит на математической оси, а не занимает высоту
 * прописной. Замер 17.08.2026 по шести шрифтам стиля: от −0.061 кегля (Inter,
 * знак ниже середины цифр) до +0.119 (Playfair Display, знак заметно выше —
 * с этой жалобы всё и началось).
 */
function hasInkMetrics(metrics) {
    return !!metrics && [
        metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent,
        metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent
    ].every((v) => Number.isFinite(Number(v)));
}

function inkCenterOffset(metrics) {
    if (!hasInkMetrics(metrics)) { return 0; }
    return (Number(metrics.fontBoundingBoxAscent) - Number(metrics.fontBoundingBoxDescent)) / 2
        - (Number(metrics.actualBoundingBoxAscent) - Number(metrics.actualBoundingBoxDescent)) / 2;
}

/**
 * На сколько ДОЛЕЙ КЕГЛЯ ЦИФР опустить знак, чтобы его чернила встали по центру
 * чернил цифр. Отрицательное — поднять.
 *
 * Доля, а не пиксели: метрики шрифта линейны по кеглю, поэтому величина
 * считается один раз на шрифт и переживает и подгонку кегля, и масштабирование
 * окна колесом. Мусор на входе даёт 0 по тому же закону, что и `fitScale`:
 * NaN, попав в `transform`, не сдвигает знак, а ломает раскладку молча.
 *
 * @param {TextMetrics|object} digitsMetrics — замер цифры в кегле цифр
 * @param {TextMetrics|object} signMetrics — замер знака в ЕГО кегле
 * @param {number} fontSize — кегль цифр, в котором сделан первый замер
 */
function signShiftRatio(digitsMetrics, signMetrics, fontSize) {
    const size = Number(fontSize);
    // Неизмеренная СТОРОНА обнуляет весь сдвиг, а не свою половину: принять её
    // за ноль значило бы подвинуть знак на смещение одних только цифр — то есть
    // увезти его дальше, чем он стоял.
    if (!hasInkMetrics(digitsMetrics) || !hasInkMetrics(signMetrics)) { return 0; }
    if (!Number.isFinite(size) || size <= 0) { return 0; }
    const shift = inkCenterOffset(digitsMetrics) - inkCenterOffset(signMetrics);
    return Number.isFinite(shift) ? shift / size : 0;
}

// ---------------------------------------------------------------------------
// Замер (DOM)
// ---------------------------------------------------------------------------
// Кэш живёт на модуль, а модуль — на окно: у каждого рендерера свой realm.
const probeCache = new Map();

// Кэш вертикали знака — своя карта, ключ только шрифт: величина в ДОЛЯХ кегля,
// то есть от эталонной строки и от размера окна не зависит.
const signShiftCache = new Map();

/** Сбросить кэш замеров. Зовётся после document.fonts.ready и из тестов. */
function clearProbeCache() {
    probeCache.clear();
    signShiftCache.clear();
}

/**
 * Собственное семейство шрифта, без запасных.
 *
 * `document.fonts.check()` отвечает «да», если может отрисовать ЛЮБЫМ
 * семейством из списка, а у каждой строки реестра запасное семейство системное
 * и есть всегда. Со списком проверка была бы вечнозелёной и не проверяла бы
 * ничего.
 */
function primaryFamily(font) {
    return String(font.family).split(',')[0].trim();
}

function fontSpec(font, size) {
    return `${font.weight} ${size}px ${primaryFamily(font)}`;
}

/**
 * Загружен ли woff2 этого шрифта ПРЯМО СЕЙЧАС.
 *
 * `document.fonts.ready` отвечает на другой вопрос — «догрузилось всё, что
 * документ запросил К ЭТОМУ МОМЕНТУ». Шрифт, выбранный пользователем позже,
 * запрашивается только при применении, и первый замер после переключения
 * попадает на запасное начертание. Замер 17.08.2026: сразу после переключения на
 * Playfair Display `check()` даёт false, вертикаль знака меряется по Georgia
 * (0.044 вместо 0.094) — и, что хуже, КЭШИРУЕТСЯ на всю сессию.
 */
function isFontLoaded(fontId) {
    if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.check !== 'function') {
        // Нет API — считаем шрифт готовым: иначе замеры не кэшировались бы
        // никогда, а это дороже, чем разовая ошибка на экзотической платформе.
        return true;
    }
    try {
        return document.fonts.check(fontSpec(resolveFont(fontId), PROBE_FONT_SIZE));
    } catch {
        return true;
    }
}

/**
 * Дождаться шрифта. Возвращает промис, который ВСЕГДА успешен: вызывающему нужно
 * знать не причину, а момент, когда замер снова имеет смысл.
 */
function ensureFont(fontId) {
    const font = resolveFont(fontId);
    if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') {
        return Promise.resolve(false);
    }
    return Promise.all([
        document.fonts.load(fontSpec(font, PROBE_FONT_SIZE), PROBE_FIGURES),
        document.fonts.load(fontSpec(font, PROBE_FONT_SIZE * SIGN_FONT_RATIO), PROBE_SIGN)
    ]).then(() => true).catch(() => false);
}

/**
 * Вертикаль знака для шрифта — доля кегля цифр, на которую знак опускается.
 *
 * Меряется по `TextMetrics`, а не по прямоугольникам в раскладке: чернила
 * рисуются шрифтом, и в `getBoundingClientRect()` их положения внутри бокса не
 * видно вовсе — знак может стоять «ровно по центру» и выглядеть уехавшим.
 *
 * ВАЖНО: как и measureDigits(), звать только после `document.fonts.ready` —
 * до загрузки woff2 замеряется запасное начертание и кэшируется чужая вертикаль.
 */
function measureSignShift(fontId) {
    const font = resolveFont(fontId);
    const cached = signShiftCache.get(font.id);
    if (cached !== undefined) { return cached; }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') { return 0; }

    const canvas = document.createElement('canvas');
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) { return 0; }

    ctx.font = `${font.weight} ${PROBE_FONT_SIZE}px ${font.family}`;
    const digits = ctx.measureText(PROBE_FIGURES);
    ctx.font = `${font.weight} ${PROBE_FONT_SIZE * SIGN_FONT_RATIO}px ${font.family}`;
    const sign = ctx.measureText(PROBE_SIGN);

    const ratio = signShiftRatio(digits, sign, PROBE_FONT_SIZE);
    // Кэшируем только замер СВОЕГО шрифта: вырожденный (окно ещё не разложено)
    // и снятый с запасного начертания (woff2 не доехал) остались бы в кэше на
    // всю сессию, а второй при этом выглядит как совершенно нормальное число.
    if (digits.width > 0 && sign.width > 0 && isFontLoaded(font.id)) {
        signShiftCache.set(font.id, ratio);
    }
    return ratio;
}

/**
 * Размеры эталона для пары (шрифт, эталонный текст) на базовом кегле.
 *
 * ВАЖНО: звать только после `document.fonts.ready`. С `font-display: swap`
 * замер до загрузки woff2 меряет запасное начертание и кэширует чужие цифры.
 * В этом проекте такая ошибка уже стоила фантомной регрессии 2.43% в
 * визуальной сверке.
 *
 * Эталонный текст передаётся ЯВНО, а не булевым `hasHours`. У таймера
 * (виджет, дисплей) форм ровно две — `PROBE_MINUTES` / `PROBE_HOURS` — и
 * булев переключатель их различал. У часов появляется третья форма: суффикс
 * `« AM»`/`« PM»`, которого у таймера не бывает вообще, и «часы есть / часов
 * нет» её не выражает. Часы сперва обходили это ОТДЕЛЬНЫМ инлайновым замером
 * мимо этого модуля — `getBoundingClientRect()` на КАЖДЫЙ вызов
 * `updateScaling()` (висит на `resize` окна без троттлинга) без кэша вообще,
 * да ещё и расходящимся с этой функцией, если сюда когда-нибудь добавится,
 * например, учёт `letter-spacing`. Кэш различает эталоны по САМОМУ ТЕКСТУ
 * (см. ключ ниже), поэтому разные окна зовут с разными строками одного
 * шрифта без коллизий, и часам кэш достаётся тем же путём, что виджету и
 * дисплею.
 *
 * @param {HTMLElement} probeEl — скрытый span, живущий в том же окне
 * @param {string} fontId
 * @param {string} [probeText] — эталонная строка; по умолчанию `PROBE_MINUTES`
 * @returns {{width: number, height: number, signWidth: number}|null}
 */
function measureDigits(probeEl, fontId, probeText) {
    const font = resolveFont(fontId);
    const text = (typeof probeText === 'string' && probeText) ? probeText : PROBE_MINUTES;
    const key = font.id + '|' + text;
    const cached = probeCache.get(key);
    if (cached) { return cached; }

    if (!probeEl || typeof probeEl.getBoundingClientRect !== 'function') { return null; }

    probeEl.style.fontFamily = font.family;
    probeEl.style.fontWeight = String(font.weight);
    probeEl.style.fontSize = PROBE_FONT_SIZE + 'px';

    probeEl.textContent = text;
    const digitsRect = probeEl.getBoundingClientRect();

    probeEl.textContent = PROBE_SIGN;
    const signRect = probeEl.getBoundingClientRect();

    probeEl.textContent = '';

    const measured = {
        width: digitsRect.width,
        height: digitsRect.height,
        signWidth: signRect.width * SIGN_FONT_RATIO + PROBE_FONT_SIZE * SIGN_GAP_EM
    };

    // Не кэшируем ни нулевой замер (окно могло быть ещё не разложено), ни
    // снятый с ЗАПАСНОГО начертания: `document.fonts.ready` в окне разрешился
    // один раз на старте и о шрифте, выбранном позже, ничего не знает — первый
    // замер после переключения приходится на подмену. Ширина при этом честно
    // больше нуля, поэтому прежнее условие такой замер пропускало и кэшировало
    // чужие метрики на всю сессию: подогнанный кегль оставался чужим.
    if (measured.width > 0 && measured.height > 0 && isFontLoaded(font.id)) {
        probeCache.set(key, measured);
    }
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
    PROBE_FIGURES,
    SIGN_FONT_RATIO,
    SIGN_GAP_EM,
    FRAME_PAD_X_EM,
    FRAME_PAD_Y_EM,
    resolveFont,
    fitScale,
    fitFontSize,
    inkCenterOffset,
    signShiftRatio,
    measureSignShift,
    isFontLoaded,
    ensureFont,
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
