const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Минус перерасхода в виджете: он ЧАСТЬ табло, а не отдельная деталь.
 *
 * Жалоба 17.08.2026, два пункта, и оба — про то, что знак живёт своей жизнью:
 *
 * 1. Перекидыш. Цифры в перерасходе мигают (`widget-flip-pulse` на карточке),
 *    минус — нет: правило пульсации висело на `.widget-flip-card[data-status]`,
 *    а карточка минуса — другой класс и `data-status` ей никто не ставил.
 *    Мало ПРОСТО добавить ей ту же анимацию: карточки начинают мигать на
 *    `danger`, минус появляется только в перерасходе, и его анимация стартует
 *    позже — фаза не совпадает, мигание идёт вразнобой. Поэтому меряется не
 *    «минус мигает», а «минус мигает В ОДНОЙ ФАЗЕ с цифрами»: эффективная
 *    прозрачность (произведение по цепочке предков) обязана совпадать на
 *    КАЖДОМ кадре.
 * 2. «Цифры». Знак стоит абсолютом от `right: 100%`, то есть от ПАДДИНГ-бокса
 *    рамки, и к зазору прибавляются 0.34em её левого поля. Замер до правки:
 *    зазор 0.40 кегля, знак целиком за пределами рамки.
 *
 * Обе величины меряются в долях кегля — окно масштабируется, пиксели уехали бы.
 */

// Сколько кадров и с каким шагом снимать пульсацию.
const FRAMES = 24;
const FRAME_MS = 60;

async function findWindow(app, probe) {
    for (const w of app.windows()) {
        if (await w.evaluate(probe).catch(() => false)) { return w; }
    }
    return null;
}

// Прозрачность меряется ЭФФЕКТИВНАЯ — произведение opacity по цепочке предков
// (функция живёт внутри evaluate). Анимация может висеть и на самом узле, и на
// контейнере, а тесту нельзя зависеть от того, где именно.
async function overtime(control) {
    await control.evaluate(() => {
        window.ipcRenderer.send('timer-command', { type: 'set', seconds: 1, allowNegative: true });
        window.ipcRenderer.send('timer-command', { type: 'start', allowNegative: true });
    });
    await control.waitForTimeout(3500);
}

test('перекидыш: минус мигает в одной фазе с цифрами', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        await control.waitForTimeout(2200);
        await control.evaluate(() => window.ipcRenderer.send('widget-style-update', { timerStyle: 'flip' }));
        await control.waitForTimeout(800);

        const widget = await findWindow(app, () => !!document.getElementById('wFlipHoursGroup'));
        expect(widget, 'окно виджета не найдено').not.toBeNull();

        await overtime(control);

        const visible = await widget.evaluate(() => {
            const m = document.getElementById('wFlipMinus');
            return !!m && m.getBoundingClientRect().height > 0;
        });
        expect(visible, 'минус не показан в перерасходе').toBe(true);

        const samples = [];
        for (let i = 0; i < FRAMES; i++) {
            const pair = await widget.evaluate(([digitSel, minusSel]) => {
                const eff = (sel) => {
                    const node = document.querySelector(sel);
                    if (!node) { return null; }
                    let value = 1;
                    for (let el = node; el && el !== document.documentElement; el = el.parentElement) {
                        value *= parseFloat(getComputedStyle(el).opacity) || 0;
                    }
                    return value;
                };
                return { digit: eff(digitSel), minus: eff(minusSel) };
            }, ['#wFlipSec2', '#wFlipMinus']);
            samples.push(pair);
            await widget.waitForTimeout(FRAME_MS);
        }

        const digits = samples.map(s => s.digit);
        const minus = samples.map(s => s.minus);
        const spread = (a) => Math.max(...a) - Math.min(...a);
        const drift = Math.max(...samples.map(s => Math.abs(s.digit - s.minus)));

        console.log('размах цифр', spread(digits).toFixed(3),
            '| размах минуса', spread(minus).toFixed(3),
            '| макс. расхождение фаз', drift.toFixed(3));

        // 1. Цифры действительно мигают — иначе тест зелёный по недоразумению.
        expect(spread(digits), 'цифры в перерасходе не мигают вовсе').toBeGreaterThan(0.15);
        // 2. Минус мигает с тем же размахом.
        expect(spread(minus), 'минус в перерасходе не мигает').toBeGreaterThan(0.15);
        // 3. И в ту же фазу. Порог 0.05 при размахе 0.3: противофаза дала бы 0.3.
        expect(drift, 'минус мигает не в фазе с цифрами').toBeLessThan(0.05);
    } finally {
        await app.close();
    }
});

// Вертикаль знака: у каждого шрифта своя, поэтому меряются ВСЕ шесть.
// Жалоба 17.08.2026 пришла про Playfair Display (+0.119 кегля вверх), но замер
// показал расхождение у всех: Inter −0.061, mono −0.031, orbitron −0.029,
// bebas −0.019, oswald +0.021. Один шрифт в тесте оставил бы пять других без
// присмотра — и именно они выглядели «почти правильно», то есть незаметно.
const DIGIT_FONTS = ['inter', 'mono', 'bebas', 'oswald', 'orbitron', 'playfair'];

test('«Цифры»: чернила минуса по центру чернил цифр во ВСЕХ шрифтах', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        await control.waitForTimeout(2200);
        await control.evaluate(() => window.ipcRenderer.send('widget-style-update', { timerStyle: 'digits' }));
        await control.waitForTimeout(800);

        const widget = await findWindow(app, () => !!document.getElementById('wFlipHoursGroup'));
        expect(widget, 'окно виджета не найдено').not.toBeNull();
        await overtime(control);

        const worst = { font: null, value: 0 };
        for (const font of DIGIT_FONTS) {
            await control.evaluate(
                (f) => window.ipcRenderer.send('widget-style-update', { timerStyle: 'digits', digitsFont: f }),
                font
            );
            await widget.waitForTimeout(600);

            // Центр ЧЕРНИЛ, а не бокса: бокс знака центрирован всегда, и
            // прямоугольники были ровными ровно в тот момент, когда знак
            // визуально уезжал. Базовая линия инлайнового span — его верх плюс
            // восходящая шрифта; у знака (он абсолютом) добавляется половинный
            // интерлиньяж.
            const offsetEm = await widget.evaluate(() => {
                const value = document.getElementById('widgetDigitsValue');
                const sign = document.getElementById('widgetDigitsSign');
                const csV = getComputedStyle(value);
                const csS = getComputedStyle(sign);
                const ctx = document.createElement('canvas').getContext('2d');
                const measure = (cs, text) => {
                    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
                    return ctx.measureText(text);
                };
                // Эталон — ВЕСЬ набор цифр: у Playfair Display цифры
                // старостильные, и по одной («8» восходящая, «0» в высоту
                // строчной) ответ отличается вчетверо.
                const mV = measure(csV, '0123456789');
                const mS = measure(csS, '−');
                const v = value.getBoundingClientRect();
                const s = sign.getBoundingClientRect();
                const lh = parseFloat(csS.lineHeight) || parseFloat(csS.fontSize);

                const inkV = v.top + mV.fontBoundingBoxAscent
                    - (mV.actualBoundingBoxAscent - mV.actualBoundingBoxDescent) / 2;
                const inkS = s.top
                    + (lh - (mS.fontBoundingBoxAscent + mS.fontBoundingBoxDescent)) / 2
                    + mS.fontBoundingBoxAscent
                    - (mS.actualBoundingBoxAscent - mS.actualBoundingBoxDescent) / 2;
                return (inkV - inkS) / parseFloat(csV.fontSize);
            });

            console.log(`${font.padEnd(9)} смещение ${offsetEm.toFixed(4)} кегля`);
            if (Math.abs(offsetEm) > Math.abs(worst.value)) { worst.font = font; worst.value = offsetEm; }
            // Порог 0.02 при прежнем максимуме 0.119: остаток — расхождение
            // центров боксов (≤0.013 кегля), его правка не трогает.
            expect(Math.abs(offsetEm), `${font}: минус уехал по вертикали на ${offsetEm.toFixed(3)} кегля`).toBeLessThan(0.02);
        }
        console.log(`худший шрифт: ${worst.font} (${worst.value.toFixed(4)})`);
    } finally {
        await app.close();
    }
});

// Одно и то же правило живёт в двух окнах — меряются оба.
const DIGITS_WINDOWS = [
    {
        name: 'виджет',
        probe: () => !!document.getElementById('wFlipHoursGroup'),
        ids: ['widgetDigitsTime', 'widgetDigitsSign', 'widgetDigitsValue'],
        style: () => window.ipcRenderer.send('widget-style-update', { timerStyle: 'digits' })
    },
    {
        name: 'полноэкранное',
        probe: () => !!document.getElementById('progressRing'),
        ids: ['digitsTime', 'digitsSign', 'digitsValue'],
        style: () => window.ipcRenderer.send('display-settings-update', { timerStyle: 'digits' })
    }
];

test('«Цифры»: минус прижат к числу и не обрезан', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => {
            window.ipcRenderer.send('open-widget');
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
        });
        await control.waitForTimeout(2500);
        await control.evaluate(() => {
            window.ipcRenderer.send('widget-style-update', { timerStyle: 'digits' });
            window.ipcRenderer.send('display-settings-update', { timerStyle: 'digits' });
        });
        await control.waitForTimeout(1000);

        await overtime(control);

        for (const w of DIGITS_WINDOWS) {
            const page = await findWindow(app, w.probe);
            expect(page, `окно ${w.name} не найдено`).not.toBeNull();
            const m = await page.evaluate((ids) => {
            const [boxId, signId, valueId] = ids;
            const box = document.getElementById(boxId);
            const sign = document.getElementById(signId);
            const value = document.getElementById(valueId);
            const cs = getComputedStyle(sign);
            const em = parseFloat(getComputedStyle(box).fontSize);
            const b = box.getBoundingClientRect();
            const s = sign.getBoundingClientRect();
            const v = value.getBoundingClientRect();

            // Левый край ЧЕРНИЛ, а не бокса: у минуса боковые полуотступы
            // занимают заметную долю ширины, и «вылез ли знак за рамку» бокс
            // отвечает неверно.
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const ink = ctx.measureText('−');

            return {
                em,
                signText: sign.textContent,
                gapEm: (v.left - s.right) / em,
                // Насколько ЧЕРНИЛА знака вылезают влево за рамку.
                inkOverhangEm: (b.left - (s.left - ink.actualBoundingBoxLeft)) / em,
                // Отрицательное — знак обрезан левым краем окна.
                signLeftPx: s.left,
                signCenterOffsetEm: ((s.top + s.bottom) / 2 - (b.top + b.bottom) / 2) / em
                };
            }, w.ids);

            console.log(`${w.name} →`, JSON.stringify(m));
            expect(m.signText, `${w.name}: знак минуса не показан`).toBe('−');

            // 1. Зазор — как между цифрами, а не как отдельно висящий знак.
            //    До правки: 0.40 кегля.
            expect(m.gapEm, `${w.name}: минус слишком далеко от числа (${m.gapEm.toFixed(3)} кегля)`).toBeLessThan(0.14);
            expect(m.gapEm, `${w.name}: минус приклеен к числу (${m.gapEm.toFixed(3)} кегля)`).toBeGreaterThan(0.02);

            // 2. Знак ЛЕЖИТ НА рамке, а не висит рядом с ней. Целиком внутрь он
            //    не помещается по арифметике: чернила минуса ≈0.33 кегля, а
            //    левое поле рамки 0.34 — с зазором 0.10 внутрь влезло бы только
            //    приклеенным вплотную к цифре. Поэтому проверяется не «внутри»,
            //    а «перекрывает край, а не отделён от него»: до правки свес
            //    чернил был ≈0.40 кегля, то есть знак стоял снаружи целиком.
            expect(m.inkOverhangEm, `${w.name}: минус отделился от рамки (свес ${m.inkOverhangEm.toFixed(3)} кегля)`).toBeLessThan(0.15);

            // 3. И внутри ОКНА: подгонка кегля резервирует под знак ровно
            //    SIGN_GAP_EM, поэтому лишний зазор съедал запас и обрезал знак.
            expect(m.signLeftPx, `${w.name}: минус обрезан краем окна (x = ${m.signLeftPx})`).toBeGreaterThan(0);

            // Вертикаль здесь НЕ проверяется по центрам боксов: центр бокса
            // знака намеренно смещён на поправку шрифта (`--digits-sign-shift`),
            // потому что видно чернила, а не бокс. Ровные боксы были у той самой
            // версии, на которую пожаловались. Вертикаль меряет тест выше.
            console.log(`${w.name}: центры боксов расходятся на ${m.signCenterOffsetEm.toFixed(3)} кегля (это поправка шрифта)`);
        }
    } finally {
        await app.close();
    }
});
