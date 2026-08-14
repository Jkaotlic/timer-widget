const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Деления круглого циферблата — настройка ЧАСОВ.
 *
 * История в две части. Сначала тумблер был удалён из разметки, а вся его
 * обвязка осталась жива: обработчик в панели, поле в двух IPC-пакетах,
 * applyShowTicks в обоих окнах, правило `.ticks-on .tick-marks` и SVG-группа.
 * Функция существовала целиком и была недостижима из интерфейса — тумблер
 * вернули, и этот тест держал цепочку под замером.
 *
 * Вторая часть — 13.08.2026: у ВИДЖЕТА ТАЙМЕРА делений больше нет вовсе. Там не
 * циферблат, а кольцо обратного отсчёта: засечки на нём ничего не сообщали и
 * только шумели. Настройка осталась одна и принадлежит часам, тумблер живёт в
 * ИХ вкладке. Поэтому тест проверяет ДВЕ вещи сразу: деления работают у часов
 * и их разметки нет у виджета — иначе «настройка переехала» означало бы просто
 * «контрол спрятали, мёртвый код остался», ровно как в первой части истории.
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
        groupDisplay: group ? getComputedStyle(group).display : null,
        hasGroup: !!group
    };
}

async function setTicks(control, on) {
    await control.evaluate((v) => {
        const el = document.getElementById('clockShowTicks');
        el.checked = v;
        el.dispatchEvent(new Event('change'));
    }, on);
}

test('деления включаются и выключаются у часов, а у виджета их нет вовсе', async () => {
    const { app, control } = await launchApp();

    const exists = await control.evaluate(() => !!document.getElementById('clockShowTicks'));
    expect(exists, 'галочка «Деления на циферблате» должна быть в панели').toBe(true);
    const gone = await control.evaluate(() => !!document.getElementById('widgetShowTicks'));
    expect(gone, 'старый тумблер во вкладке виджета обязан исчезнуть').toBe(false);

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

    const clockOn = await clock.evaluate(measureTicks);
    const widgetState = await widget.evaluate(measureTicks);
    console.log('вкл → часы:', JSON.stringify(clockOn), 'виджет:', JSON.stringify(widgetState));

    expect(clockOn.hasClass, 'часы: класс ticks-on должен появиться').toBe(true);
    expect(clockOn.groupDisplay, 'часы: группа делений должна рисоваться').toBe('inline');
    // У виджета не «скрыто», а НЕТ: мёртвая разметка вернула бы прежний дефект.
    expect(widgetState.hasGroup, 'у виджета не должно остаться группы делений').toBe(false);

    // --- Выключаем ---
    await setTicks(control, false);
    await control.waitForTimeout(900);

    const clockOff = await clock.evaluate(measureTicks);
    console.log('выкл → часы:', JSON.stringify(clockOff));
    expect(clockOff.groupDisplay, 'часы: деления должны скрыться').toBe('none');

    await app.close();
});

test('включённые деления переживают переоткрытие часов', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
    await control.waitForTimeout(1500);
    await setTicks(control, true);
    await control.waitForTimeout(700);

    // Закрываем и открываем заново — состояние обязано подняться из хранилища,
    // не дожидаясь посылки настроек из панели.
    await control.evaluate(() => window.ipcRenderer.send('close-clock-widget'));
    await control.waitForTimeout(800);
    await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
    await control.waitForTimeout(1500);

    const clock = await findWindow(app, 'clock');
    const state = await clock.evaluate(measureTicks);
    console.log('после переоткрытия →', JSON.stringify(state));
    expect(state.groupDisplay, 'деления должны остаться включёнными').toBe('inline');

    // Профиль e2e общий на весь прогон — возвращаем как было.
    await setTicks(control, false);
    await control.waitForTimeout(500);
    await app.close();
});
