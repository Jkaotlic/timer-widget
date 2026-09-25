'use strict';

/**
 * main-app-protocol.js — ответ схемы app:// настоящими объектами Response
 * (Node 22 их знает, как и главный процесс Electron). Файлы читаются с диска
 * репозитория: так проверяется и то, что список схемы указывает на
 * существующие файлы.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createAppProtocolHandler, registerAppProtocol } = require('../main-app-protocol');
const S = require('../app-scheme');

const ROOT = path.join(__dirname, '..');

function makeHandler(overrides = {}) {
    const warned = [];
    const handler = createAppProtocolHandler({
        appDir: ROOT,
        readFile: (file) => fs.promises.readFile(file),
        readText: (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'),
        log: { warn: (line) => warned.push(line) },
        ...overrides
    });
    return { handler, warned };
}
const req = (url, method = 'GET') => ({ url, method });

test('страница окна: 200, тело — файл, CSP и nosniff заголовками', async () => {
    const { handler } = makeHandler();
    const res = await handler(req('app://timer-widget/electron-control.html'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('content-security-policy'), S.CONTENT_SECURITY_POLICY);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const body = await res.text();
    assert.equal(body, fs.readFileSync(path.join(ROOT, 'electron-control.html'), 'utf8'));
});

test('шрифт отдаётся байтами, без порчи', async () => {
    const { handler } = makeHandler();
    const rel = 'fonts/inter-latin-400-normal.woff2';
    const res = await handler(req(`app://timer-widget/${rel}`));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'font/woff2');
    const got = Buffer.from(await res.arrayBuffer());
    assert.ok(got.equals(fs.readFileSync(path.join(ROOT, rel))));
});

test('каждый разрешённый файл корня реально читается', async () => {
    const { handler } = makeHandler();
    const allowed = S.collectWebFiles((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const rel of allowed) {
        const res = await handler(req(`app://timer-widget/${rel}`));
        assert.equal(res.status, 200, rel);
    }
});

test('отказы: чужой хост 403, вне списка и обход 404, метод 405 — и след в журнале', async () => {
    const { handler, warned } = makeHandler();
    assert.equal((await handler(req('app://evil/electron-control.html'))).status, 403);
    assert.equal((await handler(req('app://timer-widget/electron-main.js'))).status, 404);
    assert.equal((await handler(req('app://timer-widget/%2e%2e/package.json'))).status, 404);
    assert.equal((await handler(req('app://timer-widget/fonts/..%2f..%2fpreload.js'))).status, 404);
    assert.equal((await handler(req('app://timer-widget/display.html', 'POST'))).status, 405);
    assert.ok(warned.length >= 3, 'отказ без следа в журнале');
    assert.ok(warned.every((l) => !l.includes(ROOT)), 'в журнал ушёл полный путь (SEC-11)');
});

test('HEAD — заголовки без тела', async () => {
    const { handler } = makeHandler();
    const res = await handler(req('app://timer-widget/utils.js', 'HEAD'));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
});

test('разрешённый, но отсутствующий файл — 404, а не исключение', async () => {
    const { handler } = makeHandler();
    const res = await handler(req('app://timer-widget/sounds/none.wav'));
    assert.equal(res.status, 404);
});

test('файл читается ТОЛЬКО из каталога приложения', async () => {
    const seen = [];
    const { handler } = makeHandler({ readFile: async (file) => { seen.push(file); return Buffer.from(''); } });
    await handler(req('app://timer-widget/fonts/inter-latin-400-normal.woff2'));
    await handler(req('app://timer-widget/display.html'));
    assert.deepEqual(seen, [
        path.join(ROOT, 'fonts', 'inter-latin-400-normal.woff2'),
        path.join(ROOT, 'display.html')
    ]);
});

test('registerAppProtocol вешает обработчик на схему app', () => {
    const calls = [];
    const fn = () => {};
    registerAppProtocol({ handle: (scheme, h) => calls.push([scheme, h]) }, fn);
    assert.deepEqual(calls, [['app', fn]]);
});
