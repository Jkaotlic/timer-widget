const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Испорченное значение стиля не должно ломать окно часов.
 *
 * `setClockStyle()` в часах клал класс конкатенацией — `classList.add('style-' +
 * style)` — в отличие от виджета и дисплея, где ветки switch кладут литералы.
 * Значение с пробелом или пустая строка роняют `classList.add` с DOMException:
 * обработчик обрывается на полпути, ни один из четырёх стилей не получает
 * `.active`, и часы остаются пустым прозрачным окном без единого способа
 * починить их из интерфейса.
 *
 * Путь для мусора реальный, и их два: `clock-widget-set-style` главный процесс
 * ретранслирует БЕЗ проверки (`safelySendToWindow` без белого списка), и
 * `clockStyle` читается из localStorage при старте окна.
 *
 * Замечание найдено security-обзором 03.08.2026 и оставалось ниже порога
 * находки; чинится вместе с раскладкой шильдиков.
 */

const BAD_STYLES = [
    'circle malicious',   // пробел — DOMException в classList.add
    '',                   // пустая строка — тоже DOMException
    'нет такого стиля',
    'style-flip; drop'
];

async function findClock(app) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(() => !!document.getElementById('wFlipSecGroup')).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

// Часы «живы», если ровно один из четырёх стилей отрисован и на body стоит
// ровно один класс style-*.
function measureStyleState() {
    const panes = {
        circle: document.querySelector('.circular-widget'),
        digital: document.getElementById('widgetDigital'),
        flip: document.getElementById('widgetFlip'),
        analog: document.getElementById('widgetAnalog')
    };
    const active = Object.entries(panes)
        .filter(([, el]) => el && el.classList.contains('active'))
        .map(([name]) => name);
    const bodyStyles = [...document.body.classList].filter((c) => c.startsWith('style-'));
    return { active, bodyStyles };
}

test('испорченный стиль часов откатывается на круговой, а не ломает окно', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => { window.ipcRenderer.send('open-clock-widget'); });
    await control.waitForTimeout(2000);

    const clock = await findClock(app);
    expect(clock, 'окно часов должно открыться').not.toBeNull();

    // Заведомо валидный стиль — чтобы старт был из известного состояния.
    await control.evaluate(() => { window.ipcRenderer.send('clock-widget-set-style', 'flip'); });
    await control.waitForTimeout(600);
    const before = await clock.evaluate(measureStyleState);
    console.log('до мусора:', JSON.stringify(before));
    expect(before.active, 'исходный стиль должен примениться').toEqual(['flip']);

    for (const bad of BAD_STYLES) {
        await control.evaluate((s) => {
            window.ipcRenderer.send('clock-widget-set-style', s);
        }, bad);
        await control.waitForTimeout(500);

        const state = await clock.evaluate(measureStyleState);
        console.log(`мусор ${JSON.stringify(bad)} →`, JSON.stringify(state));

        expect(state.active, `${JSON.stringify(bad)}: ровно один стиль должен остаться нарисованным`)
            .toHaveLength(1);
        expect(state.active[0], `${JSON.stringify(bad)}: должен быть откат на круговой`).toBe('circle');
        expect(state.bodyStyles, `${JSON.stringify(bad)}: на body ровно один класс style-*`)
            .toEqual(['style-circle']);
    }

    // Убираем за собой: стиль часов персистится в общем localStorage.
    await control.evaluate(() => { window.ipcRenderer.send('clock-widget-set-style', 'circle'); });
    await control.waitForTimeout(500);
    await app.close();
});
