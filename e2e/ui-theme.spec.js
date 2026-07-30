const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

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
        // В hc-теме размытие снято, в тёмной — есть. Токен читается из CSS, то
        // есть проверяется вся цепочка «атрибут → селектор → переменная».
        blur: cs.getPropertyValue('--tw-blur').trim(),
        fgDim: cs.getPropertyValue('--tw-fg-dim').trim(),
        surface: cs.getPropertyValue('--tw-bg-surface').trim()
    };
}

test('высокий контраст включается во всех четырёх окнах и сохраняется', async () => {
    const { app, control } = await launchApp();

    // Кнопка обязана быть в разметке: недостижимая тема — это и был дефект.
    const hasButton = await control.evaluate(() => !!document.getElementById('contrastToggle'));
    expect(hasButton, 'кнопка переключения темы должна быть в титлбаре').toBe(true);

    await control.evaluate(() => {
        window.ipcRenderer.send('open-widget');
        window.ipcRenderer.send('open-clock-widget');
        window.ipcRenderer.send('open-display');
    });
    await control.waitForTimeout(2500);

    const widget = await findWindow(app, 'widget');
    const clock = await findWindow(app, 'clock');
    const display = await findWindow(app, 'display');
    expect(widget, 'окно виджета не найдено').not.toBeNull();
    expect(clock, 'окно часов не найдено').not.toBeNull();
    expect(display, 'полноэкранное окно не найдено').not.toBeNull();

    const windows = { control, widget, clock, display };

    // Исходное состояние: тёмная тема со стеклом во всех окнах.
    for (const [name, w] of Object.entries(windows)) {
        const before = await w.evaluate(probeTheme);
        expect(before.attr, `${name}: тема должна стартовать как dark`).toBe('dark');
        expect(before.blur, `${name}: в тёмной теме размытие обязано быть`).toContain('blur(');
    }

    // Переключаем кнопкой — именно так, как это делает пользователь.
    await control.click('#contrastToggle');
    await control.waitForTimeout(800);

    for (const [name, w] of Object.entries(windows)) {
        const after = await w.evaluate(probeTheme);
        expect(after.attr, `${name}: высокий контраст не доехал`).toBe('hc-dark');
        expect(after.blur, `${name}: в hc-теме размытие обязано быть снято`).toBe('none');
        expect(after.fgDim, `${name}: подписи в hc-теме обязаны стать непрозрачными`).toBe('#c0c0c0');
    }

    // Кнопка сообщает своё состояние, а не только красится.
    const pressed = await control.getAttribute('#contrastToggle', 'aria-pressed');
    expect(pressed, 'aria-pressed обязан отражать включённую тему').toBe('true');

    // Тема переживает перезагрузку окна: значение читается из localStorage до
    // первого кадра (скрипт в <head>), а не приходит потом по IPC.
    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    const afterReload = await control.evaluate(probeTheme);
    expect(afterReload.attr, 'тема не сохранилась между загрузками').toBe('hc-dark');
    const pressedAfterReload = await control.getAttribute('#contrastToggle', 'aria-pressed');
    expect(pressedAfterReload, 'кнопка после перезагрузки не показывает включённую тему').toBe('true');

    // И обратно — переключатель двусторонний.
    await control.click('#contrastToggle');
    await control.waitForTimeout(800);
    for (const [name, w] of Object.entries(windows)) {
        const back = await w.evaluate(probeTheme);
        expect(back.attr, `${name}: возврат к тёмной теме не доехал`).toBe('dark');
        expect(back.blur, `${name}: размытие должно вернуться`).toContain('blur(');
    }

    await app.close();
});
