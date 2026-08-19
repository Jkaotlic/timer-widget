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

/**
 * Восстановление сохранённой точки. Здесь ДВА разных случая, и различает их
 * ширина видимой полосы, а не факт выхода за край.
 *
 * История правила. Сначала окно считалось видимым, если на дисплее лежал его
 * ЛЕВЫЙ-ВЕРХНИЙ УГОЛ: размер в проверке не участвовал, и точка (3320, 70) при
 * размере 1000 px оставляла на экране 12 % окна. Потом прямоугольник стали
 * поджимать ЦЕЛИКОМ — и вместе с испорченными профилями отменилось намеренное
 * расположение внахлёст с краем: замерено зондом на 3440×1440, сохранено
 * x = 3470, восстановлено x = 3190. Теперь свисать разрешено, а поджимается
 * только окно, от которого не осталось полосы для захвата мышью
 * (CONFIG.WINDOW_MIN_VISIBLE_PX = 64).
 */
/** Все дисплеи прогона: на машине с двумя мониторами «за краем» — не край. */
function allDisplays(app) {
    return app.evaluate(({ screen }) => screen.getAllDisplays().map((d) => d.bounds));
}

/**
 * Прямоугольник, у которого справа НЕТ соседнего монитора.
 *
 * Спека проверяет два разных случая — «свисает, но ухватить можно» и
 * «потеряно». На одном мониторе они различаются шириной видимой полосы, а на
 * ДВУХ соседних мониторах окно, свисающее с правого края первого, целиком
 * лежит на втором: приложение честно считает его видимым и не двигает, а
 * спека, требующая «вернись на СВОЙ экран», падает.
 *
 * Замер 19.08.2026 на машине пользователя: дисплеи 3440×1440 (x=0) и
 * 1366×1024 (x=3440); окно 1000px в точке x=3420 перекрывает второй на 980px.
 * Утром того же дня второго монитора не было, и спека была зелёной — ровно тот
 * класс дефекта, когда проверка меряет машину, а не приложение.
 */
function rightmostDisplay(displays) {
    return displays.reduce((best, d) => (d.x + d.width > best.x + best.width ? d : best), displays[0]);
}

async function restoreFromPoint(app, control, target, point, scalePct) {
    await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
    const win = await findWindow(app, target.url);
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(800);

    const area = await screenBoundsOf(app, target.url);
    const geo = { scalePct, x: point(area).x, y: point(area).y };
    await win.evaluate(({ key, g }) => localStorage.setItem(key, JSON.stringify(g)),
        { key: target.storageKey, g: geo });

    await control.evaluate((ch) => window.electronAPI.send(ch), target.close);
    await control.waitForTimeout(700);
    await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
    const reopened = await findWindow(app, target.url);
    await reopened.waitForLoadState('domcontentloaded');
    await reopened.waitForTimeout(1600);

    return { area, geo, bounds: await boundsOf(app, target.url) };
}

for (const target of WINDOWS) {
    test(`${target.name}: свисающее за край окно восстанавливается КАК СОХРАНЕНО`, async () => {
        const { app, control } = await launchApp();
        try {
            // 120 px видимой полосы: окно свисает за правый край на три четверти
            // и всё равно остаётся ухватываемым.
            const displays = await allDisplays(app);
            const outer = rightmostDisplay(displays);
            const { geo, bounds } = await restoreFromPoint(
                app, control, target,
                () => ({ x: outer.x + outer.width - 120, y: outer.y + 40 }),
                400
            );

            expect(Math.abs(bounds.x - geo.x), `x ${geo.x} → ${bounds.x}: позиция не должна поджиматься`)
                .toBeLessThanOrEqual(2);
            expect(Math.abs(bounds.y - geo.y), `y ${geo.y} → ${bounds.y}`).toBeLessThanOrEqual(2);
        } finally {
            await control.evaluate((k) => localStorage.removeItem(k), target.storageKey).catch(() => {});
            await app.close();
        }
    });

    test(`${target.name}: потерянное за краем окно возвращается на экран`, async () => {
        const { app, control } = await launchApp();
        try {
            // 20 px видимой полосы — это уже не «свисает», а «потеряно». Точка
            // берётся у ВНЕШНЕГО края самого правого монитора: справа от него
            // соседей нет, значит потеряно по-настоящему, а не «уехало на
            // второй экран» (см. rightmostDisplay).
            const displays = await allDisplays(app);
            const outer = rightmostDisplay(displays);
            console.log(`   мониторов ${displays.length}, внешний край ${outer.x + outer.width}`);
            const { bounds } = await restoreFromPoint(
                app, control, target,
                () => ({ x: outer.x + outer.width - 20, y: outer.y + 40 }),
                400
            );

            // Вернулось — значит лежит целиком на КАКОМ-ТО мониторе. Именно это
            // и обещает fitRestoredBounds: у окна должна остаться полоса
            // захвата, а на каком экране — его дело.
            const home = displays.find((d) => bounds.x >= d.x && bounds.y >= d.y
                && bounds.x + bounds.width <= d.x + d.width
                && bounds.y + bounds.height <= d.y + d.height);
            expect(
                home,
                `окно ${bounds.x},${bounds.y} ${bounds.width}×${bounds.height} не поместилось целиком ни на один монитор: `
                + JSON.stringify(displays)
            ).toBeTruthy();
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
