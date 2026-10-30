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
const CEILING = 85;

const LEGIT = /пауза законна:/g;

/**
 * Пометка считается, только если она стоит В КОММЕНТАРИИ (не в строке) и
 * этот комментарий — на строке самого вызова или ЗАНИМАЕТ ВСЮ предыдущую
 * строку. Хвостовой комментарий соседнего кода чужую паузу не узаконивает:
 * `await a.waitForTimeout(1); // пауза законна: …` на строке N ничего не
 * говорит о вызове на строке N+1.
 *
 * @param {string} src
 * @returns {{counted: number[], legit: number[]}} номера строк (с 1)
 */
function scanPauses(src) {
    const comments = [];
    const mask = maskNonCode(src, { regexLiterals: true, comments });
    const inComment = (i) => comments.some(([a, b]) => i >= a && i < b);

    // Начало каждой строки — чтобы переводить индексы в номера и обратно.
    const starts = [0];
    for (let i = 0; i < src.length; i++) { if (src[i] === '\n') { starts.push(i + 1); } }
    const lineOf = (i) => {
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= i) { lo = mid; } else { hi = mid - 1; }
        }
        return lo + 1;
    };
    const lineRange = (n) => [starts[n - 1], n < starts.length ? starts[n] - 1 : src.length];

    // Строки с пометкой в комментарии.
    const markedSame = new Set();
    for (const m of src.matchAll(LEGIT)) {
        if (inComment(m.index)) { markedSame.add(lineOf(m.index)); }
    }
    // Строка целиком комментарий: всё непробельное — внутри комментариев.
    const wholeComment = (n) => {
        if (n < 1) { return false; }
        const [a, b] = lineRange(n);
        let any = false;
        for (let i = a; i < b; i++) {
            if (/\s/.test(src[i])) { continue; }
            if (!inComment(i)) { return false; }
            any = true;
        }
        return any;
    };

    const counted = [];
    const legit = [];
    for (const m of mask.matchAll(/\bwaitForTimeout\s*\(/g)) {
        const n = lineOf(m.index);
        const ok = markedSame.has(n) || (markedSame.has(n - 1) && wholeComment(n - 1));
        (ok ? legit : counted).push(n);
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
        "await page.waitForTimeout(300);",                          // 4: законна (вся строка выше — пометка)
        "// await page.waitForTimeout(400);",                       // 5: комментарий — не вызов
        "const s = 'waitForTimeout(500)';",                         // 6: строка — не вызов
        "/* page.waitForTimeout(600) */",                           // 7: блок-комментарий
        "// TODO-пауза: нужно условие",                             // 8
        "await page.waitForTimeout(700);",                          // 9: в счёт
        "await page.waitForTimeout (800);",                         // 10: в счёт, пробел перед скобкой
        "await a.waitForTimeout(1); // пауза законна: своя пауза",  // 11: законна
        "await b.waitForTimeout(900);",                             // 12: в счёт — хвост строки 11 не про неё
        "const t = 'пауза законна: в строке'; await c.waitForTimeout(1000);", // 13: в счёт — пометка в строке
        "const u = '// пауза законна: в строке';",                  // 14: строка, не комментарий
        "await d.waitForTimeout(1100);",                            // 15: в счёт
        "    /* пауза законна: блоком на всю строку */",            // 16
        "await e.waitForTimeout(1200);"                             // 17: законна
    ].join('\n');
    const { counted, legit } = scanPauses(fixture);
    assert.deepEqual(counted, [1, 9, 10, 12, 13, 15]);
    assert.deepEqual(legit, [2, 4, 11, 17]);
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
