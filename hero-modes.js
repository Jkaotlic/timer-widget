'use strict';

/**
 * hero-modes.js — что показывает КРУПНОЕ число полноэкранного дисплея.
 *
 * До 08.09.2026 это всегда был остаток таймера доклада. На мероприятии этого
 * мало: пока зал собирается, нужно «до начала», ведущему по ходу — «до конца»
 * (величина, не связанная с текущим докладом), в перерыве — просто часы.
 *
 * Модуль чистый: ни Electron, ни DOM. Сюда приходят режим, показания часов и
 * состояние таймера — отсюда уходят два числа и подпись.
 *
 * Правило, ради которого модуль отдельный: РЕЖИМ ВЛИЯЕТ НА ЦВЕТ ТОЛЬКО ЧЕРЕЗ
 * ТОТАЛ. `RendererShared.timerColorBand(secs, total)` уже отдаёт `overtime`
 * при отрицательных секундах и `normal` при `total <= 0`, поэтому «полосы от
 * тотала», «только минус» и «полос нет» — это не три правила, а три значения
 * одного тотала. Второго знания о цвете здесь не заводится.
 */

// Имена УНИКАЛЬНЫ на весь документ: сборщика нет, все файлы — classic
// <script>, и столкновение имени верхнего уровня роняет inline-скрипт окна
// целиком.
const HeroShared = (typeof window !== 'undefined' && window.RendererShared)
    ? window.RendererShared
    : require('./renderer-shared.js');

const HeroLayouts = (typeof window !== 'undefined' && window.DisplayLayouts)
    ? window.DisplayLayouts
    : require('./display-layouts.js');

/**
 * Реестр режимов.
 *
 * `caption: null` у таймера — не «подписи нет», а «подпись принадлежит другому
 * владельцу»: её пишет updateChipState() по состоянию таймера («Осталось» /
 * «Пауза» / «Завершено»). Вызывающий обязан отличать null от пустой строки.
 *
 * `clock: true` — «это ПОКАЗАНИЯ ЧАСОВ, а не длительность». Числа у них
 * одинаковые (секунды), а вот печатаются они по-разному, и знание об этом
 * обязано жить ЗДЕСЬ, а не размножаться по местам показа: см. разбор у
 * `isClockMode()`.
 */
const HERO_MODES = [
    { id: 'timer', caption: null, labelKey: null, clock: false },
    { id: 'current', caption: 'Текущее время', labelKey: 'labelHeroCurrent', clock: true },
    { id: 'to-start', caption: 'До начала мероприятия', labelKey: 'labelHeroToStart', clock: false },
    { id: 'to-end', caption: 'До конца мероприятия', labelKey: 'labelHeroToEnd', clock: false }
];

const HERO_MODE_IDS = HERO_MODES.map((mode) => mode.id);
const HERO_LABEL_KEYS = HERO_MODES.filter((mode) => mode.labelKey).map((mode) => mode.labelKey);
const DEFAULT_MODE = 'timer';

const SECONDS_PER_DAY = 86400;

/** Режим по id; мусор и отсутствие дают режим по умолчанию. */
function modeById(id) {
    return HERO_MODES.find((mode) => mode.id === id) || HERO_MODES[0];
}

/**
 * Часы это или длительность.
 *
 * ЧАСЫ И ДЛИТЕЛЬНОСТЬ НЕ МОГУТ ДЕЛИТЬ ФОРМАТТЕР. Длительность печатается
 * коротко и без ведущих нулей (`formatTimeShort`): «05:00» — это пять минут, и
 * писать «00:05:00» на весь экран незачем. Часы так печатать НЕЛЬЗЯ: в 00:30:15
 * короткий форматтер выбрасывает группу часов и выдаёт «30:15», а зал под
 * подписью «Текущее время» читает это как получасовой отсчёт; в 09:05:07 он же
 * теряет ведущий ноль и выдаёт «9:05:07» рядом с «09:05:07» на плашке в углу —
 * одна величина, два написания, один экран. Часам положен `formatTime`, всегда
 * ЧЧ:ММ:СС.
 *
 * Замечено 08.09.2026 финальным ревью ветки: вся она писалась в 15:xx–16:xx,
 * когда `formatTimeShort` и `formatTime` на показаниях часов совпадают, и
 * дефекта не видел никто — включая e2e, зелёную ровно по той же причине.
 *
 * Признак живёт в реестре, а не предикатом `mode === 'current'` у потребителя:
 * потребителей у него три (текст героя, «Цифры», число створок флипа), и
 * пятый режим не должен требовать поиска по коду.
 */
function isClockMode(id) {
    return modeById(id).clock === true;
}

function heroNumber(value, fallback) {
    const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Подпись над героем: своя, иначе стандартная из реестра, иначе `null`.
 *
 * Потолок длины — общий `DisplayLayouts.MAX_CAPTION`, а не своё число: подпись
 * стоит в той же колонке, ширину которой считают раскладки дисплея.
 */
function heroCaption(id, custom) {
    const mode = modeById(id);
    if (!mode.caption) { return null; }
    if (typeof custom !== 'string') { return mode.caption; }
    const clean = custom.replace(/\s+/g, ' ').trim().slice(0, HeroLayouts.MAX_CAPTION);
    return clean || mode.caption;
}

/**
 * Число, которое показывает герой.
 *
 * Режим `current` отдаёт СЕКУНДЫ С НАЧАЛА СУТОК: общий formatTime() превращает
 * 49207 в «13:40:07», и той же цифрой кормятся флип и «Цифры». Отдельного
 * форматирования часам не нужно.
 */
function heroSeconds(state) {
    const s = state || {};
    const mode = modeById(s.mode).id;
    const now = heroNumber(s.nowSeconds, 0);

    if (mode === 'current') {
        return Math.min(SECONDS_PER_DAY - 1, Math.max(0, Math.floor(now)));
    }
    if (mode === 'to-start') {
        return HeroShared.signedSecondsUntilClock(now, s.startClock);
    }
    if (mode === 'to-end') {
        return HeroShared.signedSecondsUntilClock(now, s.endClock);
    }
    return Math.floor(heroNumber(s.remainingSeconds, 0));
}

/**
 * Тотал, от которого считаются полосы срочности. Ноль означает «полос нет»
 * (кроме минуса, который красит сам timerColorBand).
 *
 * У «до конца» тотал есть и он осмыслен — длина мероприятия. У «до начала»
 * тотала нет: расстояние до старта не доля чего-либо. Мероприятие с концом не
 * позже начала (в том числе через полночь) тотала не имеет — отрицательная
 * доля выдала бы полосы задом наперёд.
 */
function heroTotal(state) {
    const s = state || {};
    const mode = modeById(s.mode).id;

    if (mode === 'timer') {
        const total = heroNumber(s.totalSeconds, 0);
        return total > 0 ? total : 0;
    }
    if (mode === 'to-end') {
        const startMark = HeroShared.clockToSeconds(s.startClock);
        const endMark = HeroShared.clockToSeconds(s.endClock);
        if (startMark === null || endMark === null) { return 0; }
        const span = endMark - startMark;
        return span > 0 ? span : 0;
    }
    return 0;
}

const HeroModes = {
    HERO_MODES,
    HERO_MODE_IDS,
    HERO_LABEL_KEYS,
    DEFAULT_MODE,
    modeById,
    isClockMode,
    heroCaption,
    heroSeconds,
    heroTotal
};

// Node.js (тесты)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeroModes;
}

// Браузер (дисплей, панель)
if (typeof window !== 'undefined') {
    window.HeroModes = HeroModes;
}
