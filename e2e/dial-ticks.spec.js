const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Деления на круглом циферблате («Деления на циферблате» во вкладке Виджет).
 *
 * Тумблер был удалён из разметки в 9b70782, при этом ВСЯ его обвязка осталась
 * жива: обработчик в панели, поле showTicks в widget-style-update и clock-settings,
 * applyShowTicks в обоих окнах, правило `.ticks-on .tick-marks` и SVG-группа
 * делений. То есть функция существовала целиком и была недостижима из интерфейса.
 * Тумблер возвращён — этот тест держит всю цепочку под замером.
 *
 * Настройка ОБЩАЯ для двух циферблатов, поэтому проверяем оба окна.
 */

const MARKERS = {
    clock: () => !!document.getElementById('wFlipSecGroup'),
    widget: () => !!document.getElementById('wFlipHoursGroup')
};

async function findWindow(app, kind) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(MARKERS[kind]).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

// Замеряем то, что видит пользователь: рисуются ли линии делений.
function measureTicks() {
    const container = document.querySelector('.widget-container');
    const group = document.querySelector('.tick-marks');
    return {
        hasClass: !!container && container.classList.contains('ticks-on'),
        groupDisplay: group ? getComputedStyle(group).display : null
    };
}

async function setTicks(control, on) {
    await control.evaluate((v) => {
        const el = document.getElementById('widgetShowTicks');
        el.checked = v;
        el.dispatchEvent(new Event('change'));
    }, on);
}

test('деления включаются и выключаются в виджете и в часах', async () => {
    const { app, control } = await launchApp();

    // Тумблер обязан существовать в разметке — именно его отсутствие и было дефектом.
    const exists = await control.evaluate(() => !!document.getElementById('widgetShowTicks'));
    expect(exists, 'галочка «Деления на циферблате» должна быть в панели').toBe(true);

    await control.evaluate(() => {
        window.ipcRenderer.send('open-widget');
        window.ipcRenderer.send('open-clock-widget');
    });
    await control.waitForTimeout(2000);

    const widget = await findWindow(app, 'widget');
    const clock = await findWindow(app, 'clock');
    expect(widget).not.toBeNull();
    expect(clock).not.toBeNull();

    // --- Включаем ---
    await setTicks(control, true);
    await control.waitForTimeout(900);

    const widgetOn = await widget.evaluate(measureTicks);
    const clockOn = await clock.evaluate(measureTicks);
    console.log('вкл → виджет:', JSON.stringify(widgetOn), 'часы:', JSON.stringify(clockOn));

    expect(widgetOn.hasClass, 'виджет: класс ticks-on должен появиться').toBe(true);
    expect(widgetOn.groupDisplay, 'виджет: группа делений должна рисоваться').toBe('inline');
    expect(clockOn.hasClass, 'часы: класс ticks-on должен появиться').toBe(true);
    expect(clockOn.groupDisplay, 'часы: группа делений должна рисоваться').toBe('inline');

    // --- Выключаем ---
    await setTicks(control, false);
    await control.waitForTimeout(900);

    const widgetOff = await widget.evaluate(measureTicks);
    const clockOff = await clock.evaluate(measureTicks);
    console.log('выкл → виджет:', JSON.stringify(widgetOff), 'часы:', JSON.stringify(clockOff));

    expect(widgetOff.groupDisplay, 'виджет: деления должны скрыться').toBe('none');
    expect(clockOff.groupDisplay, 'часы: деления должны скрыться').toBe('none');

    await app.close();
});

test('включённые деления переживают переоткрытие виджета', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    await control.waitForTimeout(1500);
    await setTicks(control, true);
    await control.waitForTimeout(700);

    // Закрываем и открываем заново — состояние обязано подняться из хранилища,
    // не дожидаясь посылки настроек из панели.
    await control.evaluate(() => window.ipcRenderer.send('close-widget'));
    await control.waitForTimeout(800);
    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    await control.waitForTimeout(1500);

    const widget = await findWindow(app, 'widget');
    const state = await widget.evaluate(measureTicks);
    console.log('после переоткрытия →', JSON.stringify(state));
    expect(state.groupDisplay, 'деления должны остаться включёнными').toBe('inline');

    // Убираем за собой, чтобы не влиять на другие прогоны (localStorage общий).
    await setTicks(control, false);
    await control.waitForTimeout(500);
    await app.close();
});
