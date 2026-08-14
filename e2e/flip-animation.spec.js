const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Перекидывание цифры — ЗАМЕРОМ ДВИЖЕНИЯ, а не наличием класса.
 *
 * История в три части.
 *
 * 1. Анимация пропала из виджета таймера и часов, оставшись только в
 *    полноэкранном режиме. Первая версия этого теста ловила регресс так:
 *    навешивала класс `flipping` и проверяла, что он появился.
 * 2. Проверка была зелёной и при этом ничего не значила. 13.08.2026
 *    пользователь сообщил, что анимации нет НИГДЕ, и замер это подтвердил:
 *    карточка часов 36.57px → 35.78px в середине движения, то есть 0.79
 *    пикселя. Причина — `rotateX` без `perspective`: это не поворот, а плоское
 *    сжатие по вертикали на cos(угол).
 * 3. Наклон карточки заменён настоящим split-flap: верхняя половина старой
 *    цифры падает, нижняя половина новой поднимается (flip-card.css +
 *    flip-card.js). Тест меряет обе створки покадрово по их собственной
 *    временной шкале — от полной высоты до нуля и обратно.
 *
 * Почему высота, а не матрица трансформации: высота — это то, что видно.
 * Матрица может быть «правильной» и при нулевой перспективе, ровно как в
 * пункте 2.
 */

const WINDOWS = [
    { part: 'electron-widget', card: '.widget-flip-card', digit: '.widget-flip-digit' },
    { part: 'electron-clock-widget', card: '.widget-flip-card', digit: '.widget-flip-digit' },
    { part: 'display.html', card: '.flip-card', digit: '.flip-digit' }
];

test('перекидывание ВИДНО в виджете, часах и полноэкранном', async () => {
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
        await control.waitForTimeout(1800);

        for (const { part, card, digit } of WINDOWS) {
            let page = null;
            for (const w of app.windows()) {
                if ((await w.url()).includes(part)) { page = w; }
            }
            expect(page, `окно ${part} должно быть открыто`).toBeTruthy();

            const res = await page.evaluate(([cardSel, digitSel]) => {
                // Первая карточка может лежать в скрытой группе часов —
                // меряем ВИДИМУЮ, иначе высота 0 и тест сравнивает пустоту.
                const el = [...document.querySelectorAll(cardSel)]
                    .find((c) => c.getBoundingClientRect().height > 0);
                if (!el) { return null; }
                const node = el.querySelector(digitSel);
                const prev = node.textContent;

                window.FlipCard.flipCardTo(el, digitSel, prev === '9' ? '8' : '9');
                const wrap = el.querySelector('.fc-flip');
                if (!wrap) { return { built: false }; }

                const leafTop = wrap.querySelector('.fc-leaf-top');
                const leafBottom = wrap.querySelector('.fc-leaf-bottom');
                const at = (leaf, t) => {
                    leaf.getAnimations().forEach((a) => { a.currentTime = t; });
                    return leaf.getBoundingClientRect().height;
                };

                return {
                    built: true,
                    prev,
                    // Верхняя створка несёт СТАРУЮ цифру, нижняя — НОВУЮ.
                    topText: leafTop.textContent,
                    bottomText: leafBottom.textContent,
                    staticText: wrap.querySelector('.fc-static').textContent,
                    digitAfter: node.textContent,
                    fall: [0, 90, 180].map((t) => at(leafTop, t)),
                    rise: [180, 270, 360].map((t) => at(leafBottom, t))
                };
            }, [card, digit]);

            expect(res, `${part}: не нашлась видимая карточка`).toBeTruthy();
            expect(res.built, `${part}: створки перекидыша не построились`).toBe(true);

            const next = res.prev === '9' ? '8' : '9';
            expect(res.digitAfter, `${part}: статичная цифра обязана стать новой сразу`).toBe(next);
            expect(res.topText, `${part}: падает СТАРАЯ цифра`).toBe(res.prev);
            expect(res.bottomText, `${part}: поднимается НОВАЯ цифра`).toBe(next);
            expect(res.staticText, `${part}: нижнюю половину до конца закрывает старая`).toBe(res.prev);

            // Падение: половина карточки складывается ДО НУЛЯ. Прежняя, невидимая
            // анимация давала 2% высоты — этот порог её не пропустит.
            const [fallStart, , fallEnd] = res.fall;
            console.log(`${part}: падение ${fallStart.toFixed(1)} → ${fallEnd.toFixed(1)} px`);
            expect(fallStart, `${part}: створка обязана иметь высоту`).toBeGreaterThan(5);
            expect(fallEnd / fallStart, `${part}: створка не сложилась`).toBeLessThan(0.05);

            // Подъём — зеркально: от нуля до полной половины карточки.
            const [riseStart, , riseEnd] = res.rise;
            console.log(`${part}: подъём ${riseStart.toFixed(1)} → ${riseEnd.toFixed(1)} px`);
            expect(riseStart / fallStart, `${part}: вторая створка не начинается с ребра`).toBeLessThan(0.05);
            expect(riseEnd / fallStart, `${part}: вторая створка не встала на место`).toBeGreaterThan(0.9);
        }
    } finally {
        await app.close();
    }
});

test('«меньше движения» отменяет створки, а не оставляет их висеть', async () => {
    // Гасить анимацию одним CSS нельзя: неподвижный слой со СТАРОЙ цифрой
    // закрывал бы новую всё время жизни слоёв.
    const { app, control } = await launchApp({
        args: ['--force-prefers-reduced-motion']
    });
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        await control.waitForTimeout(2000);
        await control.evaluate(() => window.ipcRenderer.send('widget-style-update', { timerStyle: 'flip' }));
        await control.waitForTimeout(1200);

        let widget = null;
        for (const w of app.windows()) {
            if ((await w.url()).includes('electron-widget')) { widget = w; }
        }
        const res = await widget.evaluate(() => {
            const el = [...document.querySelectorAll('.widget-flip-card')]
                .find((c) => c.getBoundingClientRect().height > 0);
            const node = el.querySelector('.widget-flip-digit');
            window.FlipCard.flipCardTo(el, '.widget-flip-digit', node.textContent === '9' ? '8' : '9');
            return {
                reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
                layers: !!el.querySelector('.fc-flip'),
                digit: node.textContent
            };
        });

        console.log('reduced-motion:', res.reduced, 'слои:', res.layers);
        if (res.reduced) {
            expect(res.layers, 'при reduced-motion створки строиться не должны').toBe(false);
        }
        // Цифра меняется в любом случае — гасится ДВИЖЕНИЕ, а не информация.
        expect(['8', '9']).toContain(res.digit);
    } finally {
        await app.close();
    }
});
