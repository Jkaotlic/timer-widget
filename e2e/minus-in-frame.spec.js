'use strict';

/**
 * Минус перерасхода — часть табло, а не деталь рядом с ним.
 *
 * Жалоба 30.09.2026: «минус в разных стилях вылезает за рамки и смотрится
 * отдельно». Кадры до правки:
 *   - «Цифры» с выбранным фоном: знак висел абсолютом от `right: 100%` и
 *     торчал за левый край подложки;
 *   - «Флип»: карточка минуса 45px рядом с карточками 90px (виджет), 120
 *     против 200 (дисплей) — половинная плашка;
 *   - «Круг» с часами (−1:02:03): знак лежал на обводке кольца.
 *
 * Время ставится и меряется в ОДНОМ evaluate: главный процесс шлёт состояние
 * каждую секунду, и между двумя вызовами оно перезаписало бы подставленное.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForDisplay, waitForWidget } = require('./window-ready');

const TIMES = [-83, -3723];

/**
 * Замер в окне. Функция самодостаточна — она выполняется ВНУТРИ окна.
 * `cfg.selectors` — селекторы этого окна, `cfg.secs` — подставляемое время,
 * `cfg.breakSign` — сломать посадку знака по-старому (самопроверка зонда).
 */
function probe(cfg) {
    const s = cfg.selectors;
    const t = window[cfg.targetName];
    t.remainingSeconds = cfg.secs;
    t.isRunning = false;
    t.updateDisplay();
    const q = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect() : null;
    };
    const out = { style: cfg.style };

    if (cfg.style === 'digits') {
        const sign = document.querySelector(s.digitsSign);
        if (cfg.breakSign) {
            sign.style.setProperty('left', 'auto');
            sign.style.setProperty('right', '100%');
        }
        const plate = q(s.digitsTime);
        const r = sign.getBoundingClientRect();
        out.insideLeft = r.left - plate.left;
        out.insideRight = plate.right - r.right;
        if (cfg.breakSign) {
            sign.style.removeProperty('left');
            sign.style.removeProperty('right');
        }
    } else if (cfg.style === 'flip') {
        const minus = document.querySelector(s.flipMinus);
        const card = [...document.querySelectorAll(s.flipCard)]
            .find((el) => el.getBoundingClientRect().height > 0);
        const glyph = minus.querySelector(s.flipMinusSign);
        out.minusH = minus.getBoundingClientRect().height;
        out.cardH = card.getBoundingClientRect().height;
        // Глиф шире карточки обрезается её краями.
        out.glyphFits = glyph.scrollWidth <= minus.clientWidth + 0.5;
    } else if (cfg.style === 'circle') {
        const sign = q(s.circleSign);
        const track = document.querySelector(s.ringTrack);
        const box = track.getBoundingClientRect();
        const r = Number(track.getAttribute('r'));
        const k = box.width / (2 * r);
        const stroke = parseFloat(getComputedStyle(track).strokeWidth) * k;
        const innerEdge = box.left + stroke / 2;
        out.clearance = sign.left - innerEdge;
    }
    return out;
}

const WIDGET = {
    digitsTime: '.widget-digits-time', digitsSign: '.widget-digits-sign',
    flipMinus: '#wFlipMinus', flipCard: '.widget-flip-card', flipMinusSign: '.widget-flip-minus-sign',
    circleSign: '.time-display .tm-sign', ringTrack: '.progress-track'
};
const DISPLAY = {
    digitsTime: '.digits-time', digitsSign: '.digits-sign',
    flipMinus: '#flipMinus', flipCard: '.flip-card', flipMinusSign: '.flip-minus-sign',
    circleSign: '.time-minus', ringTrack: '.ring-track'
};

function measureIn(page, targetName, selectors, style, secs, breakSign = false) {
    return page.evaluate(probe, { targetName, selectors, style, secs, breakSign });
}

test('минус стоит внутри рамки во всех стилях — виджет и дисплей', async () => {
    test.setTimeout(180000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        const widget = await waitForWidget(app);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        const display = await waitForDisplay(app);
        // Цвет подложки — ТОТ случай, где «за рамкой» видно глазом.
        await widget.evaluate(() => document.documentElement.style
            .setProperty('--surface-paint', 'rgba(30, 58, 138, 0.9)'));
        for (const style of ['digits', 'flip', 'circle']) {
            await control.evaluate((s) => {
                window.ipcRenderer.send('widget-style-update', { timerStyle: s });
                window.ipcRenderer.send('display-settings-update', { displayTimerStyle: s });
            }, style);
            await control.waitForTimeout(1200);

            for (const secs of TIMES) {
                for (const [name, page, globalName, sel] of [
                    ['виджет', widget, 'timerWidget', WIDGET],
                    ['дисплей', display, 'displayTimer', DISPLAY]
                ]) {
                    const m = await measureIn(page, globalName, sel, style, secs);
                    const where = `${name}, ${style}, ${secs} с`;
                    console.log(`   ${where}: ${JSON.stringify(m)}`);
                    if (style === 'digits') {
                        expect(m.insideLeft, `${where}: знак за левым краем подложки`).toBeGreaterThanOrEqual(0);
                        expect(m.insideRight, `${where}: знак за правым краем подложки`).toBeGreaterThanOrEqual(0);
                    } else if (style === 'flip') {
                        expect(Math.abs(m.minusH - m.cardH),
                            `${where}: карточка минуса ${m.minusH} при карточке цифр ${m.cardH}`).toBeLessThanOrEqual(1);
                        expect(m.glyphFits, `${where}: знак шире своей карточки и обрезан`).toBe(true);
                    } else {
                        expect(m.clearance, `${where}: знак лежит на обводке кольца`).toBeGreaterThan(0);
                    }
                }
            }
        }

        // Самопроверка зонда «внутри подложки»: старая посадка (`right: 100%`)
        // обязана им ловиться — иначе зелёный значил бы и «внутри», и «зонд
        // ничего не видит».
        await control.evaluate(() => window.ipcRenderer.send('widget-style-update', { timerStyle: 'digits' }));
        await control.waitForTimeout(1200);
        const broken = await measureIn(widget, 'timerWidget', WIDGET, 'digits', -83, true);
        console.log(`   самопроверка, старая посадка: ${JSON.stringify(broken)}`);
        expect(broken.insideLeft, 'зонд не видит знак за рамкой').toBeLessThan(0);
    } finally {
        await control.evaluate(() => {
            window.ipcRenderer.send('widget-style-update', { timerStyle: 'circle' });
            window.ipcRenderer.send('close-display');
        }).catch(() => {});
        await app.close();
    }
});
