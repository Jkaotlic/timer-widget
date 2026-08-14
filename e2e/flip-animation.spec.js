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
 * 4. И этого оказалось мало. 14.08.2026 пользователь сказал, что перекидыш
 *    «дёрганый». Замер объяснил почему: ШИРИНА створки не менялась ни на
 *    пиксель (часы 24.82 → 24.82 → 24.82, полноэкранное 158 → 158 → 158) при
 *    внешне правильной матрице rotateX. `perspective` стояла на `.flip-card`,
 *    а створки — её ВНУКИ: перспектива до них не доезжала, и поворот рисовался
 *    как плоское сжатие по вертикали. Высота при этом честно падала до нуля,
 *    поэтому проверка из пункта 3 была зелёной.
 *
 * Почему высота И ширина: высота отличает движение от неподвижности, ширина —
 * поворот от сжатия. Матрица не годится ни для того, ни для другого: она может
 * быть «правильной» при нулевой перспективе, ровно как в пунктах 2 и 4.
 *
 * Кадры берутся из САМОЙ анимации (`getTiming()`), а не из зашитых чисел: темп
 * правился уже дважды, и зашитые миллисекунды молча уехали бы в заливку —
 * тест мерил бы конечное положение вместо середины движения.
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

                // Собственная шкала створки: старт = её задержка, конец = старт
                // плюс длительность. Доли, а не миллисекунды, поэтому смена
                // темпа тест не ломает.
                const scale = (leaf) => {
                    const anim = leaf.getAnimations()
                        .find((a) => a.effect.getTiming().duration > 0);
                    const t = anim.effect.getTiming();
                    return { delay: Number(t.delay) || 0, dur: Number(t.duration) };
                };
                const frames = (leaf, fracs) => {
                    const { delay, dur } = scale(leaf);
                    return fracs.map((f) => {
                        leaf.getAnimations().forEach((a) => { a.currentTime = delay + f * dur; });
                        const r = leaf.getBoundingClientRect();
                        return { w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
                    });
                };

                return {
                    built: true,
                    prev,
                    // Верхняя створка несёт СТАРУЮ цифру, нижняя — НОВУЮ.
                    topText: leafTop.textContent,
                    bottomText: leafBottom.textContent,
                    staticText: wrap.querySelector('.fc-static.fc-bottom').textContent,
                    // Верх, который открывается из-под падающей створки. Пока
                    // слои были прозрачны, его роль играла статичная цифра
                    // карточки; с непрозрачными слоями он обязан быть СВОИМ.
                    staticTopText: wrap.querySelector('.fc-static.fc-top').textContent,
                    digitAfter: node.textContent,
                    fall: frames(leafTop, [0, 0.25, 0.5, 0.75, 0.995]),
                    rise: frames(leafBottom, [0.005, 0.25, 0.5, 0.75, 1]),
                    // Ширина по всей дуге падения: максимум обязан превысить
                    // ширину покоя, иначе это не поворот, а сжатие.
                    fallWide: frames(leafTop, [0, 0.3, 0.6, 0.85, 0.995]).map((f) => f.w),
                    // Створка ОБЯЗАНА быть непрозрачной, иначе сквозь падающую
                    // старую цифру видна новая.
                    paint: ['.fc-flip', '.fc-layer', '.fc-face'].map((sel) => {
                        const n = wrap.querySelector(sel) || wrap;
                        const s = getComputedStyle(sel === '.fc-flip' ? wrap : n);
                        return { sel, image: s.backgroundImage, color: s.backgroundColor };
                    })
                };
            }, [card, digit]);

            expect(res, `${part}: не нашлась видимая карточка`).toBeTruthy();
            expect(res.built, `${part}: створки перекидыша не построились`).toBe(true);

            const next = res.prev === '9' ? '8' : '9';
            expect(res.digitAfter, `${part}: статичная цифра обязана стать новой сразу`).toBe(next);
            expect(res.topText, `${part}: падает СТАРАЯ цифра`).toBe(res.prev);
            expect(res.bottomText, `${part}: поднимается НОВАЯ цифра`).toBe(next);
            expect(res.staticText, `${part}: нижнюю половину до конца закрывает старая`).toBe(res.prev);
            expect(res.staticTopText, `${part}: из-под падающей створки обязана открыться НОВАЯ цифра, а не фон`)
                .toBe(next);

            // Падение: половина карточки складывается ДО НУЛЯ. Прежняя, невидимая
            // анимация давала 2% высоты — этот порог её не пропустит.
            const fallStart = res.fall[0].h;
            const fallEnd = res.fall[4].h;
            console.log(`${part}: падение ${fallStart.toFixed(1)} → ${fallEnd.toFixed(1)} px`);
            expect(fallStart, `${part}: створка обязана иметь высоту`).toBeGreaterThan(5);
            expect(fallEnd / fallStart, `${part}: створка не сложилась`).toBeLessThan(0.05);

            // Подъём — зеркально: от нуля до полной половины карточки.
            const riseStart = res.rise[0].h;
            const riseEnd = res.rise[4].h;
            console.log(`${part}: подъём ${riseStart.toFixed(1)} → ${riseEnd.toFixed(1)} px`);
            expect(riseStart / fallStart, `${part}: вторая створка не начинается с ребра`).toBeLessThan(0.05);
            expect(riseEnd / fallStart, `${part}: вторая створка не встала на место`).toBeGreaterThan(0.9);

            // Поворот, а не сжатие. Створка наклоняется К ЗРИТЕЛЮ вокруг линии
            // сгиба, значит её ближний край обязан быть КРУПНЕЕ — ширина
            // габаритного прямоугольника растёт. При плоском сжатии она
            // константа с точностью до сотых: это и был замер 14.08.2026.
            const wideMax = Math.max(...res.fallWide);
            const wideStart = res.fallWide[0];
            console.log(`${part}: ширина ${res.fallWide.join(' → ')} px (рост ${(wideMax / wideStart).toFixed(3)}×)`);
            expect(
                wideMax / wideStart,
                `${part}: ширина створки не растёт — перспектива не доезжает, это сжатие, а не поворот`
            ).toBeGreaterThan(1.05);

            // Движение обязано быть РАЗМАЗАНО по фазе, а не собрано в её конец.
            // Замер 14.08.2026 после первой правки темпа: створка виджета на
            // отметке 55 % фазы имела высоту 31.0 px при стартовых 30.9 — то
            // есть больше половины времени стояла неподвижно, а потом
            // схлопывалась за оставшиеся 90 мс. Пользователь назвал это
            // «дёрганым», и он был прав: проверки «упало до нуля» и «ширина
            // выросла» обе были зелёными, потому что обе смотрят на КОНЦЫ.
            //
            // Порог по концам такое не ловит принципиально — нужен замер
            // середины хода. Доли высоты, а не пиксели: три окна различаются
            // размером карточки втрое.
            const spread = (frames, label, lo, hi) => {
                const full = Math.max(frames[0].h, frames[4].h);
                const mid = frames[2].h / full;
                console.log(`${part}: ${label} по четвертям ${frames.map((f) => (f.h / full).toFixed(2)).join(' → ')}`);
                expect(mid, `${part}: на середине ${label} створка ещё не тронулась (${mid.toFixed(2)} от хода)`)
                    .toBeLessThan(hi);
                expect(mid, `${part}: на середине ${label} створка уже приехала (${mid.toFixed(2)} от хода)`)
                    .toBeGreaterThan(lo);
            };

            // Падение: к середине фазы створка обязана уйти заметно вниз, но не
            // сложиться целиком. 0.88 — это прежний ease-in, он тоже читался
            // рывком; 1.00 — та самая неподвижность.
            spread(res.fall, 'падения', 0.5, 0.86);
            // Подъём зеркален и чуть «догоняет» к концу: допуск выше.
            spread(res.rise, 'подъёма', 0.45, 0.93);

            // Створка — ПЛАСТИНА, а не стекло. Замер 14.08.2026: у всех трёх
            // слоёв фон был `rgba(0, 0, 0, 0)` во всех трёх окнах, потому что
            // `background: inherit` на слое берёт фон РОДИТЕЛЯ `.fc-flip`, а у
            // того фона нет — подложка стиля лежит двумя уровнями выше.
            // Створки были прозрачны с самого начала, и жалоба звучала как
            // «за перевернувшейся цифрой остаётся предыдущая»: сквозь падающую
            // старую было видно новую. Ни проверка высоты, ни проверка ширины,
            // ни замер середины хода этого не видят — все они про ГЕОМЕТРИЮ.
            for (const p of res.paint) {
                const opaque = p.image !== 'none' || p.color !== 'rgba(0, 0, 0, 0)';
                console.log(`${part}: ${p.sel} фон ${p.image === 'none' ? p.color : 'градиент'}`);
                expect(opaque, `${part}: слой ${p.sel} прозрачен — сквозь створку видно цифру под ней`).toBe(true);
            }
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
