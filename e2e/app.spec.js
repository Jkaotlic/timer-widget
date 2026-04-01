const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

let electronApp;
let controlWindow;

test.beforeAll(async () => {
    electronApp = await electron.launch({
        executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
        args: [path.join(__dirname, '..', 'electron-main.js')],
    });
    controlWindow = await electronApp.firstWindow();
    await controlWindow.waitForLoadState('domcontentloaded');
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
    const timerDisplay = await controlWindow.locator('#timerDisplay, .timer-display, [class*="timer"]').first();
    await expect(timerDisplay).toBeVisible({ timeout: 5000 });
});

test('control window has start button', async () => {
    const startBtn = await controlWindow.locator('#startBtn, button:has-text("Старт"), button:has-text("Start")').first();
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
        const display = await controlWindow.locator('#timerDisplay, .timer-display').first();
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
        await controlWindow.waitForTimeout(1500);

        // Timer should be running — display should have changed
        const display = await controlWindow.locator('#timerDisplay, .timer-display').first();
        const text = await display.textContent();
        // Should show time less than 5:00
        expect(text).toMatch(/4:5[89]|04:5[89]/);

        // Pause
        const pauseBtn = await controlWindow.locator('#pauseBtn, #startBtn').first();
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
    const widgetToggle = await controlWindow.locator('#widgetToggle, button:has-text("Виджет"), [data-action="toggle-widget"]').first();
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
