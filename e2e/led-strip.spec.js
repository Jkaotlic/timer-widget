const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Стиль LED: окно — полоса по размеру цифр, а не квадрат.
 *
 * Жалоба: «это самый маленький размер, нет возможности уменьшить фоновую рамку
 * по размеру часов в лед режиме». Рамка занимала ОКНО целиком, окно было
 * квадратом при любом стиле, а пол его высоты равнялся 140 px — поэтому на
 * минимуме (120×140) тёмная коробка вокруг строки «00:00» и была основной
 * частью виджета.
 *
 * Мерится то, на что жаловались: доля пустоты вокруг цифр. Проверять «ширина
 * не равна высоте» бессмысленно — окно 250×249 такую проверку пройдёт, а
 * коробку не уберёт.
 *
 * Замер ДО правки (100 %, строка «00:00»): окно 250×250, рамка 250×250, цифры
 * 169×53 — рамка выше цифр в 4.7 раза. ПОСЛЕ: окно 250×90, рамка 218×80.
 */

async function findWidget(app) {
    for (let i = 0; i < 40; i++) {
        for (const w of app.windows()) {
            const href = await w.evaluate(() => location.href).catch(() => '');
            if (href.includes('electron-widget.html')) { return w; }
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('окно виджета не появилось');
}

const boundsOf = (app) => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('electron-widget.html'));
    return win ? win.getBounds() : null;
});

/** Прямоугольники рамки и цифр — то, что видит глаз. */
const ledBoxes = (page) => page.evaluate(() => {
    const frame = document.querySelector('.widget-digital-display').getBoundingClientRect();
    const digits = document.querySelector('.widget-digital-time').getBoundingClientRect();
    return {
        frame: { w: frame.width, h: frame.height },
        digits: { w: digits.width, h: digits.height },
        text: document.querySelector('.widget-digital-time').textContent
    };
});

const setStyle = (control, style) =>
    control.evaluate((s) => window.electronAPI.send('widget-style-update', { timerStyle: s }), style);

test('LED: рамка обнимает цифры, а окно становится полосой', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.electronAPI.send('open-widget'));
        const page = await findWidget(app);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);

        await setStyle(control, 'digital');
        await page.waitForTimeout(1200);

        const win = await boundsOf(app);
        const { frame, digits } = await ledBoxes(page);

        // Полоса: высота меньше половины ширины. Прежнее окно было квадратом.
        expect(win.height, `окно ${win.width}×${win.height} обязано быть полосой`)
            .toBeLessThan(win.width / 2);

        // Рамка обнимает цифры: поля — доли кегля, а не половина окна.
        // Прежде отношение высот равнялось 4.7.
        expect(frame.h / digits.h, `рамка ${Math.round(frame.h)} при цифрах ${Math.round(digits.h)}`)
            .toBeLessThan(1.9);
        expect(frame.w / digits.w, `рамка ${Math.round(frame.w)} при цифрах ${Math.round(digits.w)}`)
            .toBeLessThan(1.6);

        // И рамка заполняет полосу по высоте — иначе коробка просто переехала
        // бы из окна внутрь окна.
        expect(frame.h / win.height, `рамка ${Math.round(frame.h)} в окне ${win.height}`)
            .toBeGreaterThan(0.8);
    } finally {
        // Профиль e2e ОДИН на весь прогон: масштаб, выставленный здесь,
        // иначе достаётся следующему спеку. Замерено — центровка круга в
        // перерасходе на уменьшенном окне уплывает на 2.2 px и роняет
        // overtime-centering.spec.js.
        await control.evaluate(() => localStorage.removeItem('widgetGeometry')).catch(() => {});
        await app.close();
    }
});

test('LED: минимальный размер ниже прежнего пола окна', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.electronAPI.send('open-widget'));
        const page = await findWidget(app);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);
        await setStyle(control, 'digital');
        await page.waitForTimeout(900);

        // Ctrl+колесо вниз до упора — тем же путём, каким уменьшает пользователь.
        for (let i = 0; i < 15; i++) {
            await page.evaluate(() => document.dispatchEvent(
                new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 100 })));
            await page.waitForTimeout(80);
        }
        await page.waitForTimeout(700);

        const win = await boundsOf(app);
        const { frame, digits } = await ledBoxes(page);

        // Прежний пол высоты окна — WIDGET_MIN_HEIGHT = 140.
        expect(win.height, `минимальная высота ${win.height}`).toBeLessThan(140);
        // На минимуме рамка обязана обнимать цифры так же, как на 100 %:
        // именно здесь пустая коробка была заметнее всего.
        expect(frame.h / digits.h, `рамка ${Math.round(frame.h)} при цифрах ${Math.round(digits.h)}`)
            .toBeLessThan(1.9);
        expect(frame.h / win.height).toBeGreaterThan(0.8);
    } finally {
        // Профиль e2e ОДИН на весь прогон: масштаб, выставленный здесь,
        // иначе достаётся следующему спеку. Замерено — центровка круга в
        // перерасходе на уменьшенном окне уплывает на 2.2 px и роняет
        // overtime-centering.spec.js.
        await control.evaluate(() => localStorage.removeItem('widgetGeometry')).catch(() => {});
        await app.close();
    }
});

test('LED: строка с часами делает полосу ниже, ширина не меняется', async () => {
    // Ширина — источник сохраняемого процента масштаба (save() в
    // window-geometry.js). Расширяйся окно под содержимое, процент рос бы с
    // каждым переходом через час и переоткрытием.
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.electronAPI.send('open-widget'));
        const page = await findWidget(app);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);
        await setStyle(control, 'digital');
        await page.waitForTimeout(900);

        const before = await boundsOf(app);

        await control.evaluate(() => window.electronAPI.send('timer-command', { type: 'set', seconds: 7200 }));
        await page.waitForTimeout(1000);

        const after = await boundsOf(app);
        const { frame, digits, text } = await ledBoxes(page);

        expect(text).toContain(':');
        expect(after.width, `ширина ${before.width} → ${after.width}`).toBe(before.width);
        expect(after.height, `высота ${before.height} → ${after.height}`).toBeLessThan(before.height);
        expect(frame.w / digits.w, 'рамка обнимает и длинную строку').toBeLessThan(1.6);
    } finally {
        // Профиль e2e ОДИН на весь прогон: масштаб, выставленный здесь,
        // иначе достаётся следующему спеку. Замерено — центровка круга в
        // перерасходе на уменьшенном окне уплывает на 2.2 px и роняет
        // overtime-centering.spec.js.
        await control.evaluate(() => localStorage.removeItem('widgetGeometry')).catch(() => {});
        await app.close();
    }
});

test('LED: возврат к другому стилю возвращает квадрат', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.electronAPI.send('open-widget'));
        const page = await findWidget(app);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1200);

        await setStyle(control, 'digital');
        await page.waitForTimeout(900);
        expect((await boundsOf(app)).height).toBeLessThan((await boundsOf(app)).width / 2);

        await setStyle(control, 'circle');
        await page.waitForTimeout(1000);

        const win = await boundsOf(app);
        // Круг вписан в квадрат; допуск — на пол минимальной высоты окна.
        expect(Math.abs(win.width - win.height), `окно ${win.width}×${win.height}`)
            .toBeLessThanOrEqual(Math.max(0, 140 - win.width));
    } finally {
        // Профиль e2e ОДИН на весь прогон: масштаб, выставленный здесь,
        // иначе достаётся следующему спеку. Замерено — центровка круга в
        // перерасходе на уменьшенном окне уплывает на 2.2 px и роняет
        // overtime-centering.spec.js.
        await control.evaluate(() => localStorage.removeItem('widgetGeometry')).catch(() => {});
        await app.close();
    }
});
