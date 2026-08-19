const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Пресеты вида ПО КЛИКУ: записали один вид, перенастроили, вернули.
 *
 * Просьба 19.08.2026: «пресеты для быстрой настройки стилей и отображения,
 * чтобы долго не ковыряться: выбрать пресет и запустить… один раз настроить и
 * сохранить настройку в пресет».
 *
 * Почему e2e. Пресет — это операция над ЧУЖИМ профилем: он перезаписывает
 * ключи, из которых собран вид всех трёх окон, а потом панель обязана
 * перечитать их и разослать. Юнит-тест проверяет арифметику снимка на
 * поддельном хранилище; здесь меряется, что после клика ИЗМЕНИЛОСЬ ОКНО — то
 * есть что цепочка «ячейка → профиль → панель → IPC → дисплей» жива целиком.
 */

const IS_DISPLAY = () => !!document.getElementById('progressRing');

async function findDisplay(app) {
    for (const w of app.windows()) {
        if (await w.evaluate(IS_DISPLAY).catch(() => false)) { return w; }
    }
    return null;
}

const displayStyle = (page) => page.evaluate(() => {
    const body = document.body.className;
    const m = /style-(\w+)/.exec(body);
    return {
        style: m ? m[1] : null,
        currentTimeShown: document.getElementById('currentTimeBlock').classList.contains('visible')
    };
});

const slotState = (control) => control.evaluate(() => {
    const out = {};
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`presetSlot${i}`);
        out[i] = el ? { filled: el.classList.contains('filled'), visible: !!el.offsetParent } : null;
    }
    return out;
});

test('ячейка записывает вид и возвращает его КЛИКОМ', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        // Профиль e2e общий: начинаем с пустых ячеек, иначе тест мерил бы
        // чужую запись из соседней спеки.
        await control.evaluate(() => localStorage.removeItem('uiPresets'));
        await control.reload();
        await control.waitForTimeout(1200);

        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        // Ячейки ВИДНЫ и пусты — иначе всё дальнейшее проверяло бы невидимое.
        const before = await slotState(control);
        console.log(`   ячейки: ${JSON.stringify(before)}`);
        for (const i of [1, 2, 3, 4]) {
            expect(before[i], `ячейки ${i} нет в разметке`).not.toBeNull();
            expect(before[i].visible, `ячейка ${i} не видна`).toBe(true);
            expect(before[i].filled, `ячейка ${i} на чистом профиле считается записанной`).toBe(false);
        }

        // --- настраиваем вид: стиль «Флип» + блок «Текущее время» ---
        await control.click('.wrow:has(#openDisplayBtn) .wrow-chevron');
        await control.waitForTimeout(700);
        await control.click('#displayTimerStyle button[data-val="flip"]');
        await control.evaluate(() => {
            const el = document.getElementById('showCurrentTime');
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await display.waitForTimeout(900);
        const configured = await displayStyle(display);
        console.log(`   настроено: ${JSON.stringify(configured)}`);
        expect(configured.style, 'стиль не применился — записывать нечего').toBe('flip');
        expect(configured.currentTimeShown, 'блок не показался — записывать нечего').toBe(true);

        // --- клик по ПУСТОЙ ячейке записывает текущий вид ---
        await control.click('#presetSlot1');
        await control.waitForTimeout(700);
        expect((await slotState(control))[1].filled, 'ячейка не пометилась записанной').toBe(true);

        // --- всё перенастраиваем ---
        await control.click('#displayTimerStyle button[data-val="analog"]');
        await control.evaluate(() => {
            const el = document.getElementById('showCurrentTime');
            el.checked = false;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await display.waitForTimeout(900);
        const changed = await displayStyle(display);
        console.log(`   перенастроено: ${JSON.stringify(changed)}`);
        expect(changed.style, 'стиль не сменился — возвращать будет нечего').toBe('analog');
        expect(changed.currentTimeShown).toBe(false);

        // --- и возвращаем КЛИКОМ по ячейке ---
        await control.click('#presetSlot1');
        await control.waitForTimeout(1500);
        const restored = await displayStyle(display);
        console.log(`   после пресета: ${JSON.stringify(restored)}`);
        expect(restored.style, 'пресет не вернул стиль').toBe('flip');
        expect(restored.currentTimeShown, 'пресет не вернул блок').toBe(true);

        // Панель обязана показывать то же, что окно: иначе следующая правка
        // уедет от того, что видно на экране.
        const panelStyle = await control.evaluate(() => document.getElementById('displayTimerStyle').value);
        expect(panelStyle, 'панель осталась на прежнем стиле').toBe('flip');
    } finally {
        await control.evaluate(() => {
            localStorage.removeItem('uiPresets');
            const el = document.getElementById('showCurrentTime');
            if (el) { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
        await control.click('#displayTimerStyle button[data-val="circle"]').catch(() => {});
        await app.close();
    }
});

test('Ctrl+1 применяет ячейку, Ctrl+Shift+1 записывает', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => localStorage.removeItem('uiPresets'));
        await control.reload();
        await control.waitForTimeout(1200);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);

        await control.click('.wrow:has(#openDisplayBtn) .wrow-chevron');
        await control.waitForTimeout(600);
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await display.waitForTimeout(800);
        expect((await displayStyle(display)).style).toBe('digits');

        // Записываем клавишами.
        await control.keyboard.press('Control+Shift+Digit2');
        await control.waitForTimeout(600);
        expect((await slotState(control))[2].filled, 'Ctrl+Shift+2 не записал ячейку').toBe(true);

        await control.click('#displayTimerStyle button[data-val="circle"]');
        await display.waitForTimeout(800);
        expect((await displayStyle(display)).style).toBe('circle');

        // И возвращаем клавишами.
        await control.keyboard.press('Control+Digit2');
        await control.waitForTimeout(1500);
        expect((await displayStyle(display)).style, 'Ctrl+2 не применил ячейку').toBe('digits');
    } finally {
        await control.evaluate(() => localStorage.removeItem('uiPresets')).catch(() => {});
        await control.click('#displayTimerStyle button[data-val="circle"]').catch(() => {});
        await app.close();
    }
});
