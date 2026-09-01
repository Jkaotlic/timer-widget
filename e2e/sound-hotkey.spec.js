const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForWidget } = require('./window-ready');

/**
 * Клавиша `Z` переключает звук — ПО НАЖАТИЮ, из панели и из чужого окна.
 *
 * Проверяется не только сама клавиша, но и то, ради чего она потребовала
 * правки: у мастер-звука было ДВА владельца — чекбокс в ящике настроек и
 * тумблер строки «Звуки», которые не сообщались. Поэтому после каждого нажатия
 * сверяются ОБА вида: чекбокс (он же сохраняемое значение) и тумблер строки.
 */

async function findWidget(app) {
    for (const w of app.windows()) {
        const url = w.url();
        if (url.includes('electron-widget.html')) { return w; }
    }
    return null;
}

const soundState = (control) => control.evaluate(() => {
    const box = document.getElementById('soundMasterEnabled');
    const row = document.getElementById('soundMasterToggle');
    return {
        checkbox: !!box.checked,
        rowOn: row.classList.contains('active'),
        rowAria: row.getAttribute('aria-checked'),
        stored: (window.SecurityUtils.safeJSONParse(localStorage.getItem('displayExtSettings'), {}) || {}).soundMasterEnabled
    };
});

test('Z переключает звук из панели, и оба вида согласны друг с другом', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        const before = await soundState(control);
        console.log('   до нажатия: ' + JSON.stringify(before));
        expect(before.rowOn, 'строка «Звуки» показывает не то, что чекбокс').toBe(before.checkbox);

        await control.click('.control-panel');
        await control.keyboard.press('KeyZ');
        await control.waitForTimeout(500);

        const after = await soundState(control);
        console.log('   после Z:    ' + JSON.stringify(after));
        expect(after.checkbox, 'клавиша Z не переключила звук').toBe(!before.checkbox);
        expect(after.rowOn, 'строка «Звуки» отстала от чекбокса').toBe(after.checkbox);
        expect(after.rowAria, 'строка «Звуки» врёт вспомогательным технологиям')
            .toBe(String(after.checkbox));
        expect(after.stored, 'переключение не сохранилось').toBe(after.checkbox);

        // И обратно — тем же нажатием.
        await control.keyboard.press('KeyZ');
        await control.waitForTimeout(500);
        const back = await soundState(control);
        expect(back.checkbox, 'вторым нажатием звук не вернулся').toBe(before.checkbox);
        expect(back.rowOn).toBe(before.checkbox);
    } finally {
        await app.close();
    }
});

test('Z из окна виджета доезжает до панели', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        await waitForWidget(app);
        await control.waitForTimeout(2000);
        const widget = await findWidget(app);
        expect(widget, 'окно виджета не найдено').not.toBeNull();

        const before = await soundState(control);
        await widget.click('body', { position: { x: 5, y: 5 } }).catch(() => {});
        await widget.keyboard.press('KeyZ');
        await control.waitForTimeout(700);

        const after = await soundState(control);
        console.log(`   виджет: ${before.checkbox} → ${after.checkbox}`);
        expect(after.checkbox, 'нажатие в виджете не дошло до панели').toBe(!before.checkbox);
        expect(after.rowOn, 'строка «Звуки» отстала').toBe(after.checkbox);

        // Профиль общий: возвращаем как было.
        await widget.keyboard.press('KeyZ');
        await control.waitForTimeout(600);
        expect((await soundState(control)).checkbox).toBe(before.checkbox);
    } finally {
        await control.evaluate(() => window.ipcRenderer.send('close-widget')).catch(() => {});
        await control.waitForTimeout(400);
        await app.close();
    }
});

test('клик по тумблеру строки ведёт себя так же, как клавиша', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        const before = await soundState(control);
        await control.click('#soundMasterToggle');
        await control.waitForTimeout(500);
        const after = await soundState(control);
        expect(after.checkbox, 'клик по строке больше не переключает звук').toBe(!before.checkbox);
        expect(after.rowOn).toBe(after.checkbox);
        expect(after.stored, 'клик по строке не сохранил значение').toBe(after.checkbox);
        await control.click('#soundMasterToggle');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});
