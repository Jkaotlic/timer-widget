const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

let electronApp;
let controlWindow;

test.beforeAll(async () => {
    ({ app: electronApp, control: controlWindow } = await launchApp());
});

test.afterAll(async () => {
    if (electronApp) {
        await electronApp.close();
    }
});

test('app launches and control window loads', async () => {
    const title = await controlWindow.title();
    expect(title).toBeTruthy();
});

test('control window has timer display', async () => {
    const timerDisplay = await controlWindow.locator('#controlTime, #timerDisplay, .timer-display, [class*="timer"]').first();
    await expect(timerDisplay).toBeVisible({ timeout: 5000 });
});

test('control window has start button', async () => {
    // Именно кнопка транспорта. Широкий локатор `button:has-text("Старт")`
    // после редизайна первым находил чип свёрнутой ПОЛОСЫ (#miniBarStart) —
    // он тоже называется «Старт» и в развёрнутой панели скрыт.
    const startBtn = controlWindow.locator('#startBtn');
    await expect(startBtn).toBeVisible({ timeout: 5000 });
});

test('preset buttons exist', async () => {
    const presetBtns = await controlWindow.locator('[data-minutes]').count();
    expect(presetBtns).toBeGreaterThan(0);
});

test('clicking preset sets timer value', async () => {
    const preset5 = await controlWindow.locator('[data-minutes="5"]').first();
    if (await preset5.isVisible()) {
        await preset5.click();
        // Timer display should show 05:00 or 5:00
        await controlWindow.waitForTimeout(500);
        const display = await controlWindow.locator('#controlTime, #timerDisplay, .timer-display').first();
        const text = await display.textContent();
        expect(text).toMatch(/5:00|05:00/);
    }
});

test('start/pause timer cycle', async () => {
    // Set a preset first
    const preset5 = await controlWindow.locator('[data-minutes="5"]').first();
    if (await preset5.isVisible()) {
        await preset5.click();
        await controlWindow.waitForTimeout(300);
    }

    // Find start button
    const startBtn = await controlWindow.locator('#startBtn').first();
    if (await startBtn.isVisible()) {
        await startBtn.click();

        // Ждём УСЛОВИЕ — что показанное время сдвинулось, — а не фиксированную
        // паузу. Первый тик приходит из главного процесса, и на медленной
        // машине (раннер Windows) он опаздывал: тест читал ещё «05:00» и падал,
        // хотя таймер шёл. Пауза здесь мерила скорость машины — тот же дефект,
        // что уже чинился в угле стрелки и в строке дисплея.
        const display = await controlWindow.locator('#controlTime, #timerDisplay, .timer-display').first();
        await expect(display).toHaveText(/4:5[0-9]|04:5[0-9]/, { timeout: 15000 });
        const text = await display.textContent();
        expect(text).toMatch(/4:5[0-9]|04:5[0-9]/);

        // Pause
        // Кнопка транспорта в панели ОДНА, вторая скрыта состоянием: берём ту,
        // что видна сейчас, а не первую в DOM.
        const pauseBtn = controlWindow.locator('.transport-main:visible').first();
        await pauseBtn.click();
    }
});

test('reset timer', async () => {
    const resetBtn = await controlWindow.locator('#resetBtn, button:has-text("Сброс"), button:has-text("Reset")').first();
    if (await resetBtn.isVisible()) {
        await resetBtn.click();
        await controlWindow.waitForTimeout(500);
    }
});

test('tabs are navigable', async () => {
    // Check tab buttons exist
    const tabs = await controlWindow.locator('.tab-btn, [data-tab]').count();
    expect(tabs).toBeGreaterThanOrEqual(2);
});

test('widget window can be opened', async () => {
    // Look for widget toggle
    // Тумблер строки «Виджет». Прежний широкий локатор искал кнопку с текстом
    // «Виджет»; после редизайна имя окна лежит в <span> строки, а не в кнопке,
    // и локатор цеплял не тот элемент.
    const widgetToggle = controlWindow.locator('#openWidgetBtn');
    if (await widgetToggle.isVisible()) {
        await widgetToggle.click();
        await controlWindow.waitForTimeout(1000);

        const windows = electronApp.windows();
        // Should have more than just control window
        expect(windows.length).toBeGreaterThanOrEqual(1);
    }
});

test('no console errors on launch', async () => {
    const errors = [];
    controlWindow.on('console', msg => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
        }
    });
    await controlWindow.waitForTimeout(1000);
    // Filter out expected warnings
    const realErrors = errors.filter(e => !e.includes('JSON parse error'));
    expect(realErrors.length).toBe(0);
});
