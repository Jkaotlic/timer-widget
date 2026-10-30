const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const { panelRoundTrip } = require('./window-ready');

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
    // Команды ушли в main, их состояние вернулось панели (круг).
    await panelRoundTrip(control);
}

/**
 * Всё, что панель ОТПРАВИЛА (команды таймера от клика или клавиши), main
 * обработал, и его ответ (`timer-state`) панель отработала. Обработчики клика
 * и клавиш панели синхронны: команда, если она есть, ушла до круга. Так
 * утверждается и ОТСУТСТВИЕ запуска — посылки «start» нет до круга, значит её
 * нет вовсе (раньше паузы 300 / 500 / 1000 / 1200 мс).
 */
const settled = panelRoundTrip;

test('пробел: кнопка с клавиатуры нажимается, кнопка после клика мышью запускает таймер', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.preset[data-minutes="5"]');
        await settled(control);
        await control.evaluate(() => {
            window.__presetClicks = 0;
            document.querySelector('.preset[data-minutes="15"]')
                .addEventListener('click', () => { window.__presetClicks++; });
        });

        // Фокус пришёл НЕ мышью (как после Tab): пробел — за кнопкой.
        await control.evaluate(() => document.querySelector('.preset[data-minutes="15"]').focus());
        await control.keyboard.press('Space');
        await settled(control);
        let s = await state(control);
        console.log('клавиатурный фокус:', JSON.stringify(s));
        expect(s.clicks, 'пробел не нажал кнопку в фокусе').toBe(1);
        expect(s.running, 'пробел на кнопке ещё и запустил таймер — двойное срабатывание').toBe(false);

        // Клик мышью по пресету и пробел — отсчёт пошёл, как всегда.
        await control.click('.preset[data-minutes="15"]');
        await settled(control);
        const before = (await state(control)).clicks;
        await control.keyboard.press('Space');
        await settled(control);
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
        await settled(control);
        await control.evaluate(() => {
            document.body.focus();
            window.openModal(document.getElementById('exitModal'));
        });
        // Начальный фокус модалка ставит отложенно (modal-manager.js,
        // setTimeout 0) — он перебил бы наш фокус на сам диалог ниже.
        await control.waitForFunction(() => {
            const m = document.getElementById('exitModal');
            return m.contains(document.activeElement) && document.activeElement !== m;
        });
        // Фокус — внутри модалки; уводим его на сам диалог, чтобы пробел не
        // нажал её кнопку (проверяется таймер, а не кнопки модалки).
        await control.evaluate(() => {
            const m = document.getElementById('exitModal');
            m.setAttribute('tabindex', '-1');
            m.focus();
        });
        await control.keyboard.press('Space');
        await settled(control);
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
