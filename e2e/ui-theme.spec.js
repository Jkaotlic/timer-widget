const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForClock, waitForDisplay, waitForWidget } = require('./window-ready');

/**
 * Тема интерфейса: переключение доходит до всех окон и переживает перезагрузку.
 *
 * Почему это e2e, а не source-тест. Блоки тем лежали в design-tokens.css с самого
 * начала, но атрибут `data-theme` не выставлял никто — темы были недостижимы, и
 * поэтому их контраст ни разу не проверяли. Source-тест докажет, что проводка
 * СУЩЕСТВУЕТ; доказать, что она РАБОТАЕТ, может только запуск: тема применяется
 * в четырёх процессах-рендерерах, через IPC-рассылку главного процесса, и любое
 * порванное звено даёт «переключилось в панели, не переключилось в виджете».
 *
 * Проверяем не только атрибут, но и ВЫЧИСЛЕННЫЙ стиль: атрибут может стоять, а
 * тема не доезжать до правил (например, если окно не грузит design-tokens.css).
 */

// Маркеры окон — те же, что в остальных спеках: по уникальному id разметки.
const MARKERS = {
    widget: () => !!document.getElementById('wFlipHoursGroup'),
    clock: () => !!document.getElementById('wFlipSecGroup'),
    display: () => !!document.getElementById('flipHoursUnit')
};

async function findWindow(app, kind) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(MARKERS[kind]).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

// Что видит пользователь: тема на корне + признак, что правила темы применились.
function probeTheme() {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
        attr: root.getAttribute('data-theme'),
        // Токены читаются из CSS, то есть проверяется вся цепочка
        // «атрибут → селектор → переменная», а не только атрибут.
        blur: cs.getPropertyValue('--tw-blur').trim(),
        fgDim: cs.getPropertyValue('--tw-fg-dim').trim(),
        surface: cs.getPropertyValue('--tw-bg-surface').trim()
    };
}

test('светлая тема включается во всех четырёх окнах и сохраняется', async () => {
    const { app, control } = await launchApp();

    // Кнопка обязана быть в разметке: недостижимая тема — это и был дефект.
    const hasButton = await control.evaluate(() => !!document.getElementById('contrastToggle'));
    expect(hasButton, 'кнопка переключения темы должна быть в титлбаре').toBe(true);

    await control.evaluate(() => {
        window.ipcRenderer.send('open-widget');
        window.ipcRenderer.send('open-clock-widget');
        window.ipcRenderer.send('open-display');
    });
    await waitForDisplay(app);
    await waitForWidget(app);
    await waitForClock(app);
    await control.waitForTimeout(2500);

    const widget = await findWindow(app, 'widget');
    const clock = await findWindow(app, 'clock');
    const display = await findWindow(app, 'display');
    expect(widget, 'окно виджета не найдено').not.toBeNull();
    expect(clock, 'окно часов не найдено').not.toBeNull();
    expect(display, 'полноэкранное окно не найдено').not.toBeNull();

    const windows = { control, widget, clock, display };

    // Исходное состояние: СВЕТЛАЯ тема и НИ КАПЛИ стекла.
    // Редизайн 2026-08-12 поменял здесь обе половины: дефолт стал светлым, а
    // размытие снято в обеих темах — поверхности разделяют расстояние и
    // заливка. Прежняя версия требовала ровно обратного и была права до него.
    for (const [name, w] of Object.entries(windows)) {
        const before = await w.evaluate(probeTheme);
        expect(before.attr, `${name}: тема должна стартовать как light`).toBe('light');
        expect(before.blur, `${name}: стекло снято во всех окнах`).not.toContain('blur(');
    }

    // Переключаем кнопкой — именно так, как это делает пользователь.
    await control.click('#contrastToggle');
    await control.waitForTimeout(800);

    // Атрибут обязан доехать до ВСЕХ четырёх окон.
    for (const [name, w] of Object.entries(windows)) {
        const after = await w.evaluate(probeTheme);
        expect(after.attr, `${name}: тёмная тема не доехала`).toBe('dark');
    }

    // А вот ЗНАЧЕНИЯ различаются по окнам, и это осознанно. Панель и часы
    // владеют своим фоном и становятся светлыми. Виджет и полноэкранный дисплей
    // лежат на ПОЛЬЗОВАТЕЛЬСКОМ фоне (настройка «Фон» применяется инлайном,
    // поверх любой темы, и по умолчанию тёмная), поэтому там палитра закреплена
    // светлым по тёмному: иначе получались почти чёрные цифры на тёмно-синем —
    // на проекторе время не читалось вовсе.
    // Переключились в ТЁМНУЮ: панель и часы владеют фоном и темнеют.
    for (const name of ['control', 'clock']) {
        const after = await windows[name].evaluate(probeTheme);
        expect(
            after.fgDim,
            `${name}: подписи в тёмной теме обязаны стать светлыми`
        ).toContain('255, 255, 255');
    }
    // Виджет фона не имеет вообще — лежит поверх чужого рабочего стола, и
    // палитра «светлое по тёмному» прибита в обеих темах.
    //
    // Дисплей после редизайна 2026-08-12 пин снял: он теме СЛЕДУЕТ, но цвет
    // текста решает не тема, а яркость его фактического фона. По умолчанию фон
    // тёмный градиент, поэтому текст здесь светлый — и остаётся светлым в обеих
    // темах ровно потому, что фон не менялся.
    for (const name of ['widget', 'display']) {
        const after = await windows[name].evaluate(probeTheme);
        expect(
            after.fgDim,
            `${name}: на тёмном фоне текст обязан остаться светлым`
        ).toContain('255, 255, 255');
    }

    // Кнопка сообщает своё состояние, а не только красится.
    const pressed = await control.getAttribute('#contrastToggle', 'aria-pressed');
    expect(pressed, 'aria-pressed обязан отражать включённую тему').toBe('false');

    // Тема переживает перезагрузку окна: значение читается из localStorage до
    // первого кадра (скрипт в <head>), а не приходит потом по IPC.
    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    const afterReload = await control.evaluate(probeTheme);
    // Переживает перезагрузку ВЫБРАННАЯ тема, а выбрали мы тёмную: дефолт
    // теперь светлый, и проверка «после перезагрузки снова light» ничего бы не
    // доказывала — она была бы зелёной и на пустом localStorage.
    expect(afterReload.attr, 'тема не сохранилась между загрузками').toBe('dark');
    const pressedAfterReload = await control.getAttribute('#contrastToggle', 'aria-pressed');
    expect(pressedAfterReload, 'кнопка после перезагрузки не показывает выбранную тему').toBe('false');

    // И обратно — переключатель двусторонний.
    await control.click('#contrastToggle');
    await control.waitForTimeout(800);
    for (const [name, w] of Object.entries(windows)) {
        const back = await w.evaluate(probeTheme);
        expect(back.attr, `${name}: возврат к светлой теме не доехал`).toBe('light');
        // Стекло не возвращается НИ В ОДНОЙ теме: редизайн снял его насовсем,
        // и «размытие должно вернуться» было бы проверкой отменённого правила.
        expect(back.blur, `${name}: стекло не должно возвращаться`).not.toContain('blur(');
    }

    await app.close();
});

/**
 * Высокий контраст обязан доезжать до САМИХ КОНТРОЛОВ, а не только до токенов.
 *
 * Тест выше проверяет, что `data-theme` и значения переменных доехали во все
 * окна. Этого мало: половина заливок панели задана в control.css литералами
 * (rgba(255,255,255,0.04–0.06)), которые тема не переопределяет в принципе. На
 * тёмно-синем стекле такой слой виден, на чистом чёрном — исчезает, и тема
 * выглядела как «тёмная, из которой слили цвет»: фон чёрный, кнопки от него не
 * отделяются. Правила темы адресно возвращают им заливку, и проверять надо
 * ВЫЧИСЛЕННЫЙ цвет элемента — объявленный токен ничего не доказывает.
 *
 * Отдельно проверяется правило «на заливке акцентом надпись чёрная»: белым по
 * осветлённому зелёному выходит 1.9:1, то есть нечитаемая главная кнопка в теме,
 * сделанной ради читаемости.
 */
function contrastRatio(rgbA, rgbB) {
    const lin = (c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const a = lum(rgbA);
    const b = lum(rgbB);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const parseRgb = (s) => (String(s).match(/\d+/g) || []).slice(0, 3).map(Number);

test('светлая тема перекрашивает сами контролы, а не только переменные', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => {
        window.UITheme.applyTheme('light');
        // Пресет делаем активным: именно у него заливка акцентом.
        document.querySelector('.preset[data-minutes="5"]').click();
        document.querySelector('.wrow-chevron[data-tab="clock"]').click();
    });
    await control.waitForTimeout(900);

    const probe = await control.evaluate(() => {
        const css = (el, pseudo) => (el ? getComputedStyle(el, pseudo || null) : null);
        const preset = document.querySelector('.preset.active');
        const plain = document.querySelector('.preset:not(.active)');
        const seconds = document.getElementById('clockShowSeconds');
        const slider = seconds ? seconds.nextElementSibling : null;
        return {
            plainBg: plain ? css(plain).backgroundColor : null,
            plainBorder: plain ? css(plain).borderTopColor : null,
            activeBg: preset ? css(preset).backgroundColor : null,
            // Заливка активного пресета была ГРАДИЕНТОМ: backgroundColor у него
            // прозрачный, и первая версия этой проверки получала «21:1 на
            // rgba(0,0,0,0)» — зелёная, ничего не проверяющая. Редизайн
            // 2026-08-12 сделал заливку ПЛОСКОЙ, но ловушку убирать нельзя:
            // берём остановки градиента, если он есть, иначе сплошной цвет.
            // Список пуст только если заливки нет вообще — это и есть провал.
            activeStops: preset
                ? ((css(preset).backgroundImage.match(/rgba?\([^)]+\)/g))
                    || [css(preset).backgroundColor].filter((c) => c && c !== 'rgba(0, 0, 0, 0)'))
                : [],
            activeColor: preset ? css(preset).color : null,
            track: slider ? css(slider).backgroundColor : null,
            knob: slider ? css(slider, '::before').backgroundColor : null
        };
    });
    console.log('светлая тема, вычисленные цвета →', JSON.stringify(probe));

    // 1. Обычный контрол отделяется от фона окна собственной заливкой.
    const plain = parseRgb(probe.plainBg);
    expect(plain.length, 'заливка неактивного пресета не прочиталась').toBe(3);
    expect(
        plain.reduce((a, b) => a + b, 0),
        `неактивный пресет заливается ${probe.plainBg} — на белом фоне он обязан быть заметно темнее`
    ).toBeLessThan(720);

    // 2. Надпись на заливке акцентом читается на ВС�ём градиенте, а не в среднем
    //    по нему: если один край достаточно тёмный, а другой нет, надпись
    //    пропадает на половине кнопки.
    const activeFg = parseRgb(probe.activeColor);
    expect(
        probe.activeStops.length,
        'у активного пресета не нашлось заливки акцентом — ни градиента, ни сплошного цвета'
    ).toBeGreaterThanOrEqual(1);
    for (const stop of probe.activeStops) {
        const ratio = contrastRatio(activeFg, parseRgb(stop));
        console.log(`надпись активного пресета: ${probe.activeColor} на ${stop} → ${ratio.toFixed(2)}:1`);
        expect(
            ratio,
            `надпись активного пресета даёт ${ratio.toFixed(2)}:1 на остановке градиента ${stop}`
        ).toBeGreaterThanOrEqual(7);
    }

    // 3. Бегунок включённого переключателя — того же правила.
    const knobRatio = contrastRatio(parseRgb(probe.knob), parseRgb(probe.track));
    console.log(`бегунок: ${probe.knob} на ${probe.track} → ${knobRatio.toFixed(2)}:1`);
    expect(
        knobRatio,
        `бегунок ${probe.knob} на дорожке ${probe.track} даёт ${knobRatio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(7);

    await app.close();
});
