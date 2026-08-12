const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const CONFIG = require('../constants.js');

const MIN_W = CONFIG.CONTROL_WINDOW_MIN_WIDTH;
const MIN_H = CONFIG.CONTROL_WINDOW_MIN_HEIGHT;

/**
 * На объявленном минимуме окна ряд вкладок настроек виден целиком.
 *
 * Что было измерено (окно 380×660, оно же CONFIG.CONTROL_WINDOW_MIN_*):
 *
 *   секция настроек .advanced-settings   70px   при собственных 94px
 *   ряд вкладок .tabs-row                40px   низ 626 при низе секции 630
 *   сумма высот детей панели            658px   при высоте окна 660
 *
 * То есть на минимальной высоте панель уже сжата до предела, а сжимается
 * ИМЕННО секция настроек: она единственная с `flex: 0 1 auto` и собственной
 * прокруткой. Ряду вкладок остаётся 4px запаса — а он вход во все настройки
 * приложения. Ещё 24px вниз (их даёт съёмочный стенд, см.
 * tests/visual-source.test.js) — и от кнопок видно две трети.
 *
 * Блок отзывчивости, который должен был это разруливать, был заведён на
 * `@media (max-height: 600px)` — НИЖЕ собственного минимума окна в 660, то
 * есть не срабатывал никогда.
 *
 * Порог здесь — «секция не прокручивается», а не «низ вкладок внутри окна»:
 * второе было зелёным и при 4px запаса, и при полностью съеденном отступе.
 */
test(`при ${MIN_W}×${MIN_H} секция настроек не обрезана`, async () => {
    const { app, control } = await launchApp();
    try {
        await app.evaluate(({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.setMinimumSize(size[0], size[1]);
            win.setSize(size[0], size[1]);
        }, [MIN_W, MIN_H]);
        await control.waitForTimeout(600);

        const m = await control.evaluate(() => {
            const section = document.getElementById('advancedSettings');
            // Ряда вкладок больше нет: редизайн 2026-08-12 заменил его списком
            // строк окон. Мерим последний ряд той же секции — он и упирается
            // в нижний край первым.
            const row = document.querySelector('.wrows');
            const sr = section.getBoundingClientRect();
            const rr = row.getBoundingClientRect();
            // Мерить надо КАЖДОГО предка с прокруткой, а не только внешнюю
            // секцию: у неё scrollHeight равен clientHeight, потому что урезание
            // забирает на себя вложенная .content-section. Проверка по внешнему
            // элементу была зелёной при 24 обрезанных пикселях внутри.
            const clipped = [];
            for (let el = row; el && el !== document.body; el = el.parentElement) {
                if (el.scrollHeight > el.clientHeight + 1) {
                    clipped.push({
                        cls: el.className,
                        client: el.clientHeight,
                        scroll: el.scrollHeight
                    });
                }
            }
            return {
                clipped,
                sectionBottom: sr.bottom,
                rowBottom: rr.bottom,
                viewport: window.innerHeight
            };
        });

        expect(
            m.clipped,
            'обрезаны контейнеры вокруг ряда вкладок: '
            + m.clipped.map((c) => `${c.cls} — ${c.client}px при содержимом ${c.scroll}px`).join('; ')
        ).toEqual([]);

        expect(m.rowBottom, `низ вкладок ${m.rowBottom.toFixed(1)} ниже секции ${m.sectionBottom.toFixed(1)}`)
            .toBeLessThanOrEqual(m.sectionBottom);
        expect(m.rowBottom, `низ вкладок ${m.rowBottom.toFixed(1)} при высоте окна ${m.viewport}`)
            .toBeLessThanOrEqual(m.viewport);
    } finally {
        await app.close();
    }
});
