#!/usr/bin/env node
'use strict';

/**
 * Храповик `tsc --checkJs` по файлам.
 *
 * Зачем. Проект — vanilla JS без сборщика, и долг типов на старте — около
 * тысячи ошибок (994 в первой базе). Запретить их разом нельзя, а `// @ts-check` по файлам
 * проверяет только размеченное: новый файл без метки не проверяется вовсе.
 * Поэтому tsc гоняется по ВСЕМ файлам приложения, а число ошибок сравнивается
 * ПО ФАЙЛАМ с закоммиченной базой `typecheck-baseline.json`:
 *
 *   - файл превысил базу или его нет в базе, а ошибки есть → код 1, печатаются
 *     ошибки этого файла;
 *   - файл опустился ниже базы → код 1 с просьбой опустить базу
 *     (`npm run typecheck -- --write`): без этого следующий откат вверх до
 *     старой базы прошёл бы молча;
 *   - `--write` переписывает базу, но ОТКАЗЫВАЕТСЯ поднимать число у файла
 *     (поднять можно только рукой — в диффе это видно). Единственное
 *     исключение — самая первая запись, когда файла базы ещё нет.
 *
 * Два проекта (`tsconfig.main.json`, `tsconfig.renderer.json`): общие модули
 * живут в обоих мирах и проверяются в обоих. Ошибка общего модуля, видимая в
 * обоих проектах, считается ОДИН раз — дедупликация по месту и тексту.
 * Сравнение с базой идёт по ЧИСЛУ на файл, поэтому сдвиг строк без новых
 * ошибок ничего не меняет.
 *
 * Пустой `include` дал бы «0 ошибок» = зелёный. Поэтому перед сравнением
 * каждый конфиг прогоняется с `--listFilesOnly`, и отсутствие в списке хотя бы
 * одного файла проекта — провал, а не чистота.
 *
 * Падение самого tsc — не чистота: сигнал или ненулевой код без единой строки
 * `error TS` — фатально (код 1, вывод tsc печатается, `--write` не советуется:
 * он стёр бы базу, увидев «0 ошибок»).
 *
 * Конфиги по умолчанию — пара выше; env `TYPECHECK_CONFIGS` (через запятую)
 * подставляет свои, `TYPECHECK_BASELINE` — свой файл базы, `TYPECHECK_TSC` —
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

/**
 * Число ошибок на файл. Одна и та же ошибка (то же место, код и текст) из
 * вывода двух проектов считается один раз; одинаковый текст на РАЗНЫХ строках —
 * это разные ошибки, и считаются обе.
 * @param {Array<{file: string, line?: number, col?: number, code: string, message: string}>} errors
 * @returns {Record<string, number>}
 */
function tally(errors) {
    const seen = new Set();
    /** @type {Record<string, number>} */
    const counts = {};
    for (const e of errors) {
        const key = errorKey(e);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        counts[e.file] = (counts[e.file] || 0) + 1;
    }
    return counts;
}

/**
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} current
 * @returns {{grown: string[], shrunk: string[], fresh: string[]}}
 */
function compare(baseline, current) {
    const grown = [];
    const shrunk = [];
    const fresh = [];
    const files = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    for (const file of [...files].sort()) {
        const was = Object.prototype.hasOwnProperty.call(baseline, file) ? baseline[file] : null;
        const now = current[file] || 0;
        if (was === null) {
            if (now > 0) {
                fresh.push(file);
            }
        } else if (now > was) {
            grown.push(file);
        } else if (now < was) {
            shrunk.push(file);
        }
    }
    return { grown, shrunk, fresh };
}

/**
 * Новая база для `--write`: только вниз. Рост (и новый файл с ошибками) —
 * отказ, база не трогается. Файлы с нулём из базы удаляются.
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} current
 * @returns {{ok: true, baseline: Record<string, number>} | {ok: false, grown: string[]}}
 */
function nextBaseline(baseline, current) {
    const { grown, fresh } = compare(baseline, current);
    const up = [...grown, ...fresh].sort();
    if (up.length > 0) {
        return { ok: false, grown: up };
    }
    return { ok: true, baseline: sortedCounts(current) };
}

function sortedCounts(counts) {
    /** @type {Record<string, number>} */
    const out = {};
    for (const file of Object.keys(counts).sort()) {
        if (counts[file] > 0) {
            out[file] = counts[file];
        }
    }
    return out;
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
    return JSON.parse(fs.readFileSync(baselinePath(), 'utf8'));
}

function writeBaseline(counts) {
    fs.writeFileSync(baselinePath(), `${JSON.stringify(sortedCounts(counts), null, 2)}\n`);
}

function total(counts) {
    return Object.values(counts).reduce((a, b) => a + b, 0);
}

function printFileErrors(file, errors) {
    const seen = new Set();
    for (const e of errors) {
        if (e.file !== file || seen.has(errorKey(e))) {
            continue;
        }
        seen.add(errorKey(e));
        console.error(`    ${e.file}(${e.line},${e.col}): ${e.code}: ${e.message}`);
    }
}

function main(argv) {
    const write = argv.includes('--write');
    const configs = (process.env.TYPECHECK_CONFIGS || DEFAULT_CONFIGS.join(','))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((c) => path.resolve(REPO, c));

    const all = [];
    for (const cfg of configs) {
        const name = path.relative(REPO, cfg) || cfg;
        const root = path.dirname(cfg);
        let files;
        let run;
        try {
            files = listProjectFiles(cfg);
            if (files.length > 0) {
                run = runTscFull(cfg);
            }
        } catch (err) {
            console.error(`[typecheck] ${name}: tsc не отработал: ${err.message}`);
            return 1;
        }
        if (files.length === 0) {
            console.error(`[typecheck] ${name}: tsc не нашёл ни одного файла проекта — пустой include дал бы ложный «0 ошибок».`);
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
    const baseline = readBaseline();

    if (write) {
        if (baseline === null) {
            writeBaseline(current);
            console.log(`[typecheck] база создана: ${total(current)} ошибок в ${Object.keys(current).length} файлах.`);
            return 0;
        }
        const next = nextBaseline(baseline, current);
        if (!next.ok) {
            console.error('[typecheck] --write отказывается поднимать базу. Выросли:');
            for (const file of next.grown) {
                console.error(`  ${file}: ${baseline[file] || 0} → ${current[file]}`);
                printFileErrors(file, errors);
            }
            return 1;
        }
        writeBaseline(next.baseline);
        console.log(`[typecheck] база: ${total(baseline)} → ${total(next.baseline)}`);
        return 0;
    }

    const base = baseline || {};
    const { grown, shrunk, fresh } = compare(base, current);
    for (const file of [...grown, ...fresh]) {
        console.error(`[typecheck] ${file}: ${base[file] || 0} → ${current[file]} (база ${file in base ? base[file] : 'нет'})`);
        printFileErrors(file, errors);
    }
    if (shrunk.length > 0) {
        console.error('[typecheck] ошибок стало меньше базы — опусти базу: npm run typecheck -- --write');
        for (const file of shrunk) {
            console.error(`  ${file}: ${base[file]} → ${current[file] || 0}`);
        }
    }
    if (grown.length || shrunk.length || fresh.length) {
        return 1;
    }
    console.log(`[typecheck] OK: ${total(current)} ошибок, совпадает с базой.`);
    return 0;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { parseTscOutput, tally, compare, nextBaseline, runTsc, listProjectFiles, isAppFile };
