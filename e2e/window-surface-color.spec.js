const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Цвет ФОНА виджета и часов — по клику в панели, с замером на живом окне.
 *
 * Жалоба, с которой всё началось: «в круге и цифрах не добиться полной
 * прозрачности — виден еле видный прямоугольник». Диагноз оказался двойным:
 *
 *   1. у окон стояла подложка `rgba(0,0,0,0.01)` («near-transparent background
 *      enables drag/hit-testing on Windows»), и у круга с «Цифрами» своего фона
 *      нет вовсе — то есть единственным, что там красилось, было ОКНО;
 *   2. у флипа и аналога подложка своя и непрозрачная, и снять её было нечем:
 *      контрола фона в панели не существовало. (У стиля LED — тоже; он слит с
 *      «Цифрами» 13.08.2026, и его рамка стала фоном объединённого стиля.)
 *
 * Отсюда подход: одна пара «цвет + прозрачность» на окно, красящая подложку
 * ТОГО стиля, который сейчас на экране (каждая подложка в CSS записана как
 * `var(--surface-paint, <своё прежнее значение>)`).
 *
 * Почему замер computed-стиля на окне, а не localStorage: ключ доказывает, что
 * значение записано, а не что оно доехало и что-то покрасило. И почему
 * прозрачность проверяется на стиле со СВОЕЙ подложкой: у круга её нет вовсе,
 * там прозрачность была и без правки.
 *
 * Цвет разбирается, а не сравнивается строкой: один и тот же цвет браузер
 * печатает как `rgba(255,0,0,1)` из литерала и как `color(srgb 1 0 0)` из
 * color-mix. Та же ловушка описана в color-ownership.spec.js.
 */

/** 'rgba(1,2,3,0.5)' | 'color(srgb 1 0 0 / 0.5)' | 'none' → {r,g,b,a} | null */
function parseColor(value) {
    if (!value || value === 'none' || value === 'transparent') { return null; }
    const srgb = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (srgb) {
        return {
            r: Math.round(Number(srgb[1]) * 255),
            g: Math.round(Number(srgb[2]) * 255),
            b: Math.round(Number(srgb[3]) * 255),
            a: srgb[4] === undefined ? 1 : Number(srgb[4])
        };
    }
    const rgb = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (rgb) {
        return {
            r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]),
            a: rgb[4] === undefined ? 1 : Number(rgb[4])
        };
    }
    return null;
}

function expectRgb(actual, [r, g, b], message) {
    const parsed = parseColor(actual);
    expect(parsed, `${message}: не удалось разобрать «${actual}»`).toBeTruthy();
    // Допуск 2: color-mix считает в срgb с плавающей точкой и округляет иначе.
    expect(Math.abs(parsed.r - r), `${message}: ${actual}`).toBeLessThanOrEqual(2);
    expect(Math.abs(parsed.g - g), `${message}: ${actual}`).toBeLessThanOrEqual(2);
    expect(Math.abs(parsed.b - b), `${message}: ${actual}`).toBeLessThanOrEqual(2);
}

const findWindow = async (app, part) => {
    for (const page of app.windows()) {
        if ((await page.url()).includes(part)) { return page; }
    }
    return null;
};

const setStyle = (control, style) =>
    control.evaluate((s) => window.electronAPI.send('widget-style-update', { timerStyle: s }), style);

const paintOf = (page, selector, prop) =>
    page.evaluate(([sel, p]) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[p] : null;
    }, [selector, prop]);

const swatchOf = (target) => `#${target}SurfaceRow .surface-swatch`;

async function setPickerOpen(control, target, open) {
    const swatch = swatchOf(target);
    const isOpen = await control.getAttribute(swatch, 'aria-expanded') === 'true';
    if (isOpen !== open) {
        await control.click(swatch);
        await control.waitForTimeout(250);
    }
}

/**
 * Выбор фона МЫШЬЮ по холстам пипетки — и возврат того hex, который пипетка
 * на самом деле отдала.
 *
 * Первая версия печатала hex в поле. Она оказалась зелёной-наоборот: поле
 * стартует со своего #ff0000 и хранит прошлый выбор, а ввод совпадающего
 * значения не порождает `change` — половина проверок нажимала пустоту и
 * проверяла состояние, оставшееся от предыдущего теста. Клик по холсту такого
 * состояния не имеет: жест всегда даёт цвет, и тест сверяет окно ровно с ним.
 */
async function pickSurface(control, target, huePart, svPart) {
    await setPickerOpen(control, target, true);
    const hue = control.locator(`#${target}SurfaceCpHue`);
    const hueBox = await hue.boundingBox();
    await hue.click({ position: { x: hueBox.width * huePart, y: hueBox.height / 2 } });
    const sv = control.locator(`#${target}SurfaceCpSv`);
    const svBox = await sv.boundingBox();
    await sv.click({ position: { x: svBox.width * svPart, y: svBox.height * 0.25 } });
    await control.waitForTimeout(500);
    const hex = await control.inputValue(`#${target}SurfaceCpHex`);
    // Панель пипетки перекрывает контролы ниже — закрываем её тем же жестом.
    await setPickerOpen(control, target, false);
    return hex;
}

const hexToRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
];

test.describe('фон виджета и часов', () => {
    let app; let control; let widget;
    let ledDefault;
    // Что пипетка отдала на самом деле — тесты сверяют окно именно с этим,
    // а не с заранее придуманной константой.
    let widgetHex;

    test.beforeAll(async () => {
        ({ app, control } = await launchApp());
        await control.evaluate(() => window.electronAPI.send('open-widget'));
        await control.waitForTimeout(1500);
        widget = await findWindow(app, 'electron-widget');
        expect(widget, 'окно виджета должно открыться').toBeTruthy();
        // Эталон подложки LED снимаем ДО первой покраски: сброс обязан вернуть
        // именно её, а не «прозрачный по умолчанию».
        await setStyle(control, 'digits');
        await widget.waitForTimeout(900);
        // У «Цифр» своей подложки нет — эталон здесь «прозрачно», и сброс
        // обязан вернуть именно его. Стиль LED, у которого подложка была своя,
        // слит с этим стилем 13.08.2026.
        ledDefault = await paintOf(widget, '.widget-digits-time', 'backgroundColor');
        expect(parseColor(ledDefault) ? parseColor(ledDefault).a : 0,
            'у «Цифр» своей подложки быть не должно').toBe(0);

        await control.click('.wrow:has(#openWidgetBtn) .wrow-chevron');
        await control.waitForTimeout(400);
    });

    test.afterAll(async () => {
        // Профиль e2e общий на весь прогон: глобальное состояние возвращаем.
        if (widget) {
            await widget.evaluate(() => {
                localStorage.removeItem('timerColors');
                localStorage.removeItem('widgetColors');
            }).catch(() => {});
        }
        await app.close();
    });

    test('окно больше не красит собой прямоугольник под виджетом', async () => {
        // Та самая подложка 1%: она и была «еле видным прямоугольником».
        const bodyBg = await paintOf(widget, 'body', 'backgroundColor');
        const parsed = parseColor(bodyBg);
        expect(parsed ? parsed.a : 0, `фон окна ${bodyBg} обязан быть полностью прозрачным`).toBe(0);
    });

    test('выбранный фон красит подложку ТЕКУЩЕГО стиля', async () => {
        await setStyle(control, 'circle');
        await widget.waitForTimeout(700);
        const before = await paintOf(widget, '.bg-circle', 'fill');
        expect(before, 'у круга не должно быть своей заливки до выбора фона').toBe('none');

        widgetHex = await pickSurface(control, 'widget', 0.7, 0.9);
        expectRgb(await paintOf(widget, '.bg-circle', 'fill'), hexToRgb(widgetHex), 'заливка круга');

        // Тот же цвет — и у следующего стиля: пара одна на окно.
        await setStyle(control, 'digits');
        await widget.waitForTimeout(900);
        expectRgb(await paintOf(widget, '.widget-digits-time', 'backgroundColor'),
            hexToRgb(widgetHex), 'подложка «Цифр»');
    });

    test('прозрачность 0 гасит подложку — прежде у стилей с фоном это было недостижимо', async () => {
        // Ползунок двигаем КЛАВИАТУРОЙ: Home — нативное событие input, а не
        // синтетическое присваивание .value, которое обошло бы обработчик.
        await control.focus('#widgetSurfaceAlpha');
        await control.press('#widgetSurfaceAlpha', 'Home');
        await control.waitForTimeout(600);

        const clear = await paintOf(widget, '.widget-digits-time', 'backgroundColor');
        expect(parseColor(clear).a, `подложка «Цифр» ${clear} обязана стать прозрачной`).toBe(0);
        await expect(control.locator('#widgetSurfaceRow .surface-alpha-value')).toHaveText('0%');
    });

    test('сброс возвращает подложку СТИЛЯ, а не «прозрачный по умолчанию»', async () => {
        await control.click('#widgetSurfaceRow .surface-reset-bg');
        await control.waitForTimeout(600);

        const restored = await paintOf(widget, '.widget-digits-time', 'backgroundColor');
        expect(restored, 'подложка «Цифр» обязана вернуться к своей').toBe(ledDefault);
        await expect(control.locator('#widgetSurfaceRow .surface-alpha-value')).toHaveText('100%');
    });

    test('прозрачность работает БЕЗ выбранного цвета — гасит подложку стиля', async () => {
        // Сброс предыдущего теста снял цвет; ползунок обязан остаться рабочим.
        await expect(control.locator('#widgetSurfaceAlpha')).toBeEnabled();
        await control.focus('#widgetSurfaceAlpha');
        await control.press('#widgetSurfaceAlpha', 'Home');
        await control.waitForTimeout(600);

        const clear = await paintOf(widget, '.widget-digits-time', 'backgroundColor');
        expect(parseColor(clear).a, `родная подложка «Цифр» ${clear} обязана погаснуть`).toBe(0);
        await expect(control.locator('#widgetSurfaceRow .surface-alpha-value')).toHaveText('0%');

        await control.click('#widgetSurfaceRow .surface-reset-bg');
        await control.waitForTimeout(500);
        expect(await paintOf(widget, '.widget-digits-time', 'backgroundColor'),
            'сброс обязан вернуть родную подложку').toBe(ledDefault);
    });

    test('выбор темы НЕ стирает выбранный фон окна', async () => {
        // Раньше каждая тема и каждая пипетка пересобирали объект цветов
        // целиком — то есть первый же клик по теме уносил бы фон.
        widgetHex = await pickSurface(control, 'widget', 0.35, 0.85);
        await control.locator('#themesGrid .theme-btn').nth(1).click();
        await control.waitForTimeout(700);

        expectRgb(await paintOf(widget, '.widget-digits-time', 'backgroundColor'),
            hexToRgb(widgetHex), 'фон после выбора темы');
    });

    test('сброс цвета цифр не трогает фон', async () => {
        // Цвет цифр сейчас от темы, выбранной предыдущим тестом; сброс обязан
        // вернуть тот, что описан в CSS.
        const digitsBefore = await paintOf(widget, '.widget-digits-time', 'color');
        await control.click('#widgetSurfaceRow .surface-reset-timer');
        await control.waitForTimeout(700);

        const digitsAfter = await paintOf(widget, '.widget-digits-time', 'color');
        expect(digitsAfter, 'цвет цифр обязан вернуться к описанному в CSS')
            .not.toBe(digitsBefore);
        expectRgb(await paintOf(widget, '.widget-digits-time', 'backgroundColor'),
            hexToRgb(widgetHex), 'фон обязан пережить сброс цвета цифр');
    });

    test('фон часов не течёт в виджет', async () => {
        await control.click('#drawerClose');
        await control.evaluate(() => window.electronAPI.send('open-clock-widget'));
        await control.waitForTimeout(1500);
        const clock = await findWindow(app, 'electron-clock-widget');
        expect(clock, 'окно часов должно открыться').toBeTruthy();

        await control.click('.wrow:has(#openClockBtn) .wrow-chevron');
        await control.waitForTimeout(400);
        // Другая точка на холсте — заведомо другой цвет, иначе «не течёт»
        // нельзя было бы отличить от «совпало».
        const clockHex = await pickSurface(control, 'clock', 0.3, 0.95);
        expect(clockHex, 'цвета окон обязаны различаться').not.toBe(widgetHex);

        expectRgb(await paintOf(clock, '.bg-circle', 'fill'), hexToRgb(clockHex), 'фон часов');
        expectRgb(await paintOf(widget, '.widget-digits-time', 'backgroundColor'),
            hexToRgb(widgetHex), 'фон виджета трогать не должно');

        await clock.evaluate(() => localStorage.removeItem('clockColors')).catch(() => {});
    });
});

/**
 * Кнопка «Сбросить всё» — по клику, с замером на живом окне.
 *
 * Отдельная спека внутри того же файла: сброс обязан снять и настройки, и
 * цвета, но НЕ трогать положение окна. Последнее проверяется явно — окно,
 * прыгнувшее в угол экрана, читается как поломка, а не как сброс.
 */
test.describe('сброс настроек окна', () => {
    let app; let control; let widget;

    test.beforeAll(async () => {
        ({ app, control } = await launchApp());
        await control.evaluate(() => window.electronAPI.send('open-widget'));
        await control.waitForTimeout(1500);
        for (const page of app.windows()) {
            if ((await page.url()).includes('electron-widget')) { widget = page; }
        }
        await control.click('.wrow:has(#openWidgetBtn) .wrow-chevron');
        await control.waitForTimeout(400);
    });

    test.afterAll(async () => {
        await app.close();
    });

    test('сброс возвращает настройки и цвета, но НЕ двигает окно', async () => {
        const boundsOf = () => app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()
                .find((w) => w.webContents.getURL().includes('electron-widget.html'));
            return win ? win.getBounds() : null;
        });

        // Уводим настройки от заводских ЧЕРЕЗ панель.
        // Профиль e2e общий, поэтому стиль сначала приводим к кругу: ряд
        // «Подпись состояния» виден только у него — настройка к остальным
        // стилям неприменима. Кликаем ПОДПИСЬ: сам чекбокс скрыт под тумблером.
        await control.click('#timerStyle button[data-val="circle"]');
        await control.waitForTimeout(400);
        await control.click('label[for="widgetStatusLabel"]');
        await control.click('#timerStyle button[data-val="flip"]');
        await pickSurface(control, 'widget', 0.5, 0.8);
        await control.waitForTimeout(700);
        const before = await boundsOf();
        expect(before, 'окно виджета должно существовать').toBeTruthy();

        await control.click('#widgetResetRow .reset-all');
        await control.waitForTimeout(900);

        // Настройки — заводские.
        await expect(control.locator('#widgetStatusLabel')).not.toBeChecked();
        expect(await control.locator('#timerScaleValue').textContent()).toBe('100%');
        // Окно вернулось к кругу и цвета сняты — переменных на documentElement нет.
        const state = await widget.evaluate(() => ({
            circle: document.querySelector('.circular-widget').classList.contains('active'),
            vars: document.documentElement.getAttribute('style') || ''
        }));
        expect(state.circle, 'виджет обязан вернуться к стилю «Круг»').toBe(true);
        expect(state.vars, `на окне остались переменные цвета: ${state.vars}`).not.toMatch(/--surface-paint|--timer-color/);

        // А геометрия — на месте.
        const after = await boundsOf();
        expect({ x: after.x, y: after.y, w: after.width, h: after.height })
            .toEqual({ x: before.x, y: before.y, w: before.width, h: before.height });
    });
});
