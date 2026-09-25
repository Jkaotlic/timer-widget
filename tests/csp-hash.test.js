'use strict';

/**
 * SEC-08: CSP окон без `'unsafe-inline'` в script-src.
 *
 * Инлайновые <script> разрешены ПОИМЁННО — sha256 каждого блока в meta. Цена:
 * правка любого инлайнового скрипта без пересчёта хеша ломает окно (браузер
 * откажется исполнять блок, и окно останется разметкой без логики). Этот тест
 * ловит такое расхождение ДО запуска: пересчитывает хеши и сравнивает с meta.
 * Лечение — `npm run csp:hash -- --write`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const csp = require('../scripts/csp-hash');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('хеш совпадает с эталоном из спецификации CSP', () => {
    // Независимая точка: пример из CSP Level 2 / MDN. Без неё тест сверял бы
    // функцию с самой собой — хеш по неверно вырезанному тексту совпал бы с
    // тем же неверным хешем в meta.
    assert.equal(
        csp.hashScript("alert('Hello, world.');"),
        "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='"
    );
});

test('извлекаются только инлайновые блоки, ровно их текст', () => {
    const html = [
        '<!doctype html><html><head>',
        '<script src="a.js"></script>',
        '<!-- <script>закомментировано</script> -->',
        '<script>one();</script>',
        '</head><body>',
        '<script>\n  // текст <script> внутри комментария JS\n  two();\n</script>',
        '<SCRIPT>three();</SCRIPT>',
        '</body></html>'
    ].join('\n');
    assert.deepEqual(csp.inlineScripts(html), [
        'one();',
        '\n  // текст <script> внутри комментария JS\n  two();\n',
        'three();'
    ]);
});

test('CRLF хешируется так, как его видит браузер — как LF', () => {
    // HTML-парсер нормализует переводы строк ДО того, как текст станет
    // содержимым <script>; хеш по сырым байтам с \r разошёлся бы с браузерным.
    assert.deepEqual(
        csp.inlineScripts('<script>a();\r\nb();\r</script>'),
        ['a();\nb();\n']
    );
});

test('в каждом окне CSP совпадает с пересчитанной — хеши актуальны', () => {
    for (const file of csp.WINDOW_HTML) {
        const html = read(file);
        const result = csp.checkHtml(html);
        assert.ok(
            result.ok,
            `${file}: CSP расходится с инлайновыми скриптами — окно откажется их исполнять.\n`
            + 'Запусти `npm run csp:hash -- --write`.\n'
            + `  в файле:  ${result.actual}\n  ожидается: ${result.expected}`
        );
    }
});

test('script-src без unsafe-inline, закрыты base/form/frame/worker/connect', () => {
    for (const file of csp.WINDOW_HTML) {
        const policy = csp.readPolicy(read(file));
        assert.ok(policy, `${file}: нет CSP`);
        const directives = Object.fromEntries(policy.split(';').map((d) => d.trim()).filter(Boolean)
            .map((d) => { const [name, ...rest] = d.split(/\s+/); return [name, rest]; }));

        assert.ok(directives['script-src'], `${file}: нет script-src`);
        assert.ok(!directives['script-src'].includes("'unsafe-inline'"), `${file}: script-src снова с 'unsafe-inline'`);
        assert.ok(!directives['script-src'].includes("'unsafe-eval'"), `${file}: script-src с 'unsafe-eval'`);
        const hashes = directives['script-src'].filter((s) => s.startsWith("'sha256-"));
        assert.ok(hashes.length >= 1, `${file}: в script-src нет ни одного хеша — проверка ослепла`);

        for (const name of ['base-uri', 'form-action', 'frame-src', 'worker-src', 'connect-src', 'object-src']) {
            assert.deepEqual(directives[name], ["'none'"], `${file}: ${name} обязан быть 'none'`);
        }
        // Стили инлайновые повсюду (style="" и <style>), их хеши держать
        // бессмысленно — CSS не исполняет код.
        assert.ok(directives['style-src'].includes("'unsafe-inline'"), `${file}: style-src без 'unsafe-inline' сломает окна`);
    }
});

test('проверка по-настоящему видит правку скрипта без пересчёта', () => {
    // Самопроверка: без неё зелёный значил бы и «хеши верны», и «сверка
    // ничего не сверяет».
    const html = read('electron-widget.html');
    const scripts = csp.inlineScripts(html);
    assert.ok(scripts.length > 0);
    const tampered = html.replace(scripts[0], `${scripts[0]} `);
    assert.notEqual(tampered, html);
    assert.equal(csp.checkHtml(tampered).ok, false, 'правка инлайнового скрипта не замечена');
    assert.equal(csp.checkHtml(csp.rewriteHtml(tampered)).ok, true, '--write не чинит расхождение');
});
