const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const CONFIG = require('../constants.js');

/**
 * Режим полосы: окно действительно сжимается, полоса действительно управляет.
 *
 * Меряется НАСТОЯЩИЙ BrowserWindow, а не класс на body: класс можно поставить,
 * а окно оставить панелью — и получилось бы худшее из состояний, полоса на
 * фоне пустоты в полный рост. Так же меряется и возврат: прежние размер и
 * позиция обязаны вернуться, иначе разворот теряет геометрию, которую
 * пользователь настроил руками.
 */
test('окно сжимается в полосу и разворачивается обратно в прежние границы', async () => {
    const { app, control } = await launchApp();
    try {
        const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());

        await control.click('#miniBarToggle');
        await control.waitForTimeout(700);

        const collapsed = await app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()[0];
            return { bounds: w.getBounds(), onTop: w.isAlwaysOnTop() };
        });

        expect(collapsed.bounds.height, `высота окна ${collapsed.bounds.height}`).toBeLessThanOrEqual(60);
        // Ширину задаёт СОДЕРЖИМОЕ полосы: с 20.08.2026 в ней ещё четыре ячейки
        // вида и замок, и на 400px набор не помещается. Правило — ПОЛ: окно
        // шире пола сворачивается со своей шириной.
        expect(collapsed.bounds.width, `ширина полосы ${collapsed.bounds.width}`)
            .toBe(Math.max(before.width, CONFIG.CONTROL_BAR_MIN_WIDTH));
        expect(collapsed.bounds.y, 'держим ВЕРХНИЙ край').toBe(before.y);
        expect(collapsed.onTop, 'полоса обязана быть поверх окон').toBe(true);

        // Полоса видна, а панель — нет.
        const seen = await control.evaluate(() => ({
            bar: document.getElementById('miniBar').getBoundingClientRect().height,
            hero: document.querySelector('.hero').getBoundingClientRect().height
        }));
        expect(seen.bar).toBeGreaterThan(40);
        expect(seen.hero).toBe(0);

        await control.click('#miniBarExpand');
        await control.waitForTimeout(700);

        const restored = await app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()[0];
            return { bounds: w.getBounds(), onTop: w.isAlwaysOnTop() };
        });
        expect(restored.bounds).toEqual(before);
        expect(restored.onTop).toBe(false);
    } finally {
        await app.close();
    }
});

test('полоса показывает то же время, что и панель, и управляет таймером', async () => {
    const { app, control } = await launchApp();
    try {
        // Время нужно задать ДО сворачивания: редизайн 2026-08-12 показывает в
        // полосе одно действие из двух по состоянию таймера, и без пресета
        // «Старт» не переводит панель в отсчёт — «Паузы» не появится вовсе.
        await control.click('.preset[data-minutes="5"]');
        await control.waitForTimeout(300);

        await control.click('#miniBarToggle');
        await control.waitForTimeout(600);

        await control.click('#miniBarStart');
        await control.waitForTimeout(2200);

        const running = await control.evaluate(() => ({
            bar: document.getElementById('miniBarTime').textContent.trim(),
            hero: document.getElementById('controlTimeDigits').textContent.trim(),
            dot: document.getElementById('miniBarDot').className
        }));
        // Одно время на два места: своего источника у полосы нет.
        expect(running.bar).toBe(running.hero);
        expect(running.dot).toContain('ok');

        await control.click('#miniBarPause');
        await control.waitForTimeout(700);
        const paused = await control.evaluate(() => document.getElementById('miniBarTime').textContent.trim());
        await control.waitForTimeout(1500);
        const stillPaused = await control.evaluate(() => document.getElementById('miniBarTime').textContent.trim());
        expect(stillPaused, 'после паузы время не должно идти').toBe(paused);

        await control.click('#miniBarReset');
        await control.waitForTimeout(700);
        const afterReset = await control.evaluate(() => ({
            bar: document.getElementById('miniBarTime').textContent.trim(),
            hero: document.getElementById('controlTimeDigits').textContent.trim()
        }));
        expect(afterReset.bar).toBe(afterReset.hero);

        // Профиль e2e общий: возвращаем окно в развёрнутое состояние.
        await control.click('#miniBarExpand');
        await control.waitForTimeout(500);
    } finally {
        await app.close();
    }
});

/**
 * В паузе полоса обязана предлагать ПРОДОЛЖИТЬ.
 *
 * Действие в полосе выбиралось классом состояния, а пауза класса не имела:
 * `state-running` стоял и на идущем таймере, и на остановленном, поэтому в
 * паузе на экране висело слово «Пауза» — нажатие по нему ставило паузу ещё
 * раз, то есть не делало ничего. Со стороны это и выглядит как «свернул окно,
 * и оно пишет пауза и перестало слушаться».
 */
test('в паузе полоса предлагает продолжить, и это работает', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.preset[data-minutes="5"]');
        await control.waitForTimeout(300);
        await control.click('#startBtn');
        await control.waitForTimeout(1300);
        await control.click('#pauseBtn');
        await control.waitForTimeout(500);

        await control.click('#miniBarToggle');
        await control.waitForTimeout(700);

        const visible = await control.evaluate(() => {
            const vis = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
            return { start: vis('miniBarStart'), pause: vis('miniBarPause') };
        });
        expect(visible.start, 'в паузе полоса обязана предлагать старт').toBe(true);
        expect(visible.pause, 'кнопка «Пауза» в паузе не делает ничего').toBe(false);

        await control.click('#miniBarStart');
        await control.waitForTimeout(1300);
        expect(await control.evaluate(() => window.timerController.isRunning)).toBe(true);

        await control.click('#miniBarExpand');
        await control.waitForTimeout(500);
        await control.click('#resetBtn');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});

/**
 * Сворачивание выходит из режима ручного ввода.
 *
 * В полосе полей ввода нет — они спрятаны вместе со всей панелью, — но класс
 * `state-input` на body оставался, и полоса застревала в состоянии, где её
 * «Старт» означает «поставить набранное». Набирать было негде, ставить
 * нечего: и кнопка полосы, и пробел в свёрнутом окне переставали запускать
 * таймер. Замерено: после сворачивания из ввода Space не запускал отсчёт.
 */
test('сворачивание выходит из режима ввода, и пробел снова запускает таймер', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.preset[data-minutes="5"]');
        await control.waitForTimeout(300);
        await control.click('#controlTime');
        await control.waitForTimeout(500);
        await expect(control.locator('body')).toHaveClass(/state-input/);

        await control.click('#miniBarToggle');
        await control.waitForTimeout(700);
        await expect(control.locator('body')).not.toHaveClass(/state-input/);

        await control.keyboard.press('Space');
        await control.waitForTimeout(1300);
        expect(await control.evaluate(() => window.timerController.isRunning),
            'пробел обязан запускать таймер из полосы').toBe(true);

        await control.click('#miniBarExpand');
        await control.waitForTimeout(500);
        await control.click('#pauseBtn');
        await control.click('#resetBtn');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});

test('клавиша M переключает режим, а ящик настроек при сворачивании закрывается', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.tab-btn[data-tab="timer"]');
        await control.waitForTimeout(700);

        await control.keyboard.press('m');
        await control.waitForTimeout(800);

        const collapsed = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
        expect(collapsed.height).toBeLessThanOrEqual(60);
        const drawerOpen = await control.evaluate(() => document.getElementById('settingsDrawer').classList.contains('open'));
        expect(drawerOpen, 'ящик обязан закрыться до сжатия').toBe(false);

        await control.keyboard.press('m');
        await control.waitForTimeout(800);
        const expanded = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
        expect(expanded.height).toBeGreaterThan(400);
    } finally {
        await app.close();
    }
});

/**
 * Сообщение, пришедшее в свёрнутом состоянии, целиком помещается в полосу.
 *
 * Контейнер тостов прибит к НИЖНЕМУ краю окна (bottom: var(--tw-s-10) = 40px)
 * — это правка прошлого прохода, там тост закрывал герой-время. В окне высотой
 * 52px тот же отступ выносит тост ВЫШЕ верхнего края: замер на живом окне —
 * верх тоста на отметке -46 при высоте окна 52, то есть сообщение почти
 * целиком за кадром и прочитать его нельзя.
 *
 * Нашёл это кадр control-collapsed.png, добавленный в съёмку вместе с
 * режимом: на нём тост срезан верхним краем и виден как тёмная ступенька.
 */
test('тост в свёрнутом состоянии виден целиком', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('#miniBarToggle');
        await control.waitForTimeout(700);

        const m = await control.evaluate(async () => {
            window.Toast.show('Проверка размещения сообщения в полосе');
            await new Promise((r) => setTimeout(r, 400));
            const toast = document.querySelector('.toast');
            if (!toast) { return null; }
            const r = toast.getBoundingClientRect();
            return {
                top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
                left: +r.left.toFixed(1), right: +r.right.toFixed(1),
                viewportH: window.innerHeight, viewportW: window.innerWidth
            };
        });

        expect(m, 'тост не появился — проверять нечего').not.toBeNull();
        expect(m.top, `верх тоста ${m.top} выше окна`).toBeGreaterThanOrEqual(0);
        expect(m.bottom, `низ тоста ${m.bottom} при высоте окна ${m.viewportH}`)
            .toBeLessThanOrEqual(m.viewportH);
        expect(m.left).toBeGreaterThanOrEqual(0);
        expect(m.right).toBeLessThanOrEqual(m.viewportW);

        await control.click('#miniBarExpand');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});

/**
 * Содержимое полосы ПОМЕЩАЕТСЯ в полосу — числом, а не на глаз.
 *
 * Просьба 20.08.2026 добавила в полосу шесть кнопок (четыре ячейки вида и
 * замок), и «влезло ли» — это утверждение о прямоугольниках. Проверять его
 * взглядом нельзя вдвойне: flex по умолчанию СЖИМАЕТ элементы, поэтому
 * переполнение выглядит не как вылезший за край элемент, а как кнопка, тихо
 * ставшая уже своей мишени. Поэтому меряются ОБЕ величины: и что ничего не
 * вышло за padding-бокс полосы, и что каждая кнопка не мельче заявленного.
 *
 * Худший случай времени (H:MM:SS со знаком) подставляется в строку намеренно:
 * ширина полосы обязана держать самое длинное, что она умеет показывать, а не
 * то, что оказалось на экране в момент прогона.
 */
test('в полосе всё помещается: замер кнопок и правых краёв', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('#miniBarToggle');
        await control.waitForTimeout(700);

        const measure = () => control.evaluate(() => {
            const bar = document.getElementById('miniBar');
            const cs = getComputedStyle(bar);
            const box = bar.getBoundingClientRect();
            const padL = parseFloat(cs.paddingLeft);
            const padR = parseFloat(cs.paddingRight);
            const inner = { left: box.left + padL, right: box.right - padR };
            // Спрятанное действие (в полосе на экране всегда одно из двух)
            // прямоугольника не имеет — мерить его край бессмысленно.
            const kids = [...bar.children].map((el) => {
                const r = el.getBoundingClientRect();
                return { id: el.id || el.className, left: r.left, right: r.right, w: r.width, h: r.height };
            }).filter((k) => k.w > 0 || k.h > 0);
            const time = document.getElementById('miniBarTime');
            // ЗАПАС полосы — это ширина распорки: пока она больше нуля, всё
            // остальное стоит в своих размерах. Сумма ширин детей на эту роль
            // не годится вовсе — распорка растяжимая, и сумма равна ширине
            // полосы за вычетом зазоров при ЛЮБОМ содержимом, то есть проверка
            // «сумма ≤ ширины» зелена и тогда, когда кнопки уже сжаты.
            const spacer = bar.querySelector('.mini-spacer').getBoundingClientRect().width;
            const buttons = {};
            for (const id of ['miniPresetSlot1', 'miniPresetSlot2', 'miniPresetSlot3', 'miniPresetSlot4',
                'miniBarLock', 'miniBarReset', 'miniBarExpand']) {
                const r = document.getElementById(id).getBoundingClientRect();
                buttons[id] = { w: r.width, h: r.height };
            }
            return {
                buttons,
                inner,
                innerWidth: inner.right - inner.left,
                kids,
                spacer,
                sum: kids.reduce((a, k) => a + k.w, 0),
                timeClipped: time.scrollWidth - time.clientWidth
            };
        });

        const report = (m, label) => {
            const widest = m.kids.reduce((a, k) => (k.right > a.right ? k : a), m.kids[0]);
            console.log(`   [${label}] полоса ${m.innerWidth.toFixed(1)}px, содержимое ${(m.sum - m.spacer).toFixed(1)}px, `
                + `запас (распорка) ${m.spacer.toFixed(1)}px, правый край дальше всех у ${widest.id}: `
                + `${(widest.right - m.inner.right).toFixed(1)}px за краем`);
        };

        const check = (m, label) => {
            report(m, label);
            for (const k of m.kids) {
                expect(k.left, `${label}: ${k.id} вылез за левый край`).toBeGreaterThanOrEqual(m.inner.left - 0.5);
                expect(k.right, `${label}: ${k.id} вылез за правый край`).toBeLessThanOrEqual(m.inner.right + 0.5);
            }
            // Запас положительный: распорка схлопнулась в ноль — значит
            // ширины уже не хватает, и следующим сожмётся что-нибудь нужное.
            expect(m.spacer, `${label}: запаса нет, содержимое заняло всю полосу`).toBeGreaterThan(4);
            expect(m.kids.find((k) => String(k.id).includes('mini-presets')),
                `${label}: в полосе нет группы ячеек вида`).toBeTruthy();
            // Мишени НЕ сжаты: именно так выглядит нехватка ширины во flex —
            // не вылезшим за край элементом, а кнопкой, тихо ставшей уже.
            console.log(`   [${label}] кнопки: ` + Object.entries(m.buttons)
                .map(([id, sz]) => `${id} ${sz.w.toFixed(1)}×${sz.h.toFixed(1)}`).join(', '));
            for (let i = 1; i <= 4; i++) {
                expect(m.buttons[`miniPresetSlot${i}`].w, `${label}: ячейка ${i} сжата`).toBeGreaterThanOrEqual(23.5);
                expect(m.buttons[`miniPresetSlot${i}`].h, `${label}: ячейка ${i} сплющена`).toBeGreaterThanOrEqual(23.5);
            }
            for (const id of ['miniBarLock', 'miniBarReset', 'miniBarExpand']) {
                expect(m.buttons[id].w, `${label}: ${id} сжат`).toBeGreaterThanOrEqual(31.5);
            }
        };

        const idle = await measure();
        check(idle, 'покой');

        // Худший случай: часы, минуты, секунды и минус — и самое длинное слово
        // действия («Продолжить»). Действий на экране всегда ОДНО из двух,
        // поэтому вторая кнопка остаётся спрятанной: показать обе — значит
        // мерить полосу, которой не бывает.
        await control.evaluate(() => {
            document.getElementById('miniBarTime').textContent = '−9:59:59';
            document.getElementById('miniBarStart').textContent = 'Продолжить';
            document.getElementById('miniBarStart').style.display = 'block';
            document.getElementById('miniBarPause').style.display = 'none';
        });
        await control.waitForTimeout(120);
        const worst = await measure();
        console.log('   [худший случай] по элементам: '
            + worst.kids.map((k) => `${k.id} ${k.w.toFixed(1)}`).join(', '));
        check(worst, 'худший случай');
        expect(worst.timeClipped, 'время обрезано').toBeLessThanOrEqual(0);

        await control.evaluate(() => {
            document.getElementById('miniBarStart').style.display = '';
            document.getElementById('miniBarPause').style.display = '';
        });
        await control.click('#miniBarExpand');
        await control.waitForTimeout(500);
    } finally {
        await app.close();
    }
});

/**
 * Замок и ячейки вида работают ИЗ ПОЛОСЫ.
 *
 * Просьба 20.08.2026: «когда сворачиваешь окно в минибар, добавь туда кнопочку
 * блокировки всего и кнопочки пресетов». Полоса — режим «всё настроено, идёт
 * мероприятие», и оба действия нужны именно там.
 *
 * Меряется не наличие кнопок (это видит юнит-тест по разметке), а то, что за
 * ними стоят ТЕ ЖЕ владельцы: щелчок в полосе меняет глиф и в титлбаре, а
 * ячейка в полосе пишет в тот же профиль, что и ячейка в панели.
 */
test('в полосе замок и ячейки вида — те же самые, а не вторая копия', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => {
            localStorage.removeItem('uiPresets');
            localStorage.setItem('uiLocked', '0');
        });
        await control.reload();
        await control.waitForTimeout(1200);

        await control.click('#miniBarToggle');
        await control.waitForTimeout(700);

        // Кнопки в полосе ВИДНЫ: зелёный тест на скрытой кнопке ничего не значит.
        const seen = await control.evaluate(() => {
            const vis = (id) => {
                const el = document.getElementById(id);
                const r = el.getBoundingClientRect();
                return !!el.offsetParent && r.width > 0 && r.height > 0;
            };
            return { lock: vis('miniBarLock'), slot1: vis('miniPresetSlot1'), slot4: vis('miniPresetSlot4') };
        });
        expect(seen.lock, 'замка в полосе не видно').toBe(true);
        expect(seen.slot1, 'ячейки 1 в полосе не видно').toBe(true);
        expect(seen.slot4, 'ячейки 4 в полосе не видно').toBe(true);

        // --- замок ---
        await control.click('#miniBarLock');
        await control.waitForTimeout(500);
        const locked = await control.evaluate(() => ({
            html: document.documentElement.classList.contains('ui-locked'),
            bar: document.getElementById('miniBarLock').textContent.trim(),
            titlebar: document.getElementById('lockToggle').textContent.trim(),
            stored: localStorage.getItem('uiLocked')
        }));
        console.log(`   после клика по замку в полосе: ${JSON.stringify(locked)}`);
        expect(locked.html, 'замок из полосы не заперся').toBe(true);
        expect(locked.stored).toBe('1');
        expect(locked.bar, 'глиф в полосе не сменился').toBe('🔒');
        expect(locked.titlebar, 'кнопка титлбара осталась с прежним глифом — значит владельцев два').toBe('🔒');

        await control.click('#miniBarLock');
        await control.waitForTimeout(500);
        expect(await control.evaluate(() => document.documentElement.classList.contains('ui-locked')),
            'второй клик не снял замок').toBe(false);

        // --- ячейки вида: пустая ЗАПИСЫВАЕТ, и метку видно в обоих комплектах ---
        await control.click('#miniPresetSlot2');
        await control.waitForTimeout(800);
        const marked = await control.evaluate(() => {
            const mini = document.getElementById('miniPresetSlot2');
            const panel = document.getElementById('presetSlot2');
            return {
                miniFilled: mini.classList.contains('filled'),
                miniActive: mini.classList.contains('active'),
                panelFilled: panel.classList.contains('filled'),
                panelActive: panel.classList.contains('active'),
                stored: Object.keys(JSON.parse(localStorage.getItem('uiPresets') || '{}'))
            };
        });
        console.log(`   после клика по ячейке в полосе: ${JSON.stringify(marked)}`);
        expect(marked.stored, 'клик в полосе не записал ячейку').toEqual(['2']);
        expect(marked.miniActive, 'ячейка в полосе не помечена применённой').toBe(true);
        expect(marked.panelFilled, 'панельная ячейка не узнала о записи из полосы').toBe(true);
        expect(marked.panelActive, 'панельная ячейка не помечена применённой').toBe(true);
    } finally {
        await control.evaluate(() => {
            localStorage.removeItem('uiPresets');
            localStorage.setItem('uiLocked', '0');
            document.documentElement.classList.remove('ui-locked');
            if (window.ipcRenderer) { window.ipcRenderer.send('ui-lock-update', { locked: false }); }
        }).catch(() => {});
        await control.click('#miniBarExpand').catch(() => {});
        await control.waitForTimeout(400);
        await app.close();
    }
});
