const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Две просьбы 18.08.2026, обе проверяются ПО КЛИКУ и ЗАМЕРОМ.
 *
 *   1. «В дисплее в стилях флип, аналог и цифры блоки времени повторяли стиль
 *      этих тем».
 *   2. «Чтобы вид тёмной и светлой темы отражался на виджет и на полноэкранный
 *      режим, чтобы все стили по умолчанию в светлой теме были светлыми, а в
 *      тёмной тёмными везде».
 *
 * Почему это e2e, а не source-тест. Источник тут скажет только, что правило
 * НАПИСАНО. Обе просьбы — про вычисленные значения на живых окнах: пластина
 * блока приезжает из токена, токен выбирается классом на <html>, класс ставит
 * JS по измеренной яркости фона, а фон приходит по IPC из панели. Любое из
 * четырёх звеньев можно порвать, не тронув ни одного правила CSS.
 *
 * Тон меряется по --tw-fg, а НЕ по классу на <html>: класс может стоять, а
 * палитра не доехать — ровно так однажды жила недостижимая светлая тема.
 */

const IS_DISPLAY = () => !!document.getElementById('progressRing');
const IS_WIDGET = () => !!document.getElementById('wFlipHoursGroup');

async function findWindow(app, marker) {
    for (const w of app.windows()) {
        if (await w.evaluate(marker).catch(() => false)) { return w; }
    }
    return null;
}

/** Тон окна так, как его видит пользователь: цвет основного текста. */
const probeTone = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const fg = cs.getPropertyValue('--tw-fg').trim();
    // rgb(255,255,255) / #ffffff — светлые чернила, значит фон тёмный.
    const light = /255,\s*255,\s*255|#fff/i.test(fg);
    return {
        fg,
        onLightBg: document.documentElement.classList.contains('on-light-bg'),
        // «Тон светлый» = чернила ТЁМНЫЕ. Считаем именно так, чтобы проверка
        // не свелась к чтению того же класса, который она и проверяет.
        toneIsLight: !light,
        plate: getComputedStyle(document.documentElement).getPropertyValue('--style-plate').trim()
    };
});

test('по умолчанию (светлая тема) виджет и дисплей светлые, в тёмной — тёмные', async () => {
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => {
            window.ipcRenderer.send('open-widget');
            window.ipcRenderer.send('open-display', { displayIndex: 0 });
        });
        await control.waitForTimeout(2000);

        const display = await findWindow(app, IS_DISPLAY);
        const widget = await findWindow(app, IS_WIDGET);
        expect(display, 'полноэкранное окно не найдено').not.toBeNull();
        expect(widget, 'окно виджета не найдено').not.toBeNull();

        // Умолчание приложения — СВЕТЛАЯ тема (UI_THEME_DEFAULT), и до
        // 18.08.2026 эти два окна её игнорировали: в виджете палитра была
        // прибита, у дисплея фон по умолчанию был тёмной заливкой.
        for (const [name, page] of [['дисплей', display], ['виджет', widget]]) {
            const tone = await probeTone(page);
            expect(tone.toneIsLight, `${name}: в светлой теме тон обязан быть светлым (--tw-fg=${tone.fg})`).toBe(true);
            expect(tone.onLightBg, `${name}: класс тона не выставлен`).toBe(true);
        }

        // Переключаем ТЕМУ кнопкой в титлбаре — именно так, как пользователь.
        await control.click('#contrastToggle');
        await control.waitForTimeout(900);

        for (const [name, page] of [['дисплей', display], ['виджет', widget]]) {
            const tone = await probeTone(page);
            expect(tone.toneIsLight, `${name}: в тёмной теме тон обязан быть тёмным (--tw-fg=${tone.fg})`).toBe(false);
            expect(tone.onLightBg, `${name}: класс тона не снят`).toBe(false);
        }

        // Пластина перекидыша обязана переворачиваться ВМЕСТЕ с тоном: до
        // правки она была литералом, и тема до неё не доезжала в принципе.
        const darkPlate = (await probeTone(display)).plate;
        await control.click('#contrastToggle');
        await control.waitForTimeout(900);
        const lightPlate = (await probeTone(display)).plate;
        expect(lightPlate).not.toBe('');
        expect(lightPlate, 'пластина не изменилась при смене тона').not.toBe(darkPlate);
    } finally {
        await app.close();
    }
});

test('тёмная заливка при светлой теме оставляет текст светлым: решает фон, а не тема', async () => {
    // Обратная половина того же правила и единственная защита от возврата
    // задокументированного провала: «почти чёрные цифры на тёмно-синем».
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);
        const display = await findWindow(app, IS_DISPLAY);
        expect(display).not.toBeNull();

        // Тема светлая (умолчание), но пользователь выбрал ТЁМНУЮ заливку.
        await control.click('.tab-btn[data-tab="display"]');
        await control.click('.bg-mode-btn[data-mode="solid"]');
        await control.waitForTimeout(600);

        const tone = await probeTone(display);
        expect(tone.toneIsLight, `тёмная заливка обязана дать светлый текст (--tw-fg=${tone.fg})`).toBe(false);

        // И обратно: «По теме» возвращает светлый холст.
        await control.click('.bg-mode-btn[data-mode="theme"]');
        await control.waitForTimeout(600);
        const back = await probeTone(display);
        expect(back.toneIsLight, 'режим «По теме» в светлой теме обязан дать светлый холст').toBe(true);
    } finally {
        await app.close();
    }
});

test('блок времени повторяет стиль: у флипа — пластина со сгибом, у «Цифр» — шрифт стиля', async () => {
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);
        const display = await findWindow(app, IS_DISPLAY);
        expect(display).not.toBeNull();

        await control.click('.tab-btn[data-tab="display"]');
        // Блок «Начало» — не живое время, значение стабильно между замерами.
        await control.evaluate(() => {
            const el = document.getElementById('showEventTime');
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // --- КРУГ: пластины у значения быть НЕ должно (проверка себя самой:
        // без неё «пластина есть» было бы зелёным и там, где она везде).
        await control.click('#displayTimerStyle button[data-val="circle"]');
        await control.waitForTimeout(600);
        const circle = await display.evaluate(() => {
            const cs = getComputedStyle(document.getElementById('eventTime'));
            return { image: cs.backgroundImage, font: cs.fontFamily };
        });
        expect(circle.image, 'в круге у значения блока пластины быть не должно').toBe('none');

        // --- ФЛИП: пластина, сгиб и блик.
        await control.click('#displayTimerStyle button[data-val="flip"]');
        await control.waitForTimeout(600);
        const flip = await display.evaluate(() => {
            const el = document.getElementById('eventTime');
            const cs = getComputedStyle(el);
            const hinge = getComputedStyle(el, '::before');
            const gloss = getComputedStyle(el, '::after');
            const card = document.querySelector('.flip-card-inner');
            return {
                image: cs.backgroundImage,
                hingeH: hinge.height,
                hingeBg: hinge.backgroundColor,
                glossImage: gloss.backgroundImage,
                cardImage: getComputedStyle(card).backgroundImage
            };
        });
        expect(flip.image, 'у флипа значение блока обязано получить пластину').toContain('gradient');
        // ТА ЖЕ пластина, что у карточки таймера, — иначе блок не «повторяет
        // стиль», а просто носит похожую заливку.
        expect(flip.cardImage, 'пластина блока разошлась с карточкой таймера').toBe(flip.image);
        expect(flip.hingeH, 'линии сгиба нет').not.toBe('0px');
        expect(flip.hingeBg, 'линия сгиба прозрачна').not.toBe('rgba(0, 0, 0, 0)');
        expect(flip.glossImage, 'блика верхней половины нет').toContain('gradient');

        // --- ЦИФРЫ: значение блока набрано ВЫБРАННЫМ шрифтом стиля.
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await control.waitForTimeout(600);
        await control.click('#displayDigitsFont .font-option[data-val="orbitron"]');
        await control.waitForTimeout(700);
        const digits = await display.evaluate(() => ({
            block: getComputedStyle(document.getElementById('eventTime')).fontFamily,
            timer: getComputedStyle(document.getElementById('digitsTime')).fontFamily
        }));
        expect(digits.timer.toLowerCase(), 'шрифт не доехал до таймера').toContain('orbitron');
        expect(digits.block.toLowerCase(), 'шрифт стиля не доехал до блока времени').toContain('orbitron');

        // И он обязан УЙТИ вместе со стилем: переменная, а не инлайн. Инлайн на
        // элементе остался бы на блоках круга и аналога — стиль сменили, а
        // блоки рядом продолжали бы стоять цифрами табло.
        await control.click('#displayTimerStyle button[data-val="circle"]');
        await control.waitForTimeout(600);
        const backToCircle = await display.evaluate(
            () => getComputedStyle(document.getElementById('eventTime')).fontFamily
        );
        expect(backToCircle.toLowerCase(), 'шрифт «Цифр» залип на блоке после смены стиля').not.toContain('orbitron');
    } finally {
        await app.close();
    }
});

test('аналог: стрелки мини-часов в блоке — те же, что у большого циферблата', async () => {
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);
        const display = await findWindow(app, IS_DISPLAY);
        expect(display).not.toBeNull();

        await control.click('.tab-btn[data-tab="display"]');
        await control.evaluate(() => {
            const el = document.getElementById('showEventTime');
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await control.click('#displayTimerStyle button[data-val="analog"]');
        await control.waitForTimeout(700);

        const m = await display.evaluate(() => ({
            big: getComputedStyle(document.getElementById('analogHandHour')).backgroundImage,
            mini: getComputedStyle(document.querySelector('#eventTimeBlock .mini-hand-hour')).backgroundImage,
            bigTick: getComputedStyle(document.querySelector('.clock-tick')).backgroundColor,
            miniTick: getComputedStyle(document.querySelector('#eventTimeBlock .mini-tick:not(.quarter)')).backgroundColor
        }));
        // Раньше стрелки мини-часов были залиты СВОИМ белым литералом: на
        // светлом циферблате их не видно вовсе, а рядом большой циферблат
        // красился токеном.
        expect(m.mini, 'стрелка мини-часов разошлась с большой').toBe(m.big);
        expect(m.miniTick, 'деление мини-часов разошлось с большим').toBe(m.bigTick);
    } finally {
        await app.close();
    }
});

test('на светлом тоне у «Круга» и «Цифр» виджета появляется подложка', async () => {
    // Парная проверка к e2e/window-surface-color.spec.js, где на ТЁМНОМ тоне
    // утверждается обратное: своей подложки у этих двух стилей нет.
    //
    // Правило «подложки нет» (редизайн 12.08.2026) работало ровно потому, что
    // чернила были БЕЛЫМИ: белые цифры читаются почти на любых обоях. На
    // светлом тоне чернила тёмные, окно прозрачно целиком, и на тёмном рабочем
    // столе от таймера оставалась одна дуга — замер на кадре light-widget.png.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        await control.waitForTimeout(1500);
        const widget = await findWindow(app, IS_WIDGET);
        expect(widget, 'окно виджета не найдено').not.toBeNull();

        // Тема — умолчание приложения, то есть светлая. Стиль ставим кликом.
        await control.click('.tab-btn[data-tab="timer"]');
        await control.click('#timerStyle button[data-val="circle"]');
        await control.waitForTimeout(700);
        const circleFill = await widget.evaluate(
            () => getComputedStyle(document.querySelector('.bg-circle')).fill
        );
        expect(circleFill, `у круга на светлом тоне обязана быть подложка (${circleFill})`).not.toBe('none');
        expect(circleFill, 'подложка круга не может быть полностью прозрачной').not.toMatch(/,\s*0\)$/);

        await control.click('#timerStyle button[data-val="digits"]');
        await control.waitForTimeout(700);
        const digitsBg = await widget.evaluate(
            () => getComputedStyle(document.querySelector('.widget-digits-time')).backgroundColor
        );
        const alpha = /rgba?\([^)]*,\s*([0-9.]+)\)/.exec(digitsBg);
        expect(Number(alpha ? alpha[1] : 1), `у «Цифр» на светлом тоне обязана быть подложка (${digitsBg})`)
            .toBeGreaterThan(0.5);

        // Профиль e2e общий: возвращаем стиль, как это делают соседние спеки.
        await control.click('#timerStyle button[data-val="circle"]');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});

test('четвёртый режим фона помещается в ряд и не переносится', async () => {
    // Мерим, а не смотрим: кнопок стало четыре в ряду шириной ~300px при
    // кегле 10px. Перенос на вторую строку — не «некрасиво», а обычный способ
    // не заметить, что контрол уехал за границу карточки.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.click('.tab-btn[data-tab="display"]');
        await control.waitForTimeout(600);

        const row = await control.evaluate(() => {
            const tabs = document.querySelector('.bg-mode-tabs');
            const box = tabs.getBoundingClientRect();
            const btns = [...tabs.querySelectorAll('.bg-mode-btn')].map((b) => {
                const r = b.getBoundingClientRect();
                return { text: b.textContent, top: Math.round(r.top), right: r.right, w: r.width, sw: b.scrollWidth, cw: b.clientWidth };
            });
            return { right: box.right, btns };
        });

        expect(row.btns.length, 'режимов фона должно быть четыре').toBe(4);
        expect(row.btns.map((b) => b.text)).toEqual(['По теме', 'Заливка', 'Градиент', 'Файл']);
        const tops = new Set(row.btns.map((b) => b.top));
        expect(tops.size, `кнопки режимов разъехались по строкам: ${JSON.stringify(row.btns.map((b) => b.top))}`).toBe(1);
        for (const b of row.btns) {
            expect(b.right, `${b.text} вылезла за ряд`).toBeLessThanOrEqual(row.right + 0.5);
            expect(b.sw, `подпись «${b.text}» не влезает в кнопку (${b.sw} > ${b.cw})`).toBeLessThanOrEqual(b.cw);
        }
    } finally {
        await app.close();
    }
});
