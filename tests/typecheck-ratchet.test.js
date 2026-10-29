'use strict';

// Храповик typecheck (scripts/typecheck.js). Первая часть — на поддельном
// выводе tsc: арифметика сравнения (разбор путей, дедупликация двух проектов,
// рост / падение / новый файл, сдвиг строк, отказ --write поднимать базу).
// Вторая часть (ниже) гоняет НАСТОЯЩИЙ tsc и CLI на временном каталоге:
// зелёная арифметика ничего не стоит, если tsc не видит опечатку.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseTscOutput, tally, compare, nextBaseline, runTsc } = require('../scripts/typecheck');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'scripts', 'typecheck.js');
const LIVE_BASELINE = path.join(REPO, 'typecheck-baseline.json');

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

// ---- настоящий tsc и CLI ----------------------------------------------------

const TYPO = '/** @param {{a: number}} p */ function f(p) { return p.b; }\n';
const CLEAN = '/** @param {{a: number}} p */ function f(p) { return p.a; }\n';

// Временный проект: конфиг — копия tsconfig.renderer.json, но с одним файлом.
function makeProject(source, include = ['probe.js']) {
    // realpath: на macOS /var — симлинк на /private/var, и tsc печатает пути от него.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-probe-')));
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'tsconfig.renderer.json'), 'utf8'));
    cfg.include = include;
    delete cfg.exclude;
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(cfg));
    if (source !== null) {
        fs.writeFileSync(path.join(dir, 'probe.js'), source);
    }
    return { dir, config: path.join(dir, 'tsconfig.json'), baseline: path.join(dir, 'baseline.json') };
}

function runCli(project, args = [], extraEnv = {}) {
    return spawnSync(process.execPath, [CLI, ...args], {
        cwd: REPO,
        encoding: 'utf8',
        env: {
            ...process.env,
            TYPECHECK_CONFIGS: project.config,
            TYPECHECK_BASELINE: project.baseline,
            ...extraEnv,
        },
    });
}

test('настоящий tsc видит опечатку: ровно одна TS2339', () => {
    const p = makeProject(TYPO);
    const errors = parseTscOutput(runTsc(p.config), p.dir);
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.equal(errors[0].code, 'TS2339');
    assert.equal(errors[0].file, 'probe.js');
});

test('CLI: пустой include — код 1, а не ложный «0 ошибок»', () => {
    const p = makeProject(CLEAN, ['nothing/*.js']);
    const res = runCli(p);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /не нашёл ни одного файла/);
});

test('CLI: опечатка сверх пустой базы — код 1, исправленный файл — код 0', () => {
    const p = makeProject(TYPO);
    fs.writeFileSync(p.baseline, '{}\n');
    assert.equal(runCli(p).status, 1);
    fs.writeFileSync(path.join(p.dir, 'probe.js'), CLEAN);
    assert.equal(runCli(p).status, 0);
});

// Поддельный tsc: --listFilesOnly отвечает честно, настоящий прогон «падает».
function fakeTsc(dir, body) {
    const file = path.join(dir, 'fake-tsc.js');
    fs.writeFileSync(file, `
const args = process.argv.slice(2);
if (args.includes('--listFilesOnly')) { console.log('probe.js'); process.exit(0); }
${body}
`);
    return file;
}

test('CLI: tsc упал без диагностики (код 2, ни одной error TS) — фатально, --write не советуется', () => {
    const p = makeProject(CLEAN);
    const tsc = fakeTsc(p.dir, "console.error('Segmentation oops'); process.exit(2);");
    const res = runCli(p, [], { TYPECHECK_TSC: tsc });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /Segmentation oops/);
    assert.doesNotMatch(res.stdout + res.stderr, /--write/);
    assert.equal(fs.existsSync(p.baseline), false);
});

test('CLI: tsc убит сигналом — фатально, базу не трогает', () => {
    const p = makeProject(CLEAN);
    fs.writeFileSync(p.baseline, '{"probe.js":3}\n');
    const tsc = fakeTsc(p.dir, "process.kill(process.pid, 'SIGKILL');");
    const res = runCli(p, ['--write'], { TYPECHECK_TSC: tsc });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.equal(fs.readFileSync(p.baseline, 'utf8'), '{"probe.js":3}\n');
});

test('CLI --write с временным конфигом пишет только временную базу', () => {
    const before = fs.readFileSync(LIVE_BASELINE, 'utf8');
    const p = makeProject(TYPO);
    const res = runCli(p, ['--write']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(p.baseline, 'utf8')), { 'probe.js': 1 });
    assert.equal(fs.readFileSync(LIVE_BASELINE, 'utf8'), before);
});
