'use strict';

/**
 * Арифметика денег за перелимит доклада (скрытый режим «47-й этаж»).
 *
 * Почему это отдельный модуль с отдельным тестом: числа отсюда объявляют
 * залу. Ошибка в ступени или в порядке операций не видна ни на глаз, ни в
 * e2e — она видна только на границах периода, а их надо перебрать.
 *
 * Главное решение, которое здесь закреплено: секунды складываются ДО
 * перевода в цену. Два доклада по 2 секунды перелимита при ставке 1000/3
 * стоят 1000 ₽ (четыре секунды — один полный период), а не 0 ₽, хотя на
 * экране в момент каждого доклада горело по нулю. Итог — цена ОБЩЕГО
 * перелимита, а не сумма показанных цен.
 */

const test = require('node:test');
const assert = require('node:assert');

const Money = require('../money-meter');

test('перелимит: минус даёт секунды, плюс и ноль — не дают', () => {
    assert.equal(Money.overrunSeconds(-5), 5);
    assert.equal(Money.overrunSeconds(-0.4), 0, 'дробная секунда минуса ещё не секунда');
    assert.equal(Money.overrunSeconds(0), 0);
    assert.equal(Money.overrunSeconds(120), 0);
});

test('ступень дискретная: цена меняется на ПОЛНОМ периоде', () => {
    const price = 1000;
    const period = 3;
    const table = [
        [0, 0], [1, 0], [2, 0],
        [3, 1000], [4, 1000], [5, 1000],
        [6, 2000], [9, 3000], [59, 19000]
    ];
    for (const [seconds, expected] of table) {
        assert.equal(Money.overrunCost(seconds, price, period), expected,
            `${seconds} с при 1000/3 должны стоить ${expected} ₽`);
    }
});

test('секунды складываются ДО перевода в цену', () => {
    // Два доклада по 2 секунды: на экране каждый показывал 0 ₽,
    // но вместе это 4 секунды — один полный период.
    const afterFirst = Money.totalSeconds(0, -2);
    assert.equal(afterFirst, 2);
    const afterSecond = Money.totalSeconds(afterFirst, -2);
    assert.equal(afterSecond, 4);
    assert.equal(Money.totalCost(afterFirst, -2, 1000, 3), 1000,
        'сумма секунд перешла период — итог обязан это увидеть');
});

test('закрытие доклада идемпотентно: таймер вне минуса ничего не добавляет', () => {
    const accumulated = 7;
    assert.equal(Money.totalSeconds(accumulated, 0), accumulated);
    assert.equal(Money.totalSeconds(accumulated, 300), accumulated);
});

test('мусор на входе не роняет и не делит на ноль', () => {
    assert.equal(Money.overrunCost(10, 1000, 0), 0, 'период 0 — считать нечем');
    assert.equal(Money.overrunCost(10, 1000, -3), 0);
    assert.equal(Money.overrunCost(10, 1000, NaN), 0);
    assert.equal(Money.overrunCost(10, NaN, 3), 0);
    assert.equal(Money.overrunCost(Infinity, 1000, 3), 0);
    assert.equal(Money.overrunCost(-10, 1000, 3), 0);
    assert.equal(Money.totalSeconds(-5, -5), 5, 'отрицательный накопитель — это мусор, не долг');
});

test('ставка приходит из таблицы настроек СТРОКОЙ и должна считаться', () => {
    // settings-schema знает только 'checkbox' и 'value'; поля ставки —
    // 'value', то есть в модуль они попадают как '1000' и '3'.
    assert.equal(Money.overrunCost('7', '1000', '3'), 2000);
    assert.equal(Money.overrunCost(7, ' 1000 ', ' 3 '), 2000);
});

test('формат: целые рубли, неразрывные пробелы, знак ₽', () => {
    // Пробел записан ЯВНО через \u00A0, а не набран в строке.
    //
    // Неразрывный он не для красоты: сумма стоит в карточке, по ширине
    // которой считаются раскладки и поджатие к краям экрана, и перенос
    // «1 000 ₽» по пробелу менял бы габарит блока. А набранный в строке он
    // неотличим от обычного на глаз — первая же версия этого теста ждала
    // обычный пробел и падала сообщением «'0 ₽' == '0 ₽'».
    const NB = '\u00A0';
    assert.equal(Money.formatMoney(0), `0${NB}₽`);
    assert.equal(Money.formatMoney(1000), `1${NB}000${NB}₽`);
    assert.equal(Money.formatMoney(1234567), `1${NB}234${NB}567${NB}₽`);
    assert.equal(Money.formatMoney(-5), `0${NB}₽`, 'отрицательных денег здесь не бывает');
    assert.equal(Money.formatMoney(NaN), `0${NB}₽`);

    // Обычных пробелов в сумме нет вовсе — иначе разряды переносились бы.
    assert.ok(!Money.formatMoney(1234567).includes('\u0020'),
        'в сумме появился обычный пробел — карточка сможет перенести разряды');
});

test('после «Нового мероприятия» текущий перелимит НЕ считается, пока таймер в минусе', () => {
    // Жалоба 27.08.2026: «нельзя скинуть итог». Накопитель обнулялся, но на
    // экране оставалась прежняя сумма: дисплей прибавляет к накопителю ТЕКУЩИЙ
    // перелимит, а таймер в этот момент всё ещё в минусе. Обнуление обязано
    // очистить и то, что видно.
    //
    // Отсюда «отсечка»: главный процесс запоминает, сколько секунд минуса уже
    // натикало в момент сброса, и эти секунды больше не считаются — ни в
    // «Перелимите», ни в «Итого».
    assert.equal(Money.liveOverrun(-30, 30), 0, 'сразу после сброса перелимита нет');
    assert.equal(Money.liveOverrun(-45, 30), 15, 'считается только то, что натикало ПОСЛЕ сброса');
    assert.equal(Money.liveOverrun(-30, 0), 30, 'без отсечки считается весь минус');
    assert.equal(Money.liveOverrun(60, 30), 0, 'в плюсе перелимита нет вовсе');
    // Отсечка больше самого минуса — такое бывает после сброса таймера; ноль,
    // а не отрицательные секунды.
    assert.equal(Money.liveOverrun(-10, 30), 0);
    assert.equal(Money.liveOverrun('-45', '30'), 15, 'значения приходят строкой');
    assert.equal(Money.liveOverrun(-45, NaN), 45, 'мусорная отсечка не отменяет счёт');
});

test('итог считает перелимит мероприятия с учётом отсечки', () => {
    // Накопитель 0 (только что сброшен), таймер в минусе на 30 с, отсечка 30 —
    // на экране обязан быть ноль, а не прежняя сумма.
    assert.equal(Money.totalSeconds(0, -30, 30), 0);
    assert.equal(Money.totalCost(0, -30, 1000, 3, 30), 0);
    // Ещё три секунды минуса ПОСЛЕ сброса — первая ступень.
    assert.equal(Money.totalCost(0, -33, 1000, 3, 30), 1000);
    // Без отсечки поведение прежнее — старые вызовы не ломаются.
    assert.equal(Money.totalSeconds(7, -2), 9);
    assert.equal(Money.totalCost(0, -30, 1000, 3), 10000);
});

// ── Сводка мероприятия: одна сборка на панель и на дисплей ────────────────

/**
 * `eventSummary` появилась 28.08.2026 по следу дефекта, которого не видел ни
 * один тест: дисплей ПРИНИМАЛ признак `finished` и нигде его не читал.
 *
 * «Завершить мероприятие» обещает «итог замрёт на текущей сумме». Главный
 * процесс своё обещание держал — складывал текущий минус в накопитель и
 * переставал начислять. А дисплей считал итог сам, по формуле «накопитель +
 * текущий минус», и потому:
 *
 *   1. ПРИБАВЛЯЛ те же секунды второй раз (они уже лежали в накопителе);
 *   2. продолжал РАСТИ, пока таймер оставался в минусе.
 *
 * Замер на ставке 1000 ₽ / 3 с, накопитель 15 с: в момент нажатия 8 000 ₽
 * вместо 5 000, через три секунды 9 000, дальше 15 000. Кнопка не делала
 * ничего видимого.
 *
 * Поэтому итог собирается ЗДЕСЬ и одинаково для обоих окон: панель берёт из
 * сводки строку, дисплей — цену. Второе место, знающее формулу итога, — это и
 * есть тот дефект.
 */
const summaryState = (patch) => Object.assign({
    overrunSeconds: 0,
    remainingSeconds: 0,
    excludedLiveSeconds: 0,
    finished: false,
    price: '1000',
    period: '3'
}, patch);

test('сводка идущего мероприятия растёт вместе с текущим минусом', () => {
    const running = (rem) => Money.eventSummary(summaryState({ overrunSeconds: 6, remainingSeconds: rem }));
    assert.equal(running(0).cost, 2000, '6 закрытых секунд — две ступени');
    assert.equal(running(-3).cost, 3000, 'три секунды текущего минуса — ещё ступень');
    assert.equal(running(-9).cost, 5000);
    assert.equal(running(0).finished, false);
});

test('ЗАВЕРШЁННОЕ мероприятие не растёт и не считает секунды дважды', () => {
    // Накопитель уже содержит секунды текущего минуса: их сложил главный
    // процесс в момент «Завершить». Сколько бы таймер ни просидел в минусе
    // дальше, итог обязан остаться прежним.
    const frozen = (rem) => Money.eventSummary(summaryState({
        overrunSeconds: 15, remainingSeconds: rem, finished: true
    }));
    assert.equal(frozen(-9).cost, 5000, 'в момент заморозки итог — цена накопителя, и только его');
    assert.equal(frozen(-12).cost, 5000, 'итог пополз через три секунды');
    assert.equal(frozen(-30).cost, 5000, 'итог пополз дальше');
    assert.equal(frozen(-30).seconds, 15, 'секунды итога тоже обязаны замереть');
    assert.equal(frozen(0).finished, true);
});

test('отсечка «Нового мероприятия» действует и в сводке', () => {
    // Обнулили посреди минуса: секунды, натикавшие до нажатия, к новому
    // мероприятию не относятся.
    const s = Money.eventSummary(summaryState({
        overrunSeconds: 0, remainingSeconds: -10, excludedLiveSeconds: 10
    }));
    assert.equal(s.cost, 0, 'новое мероприятие обязано начаться с нуля');
});

test('сводка отчитывается СЛОВОМ, и слово разное', () => {
    const running = Money.eventSummary(summaryState({ overrunSeconds: 6 }));
    const frozen = Money.eventSummary(summaryState({ overrunSeconds: 6, finished: true }));
    assert.ok(running.text.includes(running.money), 'в строке идущего нет самой суммы');
    assert.ok(frozen.text.includes(frozen.money), 'в строке завершённого нет самой суммы');
    assert.notEqual(running.text, frozen.text,
        'два состояния мероприятия названы одним словом — кнопка снова ничего не меняет');
    assert.match(frozen.text, /заморож/i, 'завершённое мероприятие не названо замороженным');
});

test('сводка терпит мусор на входе, как и вся остальная арифметика', () => {
    assert.equal(Money.eventSummary({}).cost, 0);
    assert.equal(Money.eventSummary({}).seconds, 0);
    assert.equal(Money.eventSummary(null).cost, 0, 'сводка без состояния роняла бы панель на старте');
    assert.equal(Money.eventSummary(summaryState({ overrunSeconds: 9, period: '0' })).cost, 0,
        'период 0 — это «считать нечем», а не деление на ноль');
});
