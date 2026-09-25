'use strict';

/**
 * SEC-08: CSP окон без инлайна — `script-src 'self'`, без хешей и без
 * 'unsafe-inline'.
 *
 * Строгая политика ломает окно МОЛЧА: инлайн, вернувшийся в разметку,
 * браузер откажется исполнять или применять, а source-level тесты, которые
 * читают исходник, этого не увидят. Поэтому страж проверяет разметку до
 * запуска (scripts/csp-guard.js), а e2e — ноль нарушений в живом окне
 * (e2e/windows-load-clean.spec.js).
 *
 * Проверки ОТСУТСТВИЯ здесь обязаны проверять сами себя (CLAUDE.md): зелёный
 * «инлайна нет» значит и «чисто», и «сканер ослеп». Поэтому каждый вид
 * нарушения сначала скармливается сканеру на синтетике и на НАСТОЯЩЕМ окне с
 * подсаженным нарушением — и обязан быть пойман.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const csp = require('../scripts/csp-guard');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const kinds = (html) => csp.findInline(html).map((p) => p.kind);

function directivesOf(policy) {
    return Object.fromEntries(policy.split(';').map((d) => d.trim()).filter(Boolean)
        .map((d) => { const [name, ...rest] = d.split(/\s+/); return [name, rest]; }));
}

// Каждый вид нарушения, в нескольких написаниях. Для каждого — что сканер
// обязан сказать.
const VIOLATIONS = [
    ['<script>one();</script>', 'inline-script'],
    ['<SCRIPT>two();</SCRIPT>', 'inline-script'],
    ['<script type="module">three();</script>', 'inline-script'],
    ['<script></script>', 'inline-script'],
    ['<style>.a{color:red}</style>', 'style-element'],
    ['<STYLE media="all">.a{}</STYLE>', 'style-element'],
    ['<svg><style>.b{}</style></svg>', 'style-element'],
    ['<div style="display:none"></div>', 'style-attr'],
    ["<div STYLE='color:red'></div>", 'style-attr'],
    ['<div class="x" style=color:red></div>', 'style-attr'],
    ['<circle cx="1" style="fill:red"/>', 'style-attr'],
    ['<button onclick="go()">x</button>', 'handler'],
    ['<img src="a.png" ONERROR=go()>', 'handler'],
    ['<a href="javascript:go()">x</a>', 'javascript-url'],
    ['<a href=" JavaScript:go()">x</a>', 'javascript-url']
];

test('сканер ловит каждый вид инлайна, в любом написании', () => {
    for (const [html, kind] of VIOLATIONS) {
        assert.deepEqual(kinds(html), [kind], `не пойман ${kind}: ${html}`);
    }
});

test('сканер не срабатывает на то, что инлайном не является', () => {
    // Без этой половины сканер «ловил бы всё» и тест выше был бы пустым.
    const clean = [
        '<script src="a.js"></script>',
        '<script src="a.js" data-x="1"></script>',
        '<link rel="stylesheet" href="a.css">',
        '<!-- <script>закомментировано</script> <div style="x"> -->',
        '<p>слово style="x" и onclick="y" в тексте — не атрибут</p>',
        '<div data-style="x" data-onclick="y" aria-label="style=1"></div>',
        '<div title="a > b" class="c"></div>',
        '<a href="https://example.com/javascript:x">ok</a>'
    ].join('\n');
    assert.deepEqual(kinds(clean), []);
    // Содержимое <script src> — «сырой текст»: пустой, но и слово style= в нём
    // тегом не было бы.
    assert.deepEqual(kinds('<script src="a.js">// <div style="x"></script>'), []);
});

test('номер строки нарушения указывает на тег', () => {
    const found = csp.findInline('<html>\n<body>\n\n<div style="x"></div>\n</body>');
    assert.deepEqual(found.map((p) => p.line), [4]);
});

test('в окнах нет ни одного запрещённого инлайна', () => {
    for (const file of csp.WINDOW_HTML) {
        const result = csp.checkHtml(read(file));
        assert.deepEqual(
            result.problems.map((p) => `${p.line} ${p.kind} ${p.text}`), [],
            `${file}: инлайн в окне — браузер откажется его исполнять/применять`
        );
    }
});

test('страж видит нарушение, подсаженное в НАСТОЯЩЕЕ окно', () => {
    // Самопроверка на живом файле: сканер обязан дойти до конца реальной
    // разметки (а не споткнуться о её комментарии и SVG) и найти подсадку.
    for (const file of csp.WINDOW_HTML) {
        const html = read(file);
        assert.equal(csp.checkHtml(html).ok, true, `${file}: окно не чистое — см. тест выше`);
        for (const kind of csp.FORBIDDEN) {
            const sample = VIOLATIONS.find(([, k]) => k === kind)[0];
            const tampered = html.replace('</body>', `${sample}\n</body>`);
            assert.notEqual(tampered, html, `${file}: нет </body>`);
            assert.deepEqual(
                csp.checkHtml(tampered).problems.map((p) => p.kind), [kind],
                `${file}: подсаженный ${kind} не замечен`
            );
        }
    }
});

test('meta каждого окна — ровно POLICY, и --write чинит расхождение', () => {
    for (const file of csp.WINDOW_HTML) {
        const html = read(file);
        assert.equal(csp.readPolicy(html), csp.POLICY, `${file}: meta разошлась с POLICY — npm run csp:check -- --write`);
        const tampered = html.replace(csp.POLICY, csp.POLICY.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"));
        assert.notEqual(tampered, html);
        assert.equal(csp.checkHtml(tampered).ok, false, `${file}: расхождение meta не замечено`);
        assert.equal(csp.checkHtml(csp.rewriteHtml(tampered)).ok, true, `${file}: --write не чинит meta`);
    }
});

test('POLICY: только файлы — ни хешей, ни unsafe-*, закрыто всё лишнее', () => {
    const d = directivesOf(csp.POLICY);
    assert.deepEqual(d['default-src'], ["'self'"]);
    assert.deepEqual(d['script-src'], ["'self'"], 'script-src обязан быть ровно \'self\' — без хешей, unsafe-inline и unsafe-eval');
    assert.ok(!csp.POLICY.includes('sha256-'), 'в политике остался хеш — значит, где-то остался инлайновый скрипт');
    assert.ok(!csp.POLICY.includes("'unsafe-eval'"));
    for (const name of ['base-uri', 'form-action', 'frame-src', 'worker-src', 'connect-src', 'object-src']) {
        assert.deepEqual(d[name], ["'none'"], `${name} обязан быть 'none'`);
    }
    // data: нужен ровно там, где живут data-URL пользователя: картинка фона,
    // свои звуки. Нигде больше.
    for (const name of ['img-src', 'media-src', 'font-src']) {
        assert.deepEqual(d[name], ["'self'", 'data:'], `${name}`);
    }
});
