'use strict';

/**
 * Тесты арифметики визуальной сверки. Работают на синтетических RGBA-буферах,
 * поэтому не требуют ни Electron, ни реальных PNG.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { diffBitmaps, isRegression, isTimeDependent } = require('../visual-diff');

// Буфер из n одинаковых пикселей RGBA.
const solid = (n, [r, g, b, a = 255]) => {
    const buf = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) { buf.set([r, g, b, a], i * 4); }
    return buf;
};

test('одинаковые растры дают нулевое расхождение', () => {
    const a = solid(100, [10, 20, 30]);
    const b = solid(100, [10, 20, 30]);
    const r = diffBitmaps(a, b);
    assert.equal(r.equalSize, true);
    assert.equal(r.diffPixels, 0);
    assert.equal(r.ratio, 0);
    assert.equal(isRegression(r), false);
});

test('шум антиалиасинга в пределах допуска не считается расхождением', () => {
    // Расхождение на 5 из 255 по каналу — ниже порога в 8.
    const a = solid(100, [100, 100, 100]);
    const b = solid(100, [105, 95, 103]);
    const r = diffBitmaps(a, b);
    assert.equal(r.diffPixels, 0);
    assert.equal(isRegression(r), false);
});

test('смысловая смена цвета ловится (жёлтый → красный)', () => {
    // Именно этот случай прожил в проекте незамеченным: 00:00 показывался жёлтым.
    const yellow = solid(1000, [255, 193, 7]);
    const red = solid(1000, [255, 69, 58]);
    const r = diffBitmaps(yellow, red);
    assert.equal(r.diffPixels, 1000);
    assert.equal(r.ratio, 1);
    assert.equal(isRegression(r), true);
});

test('единичные пиксели ниже порога доли не валят сверку', () => {
    const a = solid(10000, [0, 0, 0]);
    const b = solid(10000, [0, 0, 0]);
    b.set([255, 255, 255, 255], 0); // ровно 1 пиксель из 10000 = 0.01%
    const r = diffBitmaps(a, b);
    assert.equal(r.diffPixels, 1);
    assert.equal(isRegression(r), false, '0.01% ниже порога 0.1%');
});

test('порог доли можно ужесточить', () => {
    const a = solid(10000, [0, 0, 0]);
    const b = solid(10000, [0, 0, 0]);
    b.set([255, 255, 255, 255], 0);
    const r = diffBitmaps(a, b);
    assert.equal(isRegression(r, { maxDiffRatio: 0 }), true);
});

test('разный размер растров — это регрессия сама по себе', () => {
    const r = diffBitmaps(solid(100, [0, 0, 0]), solid(200, [0, 0, 0]));
    assert.equal(r.equalSize, false);
    assert.equal(isRegression(r), true);
});

test('пустой или отсутствующий растр не роняет и считается регрессией', () => {
    for (const bad of [null, undefined, Buffer.alloc(0)]) {
        const r = diffBitmaps(bad, solid(10, [0, 0, 0]));
        assert.equal(r.equalSize, false);
        assert.equal(isRegression(r), true);
    }
});

test('альфа-канал тоже участвует в сравнении', () => {
    // Прозрачные окна: потеря прозрачности не должна проходить незамеченной.
    const a = solid(100, [255, 255, 255, 255]);
    const b = solid(100, [255, 255, 255, 0]);
    assert.equal(diffBitmaps(a, b).diffPixels, 100);
});

test('снимки часов исключены из сверки — они показывают реальное время', () => {
    assert.equal(isTimeDependent('clock-idle.png'), true);
    assert.equal(isTimeDependent('clock-maxsize.png'), true);
    assert.equal(isTimeDependent('widget-idle.png'), false);
    assert.equal(isTimeDependent('display-overtime.png'), false);
    assert.equal(isTimeDependent(''), false);
    assert.equal(isTimeDependent(undefined), false);

    // display-blocks-* показывают info-блок «Текущее время» — тоже живые часы.
    // Снимок с живым временем, не попавший в исключения, роняет visual:check
    // навсегда: регрессией начинает считаться сама секунда.
    assert.equal(isTimeDependent('display-blocks-circle.png'), true);
    assert.equal(isTimeDependent('display-blocks-analog.png'), true);
});
