const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Масштабирование окна не должно выбрасывать его за край экрана.
 *
 * Что здесь красное до исправления (замерено зондом на 3440×1440): виджет при
 * 400 % занимал x = 3170…4170, то есть 730 px за правым краем; часы —
 * y = 1060…1940 при высоте экрана 1440.
 *
 * Областью укладки служат ГРАНИЦЫ экрана, а не рабочая область: виджет и часы
 * держатся выше полоски меню и вправе занимать её полосу — см.
 * e2e/window-top-edge.spec.js. Прежняя редакция этого файла утверждала, что
 * выше рабочей области окно не поднять «ни при каком уровне»; замер был неполон
 * — поджимал `constrainFrameRect:toScreen:`, отключаемый опцией
 * `enableLargerThanScreen`.
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
        storageKey: 'widgetGeometry',
        base: 250
    },
    {
        name: 'часы',
        open: 'open-clock-widget',
        close: 'close-clock-widget',
        url: 'electron-clock-widget.html',
        resize: 'clock-widget-resize',
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

function boundsOf(app, urlPart) {
    return app.evaluate(({ BrowserWindow }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        return win ? win.getBounds() : null;
    }, urlPart);
}

function screenBoundsOf(app, urlPart) {
    return app.evaluate(({ BrowserWindow, screen }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        return win ? screen.getDisplayMatching(win.getBounds()).bounds : null;
    }, urlPart);
}

/**
 * Ставит окно в правый верхний угол экрана — исходное положение,
 * в котором дефект и был замерен. Без этого тест зависел бы от того, где
 * окно открылось на конкретной машине, и мог бы вхолостую зеленеть.
 */
function parkAtTopRight(app, urlPart) {
    return app.evaluate(({ BrowserWindow, screen }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        if (!win) { return null; }
        const { bounds } = screen.getDisplayMatching(win.getBounds());
        const [w] = win.getSize();
        win.setPosition(bounds.x + bounds.width - w, bounds.y);
        return win.getBounds();
    }, urlPart);
}

for (const target of WINDOWS) {
    test(`${target.name}: после увеличения масштаба окно целиком на экране`, async () => {
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
            const area = await screenBoundsOf(app, target.url);

            expect(bounds, 'границы окна должны читаться').toBeTruthy();
            expect(bounds.x, `левый край ${bounds.x} левее экрана ${area.x}`)
                .toBeGreaterThanOrEqual(area.x);
            expect(bounds.y, `верх ${bounds.y} выше экрана ${area.y}`)
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

for (const target of WINDOWS) {
    test(`${target.name}: сохранённая точка у края не выносит окно за экран`, async () => {
        // Восстановление позиции требовало, чтобы на дисплее лежал ЛЕВЫЙ-ВЕРХНИЙ
        // УГОЛ, а не всё окно. Замерено на виджете: сохранённая точка (3320, 70)
        // при размере 1000 px давала 880 px за правым краем — на экране
        // оставалось 12 % окна. Точка попадает в хранилище буквально: именно так
        // писала геометрию прежняя версия, увеличивая масштаб у края экрана,
        // поэтому испорченные профили существуют и правка масштабирования их
        // НЕ лечит — путь восстановления идёт мимо неё.
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const win = await findWindow(app, target.url);
            await win.waitForLoadState('domcontentloaded');
            await win.waitForTimeout(800);

            const area = await screenBoundsOf(app, target.url);
            // Точка ВНУТРИ экрана (угол видно), но окну там не поместиться.
            const poisoned = { scalePct: 400, x: area.x + area.width - 120, y: area.y + 40 };
            await win.evaluate(({ key, geo }) => {
                localStorage.setItem(key, JSON.stringify(geo));
            }, { key: target.storageKey, geo: poisoned });

            await control.evaluate((ch) => window.electronAPI.send(ch), target.close);
            await control.waitForTimeout(700);
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const reopened = await findWindow(app, target.url);
            await reopened.waitForLoadState('domcontentloaded');
            await reopened.waitForTimeout(1600);

            const b = await boundsOf(app, target.url);
            expect(b.x, `левый край ${b.x} левее ${area.x}`).toBeGreaterThanOrEqual(area.x);
            expect(b.y, `верх ${b.y} выше ${area.y}`).toBeGreaterThanOrEqual(area.y);
            expect(b.x + b.width, `правый край ${b.x + b.width} за пределами ${area.x + area.width}`)
                .toBeLessThanOrEqual(area.x + area.width);
            expect(b.y + b.height, `нижний край ${b.y + b.height} за пределами ${area.y + area.height}`)
                .toBeLessThanOrEqual(area.y + area.height);
        } finally {
            await control.evaluate((k) => localStorage.removeItem(k), target.storageKey).catch(() => {});
            await app.close();
        }
    });
}

for (const target of WINDOWS) {
    test(`${target.name}: масштаб и позиция переживают переоткрытие`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const win = await findWindow(app, target.url);
            await win.waitForLoadState('domcontentloaded');
            await win.waitForTimeout(800);

            const size = target.base * 3;
            await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
                { ch: target.resize, size });
            // Ждём дольше обычного: setBounds вызывает в рендерере resize, тот
            // пишет геометрию в localStorage, и записи надо дать случиться.
            await win.waitForTimeout(1200);
            const before = await boundsOf(app, target.url);

            await control.evaluate((ch) => window.electronAPI.send(ch), target.close);
            await control.waitForTimeout(700);
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const reopened = await findWindow(app, target.url);
            await reopened.waitForLoadState('domcontentloaded');
            await reopened.waitForTimeout(1400);

            const after = await boundsOf(app, target.url);

            // Допуск в 2 px: округление процента масштаба туда-обратно
            // (outerWidth → pct → размер) законно даёт единицу.
            expect(Math.abs(after.width - before.width), `ширина ${before.width} → ${after.width}`)
                .toBeLessThanOrEqual(2);
            expect(Math.abs(after.x - before.x), `позиция по x ${before.x} → ${after.x}`)
                .toBeLessThanOrEqual(2);
            expect(Math.abs(after.y - before.y), `позиция по y ${before.y} → ${after.y}`)
                .toBeLessThanOrEqual(2);
        } finally {
            // Профиль e2e ОДИН на весь прогон, поэтому спек, менявший
            // глобальное состояние, обязан его вернуть: иначе следующий файл
            // получит виджет чужого размера в чужом месте.
            await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
                { ch: target.resize, size: target.base }).catch(() => {});
            await control.waitForTimeout(600).catch(() => {});
            await app.close();
        }
    });
}
