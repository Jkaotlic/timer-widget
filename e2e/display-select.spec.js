'use strict';

/**
 * Список мониторов в живой панели (BUG-18).
 *
 * Сохранённый выбор монитора встраивался в CSS-селектор без экранирования, и
 * кавычка в `selectedDisplay` роняла построение списка исключением. Здесь —
 * что метод, переехавший в panel-display.js, подмешан в контроллер и строит
 * список и на мусоре в хранилище.
 *
 * Профиль e2e общий: `selectedDisplay` возвращается в `finally`.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

test('список мониторов строится и при кавычке в сохранённом выборе', async () => {
    const { app, control } = await launchApp();
    let saved = null;
    // Исключение из обработчика IPC не роняет окно, а уходит в pageerror —
    // именно так выглядел дефект: список есть, выбор не восстановлен, ошибка
    // в консоли.
    const errors = [];
    control.on('pageerror', (err) => errors.push(err.message));
    try {
        saved = await control.evaluate(() => localStorage.getItem('selectedDisplay'));
        await control.evaluate(() => {
            localStorage.setItem('selectedDisplay', '"]');
            window.ipcRenderer.send('get-displays');
        });
        // Опции: «Авто» и по одной на монитор этой машины — число берётся из
        // главного процесса, а не с монитора разработчика.
        const screens = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
        await expect(control.locator('#displaySelect option')).toHaveCount(screens + 1);
        expect(await control.locator('#displaySelect').inputValue()).toBe('auto');
        await control.waitForTimeout(300);
        expect(errors, `исключение при построении списка: ${errors.join(' | ')}`).toEqual([]);
    } finally {
        if (control && !control.isClosed()) {
            await control.evaluate((v) => {
                if (v === null) { localStorage.removeItem('selectedDisplay'); } else { localStorage.setItem('selectedDisplay', v); }
            }, saved).catch(() => {});
        }
        await app.close();
    }
});
