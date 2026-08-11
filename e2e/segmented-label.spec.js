const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Подпись контрола выбора стиля не ломается на две строки.
 *
 * Ящик настроек — 320px. В схеме «подпись слева — контрол справа» подпись
 * «Стиль таймера» вставала в две строки, а пять сегментов жались до касания
 * краёв. Схема `.setting-block` (подпись НАД контролом) уже применена к
 * «Шрифту цифр» ровно по этой причине — правка распространяет имеющийся
 * приём, а не вводит новый.
 *
 * Проверяются все три ряда: виджет, часы, дисплей. У часов id `clockStyleRow`
 * обязан остаться на РЕАЛЬНОЙ обёртке контрола — иначе синхронизация стиля
 * прячет не тот узел (отдельный урок проекта).
 */
const ROWS = [
    { tab: 'timer', seg: 'timerStyle', rowId: null },
    { tab: 'clock', seg: 'clockStyle', rowId: 'clockStyleRow' },
    { tab: 'display', seg: 'displayTimerStyle', rowId: null }
];

for (const row of ROWS) {
    test(`подпись стиля (${row.tab}) занимает одну строку`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.click(`.tab-btn[data-tab="${row.tab}"]`);
            await control.waitForTimeout(600);

            const m = await control.evaluate(({ seg, rowId }) => {
                const el = document.getElementById(seg);
                const block = el.closest('.setting-block, .toggle-row');
                const label = block.querySelector('.toggle-label');
                const cs = getComputedStyle(label);
                const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
                const buttons = [...el.querySelectorAll('button')]
                    .map(b => +b.getBoundingClientRect().width.toFixed(1));
                return {
                    labelHeight: +label.getBoundingClientRect().height.toFixed(1),
                    lineHeight: +lh.toFixed(1),
                    blockClass: block.className,
                    rowIdOnBlock: rowId ? block.id : null,
                    buttons
                };
            }, row);

            expect(
                m.labelHeight,
                `подпись ${m.labelHeight}px при интерлиньяже ${m.lineHeight}px — это две строки`
            ).toBeLessThanOrEqual(m.lineHeight * 1.5);

            expect(m.blockClass, 'ряд обязан быть .setting-block').toContain('setting-block');

            if (row.rowId) {
                expect(m.rowIdOnBlock, 'id обязан остаться на реальной обёртке контрола').toBe(row.rowId);
            }

            // Сегменты делят ширину поровну: в строке они жались к краям, и
            // «Аналог» с «Цифры» почти касались границ. Разброс ширин не
            // больше пикселя — округление subpixel.
            const spread = Math.max(...m.buttons) - Math.min(...m.buttons);
            expect(spread, `ширины сегментов: ${m.buttons.join(', ')}`).toBeLessThanOrEqual(1);
        } finally {
            await app.close();
        }
    });
}
