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
 * и что meta несёт ровно POLICY. В рантайме то же держит e2e
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

// Почему каждая строка такая:
//  - default-src 'self' — ресурсы только из каталога приложения;
//  - script-src 'self' — только файлы; ни хешей, ни 'unsafe-inline', ни eval;
//  - style-src 'self' — только таблицы-файлы. CSSOM из скриптов (el.style.x = …,
//    setProperty) политика не трогает — это не «инлайновый стиль» в её смысле;
//  - img/media/font data: — фон дисплея и звуки пользователя живут data-URL;
//  - connect-src 'none' — ни fetch, ни XHR, ни WebSocket приложению не нужны:
//    оно работает без сети, а данные с диска читает главный процесс;
//  - base-uri / form-action / frame-src / worker-src 'none' — ни <base>, ни
//    форм, ни фреймов, ни воркеров в окнах нет; открытое — это лазейка.
const POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'"
].join('; ');

// Какие виды инлайна запрещены. Стили — следующим шагом того же прохода.
const FORBIDDEN = Object.freeze(new Set(['inline-script', 'handler', 'javascript-url']));

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
    if (bad) {
        console.error('\nИнлайн в окне браузер откажется исполнять или применять (CSP без \'unsafe-inline\').');
        console.error('Код — в файл окна (*-app.js), стиль — в его .css, состояние — классом.');
        console.error('Политику меняют здесь, в POLICY, и переписывают meta: npm run csp:check -- --write');
        process.exit(1);
    }
}

module.exports = { WINDOW_HTML, POLICY, FORBIDDEN, findInline, readPolicy, checkHtml, rewriteHtml };

if (require.main === module) {
    main(process.argv.slice(2));
}
