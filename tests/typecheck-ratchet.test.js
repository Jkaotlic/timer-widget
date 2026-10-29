'use strict';

// Храповик typecheck (scripts/typecheck.js). Первая часть — на поддельном
// выводе tsc: арифметика сравнения (разбор путей, дедупликация двух проектов,
// рост / падение / новый файл, сдвиг строк, отказ --write поднимать базу).
// Вторая часть (ниже) гоняет НАСТОЯЩИЙ tsc и CLI на временном каталоге:
// зелёная арифметика ничего не стоит, если tsc не видит опечатку.

const test = require('node:test');
const { after } = test;
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

const TEMP_DIRS = [];
after(() => {
    for (const d of TEMP_DIRS) {
        fs.rmSync(d, { recursive: true, force: true });
    }
});

// Временный проект: конфиг — копия tsconfig.renderer.json, но с одним файлом.
function makeProject(source, include = ['probe.js']) {
    // realpath: на macOS /var — симлинк на /private/var, и tsc печатает пути от него.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-probe-')));
    TEMP_DIRS.push(dir);
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
    assert.match(res.stderr, /SIGKILL/);
    assert.equal(fs.readFileSync(p.baseline, 'utf8'), '{"probe.js":3}\n');
});

test('CLI: tsc убит уже на --listFilesOnly — внятное сообщение и код 1, не стек', () => {
    const p = makeProject(CLEAN);
    const file = path.join(p.dir, 'fake-tsc-list.js');
    fs.writeFileSync(file, "process.kill(process.pid, 'SIGKILL');\n");
    const res = runCli(p, [], { TYPECHECK_TSC: file });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /tsc не отработал/);
    assert.match(res.stderr, /SIGKILL/);
    assert.doesNotMatch(res.stderr, /\n\s+at /);
});

test('CLI --write с временным конфигом пишет только временную базу', () => {
    const before = fs.readFileSync(LIVE_BASELINE, 'utf8');
    const p = makeProject(TYPO);
    const res = runCli(p, ['--write']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(p.baseline, 'utf8')), { 'probe.js': 1 });
    assert.equal(fs.readFileSync(LIVE_BASELINE, 'utf8'), before);
});

// ---- мост типизирован картой «канал → payload» (types/ipc-payloads.d.ts) ----
//
// Опечатка в поле payload ключевого канала обязана быть ошибкой tsc и там, где
// payload ЧИТАЮТ, и там, где его СОБИРАЮТ. Проверяется на настоящем коде: копия
// файла во временном каталоге, одно поле заменено на опечатку; объявления —
// настоящие types/*.d.ts репозитория. Пока мост отдаёт payload как `any`, tsc
// молчит — и тест красный.

/**
 * @param {string} file файл окна в корне репозитория
 * @param {string} from точный фрагмент с полем payload
 * @param {string} to тот же фрагмент с опечаткой
 */
function mutatedCopy(file, from, to) {
    const source = fs.readFileSync(path.join(REPO, file), 'utf8');
    // Фрагмент обязан найтись ровно один раз: иначе тест проверял бы не то
    // место (или ничего) и был бы зелёным по ошибке.
    assert.equal(source.split(from).length - 1, 1, `${file}: фрагмент «${from}» не найден или не один`);
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-payload-')));
    TEMP_DIRS.push(dir);
    fs.writeFileSync(path.join(dir, 'reader.js'), source.replace(from, to));
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'tsconfig.renderer.json'), 'utf8'));
    cfg.include = [toPosixPath(path.join(REPO, 'types', '*.d.ts')), 'reader.js'];
    delete cfg.exclude;
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(cfg));
    return parseTscOutput(runTsc(path.join(dir, 'tsconfig.json')), dir)
        .filter((e) => e.file === 'reader.js');
}

function toPosixPath(p) {
    return p.replace(/\\/g, '/');
}

test('мост: опечатка в поле timer-state у слушателя БЕЗ аннотации — TS2339 (panel-display.js)', () => {
    // Слушатель написан прямо в вызове ipc.on(...) — колбэк типизирует
    // перегрузка моста по имени канала, своей аннотации у него нет.
    const errors = mutatedCopy('panel-display.js',
        'this.eventRemainingSeconds = state.remainingSeconds;',
        'this.eventRemainingSeconds = state.remainingTimeX;');
    const hit = errors.filter((e) => e.code === 'TS2339' && e.message.includes('remainingTimeX'));
    assert.equal(hit.length, 1, JSON.stringify(errors, null, 2));
});

test('мост: опечатка в поле timer-state у сохранённого обработчика — TS2339 (widget-app.js)', () => {
    // Обработчик сохранён в поле (его потом снимает removeListener), поэтому
    // тип ему даёт не вызов on(), а IpcListener<'timer-state'> из той же карты.
    const errors = mutatedCopy('widget-app.js',
        'this.remainingSeconds = Number(state.remainingSeconds) || 0;',
        'this.remainingSeconds = Number(state.remainingTimeX) || 0;');
    const hit = errors.filter((e) => e.code === 'TS2339' && e.message.includes('remainingTimeX'));
    assert.equal(hit.length, 1, JSON.stringify(errors, null, 2));
});

test('мост: опечатка в поле при СБОРКЕ display-settings-update — ошибка tsc (panel-display.js)', () => {
    const errors = mutatedCopy('panel-display.js',
        "bgSolid: document.getElementById('bgSolidColor').value,",
        "bgSolidX: document.getElementById('bgSolidColor').value,");
    // TS2353 — лишнее поле; TS2561 — оно же с подсказкой «Did you mean 'bgSolid'?».
    const hit = errors.filter((e) => ['TS2353', 'TS2561'].includes(e.code) && e.message.includes('bgSolidX'));
    assert.equal(hit.length, 1, JSON.stringify(errors, null, 2));
});

test('мост: тумблеры и подписи блоков в DisplaySettingsUpdate совпадают с реестрами', () => {
    // В .d.ts ключи перечислены поимённо, а в коде они — реестры. Новый блок в
    // реестре без строки в типе стал бы TS2339 у читающего окна; строка в типе
    // без блока — обещанием поля, которого никто не шлёт.
    const Schema = require('../settings-schema');
    const Layouts = require('../display-layouts');
    const dts = fs.readFileSync(path.join(REPO, 'types', 'ipc-payloads.d.ts'), 'utf8');
    const body = dts.match(/interface DisplaySettingsUpdate \{([\s\S]*?)\n\}/);
    assert.ok(body, 'interface DisplaySettingsUpdate не найден');
    const declared = new Set([...body[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]));
    const registry = [
        ...Schema.DISPLAY_BLOCK_KEYS,
        ...Schema.DISPLAY_LABEL_KEYS,
        ...Layouts.LABELLED_ELEMENTS.map((el) => el.labelKey),
    ];
    for (const key of registry) {
        assert.ok(declared.has(key), `${key} есть в реестре, но не в DisplaySettingsUpdate`);
    }
    const typed = [...declared].filter((k) => /^(show|label)[A-Z]/.test(k) && !/^labelHero/.test(k));
    assert.deepEqual(typed.sort(), [...new Set(registry)].sort());
});
