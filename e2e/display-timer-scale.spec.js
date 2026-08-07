const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Характеризация: масштаб полноэкранного таймера применяется ко всем блокам
 * стилей из всех трёх точек входа.
 *
 * Написан ДО сворачивания четырёх строк (метод, названный по кольцу, плюс три
 * присваивания style.transform) в applyTimerScale() и обязан пройти ПОСЛЕ него
 * без единого изменения — ровно так проверялось извлечение window-geometry.js.
 *
 * Почему это вообще стоит теста: блок был написан ТРИЖДЫ, и пятый стиль
 * означал бы пятую строку в трёх местах. Пропуск в одной из копий даёт
 * «масштаб работает, пока не тронешь колесо» — молча.
 */

const BLOCK_IDS = ['timerRing', 'timerDigital', 'timerFlip', 'timerAnalog'];

function readScales(ids) {
    const out = {};
    for (const id of ids) {
        const el = document.getElementById(id);
        out[id] = el ? el.style.transform : null;
    }
    return out;
}

async function findDisplay(app) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(() => !!document.getElementById('timerRing')).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

test('масштаб дисплея применяется ко всем блокам стилей', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);

        const display = await findDisplay(app);
        expect(display, 'полноэкранное окно должно открыться').not.toBeNull();

        // Точка входа 1: приход настроек от панели.
        await display.evaluate(() => window.ipcRenderer.send('get-timer-state'));
        await control.evaluate(() => {
            window.ipcRenderer.send('display-settings-update', { displayTimerScale: 150 });
        });
        await display.waitForTimeout(500);

        const afterPush = await display.evaluate(readScales, BLOCK_IDS);
        for (const id of BLOCK_IDS) {
            expect(afterPush[id], `${id} должен быть отмасштабирован приходом настроек`).toContain('scale(1.5)');
        }

        // Точка входа 2: Ctrl+колесо.
        await display.evaluate(() => {
            document.body.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
            }));
        });
        await display.waitForTimeout(300);

        const afterWheel = await display.evaluate(readScales, BLOCK_IDS);
        const wheelValues = new Set(Object.values(afterWheel));
        expect(wheelValues.size, 'все четыре блока должны получить ОДИН и тот же масштаб').toBe(1);
        expect(afterWheel.timerRing).not.toBe(afterPush.timerRing);

        // Точка входа 3: восстановление из localStorage при загрузке окна.
        const stored = await display.evaluate(() => localStorage.getItem('displayTimerScale'));
        expect(Number(stored), 'колесо обязано сохранить масштаб').toBeGreaterThan(0);
    } finally {
        await app.close();
    }
});
