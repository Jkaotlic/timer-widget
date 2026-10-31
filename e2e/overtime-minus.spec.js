const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForDisplay, waitForWidget, waitForWidgetSnapshot, waitForDisplaySnapshot, waitForDisplaySettled,
    untilReceived, armReceived
} = require('./window-ready');

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

/**
 * Открыть виджет и дать ему стиль: окно получило снимок main (раньше пауза
 * 2200 мс), затем — посылку стиля, и утихло (раньше 800 мс).
 */
async function openWidgetWithStyle(app, control, timerStyle) {
    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    const widget = await waitForWidget(app);
    await waitForWidgetSnapshot(app, widget);
    await untilReceived(widget, 'widget-style-update',
        () => control.evaluate((st) => window.ipcRenderer.send('widget-style-update', { timerStyle: st }), timerStyle),
        { match: { timerStyle } });
    return widget;
}

// Прозрачность меряется ЭФФЕКТИВНАЯ — произведение opacity по цепочке предков
// (функция живёт внутри evaluate). Анимация может висеть и на самом узле, и на
// контейнере, а тесту нельзя зависеть от того, где именно.
//
// Перерасход ждётся УСЛОВИЕМ, а не паузой. Прежде здесь стояли 3500 мс и
// никакой проверки: если таймер в эти секунды не ушёл в минус или из него
// вышел, знак оставался пустым, и замер ниже честно считал геометрию ПУСТОГО
// span — −0.4115 кегля у Inter, то есть «минус уехал», хотя минуса не было
// (полный прогон 29.10.2026). Затянувшийся main тот же ответ дать не может:
// отсчёт сверяется по монотонным часам и после простоя догоняет — замер с
// искусственным простоем main на 2.6 и 3.2 с был зелёным.
async function overtime(control) {
    await control.evaluate(() => {
        window.ipcRenderer.send('timer-command', { type: 'set', seconds: 1, allowNegative: true });
        window.ipcRenderer.send('timer-command', { type: 'start', allowNegative: true });
    });
    await expect.poll(
        () => control.evaluate(() => {
            const tc = window.timerController;
            return !!tc && tc.isRunning && tc.remainingSeconds <= -2;
        }),
        { message: 'таймер не ушёл в перерасход (идёт, ≤ −2 с)', timeout: 10000 }
    ).toBe(true);
}

test('перекидыш: минус мигает в одной фазе с цифрами', async () => {
    const { app, control } = await launchApp();
    try {
        const widget = await openWidgetWithStyle(app, control, 'flip');

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
            // пауза законна: замер покадровый — шаг снимков по времени и есть измеряемое (фаза пульсации на отрезке FRAMES × FRAME_MS)
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

// Центр ЧЕРНИЛ, а не бокса: бокс знака центрирован всегда, и
// прямоугольники были ровными ровно в тот момент, когда знак
// визуально уезжал. Базовая линия инлайнового span — его верх плюс
// восходящая шрифта; у знака (он абсолютом) добавляется половинный
// интерлиньяж.
async function measureSignInk() {
    // Шрифт, выбранный только что, мог ещё не доехать: canvas мерил бы
    // запасное начертание.
    await document.fonts.ready;
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
    return {
        offsetEm: (inkV - inkS) / parseFloat(csV.fontSize),
        signText: sign.textContent,
        valueText: value.textContent
    };
}

test('«Цифры»: чернила минуса по центру чернил цифр во ВСЕХ шрифтах', async () => {
    const { app, control } = await launchApp();
    try {
        const widget = await openWidgetWithStyle(app, control, 'digits');
        await overtime(control);

        const worst = { font: null, value: 0 };
        for (const font of DIGIT_FONTS) {
            // Шрифт дошёл до виджета, окно утихло (шрифты, кадры подгонки) —
            // раньше пауза 600 мс.
            await untilReceived(widget, 'widget-style-update', () => control.evaluate(
                (f) => window.ipcRenderer.send('widget-style-update', { timerStyle: 'digits', digitsFont: f }),
                font
            ), { match: { digitsFont: font } });

            // Знак должен БЫТЬ — иначе замер ниже меряет пустой span и
            // выдаёт правдоподобное «смещение» (см. overtime()).
            await expect.poll(
                () => widget.evaluate(() => document.getElementById('widgetDigitsSign').textContent),
                { message: `${font}: перед замером виджет не в перерасходе — знак пуст`, timeout: 5000 }
            ).toBe('−');

            const m = await widget.evaluate(measureSignInk);
            expect(m.signText, `${font}: перерасход потерян во время замера (табло ${m.valueText})`).toBe('−');
            const offsetEm = m.offsetEm;

            console.log(`${font.padEnd(9)} смещение ${offsetEm.toFixed(4)} кегля`);
            if (Math.abs(offsetEm) > Math.abs(worst.value)) { worst.font = font; worst.value = offsetEm; }
            // Порог 0.03 при прежнем максимуме 0.119.
            //
            // Остаток — расхождение центров боксов, и величина его ЗАВИСИТ ОТ
            // ПЛАТФОРМЫ: считается он из `fontBoundingBoxAscent/Descent`, а их
            // отдаёт системный движок шрифтов — CoreText, FreeType и DirectWrite
            // расходятся. Замер: macOS ≤0.013, ubuntu и windows дают 0.023 у
            // Orbitron. Порог 0.02 был снят на одной машине и на CI означал
            // «здесь другой растеризатор», а не «знак уехал».
            //
            // Запас до настоящего дефекта остаётся четырёхкратным: до правки
            // Playfair Display давал 0.119.
            expect(Math.abs(offsetEm), `${font}: минус уехал по вертикали на ${offsetEm.toFixed(3)} кегля`).toBeLessThan(0.03);
        }
        console.log(`худший шрифт: ${worst.font} (${worst.value.toFixed(4)})`);

        // Самопроверка охраны: сброс гасит знак — проверка обязана это
        // увидеть, а сырой замер показывает, во что потерянный перерасход
        // превращался без неё (−0.41 у Inter при пороге 0.03).
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
        await expect.poll(
            () => widget.evaluate(() => document.getElementById('widgetDigitsSign').textContent),
            { message: 'самопроверка: после сброса знак не погас', timeout: 5000 }
        ).toBe('');
        const blind = await widget.evaluate(measureSignInk);
        console.log(`самопроверка, пустой знак: ${blind.offsetEm.toFixed(4)} кегля`);
        expect(blind.signText, 'самопроверка: охрана не видит пустой знак').not.toBe('−');
        expect(Math.abs(blind.offsetEm), 'самопроверка: пустой знак неотличим от ровного — охрана не нужна?').toBeGreaterThan(0.03);
    } finally {
        await app.close();
    }
});

// Одно и то же правило живёт в двух окнах — меряются оба.
const DIGITS_WINDOWS = [
    {
        name: 'виджет',
        ids: ['widgetDigitsTime', 'widgetDigitsSign', 'widgetDigitsValue'],
        style: () => window.ipcRenderer.send('widget-style-update', { timerStyle: 'digits' })
    },
    {
        name: 'полноэкранное',
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
        // Оба окна получили снимок main, дисплей встал (полноэкранный вход,
        // раскладка) — раньше пауза 2500 мс.
        const display = await waitForDisplay(app);
        const widget = await waitForWidget(app);
        await waitForDisplaySnapshot(app, display);
        await waitForWidgetSnapshot(app, widget);
        await waitForDisplaySettled(app, display);
        // Стиль дошёл до обоих окон — раньше пауза 1000 мс.
        const widgetStyle = await armReceived(widget, 'widget-style-update');
        const displayStyle = await armReceived(display, 'display-settings-update');
        await control.evaluate(() => {
            window.ipcRenderer.send('widget-style-update', { timerStyle: 'digits' });
            window.ipcRenderer.send('display-settings-update', { timerStyle: 'digits' });
        });
        await widgetStyle({ match: { timerStyle: 'digits' } });
        await displayStyle({ match: { timerStyle: 'digits' } });

        await overtime(control);

        for (const w of DIGITS_WINDOWS) {
            const page = w.name === 'виджет' ? widget : display;
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
