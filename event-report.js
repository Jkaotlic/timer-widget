'use strict';

/**
 * event-report.js — отчёт о перелимите мероприятия в CSV.
 *
 * Модуль ЧИСТЫЙ: ни Electron, ни файловой системы, ни диалогов. На вход —
 * журнал докладов и настройки денег, на выход — текст. Поэтому он проверяется
 * целиком в `node --test`, а запись файла остаётся заботой главного процесса.
 *
 * Два правила, ради которых модуль вообще существует отдельно:
 *
 * 1. ИТОГ берётся из накопителя, а не складывается из строк. Эти величины
 *    законно расходятся: после миграции старого файла (итог есть, разбивки
 *    нет) и при обрезке журнала по потолку. Итог — то, за что человек
 *    отвечает деньгами перед залом, и он обязан быть верным даже там, где
 *    разбивка неполна. Когда суммы расходятся, отчёт ГОВОРИТ об этом строкой,
 *    а не молчит.
 *
 * 2. СТОИМОСТЬ считает money-meter.js — от секунд, а не сложением цен строк.
 *    Два доклада по 2 секунды при ставке «1000 за 60» стоят 1000, а не 2000.
 *    Второй копии прейскуранта здесь нет намеренно.
 */

const MoneyLib = (typeof window !== 'undefined' && window.MoneyMeter)
    ? window.MoneyMeter
    : require('./money-meter.js');

const TimeLib = (typeof window !== 'undefined' && window.TimeUtils)
    ? window.TimeUtils
    : require('./utils.js');

/**
 * Разделитель — точка с запятой.
 *
 * Excel в русской локали делит строку по ней; запятая оставила бы весь отчёт
 * в одном столбце, и человек увидел бы кашу вместо таблицы.
 */
const DELIMITER = ';';

/**
 * Перевод строки — CRLF, и метка порядка байтов в начале файла.
 *
 * Без BOM Excel читает UTF-8 как однобайтовую кодировку, и кириллица
 * превращается в мусор — файл открывается, но читать его нельзя. Обе величины
 * здесь не про красоту, а про то, откроется ли отчёт у человека.
 */
const EOL = '\r\n';
const BOM = '﻿';

/** Ячейка по RFC 4180: кавычки удваиваются, опасное поле берётся в кавычки. */
function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    if (!/[";\r\n]/.test(text)) { return text; }
    return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(cells) {
    return cells.map(csvCell).join(DELIMITER);
}

/** Дата в том виде, в каком её пишут в документах: 09.09.2026. */
function formatDate(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${date.getFullYear()}`;
}

/** Время окончания доклада: часы и минуты, как их читают в зале. */
function formatClock(date) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

/** Записи журнала, пригодные к печати. Ноль — законный: доклад уложился в срок. */
function safeTalks(raw) {
    if (!Array.isArray(raw)) { return []; }
    return raw.filter((talk) => {
        if (!talk) { return false; }
        const seconds = Number(talk.overrunSeconds);
        return Number.isFinite(seconds) && seconds >= 0
            && typeof talk.endedAt === 'string' && !Number.isNaN(Date.parse(talk.endedAt));
    });
}

/**
 * Собрать отчёт.
 *
 * @param {object} input
 * @param {Array}  input.talks — журнал докладов (недоверенный: пришёл с диска)
 * @param {number} input.overrunSeconds — ИТОГ мероприятия
 * @param {boolean} input.finished — итог заморожен
 * @param {string} input.title — название мероприятия
 * @param {number} input.price — ставка, ₽
 * @param {number} input.period — за сколько секунд ставка
 * @param {Date}   input.now — «сейчас», для даты при пустом журнале
 * @param {boolean} [input.onlyOverruns] — печатать только доклады с перелимитом
 * @returns {{csv: string, rows: number, totalSeconds: number, totalCost: number, partial: boolean}}
 */
function buildReportCSV(input) {
    const data = input || {};
    const talks = safeTalks(data.talks);
    const now = data.now instanceof Date && !Number.isNaN(data.now.getTime())
        ? data.now
        : new Date();

    const rawTotal = Number(data.overrunSeconds);
    const totalSeconds = Number.isFinite(rawTotal) && rawTotal > 0 ? Math.floor(rawTotal) : 0;
    const price = Number(data.price);
    const period = Number(data.period);
    const totalCost = MoneyLib.overrunCost(totalSeconds, price, period);

    // Колонка денег появляется, только когда есть прейскурант. Перелимит
    // существует и без него: время вышло независимо от того, берут ли за это
    // деньги, — а колонка нулей заставляет читателя искать в ней смысл.
    const withMoney = MoneyLib.overrunCost(totalSeconds, price, period) > 0
        || (Number.isFinite(price) && price > 0);

    // Расхождение с итогом считается по ВСЕМУ журналу, а не по напечатанным
    // строкам: скрытые фильтром нули на сумму секунд не влияют, и тревога о
    // «неполной разбивке» из-за фильтра была бы ложной.
    const sumOfRows = talks.reduce((acc, talk) => acc + Math.floor(Number(talk.overrunSeconds)), 0);
    const partial = sumOfRows !== totalSeconds;
    const onlyOverruns = data.onlyOverruns === true;
    const printed = onlyOverruns
        ? talks.filter((talk) => Math.floor(Number(talk.overrunSeconds)) > 0)
        : talks;

    // Дата мероприятия — из ПЕРВОЙ записи: отдельного «начала мероприятия» в
    // приложении нет, а первый закрытый доклад точно случился. Пустой журнал
    // (старый файл после миграции) даёт сегодняшнюю дату, и это честно, потому
    // что рядом стоит оговорка о неполной разбивке.
    const eventDate = talks.length > 0 ? new Date(talks[0].endedAt) : now;

    const lines = [];
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    // Строка без значения — мусор в отчёте: пустое название не печатается вовсе.
    if (title) { lines.push(csvRow(['Мероприятие', title])); }
    lines.push(csvRow(['Дата', formatDate(eventDate)]));
    if (data.finished) { lines.push(csvRow(['Состояние', 'Завершено'])); }
    // Отфильтрованный отчёт обязан это СКАЗАТЬ: иначе три строки из пяти
    // читаются как полный список докладов.
    if (onlyOverruns) { lines.push(csvRow(['Показаны', 'только доклады с перелимитом'])); }
    lines.push('');

    const header = withMoney
        ? ['№', 'Окончание', 'Перелимит', 'Стоимость']
        : ['№', 'Окончание', 'Перелимит'];
    lines.push(csvRow(header));

    // Номер строки — место доклада в мероприятии, фильтр его не меняет:
    // «2, 5, 7» честно говорит, что между ними были уложившиеся доклады.
    for (const talk of printed) {
        const seconds = Math.floor(Number(talk.overrunSeconds));
        const cells = [
            talk.n,
            formatClock(new Date(talk.endedAt)),
            TimeLib.formatTime(seconds)
        ];
        if (withMoney) {
            cells.push(MoneyLib.formatMoney(MoneyLib.overrunCost(seconds, price, period)));
        }
        lines.push(csvRow(cells));
    }

    lines.push('');
    const totalCells = withMoney
        ? ['Итого', '', TimeLib.formatTime(totalSeconds), MoneyLib.formatMoney(totalCost)]
        : ['Итого', '', TimeLib.formatTime(totalSeconds)];
    lines.push(csvRow(totalCells));

    if (partial) {
        // Расхождение НАЗЫВАЕТСЯ. Молча показать итог, не сходящийся со
        // строками, — значит заставить человека считать вручную и не понять,
        // кто из двух чисел врёт. Не врёт итог: он накапливался независимо.
        lines.push(csvRow([
            'Примечание',
            'разбивка неполна: часть докладов закрыта до того, как журнал начал вестись, '
            + 'либо журнал обрезан по длине. Итог верен.'
        ]));
    }

    return {
        csv: BOM + lines.join(EOL) + EOL,
        rows: printed.length,
        totalSeconds,
        totalCost,
        partial
    };
}

const EventReport = { buildReportCSV, csvCell, DELIMITER, EOL, BOM };

// Node.js (тесты, главный процесс)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventReport;
}

// Браузер (панель — на случай предпросмотра)
if (typeof window !== 'undefined') {
    window.EventReport = EventReport;
}
