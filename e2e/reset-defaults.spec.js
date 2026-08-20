const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * «Сбросить всё» возвращает окно к ЗАВОДСКОМУ ВИДУ — сверка с чистым профилем.
 *
 * Жалоба 20.08.2026: «кнопка сбросить всё не сбрасывает к дефолтной теме
 * различных стилей». Проверять такое можно ровно одним способом: снять вид окна
 * на ЧИСТОМ профиле, накрутить, сбросить и сравнить с первым снимком. Всё
 * остальное («вроде вернулось») — это разглядывание, которым та же жалоба уже
 * закрывалась трижды.
 *
 * Меряется ВЫЧИСЛЕННЫЙ цвет в самих окнах, а не localStorage: хранилище может
 * быть чистым, а окно продолжать краситься прошлым значением — инлайновая
 * переменная на documentElement переживает пустой payload. Ровно это и
 * случилось: панель шлёт `{}`, а окно применяет только те поля, которые
 * пришли, поэтому «снять цвет» было нечем.
 */

const IS_WIDGET = () => !!document.getElementById('widgetDigits') && !!document.getElementById('wFlipHoursGroup');
const IS_CLOCK = () => !!document.getElementById('clockGradient');
const IS_DISPLAY = () => !!document.getElementById('progressRing');

async function findWindow(app, probe) {
    for (const w of app.windows()) {
        if (await w.evaluate(probe).catch(() => false)) { return w; }
    }
    return null;
}

// Что именно красится темой: переменная цифр, стопы кольца и цвет самой строки.
const paint = (page) => page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const stops = [...document.querySelectorAll('svg linearGradient stop')]
        .slice(0, 2)
        .map((s) => getComputedStyle(s).stopColor);
    const digits = document.querySelector('.time-display, #displayTime, .timer-text, #timeDisplay');
    return {
        timerVar: cs.getPropertyValue('--timer-color').trim(),
        stopVar: cs.getPropertyValue('--timer-color-stop').trim(),
        stops,
        digits: digits ? getComputedStyle(digits).color : null,
        surfacePaint: cs.getPropertyValue('--surface-paint').trim()
    };
});

const TABS = {
    widget: { chevron: '.wrow:has(#openWidgetBtn) .wrow-chevron', grid: '#themesGrid', row: '#widgetResetRow' },
    clock: { chevron: '.wrow:has(#openClockBtn) .wrow-chevron', grid: '#clockThemesGrid', row: '#clockResetRow' },
    display: { chevron: '.wrow:has(#openDisplayBtn) .wrow-chevron', grid: '#displayThemesGrid', row: '#displayResetRow' }
};

test('«Сбросить всё» возвращает окно к виду чистого профиля — все три окна', async () => {
    test.setTimeout(180000);
    const { app, control } = await launchApp();
    try {
        // --- ЭТАЛОН: чистый профиль ---
        await control.evaluate(() => localStorage.clear());
        await control.reload();
        await control.waitForTimeout(1500);
        await control.evaluate(() => {
            window.ipcRenderer.send('open-widget');
            window.ipcRenderer.send('open-clock-widget');
            window.ipcRenderer.send('open-display', { displayIndex: 0 });
        });
        await control.waitForTimeout(3000);

        const wins = {
            widget: await findWindow(app, IS_WIDGET),
            clock: await findWindow(app, IS_CLOCK),
            display: await findWindow(app, IS_DISPLAY)
        };
        for (const name of Object.keys(wins)) {
            expect(wins[name], `окно ${name} не найдено — мерить нечего`).not.toBeNull();
        }

        const snap = async () => ({
            widget: await paint(wins.widget),
            clock: await paint(wins.clock),
            display: await paint(wins.display)
        });
        const clean = await snap();
        console.log(`   чисто: ${JSON.stringify(clean)}`);

        // --- НАКРУЧИВАЕМ: тема «Неон» во всех трёх окнах, КЛИКОМ по свотчу ---
        for (const name of ['widget', 'clock', 'display']) {
            await control.click(TABS[name].chevron);
            await control.waitForTimeout(700);
            await control.click(`${TABS[name].grid} .theme-btn:nth-child(2)`);
            await control.waitForTimeout(700);
        }
        await control.waitForTimeout(1200);
        const messy = await snap();
        console.log(`   накручено: ${JSON.stringify(messy)}`);
        for (const name of ['widget', 'clock', 'display']) {
            expect(messy[name].timerVar, `${name}: тема не доехала — сбрасывать нечего`)
                .not.toBe(clean[name].timerVar);
        }

        // --- СБРОС: КЛИКОМ по кнопке в своей вкладке ---
        for (const name of ['widget', 'clock', 'display']) {
            await control.click(TABS[name].chevron);
            await control.waitForTimeout(700);
            await control.click(`${TABS[name].row} .reset-all`);
            await control.waitForTimeout(900);
        }
        await control.waitForTimeout(1500);
        const after = await snap();
        console.log(`   после сброса: ${JSON.stringify(after)}`);

        for (const name of ['widget', 'clock', 'display']) {
            expect(after[name], `${name}: вид не вернулся к заводскому`).toEqual(clean[name]);
        }
    } finally {
        await control.evaluate(() => localStorage.clear()).catch(() => {});
        await app.close();
    }
});

/**
 * «Сбросить фон по умолчанию» сбрасывает ФОН — и только его.
 *
 * Просьба 20.08.2026 («полечи сбросить фон по умолчанию тоже»). Сам фон
 * возвращался верно, а вот побочный эффект замер поймал сразу: последней
 * строкой обработчик кликал ПЕРВЫЙ свотч темы в документе, а первый принадлежит
 * сетке ВИДЖЕТА. Кнопка в разделе фона полноэкранного окна перекрашивала
 * виджет в тему «Синий» (#667eea/#764ba2) — цвет, который к тому же не является
 * заводским: на чистом профиле ключа widgetColors нет вовсе.
 *
 * Отсюда две проверки: фон вернулся к чистому И чужое окно не тронуто.
 */
test('«Сбросить фон по умолчанию» возвращает фон и НЕ красит виджет', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => localStorage.clear());
        await control.reload();
        await control.waitForTimeout(1500);
        await control.evaluate(() => {
            window.ipcRenderer.send('open-widget');
            window.ipcRenderer.send('open-display', { displayIndex: 0 });
        });
        await control.waitForTimeout(3000);
        const display = await findWindow(app, IS_DISPLAY);
        const widget = await findWindow(app, IS_WIDGET);
        expect(display, 'окно дисплея не найдено').not.toBeNull();
        expect(widget, 'окно виджета не найдено').not.toBeNull();

        const bgLook = () => display.evaluate(() => {
            const cs = getComputedStyle(document.body);
            return { image: cs.backgroundImage, color: cs.backgroundColor };
        });
        const stored = () => control.evaluate(() => ({
            widgetColors: localStorage.getItem('widgetColors'),
            bg: (() => {
                const o = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
                return { mode: o.bgMode, solid: o.bgSolid, grad1: o.bgGrad1, grad2: o.bgGrad2 };
            })()
        }));

        const cleanLook = await bgLook();
        const cleanStore = await stored();
        const cleanWidget = await paint(widget);
        console.log(`   чисто: ${JSON.stringify({ cleanLook, cleanStore })}`);

        // Накручиваем фон: режим «сплошной» + свой цвет.
        await control.click('.wrow:has(#openDisplayBtn) .wrow-chevron');
        await control.waitForTimeout(700);
        await control.click('.bg-mode-btn[data-mode="solid"]');
        await control.waitForTimeout(500);
        await control.evaluate(() => {
            const el = document.getElementById('bgSolidColor');
            el.value = '#8b0000';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await control.waitForTimeout(1200);
        const messyLook = await bgLook();
        expect(messyLook.color, 'фон не сменился — сбрасывать нечего').not.toBe(cleanLook.color);

        // --- КЛИК по кнопке сброса фона ---
        await control.click('#resetStyleBtn');
        await control.waitForTimeout(1500);

        const afterLook = await bgLook();
        const afterStore = await stored();
        const afterWidget = await paint(widget);
        console.log(`   после сброса: ${JSON.stringify({ afterLook, afterStore })}`);

        expect(afterLook, 'фон дисплея не вернулся к заводскому').toEqual(cleanLook);
        expect(afterStore.bg, 'настройки фона не вернулись к заводским').toEqual(cleanStore.bg);
        // И главное: чужое окно не тронуто.
        expect(afterStore.widgetColors, 'кнопка фона записала цвета ВИДЖЕТА').toBe(cleanStore.widgetColors);
        expect(afterWidget, 'кнопка фона перекрасила окно виджета').toEqual(cleanWidget);
    } finally {
        await control.evaluate(() => localStorage.clear()).catch(() => {});
        await app.close();
    }
});
