const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { openDisplay, waitForWidget, waitForClock } = require('./window-ready');

/**
 * Ни одно из четырёх окон не падает при загрузке.
 *
 * Проверка выглядит тривиальной, а ловит целый класс: без сборщика КАЖДЫЙ файл
 * — classic <script>, и все они делят одну глобальную область. Второй
 * `const Layouts` в другом модуле роняет ВЕСЬ inline-скрипт окна
 * («Identifier 'Layouts' has already been declared»), после чего панель
 * существует как разметка, но не отвечает ни на одно действие.
 *
 * Поймано 01.09.2026 на собственной правке: расхождение проявлялось как
 * «ползунок не обновился», и на этот симптом можно было потратить час. Ни один
 * тест набора не смотрел на консоль окна, поэтому диагноз пришлось ставить
 * зондом.
 *
 * ЗОНД САМОПРОВЕРКИ ниже подсовывает окну заведомо падающий скрипт: без него
 * зелёный означал бы и «ошибок нет», и «мы их не видим».
 */

const WINDOWS = [
    { name: 'панель', get: async (app, control) => control },
    { name: 'виджет', open: 'open-widget', get: (app) => waitForWidget(app) },
    { name: 'часы', open: 'open-clock-widget', get: (app) => waitForClock(app) },
    { name: 'дисплей', get: (app, control) => openDisplay(app, control) }
];

test('четыре окна загружаются без ошибок в консоли', async () => {
    const { app, control } = await launchApp();
    const errors = [];
    const watch = (page, name) => {
        page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
        page.on('console', (m) => {
            if (m.type() === 'error') { errors.push(`${name}: ${m.text()}`); }
        });
    };
    try {
        watch(control, 'панель');
        for (const w of WINDOWS) {
            if (w.open) { await control.evaluate((ch) => window.ipcRenderer.send(ch), w.open); }
            const page = await w.get(app, control);
            if (page !== control) { watch(page, w.name); }
            await page.waitForTimeout(200);
        }
        // Перезагружаем панель ПОД наблюдением: слушатель повешен уже после
        // первой загрузки, и без этого её собственные ошибки прошли бы мимо.
        await control.reload();
        await control.waitForTimeout(1500);

        expect(errors, `ошибки при загрузке окон:\n${errors.join('\n')}`).toEqual([]);
        // Окно, чей скрипт упал, не доводит сборку до конца: контроллера нет.
        expect(await control.evaluate(() => typeof window.timerController)).toBe('object');
    } finally {
        await app.close();
    }
});

test('зонд самопроверки: падение скрипта в окне ВИДНО', async () => {
    const { app, control } = await launchApp();
    const errors = [];
    control.on('pageerror', (e) => errors.push(e.message));
    try {
        await control.evaluate(() => {
            const s = document.createElement('script');
            s.textContent = 'const CONFIG = 1;';   // CONFIG уже объявлен
            document.head.appendChild(s);
        });
        await control.waitForTimeout(300);
        expect(errors.length, 'наблюдатель не увидел заведомо падающий скрипт').toBeGreaterThan(0);
    } finally {
        await app.close();
    }
});
