const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForWindow, waitForWindowGone, waitForWindowSettled, resizeOwnWindow, untilReceived,
    WIDGET_PROBE, CLOCK_PROBE
} = require('./window-ready');

/**
 * Виджет и часы обязаны доезжать до САМОГО верха экрана, а не упираться в
 * нижний край полоски меню.
 *
 * Что здесь красное до исправления (замерено на 3440×1440, рабочая область
 * y = 30): перетаскивание вверх останавливалось на y = 30 при любом уровне
 * окна и через setPosition, и через setBounds. Прежний вывод «macOS не пускает
 * окно выше рабочей области НИ ПРИ КАКОМ уровне» был неполным: поджимает не
 * система, а `-[NSWindow constrainFrameRect:toScreen:]`, который Electron
 * отключает опцией конструктора `enableLargerThanScreen`. С ней замерено
 * y = 0 и даже y = -60.
 *
 * Одной опции мало: на уровне `floating` окно у края НЕВИДИМО — полоска меню
 * (уровень 24) рисуется поверх. Проверено съёмкой экрана: на `floating` верхние
 * 30 px окна закрыты меню, на `status` (25) окно видно целиком. Поэтому оба
 * окна поднимаются на `status`; z-порядок отсюда не измерить, его стережёт
 * tests/window-top-edge.test.js.
 *
 * Мерится настоящий BrowserWindow.getBounds(): дефект был в геометрии окна.
 */

const WINDOWS = [
    {
        name: 'виджет',
        open: 'open-widget',
        close: 'close-widget',
        url: 'electron-widget.html',
        resize: 'widget-resize',
        move: 'widget-move',
        storageKey: 'widgetGeometry',
        probe: WIDGET_PROBE,
        base: 250
    },
    {
        name: 'часы',
        open: 'open-clock-widget',
        close: 'close-clock-widget',
        url: 'electron-clock-widget.html',
        resize: 'clock-widget-resize',
        move: 'clock-widget-move',
        storageKey: 'clockGeometry',
        probe: CLOCK_PROBE,
        base: 220
    }
];

// Окно — общими ожиданиями (window-ready.js), а не своей копией с паузой
// 250 мс × 40: та же ставка на скорость машины, что и пауза после открытия.
const openWindow = async (app, control, target) => {
    await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
    const win = await waitForWindow(app, target.probe, { name: `окно ${target.name}` });
    // Окно встало: восстановление геометрии доехало, отложенная запись
    // геометрии отработала (раньше — пауза 800 / 1600 мс).
    await waitForWindowSettled(app, win, target.url);
    return win;
};

/** Вернуть окну базовый размер и дождаться, что оно ВСТАЛО (профиль e2e общий). */
const backToBase = (app, win, target) => resizeOwnWindow(app, win,
    { channel: target.resize, urlPart: target.url, size: target.base });

function metricsOf(app, urlPart) {
    return app.evaluate(({ BrowserWindow, screen }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        if (!win) { return null; }
        const bounds = win.getBounds();
        const display = screen.getDisplayMatching(bounds);
        return { bounds, screenBounds: display.bounds, workArea: display.workArea };
    }, urlPart);
}

for (const target of WINDOWS) {
    test(`${target.name}: после увеличения окно доезжает до верхнего края экрана`, async () => {
        const { app, control } = await launchApp();
        // Размер и сдвиг шлёт САМО окно (Ctrl+колесо, перетаскивание): главный
        // процесс проверяет отправителя (ipc-senders.js), и посылка из панели
        // отвергается — как отверглась бы в приложении.
        let win = null;
        try {
            win = await openWindow(app, control, target);

            // 400 % тем же каналом, которым это делает Ctrl+колесо.
            await resizeOwnWindow(app, win, { channel: target.resize, urlPart: target.url, size: target.base * 4 });

            const before = await metricsOf(app, target.url);
            expect(before, 'границы окна должны читаться').toBeTruthy();

            // Ровно до верхнего края экрана — тем же каналом, что и перетаскивание.
            const deltaY = before.screenBounds.y - before.bounds.y;
            // Сдвиг применён, когда окно получило `window-geometry`: moveWindowBy
            // шлёт его всегда, синхронно после setBounds (и при deltaY = 0).
            // Окно перед этим ВСТАЛО (resizeOwnWindow), чужой посылки в пути нет.
            await untilReceived(win, 'window-geometry',
                () => win.evaluate(({ ch, deltaY }) => window.electronAPI.send(ch, { deltaX: 0, deltaY }),
                    { ch: target.move, deltaY }));

            const after = await metricsOf(app, target.url);
            expect(
                after.bounds.y,
                `верх окна ${after.bounds.y} вместо края экрана ${after.screenBounds.y} `
                + `(рабочая область начинается с ${after.workArea.y})`
            ).toBe(before.screenBounds.y);
        } finally {
            if (win) { await backToBase(app, win, target).catch(() => {}); }
            await app.close();
        }
    });
}

for (const target of WINDOWS) {
    test(`${target.name}: позиция у верхнего края переживает переоткрытие`, async () => {
        // Мало разрешить перетащить наверх: восстановление позиции поджимало
        // точку в рабочую область, поэтому окно, поставленное к самому краю,
        // после перезапуска съезжало вниз на высоту полоски меню.
        const { app, control } = await launchApp();
        try {
            const win = await openWindow(app, control, target);

            const m = await metricsOf(app, target.url);
            const parked = { scalePct: 200, x: m.screenBounds.x + 600, y: m.screenBounds.y };
            await win.evaluate(({ key, geo }) => {
                localStorage.setItem(key, JSON.stringify(geo));
            }, { key: target.storageKey, geo: parked });

            await control.evaluate((ch) => window.electronAPI.send(ch), target.close);
            await waitForWindowGone(app, target.probe, { name: `окно ${target.name}` });
            await openWindow(app, control, target);

            const after = await metricsOf(app, target.url);
            expect(
                after.bounds.y,
                `восстановленный верх ${after.bounds.y} вместо ${parked.y}`
            ).toBe(parked.y);
        } finally {
            // Профиль e2e ОДИН на весь прогон: спек, менявший глобальное
            // состояние, обязан его вернуть. Ключ лежит в хранилище САМОГО окна,
            // поэтому чистится в нём же, а не в панели.
            const alive = await waitForWindow(app, target.probe, { name: `окно ${target.name}`, timeout: 2000 })
                .catch(() => null);
            if (alive) {
                await alive.evaluate((k) => localStorage.removeItem(k), target.storageKey).catch(() => {});
                await backToBase(app, alive, target).catch(() => {});
            }
            await app.close();
        }
    });
}
