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
