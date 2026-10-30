'use strict';

/**
 * Скрипты страниц окон: `<head>` — классические, `<body>` — `defer` или module.
 *
 * Зачем. Модульные скрипты и `defer` исполняются одним списком в порядке
 * документа после разбора; классический скрипт без defer — раньше любого
 * модуля. Пока тело не приведено к одному виду, перевод файла в модуль
 * переставит порядок исполнения. Скрипты `<head>` (тема, замок, drop-guard)
 * остаются классическими: им нужно исполниться до первого кадра.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { scriptTags } = require('./helpers/source-scan');
const { readRaw } = require('./helpers/window-source');

const PAGES = ['electron-control.html', 'electron-widget.html', 'electron-clock-widget.html', 'display.html'];

test('scriptTags: самопроверка на заведомых тегах', () => {
    const html = '<html><head><script src="a.js"></script><!-- <script src="ghost.js"></script> -->'
        + '<script>inline()</script></head><body>'
        + '<script src="b.js" defer></script><script type="module" src="c.js"></script>'
        + "<script defer src='d.js'></script><script src=\"e.js\" data-defer=\"1\"></script></body></html>";
    assert.deepEqual(scriptTags(html), [
        { src: 'a.js', type: null, defer: false, inHead: true },
        { src: 'b.js', type: null, defer: true, inHead: false },
        { src: 'c.js', type: 'module', defer: false, inHead: false },
        { src: 'd.js', type: null, defer: true, inHead: false },
        { src: 'e.js', type: null, defer: false, inHead: false }
    ]);
});

for (const file of PAGES) {
    test(`${file}: число тегов совпадает с независимым счётом`, () => {
        const html = readRaw(file);
        const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
        const expected = (noComments.match(/<script\b[^>]*\ssrc=/g) || []).length;
        const tags = scriptTags(html);
        assert.ok(tags.length > 3, 'разбор вернул подозрительно мало тегов');
        assert.equal(tags.length, expected);
    });

    test(`${file}: скрипты body — defer или module, скрипты head — без них`, () => {
        for (const t of scriptTags(readRaw(file))) {
            const deferred = t.defer || t.type === 'module';
            if (t.inHead) {
                assert.equal(deferred, false, `${file}: ${t.src} в <head> не должен быть defer/module`);
            } else {
                assert.equal(deferred, true, `${file}: ${t.src} в <body> без defer`);
            }
        }
    });
}
