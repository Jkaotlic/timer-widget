const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Синхронизация стиля часов со стилем виджета скрывает выбор стиля часов.
 *
 * Дефект: панель прятала `#clockStyleRow`, но этот id висел на ПУСТОМ div внутри
 * скрытого блока «Hidden elements: removed from UI but needed by JS». Настоящая
 * строка с переключателем `#clockStyle` жила в другом месте и не скрывалась
 * никогда. Пользователь ставил галочку «синхронизировать со стилем виджета» и
 * продолжал видеть активный выбор стиля часов — а клик по нему молча снимал ту
 * же галочку (обработчик clockStyleEl выключает syncClockStyle). Два контрола
 * противоречили друг другу.
 *
 * Проверяем видимость через offsetParent: он null у элемента, спрятанного через
 * display:none в любом из родителей, — то есть измеряем ровно то, что видит глаз,
 * а не наличие класса.
 */

async function readState(control) {
    return control.evaluate(() => {
        const row = document.getElementById('clockStyleRow');
        const picker = document.getElementById('clockStyle');
        return {
            rowExists: !!row,
            // Строка обязана СОДЕРЖАТЬ сам переключатель, иначе прячется не то.
            rowContainsPicker: !!(row && picker && row.contains(picker)),
            rowVisible: !!(row && row.offsetParent !== null),
            pickerVisible: !!(picker && picker.offsetParent !== null),
            syncChecked: document.getElementById('syncClockStyle').checked
        };
    });
}

async function setSync(control, on) {
    await control.evaluate((v) => {
        const el = document.getElementById('syncClockStyle');
        if (el.checked !== v) {
            el.checked = v;
            el.dispatchEvent(new Event('change'));
        }
    }, on);
}

test('строка «Стиль часов» прячется при включённой синхронизации', async () => {
    const { app, control } = await launchApp();

    // Настройки живут в выезжающем ящике — откроем вкладку «Часы».
    await control.evaluate(() => {
        document.querySelector('.tab-btn[data-tab="clock"]').click();
    });
    await control.waitForTimeout(800);

    const base = await readState(control);
    console.log('исходно →', JSON.stringify(base));

    expect(base.rowExists, '#clockStyleRow должен существовать').toBe(true);
    expect(
        base.rowContainsPicker,
        '#clockStyleRow обязан содержать сам переключатель #clockStyle — иначе прячется пустышка'
    ).toBe(true);

    // --- Синхронизация ВЫКЛючена: выбор стиля часов доступен ---
    await setSync(control, false);
    await control.waitForTimeout(400);
    const off = await readState(control);
    console.log('sync выкл →', JSON.stringify(off));
    expect(off.syncChecked).toBe(false);
    expect(off.pickerVisible, 'без синхронизации стиль часов выбирается вручную').toBe(true);

    // --- Синхронизация ВКЛючена: выбор обязан исчезнуть ---
    await setSync(control, true);
    await control.waitForTimeout(400);
    const on = await readState(control);
    console.log('sync вкл →', JSON.stringify(on));
    expect(on.syncChecked).toBe(true);
    expect(
        on.pickerVisible,
        'при синхронизации выбор стиля часов обязан скрыться: иначе он противоречит галочке'
    ).toBe(false);

    // --- И вернуться при выключении ---
    await setSync(control, false);
    await control.waitForTimeout(400);
    const back = await readState(control);
    expect(back.pickerVisible, 'после выключения синхронизации выбор возвращается').toBe(true);

    await app.close();
});

test('включённая синхронизация переживает перезагрузку панели', async () => {
    // Вторая половина того же дефекта, и более разрушительная: loadSettings
    // восстанавливала clockStyleEl.value, сеттер слал 'change', обработчик
    // трактовал это как ручной выбор и гасил синхронизацию. То есть сохранённое
    // «включено» уничтожалось на старте — галочку нельзя было включить НАСОВСЕМ.
    const { app, control } = await launchApp();

    await control.evaluate(() => {
        const el = document.getElementById('syncClockStyle');
        el.checked = true;
        el.dispatchEvent(new Event('change'));
    });
    await control.waitForTimeout(600);

    const saved = await control.evaluate(
        () => JSON.parse(localStorage.getItem('displayExtSettings') || '{}').syncClockStyle
    );
    expect(saved, 'syncClockStyle обязан сохраниться как true').toBe(true);

    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(1500);

    const after = await control.evaluate(() => ({
        checked: document.getElementById('syncClockStyle').checked,
        stored: JSON.parse(localStorage.getItem('displayExtSettings') || '{}').syncClockStyle
    }));
    console.log('после перезагрузки →', JSON.stringify(after));

    expect(after.checked, 'галочка обязана остаться включённой после перезагрузки').toBe(true);
    expect(after.stored, 'и в хранилище тоже').toBe(true);

    // Убираем за собой: localStorage общий для прогонов.
    await control.evaluate(() => {
        const el = document.getElementById('syncClockStyle');
        el.checked = false;
        el.dispatchEvent(new Event('change'));
    });
    await control.waitForTimeout(400);
    await app.close();
});

test('при синхронизации стиль часов идёт за стилем виджета', async () => {
    // Смысл функции целиком: сменил стиль виджета — часы поехали за ним.
    const { app, control } = await launchApp();

    await control.evaluate(() => {
        const el = document.getElementById('syncClockStyle');
        el.checked = true;
        el.dispatchEvent(new Event('change'));
    });
    await control.waitForTimeout(500);

    // Клик по варианту «Флип» в переключателе стиля ВИДЖЕТА.
    await control.evaluate(() => {
        document.querySelector('#timerStyle button[data-val="flip"]').click();
    });
    await control.waitForTimeout(600);

    const res = await control.evaluate(() => ({
        widget: document.getElementById('timerStyle').value,
        clock: document.getElementById('clockStyle').value,
        syncStillOn: document.getElementById('syncClockStyle').checked
    }));
    console.log('после смены стиля виджета →', JSON.stringify(res));

    expect(res.widget).toBe('flip');
    expect(res.syncStillOn, 'смена стиля ВИДЖЕТА не должна выключать синхронизацию').toBe(true);

    // Замечание, а не дефект: res.clock остаётся прежним ('circle'). При включённой
    // синхронизации панель шлёт часам timerStyleEl.value напрямую (и в
    // clock-widget-set-style, и в pushDisplaySettings), а значение собственного
    // переключателя часов не переписывает — строка всё равно скрыта. Смысл такой:
    // выключил синхронизацию — вернулся к СВОЕМУ выбору, а не остался на чужом.
    // Поэтому здесь ничего не утверждаем про res.clock намеренно.

    await control.evaluate(() => {
        const el = document.getElementById('syncClockStyle');
        el.checked = false;
        el.dispatchEvent(new Event('change'));
    });
    await control.waitForTimeout(400);
    await app.close();
});

test('переключатели стилей объявляют выбранное значение в ARIA', async () => {
    // Раньше контейнеры были role="tablist" с обычными кнопками внутри:
    // структура невалидная (в tablist обязаны быть role="tab"), и состояние
    // выбора жило только в CSS-классе .active — скринридер видел группу
    // одинаковых кнопок без признака выбранной.
    const { app, control } = await launchApp();

    const res = await control.evaluate(() => {
        const out = {};
        for (const id of ['timerStyle', 'clockStyle', 'displayTimerStyle']) {
            const group = document.getElementById(id);
            if (!group) { continue; }
            const buttons = [...group.querySelectorAll('button')];
            out[id] = {
                groupRole: group.getAttribute('role'),
                roles: [...new Set(buttons.map((b) => b.getAttribute('role')))],
                checked: buttons.filter((b) => b.getAttribute('aria-checked') === 'true').length,
                activeClass: buttons.filter((b) => b.classList.contains('active')).length
            };
        }
        return out;
    });
    console.log(JSON.stringify(res, null, 1));

    for (const [id, g] of Object.entries(res)) {
        expect(g.groupRole, `${id}: группа выбора — не список вкладок`).toBe('radiogroup');
        expect(g.roles, `${id}: потомки radiogroup обязаны быть radio`).toEqual(['radio']);
        expect(g.checked, `${id}: ровно один вариант помечен aria-checked`).toBe(1);
        expect(g.checked, `${id}: ARIA и класс .active обязаны совпадать`).toBe(g.activeClass);
    }

    await app.close();
});
