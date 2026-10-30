const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForDisplay, waitForWidget, waitForClock, waitForSteady, waitForResizeHandled, innerSize,
    armReceived, waitForDisplaySettled
} = require('./window-ready');
const { leaveFullScreen } = require('./display-window');
const { SAVE_SETTLE_MS } = require('../window-geometry.js');

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
    { name: 'виджет', open: 'open-widget', url: 'electron-widget.html', storageKey: 'widgetGeometry', base: 250, wait: waitForWidget },
    { name: 'часы', open: 'open-clock-widget', url: 'electron-clock-widget.html', storageKey: 'clockGeometry', base: 220, wait: waitForClock }
];

/** Границы окна в main, когда они ОСЕЛИ: окно на открытии само доезжает (restore, автоподгонка). */
function settledBounds(app, urlPart) {
    // waitForSteady зовёт `evaluate(read)`; адрес окна функции-читателю не
    // передать, поэтому читатель — готовый boundsOf.
    return waitForSteady({ evaluate: () => boundsOf(app, urlPart) }, null, { name: `границы ${urlPart}` });
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
        new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, buttons: 1, screenX: x, screenY: y }));
}, { x: screenX, y: screenY });

const release = (page) => page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
});

for (const target of WINDOWS) {
    test(`${target.name}: чужая смена размера посреди перетаскивания отменяется`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const page = await target.wait(app);
            await page.waitForLoadState('load');
            // «До» — осевшие границы: на открытии окно само доезжает
            // (восстановление геометрии, автоподгонка).
            const before = await settledBounds(app, target.url);

            // Первый шаг жеста — main сдвигает окно (moveWindowBy) и запоминает
            // размер. Ждём сдвиг: до него вмешательство пришлось бы не на жест.
            await press(page, 500, 400);
            await moveTo(page, 520, 410);
            await expect.poll(async () => (await boundsOf(app, target.url)).x,
                'первый шаг жеста должен был сдвинуть окно').toBe(before.x + 20);

            // Система «предлагает» окну другой размер прямо посреди жеста.
            // setSize в main синхронен: границы читаются после него.
            const intruded = before.width + 150;
            await resizeFromOutside(app, target.url, intruded);
            await expect.poll(async () => (await boundsOf(app, target.url)).width,
                'вмешательство должно было состояться, иначе тест зелен вхолостую')
                .toBe(intruded);
            // Вмешательство дошло и до страницы: иначе её resize (и отложенная
            // запись геометрии по нему) мог бы приехать уже после возврата.
            await expect.poll(() => page.evaluate(innerSize), 'страница должна получить чужой размер')
                .toEqual({ w: intruded, h: intruded });
            const intrudedInner = await page.evaluate(innerSize);

            // Жест продолжается — и возвращает размер, с которым начинался.
            // Ждём, что main отработал шаг и СООБЩИЛ окну границы
            // (window-geometry): по ним окно потом пишет геометрию.
            const geometry = await armReceived(page, 'window-geometry');
            await moveTo(page, 540, 420);
            await geometry({ match: { x: before.x + 40 } });
            const during = await boundsOf(app, target.url);
            expect(during.width, `ширина ${before.width} → ${during.width} за время жеста`)
                .toBe(before.width);
            expect(during.height, `высота ${before.height} → ${during.height} за время жеста`)
                .toBe(before.height);
            // Страница получила возвращённый размер, и отложенная запись
            // геометрии по её resize (saveSettled, SAVE_SETTLE_MS) отработала.
            await waitForResizeHandled(page, intrudedInner, { debounceMs: SAVE_SETTLE_MS });

            // mouseup пишет геометрию синхронно (onDrop → saveGeometry).
            await release(page);

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

/**
 * То же правило, третье окно — и здесь оно нарушалось БЕЗ всякого вмешательства
 * системы.
 *
 * Жалоба 17.08.2026: «выхожу из полноэкранного режима дисплея, меняю размер,
 * потом тяну — размер сбрасывается». Причина не в перетаскивании, а в том, что
 * дисплей не помечал НАЧАЛО жеста: главный процесс задаёт размер на каждом шаге
 * (иначе окно «дышит» при переходе на монитор с другим масштабом), а какой
 * именно — запоминает по флагу `first`. Виджет и часы шлют его из
 * WindowGeometry.bindWindowDrag, у дисплея своя реализация перетаскивания, и
 * флага в ней не было: размер запоминался при ПЕРВОМ в жизни окна
 * перетаскивании и потом навязывался всем последующим. Замер до правки:
 * 900×600 → перетащили → 1200×800, то есть размер часовой давности.
 */
test('дисплей: размер, заданный между жестами, переживает следующее перетаскивание', async () => {
    const { app, control } = await launchApp();
    const URL_PART = 'display.html';
    const setBounds = (bounds) => app.evaluate(({ BrowserWindow }, b) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('display.html'));
        if (win) { win.setBounds(b); }
    }, bounds);
    const drag = (page) => page.evaluate(() => {
        const target = document.querySelector('.display-container');
        const opts = (x, y) => ({ bubbles: true, cancelable: true, button: 0, screenX: x, screenY: y });
        target.dispatchEvent(new MouseEvent('mousedown', opts(600, 600)));
        for (let i = 1; i <= 4; i++) {
            document.dispatchEvent(new MouseEvent('mousemove', { ...opts(600 + i * 10, 600 + i * 6), buttons: 1 }));
        }
        document.dispatchEvent(new MouseEvent('mouseup', opts(640, 624)));
    });

    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        const page = await waitForDisplay(app);
        await waitForDisplaySettled(app, page);

        // Из полноэкранного режима выходим: перетаскивание в нём запрещено.
        // Прежде здесь был `toggle-fullscreen` из окна: он ПЕРЕКЛЮЧАЕТ, то есть
        // на машине, где окно не вошло в полноэкранный режим, ВХОДИЛ в него, а
        // через секунду шёл setBounds — в переход (разбор
        // a-fullscreen-transition-is-a-condition-not-a-duration). Выход — по
        // событию и только если режим включён.
        await leaveFullScreen(app);

        // Страница обязана получить новый размер: перетаскивание дисплея
        // отказывает, пока окно размером с экран (display-script.js,
        // windowDragMousedown).
        const resizeTo = async (bounds) => {
            const was = await waitForSteady(page, innerSize, { name: 'размер дисплея' });
            await setBounds(bounds);
            await waitForResizeHandled(page, was);
        };
        // Четыре шага по +10 по горизонтали — окно уезжает на 40. Ждём ВСЕ
        // четыре: шаг первого жеста, пришедший после следующего setBounds,
        // вернул бы его размер.
        const dragged = async (fromX, message) => {
            await drag(page);
            await expect.poll(async () => (await boundsOf(app, URL_PART)).x, message).toBe(fromX + 40);
            return boundsOf(app, URL_PART);
        };

        await resizeTo({ x: 200, y: 150, width: 1200, height: 800 });

        // Первый жест — он и запоминал размер «на всю жизнь окна».
        const startX = (await boundsOf(app, URL_PART)).x;
        const afterFirst = await dragged(startX, 'первое перетаскивание должно было сдвинуть окно');
        expect(afterFirst.x, 'первое перетаскивание должно было сдвинуть окно').not.toBe(200);
        expect(afterFirst.width, 'первое перетаскивание не должно менять ширину').toBe(1200);

        // Пользователь меняет размер МЕЖДУ жестами — обычное действие.
        await resizeTo({ x: afterFirst.x, y: afterFirst.y, width: 900, height: 600 });
        expect((await boundsOf(app, URL_PART)).width, 'размер должен был примениться').toBe(900);

        // Второй жест обязан этот размер сохранить.
        const afterSecond = await dragged(afterFirst.x, 'второе перетаскивание должно было сдвинуть окно');
        expect(afterSecond.width, `ширина ${afterSecond.width} вместо 900 — вернулся размер прошлого жеста`).toBe(900);
        expect(afterSecond.height, `высота ${afterSecond.height} вместо 600 — вернулся размер прошлого жеста`).toBe(600);
        expect(afterSecond.x, 'второе перетаскивание должно было сдвинуть окно').not.toBe(afterFirst.x);
    } finally {
        await app.close();
    }
});
