'use strict';

// Храповик typecheck (scripts/typecheck.js) на поддельном выводе tsc.
// Настоящий tsc здесь не запускается: проверяется арифметика сравнения —
// разбор путей, дедупликация двух проектов, рост / падение / новый файл,
// сдвиг строк и отказ --write поднимать базу.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTscOutput, tally, compare, nextBaseline } = require('../scripts/typecheck');

test('parseTscOutput: относительный и Windows-абсолютный путь дают один ключ', () => {
    const posix = parseTscOutput(
        "utils.js(3,5): error TS2339: Property 'x' does not exist on type 'Y'.",
        '/repo'
    );
    const win = parseTscOutput(
        "C:\\repo\\utils.js(3,5): error TS2339: Property 'x' does not exist on type 'Y'.",
        'C:\\repo'
    );
    const expected = [{ file: 'utils.js', line: 3, col: 5, code: 'TS2339', message: "Property 'x' does not exist on type 'Y'." }];
    assert.deepEqual(posix, expected);
    assert.deepEqual(win, expected);
});

test('parseTscOutput: путь в подкаталоге — от корня и через /', () => {
    const win = parseTscOutput('C:\\repo\\types\\globals.d.ts(1,1): error TS1005: x', 'C:\\repo');
    const posix = parseTscOutput('/repo/types/globals.d.ts(1,1): error TS1005: x', '/repo');
    assert.equal(win[0].file, 'types/globals.d.ts');
    assert.equal(posix[0].file, 'types/globals.d.ts');
});

test('parseTscOutput: строки без "error TS" игнорируются', () => {
    const out = parseTscOutput([
        '',
        '  Types of property are incompatible.',
        'Found 3 errors in 2 files.',
        "utils.js(1,1): error TS2304: Cannot find name 'module'.",
    ].join('\n'), '/repo');
    assert.equal(out.length, 1);
    assert.equal(out[0].code, 'TS2304');
});

test('tally: одна и та же ошибка из двух проектов считается один раз', () => {
    const line = "utils.js(3,5): error TS2339: Property 'x' does not exist on type 'Y'.";
    const errors = parseTscOutput(`${line}\n${line}\n`, '/repo');
    assert.equal(errors.length, 2);
    assert.deepEqual(tally(errors), { 'utils.js': 1 });
});

test('tally: разные сообщения в одном файле считаются раздельно', () => {
    const errors = parseTscOutput([
        "a.js(1,1): error TS2339: Property 'x' does not exist on type 'Y'.",
        "a.js(2,1): error TS2339: Property 'z' does not exist on type 'Y'.",
        "b.js(2,1): error TS2304: Cannot find name 'q'.",
    ].join('\n'), '/repo');
    assert.deepEqual(tally(errors), { 'a.js': 2, 'b.js': 1 });
});

test('tally: тот же текст на РАЗНЫХ строках — две ошибки, а не одна', () => {
    // Иначе вторая такая же опечатка в файле, где одна уже есть, прошла бы
    // мимо храповика: счёт файла не изменился бы.
    const errors = parseTscOutput([
        "a.js(1,1): error TS2304: Cannot find name 'module'.",
        "a.js(9,1): error TS2304: Cannot find name 'module'.",
    ].join('\n'), '/repo');
    assert.deepEqual(tally(errors), { 'a.js': 2 });
});

test('parseTscOutput: ошибка без места (конфиг) — file пустой', () => {
    const out = parseTscOutput('error TS18003: No inputs were found in config file.', '/repo');
    assert.deepEqual(out, [{ file: '', line: 0, col: 0, code: 'TS18003', message: 'No inputs were found in config file.' }]);
});

test('compare: рост, падение, новый файл', () => {
    assert.deepEqual(compare({ a: 2 }, { a: 3 }).grown, ['a']);
    assert.deepEqual(compare({ a: 2 }, { a: 1 }).shrunk, ['a']);
    assert.deepEqual(compare({ a: 2 }, {}).shrunk, ['a']);
    assert.deepEqual(compare({}, { b: 1 }).fresh, ['b']);
    assert.deepEqual(compare({}, { b: 1 }).grown, []);
});

test('compare: те же сообщения на других строках — пусто', () => {
    const before = tally(parseTscOutput([
        "a.js(10,1): error TS2339: Property 'x' does not exist on type 'Y'.",
        "a.js(20,1): error TS2304: Cannot find name 'q'.",
    ].join('\n'), '/repo'));
    const after = tally(parseTscOutput([
        "a.js(14,3): error TS2339: Property 'x' does not exist on type 'Y'.",
        "a.js(31,9): error TS2304: Cannot find name 'q'.",
    ].join('\n'), '/repo'));
    assert.deepEqual(compare(before, after), { grown: [], shrunk: [], fresh: [] });
});

test('nextBaseline: рост хотя бы одного файла — отказ', () => {
    const res = nextBaseline({ a: 2 }, { a: 3 });
    assert.equal(res.ok, false);
    assert.deepEqual(res.grown, ['a']);
});

test('nextBaseline: новый файл с ошибками — тоже рост, отказ', () => {
    const res = nextBaseline({ a: 2 }, { a: 2, b: 1 });
    assert.equal(res.ok, false);
    assert.deepEqual(res.grown, ['b']);
});

test('nextBaseline: падение пишется, файлы с нулём из базы удаляются', () => {
    const res = nextBaseline({ a: 2, b: 1 }, { a: 1 });
    assert.equal(res.ok, true);
    assert.deepEqual(res.baseline, { a: 1 });
});
