const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Вкладка «Звуки»: ничего не обрезано и колонки стоят в одной вертикали.
 *
 * Просьба 20.08.2026 — «сделай вкладку красивее». «Красиво» проверить нельзя, а
 * вот три составляющих аккуратности — можно, и все три были нарушены:
 *   1. подпись звука не влезала в список («Металлический удар» — 126px при 76
 *      доступных) и обрезалась многоточием;
 *   2. имя события «Перерасход» не влезало в свою колонку;
 *   3. список подстроки «повторять каждые» стоял на 33px правее списков выше.
 *
 * Каждое из трёх — вопрос о прямоугольниках, поэтому меряется, а не смотрится.
 * Ширину ящика задаёт приложение, поэтому цифры берутся из ОКНА.
 */
test('в списках звуков ничего не обрезано, а колонки выровнены', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => localStorage.clear());
        await control.reload();
        await control.waitForTimeout(1400);
        await control.click('.wrow:has(#soundMasterToggle) .wrow-chevron');
        await control.waitForTimeout(900);

        const m = await control.evaluate(() => {
            const textWidth = (el, text) => {
                const cs = getComputedStyle(el);
                const probe = document.createElement('span');
                probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`;
                probe.textContent = text;
                document.body.appendChild(probe);
                const w = probe.getBoundingClientRect().width;
                probe.remove();
                return w;
            };

            // Самый длинный ПУНКТ во всех четырёх списках против доступной ширины.
            let worstOption = null;
            for (const id of ['soundStartPreset', 'soundEndPreset', 'soundMinutePreset', 'soundOverrunPreset']) {
                const sel = document.getElementById(id);
                const cs = getComputedStyle(sel);
                const inner = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                for (const opt of sel.options) {
                    const w = textWidth(sel, opt.textContent);
                    const over = w - inner;
                    if (!worstOption || over > worstOption.over) {
                        worstOption = { id, text: opt.textContent, w, inner, over };
                    }
                }
            }

            // Самое длинное ИМЯ СОБЫТИЯ против своей колонки.
            let worstName = null;
            for (const el of document.querySelectorAll('.sound-item .sound-name')) {
                const w = textWidth(el, el.textContent);
                const over = w - el.getBoundingClientRect().width;
                if (!worstName || over > worstName.over) {
                    worstName = { text: el.textContent, w, col: el.getBoundingClientRect().width, over };
                }
            }

            // Вертикаль списков: подстрока обязана стоять под строками.
            const rows = [...document.querySelectorAll('.sound-item .select-wrap')]
                .map((el) => Math.round(el.getBoundingClientRect().left));
            return { worstOption, worstName, lefts: [...new Set(rows)] };
        });

        console.log(`   длиннейший пункт «${m.worstOption.text}»: ${m.worstOption.w.toFixed(0)}px при ${m.worstOption.inner.toFixed(0)}px поля`);
        console.log(`   длиннейшее имя события «${m.worstName.text}»: ${m.worstName.w.toFixed(0)}px при колонке ${m.worstName.col.toFixed(0)}px`);
        console.log(`   левые края списков: ${m.lefts.join(', ')}`);

        expect(m.worstOption.over,
            `пункт «${m.worstOption.text}» не влезает в список: ${m.worstOption.w.toFixed(0)} > ${m.worstOption.inner.toFixed(0)}px`)
            .toBeLessThanOrEqual(0);
        expect(m.worstName.over,
            `имя события «${m.worstName.text}» не влезает в колонку`).toBeLessThanOrEqual(0);
        expect(m.lefts.length,
            `списки начинаются в ${m.lefts.length} разных местах: ${m.lefts.join(', ')}`).toBe(1);
    } finally {
        await app.close();
    }
});

/**
 * Строки звуков — СТРОКИ, а не карточки.
 *
 * Проверка отсутствия, поэтому проверяет сама себя: та же выборка на элементе,
 * у которого рамка есть, обязана рамку найти. Иначе зелёный означает и «рамок
 * нет», и «замер смотрит не туда».
 */
test('строки звуков не обведены рамкой — вкладка не забор из карточек', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.click('.wrow:has(#soundMasterToggle) .wrow-chevron');
        await control.waitForTimeout(900);
        const m = await control.evaluate(() => {
            const item = document.querySelector('.sound-item');
            const cs = getComputedStyle(item);
            const probe = document.createElement('div');
            probe.style.border = '1px solid red';
            document.body.appendChild(probe);
            const probeWidth = getComputedStyle(probe).borderTopWidth;
            probe.remove();
            return {
                top: cs.borderTopWidth, left: cs.borderLeftWidth, right: cs.borderRightWidth,
                bottom: cs.borderBottomWidth, bg: cs.backgroundColor, probeWidth
            };
        });
        console.log(`   строка звука: рамки ${m.top}/${m.right}/${m.bottom}/${m.left}, фон ${m.bg}`);
        expect(m.probeWidth, 'замер не видит рамку даже там, где она есть').toBe('1px');
        for (const side of ['top', 'left', 'right']) {
            expect(m[side], `у строки звука вернулась рамка (${side})`).toBe('0px');
        }
        // Нижняя линия — это РАЗДЕЛИТЕЛЬ между соседями, он остаётся.
        expect(m.bottom, 'исчез разделитель между строками').toBe('1px');
        expect(m.bg, 'у строки звука вернулась заливка карточки').toBe('rgba(0, 0, 0, 0)');
    } finally {
        await app.close();
    }
});
