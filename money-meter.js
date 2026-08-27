'use strict';

/**
 * money-meter.js — деньги за перелимит доклада (скрытый режим «47-й этаж»).
 *
 * Ни Electron, ни DOM: сюда приходят числа, отсюда уходят числа и строка.
 * Модуль вынесен отдельно ровно потому, что его результат объявляют залу, а
 * проверить ступень глазами нельзя — только перебором границ периода.
 *
 * Два правила, которые здесь закреплены и которые легко нарушить:
 *
 * 1. СЕКУНДЫ СКЛАДЫВАЮТСЯ ДО ПЕРЕВОДА В ЦЕНУ. Итог — цена общего перелимита,
 *    а не сумма показанных цен. Иначе два доклада по 2 секунды при ставке
 *    1000/3 дадут 0 ₽ вместо 1000 ₽.
 * 2. СТАВКА ПРИХОДИТ СТРОКОЙ. Таблица настроек знает только 'checkbox' и
 *    'value', поэтому '1000' и '3' — нормальный вход, и приводить их к числу
 *    обязан этот модуль, а не каждый вызывающий по-своему.
 */

/** Число из чего угодно; всё, что не конечное число, становится fallback. */
function toNumber(value, fallback) {
    const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Сколько секунд таймер в минусе. Плюс и ноль перелимитом не являются.
 *
 * Округление ВНИЗ: 0.4 секунды минуса — ещё не секунда просрочки, и платить
 * за неё нельзя.
 */
function overrunSeconds(remainingSeconds) {
    const n = toNumber(remainingSeconds, 0);
    return n < 0 ? Math.floor(-n) : 0;
}

/** Неотрицательные целые секунды; мусор превращается в 0. */
function safeSeconds(value) {
    const n = toNumber(value, 0);
    return n > 0 ? Math.floor(n) : 0;
}

/**
 * Цена перелимита ступенями.
 *
 * Период ≤ 0 означает «считать нечем» и даёт 0 ₽, а не деление на ноль.
 */
function overrunCost(seconds, price, period) {
    const s = safeSeconds(seconds);
    const p = toNumber(price, 0);
    const per = Math.floor(toNumber(period, 0));
    if (per <= 0 || p <= 0 || s <= 0) { return 0; }
    return Math.floor(s / per) * p;
}

/**
 * Секунды перелимита ТЕКУЩЕГО доклада с учётом отсечки.
 *
 * Отсечка — сколько секунд минуса уже натикало к моменту «Нового мероприятия».
 * Без неё обнуление накопителя не очищало экран: жалоба 27.08.2026 «нельзя
 * скинуть итог» — сумма оставалась прежней, потому что дисплей прибавлял к
 * обнулённому накопителю текущий перелимит, а таймер всё ещё был в минусе.
 *
 * Отсечка больше самого минуса даёт 0, а не отрицательные секунды: так бывает
 * после сброса таймера, когда минус начался заново.
 */
function liveOverrun(remainingSeconds, excludedSeconds) {
    const live = overrunSeconds(remainingSeconds);
    const cut = safeSeconds(excludedSeconds);
    return live > cut ? live - cut : 0;
}

/**
 * Секунды перелимита всего мероприятия: накопленные закрытыми докладами плюс
 * текущий. Если таймер не в минусе, прибавляется 0 — поэтому повторный сброс
 * ничего не добавляет второй раз.
 */
function totalSeconds(accumulatedSeconds, remainingSeconds, excludedSeconds) {
    return safeSeconds(accumulatedSeconds) + liveOverrun(remainingSeconds, excludedSeconds);
}

/** Цена перелимита всего мероприятия. */
function totalCost(accumulatedSeconds, remainingSeconds, price, period, excludedSeconds) {
    return overrunCost(totalSeconds(accumulatedSeconds, remainingSeconds, excludedSeconds), price, period);
}

/**
 * Неразрывный пробел ЯВНОЙ escape-последовательностью, а не набранный.
 *
 * Набранный в строке он неотличим от обычного на глаз: первая версия теста
 * ждала обычный и падала сообщением «'0 ₽' == '0 ₽'», а ESLint ловит его
 * правилом no-irregular-whitespace. Одно объявление на оба места, где он нужен.
 */
const NBSP = '\u00A0';

/**
 * Рубли в строку: целые, разряды по три, неразрывные пробелы.
 *
 * Пробелы именно неразрывные: сумма стоит в карточке, ширину которой считают
 * раскладки, и перенос «1 000 ₽» по пробелу ломал бы габарит.
 */
function formatMoney(rubles) {
    const n = toNumber(rubles, 0);
    const whole = n > 0 ? Math.floor(n) : 0;
    const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return `${grouped}${NBSP}₽`;
}

const MoneyMeter = {
    overrunSeconds,
    liveOverrun,
    overrunCost,
    totalSeconds,
    totalCost,
    formatMoney
};

// Node.js (тесты, главный процесс)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MoneyMeter;
}

// Браузер (дисплей, панель)
if (typeof window !== 'undefined') {
    window.MoneyMeter = MoneyMeter;
}
