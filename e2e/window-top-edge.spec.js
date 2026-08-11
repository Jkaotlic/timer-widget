const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

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
        base: 220
    }
];

async function findWindow(app, urlPart) {
    for (let attempt = 0; attempt < 40; attempt++) {
        for (const w of app.windows()) {
            const href = await w.evaluate(() => location.href).catch(() => '');
            if (href.includes(urlPart)) { return w; }
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`окно ${urlPart} не появилось`);
}

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
        try {
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const win = await findWindow(app, target.url);
            await win.waitForLoadState('domcontentloaded');
            await win.waitForTimeout(800);

            // 400 % тем же каналом, которым это делает Ctrl+колесо.
            const size = target.base * 4;
            await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
                { ch: target.resize, size });
            await win.waitForTimeout(700);

            const before = await metricsOf(app, target.url);
            expect(before, 'границы окна должны читаться').toBeTruthy();

            // Ровно до верхнего края экрана — тем же каналом, что и перетаскивание.
            const deltaY = before.screenBounds.y - before.bounds.y;
            await control.evaluate(({ ch, deltaY }) => window.electronAPI.send(ch, { deltaX: 0, deltaY }),
                { ch: target.move, deltaY });
            await win.waitForTimeout(500);

            const after = await metricsOf(app, target.url);
            expect(
                after.bounds.y,
                `верх окна ${after.bounds.y} вместо края экрана ${after.screenBounds.y} `
                + `(рабочая область начинается с ${after.workArea.y})`
            ).toBe(before.screenBounds.y);
        } finally {
            await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
                { ch: target.resize, size: target.base }).catch(() => {});
            await control.waitForTimeout(600).catch(() => {});
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
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const win = await findWindow(app, target.url);
            await win.waitForLoadState('domcontentloaded');
            await win.waitForTimeout(800);

            const m = await metricsOf(app, target.url);
            const parked = { scalePct: 200, x: m.screenBounds.x + 600, y: m.screenBounds.y };
            await win.evaluate(({ key, geo }) => {
                localStorage.setItem(key, JSON.stringify(geo));
            }, { key: target.storageKey, geo: parked });

            await control.evaluate((ch) => window.electronAPI.send(ch), target.close);
            await control.waitForTimeout(700);
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const reopened = await findWindow(app, target.url);
            await reopened.waitForLoadState('domcontentloaded');
            await reopened.waitForTimeout(1600);

            const after = await metricsOf(app, target.url);
            expect(
                after.bounds.y,
                `восстановленный верх ${after.bounds.y} вместо ${parked.y}`
            ).toBe(parked.y);
        } finally {
            // Профиль e2e ОДИН на весь прогон: спек, менявший глобальное
            // состояние, обязан его вернуть. Ключ лежит в хранилище САМОГО окна,
            // поэтому чистится в нём же, а не в панели.
            const alive = await findWindow(app, target.url).catch(() => null);
            if (alive) {
                await alive.evaluate((k) => localStorage.removeItem(k), target.storageKey).catch(() => {});
            }
            await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
                { ch: target.resize, size: target.base }).catch(() => {});
            await control.waitForTimeout(600).catch(() => {});
            await app.close();
        }
    });
}
