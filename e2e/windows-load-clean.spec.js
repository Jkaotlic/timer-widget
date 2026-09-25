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

// `alive` — глобал, который ставит ИНЛАЙНОВЫЙ скрипт окна (у дисплея —
// display-script.js, у него инлайновые только тема и подписка). С CSP на хешах
// (SEC-08) блок с неверным хешем браузер не исполняет — и окно остаётся
// разметкой без логики, а в консоли появляется «Refused to execute inline
// script». Первое ловит `alive`, второе — наблюдатель консоли.
const WINDOWS = [
    { name: 'панель', get: async (app, control) => control, alive: 'timerController' },
    { name: 'виджет', open: 'open-widget', get: (app) => waitForWidget(app), alive: 'timerWidget', drop: true },
    { name: 'часы', open: 'open-clock-widget', get: (app) => waitForClock(app), alive: 'clockWidget', drop: true },
    { name: 'дисплей', get: (app, control) => openDisplay(app, control), alive: 'displayTimer', drop: true }
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
            expect(await page.evaluate((g) => typeof window[g], w.alive), `${w.name}: инлайновый скрипт не исполнился`)
                .toBe('object');
            // Первый инлайновый блок (<head>) ставит тему — свидетель того,
            // что и его хеш принят.
            expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
                `${w.name}: инлайновый скрипт в <head> не исполнился`).not.toBeNull();
            if (w.drop) {
                expect(await page.evaluate(() => typeof window.DropGuard), `${w.name}: drop-guard.js не загружен`)
                    .toBe('object');
            }
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
    // Раньше зонд подсовывал окну инлайновый <script> с повторным `const
    // CONFIG`. С CSP на хешах (SEC-08) такой скрипт браузер не исполняет вовсе
    // — поэтому падение здесь рождается в самой странице, из таймера: это тот
    // же путь «необработанное исключение в окне», которым падает и сломанный
    // модуль.
    const { app, control } = await launchApp();
    const errors = [];
    control.on('pageerror', (e) => errors.push(e.message));
    try {
        await control.evaluate(() => {
            setTimeout(() => { throw new Error('зонд: заведомое падение'); }, 0);
        });
        await control.waitForTimeout(300);
        expect(errors.length, 'наблюдатель не увидел заведомо падающий скрипт').toBeGreaterThan(0);
    } finally {
        await app.close();
    }
});

test('CSP не пускает внедрённый инлайновый скрипт', async () => {
    // Свидетель того, что политика ДЕЙСТВУЕТ, а не просто записана в meta:
    // без 'unsafe-inline' скрипт, которого нет в списке хешей, не исполняется,
    // и Chromium называет причину в консоли. Будь CSP сломана (опечатка в meta
    // отбрасывает директиву целиком), глобал бы появился.
    const { app, control } = await launchApp();
    const consoleErrors = [];
    control.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push(m.text()); } });
    try {
        await control.evaluate(() => {
            const s = document.createElement('script');
            s.textContent = 'window.__cspProbe = 1;';
            document.head.appendChild(s);
        });
        await control.waitForTimeout(300);
        expect(await control.evaluate(() => typeof window.__cspProbe), 'внедрённый скрипт исполнился — CSP не действует')
            .toBe('undefined');
        expect(consoleErrors.some((t) => /Content Security Policy/i.test(t)),
            `отказ CSP не виден в консоли:\n${consoleErrors.join('\n')}`).toBe(true);
    } finally {
        await app.close();
    }
});
