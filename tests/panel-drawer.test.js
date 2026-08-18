'use strict';

/**
 * Ширина колонки содержимого при открытии ящика настроек.
 *
 * Зачем считать её ЗАРАНЕЕ. Окно растёт мгновенно (это делает главный процесс),
 * а колонка под ящик резервируется переходом 240 мс. Пока колонка не встала,
 * панель центруется по тому, что есть, — и если «то, что есть» окажется не
 * финальным, она успевает уехать и вернуться. Пользователь описал это как
 * «бывает, что прыгает при открытии боковой панели».
 *
 * Прежняя версия прибивала колонку к ширине окна ДО роста, то есть исходила из
 * «окно вырастет ровно на ширину ящика». Это верно, пока экран позволяет.
 * Замер на раннере CI (экран 1024): окно просило 1096, получило 974 — колонка
 * оказалась на 122px шире правды, панель прыгнула вправо на 40px и вернулась.
 *
 * Предсказание повторяет арифметику главного процесса, и здесь она проверяется
 * ЧИСЛАМИ, а не прогоном: в e2e эта ветка воспроизводится только на экране,
 * который уже мал, — на широком мониторе ограничение не срабатывает вовсе.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawerColumnWidth } = require('../panel-drawer.js');

// Настоящие значения проекта: ящик 336, потолок с ящиком 1096, минимум окна 380,
// поле до края экрана 50 (`screenWidth - 50` в electron-main.js).
const BASE = { drawerWidth: 336, maxWindowWidth: 1096, minWindowWidth: 380, screenMargin: 50 };

test('на широком экране окно вырастает целиком — колонка равна прежней ширине', () => {
    // Ровно то, что происходит на мониторе автора: 760 + 336 = 1096, потолок
    // достигнут, экран не мешает. Колонка обязана остаться 760.
    assert.equal(drawerColumnWidth({ ...BASE, innerWidth: 760, availWidth: 3440 }), 760);
    assert.equal(drawerColumnWidth({ ...BASE, innerWidth: 600, availWidth: 3440 }), 600);
});

test('узкий экран режет рост окна — колонка узже прежней ширины', () => {
    // Случай раннера CI: экран 1024, значит окно не шире 974, колонка 974-336.
    assert.equal(drawerColumnWidth({ ...BASE, innerWidth: 760, availWidth: 1024 }), 638);
    // Совсем узкий экран: колонка упирается в минимум окна, а не уходит в ноль.
    assert.equal(drawerColumnWidth({ ...BASE, innerWidth: 760, availWidth: 700 }), 380);
});

test('потолок окна тоже ограничивает, и раньше экрана', () => {
    // 900 + 336 = 1236 > 1096: вырасти можно только до потолка, колонка 760.
    assert.equal(drawerColumnWidth({ ...BASE, innerWidth: 900, availWidth: 3440 }), 760);
});

test('колонка НИКОГДА не шире прежней ширины окна', () => {
    // Инвариант, ради которого пин и появился: шире — значит панель успеет
    // перецентроваться в лишнее место и вернуться.
    for (const inner of [380, 500, 640, 700, 760, 900, 1200]) {
        for (const avail of [700, 1024, 1440, 1920, 3440]) {
            const col = drawerColumnWidth({ ...BASE, innerWidth: inner, availWidth: avail });
            assert.ok(
                col <= Math.max(inner, BASE.minWindowWidth),
                `inner=${inner} avail=${avail}: колонка ${col} шире прежней ширины`
            );
        }
    }
});

test('без данных об экране считаем, что он не мешает — прежнее поведение', () => {
    // Отсутствие `screen.availWidth` не повод отдать мусор: возвращаемся к
    // допущению «окно вырастет целиком», а фактическую ширину всё равно
    // поправит syncColumn на событии resize.
    for (const junk of [undefined, null, 0, NaN, Infinity, 'широкий', -100]) {
        assert.equal(
            drawerColumnWidth({ ...BASE, innerWidth: 760, availWidth: junk }),
            760,
            `availWidth=${String(junk)}`
        );
    }
});

test('мусор вместо ширины окна не роняет и не даёт NaN', () => {
    for (const junk of [undefined, null, NaN, Infinity, 'нет', -5]) {
        const col = drawerColumnWidth({ ...BASE, innerWidth: junk, availWidth: 1024 });
        assert.ok(Number.isFinite(col), `innerWidth=${String(junk)} дал ${col}`);
        assert.ok(col >= BASE.minWindowWidth, `innerWidth=${String(junk)} дал ${col}`);
    }
});

test('значения по умолчанию совпадают с CONFIG проекта', () => {
    // Вторая копия чисел разошлась бы с первой молча: предсказание перестало бы
    // совпадать с тем, что делает главный процесс, и вернулся бы тот же прыжок.
    // constants.js экспортирует сам объект настроек, без обёртки .CONFIG.
    const CONFIG = require('../constants.js');
    const bare = drawerColumnWidth({ innerWidth: 760, availWidth: 1024, drawerWidth: 336 });
    assert.equal(bare, 638, 'умолчания потолка и минимума разошлись с CONFIG');
    assert.equal(
        drawerColumnWidth({ innerWidth: 900, availWidth: 3440, drawerWidth: 336 }),
        CONFIG.CONTROL_WINDOW_MAX_WIDTH_WITH_DRAWER - 336
    );
});
