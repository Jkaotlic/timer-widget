'use strict';

/**
 * Выбор размеров окна для e2e — арифметика, от которой зависит, ЧТО именно
 * проверяют две спеки дисплея.
 *
 * Почему это тестируется в Node, а не «увидим на прогоне»: ошибка здесь не
 * красит тест в красный, она делает его ХОЛОСТЫМ. Пустой список означает
 * «проверка не выполнена», список из недостижимых размеров — «проверка соврала
 * о том, что мерила». Оба случая на зелёном прогоне выглядят одинаково.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { pickWindowSizes } = require('../e2e/window-sizes.js');

const PREFERRED = [{ w: 1920, h: 1080 }, { w: 1600, h: 900 }, { w: 1280, h: 720 }, { w: 1100, h: 620 }];

test('на большом мониторе берутся ЖЕЛАЕМЫЕ размеры, ничего не выдумывается', () => {
    const sizes = pickWindowSizes({ width: 3440, height: 1410 }, PREFERRED);
    assert.deepEqual(sizes, PREFERRED);
});

test('размер больше экрана в список не попадает', () => {
    // Раннер Linux: 1280×1024. Помещается только 1100×620.
    const sizes = pickWindowSizes({ width: 1280, height: 1024 }, PREFERRED);
    for (const s of sizes) {
        assert.ok(s.w <= 1280 - 80 && s.h <= 1024 - 80, `${s.w}×${s.h} не помещается в рабочую область`);
    }
    assert.ok(sizes.some((s) => s.w === 1100 && s.h === 620), 'помещающийся размер потерялся');
});

test('когда помещается меньше двух, размеры ВЫВОДЯТСЯ из рабочей области', () => {
    // Раннер Windows: 1024×720 — не помещается ни один из желаемых.
    const sizes = pickWindowSizes({ width: 1024, height: 720 }, PREFERRED);
    assert.ok(sizes.length >= 1, 'на маленьком экране проверять стало нечего');
    for (const s of sizes) {
        assert.ok(s.w <= 944 && s.h <= 640, `${s.w}×${s.h} больше рабочей области`);
        assert.ok(s.w >= 800 && s.h >= 560, `${s.w}×${s.h} ниже пола: мерить там нечего`);
    }
});

test('ниже пола размеры не выводятся вовсе', () => {
    const sizes = pickWindowSizes({ width: 700, height: 500 }, PREFERRED);
    assert.deepEqual(sizes, [], 'на экране, где не помещается даже пол, список обязан быть пустым');
});

test('выведенный размер не дублирует уже помещающийся', () => {
    const sizes = pickWindowSizes({ width: 1180, height: 700 }, [{ w: 1100, h: 620 }]);
    const seen = new Set(sizes.map((s) => `${s.w}×${s.h}`));
    assert.equal(seen.size, sizes.length, `в списке есть повтор: ${JSON.stringify(sizes)}`);
});

test('мусор вместо рабочей области даёт пустой список, а не исключение', () => {
    assert.deepEqual(pickWindowSizes(null, PREFERRED), []);
    assert.deepEqual(pickWindowSizes({ width: NaN, height: 900 }, PREFERRED), []);
});
