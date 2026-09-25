#!/usr/bin/env node
'use strict';

/**
 * csp-guard.js — владелец Content-Security-Policy четырёх окон и страж
 * «ни строчки инлайна» (SEC-08).
 *
 *   node scripts/csp-guard.js            сверить (по умолчанию)
 *   node scripts/csp-guard.js --write    переписать meta в файлах по POLICY
 *   npm run csp:check [-- --write]       то же через npm
 *
 * Зачем. С 25.09.2026 политика окон — `script-src 'self'; style-src 'self'`:
 * ни хешей, ни 'unsafe-inline'. Исполняется и применяется ТОЛЬКО то, что лежит
 * файлом в каталоге приложения. До этого инлайновые скрипты разрешались
 * поимённо (sha256 каждого блока), а стили — целиком через 'unsafe-inline'.
 *
 * Цена строгой политики: инлайн, вернувшийся в разметку, браузер молча
 * откажется исполнять или применять — окно останется разметкой без логики
 * или без стилей, а в тестах, которые читают исходник, это не видно. Поэтому
 * этот файл проверяет ДО запуска, что в разметке окон нет:
 *   - <script> без src (с любым содержимым, даже пустым);
 *   - <style>;
 *   - атрибута style="…";
 *   - обработчиков on*="…" (onclick и т.п. — это тоже инлайновый скрипт);
 *   - ссылок javascript: в href/src/action/formaction.
 * что скрипты окон не рождают того же в рантайме (findInlineInScript) и что
 * meta несёт ровно POLICY. В рантайме то же держит e2e
 * (windows-load-clean: ноль событий securitypolicyviolation).
 *
 * Разметку разбирает маленький сканер, а не регулярка по всему файлу:
 * HTML-комментарий пропускается целиком (закомментированный тег браузер не
 * видит), содержимое <script>/<style> — «сырой текст», и слово «style=» в
 * JS-комментарии тегом не является. Атрибуты читаются только внутри тегов.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const WINDOW_HTML = Object.freeze([
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html'
]);

// Сама строка живёт в app-scheme.js: её же схема app:// отдаёт ЗАГОЛОВКОМ
// ответа страницы (действующая политика — пересечение meta и заголовка, так
// что две копии разошлись бы молча). Почему каждая директива такая:
//  - default-src 'self' — ресурсы только из каталога приложения;
//  - script-src 'self' — только файлы; ни хешей, ни 'unsafe-inline', ни eval;
//  - style-src 'self' — только таблицы-файлы. CSSOM из скриптов (el.style.x = …,
//    setProperty) политика не трогает — это не «инлайновый стиль» в её смысле;
//  - img/media/font data: — фон дисплея и звуки пользователя живут data-URL;
//  - connect-src 'none' — ни fetch, ни XHR, ни WebSocket приложению не нужны:
//    оно работает без сети, а данные с диска читает главный процесс;
//  - base-uri / form-action / frame-src / worker-src 'none' — ни <base>, ни
//    форм, ни фреймов, ни воркеров в окнах нет; открытое — это лазейка.
const { CONTENT_SECURITY_POLICY: POLICY } = require('../app-scheme');

// Все виды инлайна запрещены: политика не пускает ни один из них.
const FORBIDDEN = Object.freeze(new Set(['inline-script', 'style-element', 'style-attr', 'handler', 'javascript-url']));

const META_RE = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/;

const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

/**
 * Все нарушения в разметке: [{ kind, line, text }]. `kind` — одно из
 * 'inline-script' | 'style-element' | 'style-attr' | 'handler' | 'javascript-url'.
 */
function findInline(html) {
    const text = html.replace(/\r\n?/g, '\n');
    const lower = text.toLowerCase();
    const out = [];
    const lineAt = (i) => text.slice(0, i).split('\n').length;
    let i = 0;
    while (i < text.length) {
        const lt = text.indexOf('<', i);
        if (lt === -1) { break; }
        if (text.startsWith('<!--', lt)) {
            const end = text.indexOf('-->', lt + 4);
            i = end === -1 ? text.length : end + 3;
            continue;
        }
        const tag = /^<([a-zA-Z][a-zA-Z0-9:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(text.slice(lt, lt + 4096));
        if (!tag) { i = lt + 1; continue; }
        const name = tag[1].toLowerCase();
        const attrs = tag[2];
        const snippet = tag[0].length > 120 ? `${tag[0].slice(0, 117)}...` : tag[0];

        for (const m of attrs.matchAll(ATTR_RE)) {
            const attr = m[1].toLowerCase();
            const value = m[2] ?? m[3] ?? m[4] ?? '';
            if (attr === 'style') { out.push({ kind: 'style-attr', line: lineAt(lt), text: snippet }); }
            if (/^on[a-z]+$/.test(attr)) { out.push({ kind: 'handler', line: lineAt(lt), text: snippet }); }
            if (URL_ATTRS.has(attr) && /^\s*javascript:/i.test(value)) {
                out.push({ kind: 'javascript-url', line: lineAt(lt), text: snippet });
            }
        }

        const bodyStart = lt + tag[0].length;
        if (name === 'script' || name === 'style') {
            const close = lower.indexOf(`</${name}`, bodyStart);
            if (close === -1) { throw new Error(`незакрытый <${name}> в строке ${lineAt(lt)}`); }
            if (name === 'style') {
                out.push({ kind: 'style-element', line: lineAt(lt), text: snippet });
            } else if (!/(^|\s)src\s*=/i.test(attrs)) {
                out.push({ kind: 'inline-script', line: lineAt(lt), text: snippet });
            }
            i = close + name.length + 2;
            continue;
        }
        i = bodyStart;
    }
    return out;
}

// Формы, которые строгая политика блокирует В РАНТАЙМЕ, — их рождает скрипт,
// а не разметка, и сканер HTML их не видит:
//   - style="…" и on*="…" внутри HTML-строки (шаблон для innerHTML и т.п.);
//   - setAttribute('style' | 'on…', …) — тот же атрибут, выставленный руками;
//   - <style>, собранный через createElement('style');
//   - eval / new Function / строка в setTimeout — script-src без 'unsafe-eval'.
// CSSOM (el.style.x = …, setProperty, cssText) политика НЕ трогает — это
// разрешённый способ, и сканер его не ищет.
const SCRIPT_RULES = Object.freeze([
    ['style-attr', /<[a-zA-Z][\w:-]*\b[^<>]*\sstyle\s*=/],
    ['handler', /<[a-zA-Z][\w:-]*\b[^<>]*\son[a-z]+\s*=/],
    ['style-attr', /\.setAttribute\(\s*['"`]style['"`]/],
    ['handler', /\.setAttribute\(\s*['"`]on[a-z]+['"`]/],
    ['style-element', /createElement(?:NS)?\([^)]*['"`]style['"`]\s*\)/],
    ['eval', /(?<![\w.$])eval\s*\(|\bnew\s+Function\s*\(|\bset(?:Timeout|Interval)\(\s*['"`]/]
]);

// Комментарии срезаются: пояснение «здесь был style="…"» нарушением не является.
function stripComments(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Нарушения в JS: [{ kind, line, text }]. */
function findInlineInScript(code) {
    const out = [];
    stripComments(code).split('\n').forEach((line, idx) => {
        for (const [kind, re] of SCRIPT_RULES) {
            if (re.test(line)) { out.push({ kind, line: idx + 1, text: line.trim().slice(0, 120) }); }
        }
    });
    return out;
}

// Все скрипты, которые исполняются в окнах: <script src> четырёх страниц.
function windowScripts() {
    const files = new Set();
    for (const file of WINDOW_HTML) {
        const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) { files.add(m[1]); }
    }
    return [...files];
}

function readPolicy(html) {
    const m = META_RE.exec(html);
    return m ? m[2] : null;
}

function checkHtml(html) {
    const problems = findInline(html).filter((p) => FORBIDDEN.has(p.kind));
    const actual = readPolicy(html);
    return { ok: problems.length === 0 && actual === POLICY, problems, policyOk: actual === POLICY, actual };
}

function rewriteHtml(html) {
    if (!META_RE.test(html)) { throw new Error('в файле нет meta Content-Security-Policy'); }
    return html.replace(META_RE, (_m, head, _old, tail) => `${head}${POLICY}${tail}`);
}

function main(argv) {
    const write = argv.includes('--write');
    let bad = 0;
    for (const file of WINDOW_HTML) {
        const full = path.join(ROOT, file);
        let html = fs.readFileSync(full, 'utf8');
        let result = checkHtml(html);
        if (!result.policyOk && write) {
            html = rewriteHtml(html);
            fs.writeFileSync(full, html, 'utf8');
            console.log(`[csp-guard] meta переписана: ${file}`);
            result = checkHtml(html);
        }
        if (result.ok) {
            console.log(`[csp-guard] OK  ${file}`);
            continue;
        }
        bad++;
        if (!result.policyOk) {
            console.error(`[csp-guard] ${file}: meta расходится с политикой`);
            console.error(`  в файле:   ${result.actual}`);
            console.error(`  ожидается: ${POLICY}`);
        }
        for (const p of result.problems) {
            console.error(`[csp-guard] ${file}:${p.line}  ${p.kind}  ${p.text}`);
        }
    }
    for (const file of windowScripts()) {
        const problems = findInlineInScript(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        if (problems.length === 0) { continue; }
        bad++;
        for (const p of problems) {
            console.error(`[csp-guard] ${file}:${p.line}  ${p.kind}  ${p.text}`);
        }
    }
    if (bad) {
        console.error('\nИнлайн в окне браузер откажется исполнять или применять (CSP без \'unsafe-inline\').');
        console.error('Код — в файл окна (*-app.js), стиль — в его .css, состояние — классом.');
        console.error('Политику меняют в app-scheme.js (CONTENT_SECURITY_POLICY) и переписывают meta: npm run csp:check -- --write');
        process.exit(1);
    }
}

module.exports = {
    WINDOW_HTML, POLICY, FORBIDDEN, findInline, findInlineInScript, windowScripts, readPolicy, checkHtml, rewriteHtml
};

if (require.main === module) {
    main(process.argv.slice(2));
}
