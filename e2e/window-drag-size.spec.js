const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Перемещение окна не меняет его размер.
 *
 * Жалоба: «при перемещении по экрану виджет самопроизвольно увеличивается в
 * размере». Среда репортёра — Windows с несколькими мониторами и масштабом
 * ≠ 100 %. Там окно, которое просто тащат мышью, получает от системы новый
 * прямоугольник: при переходе на монитор с другим масштабом приходит
 * WM_DPICHANGED, и Chromium применяет предложенный системой размер. Прежний
 * обработчик звал `setPosition`, то есть размер оставлял на усмотрение системы,
 * — и согласиться с её предложением было некому возразить.
 *
 * Второго монитора с другим масштабом здесь нет и быть не может (замерено:
 * один экран 3440×1440, scaleFactor 1), поэтому тест воспроизводит не ПРИЧИНУ,
 * а её наблюдаемое следствие: посреди жеста размер окна меняет кто-то извне.
 * Роль системы играет `win.setSize()` из главного процесса — ровно то, что
 * делает Chromium по WM_DPICHANGED. Закрепляется инвариант: пока идёт жест
 * перемещения, размер окна задаёт приложение, а не тот, кто вмешался.
 *
 * Инвариант проверяется на обеих величинах, которые дефект портил: на живом
 * размере окна и на том, что после жеста попало в localStorage, — потому что
 * жалоба «растёт» и жалоба «размер не тот после переоткрытия» это одно и то же
 * событие, замеченное в разные моменты.
 */

const WINDOWS = [
    { name: 'виджет', open: 'open-widget', url: 'electron-widget.html', storageKey: 'widgetGeometry', base: 250 },
    { name: 'часы', open: 'open-clock-widget', url: 'electron-clock-widget.html', storageKey: 'clockGeometry', base: 220 }
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

/** Роль системы: чужая смена размера посреди жеста (аналог WM_DPICHANGED). */
function resizeFromOutside(app, urlPart, size) {
    return app.evaluate(({ BrowserWindow }, { part, size }) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        if (win) { win.setSize(size, size); }
    }, { part: urlPart, size });
}

const press = (page, screenX, screenY) => page.evaluate(({ x, y }) => {
    document.querySelector('.widget-container').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, screenX: x, screenY: y }));
}, { x: screenX, y: screenY });

const moveTo = (page, screenX, screenY) => page.evaluate(({ x, y }) => {
    document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, screenX: x, screenY: y }));
}, { x: screenX, y: screenY });

const release = (page) => page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
});

for (const target of WINDOWS) {
    test(`${target.name}: чужая смена размера посреди перетаскивания отменяется`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const page = await findWindow(app, target.url);
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1200);

            const before = await boundsOf(app, target.url);

            await press(page, 500, 400);
            await moveTo(page, 520, 410);
            await page.waitForTimeout(120);

            // Система «предлагает» окну другой размер прямо посреди жеста.
            const intruded = before.width + 150;
            await resizeFromOutside(app, target.url, intruded);
            await page.waitForTimeout(150);
            expect((await boundsOf(app, target.url)).width,
                'вмешательство должно было состояться, иначе тест зелен вхолостую')
                .toBe(intruded);

            // Жест продолжается — и возвращает размер, с которым начинался.
            await moveTo(page, 540, 420);
            await page.waitForTimeout(150);
            const during = await boundsOf(app, target.url);
            expect(during.width, `ширина ${before.width} → ${during.width} за время жеста`)
                .toBe(before.width);
            expect(during.height, `высота ${before.height} → ${during.height} за время жеста`)
                .toBe(before.height);

            await release(page);
            await page.waitForTimeout(700);

            // И в хранилище уходит размер окна, а не размер вмешательства.
            const saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), target.storageKey));
            const after = await boundsOf(app, target.url);
            expect(saved.scalePct, `в хранилище ${saved.scalePct} % при ширине ${after.width}`)
                .toBe(Math.round(after.width / target.base * 100));
            expect(saved.x, 'позиция пишется по данным главного процесса').toBe(after.x);
            expect(saved.y, 'позиция пишется по данным главного процесса').toBe(after.y);
        } finally {
            await control.evaluate((k) => localStorage.removeItem(k), target.storageKey).catch(() => {});
            await app.close();
        }
    });
}
