const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Режим полосы: окно действительно сжимается, полоса действительно управляет.
 *
 * Меряется НАСТОЯЩИЙ BrowserWindow, а не класс на body: класс можно поставить,
 * а окно оставить панелью — и получилось бы худшее из состояний, полоса на
 * фоне пустоты в полный рост. Так же меряется и возврат: прежние размер и
 * позиция обязаны вернуться, иначе разворот теряет геометрию, которую
 * пользователь настроил руками.
 */
test('окно сжимается в полосу и разворачивается обратно в прежние границы', async () => {
    const { app, control } = await launchApp();
    try {
        const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());

        await control.click('#miniBarToggle');
        await control.waitForTimeout(700);

        const collapsed = await app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()[0];
            return { bounds: w.getBounds(), onTop: w.isAlwaysOnTop() };
        });

        expect(collapsed.bounds.height, `высота окна ${collapsed.bounds.height}`).toBeLessThanOrEqual(60);
        expect(collapsed.bounds.width, 'ширина при сворачивании не меняется').toBe(before.width);
        expect(collapsed.bounds.y, 'держим ВЕРХНИЙ край').toBe(before.y);
        expect(collapsed.onTop, 'полоса обязана быть поверх окон').toBe(true);

        // Полоса видна, а панель — нет.
        const seen = await control.evaluate(() => ({
            bar: document.getElementById('miniBar').getBoundingClientRect().height,
            hero: document.querySelector('.hero').getBoundingClientRect().height
        }));
        expect(seen.bar).toBeGreaterThan(40);
        expect(seen.hero).toBe(0);

        await control.click('#miniBarExpand');
        await control.waitForTimeout(700);

        const restored = await app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()[0];
            return { bounds: w.getBounds(), onTop: w.isAlwaysOnTop() };
        });
        expect(restored.bounds).toEqual(before);
        expect(restored.onTop).toBe(false);
    } finally {
        await app.close();
    }
});

test('полоса показывает то же время, что и панель, и управляет таймером', async () => {
    const { app, control } = await launchApp();
    try {
        // Время нужно задать ДО сворачивания: редизайн 2026-08-12 показывает в
        // полосе одно действие из двух по состоянию таймера, и без пресета
        // «Старт» не переводит панель в отсчёт — «Паузы» не появится вовсе.
        await control.click('.preset[data-minutes="5"]');
        await control.waitForTimeout(300);

        await control.click('#miniBarToggle');
        await control.waitForTimeout(600);

        await control.click('#miniBarStart');
        await control.waitForTimeout(2200);

        const running = await control.evaluate(() => ({
            bar: document.getElementById('miniBarTime').textContent.trim(),
            hero: document.getElementById('controlTimeDigits').textContent.trim(),
            dot: document.getElementById('miniBarDot').className
        }));
        // Одно время на два места: своего источника у полосы нет.
        expect(running.bar).toBe(running.hero);
        expect(running.dot).toContain('ok');

        await control.click('#miniBarPause');
        await control.waitForTimeout(700);
        const paused = await control.evaluate(() => document.getElementById('miniBarTime').textContent.trim());
        await control.waitForTimeout(1500);
        const stillPaused = await control.evaluate(() => document.getElementById('miniBarTime').textContent.trim());
        expect(stillPaused, 'после паузы время не должно идти').toBe(paused);

        await control.click('#miniBarReset');
        await control.waitForTimeout(700);
        const afterReset = await control.evaluate(() => ({
            bar: document.getElementById('miniBarTime').textContent.trim(),
            hero: document.getElementById('controlTimeDigits').textContent.trim()
        }));
        expect(afterReset.bar).toBe(afterReset.hero);

        // Профиль e2e общий: возвращаем окно в развёрнутое состояние.
        await control.click('#miniBarExpand');
        await control.waitForTimeout(500);
    } finally {
        await app.close();
    }
});

test('клавиша M переключает режим, а ящик настроек при сворачивании закрывается', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.tab-btn[data-tab="timer"]');
        await control.waitForTimeout(700);

        await control.keyboard.press('m');
        await control.waitForTimeout(800);

        const collapsed = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
        expect(collapsed.height).toBeLessThanOrEqual(60);
        const drawerOpen = await control.evaluate(() => document.getElementById('settingsDrawer').classList.contains('open'));
        expect(drawerOpen, 'ящик обязан закрыться до сжатия').toBe(false);

        await control.keyboard.press('m');
        await control.waitForTimeout(800);
        const expanded = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
        expect(expanded.height).toBeGreaterThan(400);
    } finally {
        await app.close();
    }
});

/**
 * Сообщение, пришедшее в свёрнутом состоянии, целиком помещается в полосу.
 *
 * Контейнер тостов прибит к НИЖНЕМУ краю окна (bottom: var(--tw-s-10) = 40px)
 * — это правка прошлого прохода, там тост закрывал герой-время. В окне высотой
 * 52px тот же отступ выносит тост ВЫШЕ верхнего края: замер на живом окне —
 * верх тоста на отметке -46 при высоте окна 52, то есть сообщение почти
 * целиком за кадром и прочитать его нельзя.
 *
 * Нашёл это кадр control-collapsed.png, добавленный в съёмку вместе с
 * режимом: на нём тост срезан верхним краем и виден как тёмная ступенька.
 */
test('тост в свёрнутом состоянии виден целиком', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('#miniBarToggle');
        await control.waitForTimeout(700);

        const m = await control.evaluate(async () => {
            window.Toast.show('Проверка размещения сообщения в полосе');
            await new Promise((r) => setTimeout(r, 400));
            const toast = document.querySelector('.toast');
            if (!toast) { return null; }
            const r = toast.getBoundingClientRect();
            return {
                top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
                left: +r.left.toFixed(1), right: +r.right.toFixed(1),
                viewportH: window.innerHeight, viewportW: window.innerWidth
            };
        });

        expect(m, 'тост не появился — проверять нечего').not.toBeNull();
        expect(m.top, `верх тоста ${m.top} выше окна`).toBeGreaterThanOrEqual(0);
        expect(m.bottom, `низ тоста ${m.bottom} при высоте окна ${m.viewportH}`)
            .toBeLessThanOrEqual(m.viewportH);
        expect(m.left).toBeGreaterThanOrEqual(0);
        expect(m.right).toBeLessThanOrEqual(m.viewportW);

        await control.click('#miniBarExpand');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});
