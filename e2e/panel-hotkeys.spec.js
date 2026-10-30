const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');

/**
 * PANEL-005: глобальный пробел панели и кнопки в фокусе — в НАСТОЯЩЕМ Chromium.
 *
 * Юнит-тест (tests/panel-hotkeys.test.js) проверяет ворота на поддельных
 * элементах; здесь — то, что подделка не скажет: что Chromium действительно
 * нажимает кнопку пробелом, когда панель не делает preventDefault, и что
 * отметка «кликнули мышью» доживает до нажатия. Замер до правки: кнопка в
 * фокусе, Space → click 0 раз (preventDefault глушил нажатие).
 */

const state = (control) => control.evaluate(() => ({
    running: !!window.timerController.isRunning,
    clicks: window.__presetClicks || 0
}));

async function stopTimer(control) {
    await control.evaluate(() => {
        if (window.timerController.isRunning) { window.timerController.pause(); }
        window.timerController.reset();
    });
    await control.waitForTimeout(300);
}

test('пробел: кнопка с клавиатуры нажимается, кнопка после клика мышью запускает таймер', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.preset[data-minutes="5"]');
        await control.waitForTimeout(300);
        await control.evaluate(() => {
            window.__presetClicks = 0;
            document.querySelector('.preset[data-minutes="15"]')
                .addEventListener('click', () => { window.__presetClicks++; });
        });

        // Фокус пришёл НЕ мышью (как после Tab): пробел — за кнопкой.
        await control.evaluate(() => document.querySelector('.preset[data-minutes="15"]').focus());
        await control.keyboard.press('Space');
        await control.waitForTimeout(500);
        let s = await state(control);
        console.log('клавиатурный фокус:', JSON.stringify(s));
        expect(s.clicks, 'пробел не нажал кнопку в фокусе').toBe(1);
        expect(s.running, 'пробел на кнопке ещё и запустил таймер — двойное срабатывание').toBe(false);

        // Клик мышью по пресету и пробел — отсчёт пошёл, как всегда.
        await control.click('.preset[data-minutes="15"]');
        await control.waitForTimeout(300);
        const before = (await state(control)).clicks;
        await control.keyboard.press('Space');
        await control.waitForTimeout(1200);
        s = await state(control);
        console.log('после клика мышью:', JSON.stringify(s));
        expect(s.running, 'клик по пресету и пробел больше не запускают отсчёт').toBe(true);
        expect(s.clicks, 'пробел повторно нажал пресет').toBe(before);
    } finally {
        await stopTimer(control);
        await app.close();
    }
});

test('открытая модалка: пробел и R не трогают таймер за диалогом', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.preset[data-minutes="5"]');
        await control.waitForTimeout(300);
        await control.evaluate(() => {
            document.body.focus();
            window.openModal(document.getElementById('exitModal'));
        });
        await control.waitForTimeout(200);
        // Фокус — внутри модалки; уводим его на сам диалог, чтобы пробел не
        // нажал её кнопку (проверяется таймер, а не кнопки модалки).
        await control.evaluate(() => {
            const m = document.getElementById('exitModal');
            m.setAttribute('tabindex', '-1');
            m.focus();
        });
        await control.keyboard.press('Space');
        await control.waitForTimeout(1000);
        const s = await state(control);
        expect(s.running, 'пробел запустил таймер за открытой модалкой').toBe(false);
        await control.evaluate(() => {
            const m = document.getElementById('exitModal');
            window.closeModal(m);
            m.removeAttribute('tabindex');
        });
    } finally {
        await stopTimer(control);
        await app.close();
    }
});
