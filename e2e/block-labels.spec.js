const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForDisplay } = require('./window-ready');

/**
 * Свои названия плашек (просьба 24.08.2026) — ПО КЛИКУ.
 *
 * Юнит-тесты держат разбор строки и таблицу настроек, но зелёный юнит не
 * доказывает, что до поля можно добраться мышью и что напечатанное доезжает до
 * окна: ряды строит модуль, значение уходит в payload дисплея, а подпись
 * применяется в третьем месте. Здесь всё это проверяется одним движением
 * пользователя.
 *
 * Отдельно проверяется ВОЗВРАТ: стёртое поле обязано вернуть стандартное слово,
 * а не оставить пустую строку. Пустая подпись — это не «без названия», а
 * съеденная строка резерва: соседи по ряду выравниваются по ней.
 */

const IS_DISPLAY = () => !!document.getElementById('progressRing');

async function findDisplay(app) {
    for (const w of app.windows()) {
        if (await w.evaluate(IS_DISPLAY).catch(() => false)) { return w; }
    }
    return null;
}

const setToggle = (control, id, value) => control.evaluate(([key, on]) => {
    const el = document.getElementById(key);
    if (!el) { return; }
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

const caption = (display, blockId) => display.evaluate(
    (id) => document.querySelector(`#${id} .info-label`).textContent,
    blockId
);

test('своё название плашки доезжает до дисплея и стирается обратно в стандартное', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await waitForDisplay(app);
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        await control.click('.tab-btn[data-tab="display"]');
        for (const key of ['showEventTime', 'showEndTime', 'showTimeLeft', 'showCurrentTime']) {
            await setToggle(control, key, true);
        }
        await display.waitForTimeout(600);

        // Поле существует, видно и доступно мыши — иначе настройки для
        // пользователя не существует.
        const field = control.locator('#labelEventTime');
        await expect(field).toBeVisible();
        expect(await caption(display, 'eventTimeBlock')).toBe('Начало');

        await field.fill('Доклад Иванова');
        await display.waitForTimeout(900);
        expect(await caption(display, 'eventTimeBlock')).toBe('Доклад Иванова');
        // Соседи чужого имени не получили.
        expect(await caption(display, 'endTimeBlock')).toBe('Окончание');

        // Длина обрезается по потолку реестра, а не по вкусу поля ввода.
        await control.locator('#labelTimeLeft').fill('я'.repeat(80));
        await display.waitForTimeout(900);
        const long = await caption(display, 'timeLeftBlock');
        expect(long.length).toBe(40);

        // Стёрли — вернулось стандартное слово.
        await field.fill('');
        await display.waitForTimeout(900);
        expect(await caption(display, 'eventTimeBlock')).toBe('Начало');
    } finally {
        await control.locator('#labelTimeLeft').fill('').catch(() => {});
        await control.waitForTimeout(400);
        for (const key of ['showEventTime', 'showEndTime', 'showTimeLeft', 'showCurrentTime']) {
            await setToggle(control, key, false).catch(() => {});
        }
        await app.close();
    }
});

test('своё название переживает перезапуск приложения', async () => {
    test.setTimeout(120000);
    let app1;
    try {
        const first = await launchApp();
        app1 = first.app;
        await first.control.click('.tab-btn[data-tab="display"]');
        await first.control.locator('#labelCurrentTime').fill('Сейчас');
        await first.control.waitForTimeout(900);
    } finally {
        if (app1) { await app1.close(); }
    }

    const { app, control } = await launchApp();
    try {
        await control.click('.tab-btn[data-tab="display"]');
        await expect(control.locator('#labelCurrentTime')).toHaveValue('Сейчас');

        await setToggle(control, 'showCurrentTime', true);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await waitForDisplay(app);
        await control.waitForTimeout(2400);
        const display = await findDisplay(app);
        expect(await caption(display, 'currentTimeBlock')).toBe('Сейчас');
    } finally {
        // Профиль e2e общий: возвращаем как было.
        await control.locator('#labelCurrentTime').fill('').catch(() => {});
        await control.waitForTimeout(400);
        await setToggle(control, 'showCurrentTime', false).catch(() => {});
        await app.close();
    }
});
