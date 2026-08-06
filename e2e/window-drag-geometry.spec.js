const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Перетаскивание окна и сохранение геометрии — виджет и часы.
 *
 * Характеризующий тест: он написан ДО выноса этих двух механизмов в общий
 * модуль и фиксирует наблюдаемое поведение, а не устройство кода. Рефакторинг
 * обязан оставить его зелёным без единой правки — в этом весь смысл.
 *
 * Почему это вообще существует в виде JS, а не `-webkit-app-region: drag`:
 * на Windows прозрачное безрамочное окно с `drag` на родителе перехватывает ВСЕ
 * события мыши раньше детей с `no-drag`. То есть механизм написан ради
 * платформы, на которой он здесь не проверяется, — тем важнее, чтобы поведение
 * было закреплено замером, а не чтением кода.
 *
 * События синтетические: окна безрамочные и всегда поверх, настоящий курсор в
 * тесте недоступен. Слушают эти окна ровно те же события (`mousedown` на
 * контейнере, `mousemove`/`mouseup` на документе), так что путь пройден
 * целиком — от обработчика до перемещения реального BrowserWindow.
 */

const WINDOWS = [
    {
        name: 'виджет',
        open: 'open-widget',
        // Опознаём окно по элементу, которого нет в остальных.
        marker: () => !!document.getElementById('wFlipHoursGroup'),
        storageKey: 'widgetGeometry',
        mainRef: 'widgetWindow'
    },
    {
        name: 'часы',
        open: 'open-clock-widget',
        marker: () => !!document.getElementById('wFlipSecGroup'),
        storageKey: 'clockGeometry',
        mainRef: 'clockWidgetWindow'
    }
];

async function findWindow(app, marker) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(marker).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

function positionOf(app, ref) {
    return app.evaluate(({ BrowserWindow }, name) => {
        const win = BrowserWindow.getAllWindows().find(w => w.__ref === name);
        return win ? win.getPosition() : null;
    }, ref);
}

// Помечаем окна в главном процессе, чтобы отличать их по ссылке, а не по
// размеру: размеры виджета и часов могут совпасть после масштабирования.
async function tagWindows(app) {
    await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
            const url = win.webContents.getURL();
            if (url.includes('electron-widget.html')) { win.__ref = 'widgetWindow'; }
            else if (url.includes('electron-clock-widget.html')) { win.__ref = 'clockWidgetWindow'; }
        }
    });
}

/** Синтетическое перетаскивание: нажатие на контейнере, движение, отпускание. */
function dragBy(page, dx, dy, opts = {}) {
    return page.evaluate(({ dx, dy, opts }) => {
        const container = document.querySelector('.widget-container');
        if (!container) { throw new Error('.widget-container не найден'); }

        const base = { bubbles: true, cancelable: true, button: 0, screenX: 500, screenY: 400 };
        const mods = { ctrlKey: !!opts.ctrlKey, altKey: !!opts.altKey, shiftKey: !!opts.shiftKey, metaKey: !!opts.metaKey };

        const target = opts.onButton
            ? (container.querySelector('button') || container)
            : container;

        target.dispatchEvent(new MouseEvent('mousedown', { ...base, ...mods }));
        document.dispatchEvent(new MouseEvent('mousemove', {
            ...base, ...mods, screenX: base.screenX + dx, screenY: base.screenY + dy
        }));
        document.dispatchEvent(new MouseEvent('mouseup', { ...base, ...mods }));
        return true;
    }, { dx, dy, opts });
}

for (const w of WINDOWS) {
    test(`${w.name}: перетаскивание двигает окно и сохраняет позицию`, async () => {
        const { app, control } = await launchApp();

        await control.evaluate((ch) => window.ipcRenderer.send(ch), w.open);
        await control.waitForTimeout(1500);
        await tagWindows(app);

        const page = await findWindow(app, w.marker);
        expect(page, `окно «${w.name}» должно открыться`).not.toBeNull();

        const before = await positionOf(app, w.mainRef);
        expect(before, 'позиция окна должна читаться').not.toBeNull();

        const DX = 40;
        const DY = 25;
        await dragBy(page, DX, DY);
        await control.waitForTimeout(600);

        const after = await positionOf(app, w.mainRef);

        // Точное смещение: обработчик пересылает разницу screenX/screenY как есть,
        // а главный процесс складывает её с текущей позицией. Допуск ±2 px — на
        // подгонку под рабочую область (окно не должно уехать за экран).
        expect(Math.abs((after[0] - before[0]) - DX), `${w.name}: смещение по X`).toBeLessThanOrEqual(2);
        expect(Math.abs((after[1] - before[1]) - DY), `${w.name}: смещение по Y`).toBeLessThanOrEqual(2);

        // Отпускание кнопки обязано записать геометрию: без этого позиция
        // терялась при перезапуске.
        const saved = await page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        }, w.storageKey);

        expect(saved, `${w.name}: геометрия должна сохраниться в ${w.storageKey}`).not.toBeNull();
        expect(Number.isFinite(saved.x) && Number.isFinite(saved.y), 'координаты должны быть числами').toBe(true);
        expect(Number.isFinite(saved.scalePct), 'масштаб должен быть числом').toBe(true);

        await app.close();
    });

    test(`${w.name}: с модификатором и по кнопке окно не двигается`, async () => {
        const { app, control } = await launchApp();

        await control.evaluate((ch) => window.ipcRenderer.send(ch), w.open);
        await control.waitForTimeout(1500);
        await tagWindows(app);

        const page = await findWindow(app, w.marker);
        expect(page).not.toBeNull();

        // Ctrl зарезервирован за масштабированием колесом — перетаскивание с ним
        // обязано молчать, иначе масштабирование дёргает окно.
        const beforeCtrl = await positionOf(app, w.mainRef);
        await dragBy(page, 60, 60, { ctrlKey: true });
        await control.waitForTimeout(400);
        expect(await positionOf(app, w.mainRef), `${w.name}: Ctrl+перетаскивание не двигает окно`)
            .toEqual(beforeCtrl);

        // Нажатие на интерактивном элементе — это работа с элементом, а не с
        // окном: isWindowDragTarget исключает button/input/select/textarea и
        // всё, что помечено role="button" или tabindex.
        const hasButton = await page.evaluate(() => !!document.querySelector('.widget-container button'));
        if (hasButton) {
            const beforeBtn = await positionOf(app, w.mainRef);
            await dragBy(page, 60, 60, { onButton: true });
            await control.waitForTimeout(400);
            expect(await positionOf(app, w.mainRef), `${w.name}: перетаскивание с кнопки не двигает окно`)
                .toEqual(beforeBtn);
        }

        await app.close();
    });
}
