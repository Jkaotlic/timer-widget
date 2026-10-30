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
const CEILING = 51;

/**
 * Пометка законной паузы. Две, и у каждой свой смысл:
 *  - `пауза законна: <почему>` — тест утверждает ОТСУТСТВИЕ события за
 *    интервал, меряет сам интервал или ждёт таймер ТОЙ ЖЕ длины, взведённый
 *    после таймера приложения (равные задержки исполняются в порядке взвода);
 *  - `шаг опроса: <что опрашивается>` — сон между двумя проверками условия в
 *    цикле опроса: ждётся условие, а сон лишь задаёт шаг.
 */
const LEGIT = /пауза законна:|шаг опроса:/g;

/**
 * Сон-обещание: `new Promise((r) => setTimeout(r, N))` (и без скобок, и с
 * телом-блоком). Таймер, чей первый аргумент — НЕ resolve этого обещания
 * (страховка `setTimeout(done, 8000)`, `setTimeout(() => reject(…))`), —
 * не сон. Группы: 1/2 — имя параметра, 3 — первый аргумент setTimeout.
 */
const PROMISE_SLEEP = /\bnew\s+Promise\s*\(\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*\)|([A-Za-z_$][\w$]*))\s*=>\s*\{?\s*setTimeout\s*\(\s*([A-Za-z_$][\w$]*)\s*,/g;

/** Сон-обещание — тело помощника: `const wait = (ms) => new Promise(…)` / `function wait(ms) { return new Promise(…)`. */
const HELPER_ARROW = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*$/;
const HELPER_FUNCTION = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{\s*return\s+$/;

/**
 * Паузы в исходнике e2e. Пауза — это:
 *  - `waitForTimeout(…)`;
 *  - сон-обещание `new Promise((r) => setTimeout(r, N))` — где бы он ни
 *    исполнялся: в Node, в окне (`page.evaluate`) или в main
 *    (`app.evaluate`). Сон внутри `evaluate` — та же ставка на скорость
 *    машины, что `waitForTimeout`, только незаметная (до 31.10.2026 храповик
 *    его не видел — ревью e2e-B6, M4);
 *  - вызов помощника, чьё тело — такой сон (`const wait = (ms) => new
 *    Promise(…)`; `await wait(600)`). Само определение не считается — паузой
 *    является каждый вызов, и пометку несёт он.
 *
 * Пометка считается, только если она стоит В КОММЕНТАРИИ (не в строке) и
 * этот комментарий — на строке самой паузы или в сплошном блоке строк-
 * комментариев прямо над ней. Хвостовой комментарий соседнего кода чужую
 * паузу не узаконивает: `await a.waitForTimeout(1); // пауза законна: …` на
 * строке N ничего не говорит о вызове на строке N+1 — строка N не целиком
 * комментарий и обрывает блок.
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
    const marked = new Set();
    for (const m of src.matchAll(LEGIT)) {
        if (inComment(m.index)) { marked.add(lineOf(m.index)); }
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
    const isLegit = (n) => {
        if (marked.has(n)) { return true; }
        for (let k = n - 1; wholeComment(k); k--) {
            if (marked.has(k)) { return true; }
        }
        return false;
    };

    const at = [];
    for (const m of mask.matchAll(/\bwaitForTimeout\s*\(/g)) { at.push(m.index); }

    const helpers = [];
    const definitions = new Set();
    for (const m of mask.matchAll(PROMISE_SLEEP)) {
        if ((m[1] || m[2]) !== m[3]) { continue; }
        const head = mask.slice(Math.max(0, m.index - 200), m.index);
        const def = head.match(HELPER_ARROW) || head.match(HELPER_FUNCTION);
        if (def) {
            helpers.push(def[1]);
            definitions.add(m.index - head.length + def.index + def[0].indexOf(def[1]));
        } else {
            at.push(m.index);
        }
    }
    for (const name of new Set(helpers)) {
        const call = new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
        for (const m of mask.matchAll(call)) {
            if (!definitions.has(m.index)) { at.push(m.index); }
        }
    }

    const counted = [];
    const legit = [];
    for (const i of at.sort((a, b) => a - b)) {
        const n = lineOf(i);
        (isLegit(n) ? legit : counted).push(n);
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

test('счётчик видит сон-обещание и его помощников — и внутри evaluate', () => {
    const fixture = [
        "await page.evaluate(async () => {",                          // 1
        "    await new Promise((r) => setTimeout(r, 400));",          // 2: в счёт — сон в окне
        "});",                                                        // 3
        "await new Promise(r => setTimeout(r, 50));",                 // 4: в счёт — без скобок
        "await new Promise((resolve) => { setTimeout(resolve, 10); });", // 5: в счёт — тело-блок
        "await new Promise((resolve) => { const t = setTimeout(done, 9); });", // 6: не сон — таймер не resolve
        "const t = setTimeout(() => reject(new Error('x')), 100);",   // 7: не сон
        "const wait = (ms) => new Promise((res) => setTimeout(res, ms));", // 8: определение — не в счёт
        "await wait(60);",                                            // 9: в счёт — вызов помощника
        "// пауза законна: шаг жеста",                                 // 10
        "await wait(30);",                                            // 11: законна
        "await obj.wait(1);",                                         // 12: не тот wait — метод
        "const s = 'new Promise((r) => setTimeout(r, 1))';",          // 13: строка
        "// await new Promise((r) => setTimeout(r, 1));",             // 14: комментарий
        "for (;;) {",                                                 // 15
        "    if (ok()) { break; }",                                   // 16
        "    // шаг опроса: окно появилось",                           // 17
        "    await new Promise((r) => setTimeout(r, 100));",          // 18: законна — шаг опроса
        "}",                                                          // 19
        "// пауза законна: несколько строк основания —",               // 20
        "// вторая строка того же блока",                             // 21
        "await page.waitForTimeout(5);",                              // 22: законна — пометка в блоке над ней
        "// пауза законна: про вызов ниже",                            // 23
        "x();",                                                       // 24: код обрывает блок
        "await page.waitForTimeout(6);",                              // 25: в счёт
        "function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }", // 26: определение
        "await sleep(7);",                                            // 27: в счёт
        "await new Promise((r) => requestAnimationFrame(r));"         // 28: кадр — не сон
    ].join('\n');
    const { counted, legit } = scanPauses(fixture);
    assert.deepEqual(counted, [2, 4, 5, 9, 25, 27]);
    assert.deepEqual(legit, [11, 18, 22]);
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
