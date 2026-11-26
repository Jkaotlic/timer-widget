const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const { waitForWidget, waitForWidgetGone } = require('./window-ready');

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
    await expect(controlWindow).toHaveTitle('Управление Таймером');
});

test('no console errors on launch', async () => {
    const errors = (await controlWindow.consoleMessages())
        .filter((msg) => msg.type() === 'error')
        .map((msg) => msg.text());
    expect(errors).toEqual([]);
    expect(await controlWindow.pageErrors()).toEqual([]);
});

test('control window has timer display', async () => {
    await expect(controlWindow.locator('#controlTimeDigits')).toBeVisible();
});

test('control window has start button', async () => {
    // Именно кнопка транспорта. Широкий локатор `button:has-text("Старт")`
    // после редизайна первым находил чип свёрнутой ПОЛОСЫ (#miniBarStart) —
    // он тоже называется «Старт» и в развёрнутой панели скрыт.
    const startBtn = controlWindow.locator('#startBtn');
    await expect(startBtn).toBeVisible({ timeout: 5000 });
});

test('preset buttons exist', async () => {
    await expect(controlWindow.locator('button.preset[data-minutes]')).toHaveText(['5', '15', '25', '45']);
});

test('clicking preset sets timer value', async () => {
    const digits = controlWindow.locator('#controlTimeDigits');
    await controlWindow.locator('.preset[data-minutes="15"]').click();
    await expect(digits).toHaveText('15:00');
    await controlWindow.locator('.preset[data-minutes="5"]').click();
    await expect(digits).toHaveText('05:00');
});

test('start/pause timer cycle', async () => {
    const digits = controlWindow.locator('#controlTimeDigits');
    await controlWindow.locator('.preset[data-minutes="5"]').click();
    await expect(digits).toHaveText('05:00');
    await controlWindow.locator('#startBtn').click();
    await expect(controlWindow.locator('body')).toHaveClass(/\bstate-running\b/);
    await expect(digits).toHaveText(/^04:\d{2}$/, { timeout: 15000 });

    await controlWindow.locator('#pauseBtn').click();
    await expect(controlWindow.locator('#statusText')).toHaveText('Пауза');
    const resume = controlWindow.locator('#startBtn');
    await expect(resume).toBeVisible();
    await expect(resume).toContainText('Продолжить');
});

test('widget window can be opened', async () => {
    // Look for widget toggle
    // Тумблер строки «Виджет». Прежний широкий локатор искал кнопку с текстом
    // «Виджет»; после редизайна имя окна лежит в <span> строки, а не в кнопке,
    // и локатор цеплял не тот элемент.
    const widgetToggle = controlWindow.locator('#openWidgetBtn');
    await expect(widgetToggle).toHaveAttribute('aria-checked', 'false');
    await widgetToggle.click();
    await waitForWidget(electronApp);
    await expect(widgetToggle).toHaveAttribute('aria-checked', 'true');

    await widgetToggle.click();
    await waitForWidgetGone(electronApp);
    await expect(widgetToggle).toHaveAttribute('aria-checked', 'false');
});
