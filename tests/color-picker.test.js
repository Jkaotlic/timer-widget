'use strict';

/**
 * PANEL-007 (аудит 27.10.2026): у серого и чёрного оттенка нет, и пипетка его
 * теряла.
 *
 * Ползунок оттенка зовёт onChange(hex) → updateColors → renderSurfaceControls →
 * picker.setColor(hex). hexToHsv для s = 0 или v = 0 возвращает h = 0, поэтому
 * после КАЖДОГО движения ползунка на сером фоне ручка прыгала на красный, а
 * следующий выбор насыщенности давал красный вместо выбранного оттенка. Так же
 * при перетаскивании в чёрный угол сбрасывалась насыщенность.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ColorUtils = require('../color-utils.js');

function picker(h, s, v) {
    const prevWindow = global.window;
    global.window = { ColorUtils };
    const { ColorPicker } = require('../color-picker.js');
    const p = Object.create(ColorPicker.prototype);
    Object.assign(p, { h, s, v, panel: { classList: { contains: () => false } } });
    p.updatePreview = () => {};
    return { p, ColorPicker, restore: () => { global.window = prevWindow; } };
}

test('PANEL-007: свой же цвет, вернувшийся из панели, не сбивает оттенок серого', () => {
    const { p, ColorPicker, restore } = picker(200, 0, 0.5);
    try {
        p.setColor(ColorPicker.hsvToHex(p.h, p.s, p.v));
        assert.equal(p.h, 200, 'оттенок прыгнул на красный');
        assert.equal(p.s, 0);
    } finally { restore(); }
});

test('PANEL-007: в чёрном углу сохраняются и оттенок, и насыщенность', () => {
    const { p, ColorPicker, restore } = picker(120, 0.8, 0);
    try {
        p.setColor(ColorPicker.hsvToHex(p.h, p.s, p.v));
        assert.equal(p.h, 120, 'оттенок потерян на чёрном');
        assert.equal(p.s, 0.8, 'насыщенность потеряна на чёрном');
    } finally { restore(); }
});

test('PANEL-007: ЧУЖОЙ серый цвет оставляет текущий оттенок, цветной — ставит свой', () => {
    const { p, restore } = picker(200, 1, 1);
    try {
        p.setColor('#808080');
        assert.equal(p.h, 200, 'серый из профиля сбросил оттенок пипетки');
        assert.equal(p.s, 0);
        p.setColor('#00ff00');
        assert.equal(Math.round(p.h), 120, 'цветной hex обязан ставить свой оттенок');
        assert.equal(p.s, 1);
    } finally { restore(); }
});
