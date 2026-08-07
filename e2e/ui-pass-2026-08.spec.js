const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Замеры UI-прохода от 07.08.2026 — то, что картинкой не поймать.
 *
 * Скриншотная сверка гоняет только 5-минутные пресеты и имеет допуск 8/255
 * при пороге 0.1% изменённых пикселей: поворот стрелки на пару градусов она
 * пропускает, а разницы «часовой стрелки нет вообще» на таймере короче часа
 * просто не существует — 0 часов и есть 12. Кадры clock-* исключены из
 * сверки целиком, потому что окно показывает живое время.
 */

function handAngle(id) {
    const el = document.getElementById(id);
    if (!el) { return null; }
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') { return 0; }
    // matrix(a, b, c, d, e, f) → угол = atan2(b, a)
    const n = t.match(/-?[\d.]+/g).map(Number);
    return Math.round(((Math.atan2(n[1], n[0]) * 180 / Math.PI + 360) % 360) * 10) / 10;
}

test('часовая стрелка виджета движется', async () => {
    const { app, control } = await launchApp();
    await control.click('#openWidgetBtn');
    const widget = await app.waitForEvent('window');
    await widget.waitForLoadState('domcontentloaded');

    // Стиль переключаем ЧЕРЕЗ интерфейс: контейнеры стилей скрыты и
    // показываются классом .active, поэтому ожидание #widgetAnalog без
    // переключения висело бы на скрытом элементе.
    await control.click('.tab-btn[data-tab="timer"]');
    await control.waitForSelector('#settingsDrawer.open');
    await control.click('#timerStyle button:has-text("Аналог")');

    await control.fill('#manualTimeInput', '1:30:00');
    await control.click('#manualTimeApply');
    await widget.waitForSelector('#widgetAnalog.active');
    await widget.waitForTimeout(500);

    const angle = await widget.evaluate(handAngle, 'widgetHandHour');
    expect(angle, 'элемента #widgetHandHour нет в разметке').not.toBeNull();
    // ((5400 / 3600) % 12) * 30 = 45°
    expect(Math.abs(angle - 45)).toBeLessThan(1.5);

    await app.close();
});

test('деления циферблата виджета стоят на одной оси', async () => {
    // У каждого класса делений был свой top, поэтому метки на 3 и 9 часах
    // висели выше горизонтальной оси — замер давал 23.5px на кадре 800px.
    const { app, control } = await launchApp();
    await control.click('#openWidgetBtn');
    const widget = await app.waitForEvent('window');
    await widget.waitForLoadState('domcontentloaded');

    await control.click('.tab-btn[data-tab="timer"]');
    await control.waitForSelector('#settingsDrawer.open');
    await control.click('#timerStyle button:has-text("Аналог")');
    await widget.waitForSelector('#widgetAnalog.active');
    await widget.waitForTimeout(400);

    const delta = await widget.evaluate(() => {
        // Деление на 3 часах (rotate(90deg)) и центр циферблата обязаны
        // совпадать по вертикали.
        const q = document.querySelector('.widget-clock-tick.quarter[style*="90deg"]');
        const c = document.getElementById('widgetClockCenter');
        const qr = q.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        return Math.abs((qr.top + qr.height / 2) - (cr.top + cr.height / 2));
    });
    expect(delta).toBeLessThan(2);

    await app.close();
});
