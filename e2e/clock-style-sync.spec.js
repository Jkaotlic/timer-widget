const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Синхронизация стиля часов со стилем виджета: переключатель ЗЕРКАЛИТ виджет.
 *
 * До 13.08.2026 панель прятала строку выбора стиля часов, пока синхронизация
 * включена. Прятать её придумали от противоречия: переключатель показывал
 * СОБСТВЕННЫЙ выбор пользователя, часы в это время рисовали стиль виджета, и
 * два контрола говорили разное. Спрятать — значит убрать противоречие вместе с
 * ответом на вопрос «почему часы поехали за виджетом»: единственное место, где
 * стиль часов виден, исчезало ровно тогда, когда он менялся не по воле
 * пользователя. Так дефект и пришёл от пользователя — «меняю стиль, а меняются
 * оба окна, и в настройках стиль не тот».
 *
 * Теперь противоречия нет по-другому: при включённой синхронизации
 * переключатель показывает ДЕЙСТВУЮЩИЙ стиль (то есть стиль виджета), а клик по
 * нему означает «хочу свой» и снимает синхронизацию — этот обработчик был здесь
 * и раньше. Скрытых состояний не осталось ни одного.
 *
 * Видимость меряется через offsetParent: он null у элемента, спрятанного через
 * display:none в любом из родителей, — то есть меряем ровно то, что видит глаз,
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
            syncChecked: document.getElementById('syncClockStyle').checked,
            clockValue: picker ? picker.value : null,
            widgetValue: document.getElementById('timerStyle').value,
            storedClockStyle: JSON.parse(localStorage.getItem('displayExtSettings') || '{}').clockStyle
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

test('строка «Стиль часов» видна всегда и под синхронизацией показывает виджет', async () => {
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
        '#clockStyleRow обязан содержать сам переключатель #clockStyle'
    ).toBe(true);

    // --- Синхронизация ВЫКЛючена: выбор стиля часов доступен ---
    await setSync(control, false);
    await control.evaluate(() => {
        document.querySelector('#clockStyle button[data-val="digital"]').click();
    });
    await control.waitForTimeout(400);
    const off = await readState(control);
    console.log('sync выкл →', JSON.stringify(off));
    expect(off.syncChecked).toBe(false);
    expect(off.pickerVisible, 'без синхронизации стиль часов выбирается вручную').toBe(true);
    expect(off.clockValue).toBe('digital');

    // --- Синхронизация ВКЛючена: выбор остаётся ВИДНЫМ и берёт стиль виджета ---
    await setSync(control, true);
    await control.waitForTimeout(400);
    const on = await readState(control);
    console.log('sync вкл →', JSON.stringify(on));
    expect(on.syncChecked).toBe(true);
    expect(
        on.pickerVisible,
        'переключатель — единственное место, где виден стиль часов: прятать его нельзя'
    ).toBe(true);
    expect(on.clockValue, 'под синхронизацией показывается стиль ВИДЖЕТА').toBe(on.widgetValue);

    // --- Смена стиля виджета при включённой синхронизации тянет переключатель ---
    await control.evaluate(() => {
        document.querySelector('#timerStyle button[data-val="flip"]').click();
    });
    await control.waitForTimeout(600);
    const moved = await readState(control);
    console.log('виджет→флип при sync вкл →', JSON.stringify(moved));
    expect(moved.syncChecked, 'смена стиля виджета не выключает синхронизацию').toBe(true);
    expect(moved.clockValue, 'переключатель часов обязан догнать виджет').toBe('flip');
    expect(moved.storedClockStyle, 'и в хранилище то же значение').toBe('flip');

    // --- Клик по стилю часов означает «хочу свой» и снимает синхронизацию ---
    await control.click('#clockStyle button[data-val="analog"]');
    await control.waitForTimeout(500);
    const own = await readState(control);
    console.log('клик по стилю часов →', JSON.stringify(own));
    expect(own.syncChecked, 'явный выбор стиля часов снимает синхронизацию').toBe(false);
    expect(own.clockValue).toBe('analog');
    expect(own.widgetValue, 'и НЕ трогает виджет').toBe('flip');

    // Убираем за собой: профиль общий на весь прогон.
    await control.evaluate(() => {
        document.querySelector('#timerStyle button[data-val="circle"]').click();
        document.querySelector('#clockStyle button[data-val="circle"]').click();
    });
    await control.waitForTimeout(400);
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

    // Раньше здесь стояло замечание, что res.clock намеренно остаётся прежним:
    // панель слала часам timerStyleEl.value напрямую, а переключатель часов не
    // трогала — «выключил синхронизацию, вернулся к своему выбору». Пока строка
    // была скрыта, это выглядело безобидно. На деле панель хранила стиль, которого
    // на экране нет, и подпись строки «Часы» этим стилем и отчитывалась.
    // Теперь переключатель зеркалит виджет: показанное значение всегда равно
    // тому, что рисуют часы.
    expect(res.clock, 'переключатель часов обязан показывать действующий стиль').toBe('flip');

    await control.evaluate(() => {
        const el = document.getElementById('syncClockStyle');
        el.checked = false;
        el.dispatchEvent(new Event('change'));
    });
    await control.waitForTimeout(400);
    await app.close();
});

/**
 * При включённой синхронизации панель обязана ОТЧИТЫВАТЬСЯ о том, что на
 * экране, а не о том, что лежит в скрытом переключателе.
 *
 * Собственный выбор стиля часов синхронизация намеренно не переписывает (см.
 * тест выше: выключил — вернулся к своему). Но подпись строки «Часы» читала
 * ИМЕННО этот скрытый переключатель, и при включённой синхронизации честно
 * сообщала «показан · круг» о часах, которые в этот момент аналоговые.
 * Подпись — единственное место в панели, где виден стиль часов, пока строка
 * выбора спрятана, и врать ей нельзя.
 */
test('при синхронизации подпись строки «Часы» показывает стиль виджета', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('#openClockBtn');
        await control.waitForTimeout(1600);

        await control.evaluate(() => {
            const el = document.getElementById('syncClockStyle');
            el.checked = true;
            el.dispatchEvent(new Event('change'));
        });
        await control.waitForTimeout(500);

        await control.evaluate(() => {
            document.querySelector('#timerStyle button[data-val="analog"]').click();
        });
        await control.waitForTimeout(700);

        const subs = await control.evaluate(() => ({
            clock: document.getElementById('subClock').textContent,
            widget: document.getElementById('subWidget').textContent
        }));
        console.log('подписи при синхронизации →', JSON.stringify(subs));
        expect(subs.clock, 'часы показывают стиль виджета — так и надо писать').toContain('аналог');
    } finally {
        // Профиль e2e общий на весь прогон: тест, оставивший синхронизацию
        // включённой, прячет строку выбора стиля и роняет чужие спеки —
        // ровно так этот файл однажды и сделал.
        await control.evaluate(() => {
            const el = document.getElementById('syncClockStyle');
            el.checked = false;
            el.dispatchEvent(new Event('change'));
            document.querySelector('#timerStyle button[data-val="circle"]').click();
            const clockBtn = document.getElementById('openClockBtn');
            if (clockBtn && clockBtn.classList.contains('active')) { clockBtn.click(); }
        });
        await control.waitForTimeout(800);
        await app.close();
    }
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
