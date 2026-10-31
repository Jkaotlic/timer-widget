'use strict';

/**
 * Пауза в e2e — ставка на скорость машины, и число таких ставок только убывает.
 *
 * Правило проекта: окно и всё, что в нём меняется, ждут УСЛОВИЕМ — тем, что
 * проверяет следующее утверждение (`expect.poll`, `waitForFunction`, ожидания
 * из e2e/window-ready.js). Замер 30.10.2026: 598 `waitForTimeout` в 67 файлах,
 * сумма литералов ≈ 600 с из 1443 с полного прогона. Убрать их одним заходом
 * было нельзя — у каждой паузы своё условие, — поэтому здесь ХРАПОВИК, а не
 * запрет: число записано и может только опускаться (с 31.10.2026 — ноль).
 *
 * ЧТО СЧИТАЕТСЯ ПАУЗОЙ (всё — по коду, комментарии и строки погашены
 * `maskNonCode()` из tests/helpers/source-scan.js):
 *  - `waitForTimeout(…)`;
 *  - сон-обещание: `setTimeout`, чей первый аргумент сводится к resolve
 *    обещания (`r`, `() => r()`, `function () { r(); }`), где бы он ни стоял в
 *    теле `new Promise(…)`: параметров сколько угодно, исполнитель — стрелка
 *    или `function`, префикс `window.`/`globalThis.`/`self.`, задержки может
 *    не быть. Где бы обещание ни исполнялось: в Node, в окне
 *    (`page.evaluate`), в main (`app.evaluate`). Если resolve зовётся и
 *    вне этого таймера (гонка «событие или срок»), это не сон, а страховка;
 *  - вызов ПОМОЩНИКА-сна — функции, чьё тело только этот сон (`const wait =
 *    (ms) => new Promise(…)`, тело-блок, `async function`, метод объекта) — и
 *    его псевдонимов, ВО ВСЕХ файлах e2e/: помощник из window-ready.js
 *    считается в каждой спеке, где его зовут. Определение — не пауза, и
 *    пометка на нём ничего не узаконивает: пометку несёт каждый вызов;
 *  - любое упоминание `timers/promises` и вызовы взятых из него имён,
 *    `scheduler.wait(…)`;
 *  - всё перечисленное внутри кода-СТРОКИ, переданной в `evaluate`,
 *    `waitForFunction`, `addInitScript`, `executeJavaScript`.
 *
 * Не считается (и это не разрешение, а граница механики): таймер-ДЕЙСТВИЕ
 * (`setTimeout(() => app.quit(), 300)`) и ожидание условия с проглоченным
 * таймаутом (`waitForSelector(…).catch(() => {})`) — когда условие не
 * наступает, оно спит до срока. Такие места называются в отчётах пачек.
 *
 * ЗАКОННАЯ ПАУЗА — три вида, решение контроллера 31.10.2026:
 *  - `// пауза законна: <почему>` — тест утверждает ОТСУТСТВИЕ события за
 *    интервал (звук не повторился, окно не дёрнулось) или меряет сам интервал;
 *  - `// пауза законна: <почему>` — таймер ТОЙ ЖЕ длины, что таймер
 *    приложения (debounce, отложенная запись), взведённый ПОСЛЕ него: равные
 *    задержки исполняются в порядке взвода. Держится, пока приложение не
 *    перевзводит свой таймер позже нашего — поэтому перед ним ждётся
 *    устоявшееся состояние;
 *  - `// шаг опроса: <что опрашивается>` — сон между проверками условия.
 *    Законен, ТОЛЬКО если стоит внутри `for`/`while`/`do`, чей заголовок или
 *    тело ссылается на срок (`Date.now()` или `deadline`); иначе — в счёте.
 * Пометка — в комментарии на строке паузы или в сплошном блоке строк-
 * комментариев прямо над ней. `// TODO-пауза: …` — пауза без условия, в счёте.
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
const CEILING = 0;

const MARK_ABSENCE = /пауза законна:/g;
const MARK_POLL = /шаг опроса:/g;
const ID = '[A-Za-z_$][\\w$]*';
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'do', 'else']);
const EVAL_STRING = /\.(?:evaluate|evaluateHandle|waitForFunction|addInitScript|executeJavaScript)\s*\(\s*(['"`])/g;

const esc = (name) => name.replace(/\$/g, '\\$');

/** Индекс закрывающей скобки для открывающей в `open` (по маске). */
function matchClose(mask, open) {
    const pairs = { '(': ')', '{': '}', '[': ']' };
    const want = pairs[mask[open]];
    let depth = 0;
    for (let i = open; i < mask.length; i++) {
        const c = mask[i];
        if (c === '(' || c === '{' || c === '[') { depth++; }
        else if (c === ')' || c === '}' || c === ']') {
            depth--;
            if (depth === 0) { return c === want ? i : -1; }
        }
    }
    return -1;
}

/** Первый аргумент вызова: от `open + 1` до запятой верхнего уровня. */
function firstArg(mask, open, close) {
    let depth = 0;
    for (let i = open + 1; i < close; i++) {
        const c = mask[i];
        if (c === '(' || c === '{' || c === '[') { depth++; }
        else if (c === ')' || c === '}' || c === ']') { depth--; }
        else if (c === ',' && depth === 0) { return [open + 1, i]; }
    }
    return [open + 1, close];
}

/**
 * Сны-обещания в маске: [{at, helper?: {name, def}}]. `helper` — если всё
 * тело охватывающей функции и есть этот сон.
 */
function promiseSleeps(mask) {
    const out = [];
    for (const m of mask.matchAll(/\bnew\s+Promise\s*\(/g)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(mask, open);
        if (close < 0) { continue; }
        const exec = mask.slice(open + 1, close);
        const head = new RegExp(`^\\s*(?:async\\s+)?(?:function\\s*(?:${ID})?\\s*\\(\\s*(${ID})?[^)]*\\)|\\(\\s*(${ID})?[^)]*\\)|(${ID}))\\s*(?:=>)?\\s*`).exec(exec);
        if (!head) { continue; }
        const r = head[1] || head[2] || head[3];
        if (!r) { continue; }
        const bodyStart = open + 1 + head[0].length;
        const uses = new RegExp(`\\b${esc(r)}\\b`);
        const calls = new RegExp(`\\b${esc(r)}\\s*\\(`);
        let sleep = false;
        for (const t of mask.slice(bodyStart, close).matchAll(/(?:\b(?:window|globalThis|self)\s*\.\s*)?\bsetTimeout\s*\(/g)) {
            const tOpen = bodyStart + t.index + t[0].length - 1;
            const tClose = matchClose(mask, tOpen);
            if (tClose < 0) { continue; }
            const [a, b] = firstArg(mask, tOpen, tClose);
            const arg = mask.slice(a, b).trim();
            const resolves = arg === r || (/=>|\bfunction\b/.test(arg) && calls.test(arg));
            if (!resolves) { continue; }
            const outside = mask.slice(bodyStart, bodyStart + t.index) + mask.slice(tClose + 1, close);
            if (!uses.test(outside)) { sleep = true; }
        }
        if (!sleep) { continue; }
        out.push({ at: m.index, helper: helperOf(mask, m.index, close) });
    }
    return out;
}

/** Помощник, чьё тело — только сон в [at, close]: {name, def} или null. */
function helperOf(mask, at, close) {
    const before = mask.slice(Math.max(0, at - 300), at);
    const base = at - before.length;
    const after = mask.slice(close + 1, close + 40);
    const named = (headEnd) => {
        const pre = mask.slice(Math.max(0, headEnd - 300), headEnd);
        const pb = headEnd - pre.length;
        let m = new RegExp(`(?:\\b(?:const|let|var)\\s+(${ID})\\s*=|(?:^|[{,\\s])(${ID})\\s*:)\\s*(?:async\\s+)?(?:\\([^()]*\\)|${ID})\\s*=>\\s*$`).exec(pre);
        if (m) { const n = m[1] || m[2]; return { name: n, def: pb + m.index + m[0].indexOf(n) }; }
        m = new RegExp(`\\b(?:async\\s+)?function\\s*\\*?\\s*(${ID})\\s*\\([^()]*\\)\\s*$`).exec(pre);
        if (m) { return { name: m[1], def: pb + m.index + m[0].indexOf(m[1]) }; }
        m = new RegExp(`(?:^|[{,;\\s])(?:async\\s+)?(${ID})\\s*\\([^()]*\\)\\s*$`).exec(pre);
        if (m && !KEYWORDS.has(m[1])) { return { name: m[1], def: pb + m.index + m[0].indexOf(m[1]) }; }
        return null;
    };
    // Тело-выражение стрелки: `… => new Promise(…)` и дальше конец выражения.
    if (/(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*$/.test(before) && /^\s*(?:[;,)}\]]|$)/.test(after)) {
        return named(at);
    }
    // Тело-блок: `{ return|await new Promise(…); }`.
    const blk = /\{\s*(?:return|await)\s+$/.exec(before);
    if (blk && /^\s*;?\s*\}/.test(after)) {
        const brace = base + blk.index;
        return named(brace);
    }
    return null;
}

/**
 * Разбор одного файла: где паузы (индексы в исходнике) и какие помощники-сны
 * он определяет. `extraNames` — имена помощников из ВСЕХ файлов.
 */
function analyse(src, extraNames = new Set()) {
    const comments = [];
    const mask = maskNonCode(src, { regexLiterals: true, comments });
    const inComment = (i) => comments.some(([a, b]) => i >= a && i < b);
    const at = [];
    for (const m of mask.matchAll(/\bwaitForTimeout\s*\(/g)) { at.push(m.index); }
    for (const m of mask.matchAll(/\bscheduler\s*\.\s*wait\s*\(/g)) { at.push(m.index); }

    const helpers = new Map();
    for (const sl of promiseSleeps(mask)) {
        if (sl.helper) { helpers.set(sl.helper.name, sl.helper.def); } else { at.push(sl.at); }
    }
    // timers/promises: само упоминание — пауза, взятые имена — помощники.
    for (const m of src.matchAll(/timers\/promises/g)) {
        if (inComment(m.index)) { continue; }
        at.push(m.index);
        const pre = mask.slice(Math.max(0, m.index - 200), m.index);
        const d = /\{([^{}]*)\}\s*=\s*require\s*\(\s*['"`]?\s*$/.exec(pre);
        if (d) {
            for (const part of d[1].split(',')) {
                const nm = part.split(':').pop().trim();
                if (nm) { helpers.set(nm, -1); }
            }
        }
    }
    // Код-строка в evaluate & co: тот же разбор над её содержимым.
    for (const m of mask.matchAll(EVAL_STRING)) {
        const q = m.index + m[0].length - 1;
        if (inComment(q)) { continue; }
        const end = mask.indexOf(m[1], q + 1);
        if (end < 0) { continue; }
        const inner = analyse(src.slice(q + 1, end));
        for (const i of inner.at) { at.push(q + 1 + i); }
    }
    return { mask, comments, at, helpers, extraNames };
}

/** Псевдонимы: `const pause = wait;`, деструктуризация `{ wait: pause } = …` (не литерал объекта `{ wait: x }`). */
function addAliases(mask, names) {
    let grew = true;
    while (grew) {
        grew = false;
        for (const n of [...names]) {
            const re = new RegExp(`\\b(?:const|let|var)\\s+(${ID})\\s*=\\s*(?:${ID}\\s*\\.\\s*)*${esc(n)}\\s*[;,\\n]|\\{[^{}]*\\b${esc(n)}\\s*:\\s*(${ID})[^{}]*\\}\\s*=(?!=)`, 'g');
            for (const m of mask.matchAll(re)) {
                const a = m[1] || m[2];
                if (a && !names.has(a)) { names.add(a); grew = true; }
            }
        }
    }
}

/** Пауза в цикле со сроком: ближайший охватывающий for/while/do и в нём Date.now()/deadline. */
function inPollLoop(mask, idx) {
    let depth = 0;
    for (let i = idx; i >= 0; i--) {
        const c = mask[i];
        if (c === '}') { depth++; continue; }
        if (c !== '{') { continue; }
        if (depth) { depth--; continue; }
        const pre = mask.slice(Math.max(0, i - 400), i);
        let kw = /\b(for|while)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*$/.exec(pre);
        let from;
        let isDo = false;
        if (kw) { from = i - pre.length + kw.index; }
        else if ((kw = /\bdo\s*$/.exec(pre))) { from = i - pre.length + kw.index; isDo = true; }
        else { continue; }
        const end = matchClose(mask, i);
        let to = end < 0 ? mask.length : end + 1;
        // Условие `do { … } while (…)` — после тела; у for/while хвоста нет.
        const tail = isDo ? /^\s*while\s*\((?:[^()]|\([^()]*\))*\)/.exec(mask.slice(to)) : null;
        if (tail) { to += tail[0].length; }
        return /\bdeadline\b|Date\s*\.\s*now\s*\(/.test(mask.slice(from, to));
    }
    return false;
}

/**
 * Паузы по файлам. `files` — {имя: исходник}. Помощники-сны собираются по
 * ВСЕМ файлам первым проходом, вызовы считаются во всех.
 *
 * @returns {Record<string, {counted: number[], legit: number[], reasons: string[]}>}
 */
function scanAll(files) {
    const parsed = {};
    const names = new Set();
    for (const [f, src] of Object.entries(files)) {
        parsed[f] = analyse(src);
        for (const n of parsed[f].helpers.keys()) { names.add(n); }
    }
    for (const f of Object.keys(files)) { addAliases(parsed[f].mask, names); }
    const out = {};
    for (const [f, src] of Object.entries(files)) {
        const { mask, comments, at } = parsed[f];
        const defs = new Set([...parsed[f].helpers.values()]);
        // Вызовы помощников (и как метода: `wr.sleep(…)`). Определение — не вызов.
        for (const n of names) {
            for (const m of mask.matchAll(new RegExp(`(?<![\\w$])${esc(n)}\\s*\\(`, 'g'))) {
                if (defs.has(m.index)) { continue; }
                const pre = mask.slice(Math.max(0, m.index - 20), m.index);
                if (/\bfunction\s*\*?\s*$/.test(pre)) { continue; }
                at.push(m.index);
            }
        }
        out[f] = judge(src, mask, comments, [...new Set(at)].sort((a, b) => a - b));
    }
    return out;
}

function judge(src, mask, comments, at) {
    const inComment = (i) => comments.some(([a, b]) => i >= a && i < b);
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
    const markedLines = (re) => {
        const set = new Set();
        for (const m of src.matchAll(re)) { if (inComment(m.index)) { set.add(lineOf(m.index)); } }
        return set;
    };
    const absence = markedLines(MARK_ABSENCE);
    const poll = markedLines(MARK_POLL);
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
    const markOf = (n) => {
        const lines = [n];
        for (let k = n - 1; wholeComment(k); k--) { lines.push(k); }
        if (lines.some((l) => absence.has(l))) { return 'absence'; }
        if (lines.some((l) => poll.has(l))) { return 'poll'; }
        return null;
    };
    const counted = [];
    const legit = [];
    const reasons = [];
    for (const i of at) {
        const n = lineOf(i);
        const mark = markOf(n);
        if (mark === 'absence' || (mark === 'poll' && inPollLoop(mask, i))) { legit.push(n); continue; }
        counted.push(n);
        if (mark === 'poll') { reasons.push(`${n}: «шаг опроса» вне цикла со сроком`); }
    }
    return { counted, legit, reasons };
}

/** Один исходник (фикстуры). */
function scanPauses(src) { return scanAll({ 'файл.js': src })['файл.js']; }

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
        "await obj.wait(1);",                                         // 12: в счёт — то же имя методом
        "const s = 'new Promise((r) => setTimeout(r, 1))';",          // 13: строка, не код
        "// await new Promise((r) => setTimeout(r, 1));",             // 14: комментарий
        "while (Date.now() < deadline) {",                            // 15
        "    if (ok()) { break; }",                                   // 16
        "    // шаг опроса: окно появилось",                           // 17
        "    await new Promise((r) => setTimeout(r, 100));",          // 18: законна — шаг опроса со сроком
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
    assert.deepEqual(counted, [2, 4, 5, 9, 12, 25, 27]);
    assert.deepEqual(legit, [11, 18, 22]);
});

test('счётчик ловит все записи сна (ревью e2e-B7b, I1)', () => {
    const fixture = [
        "await new Promise(r => setTimeout(() => r(), 100));",          // 1: в счёт — стрелка вместо r
        "await new Promise((r, _j) => setTimeout(r, 100));",            // 2: в счёт — два параметра
        "await new Promise(function (r) { setTimeout(r, 100); });",     // 3: в счёт — function
        "await new Promise((r) => { log(); setTimeout(r, 100); });",    // 4: в счёт — оператор перед
        "await new Promise(r => window.setTimeout(r, 100));",           // 5: в счёт — window.
        "await new Promise(r => globalThis.setTimeout(r, 100));",       // 6: в счёт — globalThis.
        "await new Promise(r => setTimeout(r));",                       // 7: в счёт — без задержки
        "await new Promise((r) => setTimeout(function () { r(); }, 5));", // 8: в счёт — function внутри
        "const { setTimeout: nap } = require('node:timers/promises');", // 9: в счёт — само упоминание
        "await nap(100);",                                              // 10: в счёт — взятое имя
        "await require('timers/promises').setTimeout(100);",            // 11: в счёт
        "await scheduler.wait(100);",                                   // 12: в счёт
        "await page.evaluate('new Promise(r => setTimeout(r, 100))');", // 13: в счёт — код строкой
        "await page.evaluate(`page.waitForTimeout(5)`);",              // 14: в счёт — код шаблоном
        "const pause = wait2;",                                         // 15: псевдоним
        "const wait2 = (ms) => { return new Promise((r) => setTimeout(r, ms)); };", // 16: помощник телом-блоком
        "await pause(5);",                                              // 17: в счёт — через псевдоним
        "await wait2(5);",                                              // 18: в счёт
        "async function nap2(ms) { await new Promise((r) => setTimeout(r, ms)); }", // 19: помощник async
        "await nap2(1);",                                               // 20: в счёт
        "const o = { snooze: (ms) => new Promise((r) => setTimeout(r, ms)) };", // 21: метод-помощник
        "await o.snooze(1);",                                           // 22: в счёт
        "// пауза законна: пометка на определении ничего не узаконивает", // 23
        "const doze = (ms) => new Promise((r) => setTimeout(r, ms));",  // 24: определение
        "await doze(1);",                                               // 25: в счёт
        // Страховка, а не сон: resolve зовётся и по событию.
        "await new Promise((resolve) => { win.once('x', () => resolve('e')); setTimeout(() => resolve('t'), 9); });", // 26
        "await new Promise((r) => requestAnimationFrame(() => r()));"   // 27: кадр — не сон
    ].join('\n');
    const { counted, legit } = scanPauses(fixture);
    assert.deepEqual(counted, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 20, 22, 25]);
    assert.deepEqual(legit, []);
});

test('помощник-сон из ОБЩЕГО модуля считается в каждом файле, где его зовут', () => {
    const files = {
        'window-ready.js': [
            "// пауза законна: пометка на определении — не на вызовах",
            "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
            "module.exports = { sleep };"
        ].join('\n'),
        'a.spec.js': [
            "const { sleep } = require('./window-ready');",
            "await sleep(500);",                                        // 2: в счёт
            "const wr = require('./window-ready');",
            "await wr.sleep(5);",                                       // 4: в счёт — через объект
            "const { sleep: zz } = require('./window-ready');",
            "await zz(1);"                                              // 6: в счёт — псевдоним
        ].join('\n')
    };
    const res = scanAll(files);
    assert.deepEqual(res['window-ready.js'].counted, []);
    assert.deepEqual(res['a.spec.js'].counted, [2, 4, 6]);
});

test('«шаг опроса» законен только в цикле со сроком (ревью e2e-B7b, I2)', () => {
    const fixture = [
        "// шаг опроса: ничего",                                       // 1
        "await new Promise((r) => setTimeout(r, 3000));",              // 2: в счёт — сон один
        "for (;;) {",                                                  // 3
        "    // шаг опроса: без срока",                                 // 4
        "    await new Promise((r) => setTimeout(r, 100));",           // 5: в счёт — цикл без срока
        "}",                                                           // 6
        "while (Date.now() < deadline) {",                             // 7
        "    // шаг опроса: со сроком",                                 // 8
        "    await new Promise((r) => setTimeout(r, 100));",           // 9: законна
        "}",                                                           // 10
        "const end = Date.now() + 1000;",                              // 11
        "for (;;) {",                                                  // 12
        "    if (Date.now() > end) { throw new Error('x'); }",         // 13
        "    if (more()) {",                                           // 14
        "        // шаг опроса: во вложенном if",                       // 15
        "        await page.waitForTimeout(50);",                      // 16: законна — цикл со сроком снаружи
        "    }",                                                       // 17
        "}",                                                           // 18
        "do {",                                                        // 19
        "    // шаг опроса: do … while со сроком",                      // 20
        "    await page.waitForTimeout(50);",                          // 21: законна
        "} while (Date.now() < deadline);"                             // 22
    ].join('\n');
    const { counted, legit, reasons } = scanPauses(fixture);
    assert.deepEqual(counted, [2, 5]);
    assert.deepEqual(legit, [9, 16, 21]);
    assert.equal(reasons.length, 2);
});

test('паузы в e2e: храповик — число только убывает', () => {
    const list = e2eFiles(E2E_DIR);
    const res = scanAll(Object.fromEntries(list.map((f) => [path.relative(repoRoot, f), fs.readFileSync(f, 'utf8')])));
    let total = 0;
    const perFile = [];
    for (const [file, { counted, reasons }] of Object.entries(res)) {
        total += counted.length;
        if (counted.length) {
            perFile.push(`${file}: ${counted.length} (строки ${counted.join(', ')})${reasons.length ? ' — ' + reasons.join('; ') : ''}`);
        }
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
