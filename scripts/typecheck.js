#!/usr/bin/env node
'use strict';

/**
 * Храповик `tsc --checkJs` по файлам.
 *
 * Зачем. Проект — vanilla JS без сборщика, и долг типов на старте — около
 * тысячи ошибок (994 в первой базе). Запретить их разом нельзя, а `// @ts-check` по файлам
 * проверяет только размеченное: новый файл без метки не проверяется вовсе.
 * Поэтому tsc гоняется по ВСЕМ файлам приложения, а ошибки сравниваются
 * ПО ФАЙЛАМ с закоммиченной базой `typecheck-baseline.json`.
 *
 * Формат базы — у файла МУЛЬТИМНОЖЕСТВО «код: текст» без строки и столбца:
 *
 *   { "control-app.js": { "TS2339: Property 'x' does not exist …": 2, … } }
 *
 * Ключи отсортированы, одна запись — одна строка: дифф базы читается глазами.
 * Число при записи — сколько раз ЭТОТ текст встречается в файле (на разных
 * строках — разные ошибки). Сравнение по записям, а не по сумме файла:
 *
 *   - запись выросла или появилась (в том числе новый файл) → код 1, печатаются
 *     ТОЛЬКО эти сообщения с их текущими местами `файл(строка,столбец)`. Так
 *     «починил одну, внёс другую» в файле с ненулевой базой — рост, а не ноль;
 *   - что-то уменьшилось и ничего не выросло → код 1 с просьбой опустить базу
 *     (`npm run typecheck -- --write`): без этого следующий откат вверх до
 *     старой базы прошёл бы молча;
 *   - сдвиг строк без новых ошибок ничего не меняет — строк в базе нет;
 *   - `--write` переписывает базу, но ОТКАЗЫВАЕТСЯ поднимать хоть одну запись
 *     (поднять можно только рукой — в диффе это видно). Единственное
 *     исключение — самая первая запись, когда файла базы ещё нет.
 *
 * Два проекта (`tsconfig.main.json`, `tsconfig.renderer.json`): общие модули
 * живут в обоих мирах и проверяются в обоих. Ошибка общего модуля, видимая в
 * обоих проектах, считается ОДИН раз — дедупликация по месту, коду и тексту.
 *
 * Покрытие. Пустой `include` дал бы «0 ошибок» = зелёный, но и «не пусто» —
 * слабая охрана: `types/*.d.ts` и `typeof import('../x.js')` тянут в программу
 * десятки модулей, и битый include молча выкинул бы control-app.js. Поэтому
 * каждый конфиг прогоняется с `--listFilesOnly`, и ОБЪЕДИНЕНИЕ программ обязано
 * содержать каждый `*.js` корня проекта, кроме `eslint.config.js` и
 * `playwright.config.js`; иначе — код 1 со списком пропавших. Корень проекта —
 * каталог ПЕРВОГО конфига (для временных конфигов тестов — их каталог).
 *
 * Падение самого tsc — не чистота: сигнал или ненулевой код без единой строки
 * `error TS` — фатально (код 1, вывод tsc печатается, `--write` не советуется:
 * он стёр бы базу, увидев «0 ошибок»).
 *
 * Конфиги по умолчанию — пара выше; env `TYPECHECK_CONFIGS` (через запятую)
 * подставляет свои (все — в одном каталоге), `TYPECHECK_BASELINE` — свой файл базы, `TYPECHECK_TSC` —
 * свой скрипт вместо tsc (так тесты гоняют CLI на временном каталоге и не
 * касаются живой базы).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');

function baselinePath() {
    return process.env.TYPECHECK_BASELINE
        ? path.resolve(process.env.TYPECHECK_BASELINE)
        : path.join(REPO, 'typecheck-baseline.json');
}
const DEFAULT_CONFIGS = ['tsconfig.main.json', 'tsconfig.renderer.json'];

// `файл(строка,столбец): error TS1234: текст`. Путь бывает относительным
// (от каталога запуска) или абсолютным, в том числе Windows-путём.
const LINE_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
// Ошибка без места: конфиг, «No inputs were found» и т. п.
const GLOBAL_RE = /^error (TS\d+): (.*)$/;

function toPosix(p) {
    return p.replace(/\\/g, '/');
}

function relativeToRoot(file, repoRoot) {
    const f = toPosix(file);
    const root = toPosix(repoRoot).replace(/\/+$/, '');
    // Сравнение без учёта регистра только для Windows-путей с буквой диска.
    const isWin = /^[A-Za-z]:\//.test(f) || /^[A-Za-z]:\//.test(root);
    const fCmp = isWin ? f.toLowerCase() : f;
    const rootCmp = isWin ? root.toLowerCase() : root;
    if (fCmp.startsWith(`${rootCmp}/`)) {
        return f.slice(root.length + 1);
    }
    return f.replace(/^\.\//, '');
}

/**
 * Разбирает вывод tsc (`--pretty false`). Строки без `error TS` пропускаются.
 * У ошибки без места `file` — пустая строка.
 * @param {string} text
 * @param {string} repoRoot
 * @returns {Array<{file: string, line: number, col: number, code: string, message: string}>}
 */
function parseTscOutput(text, repoRoot) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trimEnd();
        const m = LINE_RE.exec(line);
        if (m) {
            out.push({
                file: relativeToRoot(m[1], repoRoot),
                line: Number(m[2]),
                col: Number(m[3]),
                code: m[4],
                message: m[5],
            });
            continue;
        }
        const g = GLOBAL_RE.exec(line.trim());
        if (g) {
            out.push({ file: '', line: 0, col: 0, code: g[1], message: g[2] });
        }
    }
    return out;
}

function errorKey(e) {
    return `${e.file}|${e.line}|${e.col}|${e.code}|${e.message}`;
}

/** Запись мультимножества: код и текст, без места. */
function messageKey(e) {
    return `${e.code}: ${e.message}`;
}

/**
 * Мультимножество «код: текст» на файл. Одна и та же ошибка (то же место, код и
 * текст) из вывода двух проектов считается один раз; одинаковый текст на
 * РАЗНЫХ строках — это разные ошибки, и считаются обе.
 * @param {Array<{file: string, line?: number, col?: number, code: string, message: string}>} errors
 * @returns {Record<string, Record<string, number>>}
 */
function tally(errors) {
    const seen = new Set();
    /** @type {Record<string, Record<string, number>>} */
    const out = {};
    for (const e of errors) {
        const key = errorKey(e);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const bag = out[e.file] || (out[e.file] = {});
        const m = messageKey(e);
        bag[m] = (bag[m] || 0) + 1;
    }
    return out;
}

/**
 * Записи, выросшие (включая новые) и уменьшившиеся. Порядок — по файлу, затем
 * по записи.
 * @param {Record<string, Record<string, number>>} baseline
 * @param {Record<string, Record<string, number>>} current
 * @returns {{grown: Delta[], shrunk: Delta[]}}
 * @typedef {{file: string, key: string, was: number, now: number}} Delta
 */
function compare(baseline, current) {
    const grown = [];
    const shrunk = [];
    const files = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    for (const file of [...files].sort()) {
        const was = baseline[file] || {};
        const now = current[file] || {};
        const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
        for (const key of [...keys].sort()) {
            const a = was[key] || 0;
            const b = now[key] || 0;
            if (b > a) {
                grown.push({ file, key, was: a, now: b });
            } else if (b < a) {
                shrunk.push({ file, key, was: a, now: b });
            }
        }
    }
    return { grown, shrunk };
}

/**
 * Новая база для `--write`: только вниз. Рост хоть одной записи — отказ, база
 * не трогается. Нулевые записи и пустые файлы удаляются.
 * @param {Record<string, Record<string, number>>} baseline
 * @param {Record<string, Record<string, number>>} current
 * @returns {{ok: true, baseline: Record<string, Record<string, number>>} | {ok: false, grown: Delta[]}}
 */
function nextBaseline(baseline, current) {
    const { grown } = compare(baseline, current);
    if (grown.length > 0) {
        return { ok: false, grown };
    }
    return { ok: true, baseline: sortedBags(current) };
}

function sortedBags(bags) {
    /** @type {Record<string, Record<string, number>>} */
    const out = {};
    for (const file of Object.keys(bags).sort()) {
        /** @type {Record<string, number>} */
        const bag = {};
        for (const key of Object.keys(bags[file]).sort()) {
            if (bags[file][key] > 0) {
                bag[key] = bags[file][key];
            }
        }
        if (Object.keys(bag).length > 0) {
            out[file] = bag;
        }
    }
    return out;
}

// Корневые файлы проекта, которые tsc проверять не обязан: конфиги
// инструментов, а не код приложения.
const NOT_APP = ['eslint.config.js', 'playwright.config.js'];

/**
 * Корневые `*.js` проекта, которых нет ни в одной программе tsc.
 * @param {string} root каталог проекта
 * @param {string[]} covered пути от корня (объединение `--listFilesOnly`)
 * @returns {string[]}
 */
function missingFromPrograms(root, covered) {
    const have = new Set(covered.map(toPosix));
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.js') && !NOT_APP.includes(d.name))
        .map((d) => d.name)
        .filter((f) => !have.has(f))
        .sort();
}

// `typescript/bin/tsc` закрыт полем `exports` пакета, поэтому путь собирается
// из `bin` его package.json — тот же файл, что запускает npx.
function tscBin() {
    if (process.env.TYPECHECK_TSC) {
        return path.resolve(process.env.TYPECHECK_TSC);
    }
    const pkgPath = require.resolve('typescript/package.json');
    const bin = require(pkgPath).bin;
    return path.join(path.dirname(pkgPath), typeof bin === 'string' ? bin : bin.tsc);
}

// tsc зовётся текущим node, а не через npx: на Windows npx — это `.cmd`.
function spawnTsc(args, cwd) {
    const res = spawnSync(process.execPath, [tscBin(), ...args], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) {
        throw res.error;
    }
    if (res.signal) {
        throw new Error(`tsc убит сигналом ${res.signal}\n${res.stdout || ''}${res.stderr || ''}`);
    }
    return res;
}

/**
 * Прогон tsc по конфигу: stdout + stderr вместе и код выхода. Каталог запуска —
 * каталог конфига, поэтому относительные пути вывода — от него.
 * @param {string} configPath
 * @returns {{output: string, status: number | null}}
 */
function runTscFull(configPath) {
    const abs = path.resolve(configPath);
    const res = spawnTsc(['-p', abs, '--pretty', 'false'], path.dirname(abs));
    return { output: `${res.stdout || ''}${res.stderr || ''}`, status: res.status };
}

/**
 * @param {string} configPath
 * @returns {string}
 */
function runTsc(configPath) {
    return runTscFull(configPath).output;
}

/**
 * Файлы программы, которые принадлежат проекту: под каталогом конфига и не из
 * node_modules (там — lib.*.d.ts и типы пакетов).
 * @param {string} configPath
 * @returns {string[]}
 */
function listProjectFiles(configPath) {
    const abs = path.resolve(configPath);
    const dir = path.dirname(abs);
    const res = spawnTsc(['-p', abs, '--listFilesOnly'], dir);
    const files = [];
    for (const raw of `${res.stdout || ''}`.split(/\r?\n/)) {
        const line = raw.trim();
        // В тот же stdout tsc пишет и ошибки (`error TS18003: No inputs…`):
        // файлом считается только строка, которая указывает на файл.
        if (!line || !fs.existsSync(path.resolve(dir, line))) {
            continue;
        }
        const rel = toPosix(path.relative(dir, path.resolve(dir, line)));
        if (rel.startsWith('../') || rel.startsWith('node_modules/') || path.isAbsolute(rel)) {
            continue;
        }
        files.push(rel);
    }
    return files;
}

// Что считается файлом приложения. tsc идёт по `require` и сам добавляет в
// программу то, что приложение подтягивает из `scripts/` (режим съёмки), —
// их ошибки не считаются: `scripts/`, `tests/`, `e2e/`, `build/` вне храповика.
function isAppFile(file) {
    return !file.includes('/') || file.startsWith('types/');
}

function readBaseline() {
    if (!fs.existsSync(baselinePath())) {
        return null;
    }
    const data = JSON.parse(fs.readFileSync(baselinePath(), 'utf8'));
    for (const [file, bag] of Object.entries(data)) {
        const ok = bag && typeof bag === 'object' && !Array.isArray(bag)
            && Object.values(bag).every((n) => Number.isInteger(n) && n > 0);
        if (!ok) {
            throw new Error(`${path.basename(baselinePath())}: у «${file}» не тот формат — ждётся { "TSxxxx: текст": число }`);
        }
    }
    return data;
}

function writeBaseline(bags) {
    fs.writeFileSync(baselinePath(), `${JSON.stringify(sortedBags(bags), null, 2)}\n`);
}

function total(bags) {
    let n = 0;
    for (const bag of Object.values(bags)) {
        for (const c of Object.values(bag)) {
            n += c;
        }
    }
    return n;
}

/** Текущие места записи (файл + «код: текст»), без дублей двух проектов. */
function printLocations(delta, errors) {
    const seen = new Set();
    for (const e of errors) {
        if (e.file !== delta.file || messageKey(e) !== delta.key || seen.has(errorKey(e))) {
            continue;
        }
        seen.add(errorKey(e));
        console.error(`    ${e.file}(${e.line},${e.col}): ${e.code}: ${e.message}`);
    }
}

function printGrown(grown, errors) {
    for (const d of grown) {
        console.error(`  ${d.file}: ${d.key} — в базе ${d.was}, сейчас ${d.now}:`);
        printLocations(d, errors);
    }
}

function main(argv) {
    const write = argv.includes('--write');
    const configs = (process.env.TYPECHECK_CONFIGS || DEFAULT_CONFIGS.join(','))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((c) => path.resolve(REPO, c));
    const projectRoot = path.dirname(configs[0]);

    // Сначала списки файлов всех программ: покрытие проверяется ДО прогона.
    const programs = [];
    for (const cfg of configs) {
        const name = path.relative(REPO, cfg) || cfg;
        let files;
        try {
            files = listProjectFiles(cfg);
        } catch (err) {
            console.error(`[typecheck] ${name}: tsc не отработал: ${err.message}`);
            return 1;
        }
        if (files.length === 0) {
            console.error(`[typecheck] ${name}: tsc не нашёл ни одного файла проекта — пустой include дал бы ложный «0 ошибок».`);
            return 1;
        }
        programs.push({ cfg, name, files });
    }
    const covered = programs.flatMap((p) => p.files.map((f) =>
        toPosix(path.relative(projectRoot, path.resolve(path.dirname(p.cfg), f)))));
    const missing = missingFromPrograms(projectRoot, covered);
    if (missing.length > 0) {
        console.error('[typecheck] эти файлы корня не входят ни в одну программу tsc — их ошибки не считались бы. '
            + 'Добавь в include (main-процесс: tsconfig.main.json include + exclude tsconfig.renderer.json):');
        for (const f of missing) {
            console.error(`  ${f}`);
        }
        return 1;
    }

    const all = [];
    for (const { cfg, name, files } of programs) {
        const root = path.dirname(cfg);
        let run;
        try {
            run = runTscFull(cfg);
        } catch (err) {
            console.error(`[typecheck] ${name}: tsc не отработал: ${err.message}`);
            return 1;
        }
        const errors = parseTscOutput(run.output, root);
        if (run.status !== 0 && errors.length === 0) {
            console.error(`[typecheck] ${name}: tsc завершился с кодом ${run.status} без единой диагностики — это падение, а не чистота. Вывод:`);
            console.error(run.output);
            return 1;
        }
        const fatal = errors.filter((e) => e.file === '' || e.file.endsWith('.json'));
        if (fatal.length > 0) {
            console.error(`[typecheck] ${name}: ошибка конфигурации tsc:`);
            for (const e of fatal) {
                console.error(`    ${e.file ? `${e.file}: ` : ''}${e.code}: ${e.message}`);
            }
            return 1;
        }
        console.log(`[typecheck] ${name}: файлов ${files.length}, ошибок ${errors.length}`);
        all.push(...errors);
    }

    const errors = all.filter((e) => isAppFile(e.file));
    const current = tally(errors);
    let baseline;
    try {
        baseline = readBaseline();
    } catch (err) {
        console.error(`[typecheck] ${err.message}`);
        return 1;
    }

    if (write) {
        if (baseline === null) {
            writeBaseline(current);
            console.log(`[typecheck] база создана: ${total(current)} ошибок в ${Object.keys(current).length} файлах.`);
            return 0;
        }
        const next = nextBaseline(baseline, current);
        if (!next.ok) {
            console.error('[typecheck] --write отказывается поднимать базу. Новые или участившиеся ошибки:');
            printGrown(next.grown, errors);
            return 1;
        }
        writeBaseline(next.baseline);
        console.log(`[typecheck] база: ${total(baseline)} → ${total(next.baseline)}`);
        return 0;
    }

    const { grown, shrunk } = compare(baseline || {}, current);
    if (grown.length > 0) {
        console.error(`[typecheck] новые ошибки типов (${grown.reduce((n, d) => n + d.now - d.was, 0)}) — нет в базе или их стало больше:`);
        printGrown(grown, errors);
        return 1;
    }
    if (shrunk.length > 0) {
        console.error('[typecheck] ошибок стало меньше базы — опусти базу: npm run typecheck -- --write');
        for (const d of shrunk) {
            console.error(`  ${d.file}: ${d.key} — ${d.was} → ${d.now}`);
        }
        return 1;
    }
    console.log(`[typecheck] OK: ${total(current)} ошибок, совпадает с базой.`);
    return 0;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { parseTscOutput, tally, compare, nextBaseline, runTsc, listProjectFiles, isAppFile, missingFromPrograms };
