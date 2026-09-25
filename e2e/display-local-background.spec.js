'use strict';

/**
 * Картинка фона дисплея ПО НАСТОЯЩЕМУ пути: файл через <input type=file>,
 * режим «Файл», ползунок затемнения, главный процесс, окно дисплея.
 *
 * BUG-10: весь фон (до ~13 М символов base64) уходил в `display-settings-update`
 * на каждое нажатие клавиши в названии мероприятия и каждый шаг ползунка.
 * Unit-тесты проверяют сборку payload и память главного процесса по
 * отдельности; здесь — что они сходятся в живом приложении: картинка едет
 * ОДИН раз, окно, открытое позже, получает её досылкой, название доходит.
 *
 * BUG-16: затемнение 0 % превращалось в 30 % (`overlay || 30`).
 *
 * Профиль e2e общий: всё, что спека меняет, возвращается в `finally`.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { openDisplay, reopenDisplay } = require('./window-ready');

// Настоящий PNG 1×1 — проходит проверку MIME и сигнатуры в local-background.js.
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

async function openDisplayTab(control) {
    await control.click('.tab-btn[data-tab="display"]');
    await control.waitForSelector('#settingsDrawer.open');
}

/** Что видно в окне дисплея: картинка на <body>, затемнение, название. */
function readDisplay(display) {
    return display.evaluate(() => {
        const overlay = document.getElementById('bgOverlay');
        const title = document.getElementById('eventTitleValue');
        return {
            image: document.body.style.backgroundImage.slice(0, 40),
            overlay: overlay ? getComputedStyle(overlay).backgroundColor : null,
            title: title ? title.textContent : null
        };
    });
}

test('локальный фон: едет один раз, затемнение 0 % честное, позже открытое окно получает картинку', async () => {
    const { app, control } = await launchApp();
    try {
        // Счётчик в ГЛАВНОМ процессе: что приходит по каналу от панели.
        // -1 — ключа картинки в payload нет, иначе её длина.
        await app.evaluate(({ ipcMain }) => {
            global.__bgSizes = [];
            ipcMain.on('display-settings-update', (_e, p) => {
                global.__bgSizes.push(p && Object.prototype.hasOwnProperty.call(p, 'bgLocalImage')
                    ? String(p.bgLocalImage).length : -1);
            });
        });
        const sizes = () => app.evaluate(() => global.__bgSizes.slice());

        await openDisplayTab(control);
        await control.click('.bg-mode-btn[data-mode="local"]');
        await control.setInputFiles('#bgFileInput', { name: 'bg.png', mimeType: 'image/png', buffer: PNG_1PX });
        await expect.poll(async () => (await sizes()).some((n) => n > 0),
            { message: 'картинка так и не ушла в главный процесс' }).toBe(true);

        // Затемнение 0 % — ползунок в ноль.
        await control.evaluate(() => {
            const el = document.getElementById('bgOverlaySlider');
            el.value = '0';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });

        const display = await openDisplay(app, control);
        await expect.poll(async () => (await readDisplay(display)).image,
            { message: 'картинка не дошла до дисплея' }).toContain('data:image/png');
        await expect.poll(async () => (await readDisplay(display)).overlay,
            { message: 'BUG-16: затемнение 0 % показано не нулём' }).toBe('rgba(0, 0, 0, 0)');

        // Набор названия: три нажатия — три посылки, и НИ ОДНОЙ с картинкой.
        // Профиль e2e общий: поле могло остаться заполненным другой спекой,
        // поэтому сначала пустое, и замер посылок — уже после очистки.
        await control.locator('#eventTitleInput').fill('');
        await control.locator('#eventTitleInput').dispatchEvent('input');
        await expect.poll(async () => (await readDisplay(display)).title).not.toBe(null);
        const before = (await sizes()).length;
        await control.locator('#eventTitleInput').pressSequentially('Абв', { delay: 30 });
        await expect.poll(async () => (await sizes()).length - before).toBeGreaterThanOrEqual(3);
        const typed = (await sizes()).slice(before);
        console.log(`   посылки при наборе: ${JSON.stringify(typed)}`);
        expect(typed.every((n) => n === -1), `BUG-10: картинка ехала при наборе названия: ${typed}`).toBe(true);

        await expect.poll(async () => (await readDisplay(display)).title).toBe('Абв');
        expect((await readDisplay(display)).image, 'посылка без картинки стёрла фон').toContain('data:image/png');

        // Окно, открытое ПОСЛЕ набора, получает картинку досылкой главного процесса.
        const again = await reopenDisplay(app, control);
        await expect.poll(async () => (await readDisplay(again)).image,
            { message: 'переоткрытый дисплей остался без фона' }).toContain('data:image/png');
        const seen = await readDisplay(again);
        expect(seen.title).toBe('Абв');
        expect(seen.overlay).toBe('rgba(0, 0, 0, 0)');

        // Удаление картинки доходит до окна: пустая строка — «картинки нет».
        await control.click('#deleteBgBtn');
        await expect.poll(async () => (await readDisplay(again)).image,
            { message: 'удалённая картинка осталась на дисплее' }).toBe('');
    } finally {
        if (control && !control.isClosed()) {
            await control.evaluate(() => {
                localStorage.removeItem('localBgImage');
                localStorage.removeItem('localBgSettings');
            }).catch(() => {});
            await control.locator('#eventTitleInput').fill('').catch(() => {});
            await control.locator('#eventTitleInput').dispatchEvent('input').catch(() => {});
            await control.click('.bg-mode-btn[data-mode="theme"]').catch(() => {});
        }
        await app.close();
    }
});
