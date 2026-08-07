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

test('в светлой теме часы читаемы: стрелки, цифры флипа, шильдики', async () => {
    // Кадры clock-* исключены из visual:check как зависящие от живого времени,
    // поэтому картинкой это не проверить в принципе — только замером.
    const { app, control } = await launchApp();
    await control.click('#openClockBtn');
    const clock = await app.waitForEvent('window');
    await clock.waitForLoadState('domcontentloaded');

    await control.click('#contrastToggle');          // тёмная → светлая
    await clock.waitForTimeout(400);

    const seen = await clock.evaluate(() => {
        const cs = (sel) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el) : null;
        };
        return {
            theme: document.documentElement.dataset.theme,
            hand: cs('.widget-analog-hour')?.backgroundImage || '',
            track: cs('.seconds-track')?.stroke || '',
            shadow: cs('.time-display')?.textShadow || '',
            flipDigit: cs('.widget-flip-digit')?.color || '',
            seconds: cs('.time-display .clock-seconds')?.opacity || ''
        };
    });

    expect(seen.theme).toBe('light');
    // Стрелки были залиты жёстко белым градиентом — на белом циферблате их нет.
    expect(seen.hand).not.toMatch(/255,\s*255,\s*255/);
    // Трек брался из --tw-border, то есть из токена для РАМОК: 1.52:1 на белом.
    expect(seen.track).toMatch(/148,\s*148,\s*153/);
    // Жёсткая чёрная тень под почти чёрным текстом — грязное тиснение.
    expect(seen.shadow === 'none' || seen.shadow === '').toBe(true);
    // Цифры флипа брали --tw-fg = #1d1d1f на тёмной карточке: чёрное по чёрному.
    expect(seen.flipDigit).toMatch(/255,\s*255,\s*255/);
    expect(Number(seen.seconds)).toBeCloseTo(0.62, 2);

    await app.close();
});

test('кольцо дисплея стоит в центре окна, чип не наезжает на подсказку', async () => {
    const { app, control } = await launchApp();
    await control.click('#openDisplayBtn');
    const display = await app.waitForEvent('window');
    await display.waitForLoadState('domcontentloaded');
    await display.waitForSelector('.timer-ring');
    await display.waitForTimeout(500);

    const m = await display.evaluate(() => {
        const r = document.querySelector('.timer-ring').getBoundingClientRect();
        const pill = document.querySelector('.status-pill').getBoundingClientRect();
        const hint = document.querySelector('.controls-hint').getBoundingClientRect();
        return {
            ringCenterY: r.top + r.height / 2,
            windowCenterY: window.innerHeight / 2,
            pillBottom: pill.bottom,
            hintTop: hint.top
        };
    });

    // Лейбл «ОСТАЛОСЬ» — обычный ребёнок центрируемой колонки, поэтому смещал
    // центр кольца вниз на половину своей высоты. Замер до правки на 1280×720:
    // 384px при центре окна 360px.
    expect(Math.abs(m.ringCenterY - m.windowCenterY)).toBeLessThan(3);
    // Чип растёт вместе с экраном и на 720p при bottom: 36px наезжал на
    // .controls-hint (fixed, bottom: 12px, высота до 30px).
    expect(m.pillBottom).toBeLessThan(m.hintTop);

    await app.close();
});
