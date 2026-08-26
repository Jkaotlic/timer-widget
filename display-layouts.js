'use strict';

/**
 * display-layouts.js — реестр подвижных элементов полноэкранного окна, их
 * масштабы и готовые раскладки.
 *
 * Зачем отдельный модуль:
 *
 * 1. Список подвижных элементов нужен в ТРЁХ местах: дисплей вешает на них
 *    перетаскивание и колесо, панель раскладывает их кнопкой раскладки, тест
 *    сверяет его с таблицей настроек. Три копии списка — ровно тот дефект,
 *    ради которого написаны settings-schema.js и panel-display.js.
 *
 * 2. Масштаб стал СВОИМ у каждого элемента (17.08.2026). До этого один
 *    `displayBlockScale` двигал три блока из семи элементов, а подпись и
 *    плашка не масштабировались вовсе. Разбор старого значения и подстановка
 *    умолчаний — арифметика, и ей место там, где её проверяет Node.
 *
 * 3. Раскладка — это НАБОР ЧИСЕЛ, а не набор действий: доли экрана и проценты.
 *    Пересчёт долей в пиксели с поджатием к краям тоже проверяется в Node, а
 *    e2e меряет уже настоящие прямоугольники в живом окне.
 *
 * Координата элемента — доля экрана для ЕГО ЦЕНТРА, а не для угла: раскладка
 * обязана переживать смену разрешения (1280×720 на ноутбуке и 3840×2160 на
 * проекторе — обычная пара), а центр при пересчёте не зависит от габарита
 * элемента, который на разных экранах разный.
 */

/**
 * Семь подвижных элементов дисплея.
 *
 * `id`     — имя в `displayBlockPositions` и `displayBlockScales`;
 * `toggle` — ключ тумблера в панели (settings-schema.js);
 * `kind`   — 'block' у карточек и 'label' у подписи с плашкой: у них разные
 *            умолчания масштаба и разный способ его применить (у карточек
 *            `--info-scale` на самом элементе, у подписи и плашки — кегль,
 *            от которого они целиком построены в em).
 */
const DISPLAY_ELEMENTS = [
    { id: 'currentTime', toggle: 'showCurrentTime', kind: 'block', caption: 'Текущее время', labelKey: 'labelCurrentTime' },
    { id: 'eventTime', toggle: 'showEventTime', kind: 'block', caption: 'Начало', labelKey: 'labelEventTime' },
    { id: 'endTime', toggle: 'showEndTime', kind: 'block', caption: 'Окончание', labelKey: 'labelEndTime' },
    { id: 'timeLeft', toggle: 'showTimeLeft', kind: 'block', caption: 'До завершения', labelKey: 'labelTimeLeft' },
    // У названия мероприятия подписи НЕТ и переименовывать нечего: пустая
    // строка в разметке — резерв высоты (см. display.html), а сам текст блока
    // пользователь и так вводит полем «Название».
    { id: 'eventTitle', toggle: 'showEventTitle', kind: 'block' },
    { id: 'heroLabel', toggle: 'showHeroLabel', kind: 'label' },
    { id: 'statusPill', toggle: 'showStatusPill', kind: 'label' }
];

/**
 * Элементы, чью подпись можно переименовать: id → ключ настройки.
 * Выводится из реестра, а не пишется списком, — иначе список разъедется с ним.
 */
const LABELLED_ELEMENTS = DISPLAY_ELEMENTS.filter((el) => el.labelKey);

/**
 * Потолок длины подписи.
 *
 * Не про безопасность (в окно подпись попадает через textContent), а про
 * ГАБАРИТ: по ширине блока считаются раскладки, поджатие к краям экрана и
 * полоса, которую колонка героя уступает верхним карточкам. Подпись на сто
 * символов растянула бы карточку на пол-экрана и утащила бы за собой всё это.
 */
const MAX_CAPTION = 40;

const ELEMENT_IDS = DISPLAY_ELEMENTS.map((el) => el.id);

const MIN_ELEMENT_SCALE = 50;
const MAX_ELEMENT_SCALE = 600;

// Умолчания взяты из display.css и обязаны совпадать с ним: `--info-scale: 1.5`
// у карточки и обычный кегль у подписи с плашкой. Разъедься они — на чистом
// профиле окно показывало бы одно, а сохранённые значения означали другое.
// Равенство проверяет tests/display-layouts.test.js, читая само правило CSS.
//
// 120 → 150 (19.08.2026, просьба «подними размер всех функциональных блоков»):
// блоки смотрят из зала вместе с таймером, и прежний кегль читался с задних
// рядов хуже, чем подпись на слайде.
const DEFAULT_BLOCK_SCALE = 150;
const DEFAULT_LABEL_SCALE = 100;

// Поле от края экрана: карточка вплотную к краю читается как полоска сбоку
// кадра. То же число стоит в перетаскивании блоков (display-script.js).
const EDGE_MARGIN = 20;

function clampScale(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) { return null; }
    return Math.max(MIN_ELEMENT_SCALE, Math.min(MAX_ELEMENT_SCALE, n));
}

/**
 * Подпись блока: пользовательская, если она есть, иначе стандартная.
 *
 * @param {string} id  элемент реестра
 * @param {*} custom   что ввёл пользователь (любой тип: приходит из настроек)
 * @returns {string}
 *
 * Пустая строка и строка из одних пробелов означают «верни стандартную»: поле
 * панели пустое ровно тогда, когда пользователь своего имени не задал, и
 * записывать в него слово «Начало» нельзя — оно тут же стало бы ВТОРОЙ копией
 * умолчания, которую надо было бы держать в согласии с этим реестром.
 *
 * Пробелы схлопываются, а длина обрезается по MAX_CAPTION: подпись задаёт
 * ширину карточки, а по ширине карточки считается вся раскладка.
 */
function blockCaption(id, custom) {
    const row = DISPLAY_ELEMENTS.find((el) => el.id === id);
    const fallback = (row && row.caption) || '';
    if (typeof custom !== 'string') { return fallback; }
    const clean = custom.replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION);
    return clean || fallback;
}

function defaultScale(id) {
    const row = DISPLAY_ELEMENTS.find((el) => el.id === id);
    return row && row.kind === 'label' ? DEFAULT_LABEL_SCALE : DEFAULT_BLOCK_SCALE;
}

/**
 * Масштабы всех семи элементов из того, что нашлось в хранилище.
 *
 * @param {object|null} stored  разобранный `displayBlockScales` (id → проценты)
 * @param {number|null} legacyPct  старый ОБЩИЙ `displayBlockScale`
 * @returns {object} id → проценты, всегда все семь ключей
 *
 * Старое значение применяется только к карточкам: подпись и плашка им никогда
 * не управлялись, и подставить его им — значит на ровном месте изменить окно
 * пользователю, который просто обновил приложение.
 */
function normalizeScales(stored, legacyPct) {
    const legacy = clampScale(legacyPct);
    const src = (stored && typeof stored === 'object') ? stored : {};
    const out = {};
    for (const el of DISPLAY_ELEMENTS) {
        const own = clampScale(src[el.id]);
        if (own !== null) {
            out[el.id] = own;
            continue;
        }
        out[el.id] = (el.kind === 'block' && legacy !== null) ? legacy : defaultScale(el.id);
    }
    return out;
}

/**
 * Раскладки.
 *
 * `elements` — только те, что раскладка ПОКАЗЫВАЕТ; остальные она выключает
 * (см. layoutToggles). Поэтому список элементов раскладки читается как её
 * описание: что в кадре, то и перечислено.
 *
 * `flow: true` означает «оставить на своём месте в раскладке окна»: подпись
 * стоит над таймером, плашка прижата к нижнему краю по центру. Это не то же
 * самое, что координаты 0.5/0.9 — элемент в потоке двигается вместе с
 * таймером при смене стиля и размера окна, а прибитый координатами не двигается.
 */
const LAYOUTS = [
    {
        id: 'classic',
        name: 'Классика',
        hint: 'Таймер по центру, текущее время сверху, начало и окончание снизу',
        timerScale: 100,
        elements: {
            currentTime: { cx: 0.50, cy: 0.10, scale: 150 },
            eventTime: { cx: 0.14, cy: 0.90, scale: 150 },
            endTime: { cx: 0.86, cy: 0.90, scale: 150 },
            heroLabel: { flow: true, scale: 100 },
            statusPill: { flow: true, scale: 100 }
        }
    },
    {
        id: 'conference',
        name: 'Совещание',
        hint: 'Название сверху, все четыре блока времени по углам',
        timerScale: 92,
        elements: {
            // «Совещание» — самая плотная раскладка: пять элементов вокруг
            // таймера. Масштабы здесь ПОТОЛОК, а не вкус: на 1280×720 карточки
            // по углам упираются в название сверху, и проверка непересечения
            // (tests/display-layouts.test.js, шесть разрешений) не пропускает
            // больше 115 % у углов при 120 % у названия. Общий подъём блоков до
            // 150 % живёт в умолчании, а раскладка — это обещание «всё
            // вмещается», и обещание сильнее.
            eventTitle: { cx: 0.50, cy: 0.07, scale: 120 },
            timeLeft: { cx: 0.12, cy: 0.12, scale: 115 },
            currentTime: { cx: 0.88, cy: 0.12, scale: 115 },
            eventTime: { cx: 0.13, cy: 0.89, scale: 115 },
            endTime: { cx: 0.87, cy: 0.89, scale: 115 },
            heroLabel: { flow: true, scale: 100 },
            statusPill: { flow: true, scale: 100 }
        }
    },
    {
        id: 'stage',
        name: 'Сцена',
        hint: 'Только таймер во весь экран, подпись и состояние',
        timerScale: 130,
        elements: {
            heroLabel: { flow: true, scale: 110 },
            statusPill: { flow: true, scale: 110 }
        }
    },
    {
        id: 'dashboard',
        name: 'Сводка',
        hint: 'Название сверху, все четыре блока времени полосой внизу',
        timerScale: 88,
        // Плашка состояния выключена НЕ для красоты: она стоит по центру
        // нижнего края, ровно там, где здесь идёт полоса блоков. Состояние
        // при этом не теряется — его показывают цвет кольца и полоса прогресса.
        elements: {
            // Четыре карточки ПОЛОСОЙ по нижнему краю: их потолок задаёт не
            // таймер, а соседи справа и слева — 100 % на 1280×720.
            eventTitle: { cx: 0.50, cy: 0.07, scale: 140 },
            eventTime: { cx: 0.13, cy: 0.89, scale: 100 },
            currentTime: { cx: 0.37, cy: 0.89, scale: 100 },
            timeLeft: { cx: 0.63, cy: 0.89, scale: 100 },
            endTime: { cx: 0.87, cy: 0.89, scale: 100 },
            heroLabel: { flow: true, scale: 100 }
        }
    },
    {
        id: 'minimal',
        name: 'Минимум',
        hint: 'Один таймер, без подписей и блоков',
        timerScale: 120,
        elements: {}
    }
];

const LAYOUT_IDS = LAYOUTS.map((l) => l.id);

function layoutById(id) {
    return LAYOUTS.find((l) => l.id === id) || null;
}

/**
 * Тумблеры, которые раскладка ставит: перечисленное включено, остальное нет.
 *
 * @returns {object} ключ тумблера → boolean, всегда все семь
 */
function layoutToggles(layout) {
    const out = {};
    for (const el of DISPLAY_ELEMENTS) {
        out[el.toggle] = !!(layout && layout.elements && layout.elements[el.id]);
    }
    return out;
}

/**
 * Масштабы, которые раскладка ставит.
 *
 * У ВЫКЛЮЧЕННОГО элемента масштаб тоже задаётся — иначе включённый потом
 * руками блок пришёл бы с масштабом от прошлой раскладки, а на вид это
 * «блок появился неправильного размера».
 */
function layoutScales(layout) {
    const out = {};
    for (const el of DISPLAY_ELEMENTS) {
        const entry = layout && layout.elements ? layout.elements[el.id] : null;
        const own = entry ? clampScale(entry.scale) : null;
        out[el.id] = own === null ? defaultScale(el.id) : own;
    }
    return out;
}

// Зазор между элементом и коробкой таймера. Меньше отступа от края экрана:
// у края поле нужно, чтобы карточка не читалась полоской, а тут — чтобы два
// объекта не сливались.
const TIMER_GAP = 8;

// Доли по горизонтали отсчитываются не от всей ширины окна, а от полосы
// содержимого — окна шире 16:9, центрированной по экрану.
//
// Замер на 3440×1440 (монитор, на котором это и увидели): коробка таймера —
// `min(60vw, 55vh)` = 792px, то есть 23 % ширины, а блок с долей 0.14 уезжал
// на 482px от края и висел в пустоте в полутора экранах от таймера. Композиция
// разваливалась ровно на том экране, ради которого полноэкранный режим и
// существует. На 16:9 полоса совпадает с окном, и правило не делает ничего.
const CONTENT_ASPECT = 16 / 9;

/**
 * Доли экрана → пиксели левого верхнего угла и РЕАЛЬНЫЙ масштаб.
 *
 * @param {object} layout
 * @param {{width:number,height:number}} viewport
 * @param {object} naturalSizes  id → {width, height} элемента при масштабе 100 %
 * @param {object} [options]  `margin` — поле от края, `timer` — коробка таймера
 *                            {left, top, right, bottom} в пикселях окна
 * @returns {object} id → {left, top, scale}; элементы «в потоке» и элементы без
 *                   замеренного габарита в ответ не попадают
 *
 * Габарит спрашивается ПРИ МАСШТАБЕ 100 %, а не текущий: масштаб здесь и
 * назначается, и мерить надо то, что от него не зависит. Иначе замер подавал
 * бы собственный выход себе на вход — в этом проекте так уже ломалась подгонка
 * кегля «Цифр».
 *
 * Элемент без габарита пропускается, а не раскладывается по нулям: нулевой
 * прямоугольник получают скрытые элементы, и поставить их по центру доли —
 * значит записать в хранилище координату, которая после включения окажется
 * смещённой на пол-элемента.
 *
 * «Вмещается» — это утверждение о прямоугольниках, а не пожелание. Элемент,
 * который своей шириной попадает на таймер, обязан уместиться в полосу НАД ним
 * или ПОД ним; если при масштабе раскладки он в полосу не влезает, масштаб
 * уменьшается ровно настолько, чтобы влез. Раскладка с прибитыми числами
 * («тут 120 %») этого сделать не может: 55vh таймера на 16:9 и на 16:10 — это
 * разная свободная полоса (замер: 243px и 202px при высоте 1080 и 900).
 */
function placeElements(layout, viewport, naturalSizes, options = {}) {
    const out = {};
    if (!layout || !layout.elements || !viewport) { return out; }
    const vw = Number(viewport.width);
    const vh = Number(viewport.height);
    if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) { return out; }

    const margin = Number.isFinite(options.margin) ? options.margin : EDGE_MARGIN;
    const timer = options.timer && Number.isFinite(options.timer.top) ? options.timer : null;
    // Полоса содержимого: на 16:9 и уже — всё окно, на сверхшироком — его
    // центральная часть (см. CONTENT_ASPECT).
    const bandWidth = Math.min(vw, vh * CONTENT_ASPECT);
    const bandLeft = (vw - bandWidth) / 2;

    for (const [id, entry] of Object.entries(layout.elements)) {
        if (!ELEMENT_IDS.includes(id)) { continue; }
        if (!entry || entry.flow) { continue; }
        const size = naturalSizes ? naturalSizes[id] : null;
        if (!size) { continue; }
        const natW = Number(size.width);
        const natH = Number(size.height);
        if (!Number.isFinite(natW) || !Number.isFinite(natH) || natW <= 0 || natH <= 0) { continue; }

        let scale = clampScale(entry.scale);
        if (scale === null) { scale = defaultScale(id); }

        const place = (pct) => {
            const w = natW * pct / 100;
            const h = natH * pct / 100;
            const maxLeft = Math.max(margin, vw - w - margin);
            const maxTop = Math.max(margin, vh - h - margin);
            const left = Math.min(maxLeft, Math.max(margin, bandLeft + entry.cx * bandWidth - w / 2));
            const top = Math.min(maxTop, Math.max(margin, entry.cy * vh - h / 2));
            return { left, top, w, h };
        };

        let box = place(scale);

        if (timer) {
            // Ширина элемента не пересекает таймер — вертикаль его не
            // ограничивает вовсе. Именно так стоят угловые блоки: они выше
            // середины экрана, но таймеру не мешают.
            const crosses = box.left < timer.right && timer.left < box.left + box.w;
            if (crosses) {
                const above = entry.cy < 0.5;
                const band = above
                    ? timer.top - margin - TIMER_GAP
                    : vh - margin - timer.bottom - TIMER_GAP;
                if (band > 0 && box.h > band) {
                    const fitted = Math.floor(scale * band / box.h);
                    scale = Math.max(MIN_ELEMENT_SCALE, Math.min(scale, fitted));
                    box = place(scale);
                }
                // Даже уместившийся по высоте элемент мог встать по своей доле
                // внутрь коробки таймера — прижимаем его к своей полосе.
                if (above) {
                    box.top = Math.min(box.top, timer.top - TIMER_GAP - box.h);
                    box.top = Math.max(margin, box.top);
                } else {
                    box.top = Math.max(box.top, timer.bottom + TIMER_GAP);
                    box.top = Math.min(box.top, Math.max(margin, vh - box.h - margin));
                }
            }
        }

        out[id] = { left: Math.round(box.left), top: Math.round(box.top), scale };
    }
    return out;
}

/**
 * Видимая коробка элемента → доля окна для её ЦЕНТРА.
 *
 * @param {{left:number, top:number, width:number, height:number}} rect
 * @param {{width:number, height:number}} viewport
 * @returns {{cx:number, cy:number}|null}
 *
 * Позиция элемента ХРАНИТСЯ долей, а не пикселем. Пиксель верен ровно для того
 * окна, в котором его записали: в оконном режиме дисплей меняет размер, и
 * блоки, стоящие в абсолютных координатах, разъезжаются — нижние уходят в
 * середину, правые за край. Доля переживает и смену размера окна, и переезд на
 * монитор с другим разрешением.
 */
function positionToFraction(rect, viewport) {
    if (!rect || !viewport) { return null; }
    const vw = Number(viewport.width);
    const vh = Number(viewport.height);
    if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) { return null; }
    const cx = (Number(rect.left) + Number(rect.width) / 2) / vw;
    const cy = (Number(rect.top) + Number(rect.height) / 2) / vh;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) { return null; }
    return { cx, cy };
}

/**
 * Доля окна → пиксели левого верхнего угла ВИДИМОЙ коробки.
 *
 * @param {{cx:number, cy:number}} fraction
 * @param {{width:number, height:number}} viewport
 * @param {{width:number, height:number}} size  видимый габарит элемента
 * @param {number} [margin]
 * @returns {{left:number, top:number}|null}
 *
 * Поджатие к краям здесь ОБЯЗАТЕЛЬНО и не дублирует раскладку: окно могли
 * уменьшить так, что доля сама по себе выносит элемент за край.
 */
function fractionToPosition(fraction, viewport, size, margin = EDGE_MARGIN) {
    if (!fraction || !viewport || !size) { return null; }
    const vw = Number(viewport.width);
    const vh = Number(viewport.height);
    const w = Number(size.width);
    const h = Number(size.height);
    const cx = Number(fraction.cx);
    const cy = Number(fraction.cy);
    if (![vw, vh, w, h, cx, cy].every(Number.isFinite)) { return null; }
    if (vw <= 0 || vh <= 0 || w <= 0 || h <= 0) { return null; }

    const maxLeft = Math.max(margin, vw - w - margin);
    const maxTop = Math.max(margin, vh - h - margin);
    return {
        left: Math.round(Math.min(maxLeft, Math.max(margin, cx * vw - w / 2))),
        top: Math.round(Math.min(maxTop, Math.max(margin, cy * vh - h / 2)))
    };
}

const DisplayLayouts = {
    DISPLAY_ELEMENTS,
    LABELLED_ELEMENTS,
    MAX_CAPTION,
    blockCaption,
    ELEMENT_IDS,
    LAYOUTS,
    LAYOUT_IDS,
    MIN_ELEMENT_SCALE,
    MAX_ELEMENT_SCALE,
    DEFAULT_BLOCK_SCALE,
    DEFAULT_LABEL_SCALE,
    EDGE_MARGIN,
    TIMER_GAP,
    clampScale,
    defaultScale,
    normalizeScales,
    layoutById,
    layoutToggles,
    layoutScales,
    placeElements,
    positionToFraction,
    fractionToPosition
};

if (typeof window !== 'undefined') {
    window.DisplayLayouts = DisplayLayouts;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DisplayLayouts;
}
