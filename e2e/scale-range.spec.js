const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForWidget, waitForClock } = require('./window-ready');
const CONFIG = require('../constants.js');
const WindowGeometry = require('../window-geometry.js');

/**
 * Обещанный диапазон масштаба ДОСТИЖИМ, и окно на всём его протяжении
 * квадратное.
 *
 * Что было замерено 01.09.2026 (до правки): ползунок панели на 30 % давал
 * виджету 120 px при базе 250 (48 %) и часам 120 px при базе 220 (55 %). У
 * часов деления 30…50 % совпадали в один размер. Виджет вдобавок переставал
 * быть квадратом ниже 56 %: 120×140, 125×140, 138×140 — потому что минимумы по
 * осям были разные (120 против 140), а высоту виджет выводит из ширины.
 *
 * Мерится настоящий BrowserWindow.getBounds(): дефект был в геометрии окна, а
 * не в отрисовке внутри него — содержимое всё это время оставалось
 * неискажённым и центрированным (круг 89×89 в окне 120×140).
 *
 * Числа берутся из CONFIG и window-geometry, а не из литералов: спека обязана
 * следовать за реестром, иначе она проверяет вчерашнее обещание.
 */

const MIN = WindowGeometry.MIN_SCALE_PCT;

const WINDOWS = [
    { name: 'виджет', open: 'open-widget', url: 'electron-widget.html',
      base: CONFIG.WIDGET_DEFAULT_WIDTH, wait: waitForWidget, owner: 'timerWidget',
      storageKey: 'widgetGeometry',
      apply: (page, pct) => page.evaluate((p) => window.timerWidget.resizeToScale(p), pct) },
    { name: 'часы', open: 'open-clock-widget', url: 'electron-clock-widget.html',
      base: CONFIG.CLOCK_WIDGET_DEFAULT_SIZE, wait: waitForClock, owner: 'clockWidget',
      storageKey: 'clockGeometry',
      apply: (page, pct, base) => page.evaluate(({ p, b }) => window.ipcRenderer.send(
          'clock-widget-resize', { width: Math.round(b * p / 100), height: Math.round(b * p / 100) }
      ), { p: pct, b: base }) }
];

/**
 * Ждать, пока окно САМО признает новый масштаб.
 *
 * Пауза здесь не годится, и это уже записанное правило проекта: запись
 * геометрии откладывается до тишины (`SAVE_SETTLE_MS`), а на медленной машине
 * тишина наступает позже. Замер на macOS-раннере: спека ставила 100 %, ждала
 * 300 мс, и не дожидалась — окно всё ещё считало себя на 200 % от предыдущего
 * теста, поэтому первый же щелчок колеса дал 210 % вместо 110 %.
 */
async function waitForOwnScale(page, owner, expected, timeout = 8000) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const raw = await page.evaluate(
            (name) => (window[name] && window[name]._geometry)
                ? window[name]._geometry.scalePct : null, owner);
        // Пустой scalePct — это не «неизвестно», а «окно базового размера»,
        // то есть 100 %: тот же контракт, по которому модуль решает, было ли
        // что менять (см. saveSettled в window-geometry.js).
        const own = raw === undefined || raw === null ? 100 : raw;
        if (own === expected) { return own; }
        if (Date.now() >= deadline) {
            throw new Error(`окно не признало масштаб ${expected} % за ${timeout} мс: у него ${own}`);
        }
        await new Promise((r) => setTimeout(r, 50));
    }
}

const boundsOf = (app, part) => app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes(p));
    return w ? w.getBounds() : null;
}, part);

for (const target of WINDOWS) {
    test(`${target.name}: масштаб ${MIN}…100 % даёт РАЗНЫЕ квадратные размеры`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.ipcRenderer.send(ch), target.open);
            const page = await target.wait(app);
            await page.waitForTimeout(300);

            const seen = [];
            for (let pct = MIN; pct <= 100; pct += 10) {
                await target.apply(page, pct, target.base);
                await page.waitForTimeout(140);
                const b = await boundsOf(app, target.url);
                seen.push({ pct, w: b.width, h: b.height });
            }
            const table = seen.map(r => `${r.pct}%→${r.w}x${r.h}`).join(' ');

            // 1. Пол достижим: при MIN окно РОВНО того размера, который обещан.
            const floor = seen[0];
            expect(floor.w, `пол не достигнут: ${table}`)
                .toBe(Math.round(target.base * MIN / 100));

            // 2. Окно квадратное на всей лестнице.
            for (const r of seen) {
                expect(r.h, `окно не квадратное при ${r.pct} %: ${table}`).toBe(r.w);
            }

            // 3. Ни одна пара соседних ступеней не совпала: каждое деление
            //    ползунка обязано что-то менять.
            for (let i = 1; i < seen.length; i++) {
                expect(seen[i].w, `ступени ${seen[i - 1].pct} % и ${seen[i].pct} % дали один размер: ${table}`)
                    .toBeGreaterThan(seen[i - 1].w);
            }
        } finally {
            await app.close();
        }
    });
}

/**
 * Размер, изменённый НЕ колесом (окна `resizable: true` — их тянут за край
 * рамки), обязан доехать до ползунка панели.
 *
 * Замер до правки: окно 500 px (200 %), в хранилище {"scalePct":200}, а
 * ползунок панели показывал 100 %. Два источника правды расходились на сто
 * процентных пунктов, и следующее движение ползунка возвращало окно назад.
 */
test('растянутое за край окно доезжает до ползунка панели', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        const widget = await waitForWidget(app);
        await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
        const clock = await waitForClock(app);
        await control.waitForTimeout(600);

        const wTarget = CONFIG.WIDGET_DEFAULT_WIDTH * 2;
        const cTarget = CONFIG.CLOCK_WIDGET_DEFAULT_SIZE * 2;
        await app.evaluate(({ BrowserWindow }, sizes) => {
            for (const w of BrowserWindow.getAllWindows()) {
                const u = w.webContents.getURL();
                if (u.includes('electron-widget.html')) { w.setSize(sizes[0], sizes[0]); }
                if (u.includes('electron-clock-widget.html')) { w.setSize(sizes[1], sizes[1]); }
            }
        }, [wTarget, cTarget]);
        // Запись отложена до тишины (SAVE_SETTLE_MS), ждём с запасом.
        await control.waitForTimeout(WindowGeometry.SAVE_SETTLE_MS + 900);

        const panel = await control.evaluate(() => ({
            widget: Number(document.getElementById('timerScale').value),
            clock: Number(document.getElementById('clockScale').value)
        }));
        const stored = {
            widget: await widget.evaluate(() => JSON.parse(localStorage.getItem('widgetGeometry') || '{}').scalePct),
            clock: await clock.evaluate(() => JSON.parse(localStorage.getItem('clockGeometry') || '{}').scalePct)
        };

        expect(stored.widget, 'виджет: хранилище не запомнило растянутый размер').toBe(200);
        expect(stored.clock, 'часы: хранилище не запомнило растянутый размер').toBe(200);
        expect(panel.widget, `виджет: окно 200 %, ползунок ${panel.widget} %`).toBe(200);
        expect(panel.clock, `часы: окно 200 %, ползунок ${panel.clock} %`).toBe(200);
    } finally {
        // Профиль e2e ОБЩИЙ, и эта спека меняет глобальное состояние: без
        // возврата следующие тесты открывают окна растянутыми на 200 %, а
        // ползунки панели приезжают туда же. Именно так этот тест уронил
        // соседний на macOS-раннере.
        await restoreDefaultScale(app);
        await app.close();
    }
});

/** Стирает записанную геометрию окон — профиль остаётся таким, каким был. */
async function restoreDefaultScale(app) {
    for (const page of app.windows()) {
        const href = await page.evaluate(() => location.href).catch(() => '');
        const target = WINDOWS.find((t) => href.includes(t.url));
        if (!target) { continue; }
        await page.evaluate((key) => {
            try { localStorage.removeItem(key); } catch { /* профиль недоступен — уборку не роняем */ }
        }, target.storageKey).catch(() => {});
    }
}

/**
 * Каждый щелчок Ctrl+колеса меняет размер РОВНО на одну ступень.
 *
 * Замер до правки (8 щелчков вверх от 30 %): часы дали
 * 40 → 40 → 50 → 50 → 60 → 60 → 70 → 70 %, то есть каждый второй щелчок
 * пропадал; виджет вёл себя так же начиная с 80 %. Причём чем БОЛЬШЕ пауза
 * между щелчками, тем хуже — обычная гонка ведёт себя наоборот, и это была
 * подсказка.
 *
 * Причина: счётчик масштаба жил в обработчике колеса своей копией, а обработчик
 * `resize` перезаписывал её из `window.outerWidth`, прочитанного ПРЯМО в
 * событии, — то есть ещё СТАРЫМ размером окна (это уже записано в
 * `saveSettled`: «в момент события окно ещё прежнего размера»). Счётчик
 * откатывался на ступень назад, и следующий щелчок лишь возвращал его туда,
 * где он уже был.
 *
 * Проверяется монотонность КАЖДОГО шага, а не только итог: итог был бы зелёным
 * и при пропуске половины ступеней.
 */
for (const target of WINDOWS) {
    test(`${target.name}: каждый щелчок колеса — одна ступень, без пропусков`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.ipcRenderer.send(ch), target.open);
            const page = await target.wait(app);
            await page.waitForTimeout(300);
            await target.apply(page, 100, target.base);
            // Условие, а не пауза: см. waitForOwnScale.
            await waitForOwnScale(page, target.owner, 100);

            const seen = [];
            for (let i = 0; i < 6; i++) {
                await page.evaluate(() => document.dispatchEvent(new WheelEvent('wheel',
                    { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true })));
                // Пауза заведомо больше времени успокоения: дефект усиливался
                // именно на длинных паузах.
                await page.waitForTimeout(WindowGeometry.SAVE_SETTLE_MS + 150);
                const b = await boundsOf(app, target.url);
                seen.push(Math.round(b.width / target.base * 100));
            }
            const table = seen.join(' → ');
            for (let i = 0; i < seen.length; i++) {
                expect(seen[i], `щелчок ${i + 1} не сдвинул масштаб: 100 → ${table}`)
                    .toBe(100 + 10 * (i + 1));
            }
        } finally {
            await app.close();
        }
    });
}
