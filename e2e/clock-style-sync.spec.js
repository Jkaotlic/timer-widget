const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const { waitForClock, waitForClockGone, findWindowBy, reloadPanel, waitForQuiet } = require('./window-ready');
const { installClockStyleProbe, clockSends } = require('./clock-style-probe');

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

/*
 * Пауз после кликов в этой спеке нет, и это не допущение: всё, что она меряет
 * в ПАНЕЛИ, обработчики пишут синхронно. Клик по сегменту — `apply` + событие
 * `change` (_attachSegmented), обработчики `change` у #timerStyle, #clockStyle
 * и #syncClockStyle (control-app.js) меняют контролы и зовут saveExtSettings
 * без таймеров. Когда `evaluate`/`click` вернулись, состояние уже записано.
 * Ждать приходится только окна и ящик — их и ждём условием.
 */

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
    // Видимость меряется offsetParent — ящик обязан быть открыт и доехать.
    await control.waitForSelector('#settingsDrawer.open');
    await waitForQuiet(control);

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
        document.querySelector('#clockStyle button[data-val="digits"]').click();
    });
    const off = await readState(control);
    console.log('sync выкл →', JSON.stringify(off));
    expect(off.syncChecked).toBe(false);
    expect(off.pickerVisible, 'без синхронизации стиль часов выбирается вручную').toBe(true);
    expect(off.clockValue).toBe('digits');

    // --- Синхронизация ВКЛючена: выбор остаётся ВИДНЫМ и берёт стиль виджета ---
    await setSync(control, true);
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
    const moved = await readState(control);
    console.log('виджет→флип при sync вкл →', JSON.stringify(moved));
    expect(moved.syncChecked, 'смена стиля виджета не выключает синхронизацию').toBe(true);
    expect(moved.clockValue, 'переключатель часов обязан догнать виджет').toBe('flip');
    expect(moved.storedClockStyle, 'и в хранилище то же значение').toBe('flip');

    // --- Клик по стилю часов означает «хочу свой» и снимает синхронизацию ---
    await control.click('#clockStyle button[data-val="analog"]');
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

    const saved = await control.evaluate(
        () => JSON.parse(localStorage.getItem('displayExtSettings') || '{}').syncClockStyle
    );
    expect(saved, 'syncClockStyle обязан сохраниться как true').toBe(true);

    // Контроллер новой страницы встал и стартовая рассылка ушла: loadSettings
    // (а с ней и прежний ложный 'change') — в конструкторе, до этого места.
    await reloadPanel(control);

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

    // Клик по варианту «Флип» в переключателе стиля ВИДЖЕТА.
    await control.evaluate(() => {
        document.querySelector('#timerStyle button[data-val="flip"]').click();
    });

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
        await waitForClock(app);

        await control.evaluate(() => {
            const el = document.getElementById('syncClockStyle');
            el.checked = true;
            el.dispatchEvent(new Event('change'));
        });

        await control.evaluate(() => {
            document.querySelector('#timerStyle button[data-val="analog"]').click();
        });

        // Подпись — отчёт: обновляется на записи настроек (синхронно), опрос —
        // на случай перерисовки строк по состоянию окна часов.
        const subClock = () => control.evaluate(() => document.getElementById('subClock').textContent);
        await expect.poll(subClock, { message: 'часы показывают стиль виджета — так и надо писать' })
            .toContain('аналог');
        console.log('подписи при синхронизации →', JSON.stringify({
            clock: await subClock(),
            widget: await control.evaluate(() => document.getElementById('subWidget').textContent)
        }));
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
        await waitForClockGone(app);
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

/**
 * У `clockWidgetSettings` один писатель — панель (спека 29.10.2026, п. 3).
 *
 * Стиль часов попадал в этот ключ только из САМОГО окна часов: панель слала
 * стиль по IPC, окно его применяло и записывало. Закрытые часы ничего не
 * получали и не писали — профиль хранил прежний стиль, и окно, открытое после
 * перезапуска, читало на старте именно его. Сценарий поэтому — при ЗАКРЫТЫХ
 * часах: при открытых старая схема случайно работала.
 *
 * Проверяется и профиль (то, что часы читают при своём старте, до любой
 * досылки), и само окно после перезапуска.
 */
const CLOCK_PROBE = () => !!document.getElementById('clockGradient');

async function closeClockIfOpen(app, control) {
    if (!(await findWindowBy(app, CLOCK_PROBE))) { return; }
    await control.evaluate(() => window.ipcRenderer.send('close-clock-widget'));
    await expect.poll(async () => !!(await findWindowBy(app, CLOCK_PROBE)), { message: 'часы не закрылись' })
        .toBe(false);
}

const readClockStored = (control) => control.evaluate(
    () => JSON.parse(localStorage.getItem('clockWidgetSettings') || '{}')
);

test('стиль и шрифт часов, выбранные при закрытых часах, переживают перезапуск', async () => {
    let app1;
    try {
        // Настройка нужна во ВТОРОМ запуске: сторож профиля вернёт её только
        // на последнем закрытии теста.
        const first = await launchApp({ keepProfile: true });
        app1 = first.app;
        const control = first.control;
        await closeClockIfOpen(app1, control);
        await setSync(control, false);
        await control.click('.tab-btn[data-tab="clock"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#clockStyle button[data-val="digits"]');
        await expect(control.locator('#clockDigitsFontRow')).toBeVisible();
        await control.click('#clockDigitsFont .font-option[data-val="oswald"]');

        // Окна часов нет — записать мог только панель.
        expect(await findWindowBy(app1, CLOCK_PROBE), 'часы обязаны быть закрыты').toBeNull();
        await expect.poll(() => readClockStored(control).then((s) => s.clockStyle),
            { message: 'панель обязана записать стиль часов в clockWidgetSettings' }).toBe('digits');
        await expect.poll(() => readClockStored(control).then((s) => s.clockDigitsFont),
            { message: 'панель обязана записать шрифт часов в clockWidgetSettings' }).toBe('oswald');
    } finally {
        if (app1) { await app1.close(); }
    }

    const { app, control } = await launchApp();
    try {
        const stored = await readClockStored(control);
        console.log('clockWidgetSettings после перезапуска →', JSON.stringify(stored));
        expect(stored.clockStyle, 'часы на старте читают этот стиль').toBe('digits');
        expect(stored.clockDigitsFont, 'и этот шрифт').toBe('oswald');

        await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
        const clock = await waitForClock(app);
        await expect.poll(() => clock.evaluate(() => document.body.classList.contains('style-digits')),
            { message: 'часы открылись не в выбранном стиле' }).toBe(true);
        await expect.poll(() => clock.evaluate(() => document.getElementById('clockDigitsTime').style.fontFamily),
            { message: 'часы открылись не в выбранном шрифте' }).toContain('Oswald');
    } finally {
        await closeClockIfOpen(app, control).catch(() => {});
        await app.close();
    }
});

test('под синхронизацией панель пишет часам стиль виджета и при закрытых часах', async () => {
    const { app, control } = await launchApp();
    try {
        await closeClockIfOpen(app, control);
        await setSync(control, true);
        await control.evaluate(() => {
            document.querySelector('#timerStyle button[data-val="analog"]').click();
        });
        await expect.poll(() => readClockStored(control).then((s) => s.clockStyle),
            { message: 'смена стиля виджета под синхронизацией обязана дойти до clockWidgetSettings' })
            .toBe('analog');

        // Сняли синхронизацию — часы возвращаются к СВОЕМУ стилю, и профиль тоже.
        await setSync(control, false);
        await control.click('.tab-btn[data-tab="clock"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#clockStyle button[data-val="flip"]');
        await expect.poll(() => readClockStored(control).then((s) => s.clockStyle),
            { message: 'свой выбор стиля часов обязан дойти до clockWidgetSettings' }).toBe('flip');
    } finally {
        await control.evaluate(() => {
            const el = document.getElementById('syncClockStyle');
            el.checked = false;
            el.dispatchEvent(new Event('change'));
            document.querySelector('#timerStyle button[data-val="circle"]').click();
            document.querySelector('#clockStyle button[data-val="circle"]').click();
        }).catch(() => {});
        // Ждём УСЛОВИЕМ, что возврат дошёл до профиля, а не паузой.
        await expect.poll(() => readClockStored(control).then((s) => s.clockStyle),
            { message: 'возврат стиля часов не дошёл до профиля' }).toBe('circle')
            .catch(() => {});
        await app.close();
    }
});

/**
 * Стиль часов — ОДИН канал, и main его помнит (29.10.2026).
 *
 * До этого окно часов, открытое позже, получало стиль снимком из настроек
 * ДИСПЛЕЯ (`clockStyle` в `display-settings-update`), а смена стиля часов эту
 * посылку не пересобирала: в памяти main лежал стиль с момента последней
 * правки дисплея. Часы открывались в выбранном стиле из профиля — и тут же
 * перекрашивались устаревшим снимком. Открытие — каналом, а не кнопкой: кнопка
 * панели через 500 мс досылает стиль сама и закрыла бы дефект.
 */
test('часы, открытые после смены стиля при закрытых часах, получают стиль снимком main', async () => {
    const { app, control } = await launchApp();
    try {
        await closeClockIfOpen(app, control);
        await installClockStyleProbe(app);
        await setSync(control, false);
        await control.click('.tab-btn[data-tab="clock"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#clockStyle button[data-val="flip"]');
        await expect.poll(() => readClockStored(control).then((s) => s.clockStyle)).toBe('flip');

        await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
        const clock = await waitForClock(app);
        await expect.poll(() => clockSends(app).then((r) => r.sends.map((s) => s.channel)),
            { message: 'main не дослал часам стиль при открытии' }).toContain('set-clock-style');
        const { sends } = await clockSends(app);
        console.log('   посылки часам:', JSON.stringify(sends));
        expect(sends.filter((s) => s.channel === 'set-clock-style').map((s) => s.payload)).toEqual(['flip']);
        expect(sends.filter((s) => s.channel === 'display-settings-update'),
            'настройки дисплея часам не шлются — второй дороги стиля нет').toEqual([]);
        await expect.poll(() => clock.evaluate(() => document.body.className),
            { message: 'часы открылись не в выбранном стиле' }).toContain('style-flip');
    } finally {
        await closeClockIfOpen(app, control).catch(() => {});
        await control.evaluate(() => {
            document.querySelector('#clockStyle button[data-val="circle"]').click();
        }).catch(() => {});
        await expect.poll(() => readClockStored(control).then((s) => s.clockStyle),
            { message: 'возврат стиля часов не дошёл до профиля' }).toBe('circle')
            .catch(() => {});
        await app.close();
    }
});
