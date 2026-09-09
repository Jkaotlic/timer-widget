'use strict';

/**
 * Отчёт о перелимите мероприятия.
 *
 * Модуль чистый: ни Electron, ни файловой системы — только текст из чисел.
 * Поэтому проверяется целиком в `node --test`, а запись файла (диалог, права,
 * отмена) остаётся заботой главного процесса и своих тестов.
 *
 * Два правила, которые здесь легко нарушить и трудно заметить:
 *
 * 1. ИТОГ берётся из накопителя, а не складывается из строк. Эти величины
 *    законно расходятся после миграции старого файла (итог есть, записей нет)
 *    и при обрезке журнала. Итог — то, за что человек отвечает деньгами.
 * 2. СТОИМОСТЬ считается от секунд, а не сложением цен строк: два доклада по
 *    2 секунды при ставке «1000 за 60» стоят 1000, а не 2000. Это правило
 *    money-meter.js, и отчёт обязан ему следовать, а не заводить своё.
 */

const test = require('node:test');
const assert = require('node:assert');

const Report = require('../event-report.js');
const MoneyMeter = require('../money-meter.js');

const TALKS = [
    { n: 1, endedAt: '2026-09-09T11:32:10.000Z', overrunSeconds: 135 },
    { n: 2, endedAt: '2026-09-09T12:10:48.000Z', overrunSeconds: 330 }
];
const NOW = new Date('2026-09-10T09:00:00.000Z');

const build = (over) => Report.buildReportCSV(Object.assign({
    talks: TALKS, overrunSeconds: 465, finished: false,
    title: 'Открытие сезона', price: 1000, period: 60, now: NOW
}, over));

test('шапка несёт название мероприятия и дату ПЕРВОЙ записи', () => {
    // Отдельного «начала мероприятия» в приложении нет, а первый закрытый
    // доклад — событие, которое точно случилось.
    const out = build();
    assert.match(out.csv, /Мероприятие;Открытие сезона/);
    assert.match(out.csv, /Дата;09\.09\.2026/);
});

test('без записей дата берётся из now, и это названо', () => {
    const out = build({ talks: [], overrunSeconds: 461 });
    assert.equal(out.rows, 0);
    assert.match(out.csv, /Дата;10\.09\.2026/);
    assert.equal(out.partial, true);
});

test('итог берётся из накопителя, а не складывается из строк', () => {
    const out = build({ overrunSeconds: 900 });
    assert.equal(out.totalSeconds, 900);
    assert.equal(out.partial, true, 'расхождение обязано быть НАЗВАНО, а не спрятано');
    assert.match(out.csv, /разбивка неполна/i);
});

test('когда суммы сходятся, предупреждения нет', () => {
    // Иначе оговорка стоит в каждом отчёте и её перестают читать.
    const out = build();
    assert.equal(out.partial, false);
    assert.doesNotMatch(out.csv, /разбивка неполна/i);
});

test('строки нумеруются и несут время окончания, перелимит и стоимость', () => {
    const out = build();
    assert.equal(out.rows, 2);
    const lines = out.csv.split('\r\n');
    const row = lines.find((l) => l.startsWith('1;'));
    assert.ok(row, 'строка первого доклада обязана быть');
    assert.match(row, /00:02:15/, 'перелимит печатается временем, а не числом секунд');
});

test('перелимит длиннее часа печатается с часами', () => {
    const out = build({
        talks: [{ n: 1, endedAt: '2026-09-09T11:32:10.000Z', overrunSeconds: 3725 }],
        overrunSeconds: 3725
    });
    assert.match(out.csv, /01:02:05/);
});

test('стоимость считается от СЕКУНД, а не сложением цен строк', () => {
    // Ступень — 60 секунд, ставка 1000. Два доклада по 40 секунд по
    // отдельности не стоят НИЧЕГО (ступень не набрана), а вместе это 80
    // секунд, то есть одна полная ступень — 1000 ₽. Сложение цен строк дало
    // бы ноль, и мероприятие лишилось бы законной тысячи.
    const out = build({
        talks: [
            { n: 1, endedAt: '2026-09-09T11:00:00.000Z', overrunSeconds: 40 },
            { n: 2, endedAt: '2026-09-09T11:30:00.000Z', overrunSeconds: 40 }
        ],
        overrunSeconds: 80
    });
    assert.equal(out.totalCost, MoneyMeter.overrunCost(80, 1000, 60));
    assert.equal(out.totalCost, 1000);
    assert.notEqual(
        out.totalCost,
        MoneyMeter.overrunCost(40, 1000, 60) * 2,
        'сложение цен строк даёт 0 — ровно та ошибка, от которой money-meter защищает'
    );
});

test('поля экранируются по RFC 4180', () => {
    // Название мероприятия вводит человек, и точка с запятой в нём не экзотика.
    const out = build({ title: 'Секция "А"; вечер' });
    assert.match(out.csv, /"Секция ""А""; вечер"/);
});

test('файл открывается Excel: BOM и CRLF', () => {
    const out = build();
    assert.equal(out.csv.charCodeAt(0), 0xFEFF, 'без BOM Excel читает кириллицу как мусор');
    assert.match(out.csv, /\r\n/, 'Excel на Windows ждёт CRLF');
});

test('пустое название не оставляет пустой строки в шапке', () => {
    const out = build({ title: '' });
    assert.doesNotMatch(out.csv, /Мероприятие;\r\n/, 'строка без значения — мусор в отчёте');
});

test('нулевая ставка даёт отчёт о ВРЕМЕНИ, без колонки денег', () => {
    // Перелимит существует и без прейскуранта: время вышло независимо от того,
    // берут за это деньги или нет.
    const out = build({ price: 0 });
    assert.equal(out.totalCost, 0);
    assert.doesNotMatch(out.csv, /Стоимость/);
    assert.match(out.csv, /00:02:15/);
});

test('замороженное мероприятие названо в шапке', () => {
    const out = build({ finished: true });
    assert.match(out.csv, /Состояние;Завершено/);
});

test('мусор во входе не роняет сборку', () => {
    // Вход приходит из файла на диске — он недоверенный так же, как хранилище.
    const out = Report.buildReportCSV({
        talks: null, overrunSeconds: 'нет', title: null,
        price: 'x', period: 0, now: NOW
    });
    assert.equal(out.rows, 0);
    assert.equal(out.totalSeconds, 0);
    assert.equal(typeof out.csv, 'string');
});
