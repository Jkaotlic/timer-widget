#!/usr/bin/env node
'use strict';

/**
 * csp-hash.js — владелец Content-Security-Policy четырёх окон (SEC-08).
 *
 *   node scripts/csp-hash.js            сверить (по умолчанию, = --check)
 *   node scripts/csp-hash.js --write    переписать meta в файлах
 *   npm run csp:hash -- --write         то же через npm
 *
 * Зачем. `script-src 'unsafe-inline'` разрешает исполнять ЛЮБОЙ инлайновый
 * скрипт, в том числе внедрённый, — CSP с ним защищает только от внешних
 * источников. Без него инлайновые блоки разрешаются поимённо: sha256 текста
 * каждого блока в meta. Хеш — отпечаток ТЕКСТА, поэтому любая правка блока
 * обязана сопровождаться пересчётом, иначе браузер откажется блок исполнять и
 * окно останется разметкой без логики. Сверку держит tests/csp-hash.test.js.
 *
 * Политика целиком собирается здесь, из ОДНОГО шаблона: четыре копии в четырёх
 * meta разошлись бы на первой правке, как расходились до того цвета и ключи.
 *
 * Хеш считается по тексту между <script> и </script> ровно так, как его видит
 * браузер: переводы строк нормализованы в LF (HTML-парсер делает это до
 * токенизации), ссылки на символы внутри <script> не раскрываются (это «сырой
 * текст»), кодировка — UTF-8.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const WINDOW_HTML = Object.freeze([
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html'
]);

// Всё, кроме списка хешей. Почему каждая строка такая:
//  - default-src 'self' — ресурсы только из каталога приложения;
//  - style-src 'unsafe-inline' — стили инлайновые повсюду (style="", <style>),
//    CSS кода не исполняет, держать их хеши бессмысленно;
//  - img/media/font data: — фон дисплея и звуки пользователя живут data-URL;
//  - connect-src 'none' — ни fetch, ни XHR, ни WebSocket приложению не нужны:
//    оно работает без сети, а данные с диска читает главный процесс;
//  - base-uri / form-action / frame-src / worker-src 'none' — ни <base>, ни
//    форм, ни фреймов, ни воркеров в окнах нет; открытое — это лазейка.
const POLICY_TEMPLATE = [
    "default-src 'self'",
    "script-src 'self' {HASHES}",
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

const META_RE = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/;

// Тексты инлайновых <script> (без src) в порядке документа.
//
// Не регулярка «от <script> до </script>», а маленький сканер: HTML-комментарий
// вне скрипта пропускается целиком (закомментированный блок браузер не
// исполняет, и хеш для него — лишнее разрешение), а текст «<script>» ВНУТРИ
// скрипта — например, в JS-комментарии — остаётся текстом: конец блоку даёт
// только `</script`.
function inlineScripts(html) {
    const text = html.replace(/\r\n?/g, '\n');
    const lower = text.toLowerCase();
    const out = [];
    let i = 0;
    while (i < text.length) {
        const lt = text.indexOf('<', i);
        if (lt === -1) { break; }
        if (text.startsWith('<!--', lt)) {
            const end = text.indexOf('-->', lt + 4);
            i = end === -1 ? text.length : end + 3;
            continue;
        }
        const open = /^<script\b([^>]*)>/i.exec(text.slice(lt, lt + 512));
        if (!open) { i = lt + 1; continue; }
        const bodyStart = lt + open[0].length;
        const close = lower.indexOf('</script', bodyStart);
        if (close === -1) { throw new Error('незакрытый <script>'); }
        if (!/\bsrc\s*=/i.test(open[1])) { out.push(text.slice(bodyStart, close)); }
        i = close + '</script'.length;
    }
    return out;
}

function hashScript(source) {
    const digest = crypto.createHash('sha256').update(source, 'utf8').digest('base64');
    return `'sha256-${digest}'`;
}

// Политика, которую ОБЯЗАН нести файл: хеши без повторов, в порядке блоков.
function expectedPolicy(html) {
    const hashes = [...new Set(inlineScripts(html).map(hashScript))];
    return POLICY_TEMPLATE.replace('{HASHES}', hashes.join(' '));
}

function readPolicy(html) {
    const m = META_RE.exec(html);
    return m ? m[2] : null;
}

function checkHtml(html) {
    const expected = expectedPolicy(html);
    const actual = readPolicy(html);
    return { ok: actual === expected, expected, actual };
}

function rewriteHtml(html) {
    if (!META_RE.test(html)) { throw new Error('в файле нет meta Content-Security-Policy'); }
    const policy = expectedPolicy(html);
    return html.replace(META_RE, (_m, head, _old, tail) => `${head}${policy}${tail}`);
}

function main(argv) {
    const write = argv.includes('--write');
    let bad = 0;
    for (const file of WINDOW_HTML) {
        const full = path.join(ROOT, file);
        const html = fs.readFileSync(full, 'utf8');
        const result = checkHtml(html);
        if (result.ok) {
            console.log(`[csp-hash] OK       ${file}`);
            continue;
        }
        if (write) {
            fs.writeFileSync(full, rewriteHtml(html), 'utf8');
            console.log(`[csp-hash] ЗАПИСАНО ${file}`);
            continue;
        }
        bad++;
        console.error(`[csp-hash] РАСХОЖДЕНИЕ ${file}`);
        console.error(`  в файле:   ${result.actual}`);
        console.error(`  ожидается: ${result.expected}`);
    }
    if (bad) {
        console.error('\nИнлайновый <script> изменён без пересчёта хеша — окно откажется его исполнять.');
        console.error('Исправление: npm run csp:hash -- --write');
        process.exit(1);
    }
}

module.exports = {
    WINDOW_HTML,
    POLICY_TEMPLATE,
    inlineScripts,
    hashScript,
    expectedPolicy,
    readPolicy,
    checkHtml,
    rewriteHtml
};

if (require.main === module) {
    main(process.argv.slice(2));
}
