const test = require('node:test');
const assert = require('node:assert/strict');
const {
    breakdown,
    flipCells,
    clampScale
} = require('../renderer-shared');

// ---------------------------------------------------------------------------
// breakdown
// ---------------------------------------------------------------------------
test('breakdown: sub-hour value (mm:ss range)', () => {
    // 245s = 4m 5s
    assert.deepEqual(breakdown(245), { hours: 0, minutes: 4, seconds: 5, hasHours: false });
});

test('breakdown: value >= 3600 exposes hours', () => {
    // 3661s = 1h 1m 1s
    assert.deepEqual(breakdown(3661), { hours: 1, minutes: 1, seconds: 1, hasHours: true });
});

test('breakdown: exact 3600 boundary is the hours threshold', () => {
    assert.deepEqual(breakdown(3600), { hours: 1, minutes: 0, seconds: 0, hasHours: true });
    // 3599 must NOT show hours
    assert.deepEqual(breakdown(3599), { hours: 0, minutes: 59, seconds: 59, hasHours: false });
});

test('breakdown: negative (overrun) handled by absolute magnitude', () => {
    assert.deepEqual(breakdown(-65), { hours: 0, minutes: 1, seconds: 5, hasHours: false });
    assert.deepEqual(breakdown(-3600), { hours: 1, minutes: 0, seconds: 0, hasHours: true });
});

test('breakdown: zero', () => {
    assert.deepEqual(breakdown(0), { hours: 0, minutes: 0, seconds: 0, hasHours: false });
});

test('breakdown: floors fractional seconds before decomposing', () => {
    assert.deepEqual(breakdown(65.9), { hours: 0, minutes: 1, seconds: 5, hasHours: false });
});

test('breakdown: non-finite input coerces to zero', () => {
    assert.deepEqual(breakdown(NaN), { hours: 0, minutes: 0, seconds: 0, hasHours: false });
    assert.deepEqual(breakdown(Infinity), { hours: 0, minutes: 0, seconds: 0, hasHours: false });
    assert.deepEqual(breakdown(undefined), { hours: 0, minutes: 0, seconds: 0, hasHours: false });
});

test('breakdown: large multi-hour value', () => {
    // 2h 3m 4s = 7384
    assert.deepEqual(breakdown(7384), { hours: 2, minutes: 3, seconds: 4, hasHours: true });
});

// ---------------------------------------------------------------------------
// flipCells
// ---------------------------------------------------------------------------
test('flipCells: digit characters for a sub-hour value', () => {
    // 754s = 12m 34s
    const c = flipCells(754);
    assert.equal(c.m1, '1');
    assert.equal(c.m2, '2');
    assert.equal(c.s1, '3');
    assert.equal(c.s2, '4');
    assert.equal(c.hasHours, false);
    // All cells are single-character strings
    Object.keys(c).forEach((k) => {
        if (k !== 'hasHours') { assert.equal(typeof c[k], 'string'); }
    });
});

test('flipCells: hours shown when hours > 0', () => {
    // 1h 23m 45s = 5025
    const c = flipCells(5025);
    assert.equal(c.h1, '0');
    assert.equal(c.h2, '1');
    assert.equal(c.m1, '2');
    assert.equal(c.m2, '3');
    assert.equal(c.s1, '4');
    assert.equal(c.s2, '5');
    assert.equal(c.hasHours, true);
});

test('flipCells: hours hidden for sub-hour with no preset', () => {
    const c = flipCells(125); // 2m 5s
    assert.equal(c.hasHours, false);
});

test('flipCells: preset >= 3600 forces hours even for sub-hour value', () => {
    // remaining only 2m 5s but the timer preset is 1h → flip must show hours
    const c = flipCells(125, 3600);
    assert.equal(c.hasHours, true);
});

test('flipCells: preset < 3600 does not force hours', () => {
    const c = flipCells(125, 1800);
    assert.equal(c.hasHours, false);
});

test('flipCells: two-digit hours split correctly', () => {
    // 12h 0m 0s = 43200
    const c = flipCells(43200);
    assert.equal(c.h1, '1');
    assert.equal(c.h2, '2');
    assert.equal(c.hasHours, true);
});

test('flipCells: negative (overrun) uses absolute magnitude', () => {
    const c = flipCells(-125);
    assert.equal(c.m1, '0');
    assert.equal(c.m2, '2');
    assert.equal(c.s1, '0');
    assert.equal(c.s2, '5');
});

test('flipCells: zero', () => {
    const c = flipCells(0);
    assert.equal(c.m1, '0');
    assert.equal(c.m2, '0');
    assert.equal(c.s1, '0');
    assert.equal(c.s2, '0');
    assert.equal(c.hasHours, false);
});

// ---------------------------------------------------------------------------
// clampScale
// ---------------------------------------------------------------------------
test('clampScale: value within range is unchanged', () => {
    assert.equal(clampScale(150, 30, 600), 150);
});

test('clampScale: below min clamps to min', () => {
    assert.equal(clampScale(10, 30, 600), 30);
});

test('clampScale: above max clamps to max', () => {
    assert.equal(clampScale(900, 30, 600), 600);
});

test('clampScale: respects display timer bounds 30..300', () => {
    assert.equal(clampScale(500, 30, 300), 300);
    assert.equal(clampScale(20, 30, 300), 30);
});

test('clampScale: respects display block bounds 50..600', () => {
    assert.equal(clampScale(40, 50, 600), 50);
    assert.equal(clampScale(700, 50, 600), 600);
});

test('clampScale: equal bounds collapse to that value', () => {
    assert.equal(clampScale(123, 100, 100), 100);
    assert.equal(clampScale(50, 100, 100), 100);
});

test('clampScale: value exactly at the bounds is returned as-is', () => {
    assert.equal(clampScale(30, 30, 600), 30);
    assert.equal(clampScale(600, 30, 600), 600);
});

test('clampScale: non-finite value returns min', () => {
    assert.equal(clampScale(NaN, 30, 600), 30);
    assert.equal(clampScale(Infinity, 30, 600), 600); // Infinity > max → clamps to max
    assert.equal(clampScale(-Infinity, 30, 600), 30);
});

test('clampScale: swapped bounds are normalized', () => {
    assert.equal(clampScale(150, 600, 30), 150);
    assert.equal(clampScale(900, 600, 30), 600);
    assert.equal(clampScale(10, 600, 30), 30);
});
