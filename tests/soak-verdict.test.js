'use strict';

/**
 * Вердикт долгого прогона (scripts/soak.js): сам прогон идёт часами и в CI не
 * входит, поэтому правила провала проверяются здесь, на готовых замерах.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { soakVerdict } = require('../scripts/soak');

const flat = (n, rssMb = 500) => Array.from({ length: n }, () => ({ rssMb, driftSeconds: 0 }));
const verdict = (samples, extra = {}) => soakVerdict({ samples, errors: [], gone: [], ...extra });

test('ровная память и точное табло — прогон прошёл', () => {
    assert.deepEqual(verdict(flat(40)), []);
});

test('утечка: память растёт к концу — провал', () => {
    const samples = Array.from({ length: 40 }, (_, i) => ({ rssMb: 500 + i * 20, driftSeconds: 0 }));
    assert.match(verdict(samples)[0], /память выросла/);
});

test('рост за время прогрева утечкой не считается', () => {
    const samples = [...flat(10, 200), ...flat(30, 500)];
    assert.deepEqual(verdict(samples), []);
});

test('одиночный всплеск памяти не проваливает', () => {
    const samples = flat(40);
    samples[38].rssMb = 5000;
    assert.deepEqual(verdict(samples), []);
});

test('табло разошлось больше чем на 2 с — провал', () => {
    const samples = flat(40);
    samples[20].driftSeconds = -3;
    assert.match(verdict(samples)[0], /разошлось на 3/);
});

test('ошибка в окне и упавший процесс — провал даже при чистых замерах', () => {
    const problems = verdict(flat(40), { errors: ['display.html: x'], gone: ['display.html'] });
    assert.equal(problems.length, 2);
});

test('слишком короткий прогон не выдаётся за успешный', () => {
    assert.match(verdict(flat(3))[0], /мало замеров/);
});
