const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Тост не имеет права закрывать герой-время.
 *
 * Контейнер тостов был прибит к `top: 40px`, а цифры героя по CSS начинаются
 * с 59px (титлбар 30 + отступ 10 + подпись 13 + зазор 6) и имеют высоту 58.
 * Пересечение — 22px из 41. Это не только подсказка первого запуска «F1 —
 * список горячих клавиш»: тем же путём приходят сообщение о восстановлении
 * после падения и любые ошибки, то есть сообщение закрывало ровно то, ради
 * чего окно открыто.
 *
 * Проверяется ЗАМЕРОМ прямоугольников, а не осмотром: в этом проекте уже был
 * случай, когда выравнивание дважды подряд определили на глаз и оба раза
 * ошиблись.
 */
test('тост не пересекается с герой-временем', async () => {
    const { app, control } = await launchApp();
    try {
        const rects = await control.evaluate(async () => {
            if (!window.Toast || typeof window.Toast.show !== 'function') { return { noToast: true }; }
            window.Toast.show('Проверка размещения тоста');
            await new Promise(r => setTimeout(r, 400));
            const toast = document.querySelector('.toast');
            const hero = document.querySelector('.timer-display-main');
            if (!toast || !hero) { return { noToast: true }; }
            const t = toast.getBoundingClientRect();
            const h = hero.getBoundingClientRect();
            return {
                toast: { top: t.top, bottom: t.bottom },
                hero: { top: h.top, bottom: h.bottom }
            };
        });

        expect(rects.noToast, 'тост или герой не найдены — проверка ничего не измерила').toBeUndefined();

        const overlap = Math.min(rects.toast.bottom, rects.hero.bottom)
                      - Math.max(rects.toast.top, rects.hero.top);
        expect(
            overlap,
            `тост ${rects.toast.top.toFixed(1)}…${rects.toast.bottom.toFixed(1)}, `
            + `цифры ${rects.hero.top.toFixed(1)}…${rects.hero.bottom.toFixed(1)}, `
            + `перекрытие ${overlap.toFixed(1)}px`
        ).toBeLessThanOrEqual(0);
    } finally {
        await app.close();
    }
});
