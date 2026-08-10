const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Масштабирование окна не должно выбрасывать его за край экрана.
 *
 * Что здесь красное до исправления (замерено зондом на 3440×1440): виджет при
 * 400 % занимал x = 3170…4170, то есть 730 px за правым краем; часы —
 * y = 1060…1940 при высоте экрана 1440. Вернуть окно наверх нельзя: macOS не
 * пускает его выше рабочей области ни при каком уровне окна — проверено на
 * floating, screen-saver и pop-up-menu, через setPosition и через setBounds.
 *
 * Мерится настоящий BrowserWindow.getBounds(), а не DOM: дефект был именно в
 * геометрии окна, а отрисовка внутри него всё это время была безупречна.
 */

const WINDOWS = [
    {
        name: 'виджет',
        open: 'open-widget',
        close: 'close-widget',
        url: 'electron-widget.html',
        resize: 'widget-resize',
        base: 250
    },
    {
        name: 'часы',
        open: 'open-clock-widget',
        close: 'close-clock-widget',
        url: 'electron-clock-widget.html',
        resize: 'clock-widget-resize',
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

function boundsOf(app, urlPart) {
    return app.evaluate(({ BrowserWindow }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        return win ? win.getBounds() : null;
    }, urlPart);
}

function workAreaOf(app, urlPart) {
    return app.evaluate(({ BrowserWindow, screen }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        return win ? screen.getDisplayMatching(win.getBounds()).workArea : null;
    }, urlPart);
}

/**
 * Ставит окно в правый верхний угол рабочей области — исходное положение,
 * в котором дефект и был замерен. Без этого тест зависел бы от того, где
 * окно открылось на конкретной машине, и мог бы вхолостую зеленеть.
 */
function parkAtTopRight(app, urlPart) {
    return app.evaluate(({ BrowserWindow, screen }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        if (!win) { return null; }
        const { workArea } = screen.getDisplayMatching(win.getBounds());
        const [w] = win.getSize();
        win.setPosition(workArea.x + workArea.width - w, workArea.y);
        return win.getBounds();
    }, urlPart);
}

for (const target of WINDOWS) {
    test(`${target.name}: после увеличения масштаба окно целиком в рабочей области`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const win = await findWindow(app, target.url);
            await win.waitForLoadState('domcontentloaded');
            await win.waitForTimeout(800);

            const parked = await parkAtTopRight(app, target.url);
            expect(parked, 'окно должно найтись в главном процессе').toBeTruthy();

            // 400 % ТЕМ ЖЕ каналом, которым это делает Ctrl+колесо и ползунок
            // «Масштаб» в панели, — иначе тест проверял бы обходной путь.
            const size = target.base * 4;
            await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
                { ch: target.resize, size });
            await win.waitForTimeout(700);

            const bounds = await boundsOf(app, target.url);
            const area = await workAreaOf(app, target.url);

            expect(bounds, 'границы окна должны читаться').toBeTruthy();
            expect(bounds.x, `левый край ${bounds.x} левее рабочей области ${area.x}`)
                .toBeGreaterThanOrEqual(area.x);
            expect(bounds.y, `верх ${bounds.y} выше рабочей области ${area.y}`)
                .toBeGreaterThanOrEqual(area.y);
            expect(bounds.x + bounds.width, `правый край ${bounds.x + bounds.width} за пределами ${area.x + area.width}`)
                .toBeLessThanOrEqual(area.x + area.width);
            expect(bounds.y + bounds.height, `нижний край ${bounds.y + bounds.height} за пределами ${area.y + area.height}`)
                .toBeLessThanOrEqual(area.y + area.height);
        } finally {
            await app.close();
        }
    });
}
