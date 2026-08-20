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
        // Стиль возвращается ЗНАЧЕНИЕМ, а не кликом: кнопка живёт в ящике
        // настроек, и если он закрылся, клик ждёт видимости и молча падает по
        // таймауту (в `finally` это ещё и незаметно). Соседние спеки открывают
        // дисплей заново и берут стиль ИЗ ПРОФИЛЯ — оставленный «аналог»
        // показал бы им окно вообще без кольца.
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerStyle');
            if (el) { el.value = 'circle'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
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
        // Стиль возвращается ЗНАЧЕНИЕМ, а не кликом: кнопка живёт в ящике
        // настроек, и если он закрылся, клик ждёт видимости и молча падает по
        // таймауту (в `finally` это ещё и незаметно). Соседние спеки открывают
        // дисплей заново и берут стиль ИЗ ПРОФИЛЯ — оставленный «аналог»
        // показал бы им окно вообще без кольца.
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerStyle');
            if (el) { el.value = 'circle'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
        await app.close();
    }
});

/**
 * Отметка «этот вид сейчас на экране» — вычисляемая, а не память о клике.
 *
 * Просьба 20.08.2026: «сделай более явные кнопочки визуально для пресет
 * записан и пресет применен, сейчас не понятно какой активный». Состояний в
 * ячейке стало три, и здесь меряется главное свойство третьего: оно ГАСНЕТ,
 * когда вид разошёлся с записанным. Отметка, пережившая правку настройки,
 * хуже её отсутствия — она утверждает неправду о том, что на экране.
 */
test('ячейка помечается применённой и гаснет, когда вид разошёлся', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => localStorage.removeItem('uiPresets'));
        await control.reload();
        await control.waitForTimeout(1200);

        const marks = () => control.evaluate(() => {
            const out = {};
            for (let i = 1; i <= 4; i++) {
                const el = document.getElementById(`presetSlot${i}`);
                const cs = getComputedStyle(el);
                out[i] = {
                    filled: el.classList.contains('filled'),
                    active: el.classList.contains('active'),
                    pressed: el.getAttribute('aria-pressed'),
                    // ВЫЧИСЛЕННЫЕ заливка и цвет цифры, а не класс: класс можно
                    // поставить и не нарисовать ничего.
                    bg: cs.backgroundColor,
                    fg: cs.color,
                    dashed: cs.borderTopStyle
                };
            }
            out.caption = document.getElementById('presetCaption').textContent.trim();
            return out;
        });

        const empty = await marks();
        console.log(`   пусто: ${JSON.stringify(empty[1])}`);
        expect(empty[1].dashed, 'пустая ячейка не отличается контуром').toBe('dashed');
        expect(empty[1].active).toBe(false);

        await control.click('.wrow:has(#openDisplayBtn) .wrow-chevron');
        await control.waitForTimeout(700);
        await control.click('#displayTimerStyle button[data-val="flip"]');
        await control.waitForTimeout(700);

        // Запись = этот вид И ЕСТЬ то, что на экране.
        await control.click('#presetSlot1');
        await control.waitForTimeout(800);
        const saved = await marks();
        console.log(`   записан и применён: ${JSON.stringify(saved[1])}`);
        expect(saved[1].filled).toBe(true);
        expect(saved[1].active, 'только что записанный вид не помечен применённым').toBe(true);
        expect(saved[1].pressed).toBe('true');
        expect(saved[1].dashed, 'записанная ячейка осталась пунктирной').toBe('solid');
        // Применённая ЗАЛИТА, а не обведена: заливка обязана отличаться и от
        // пустой ячейки, и от просто записанной — иначе «какой выбран» опять
        // читается как оттенок рамки.
        expect(saved[1].bg, 'применённая ячейка не залита').not.toBe(empty[1].bg);
        expect(saved[1].bg, 'применённая залита так же, как пустая').not.toBe(saved[2].bg);
        expect(saved[1].fg, 'цифра применённой ячейки не сменила цвет').not.toBe(saved[2].fg);
        expect(saved.caption, 'подпись ряда не назвала ячейку').toContain('1');
        expect(saved[2].active, 'применённой оказалась и пустая ячейка').toBe(false);

        // Одна правка настройки — и на экране уже не пресет.
        await control.click('#displayTimerStyle button[data-val="analog"]');
        await control.waitForTimeout(900);
        const drifted = await marks();
        console.log(`   после правки: ${JSON.stringify(drifted[1])}`);
        expect(drifted[1].active, 'отметка пережила смену стиля — она врёт про экран').toBe(false);
        expect(drifted[1].filled, 'ячейка заодно перестала считаться записанной').toBe(true);
        expect(drifted[1].bg, 'заливка осталась акцентной').not.toBe(saved[1].bg);
        // И ряд ОТВЕЧАЕТ словом: вид настроен руками, ни одна ячейка не совпала.
        expect(drifted.caption, 'ряд молчит о том, что вид больше не из ячейки').toContain('свой');

        // Вернули кликом — отметка загорелась снова.
        await control.click('#presetSlot1');
        await control.waitForTimeout(1200);
        const back = await marks();
        console.log(`   после применения: ${JSON.stringify(back[1])}`);
        expect(back[1].active, 'применённый вид не помечен').toBe(true);
        expect(back[1].bg, 'заливка не вернулась').toBe(saved[1].bg);
        expect(back.caption).toContain('1');
    } finally {
        await control.evaluate(() => {
            localStorage.removeItem('uiPresets');
            const el = document.getElementById('displayTimerStyle');
            if (el) { el.value = 'circle'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
        await app.close();
    }
});

/**
 * Горит РОВНО ОДНА ячейка — даже когда снимки одинаковые.
 *
 * Жалоба 20.08.2026 повторилась трижды: «нет чёткого различия между пресет
 * записан и пресет применён». Замер объяснил: пользователь тыкает пустые ячейки
 * подряд, вид между кликами не меняется, снимки выходят одинаковыми — и все
 * записанные ячейки совпадают с профилем, то есть горят ВСЕ. Различие
 * существовало, но означало «этот вид на экране», а не «выбрана эта ячейка».
 *
 * Здесь меряется тот самый сценарий: три клика подряд и ЦВЕТ каждой ячейки.
 */
test('три ячейки подряд: применённой остаётся одна, остальные — записанные', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => {
            localStorage.removeItem('uiPresets');
            localStorage.removeItem('uiPresetActive');
        });
        await control.reload();
        await control.waitForTimeout(1200);

        for (const i of [1, 2, 3]) {
            await control.click(`#presetSlot${i}`);
            await control.waitForTimeout(600);
        }

        const row = await control.evaluate(() => {
            const out = { cells: {} };
            for (let i = 1; i <= 4; i++) {
                const el = document.getElementById(`presetSlot${i}`);
                out.cells[i] = { active: el.classList.contains('active'), bg: getComputedStyle(el).backgroundColor };
            }
            out.caption = document.getElementById('presetCaption').textContent.trim();
            return out;
        });
        console.log(`   ${JSON.stringify(row)}`);

        const lit = [1, 2, 3, 4].filter((i) => row.cells[i].active);
        expect(lit, 'применённой должна быть ровно одна ячейка').toEqual([3]);
        // И это видно ЦВЕТОМ, а не только классом.
        expect(row.cells[1].bg, 'записанная залита как применённая').not.toBe(row.cells[3].bg);
        expect(row.cells[2].bg).toBe(row.cells[1].bg);
        expect(row.caption).toContain('3');

        // Клик по записанной переносит отметку на неё.
        await control.click('#presetSlot1');
        await control.waitForTimeout(1200);
        const after = await control.evaluate(() => [1, 2, 3, 4]
            .filter((i) => document.getElementById(`presetSlot${i}`).classList.contains('active')));
        expect(after, 'применение не перенесло отметку').toEqual([1]);
    } finally {
        await control.evaluate(() => {
            localStorage.removeItem('uiPresets');
            localStorage.removeItem('uiPresetActive');
        }).catch(() => {});
        await app.close();
    }
});
