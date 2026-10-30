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
 *
 * Меряется ОСЕВШЕЕ состояние, а не кадр посреди анимации (флак 29.10.2026,
 * windows-latest, один коммит: −8.04 и +9.49 px). У `.time-text` дисплея
 * `transition: font-size 200ms`, и смена класса (`compact`/`signed-hours`)
 * запускает переход ОТ ТЕКУЩЕГО кегля. Синхронный замер видит его начало:
 * при −3723 после −83 это промежуточный кегль между 0.19 и 0.165 диаметра —
 * чем медленнее машина между двумя evaluate, тем ближе к 0.19, на котором
 * знак и лежал на обводке. Локально пауза 120 мс перед замером давала −30.7 px
 * при осевших +17.6. Поэтому зонд ДОВОДИТ переходы до конца (`finish()`), а
 * бесконечные анимации (`time-pulse`, scale до 1.02 на перерасходе) проходит
 * по фазам и берёт ХУДШУЮ: знак на пике пульса — тоже то, что видит зритель.
 */

const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForDisplay, waitForWidget, waitForDisplaySnapshot, waitForWidgetSnapshot, waitForDisplaySettled,
    waitForWindowSettled, setWindowStyles
} = require('./window-ready');

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
    // Переход — к концу: меряем то, к чему окно придёт, а не его начало.
    for (const a of document.getAnimations()) {
        if (a instanceof CSSTransition) { a.finish(); }
    }
    // Худшее по фазам бесконечных анимаций, двигающих элемент (или предка).
    const worst = (el, measure) => {
        const loops = document.getAnimations().filter((a) => !(a instanceof CSSTransition)
            && a.effect && a.effect.target && a.effect.target.contains(el));
        if (!loops.length) { return measure(); }
        let acc = null;
        const STEPS = 8;
        for (let i = 0; i <= STEPS; i++) {
            for (const a of loops) {
                const d = Number(a.effect.getComputedTiming().duration) || 0;
                a.pause();
                a.currentTime = d * i / STEPS;
            }
            const m = measure();
            acc = acc ? Object.fromEntries(Object.keys(m).map((k) => [k, Math.min(acc[k], m[k])])) : m;
        }
        for (const a of loops) { a.play(); }
        return acc;
    };
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
        Object.assign(out, worst(sign, () => {
            const plate = q(s.digitsTime);
            const r = sign.getBoundingClientRect();
            return { insideLeft: r.left - plate.left, insideRight: plate.right - r.right };
        }));
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
        const signEl = document.querySelector(s.circleSign);
        const text = cfg.breakSign ? document.querySelector(s.circleText) : null;
        if (text) {
            // Старый кегль «−1:02:03» (0.19 диаметра) — тот, на котором знак
            // лежал на обводке (кадр 30.09.2026). Тоже через переход и тоже
            // доводится до конца: самопроверка покрывает и само доведение.
            text.style.setProperty('font-size', 'calc(var(--ring-size) * 0.19)');
            for (const a of document.getAnimations()) {
                if (a instanceof CSSTransition) { a.finish(); }
            }
        }
        const track = document.querySelector(s.ringTrack);
        Object.assign(out, worst(signEl, () => {
            const sign = signEl.getBoundingClientRect();
            const box = track.getBoundingClientRect();
            const r = Number(track.getAttribute('r'));
            const k = box.width / (2 * r);
            const stroke = parseFloat(getComputedStyle(track).strokeWidth) * k;
            const innerEdge = box.left + stroke / 2;
            return { clearance: sign.left - innerEdge };
        }));
        if (text) { text.style.removeProperty('font-size'); }
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
    circleSign: '.time-minus', circleText: '.time-text', ringTrack: '.ring-track'
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
        await waitForWidgetSnapshot(app, widget);
        await waitForDisplaySnapshot(app, display);
        await waitForWindowSettled(app, widget, 'electron-widget.html');
        await waitForDisplaySettled(app, display);
        // Цвет подложки — ТОТ случай, где «за рамкой» видно глазом.
        await widget.evaluate(() => document.documentElement.style
            .setProperty('--surface-paint', 'rgba(30, 58, 138, 0.9)'));
        for (const style of ['digits', 'flip', 'circle']) {
            // Стиль дошёл до обоих окон, виджет встал под новый размер (было 1200 мс).
            await setWindowStyles(app, control, { widget, display }, style, { displayField: 'displayTimerStyle' });

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
        await setWindowStyles(app, control, { widget }, 'digits');
        const broken = await measureIn(widget, 'timerWidget', WIDGET, 'digits', -83, true);
        console.log(`   самопроверка, старая посадка: ${JSON.stringify(broken)}`);
        expect(broken.insideLeft, 'зонд не видит знак за рамкой').toBeLessThan(0);

        // Самопроверка зонда «внутри кольца»: старый кегль «−1:02:03» обязан
        // ловиться. Дисплей всё ещё на «Круге» — менялся только стиль виджета.
        const brokenRing = await measureIn(display, 'displayTimer', DISPLAY, 'circle', -3723, true);
        console.log(`   самопроверка, кегль 0.19: ${JSON.stringify(brokenRing)}`);
        expect(brokenRing.clearance, 'зонд не видит знак на обводке').toBeLessThan(0);
    } finally {
        await control.evaluate(() => {
            window.ipcRenderer.send('widget-style-update', { timerStyle: 'circle' });
            window.ipcRenderer.send('close-display');
        }).catch(() => {});
        await app.close();
    }
});
