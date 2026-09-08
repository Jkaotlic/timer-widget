'use strict';

/**
 * Реестр режимов центрального времени и его арифметика.
 *
 * Проверяется здесь, а не в e2e, ровно то, что e2e увидеть не может: границы
 * суток, прошедшая отметка, мероприятие с концом раньше начала. В окне такие
 * случаи воспроизводятся часами, а тут — числом.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const HeroModes = require('../hero-modes');
const DL = require('../display-layouts');

test('в реестре ровно четыре режима и первый — таймер', () => {
    assert.deepEqual(HeroModes.HERO_MODE_IDS, ['timer', 'current', 'to-start', 'to-end']);
    assert.equal(HeroModes.DEFAULT_MODE, 'timer');
});

test('у режима таймера подписи НЕТ, у остальных трёх — есть', () => {
    // null здесь не «нет подписи», а «подпись принадлежит другому владельцу»
    // (updateChipState отчитывается о состоянии таймера).
    assert.equal(HeroModes.heroCaption('timer'), null);
    assert.equal(HeroModes.heroCaption('current'), 'Текущее время');
    assert.equal(HeroModes.heroCaption('to-start'), 'До начала мероприятия');
    assert.equal(HeroModes.heroCaption('to-end'), 'До конца мероприятия');
});

test('своя подпись побеждает, пустая возвращает стандартную', () => {
    assert.equal(HeroModes.heroCaption('to-end', 'Финиш'), 'Финиш');
    assert.equal(HeroModes.heroCaption('to-end', '   '), 'До конца мероприятия');
    assert.equal(HeroModes.heroCaption('to-end', ''), 'До конца мероприятия');
});

test('своя подпись обрезается общим потолком, а не своей копией числа', () => {
    const long = 'я'.repeat(DL.MAX_CAPTION + 20);
    assert.equal(HeroModes.heroCaption('current', long).length, DL.MAX_CAPTION);
});

test('своя подпись режиму таймера не помогает: владелец другой', () => {
    assert.equal(HeroModes.heroCaption('timer', 'Моё слово'), null);
});

test('modeById на мусоре даёт режим таймера', () => {
    for (const junk of [undefined, null, '', 'to-mars', 42, {}]) {
        assert.equal(HeroModes.modeById(junk).id, 'timer');
    }
});

test('heroSeconds: таймер отдаёт остаток как есть, включая минус', () => {
    const at = (remainingSeconds) => HeroModes.heroSeconds({
        mode: 'timer', nowSeconds: 0, startClock: '10:00', endClock: '12:00', remainingSeconds
    });
    assert.equal(at(245), 245);
    assert.equal(at(-17), -17);
    assert.equal(at(12.7), 12);
    assert.equal(at(undefined), 0);
});

test('heroSeconds: текущее время — секунды с начала суток', () => {
    // 13:40:07 — это 49207 секунд, и общий formatTime() даст из них «13:40:07».
    const secs = HeroModes.heroSeconds({
        mode: 'current', nowSeconds: 13 * 3600 + 40 * 60 + 7, remainingSeconds: -999
    });
    assert.equal(secs, 49207);
});

test('heroSeconds: текущее время не выходит за сутки', () => {
    assert.equal(HeroModes.heroSeconds({ mode: 'current', nowSeconds: -5 }), 0);
    assert.equal(HeroModes.heroSeconds({ mode: 'current', nowSeconds: 999999 }), 86399);
});

test('heroSeconds: до начала и до конца считаются по часам, а не по таймеру', () => {
    const base = { nowSeconds: 14 * 3600, startClock: '10:00', endClock: '16:00', remainingSeconds: 300 };
    assert.equal(HeroModes.heroSeconds({ ...base, mode: 'to-start' }), -4 * 3600);
    assert.equal(HeroModes.heroSeconds({ ...base, mode: 'to-end' }), 2 * 3600);
});

test('heroTotal: у таймера тотал таймера, у текущего времени и до начала — ноль', () => {
    const base = { totalSeconds: 600, startClock: '10:00', endClock: '16:00' };
    assert.equal(HeroModes.heroTotal({ ...base, mode: 'timer' }), 600);
    assert.equal(HeroModes.heroTotal({ ...base, mode: 'current' }), 0);
    // Ноль — это не «полос нет» отдельным правилом: timerColorBand при
    // total <= 0 сам отдаёт normal, а при отрицательных секундах — overtime.
    // Значит «только минус» и «нет полос» — один и тот же вход.
    assert.equal(HeroModes.heroTotal({ ...base, mode: 'to-start' }), 0);
});

test('heroTotal: у «до конца» тотал — длина мероприятия', () => {
    assert.equal(HeroModes.heroTotal({
        mode: 'to-end', totalSeconds: 600, startClock: '10:00', endClock: '16:00'
    }), 6 * 3600);
});

test('heroTotal: конец не позже начала даёт ноль, а не отрицательный тотал', () => {
    for (const [start, end] of [['16:00', '10:00'], ['10:00', '10:00'], ['мусор', '10:00']]) {
        assert.equal(HeroModes.heroTotal({
            mode: 'to-end', totalSeconds: 600, startClock: start, endClock: end
        }), 0);
    }
});

test('у каждого режима, кроме таймера, есть свой ключ подписи', () => {
    // Против ОЖИДАЕМЫХ ИМЁН, а не против того же `filter().map()`, которым
    // HERO_LABEL_KEYS и определяется в модуле: такое сравнение не может
    // провалиться ни при каком содержимом реестра — оно сравнивает выражение с
    // самим собой. Имена несущие: под ними ключи лежат в settings-schema.js, в
    // payload панели и в id полей разметки, и переименование одного из них
    // обязано уронить тест здесь, а не молча разорвать проводку.
    assert.deepEqual(HeroModes.HERO_LABEL_KEYS,
        ['labelHeroCurrent', 'labelHeroToStart', 'labelHeroToEnd']);
    assert.equal(HeroModes.HERO_MODES.filter((m) => m.labelKey).length, 3,
        'ключей подписи не три — реестр и HERO_LABEL_KEYS разошлись');
    assert.equal(HeroModes.modeById('timer').labelKey, null,
        'у режима таймера завёлся ключ подписи — владелец подписи там другой');
});

test('часы — единственный режим, у которого число это ПОКАЗАНИЯ, а не длительность', () => {
    // Признак живёт в реестре, потому что от него зависит написание: часам
    // положен formatTime (всегда ЧЧ:ММ:СС), длительности — formatTimeShort.
    // Спутать их значит показать залу «30:15» в 00:30:15.
    assert.equal(HeroModes.isClockMode('current'), true);
    for (const id of ['timer', 'to-start', 'to-end']) {
        assert.equal(HeroModes.isClockMode(id), false, `режим ${id} объявлен часами`);
    }
    // Мусор ведёт себя как режим по умолчанию, а не как часы.
    for (const junk of [undefined, null, '', 'to-mars', 42, {}]) {
        assert.equal(HeroModes.isClockMode(junk), false);
    }
});
