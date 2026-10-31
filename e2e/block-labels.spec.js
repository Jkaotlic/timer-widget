const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    panelRoundTrip, untilDisplayGot, waitForSettledDisplay
} = require('./window-ready');

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

const setToggle = (control, id, value) => control.evaluate(([key, on]) => {
    const el = document.getElementById(key);
    if (!el) { return; }
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

const TOGGLES = ['showEventTime', 'showEndTime', 'showTimeLeft', 'showCurrentTime'];

const caption = (display, blockId) => display.evaluate(
    (id) => document.querySelector(`#${id} .info-label`).textContent,
    blockId
);

test('своё название плашки доезжает до дисплея и стирается обратно в стандартное', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        const display = await waitForSettledDisplay(app);

        await control.click('.tab-btn[data-tab="display"]');
        await untilDisplayGot(display, async () => {
            for (const key of TOGGLES) { await setToggle(control, key, true); }
        }, Object.fromEntries(TOGGLES.map((k) => [k, true])));

        // Поле существует, видно и доступно мыши — иначе настройки для
        // пользователя не существует.
        const field = control.locator('#labelEventTime');
        await expect(field).toBeVisible();
        expect(await caption(display, 'eventTimeBlock')).toBe('Начало');

        await untilDisplayGot(display, () => field.fill('Доклад Иванова'), { labelEventTime: 'Доклад Иванова' });
        expect(await caption(display, 'eventTimeBlock')).toBe('Доклад Иванова');
        // Соседи чужого имени не получили.
        expect(await caption(display, 'endTimeBlock')).toBe('Окончание');

        // Длина обрезается по потолку реестра, а не по вкусу поля ввода.
        // Ждём посылку с тем, что ОСТАЛОСЬ в поле (у него свой maxlength), —
        // обрезку утверждает уже подпись в окне.
        await untilDisplayGot(display, () => control.locator('#labelTimeLeft').fill('я'.repeat(80)),
            async () => ({ labelTimeLeft: await control.locator('#labelTimeLeft').inputValue() }));
        const long = await caption(display, 'timeLeftBlock');
        expect(long.length).toBe(40);

        // Стёрли — вернулось стандартное слово.
        await untilDisplayGot(display, () => field.fill(''), { labelEventTime: '' });
        expect(await caption(display, 'eventTimeBlock')).toBe('Начало');
    } finally {
        // Поле пишет профиль синхронно в input (saveExtSettings); круг — и
        // main получил настройки.
        await control.locator('#labelTimeLeft').fill('').catch(() => {});
        await panelRoundTrip(control).catch(() => {});
        for (const key of TOGGLES) {
            await setToggle(control, key, false).catch(() => {});
        }
        await app.close();
    }
});

test('своё название переживает перезапуск приложения', async () => {
    let app1;
    try {
        // Название обязано пережить перезапуск — сторож профиля вернёт его
        // только на последнем закрытии теста.
        const first = await launchApp({ keepProfile: true });
        app1 = first.app;
        await first.control.click('.tab-btn[data-tab="display"]');
        await first.control.locator('#labelCurrentTime').fill('Сейчас');
        // Профиль записан синхронно в input; круг — main получил настройки
        // (relay сбрасывается на выходе, main-lifecycle.js).
        await panelRoundTrip(first.control);
    } finally {
        if (app1) { await app1.close(); }
    }

    const { app, control } = await launchApp();
    try {
        await control.click('.tab-btn[data-tab="display"]');
        await expect(control.locator('#labelCurrentTime')).toHaveValue('Сейчас');

        await setToggle(control, 'showCurrentTime', true);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        const display = await waitForSettledDisplay(app);
        expect(await caption(display, 'currentTimeBlock')).toBe('Сейчас');
    } finally {
        // Профиль e2e общий: возвращаем как было.
        await control.locator('#labelCurrentTime').fill('').catch(() => {});
        await panelRoundTrip(control).catch(() => {});
        await setToggle(control, 'showCurrentTime', false).catch(() => {});
        await app.close();
    }
});
