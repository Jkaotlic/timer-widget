'use strict';

/**
 * app-scheme.js — окна грузятся со своей схемы `app://timer-widget/…`, а не с
 * file://. Здесь проверяется ЧИСТАЯ часть: какой адрес во что превращается и
 * что отвергается. Ответ настоящему Chromium даёт main-app-protocol.js
 * (tests/main-app-protocol.test.js), а что окна на этой схеме живут —
 * e2e/windows-load-clean и e2e/storage-migration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const S = require('../app-scheme');

const ROOT = path.join(__dirname, '..');
const readRepo = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ALLOWED = S.collectWebFiles(readRepo);
const PKG = require('../package.json');

test('схема одна, хост один, адрес страницы строится одной формулой', () => {
    assert.equal(S.SCHEME, 'app');
    assert.equal(S.HOST, 'timer-widget');
    assert.equal(S.ORIGIN, 'app://timer-widget');
    assert.equal(S.pageUrl('display.html'), 'app://timer-widget/display.html');
    assert.throws(() => S.pageUrl('../x.html'), /страниц/);
    assert.throws(() => S.pageUrl('evil.html'), /страниц/);
});

test('привилегии схемы: standard + secure, и ничего сверх нужного', () => {
    // standard — у страницы настоящий origin (localStorage, относительные
    // адреса), secure — безопасный контекст. fetch/CORS/stream окнам не нужны:
    // connect-src 'none', звуков-файлов нет. Лишняя привилегия — лишняя дверь.
    assert.deepEqual(S.PRIVILEGED_SCHEME, {
        scheme: 'app',
        privileges: { standard: true, secure: true }
    });
});

test('разрешены страницы окон, страница миграции и то, что страницы подключают', () => {
    for (const page of [...S.WINDOW_PAGES, S.MIGRATION_PAGE]) {
        assert.ok(ALLOWED.has(page), page);
    }
    for (const rel of ['control-app.js', 'constants.js', 'fonts.css', 'control.css', 'display-script.js', 'widget.css']) {
        assert.ok(ALLOWED.has(rel), rel);
    }
});

test('главный процесс и preload окнам НЕ отдаются: их ни одна страница не подключает', () => {
    for (const rel of ['electron-main.js', 'main-windows.js', 'preload.js', 'app-scheme.js',
        'main-storage-migration.js', 'package.json', 'ipc-senders.js', 'atomic-write.js']) {
        assert.equal(ALLOWED.has(rel), false, rel);
        assert.equal(S.resolveAppRequest(`app://timer-widget/${rel}`, ALLOWED).ok, false, rel);
    }
});

test('всё разрешённое уезжает в сборку (build.files) и лежит на диске', () => {
    const declared = new Set(PKG.build.files);
    for (const rel of ALLOWED) {
        assert.ok(declared.has(rel), `${rel} отдаётся схемой, но не упакован — в сборке будет 404`);
        assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} нет на диске`);
    }
    for (const dir of Object.keys(S.ASSET_DIRS)) {
        assert.ok(declared.has(`${dir}/**/*`), `${dir}/ разрешён схемой, но не упакован`);
    }
});

test('шрифты: каждый url() из fonts.css разрешён и получает свой MIME', () => {
    const urls = [...readRepo('fonts.css').matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 20, `шрифтов ${urls.length}`);
    for (const rel of urls) {
        const r = S.resolveAppRequest(`app://timer-widget/${rel}`, ALLOWED);
        assert.equal(r.ok, true, rel);
        assert.equal(r.mime, 'font/woff2', rel);
    }
});

test('MIME по расширению: страница, скрипт, стиль', () => {
    assert.equal(S.resolveAppRequest('app://timer-widget/display.html', ALLOWED).mime, 'text/html; charset=utf-8');
    assert.equal(S.resolveAppRequest('app://timer-widget/utils.js', ALLOWED).mime, 'text/javascript; charset=utf-8');
    assert.equal(S.resolveAppRequest('app://timer-widget/control.css', ALLOWED).mime, 'text/css; charset=utf-8');
});

test('query и хеш не мешают: это тот же файл', () => {
    const r = S.resolveAppRequest('app://timer-widget/electron-control.html?x=1#y', ALLOWED);
    assert.equal(r.ok, true);
    assert.equal(r.relPath, 'electron-control.html');
});

test('чужой хост, схема, порт и учётка — отказ', () => {
    for (const url of [
        'app://other/electron-control.html',
        'app://timer-widget.evil/electron-control.html',
        'app://timer-widget:8080/electron-control.html',
        'app://user:pw@timer-widget/electron-control.html',
        'file:///electron-control.html',
        'https://timer-widget/electron-control.html',
        'app:///electron-control.html',
        'app:electron-control.html',
        '', 'не адрес', null, undefined
    ]) {
        const r = S.resolveAppRequest(url, ALLOWED);
        assert.equal(r.ok, false, String(url));
        assert.ok(r.status >= 400, String(url));
    }
});

test('обход каталога — отказ в любой записи', () => {
    for (const url of [
        'app://timer-widget/../package.json',
        'app://timer-widget/fonts/../electron-main.js',
        'app://timer-widget/%2e%2e/package.json',
        'app://timer-widget/%2E%2E/%2E%2E/etc/passwd',
        'app://timer-widget/fonts/%2e%2e/preload.js',
        'app://timer-widget/..%2fpackage.json',
        'app://timer-widget/..%5cpackage.json',
        'app://timer-widget/fonts%5c..%5cpreload.js',
        'app://timer-widget/fonts\\..\\preload.js',
        'app://timer-widget/%252e%252e/package.json',
        'app://timer-widget//etc/passwd',
        'app://timer-widget/%2Fetc%2Fpasswd',
        'app://timer-widget/C:/Windows/win.ini',
        'app://timer-widget/C%3A%5CWindows%5Cwin.ini',
        'app://timer-widget/display.html%00.js',
        'app://timer-widget/utils.js%00',
        'app://timer-widget/%E0%A4%A',
        'app://timer-widget/'
    ]) {
        const r = S.resolveAppRequest(url, ALLOWED);
        assert.equal(r.ok, false, url);
    }
});

test('каталог ассетов: только плоские имена и только свои расширения', () => {
    // В fonts/ лежит OFL.txt — лицензия, окнам не нужна.
    for (const rel of ['fonts/OFL.txt', 'fonts/sub/a.woff2', 'fonts/.woff2', 'fonts/a.woff2.js',
        'sounds/a.html', 'sounds/a.svg', 'fonts/a.svg']) {
        assert.equal(S.resolveAppRequest(`app://timer-widget/${rel}`, ALLOWED).ok, false, rel);
    }
    const snd = S.resolveAppRequest('app://timer-widget/sounds/beep.wav', ALLOWED);
    assert.equal(snd.ok, true);
    assert.equal(snd.mime, 'audio/wav');
});

test('отказы различимы: 403 — не наш адрес, 404 — не в списке', () => {
    assert.equal(S.resolveAppRequest('app://other/display.html', ALLOWED).status, 403);
    assert.equal(S.resolveAppRequest('app://timer-widget/%2e%2e/x', ALLOWED).status, 404);
    assert.equal(S.resolveAppRequest('app://timer-widget/evil.html', ALLOWED).status, 404);
});

test('заголовки: CSP заголовком у страниц, nosniff у всех', () => {
    const html = S.responseHeaders(S.resolveAppRequest('app://timer-widget/display.html', ALLOWED));
    assert.equal(html['Content-Security-Policy'], S.CONTENT_SECURITY_POLICY);
    assert.equal(html['X-Content-Type-Options'], 'nosniff');
    assert.equal(html['Content-Type'], 'text/html; charset=utf-8');

    const js = S.responseHeaders(S.resolveAppRequest('app://timer-widget/utils.js', ALLOWED));
    assert.equal(js['X-Content-Type-Options'], 'nosniff');
    assert.equal(js['Content-Security-Policy'], undefined, 'CSP у скрипта ничего не значит');
});

test('CSP заголовка — та же политика, что в meta каждой страницы (один владелец)', () => {
    const { POLICY } = require('../scripts/csp-guard');
    assert.equal(POLICY, S.CONTENT_SECURITY_POLICY, 'csp-guard держит другую политику');
    for (const page of S.WINDOW_PAGES) {
        const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(readRepo(page));
        assert.ok(meta, `${page}: нет meta CSP`);
        assert.equal(meta[1], S.CONTENT_SECURITY_POLICY, page);
    }
});

test('collectWebFiles берёт только плоские относительные имена из разметки', () => {
    const pages = {
        'electron-control.html': '<script src="a.js"></script><link rel="stylesheet" href="b.css">'
            + '<script src="https://evil.example.com/x.js"></script><script src="../up.js"></script>'
            + '<link rel="icon" href="data:image/png;base64,AA"><img src="">',
        'electron-widget.html': '<script src="a.js"></script>',
        'electron-clock-widget.html': '',
        'display.html': '<script src="sub/c.js"></script>',
        'storage-migration.html': ''
    };
    const got = S.collectWebFiles((rel) => pages[rel]);
    assert.deepEqual([...got].sort(), [
        'a.js', 'b.css', 'display.html', 'electron-clock-widget.html',
        'electron-control.html', 'electron-widget.html', 'storage-migration.html'
    ]);
});
