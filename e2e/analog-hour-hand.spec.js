const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Часовая стрелка аналогового стиля полноэкранного режима обязана двигаться.
 *
 * Элемент #analogHandHour есть в разметке, правило .hand-hour есть в CSS, ссылка
 * в initElements() есть — а присваивания transform не было ни одного. Стрелка
 * стояла на 12 всегда. На таймерах короче часа это выглядело правдоподобно (0
 * часов и есть 12), поэтому дефект и не замечали; на 1:30:00 минутная бежала, а
 * часовая продолжала показывать 12.
 *
 * Скриншот-набор гоняет только 5-минутные пресеты, поэтому визуальная сверка тут
 * бессильна — нужен замер угла при остатке больше часа.
 */

function readAngle() {
    const el = document.getElementById('analogHandHour');
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') { return { raw: t, deg: 0 }; }
    // matrix(a, b, c, d, e, f) → угол = atan2(b, a)
    const nums = t.match(/-?[\d.]+/g).map(Number);
    const deg = (Math.atan2(nums[1], nums[0]) * 180 / Math.PI + 360) % 360;
    return { raw: t, deg: Math.round(deg * 10) / 10 };
}

test('часовая стрелка отражает остаток, а не стоит на 12', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
    await control.waitForTimeout(2000);

    let display = null;
    for (const w of app.windows()) {
        if (await w.evaluate(() => !!document.getElementById('analogHandHour')).catch(() => false)) { display = w; }
    }
    expect(display, 'окно дисплея не найдено').not.toBeNull();

    await control.evaluate(() => window.ipcRenderer.send('display-settings-update', { timerStyle: 'analog' }));
    await control.waitForTimeout(600);

    const cases = [
        { seconds: 300, expected: 2.5, what: '5 минут → 2.5°' },      // 300/3600 * 30
        { seconds: 3600, expected: 30, what: '1 час → 30°' },
        { seconds: 5400, expected: 45, what: '1:30:00 → 45°' },
        { seconds: 21600, expected: 180, what: '6 часов → 180°' }
    ];

    for (const c of cases) {
        await control.evaluate((s) => window.ipcRenderer.send('timer-command', { type: 'set', seconds: s }), c.seconds);
        await control.waitForTimeout(500);
        const a = await display.evaluate(readAngle);
        console.log(`${c.what} → замерено ${a.deg}° (${a.raw})`);
        expect(Math.abs(a.deg - c.expected), `${c.what}: получено ${a.deg}°`).toBeLessThan(1.5);
    }

    // Ключевая проверка: 12 часов ≠ 1:30:00. До правки оба давали 0°.
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'set', seconds: 5400 }));
    await control.waitForTimeout(400);
    const long = await display.evaluate(readAngle);
    expect(long.deg, 'на 1:30:00 стрелка не имеет права стоять на 12').toBeGreaterThan(5);

    await app.close();
});
