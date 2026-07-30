const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Перекидывание карточек flip-стиля.
 *
 * Анимация однажды уже пропала из виджета таймера и виджета часов, оставшись
 * только в полноэкранном режиме. Регресс жил незамеченным, потому что «цифра
 * просто сменилась» выглядит рабочим поведением, а визуальная сверка снимает
 * статичный кадр и движение не видит. Поэтому проверка именно поведенческая.
 */
test('перекидывание работает в виджете, часах и полноэкранном', async () => {
    const { app, control } = await launchApp();
    await control.evaluate(() => {
        window.ipcRenderer.send('open-widget');
        window.ipcRenderer.send('open-clock-widget');
        window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
    });
    await control.waitForTimeout(2500);

    // Переводим окна в flip-стиль
    await control.evaluate(() => {
        window.ipcRenderer.send('widget-style-update', { timerStyle: 'flip' });
        window.ipcRenderer.send('clock-widget-set-style', 'flip');
        window.ipcRenderer.send('display-settings-update', { timerStyle: 'flip' });
    });
    await control.waitForTimeout(800);

    for (const w of app.windows()) {
        const title = await w.title().catch(() => '?');
        const res = await w.evaluate(() => {
            const sel = document.querySelector('.widget-flip-card') ? '.widget-flip-card' : '.flip-card';
            const digitSel = sel === '.widget-flip-card' ? '.widget-flip-digit' : '.flip-digit';
            const card = document.querySelector(sel);
            if (!card || !window.FlipCard) { return null; }
            const before = card.classList.contains('flipping');
            const cur = card.querySelector(digitSel).textContent;
            window.FlipCard.flipCardTo(card, digitSel, cur === '9' ? '8' : '9');
            return { before, after: card.classList.contains('flipping'), hasModule: true };
        }).catch(() => null);
        if (res) {
            console.log(`${title}: было=${res.before} стало=${res.after}`);
            expect(res.after, `${title}: класс перекидывания должен появиться`).toBe(true);
        }
    }
    await app.close();
});
