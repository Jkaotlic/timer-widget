const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const { waitForWidget, waitForWidgetGone, untilReceived } = require('./window-ready');

/**
 * Клавиша `Z` переключает звук — ПО НАЖАТИЮ, из панели и из чужого окна.
 *
 * Проверяется не только сама клавиша, но и то, ради чего она потребовала
 * правки: у мастер-звука было ДВА владельца — чекбокс в ящике настроек и
 * тумблер строки «Звуки», которые не сообщались. Поэтому после каждого нажатия
 * сверяются ОБА вида: чекбокс (он же сохраняемое значение) и тумблер строки.
 */

const soundState = (control) => control.evaluate(() => {
    const box = document.getElementById('soundMasterEnabled');
    const row = document.getElementById('soundMasterToggle');
    return {
        checkbox: !!box.checked,
        rowOn: row.classList.contains('active'),
        rowAria: row.getAttribute('aria-checked'),
        stored: JSON.parse(localStorage.getItem('displayExtSettings') || '{}').soundMasterEnabled
    };
});

test('Z переключает звук из панели, и оба вида согласны друг с другом', async () => {
    const { app, control } = await launchApp();
    try {
        const before = await soundState(control);
        console.log('   до нажатия: ' + JSON.stringify(before));
        expect(before.rowOn, 'строка «Звуки» показывает не то, что чекбокс').toBe(before.checkbox);

        await control.click('.control-panel');
        // Клавиша в панели переключает СИНХРОННО (keydown → toggleSoundMaster →
        // change → сохранение): ждать нечего, кроме самого значения.
        await control.keyboard.press('KeyZ');
        await expect.poll(async () => (await soundState(control)).checkbox,
            'клавиша Z не переключила звук').toBe(!before.checkbox);

        const after = await soundState(control);
        console.log('   после Z:    ' + JSON.stringify(after));
        expect(after.checkbox, 'клавиша Z не переключила звук').toBe(!before.checkbox);
        expect(after.rowOn, 'строка «Звуки» отстала от чекбокса').toBe(after.checkbox);
        expect(after.rowAria, 'строка «Звуки» врёт вспомогательным технологиям')
            .toBe(String(after.checkbox));
        expect(after.stored, 'переключение не сохранилось').toBe(after.checkbox);

        // И обратно — тем же нажатием.
        await control.keyboard.press('KeyZ');
        await expect.poll(async () => (await soundState(control)).checkbox,
            'вторым нажатием звук не вернулся').toBe(before.checkbox);
        const back = await soundState(control);
        expect(back.checkbox, 'вторым нажатием звук не вернулся').toBe(before.checkbox);
        expect(back.rowOn).toBe(before.checkbox);
    } finally {
        await app.close();
    }
});

test('Z из окна виджета доезжает до панели', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        const widget = await waitForWidget(app);
        // Обработчик клавиш виджет ставит в конструкторе — `load` достаточно
        // (раньше пауза 2000 мс).
        await widget.waitForLoadState('load');

        const before = await soundState(control);
        await widget.click('body', { position: { x: 5, y: 5 } }).catch(() => {});
        // Нажатие в виджете → `sound-toggle` в main → панели; панель
        // переключает в обработчике этой посылки (panel-state.js), и её
        // дождались — раньше пауза 700 мс. Не пришла — ожидание упадёт с именем
        // канала: «нажатие не дошло до панели».
        await untilReceived(control, 'sound-toggle', () => widget.keyboard.press('KeyZ'));

        const after = await soundState(control);
        console.log(`   виджет: ${before.checkbox} → ${after.checkbox}`);
        expect(after.checkbox, 'нажатие в виджете не дошло до панели').toBe(!before.checkbox);
        expect(after.rowOn, 'строка «Звуки» отстала').toBe(after.checkbox);

        // Профиль общий: возвращаем как было.
        await untilReceived(control, 'sound-toggle', () => widget.keyboard.press('KeyZ'));
        expect((await soundState(control)).checkbox).toBe(before.checkbox);
    } finally {
        await control.evaluate(() => window.ipcRenderer.send('close-widget')).catch(() => {});
        await waitForWidgetGone(app).catch(() => {});
        await app.close();
    }
});

test('клик по тумблеру строки ведёт себя так же, как клавиша', async () => {
    const { app, control } = await launchApp();
    try {
        const before = await soundState(control);
        // Клик переключает синхронно (тот же toggleSoundMaster) — ждётся значение.
        await control.click('#soundMasterToggle');
        await expect.poll(async () => (await soundState(control)).checkbox,
            'клик по строке больше не переключает звук').toBe(!before.checkbox);
        const after = await soundState(control);
        expect(after.checkbox, 'клик по строке больше не переключает звук').toBe(!before.checkbox);
        expect(after.rowOn).toBe(after.checkbox);
        expect(after.stored, 'клик по строке не сохранил значение').toBe(after.checkbox);
        await control.click('#soundMasterToggle');
        await expect.poll(async () => (await soundState(control)).stored,
            'обратный клик не вернул сохранённое значение').toBe(before.checkbox);
    } finally {
        await app.close();
    }
});

test('подпись строки «Звуки» — отчёт о включённых сигналах, по клику в ящике', async () => {
    // До 03.11.2026 подпись была текстом разметки «сигналы старта, минуты и
    // финиша» при умолчании «только окончание». Проверка — ПО КЛИКУ: чистая
    // функция в unit-тесте не доказывает, что её зовут на записи настроек.
    const { app, control } = await launchApp();
    const sub = () => control.locator('#subSound');
    const flip = (id) => control.evaluate((i) => {
        const el = document.getElementById(i);
        el.checked = !el.checked;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, id);
    try {
        await expect(sub(), 'чистый профиль: звучит только окончание').toHaveText('окончание');
        await flip('soundOverrunEnabled');
        await expect(sub(), 'включённый перерасход не попал в подпись').toHaveText('окончание · перерасход');
        await control.click('#soundMasterToggle');
        await expect(sub(), 'мастер выключен, а подпись перечисляет сигналы').toHaveText('звук выключен');
        // Профиль e2e общий: возвращаем оба значения.
        await control.click('#soundMasterToggle');
        await flip('soundOverrunEnabled');
        await expect(sub()).toHaveText('окончание');
    } finally {
        await app.close();
    }
});
