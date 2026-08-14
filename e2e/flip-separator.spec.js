const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Разделитель флипа — во ВСЕХ ТРЁХ окнах сразу.
 *
 * История в две части, и обе про то, что правило, применённое к одному окну,
 * правилом не является.
 *
 * 1. Июль 2026: разделитель виджета таймера перевели с текстового глифа на две
 *    точки-псевдоэлемента и закрепили `e2e/flip-hours-layout.spec.js`. Тот тест
 *    находит окно по `#wFlipHoursGroup`, которого нет ни у часов, ни у
 *    полноэкранного, — то есть меряет ровно одно окно из трёх. Часы и
 *    полноэкранное продолжали рисовать живой глиф `:`.
 * 2. 14.08.2026: пользователь дважды сказал, что «двоеточие странное». Первый
 *    раз это починили в часах — и жалоба повторилась, потому что настоящая
 *    причина была не в глифе, а в ЦВЕТЕ. Замер: цифры по умолчанию белые
 *    (`var(--timer-color, var(--tw-fg))`), а точки — сине-зелёный градиент,
 *    в полноэкранном же глиф был серым (`--tw-fg-muted`). Цветное двоеточие
 *    рядом с белыми цифрами и читалось как «странное».
 *
 * Поэтому проверок здесь две, и вторая важнее первой: разделитель нарисован
 * точками И совпадает по цвету с цифрами рядом.
 */

const WINDOWS = [
    {
        part: 'electron-widget',
        name: 'виджет таймера',
        sep: '.widget-flip-separator',
        digit: '.widget-flip-digit',
        card: '.widget-flip-card',
        open: 'open-widget',
        style: () => window.ipcRenderer.send('widget-style-update', { timerStyle: 'flip' })
    },
    {
        part: 'electron-clock-widget',
        name: 'часы',
        sep: '.widget-flip-separator',
        digit: '.widget-flip-digit',
        card: '.widget-flip-card',
        open: 'open-clock-widget',
        style: () => window.ipcRenderer.send('clock-widget-set-style', 'flip')
    },
    {
        part: 'display.html',
        name: 'полноэкранное',
        sep: '.flip-separator',
        digit: '.flip-digit',
        card: '.flip-card',
        open: 'open-display',
        style: () => window.ipcRenderer.send('display-settings-update', { timerStyle: 'flip' })
    }
];

test('разделитель флипа — точки цвета цифр во всех трёх окнах', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => {
            window.ipcRenderer.send('open-widget');
            window.ipcRenderer.send('open-clock-widget');
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
        });
        await control.waitForTimeout(2500);
        await control.evaluate(() => {
            window.ipcRenderer.send('widget-style-update', { timerStyle: 'flip' });
            window.ipcRenderer.send('clock-widget-set-style', 'flip');
            window.ipcRenderer.send('display-settings-update', { timerStyle: 'flip' });
        });
        await control.waitForTimeout(2000);

        for (const w of WINDOWS) {
            let page = null;
            for (const p of app.windows()) {
                if ((await p.url()).includes(w.part)) { page = p; }
            }
            expect(page, `окно ${w.name} не открыто`).toBeTruthy();

            const res = await page.evaluate(([sepSel, digitSel, cardSel]) => {
                const visible = (n) => n.getBoundingClientRect().height > 0;
                const sep = [...document.querySelectorAll(sepSel)].filter(visible);
                const digit = [...document.querySelectorAll(digitSel)].find(visible);
                const card = [...document.querySelectorAll(cardSel)].find(visible);
                if (!sep.length || !digit || !card) { return null; }
                const dot = getComputedStyle(sep[0], '::before');
                return {
                    count: sep.length,
                    fontSizePx: parseFloat(getComputedStyle(sep[0]).fontSize),
                    dotWidthPx: parseFloat(dot.width),
                    dotColor: dot.backgroundColor,
                    dotImage: dot.backgroundImage,
                    digitColor: getComputedStyle(digit).color,
                    cardHeightPx: parseFloat(getComputedStyle(card).height)
                };
            }, [w.sep, w.digit, w.card]);

            expect(res, `${w.name}: не нашлись разделитель, цифра и карточка`).toBeTruthy();
            console.log(`${w.name} →`, JSON.stringify(res));

            // 1. Точки, а не глиф.
            expect(res.fontSizePx, `${w.name}: разделитель рисует текстовый глиф ':'`).toBe(0);
            expect(res.dotWidthPx, `${w.name}: точки не нарисованы псевдоэлементом`).toBeGreaterThan(0);

            // 2. ЦВЕТ. Точка красится фоном, цифра — свойством color, поэтому
            // сравниваются именно эти два вычисленных значения. Градиент в
            // фоне точки означает, что она живёт по своей палитре: ровно это и
            // выглядело «странным двоеточием».
            expect(res.dotImage, `${w.name}: точки красятся собственным градиентом, а не цветом цифр`).toBe('none');
            expect(res.dotColor, `${w.name}: цвет точек разошёлся с цветом цифр`).toBe(res.digitColor);

            // 3. Размер привязан к карточке, а не к произвольному кеглю.
            const ratio = res.dotWidthPx / res.cardHeightPx;
            expect(ratio, `${w.name}: точки несоразмерны карточке (${ratio.toFixed(3)})`).toBeGreaterThan(0.03);
            expect(ratio, `${w.name}: точки несоразмерны карточке (${ratio.toFixed(3)})`).toBeLessThan(0.12);
        }
    } finally {
        await app.close();
    }
});
