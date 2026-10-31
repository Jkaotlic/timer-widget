'use strict';

/**
 * Переоткрытие окна сразу после закрытия — все три окна.
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
 *
 * ТО ЖЕ САМОЕ у виджета и часов, и полноэкранный режим тут ни при чём: `close()`
 * разрушает окно сразу, а событие `closed` — то, что обнуляет ссылку в главном
 * процессе, — приходит следующим оборотом цикла. Замер 09.09.2026: `close-widget`
 * и `open-widget` без паузы между ними оставляли приложение с одним окном,
 * панелью; у часов так же. Сценарий человеческий: нажать клавишу закрытия и тут
 * же клавишу открытия.
 */

const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForDisplay, waitForDisplayGone, waitForWidget, waitForClock, panelRoundTrip,
    newestWindowId, waitForMainWindowGone, waitForDisplaySnapshot
} = require('./window-ready');

/**
 * Было: пауза 6000 / 4000 мс «заведомо больше закрытия», потом вопрос к
 * реальности. Теперь — сами события, о которых этот вопрос:
 *  1. main обработал ВСЕ команды теста (круг панели: посылки одного окна он
 *     берёт по порядку);
 *  2. старое окно разрушено в main — закрытие доведено до конца, и всё, что
 *     открытие откладывало до `closed`, уже исполнено (окно создаётся
 *     синхронно в этом обработчике);
 *  3. новое окно — опросом с таймаутом (`waitFor*`). Дефект (открытие
 *     проглочено) — это ОТСУТСТВИЕ окна, и оно видно как «не появилось за
 *     N мс», с тем же сообщением утверждения.
 */
async function closeThenSettle(app, control, urlPart, send) {
    const oldId = await newestWindowId(app, urlPart);
    expect(oldId, `окно ${urlPart} не открыто до гонки — проверять нечего`).not.toBeNull();
    await control.evaluate(send);
    await panelRoundTrip(control);
    await waitForMainWindowGone(app, oldId, { name: urlPart });
}

const openDisplay = (control) => control.evaluate(
    () => window.ipcRenderer.send('open-display', { displayIndex: 'auto' })
);
const closeDisplay = (control) => control.evaluate(
    () => window.ipcRenderer.send('close-display')
);
/**
 * Окна дисплея в ГЛАВНОМ процессе: с адресом дисплея или ещё БЕЗ адреса.
 * Считать страницы Playwright по пробе нельзя — второе окно, ещё не
 * загрузившее разметку, пробе не ответит, а именно его и ищет проверка.
 * Окна с другим адресом (виджет, часы, если тест их откроет) не в счёт
 * (ревью e2e-B7b, M8); окно без адреса в этих тестах может быть только
 * дисплеем — других окон они не открывают.
 */
const countDisplays = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed() && (w.webContents.getURL().includes('display.html') || !w.webContents.getURL())).length);

test('закрыть дисплей и сразу открыть — окно дисплея есть', async () => {
    const { app, control } = await launchApp();
    try {
        await openDisplay(control);
        await waitForDisplay(app);

        // Обе команды одним заходом в рендерер: между ними нет ни одной
        // паузы — ровно тот случай, который на медленном раннере получается
        // сам собой, когда зашитой паузы не хватает.
        await closeThenSettle(app, control, 'display.html', () => {
            window.ipcRenderer.send('close-display');
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
        });

        const display = await waitForDisplay(app).catch(() => null);
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

        await closeThenSettle(app, control, 'display.html', () => {
            window.ipcRenderer.send('close-display');
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
        });
        // Новое окно загрузилось и получило снимок: к этому моменту и
        // обработчик `closed`, и команды давно исполнены — второе окно, будь
        // оно, уже создано (оба пути создают синхронно).
        const display = await waitForDisplay(app).catch(() => null);
        if (display) { await waitForDisplaySnapshot(app, display); }
        const displays = await countDisplays(app);
        expect(displays, 'окон дисплея обязано быть ровно одно').toBe(1);

        // И оно управляемое: «закрыть» обязано его убрать.
        await closeDisplay(control);
        await waitForDisplayGone(app, { timeout: 15000 }).catch(() => {});
        const left = await countDisplays(app);
        expect(left, 'переоткрытое окно обязано слушаться команды «закрыть»').toBe(0);
    } finally {
        await app.close();
    }
});

// Виджет и часы: та же гонка, тот же общий механизм в главном процессе.
const SMALL_WINDOWS = [
    { who: 'виджет', open: 'open-widget', close: 'close-widget', wait: waitForWidget, url: 'electron-widget.html' },
    { who: 'часы', open: 'open-clock-widget', close: 'close-clock-widget', wait: waitForClock, url: 'electron-clock-widget.html' }
];

for (const w of SMALL_WINDOWS) {
    test(`${w.who}: закрыть и сразу открыть — окно остаётся`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.ipcRenderer.send(ch), w.open);
            await w.wait(app);

            const oldId = await newestWindowId(app, w.url);
            expect(oldId, `${w.who}: окно не открыто до гонки — проверять нечего`).not.toBeNull();
            await control.evaluate(([close, open]) => {
                window.ipcRenderer.send(close);
                window.ipcRenderer.send(open);
            }, [w.close, w.open]);
            await panelRoundTrip(control);
            await waitForMainWindowGone(app, oldId, { name: w.who });

            const found = await w.wait(app).catch(() => null);
            expect(
                found,
                `${w.who}: после close→open окно обязано существовать — команду «открыть» `
                + 'проглотило закрытие, которое ещё шло'
            ).not.toBeNull();

            // Закрываем за собой: профиль e2e общий на прогон.
            await control.evaluate((ch) => window.ipcRenderer.send(ch), w.close);
        } finally {
            await app.close();
        }
    });
}
