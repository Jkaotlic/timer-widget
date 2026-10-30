'use strict';

/**
 * Пауза в e2e — ставка на скорость машины, и число таких ставок только убывает.
 *
 * Правило проекта: окно и всё, что в нём меняется, ждут УСЛОВИЕМ — тем, что
 * проверяет следующее утверждение (`expect.poll`, `waitForFunction`, ожидания
 * из e2e/window-ready.js). Замер 30.10.2026: 598 `waitForTimeout` в 67 файлах,
 * сумма литералов ≈ 600 с из 1443 с полного прогона. Убрать их одним заходом
 * нельзя — у каждой паузы своё условие, его надо найти, — поэтому здесь
 * ХРАПОВИК, а не запрет: число записано и может только опускаться.
 *
 * Законная пауза одна: тест утверждает ОТСУТСТВИЕ события за интервал (звук не
 * повторился, окно не дёрнулось) или меряет сам интервал. Она помечается
 * комментарием `// пауза законна: <почему>` на той же или предыдущей строке и
 * в счёт не идёт. `// TODO-пауза: …` — пауза, для которой условие пока не
 * нашлось; она в счёте.
 *
 * Вызов ищется в КОДЕ: `maskNonCode()` из tests/helpers/source-scan.js гасит
 * комментарии и строки, сохраняя индексы, — поэтому позиция вызова переводится
 * в номер строки исходника, где и ищется пометка (`codeOnly()` пометку бы
 * стёр, а склейка строк сдвинула бы номера).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskNonCode } = require('./helpers/source-scan');

const repoRoot = path.join(__dirname, '..');
const E2E_DIR = path.join(repoRoot, 'e2e');

/**
 * ПОТОЛОК. Число только убывает: правка, убравшая паузы, опускает его до
 * факта в том же коммите (тест требует равенства — запас здесь означал бы,
 * что новые паузы можно добавлять молча).
 */
const CEILING = 526;

const LEGIT = /пауза законна:/;

/**
 * @param {string} src
 * @returns {{counted: number[], legit: number[]}} номера строк (с 1)
 */
function scanPauses(src) {
    const mask = maskNonCode(src, { regexLiterals: true });
    const lines = src.split('\n');
    const counted = [];
    const legit = [];
    for (const m of mask.matchAll(/\bwaitForTimeout\s*\(/g)) {
        const lineNo = mask.slice(0, m.index).split('\n').length;
        const same = lines[lineNo - 1] || '';
        const prev = lines[lineNo - 2] || '';
        if (LEGIT.test(same) || LEGIT.test(prev)) {
            legit.push(lineNo);
        } else {
            counted.push(lineNo);
        }
    }
    return { counted, legit };
}

function e2eFiles(dir) {
    const out = [];
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) { out.push(...e2eFiles(p)); }
        else if (d.isFile() && d.name.endsWith('.js')) { out.push(p); }
    }
    return out;
}

test('счётчик пауз проверяет сам себя на фикстуре', () => {
    const fixture = [
        "await page.waitForTimeout(100);",                          // 1: в счёт
        "await page.waitForTimeout(200); // пауза законна: звук не повторился", // 2: законна
        "// пауза законна: окно не дёрнулось за интервал",           // 3
        "await page.waitForTimeout(300);",                          // 4: законна (пометка выше)
        "// await page.waitForTimeout(400);",                       // 5: комментарий — не вызов
        "const s = 'waitForTimeout(500)';",                         // 6: строка — не вызов
        "/* page.waitForTimeout(600) */",                           // 7: блок-комментарий
        "// TODO-пауза: нужно условие",                             // 8
        "await page.waitForTimeout(700);",                          // 9: в счёт
        "await page.waitForTimeout (800);"                          // 10: в счёт, пробел перед скобкой
    ].join('\n');
    const { counted, legit } = scanPauses(fixture);
    assert.deepEqual(counted, [1, 9, 10]);
    assert.deepEqual(legit, [2, 4]);
});

test('паузы в e2e: храповик — число только убывает', () => {
    let total = 0;
    const perFile = [];
    for (const file of e2eFiles(E2E_DIR)) {
        const { counted } = scanPauses(fs.readFileSync(file, 'utf8'));
        total += counted.length;
        if (counted.length) { perFile.push(`${path.relative(repoRoot, file)}: ${counted.length}`); }
    }
    assert.ok(
        total <= CEILING,
        `пауз в e2e стало ${total}, потолок ${CEILING}. Новая пауза — ставка на скорость `
        + 'машины: ждите то, что проверяет следующее утверждение, или пометьте '
        + '`// пауза законна: <почему>`, если тест утверждает отсутствие события.\n  '
        + perFile.join('\n  ')
    );
    assert.equal(
        total, CEILING,
        `пауз в e2e ${total}, а потолок ${CEILING}: опустите CEILING в tests/e2e-pauses.test.js `
        + 'до факта — храповик держится рядом с фактом, иначе в запас пролезут новые паузы'
    );
});
