const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Раскладка flip-стиля виджета таймера в режиме с часами (H:MM:SS).
 *
 * В виджете разделитель между группами цифр — это НЕ текст, а две точки-градиента,
 * нарисованные через ::before/::after; текстовый ':' внутри элемента намеренно
 * погашен `font-size: 0`. Правило адаптива для шести цифр возвращало шрифт
 * (`font-size: 36px`), и в режиме с часами разделитель показывал одновременно и
 * двоеточие, и пару точек.
 *
 * Проверяем ИЗМЕРЕНИЕМ, а не сверкой картинки: скриншот-набор гоняет только
 * пресеты по 5 минут, поэтому режим ≥1 часа туда вообще не попадал — именно
 * поэтому дефект и жил. Ключевая величина — вычисленный font-size разделителя:
 * любое ненулевое значение означает, что глиф рисуется.
 */

// Виджет таймера отличаем от виджета часов по группе часовых карточек:
// у часов её нет (там своя группа секунд).
async function findTimerWidget(app) {
    for (const w of app.windows()) {
        const isTimerWidget = await w
            .evaluate(() => !!document.getElementById('wFlipHoursGroup'))
            .catch(() => false);
        if (isTimerWidget) { return w; }
    }
    return null;
}

function measure() {
    const flip = document.getElementById('widgetFlip');
    const seps = Array.from(document.querySelectorAll('.widget-flip-separator'))
        // Скрытый разделитель часов участвует в замере только когда показан.
        .filter((el) => el.style.display !== 'none');
    const card = document.querySelector('.widget-flip-card');

    return {
        hasHoursClass: !!flip && flip.classList.contains('has-hours'),
        hoursGroupShown: document.getElementById('wFlipHoursGroup').style.display !== 'none',
        separators: seps.map((el) => ({
            text: el.textContent.trim(),
            fontSizePx: parseFloat(getComputedStyle(el).fontSize),
            heightPx: parseFloat(getComputedStyle(el).height),
            dotWidthPx: parseFloat(getComputedStyle(el, '::before').width)
        })),
        cardHeightPx: card ? parseFloat(getComputedStyle(card).height) : null
    };
}

test('flip-часы: разделитель — тоже точки, а не глиф', async () => {
    // 14.08.2026, жалоба «опять двоеточие флипа странное». Правило «разделитель
    // это ТОЧКИ» было применено только к виджету таймера, а окно часов всё это
    // время рисовало живой глиф ':' в 48px цветом --tw-fg-muted: мелкий, серый,
    // к геометрии карточек не привязанный и НЕ принимающий цвет пользователя,
    // хотя цифры рядом его принимают. Тест выше меряет только виджет таймера,
    // поэтому расхождение двух окон никто не видел.
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
        await control.waitForTimeout(1500);
        await control.evaluate(() => window.ipcRenderer.send('clock-widget-set-style', 'flip'));
        await control.waitForTimeout(800);

        let clock = null;
        for (const w of app.windows()) {
            if ((await w.url()).includes('electron-clock-widget')) { clock = w; }
        }
        expect(clock, 'окно часов не найдено').not.toBeNull();

        const res = await clock.evaluate(() => {
            const seps = [...document.querySelectorAll('.widget-flip-separator')]
                .filter((el) => el.getBoundingClientRect().height > 0);
            const card = [...document.querySelectorAll('.widget-flip-card')]
                .find((c) => c.getBoundingClientRect().height > 0);
            return {
                count: seps.length,
                fontSizePx: seps.map((el) => parseFloat(getComputedStyle(el).fontSize)),
                dotWidthPx: seps.map((el) => parseFloat(getComputedStyle(el, '::before').width)),
                heightPx: seps.map((el) => parseFloat(getComputedStyle(el).height)),
                cardHeightPx: card ? parseFloat(getComputedStyle(card).height) : null
            };
        });
        console.log('часы →', JSON.stringify(res));

        expect(res.count, 'у часов должен быть хотя бы один видимый разделитель').toBeGreaterThan(0);
        for (const size of res.fontSizePx) {
            expect(size, 'часы рисуют глиф ":" вместо точек').toBe(0);
        }
        for (const w of res.dotWidthPx) {
            expect(w, 'точки разделителя не нарисованы псевдоэлементом').toBeGreaterThan(0);
        }
        for (const h of res.heightPx) {
            expect(h, 'колонка точек обязана совпадать по высоте с карточкой').toBe(res.cardHeightPx);
        }
    } finally {
        await app.close();
    }
});

test('flip-виджет: разделитель остаётся точками и в режиме с часами', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    await control.waitForTimeout(1500);
    await control.evaluate(() => window.ipcRenderer.send('widget-style-update', { timerStyle: 'flip' }));
    await control.waitForTimeout(500);

    const widget = await findTimerWidget(app);
    expect(widget, 'окно виджета таймера не найдено').not.toBeNull();

    // --- Режим MM:SS (5 минут) — базовая раскладка ---
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'set', seconds: 300 }));
    await control.waitForTimeout(600);

    const short = await widget.evaluate(measure);
    console.log('MM:SS →', JSON.stringify(short));

    expect(short.hasHoursClass, 'при 5 минутах режима часов быть не должно').toBe(false);
    expect(short.separators.length, 'в режиме MM:SS показан один разделитель').toBe(1);
    for (const sep of short.separators) {
        expect(sep.text, 'текст ":" в разметке остаётся — он гасится шрифтом, а не удалением').toBe(':');
        expect(sep.fontSizePx, 'глиф двоеточия обязан быть погашен').toBe(0);
        expect(sep.dotWidthPx, 'точки базовой раскладки — 6px').toBe(6);
    }

    // --- Режим H:MM:SS (1 час) — тот самый адаптив ---
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'set', seconds: 3600 }));
    await control.waitForTimeout(600);

    const long = await widget.evaluate(measure);
    console.log('H:MM:SS →', JSON.stringify(long));

    expect(long.hasHoursClass, 'при часе должен включиться адаптив has-hours').toBe(true);
    expect(long.hoursGroupShown, 'группа часовых карточек должна показаться').toBe(true);
    expect(long.separators.length, 'в режиме H:MM:SS показаны два разделителя').toBe(2);

    for (const sep of long.separators) {
        // ГЛАВНОЕ: ненулевой font-size здесь и был дефектом.
        expect(sep.fontSizePx, 'в режиме с часами глиф ":" снова рисовался поверх точек').toBe(0);
        expect(sep.dotWidthPx, 'точки в режиме с часами уменьшаются под меньшую карточку').toBe(4);
        expect(sep.heightPx, 'колонка точек должна совпадать по высоте с карточкой').toBe(long.cardHeightPx);
    }

    expect(long.cardHeightPx, 'карточка в режиме с часами — 64px').toBe(64);

    await app.close();
});
