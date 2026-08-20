const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Замок «Закрепить положение» ПО КЛИКУ по настоящей кнопке.
 *
 * Просьба 19.08.2026: «введём настройку закрепления положения всего, когда всё
 * настроил, чтобы случайно что-то не сдвинуть».
 *
 * Почему e2e, а не источник. Замок — это цепочка из пяти звеньев: кнопка в
 * панели → хранилище → канал → рассылка главным процессом → класс на документе
 * чужого окна → проверка внутри каждого жеста. Источник скажет, что проверка
 * НАПИСАНА; здесь меряется, что жест ДЕЙСТВИТЕЛЬНО не сработал, и — не менее
 * важно — что после снятия замка он снова работает. Замок, который не
 * снимается, хуже отсутствующего.
 */

const IS_DISPLAY = () => !!document.getElementById('progressRing');
const IS_WIDGET = () => !!document.getElementById('wFlipHoursGroup');

async function findWindow(app, marker) {
    for (const w of app.windows()) {
        if (await w.evaluate(marker).catch(() => false)) { return w; }
    }
    return null;
}

const setToggle = (control, id, value) => control.evaluate(([key, on]) => {
    const el = document.getElementById(key);
    if (!el) { return; }
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

/** Alt-перетаскивание карточки: тот же жест, что и в display-blocks.spec.js. */
const dragBlock = (page, id, dx, dy) => page.evaluate(async ([target, ddx, ddy]) => {
    const el = document.getElementById(target);
    const r = el.getBoundingClientRect();
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const o = (x, y) => ({
        bubbles: true, cancelable: true, button: 0, altKey: true,
        screenX: x, screenY: y, clientX: x, clientY: y
    });
    const px = r.left + 8, py = r.top + 8;
    el.dispatchEvent(new MouseEvent('mousedown', o(px, py)));
    await wait(60);
    const steps = [];
    for (let i = 1; i <= 6; i++) {
        document.dispatchEvent(new MouseEvent('mousemove', o(px + (ddx * i) / 6, py + (ddy * i) / 6)));
        await wait(30);
        steps.push(Math.round(el.getBoundingClientRect().left));
    }
    document.dispatchEvent(new MouseEvent('mouseup', o(px + ddx, py + ddy)));
    // Ждём, пока ОСЯДЕТ transform: у карточки, уходящей с домашнего места,
    // снимается `translateX(-50%)`, а на `transform` висит переход в 400 мс —
    // замер раньше времени показывает не место, а середину анимации (замер:
    // видимый край 1569 → 1583 → 1586 → 1572 → 1561 → 1544 при РОВНО
    // убывающем style.left 1700 → 1600).
    await wait(600);
    const after = el.getBoundingClientRect();
    return { x: Math.round(after.left), y: Math.round(after.top), left: el.style.left, steps };
}, [id, dx, dy]);

const blockBox = (page, id) => page.evaluate((target) => {
    const r = document.getElementById(target).getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
}, id);

const lockState = (page) => page.evaluate(() => ({
    cls: document.documentElement.classList.contains('ui-locked'),
    stored: localStorage.getItem('uiLocked')
}));

test('замок держит карточки дисплея и снимается той же кнопкой', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2200);
        const display = await findWindow(app, IS_DISPLAY);
        expect(display, 'окно дисплея не найдено').not.toBeNull();
        await setToggle(control, 'showCurrentTime', true);
        await display.waitForTimeout(600);

        // --- проверка проверки: БЕЗ замка жест работает ---
        const before = await blockBox(display, 'currentTimeBlock');
        const moved = await dragBlock(display, 'currentTimeBlock', -120, 60);
        console.log(`   без замка: ${before.x},${before.y} → ${moved.x},${moved.y} (style.left ${moved.left})`);
        expect(Math.abs(moved.y - before.y), 'без замка карточка не поехала — жест сломан, замок ни при чём')
            .toBeGreaterThan(30);

        // --- замок ставится КЛИКОМ по кнопке в панели ---
        await control.click('#lockToggle');
        await control.waitForTimeout(700);
        const state = await lockState(display);
        console.log(`   замок в окне дисплея: класс ${state.cls}, в хранилище ${state.stored}`);
        expect(state.cls, 'замок не доехал до окна дисплея').toBe(true);

        const locked0 = await blockBox(display, 'currentTimeBlock');
        const locked1 = await dragBlock(display, 'currentTimeBlock', 150, -80);
        expect(locked1.x, 'под замком карточка всё равно поехала по горизонтали').toBe(locked0.x);
        expect(locked1.y, 'под замком карточка всё равно поехала по вертикали').toBe(locked0.y);

        // Колесо — второй жест, и он отдельный: замок обязан закрывать оба.
        const sized0 = await blockBox(display, 'currentTimeBlock');
        await display.evaluate(() => {
            const el = document.getElementById('currentTimeBlock');
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120,
                clientX: r.left + 10, clientY: r.top + 10
            }));
        });
        await display.waitForTimeout(500);
        const sized1 = await blockBox(display, 'currentTimeBlock');
        expect(sized1.w, 'под замком карточка отмасштабировалась колесом').toBe(sized0.w);

        // --- и снимается ТОЙ ЖЕ кнопкой ---
        await control.click('#lockToggle');
        await control.waitForTimeout(700);
        expect((await lockState(display)).cls, 'замок не снялся').toBe(false);

        const free0 = await blockBox(display, 'currentTimeBlock');
        const free1 = await dragBlock(display, 'currentTimeBlock', -100, 40);
        console.log(`   после снятия: ${free0.x},${free0.y} → ${free1.x},${free1.y}`);
        expect(Math.abs(free1.x - free0.x), 'после снятия замка карточка не поехала').toBeGreaterThan(50);
    } finally {
        // Профиль e2e общий: возвращаем всё как было. Замок снимается
        // ЗНАЧЕНИЕМ и рассылкой, а не кликом по переключателю.
        await control.evaluate(() => {
            localStorage.setItem('uiLocked', '0');
            window.UILock.applyLock(false);
            window.ipcRenderer?.send('ui-lock-update', { locked: false });
            localStorage.removeItem('displayBlockPositions');
        }).catch(() => {});
        await setToggle(control, 'showCurrentTime', false).catch(() => {});
        await app.close();
    }
});

test('замок держит ОКНО виджета, а панель продолжает им управлять', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        await control.waitForTimeout(2000);
        const widget = await findWindow(app, IS_WIDGET);
        expect(widget, 'окно виджета не найдено').not.toBeNull();

        const bounds = () => app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()
                .find((w) => w.webContents.getURL().includes('electron-widget.html'));
            const b = win.getBounds();
            return { x: b.x, y: b.y, width: b.width };
        });

        const drag = (page, dx, dy) => page.evaluate(async ([ddx, ddy]) => {
            const wait = (ms) => new Promise((res) => setTimeout(res, ms));
            const o = (x, y) => ({ bubbles: true, cancelable: true, button: 0, screenX: x, screenY: y, clientX: x, clientY: y });
            const container = document.querySelector('.widget-container') || document.body;
            container.dispatchEvent(new MouseEvent('mousedown', o(300, 300)));
            await wait(40);
            for (let i = 1; i <= 4; i++) {
                document.dispatchEvent(new MouseEvent('mousemove', o(300 + (ddx * i) / 4, 300 + (ddy * i) / 4)));
                await wait(30);
            }
            document.dispatchEvent(new MouseEvent('mouseup', o(300 + ddx, 300 + ddy)));
            await wait(200);
        }, [dx, dy]);

        // Проверка проверки: без замка окно ездит.
        const start = await bounds();
        await drag(widget, 60, 40);
        const afterFree = await bounds();
        console.log(`   без замка: ${start.x},${start.y} → ${afterFree.x},${afterFree.y}`);
        expect(Math.abs(afterFree.x - start.x), 'без замка окно не поехало — жест сломан').toBeGreaterThan(20);

        await control.click('#lockToggle');
        await control.waitForTimeout(700);
        expect(await widget.evaluate(() => document.documentElement.classList.contains('ui-locked')),
            'замок не доехал до виджета').toBe(true);

        const locked0 = await bounds();
        await drag(widget, -80, -50);
        const locked1 = await bounds();
        console.log(`   под замком: ${locked0.x},${locked0.y} → ${locked1.x},${locked1.y}`);
        expect(locked1.x, 'под замком окно поехало по горизонтали').toBe(locked0.x);
        expect(locked1.y, 'под замком окно поехало по вертикали').toBe(locked0.y);

        // Замок запрещает ЖЕСТ, а не настройку: панель обязана менять размер
        // по-прежнему, иначе это не защита от случайности, а мёртвый режим.
        //
        // Масштабы берутся МАЛЕНЬКИЕ и оба задаются здесь же. Прежняя версия
        // ставила 150% и сравнивала с тем, что осталось от соседних спек:
        // профиль e2e общий, и на macOS-раннере окно приходило в тест уже
        // шириной 1024 — то есть упёртым в экран. Запрошенный размер не равен
        // выданному: система обрезает по рабочей области, ширина не растёт, и
        // тест падал не на дефекте, а на размере чужого монитора.
        const setScale = async (pct) => {
            await control.evaluate((value) => {
                const el = document.getElementById('timerScale');
                if (!el) { return; }
                el.value = String(value);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, pct);
            await control.waitForTimeout(900);
            return bounds();
        };

        const small = await setScale(60);
        const bigger = await setScale(90);
        console.log(`   ширина окна: 60% → ${small.width}px, 90% → ${bigger.width}px`);
        // Оба размера заведомо меньше любого экрана, на котором вообще можно
        // запустить прогон, поэтому «выдано» здесь равно «запрошено».
        expect(bigger.width, 'под замком панель перестала управлять размером виджета')
            .toBeGreaterThan(small.width);
    } finally {
        // Профиль e2e ОБЩИЙ на весь прогон, и замок — глобальное состояние:
        // оставленный включённым, он ломает все соседние спеки, где что-то
        // перетаскивают. Снимаем ЗНАЧЕНИЕМ, а не кликом: клик переключает, и
        // «на всякий случай кликнуть» ставит замок обратно ровно в половине
        // случаев (так эта уборка и сломала четыре спеки перетаскивания).
        await control.evaluate(() => {
            localStorage.setItem('uiLocked', '0');
            window.UILock.applyLock(false);
            window.ipcRenderer?.send('ui-lock-update', { locked: false });
            const el = document.getElementById('timerScale');
            if (el) {
                el.value = '100';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }).catch(() => {});
        await app.close();
    }
});
