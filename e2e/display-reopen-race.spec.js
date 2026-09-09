'use strict';

/**
 * Переоткрытие дисплея сразу после закрытия.
 *
 * Жалоба нашлась не от человека, а из CI: `display-layouts:535` («раскладка
 * переживает переоткрытие окна дисплея») падал на macOS-раннере в трёх
 * прогонах подряд ДВУМЯ разными сообщениями — «окно дисплея не появилось за
 * 20000 мс» и «Target page, context or browser has been closed». Спека ждала
 * закрытия паузой в 800 мс, и это выглядело как обычная ставка на скорость
 * машины.
 *
 * Ставка была не единственной болезнью. Замер 09.09.2026: если между
 * `close-display` и `open-display` не ждать вовсе, окна дисплея не остаётся
 * СОВСЕМ — через 5 секунд у приложения одно окно, панель. Дефект в
 * приложении, и у него есть человеческий сценарий: закрыть дисплей и сразу
 * открыть его снова.
 *
 * Почему так. Окно дисплея полноэкранное, и закрывают его не мгновенно:
 * `closeDisplayWindow()` выходит из полноэкранного режима и ждёт события
 * `leave-full-screen` (иначе macOS роняет приложение целиком — см. разбор там
 * же в electron-main.js). Всё это время `displayWindow` — живая ссылка на
 * обречённое окно. `open-display` видел её, считал «дисплей уже открыт»,
 * делал `focus()` и выходил. Потом закрытие доводилось до конца, и окна не
 * оставалось.
 *
 * Правило: закрывающееся окно — НЕ открытое окно. Команда «открыть» обязана
 * спросить не «есть ли объект», а «будет ли он жив».
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForDisplay, findDisplay } = require('./window-ready');

/** Сколько ждать, прежде чем спросить реальность: заведомо больше закрытия. */
const SETTLE_MS = 6000;

const openDisplay = (control) => control.evaluate(
    () => window.ipcRenderer.send('open-display', { displayIndex: 'auto' })
);
const closeDisplay = (control) => control.evaluate(
    () => window.ipcRenderer.send('close-display')
);
const countDisplays = async (app) => {
    let n = 0;
    for (const w of app.windows()) {
        if (await w.evaluate(() => !!document.getElementById('progressRing')).catch(() => false)) { n += 1; }
    }
    return n;
};

test('закрыть дисплей и сразу открыть — окно дисплея есть', async () => {
    const { app, control } = await launchApp();
    try {
        await openDisplay(control);
        await waitForDisplay(app);

        // Обе команды одним заходом в рендерер: между ними нет ни одной
        // паузы — ровно тот случай, который на медленном раннере получается
        // сам собой, когда зашитой паузы не хватает.
        await control.evaluate(() => {
            window.ipcRenderer.send('close-display');
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
        });

        await control.waitForTimeout(SETTLE_MS);
        const display = await findDisplay(app);
        expect(
            display,
            'после close→open окно дисплея обязано существовать: команду «открыть» '
            + 'проглотило закрытие, которое ещё шло'
        ).not.toBeNull();

        // Окно не просто есть — оно отвечает и отрисовано.
        const width = await display.evaluate(
            () => document.getElementById('progressRing').getBoundingClientRect().width
        );
        expect(width, 'переоткрытое окно должно быть живым и отрисованным').toBeGreaterThan(0);

        await closeDisplay(control);
    } finally {
        await app.close();
    }
});

test('два «открыть» подряд во время закрытия дают РОВНО одно окно дисплея', async () => {
    // Вторая половина той же гонки: у отложенного открытия должен быть ОДИН
    // владелец. Иначе первый запрос создаёт окно по событию `closed`, второй —
    // сразу (ссылка уже обнулена), и на экране оказывается два полноэкранных
    // дисплея, а `displayWindow` указывает на один из них — второй становится
    // неуправляемым: его не закрыть ни кнопкой, ни клавишей D.
    const { app, control } = await launchApp();
    try {
        await openDisplay(control);
        await waitForDisplay(app);

        await control.evaluate(() => {
            window.ipcRenderer.send('close-display');
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
        });

        await control.waitForTimeout(SETTLE_MS);
        const displays = await countDisplays(app);
        expect(displays, 'окон дисплея обязано быть ровно одно').toBe(1);

        // И оно управляемое: «закрыть» обязано его убрать.
        await closeDisplay(control);
        const deadline = Date.now() + 15000;
        let left = await countDisplays(app);
        while (left > 0 && Date.now() < deadline) {
            await control.waitForTimeout(200);
            left = await countDisplays(app);
        }
        expect(left, 'переоткрытое окно обязано слушаться команды «закрыть»').toBe(0);
    } finally {
        await app.close();
    }
});
