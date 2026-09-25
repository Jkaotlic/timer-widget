'use strict';

/**
 * Схема app://timer-widget/ (SEC-12) в НАСТОЯЩЕМ Electron: окна живут на ней,
 * ответ несёт CSP и nosniff заголовками, чужое не отдаётся.
 *
 * Разбор адреса и отказы проверены unit-тестом на чистом модуле
 * (tests/app-scheme.test.js). Здесь — что Chromium задаёт обработчику те же
 * адреса, что и тест, и что ответ доходит с заголовками. Запросы шлёт
 * главный процесс (`net.fetch` умеет схемы protocol.handle): окнам fetch
 * запрещён их же CSP (connect-src 'none').
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { openDisplay, waitForWindow } = require('./window-ready');

const fetchFromMain = (app, url) => app.evaluate(async ({ net }, u) => {
    const res = await net.fetch(u);
    const body = res.status === 200 ? await res.text() : '';
    return {
        status: res.status,
        type: res.headers.get('content-type'),
        csp: res.headers.get('content-security-policy'),
        nosniff: res.headers.get('x-content-type-options'),
        size: body.length
    };
}, url);

test('окна загружены с app://timer-widget/, их origin — схема, а не file://', async () => {
    const { app, control } = await launchApp();
    try {
        expect(control.url()).toBe('app://timer-widget/electron-control.html');
        expect(await control.evaluate(() => [location.origin, window.isSecureContext])).toEqual(['app://timer-widget', true]);
        await control.keyboard.press('KeyW');
        const widget = await waitForWindow(app, () => !!document.getElementById('wFlipHoursGroup'), { name: 'виджет' });
        expect(widget.url()).toBe('app://timer-widget/electron-widget.html');
        const display = await openDisplay(app, control);
        expect(display.url()).toBe('app://timer-widget/display.html');
        // Хранилище у окон ОБЩЕЕ (один origin) — на этом стоит вся синхронизация настроек.
        await control.evaluate(() => localStorage.setItem('e2eSchemeProbe', '1'));
        expect(await widget.evaluate(() => localStorage.getItem('e2eSchemeProbe'))).toBe('1');
        await control.evaluate(() => localStorage.removeItem('e2eSchemeProbe'));
    } finally {
        await app.close();
    }
});

test('ответ схемы: CSP и nosniff заголовками, чужое — 403/404', async () => {
    const { app } = await launchApp();
    try {
        const page = await fetchFromMain(app, 'app://timer-widget/electron-control.html');
        expect(page.status).toBe(200);
        expect(page.type).toBe('text/html; charset=utf-8');
        expect(page.csp).toContain("script-src 'self'");
        expect(page.csp).toContain("connect-src 'none'");
        expect(page.nosniff).toBe('nosniff');
        expect(page.size).toBeGreaterThan(1000);

        const script = await fetchFromMain(app, 'app://timer-widget/control-app.js');
        expect([script.status, script.type, script.nosniff]).toEqual([200, 'text/javascript; charset=utf-8', 'nosniff']);
        const font = await fetchFromMain(app, 'app://timer-widget/fonts/inter-latin-400-normal.woff2');
        expect([font.status, font.type]).toEqual([200, 'font/woff2']);

        for (const url of [
            'app://timer-widget/electron-main.js',
            'app://timer-widget/preload.js',
            'app://timer-widget/package.json',
            'app://timer-widget/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
            'app://timer-widget/fonts/..%2f..%2fpackage.json',
            'app://timer-widget/fonts/OFL.txt'
        ]) {
            expect((await fetchFromMain(app, url)).status, url).toBe(404);
        }
        expect((await fetchFromMain(app, 'app://evil/electron-control.html')).status).toBe(403);
    } finally {
        await app.close();
    }
});
