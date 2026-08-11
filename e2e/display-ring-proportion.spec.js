const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Дуга прогресса занимает долю высоты окна, а не пиксели.
 *
 * Порог задан ДОЛЕЙ намеренно: пиксельный сломался бы на другом разрешении, а
 * доля переносится между машинами. Замер до правки на 3440×1440: бокс кольца
 * 55,0% высоты, а сама дуга — 44,0%, потому что радиус дуги 160 из вьюбокса
 * 400. Разница уходила в пустую полосу между дугой и декоративной внешней
 * окружностью (r=185).
 *
 * `--timer-box: min(60vw, 55vh, 1600px)` НЕ трогается: он настроен осознанно,
 * рядом в display.css лежит разбор про 4K. Правится только радиус внутри
 * вьюбокса.
 */
test('дуга прогресса занимает не менее половины высоты окна', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('#openDisplayBtn');
        await control.waitForTimeout(1500);

        let display = null;
        for (const w of app.windows()) {
            const hit = await w.evaluate(() => !!document.querySelector('#progressRing')).catch(() => false);
            if (hit) { display = w; }
        }
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        const m = await display.evaluate(() => {
            const ring = document.querySelector('.timer-ring');
            const svg = document.querySelector('.timer-svg');
            const arc = document.querySelector('#progressRing');
            const track = document.querySelector('.ring-track');
            const bg = document.querySelector('.ring-bg');
            const box = ring.getBoundingClientRect().height;
            const viewBox = svg.viewBox.baseVal.width;   // 400
            const r = parseFloat(arc.getAttribute('r'));
            const strokeW = parseFloat(getComputedStyle(arc).strokeWidth);
            return {
                arcShare: (box * (2 * r) / viewBox) / window.innerHeight,
                boxShare: box / window.innerHeight,
                r,
                strokeW,
                trackR: parseFloat(track.getAttribute('r')),
                bgR: parseFloat(bg.getAttribute('r'))
            };
        });

        expect(m.arcShare, `дуга занимает ${(m.arcShare * 100).toFixed(1)}% высоты при боксе ${(m.boxShare * 100).toFixed(1)}%`)
            .toBeGreaterThanOrEqual(0.48);
        // Трек и дуга — одна окружность: разъехавшись, они дадут две дуги
        // разного радиуса вместо заполняющейся шкалы.
        expect(m.trackR).toBe(m.r);
        // Дуга обязана остаться ВНУТРИ декоративной окружности: радиус плюс
        // половина обводки не больше радиуса окружности.
        expect(m.r + m.strokeW / 2).toBeLessThanOrEqual(m.bgR);

        await control.click('#openDisplayBtn');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});
