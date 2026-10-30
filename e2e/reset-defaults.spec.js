const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForClock, waitForDisplay, waitForWidget, reloadPanel, armReceived, untilReceived, waitForQuiet,
    waitForDisplaySnapshot, waitForWidgetSnapshot, waitForClockSnapshot
} = require('./window-ready');

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

/*
 * Посылки, по которым видно, что клик ДОШЁЛ до своего окна. Ждётся ПОСЛЕДНЯЯ
 * посылка этому окну из обработчика: порядок main → окно сохраняется, значит
 * предыдущие (цвета) уже отработаны.
 *  - свотч темы (theme-grid.js): цвета окну; виджету следом ещё стиль;
 *  - «Сбросить всё» (panel-reset.js): цвета, затем pushResetTarget — виджету
 *    стиль, часам стиль и настройки (`clock-settings`), дисплею настройки.
 */
const TABS = {
    widget: { chevron: '.wrow:has(#openWidgetBtn) .wrow-chevron', grid: '#themesGrid', row: '#widgetResetRow',
        themeSent: 'widget-style-update', resetSent: 'widget-style-update' },
    clock: { chevron: '.wrow:has(#openClockBtn) .wrow-chevron', grid: '#clockThemesGrid', row: '#clockResetRow',
        themeSent: 'clock-colors-update', resetSent: 'clock-settings' },
    display: { chevron: '.wrow:has(#openDisplayBtn) .wrow-chevron', grid: '#displayThemesGrid', row: '#displayResetRow',
        themeSent: 'display-colors-update', resetSent: 'display-settings-update' }
};

/**
 * Чистый профиль: стереть хранилище, перезагрузить панель (стартовая рассылка
 * уходит уже с чистого), открыть окна и дождаться их снимков main.
 */
async function cleanProfileWindows(app, control, names) {
    await control.evaluate(() => localStorage.clear());
    await reloadPanel(control);
    await control.evaluate((list) => {
        if (list.includes('widget')) { window.ipcRenderer.send('open-widget'); }
        if (list.includes('clock')) { window.ipcRenderer.send('open-clock-widget'); }
        if (list.includes('display')) { window.ipcRenderer.send('open-display', { displayIndex: 0 }); }
    }, names);
    const wins = {};
    if (names.includes('display')) { wins.display = await waitForDisplaySnapshot(app, await waitForDisplay(app), control); }
    if (names.includes('widget')) { wins.widget = await waitForWidgetSnapshot(app, await waitForWidget(app), control); }
    if (names.includes('clock')) { wins.clock = await waitForClockSnapshot(app, await waitForClock(app), control); }
    return wins;
}

test('«Сбросить всё» возвращает окно к виду чистого профиля — все три окна', async () => {
    test.setTimeout(180000);
    const { app, control } = await launchApp();
    try {
        // --- ЭТАЛОН: чистый профиль ---
        const wins = await cleanProfileWindows(app, control, ['widget', 'clock', 'display']);
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
            // Шеврон открывает ящик синхронно; click сам ждёт видимый свотч.
            await control.click(TABS[name].chevron);
            await untilReceived(wins[name], TABS[name].themeSent,
                () => control.click(`${TABS[name].grid} .theme-btn:nth-child(2)`));
        }
        const messy = await snap();
        console.log(`   накручено: ${JSON.stringify(messy)}`);
        for (const name of ['widget', 'clock', 'display']) {
            expect(messy[name].timerVar, `${name}: тема не доехала — сбрасывать нечего`)
                .not.toBe(clean[name].timerVar);
        }

        // --- СБРОС: КЛИКОМ по кнопке в своей вкладке ---
        //
        // Сброс ВИДЖЕТА шлёт часам `clock-settings` тоже (panel-reset.js,
        // pushResetTarget). Посылки неотличимы по виду, и «первая после взвода»
        // у часов могла бы оказаться этой, ещё бывшей в пути (ревью B3, I1).
        // Поэтому приёмник часов взводится ДО сброса виджета и ждёт ВТОРУЮ.
        const clockResets = await armReceived(wins.clock, TABS.clock.resetSent);
        for (const name of ['widget', 'clock', 'display']) {
            await control.click(TABS[name].chevron);
            if (name === 'clock') {
                await control.click(`${TABS[name].row} .reset-all`);
                await clockResets({ count: 2 });
                continue;
            }
            await untilReceived(wins[name], TABS[name].resetSent,
                () => control.click(`${TABS[name].row} .reset-all`));
        }
        // Сброс виджета шлёт и часам (стиль под синхронизацией, настройки) —
        // им это пришло раньше их собственного сброса; осталось утихнуть всем.
        for (const page of Object.values(wins)) { await waitForQuiet(page); }
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
    const { app, control } = await launchApp();
    try {
        const { display, widget } = await cleanProfileWindows(app, control, ['widget', 'display']);
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
        await untilReceived(display, 'display-settings-update',
            () => control.click('.bg-mode-btn[data-mode="solid"]'));
        // Поле цвета шлёт настройки через debounce — ждём именно эту посылку.
        await untilReceived(display, 'display-settings-update', () => control.evaluate(() => {
            const el = document.getElementById('bgSolidColor');
            el.value = '#8b0000';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }), { match: { bgSolid: '#8b0000' } });
        const messyLook = await bgLook();
        expect(messyLook.color, 'фон не сменился — сбрасывать нечего').not.toBe(cleanLook.color);

        // --- КЛИК по кнопке сброса фона ---
        // Кнопка зовёт клик «По теме» — тот шлёт настройки дисплею.
        await untilReceived(display, 'display-settings-update', () => control.click('#resetStyleBtn'),
            { match: { bgMode: 'theme' } });
        // «Виджет не тронут» — утверждение об ОТСУТСТВИИ посылки. Без паузы:
        // протёкшая посылка виджету ушла бы из того же обработчика, то есть
        // раньше, чем эта, по тому же пути панель → main → виджет, где порядок
        // сохраняется. Дошла эта — дошла бы и протёкшая.
        await untilReceived(widget, 'widget-style-update',
            () => control.evaluate(() => window.timerController.pushWindowStyles()));

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
