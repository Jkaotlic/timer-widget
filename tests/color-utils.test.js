const test = require('node:test');
const assert = require('node:assert/strict');
const { hsvToRgb, rgbToHex, hsvToHex, hexToRgb, hexToHsv } = require('../color-utils');

test('hsvToRgb: known conversions', () => {
    assert.deepEqual(hsvToRgb(0, 1, 1), [255, 0, 0]);       // red
    assert.deepEqual(hsvToRgb(120, 1, 1), [0, 255, 0]);     // green
    assert.deepEqual(hsvToRgb(240, 1, 1), [0, 0, 255]);     // blue
    assert.deepEqual(hsvToRgb(0, 0, 1), [255, 255, 255]);   // white
    assert.deepEqual(hsvToRgb(0, 0, 0), [0, 0, 0]);         // black
});

test('rgbToHex: pads and lowercases', () => {
    assert.equal(rgbToHex(255, 0, 0), '#ff0000');
    assert.equal(rgbToHex(0, 255, 0), '#00ff00');
    assert.equal(rgbToHex(0, 0, 255), '#0000ff');
    assert.equal(rgbToHex(0, 0, 0), '#000000');
    assert.equal(rgbToHex(255, 255, 255), '#ffffff');
    assert.equal(rgbToHex(10, 5, 1), '#0a0501'); // single-digit padding
});

test('hsvToHex: composed conversion', () => {
    assert.equal(hsvToHex(0, 1, 1), '#ff0000');
    assert.equal(hsvToHex(120, 1, 1), '#00ff00');
    assert.equal(hsvToHex(240, 1, 1), '#0000ff');
    assert.equal(hsvToHex(0, 0, 0), '#000000');
});

test('hexToRgb: parses two-digit components', () => {
    assert.deepEqual(hexToRgb('#ff0000'), [255, 0, 0]);
    assert.deepEqual(hexToRgb('#00ff00'), [0, 255, 0]);
    assert.deepEqual(hexToRgb('#0000ff'), [0, 0, 255]);
    assert.deepEqual(hexToRgb('#0a0501'), [10, 5, 1]);
    assert.deepEqual(hexToRgb('#ffffff'), [255, 255, 255]);
});

test('hexToHsv: known conversions', () => {
    // #ff0000 → hue 0, sat 1, val 1
    let [h, s, v] = hexToHsv('#ff0000');
    assert.equal(h, 0);
    assert.equal(s, 1);
    assert.equal(v, 1);

    // #00ff00 → hue 120
    [h, s, v] = hexToHsv('#00ff00');
    assert.equal(h, 120);
    assert.equal(s, 1);
    assert.equal(v, 1);

    // #0000ff → hue 240
    [h, s, v] = hexToHsv('#0000ff');
    assert.equal(h, 240);
    assert.equal(s, 1);
    assert.equal(v, 1);
});

test('hexToHsv: grayscale has zero saturation', () => {
    const [h, s, v] = hexToHsv('#808080');
    assert.equal(h, 0);   // d === 0 → hue stays 0
    assert.equal(s, 0);   // max - min === 0 → saturation 0
    assert.ok(Math.abs(v - 128 / 255) < 1e-9);
});

test('hexToHsv: black has zero everything', () => {
    const [h, s, v] = hexToHsv('#000000');
    assert.equal(h, 0);
    assert.equal(s, 0); // max === 0 → s = 0 branch
    assert.equal(v, 0);
});

test('round-trip hex → hsv → hex preserves saturated colors', () => {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#ffff00', '#00ffff', '#ff00ff'];
    for (const hex of colors) {
        const [h, s, v] = hexToHsv(hex);
        assert.equal(hsvToHex(h, s, v), hex, `round-trip failed for ${hex}`);
    }
});

test('round-trip hex → rgb → hex', () => {
    const colors = ['#123456', '#abcdef', '#0a0b0c', '#fedcba'];
    for (const hex of colors) {
        const [r, g, b] = hexToRgb(hex);
        assert.equal(rgbToHex(r, g, b), hex, `round-trip failed for ${hex}`);
    }
});
