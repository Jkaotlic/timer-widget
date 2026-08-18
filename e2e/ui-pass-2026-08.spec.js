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
    await control.click('.wrow-chevron[data-tab="timer"]');
    await control.waitForSelector('#settingsDrawer.open');
    await control.click('#timerStyle button:has-text("Аналог")');

    // Ящик закрываем: он перекрывает панель, а клик по времени — это вход в
    // состояние ввода, которого редизайн 2026-08-12 требует перед вводом.
    await control.click('#drawerClose');
    await control.waitForTimeout(500);
    await control.click('#controlTime');
    await control.waitForTimeout(300);
    // Полей три: часы отдельно, поэтому минуты ограничены 59, как и секунды.
    await control.fill('#manualHours', '1');
    await control.fill('#manualMinutes', '30');
    await control.fill('#manualSeconds', '0');
    await control.press('#manualSeconds', 'Enter');
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

    await control.click('.wrow-chevron[data-tab="timer"]');
    await control.waitForSelector('#settingsDrawer.open');
    await control.click('#timerStyle button:has-text("Аналог")');
    await widget.waitForSelector('#widgetAnalog.active');
    await widget.waitForTimeout(400);

    const m = await widget.evaluate(() => {
        // Деление на 3 часах (rotate(90deg)) и центр циферблата обязаны
        // совпадать по вертикали.
        const q = document.querySelector('.widget-clock-tick.quarter[style*="90deg"]');
        const c = document.getElementById('widgetClockCenter');
        const qr = q.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        // Замер делится на МАСШТАБ: циферблат нарисован в 150px и растянут
        // трансформацией под окно, поэтому расхождение в экранных пикселях
        // растёт вместе с окном. Абсолютный порог здесь и был проверкой на
        // размер окна: 0.83px исходного сдвига давали 0.84px на окне 180 и
        // 3.60px на раннере CI — тест падал там и проходил тут при одном и
        // том же коде.
        const t = getComputedStyle(document.querySelector('.widget-analog-content')).transform;
        const scale = t && t !== 'none' ? (parseFloat(t.slice(t.indexOf('(') + 1)) || 1) : 1;
        return {
            screen: Math.abs((qr.top + qr.height / 2) - (cr.top + cr.height / 2)),
            scale
        };
    });
    const unscaled = m.screen / m.scale;
    console.log(`   ось делений: ${m.screen.toFixed(2)}px на экране при масштабе ${m.scale.toFixed(2)} → ${unscaled.toFixed(2)}px в исходном циферблате`);
    // Порог по НЕмасштабированному циферблату. Источник прежнего сдвига —
    // два разных способа сказать «середина»: деления шли от `top: 8%` (11.83px)
    // плюс origin 63px = 74.83, а центральная точка стояла на 74. Правило:
    // `top` + вертикаль transform-origin = ровно половина padding-бокса.
    expect(unscaled, `деления смещены относительно центра на ${unscaled.toFixed(2)}px`).toBeLessThan(0.25);

    await app.close();
});

test('в светлой теме часы читаемы: стрелки, цифры флипа, шильдики', async () => {
    // Кадры clock-* исключены из visual:check как зависящие от живого времени,
    // поэтому картинкой это не проверить в принципе — только замером.
    const { app, control } = await launchApp();
    await control.click('#openClockBtn');
    const clock = await app.waitForEvent('window');
    await clock.waitForLoadState('domcontentloaded');

    // Дефолт после редизайна 2026-08-12 — СВЕТЛАЯ тема, поэтому переключать
    // ничего не нужно: часы уже в ней. Прежняя версия кликала «тёмная →
    // светлая» и теперь уводила бы ровно из проверяемого состояния.
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
            flipCard: cs('.widget-flip-inner')?.backgroundImage || '',
            // Первый стоп градиента — верхняя половина створки.
            flipCardTop: (cs('.widget-flip-inner')?.backgroundImage || '').slice(0, 80),
            seconds: cs('.time-display .clock-seconds')?.opacity || ''
        };
    });

    expect(seen.theme).toBe('light');
    // Стрелки были залиты жёстко белым градиентом — на белом циферблате их нет.
    expect(seen.hand).not.toMatch(/255,\s*255,\s*255/);
    // Трек брался из --tw-border, то есть из токена для РАМОК: 1.52:1 на белом.
    expect(seen.track).toMatch(/148,\s*148,\s*153/);
    // Тень под цифрами: жёсткая чёрная под почти чёрным текстом на белом — это
    // грязное тиснение, и раньше её гасило отдельное правило `text-shadow: none`
    // под [data-theme="light"]. Теперь тень приходит токеном --style-ink-shadow,
    // который на светлом тоне и есть светлый ореол: гасить нечего, но чёрной
    // она быть по-прежнему не имеет права. Проверяем это, а не отсутствие.
    expect(seen.shadow, 'тень под цифрами обязана быть').not.toBe('');
    expect(seen.shadow, 'жёсткая чёрная тень на белом — грязное тиснение')
        .not.toMatch(/rgba?\(0,\s*0,\s*0,?\s*(0\.[3-9]|1)?\)/);
    expect(seen.shadow, 'на светлом тоне ореол обязан быть светлым').toMatch(/255,\s*255,\s*255/);
    // Цифры флипа. ЭТА ПРОВЕРКА ПЕРЕВЁРНУТА 18.08.2026, и не по вкусу.
    // Раньше карточку флипа сознательно НЕ перекрашивали в светлую («у
    // настоящих перекидных часов табло тёмное»), и цифры на ней закрепляли
    // белыми. Пользователь попросил обратного и прямо: «чтобы все стили по
    // умолчанию в светлой теме были светлыми». Теперь светлеет табло, а цифры
    // темнеют вместе с ним — проверяем ПАРУ, иначе снова получится
    // «светлое по светлому».
    expect(seen.flipDigit, 'на светлом табло цифры обязаны быть тёмными')
        .not.toMatch(/255,\s*255,\s*255/);
    expect(seen.flipCard, 'табло флипа в светлой теме обязано быть светлым').toMatch(/gradient/);
    expect(seen.flipCardTop, 'верхняя половина табло обязана быть светлой').toMatch(/2[0-5][0-9],\s*2[0-5][0-9],\s*2[0-5][0-9]/);
    expect(Number(seen.seconds)).toBeCloseTo(0.62, 2);

    // Тема живёт в localStorage, а профиль e2e ОДИН на весь прогон (иначе
    // crash-recovery.spec.js не увидел бы свой снимок после SIGKILL). Раньше
    // тест ПЕРЕКЛЮЧАЛ тему в начале и возвращал её здесь. После редизайна
    // 2026-08-12 светлая стала дефолтом: переключать нечего, и прежний
    // «возврат» стал бы порчей — он оставлял бы тёмную тему следующим спекам.
    // Ровно так ui-theme.spec.js и падал в общем прогоне, оставаясь зелёным
    // в одиночку: 126 из 127 проходили, один — нет.
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
            windowH: window.innerHeight,
            pillBottom: pill.bottom,
            hintTop: hint.top,
            // Подсказка гаснет сама через несколько секунд, и её прямоугольник
            // схлопывается в ноль. В одиночном прогоне тест успевал застать её
            // живой, в полном — нет, и сравнение шло с hintTop: 0.
            hintVisible: hint.height > 0
        };
    });

    // Лейбл «ОСТАЛОСЬ» — обычный ребёнок центрируемой колонки, поэтому смещал
    // центр кольца вниз на половину своей высоты. Замер до правки на 1280×720:
    // 384px при центре окна 360px.
    expect(Math.abs(m.ringCenterY - m.windowCenterY)).toBeLessThan(3);
    // Чип растёт вместе с экраном и на 720p при bottom: 36px наезжал на
    // .controls-hint (fixed, bottom: 12px, высота до 30px). Полоса подсказки
    // занимает нижние ~42px, поэтому её место резервируем всегда — даже когда
    // сама подсказка уже погасла и померить её нечем.
    expect(m.pillBottom).toBeLessThan(m.windowH - 42);
    if (m.hintVisible) {
        expect(m.pillBottom).toBeLessThan(m.hintTop);
    }

    await app.close();
});
