const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { pickWindowSizes } = require('./window-sizes');
const DL = require('../display-layouts');

/**
 * Масштаб КАЖДОГО элемента дисплея и готовые раскладки.
 *
 * Просьба 17.08.2026: «в полноэкранном режиме сделай так, чтобы каждый элемент
 * я мог масштабировать по отдельности, а не все одновременно; и несколько
 * красивых раскладок по умолчанию, чтобы всё вмещалось».
 *
 * Что здесь меряется и почему именно здесь:
 *
 *  1. «По отдельности» — это утверждение о СОСЕДЯХ. Тест, который проверяет
 *     только что нужный элемент вырос, зелен и тогда, когда выросли все семь:
 *     ровно так вело себя окно ДО этой правки. Поэтому меряются все семь
 *     прямоугольников, и шесть обязаны не измениться.
 *
 *  2. «Чтобы всё вмещалось» — это утверждение о ПЕРЕСЕЧЕНИЯХ. Юнит-тест
 *     считает их на номинальных габаритах (tests/display-layouts.test.js), а
 *     настоящие размеры зависят от шрифта, стиля таймера и разрешения экрана —
 *     их видно только здесь, на живом окне.
 *
 * Раскладка применяется КЛИКОМ по кнопке в панели: зелёный тест на канале
 * ничего не сказал бы о том, доступна ли кнопка (см. разбор «зелёный тест не
 * доказывает достижимости»).
 */

const MOVABLE = [
    { id: 'currentTime', node: 'currentTimeBlock', toggle: 'showCurrentTime' },
    { id: 'eventTime', node: 'eventTimeBlock', toggle: 'showEventTime' },
    { id: 'endTime', node: 'endTimeBlock', toggle: 'showEndTime' },
    { id: 'timeLeft', node: 'timeLeftBlock', toggle: 'showTimeLeft' },
    { id: 'eventTitle', node: 'eventTitleBlock', toggle: 'showEventTitle' },
    { id: 'heroLabel', node: 'heroLabel', toggle: 'showHeroLabel' },
    { id: 'statusPill', node: 'statusPill', toggle: 'showStatusPill' }
];

async function findDisplay(app) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(() => !!document.getElementById('timerRing')).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

const setToggle = (control, id, value) => control.evaluate(([key, on]) => {
    const el = document.getElementById(key);
    if (!el) { return; }
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

// Прямоугольники всех подвижных элементов одним замером.
const readBoxes = (page, nodes) => page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) { continue; }
        const r = el.getBoundingClientRect();
        out[id] = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return out;
}, nodes);

/**
 * ПРИМЕНЁННЫЙ масштаб каждого элемента.
 *
 * Ширины для «соседи не изменились» недостаточно: «Текущее время» и «До
 * завершения» показывают бегущие цифры, и их коробка сама по себе гуляет на
 * доли пикселя при смене знака (замер: 266,46 → 266,97 без единого действия
 * пользователя). Масштаб — величина, которую задаёт ровно это действие, и
 * сравнивать её можно ТОЧНО.
 */
const readScales = (page) => page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const num = (v) => Math.round(parseFloat(v) * 1000) / 1000;
    return {
        currentTimeBlock: num(getComputedStyle(document.getElementById('currentTimeBlock')).getPropertyValue('--info-scale')),
        eventTimeBlock: num(getComputedStyle(document.getElementById('eventTimeBlock')).getPropertyValue('--info-scale')),
        endTimeBlock: num(getComputedStyle(document.getElementById('endTimeBlock')).getPropertyValue('--info-scale')),
        timeLeftBlock: num(getComputedStyle(document.getElementById('timeLeftBlock')).getPropertyValue('--info-scale')),
        eventTitleBlock: num(getComputedStyle(document.getElementById('eventTitleBlock')).getPropertyValue('--info-scale')),
        heroLabel: num(body.getPropertyValue('--hero-label-scale') || '1'),
        statusPill: num(body.getPropertyValue('--status-pill-scale') || '1')
    };
});

const NODES = MOVABLE.map((m) => m.node);

function overlaps(a, b) {
    return a.left < b.left + b.width && b.left < a.left + a.width
        && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * Ящик настроек дисплея. Кнопки раскладок живут в нём, и добраться до них можно
 * только так же, как пользователь: шевроном строки «Полноэкранный».
 */
async function openDisplayDrawer(control) {
    await control.click('.wrow:has(#openDisplayBtn) .wrow-chevron');
    await control.waitForTimeout(700);
    await expect(control.locator('#displayLayoutGrid')).toBeVisible();
}

/**
 * Профиль e2e общий на весь прогон, поэтому раскладка, оставленная включённой,
 * досталась бы соседним спекам вместе с позициями и масштабами.
 */
async function resetDisplayState(control, display) {
    await display.evaluate(() => {
        localStorage.removeItem('displayBlockPositions');
        localStorage.removeItem('displayBlockScales');
        localStorage.removeItem('displayBlockScale');
        localStorage.setItem('displayTimerScale', '100');
    });
    for (const m of MOVABLE) {
        const on = m.id === 'heroLabel' || m.id === 'statusPill';
        await setToggle(control, m.toggle, on);
    }
    await control.evaluate(() => {
        const el = document.getElementById('displayTimerScale');
        if (!el) { return; }
        el.value = '100';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await control.waitForTimeout(400);
}

async function openDisplayWithEverything(control, app) {
    await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
    await control.waitForTimeout(2200);
    const display = await findDisplay(app);
    expect(display, 'окно дисплея не найдено').not.toBeNull();
    for (const m of MOVABLE) { await setToggle(control, m.toggle, true); }
    await display.waitForTimeout(800);
    return display;
}

test('Ctrl+колесо над элементом меняет размер ТОЛЬКО этого элемента', async () => {
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithEverything(control, app);

        const before = await readBoxes(display, NODES);
        for (const m of MOVABLE) {
            expect(before[m.node], `${m.id}: элемента нет на экране`).toBeTruthy();
            expect(before[m.node].width, `${m.id}: нулевая ширина`).toBeGreaterThan(0);
        }

        // Крутим над КАЖДЫМ элементом по очереди и после каждого проверяем всех.
        for (const target of MOVABLE) {
            const boxesBefore = await readBoxes(display, NODES);
            const scalesBefore = await readScales(display);
            await display.evaluate((nodeId) => {
                const el = document.getElementById(nodeId);
                el.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
                }));
            }, target.node);
            await display.waitForTimeout(250);

            const boxesAfter = await readBoxes(display, NODES);
            const scalesAfter = await readScales(display);

            expect(
                scalesAfter[target.node],
                `${target.id}: колесо над элементом не изменило его масштаб`
            ).toBeGreaterThan(scalesBefore[target.node]);
            // Масштаб мог вырасти «на бумаге» — проверяем, что элемент реально стал больше.
            expect(
                boxesAfter[target.node].width,
                `${target.id}: масштаб вырос, а элемент — нет (${boxesBefore[target.node].width} → ${boxesAfter[target.node].width})`
            ).toBeGreaterThan(boxesBefore[target.node].width + 0.5);

            for (const other of MOVABLE) {
                if (other.id === target.id) { continue; }
                expect(
                    scalesAfter[other.node],
                    `крутили «${target.id}», а масштаб «${other.id}» изменился: ${scalesBefore[other.node]} → ${scalesAfter[other.node]}`
                ).toBe(scalesBefore[other.node]);
            }
        }
    } finally {
        await app.close();
    }
});

/**
 * Shift+колесо приходит ПО ГОРИЗОНТАЛЬНОЙ ОСИ.
 *
 * macOS (и Windows) перекладывают колесо с Shift на deltaX, оставляя deltaY
 * нулём. Код спрашивал только deltaY, и ноль попадал в ветку «уменьшить»: со
 * Shift масштаб умел ТОЛЬКО падать и упирался в предел 50 %. У пользователя в
 * профиле все пять блоков лежали ровно на пятидесяти.
 *
 * Прежняя версия этого теста подавала deltaY и была зелёной — потому что ось
 * перекладывает СИСТЕМА, а синтетическому событию поля задают руками. Тест,
 * повторяющий ошибку кода, проверяет не поведение, а собственное понимание.
 */
test('Shift+колесо по ГОРИЗОНТАЛЬНОЙ оси увеличивает, а не только уменьшает', async () => {
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithEverything(control, app);
        const start = await readScales(display);

        // Уменьшаем, чтобы было куда расти, и убеждаемся, что вниз работает.
        await display.evaluate(() => document.body.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 0, deltaX: 100, shiftKey: true, bubbles: true, cancelable: true
        })));
        await display.waitForTimeout(300);
        const down = await readScales(display);
        expect(down.currentTimeBlock, 'горизонтальное колесо вниз не уменьшило')
            .toBeLessThan(start.currentTimeBlock);

        // И обратно — ровно то, что не работало.
        await display.evaluate(() => document.body.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 0, deltaX: -100, shiftKey: true, bubbles: true, cancelable: true
        })));
        await display.waitForTimeout(300);
        const up = await readScales(display);
        expect(up.currentTimeBlock, 'горизонтальное колесо вверх не увеличило — Shift снова умеет только уменьшать')
            .toBeGreaterThan(down.currentTimeBlock);

        // Колесо без движения не должно решать за пользователя.
        await display.evaluate(() => document.body.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 0, deltaX: 0, shiftKey: true, bubbles: true, cancelable: true
        })));
        await display.waitForTimeout(250);
        const idle = await readScales(display);
        expect(idle.currentTimeBlock, 'пустое событие изменило масштаб').toBe(up.currentTimeBlock);
    } finally {
        await app.close();
    }
});

test('Shift+колесо двигает ВСЕ карточки сразу', async () => {
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithEverything(control, app);
        const before = await readScales(display);

        await display.evaluate(() => {
            document.body.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -100, shiftKey: true, bubbles: true, cancelable: true
            }));
        });
        await display.waitForTimeout(300);
        const after = await readScales(display);

        for (const m of MOVABLE) {
            if (m.id === 'heroLabel' || m.id === 'statusPill') {
                expect(
                    after[m.node],
                    `${m.id}: «все блоки» — это карточки, подпись и плашка сюда не входят`
                ).toBe(before[m.node]);
                continue;
            }
            expect(after[m.node], `${m.id}: карточка не выросла`).toBeGreaterThan(before[m.node]);
        }
    } finally {
        await app.close();
    }
});

test('каждая раскладка применяется КЛИКОМ и ничто не наезжает друг на друга', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();
        await openDisplayDrawer(control);

        // Кнопки должны быть на экране и кликабельны — по одной на раскладку.
        const buttons = control.locator('#displayLayoutGrid .layout-btn');
        await expect(buttons).toHaveCount(DL.LAYOUTS.length);

        for (const layout of DL.LAYOUTS) {
            await control.locator(`#displayLayoutGrid .layout-btn[data-layout="${layout.id}"]`).click();
            await display.waitForTimeout(900);

            const boxes = await readBoxes(display, NODES);
            const visible = await display.evaluate((ids) => {
                const out = {};
                for (const id of ids) {
                    const el = document.getElementById(id);
                    if (!el) { continue; }
                    const style = getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    out[id] = style.display !== 'none' && r.width > 0 && r.height > 0;
                }
                return out;
            }, NODES);

            const timer = await display.evaluate(() => {
                const el = document.querySelector('.timer-ring.active, .timer-flip.active, .timer-analog.active, .timer-digits.active');
                if (!el) { return null; }
                const r = el.getBoundingClientRect();
                return { left: r.left, top: r.top, width: r.width, height: r.height };
            });
            expect(timer, `${layout.id}: активного блока таймера нет`).not.toBeNull();

            const size = await display.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

            const onScreen = MOVABLE.filter((m) => visible[m.node]);
            // Раскладка обязана ПОКАЗАТЬ ровно то, что перечислила.
            for (const m of MOVABLE) {
                const expected = !!layout.elements[m.id];
                expect(visible[m.node], `${layout.id}: «${m.id}» ${expected ? 'должен быть виден' : 'должен быть скрыт'}`)
                    .toBe(expected);
            }

            for (const m of onScreen) {
                const box = boxes[m.node];
                expect(box.left, `${layout.id}: «${m.id}» вылез за левый край`).toBeGreaterThanOrEqual(-1);
                expect(box.top, `${layout.id}: «${m.id}» вылез за верхний край`).toBeGreaterThanOrEqual(-1);
                expect(box.left + box.width, `${layout.id}: «${m.id}» вылез за правый край`).toBeLessThanOrEqual(size.width + 1);
                expect(box.top + box.height, `${layout.id}: «${m.id}» вылез за нижний край`).toBeLessThanOrEqual(size.height + 1);
                expect(overlaps(box, timer), `${layout.id}: «${m.id}» накрывает таймер`).toBe(false);
            }

            for (let i = 0; i < onScreen.length; i++) {
                for (let j = i + 1; j < onScreen.length; j++) {
                    const a = onScreen[i], b = onScreen[j];
                    expect(
                        overlaps(boxes[a.node], boxes[b.node]),
                        `${layout.id}: «${a.id}» и «${b.id}» накладываются`
                    ).toBe(false);
                }
            }
        }

        await resetDisplayState(control, display);
    } finally {
        await app.close();
    }
});

/**
 * Жалоба 17.08.2026: «колесо только уменьшает».
 *
 * Причина была не в знаке колеса (он проверен настоящим `mouse.wheel` в обе
 * стороны), а в МОЛЧАЛИВОМ упоре: масштаб таймера ограничен свободной полосой
 * между подписью и плашкой, и на потолке жест вверх не делал ничего, а вниз
 * работал. В профиле пользователя лежало ровно потолочное значение — то есть
 * он всё время стоял на упоре.
 *
 * Проверяется поэтому ДВА утверждения: упор называет причину и потолок
 * ПОДНИМАЕТСЯ, когда названную помеху выключают. Второе важнее первого:
 * объяснение без рычага — это извинение.
 */
test('упор масштаба называет помеху, и без неё потолок выше', async () => {
    test.setTimeout(90000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);
        expect(display).not.toBeNull();
        await setToggle(control, 'showStatusPill', true);
        await setToggle(control, 'showHeroLabel', true);
        await display.waitForTimeout(600);

        const crankUp = async () => {
            for (let i = 0; i < 16; i++) {
                await display.evaluate(() => document.body.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
                })));
                await display.waitForTimeout(70);
            }
            return display.evaluate(() => ({
                scale: parseFloat((document.getElementById('timerRing').style.transform.match(/scale\(([\d.]+)\)/) || [0, 0])[1]),
                note: document.getElementById('scaleNote').textContent,
                shown: document.getElementById('scaleNote').classList.contains('visible')
            }));
        };

        const withPill = await crankUp();
        expect(withPill.shown, 'упор в потолок остался молчаливым').toBe(true);
        expect(withPill.note, 'упор не назвал помеху').toMatch(/плашка|подпись|край/);

        // Выключаем названную помеху — потолок обязан подняться.
        await setToggle(control, 'showStatusPill', false);
        await setToggle(control, 'showHeroLabel', false);
        await display.waitForTimeout(700);
        const without = await crankUp();
        expect(
            without.scale,
            `потолок не поднялся: с плашкой ${withPill.scale}, без неё ${without.scale}`
        ).toBeGreaterThan(withPill.scale + 0.05);

        // Профиль e2e общий — возвращаем как было.
        await setToggle(control, 'showStatusPill', true);
        await setToggle(control, 'showHeroLabel', true);
        await display.evaluate(() => localStorage.setItem('displayTimerScale', '100'));
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});

/**
 * Композиция переживает ИЗМЕНЕНИЕ РАЗМЕРА ОКНА.
 *
 * Жалоба 17.08.2026: «сворачиваю окно и начинаю масштабировать — все доп
 * плашки разъезжаются». Так и было: позиция хранилась в АБСОЛЮТНЫХ пикселях, а
 * в оконном режиме размер меняет пользователь. Блок у нижнего края оказывался
 * в середине, блок у правого — за краем; вдобавок карточки набраны от `vw` и
 * при смене ширины сами меняют габарит, так что даже «неподвижная» координата
 * переставала означать то же место.
 *
 * Меряется ДОЛЯ окна для центра каждого элемента до и после — то есть
 * композиция, а не координата. Замер по координатам был бы зелёным ровно в том
 * случае, который и есть дефект.
 */
test('элементы держат композицию при изменении размера окна', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithEverything(control, app);
        await openDisplayDrawer(control);
        await control.locator('#displayLayoutGrid .layout-btn[data-layout="conference"]').click();
        await display.waitForTimeout(900);

        const setBounds = (b) => app.evaluate(({ BrowserWindow }, bounds) => {
            const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('display.html'));
            if (!win) { return; }
            if (win.isFullScreen()) { win.setFullScreen(false); }
            win.setBounds(bounds);
        }, b);

        const fractions = () => display.evaluate((ids) => {
            const out = {};
            for (const id of ids) {
                const el = document.getElementById(id);
                if (!el) { continue; }
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height || getComputedStyle(el).display === 'none') { continue; }
                out[id] = {
                    cx: (r.left + r.width / 2) / window.innerWidth,
                    cy: (r.top + r.height / 2) / window.innerHeight,
                    right: r.left + r.width,
                    bottom: r.top + r.height,
                    left: r.left,
                    top: r.top,
                    vw: window.innerWidth,
                    vh: window.innerHeight
                };
            }
            return out;
        }, NODES);

        await setBounds({ x: 60, y: 60, width: 1400, height: 900 });
        await display.waitForTimeout(1200);
        const before = await fractions();
        expect(Object.keys(before).length, 'на экране нет элементов — мерить нечего').toBeGreaterThan(3);

        await setBounds({ x: 60, y: 60, width: 900, height: 640 });
        await display.waitForTimeout(1200);
        const after = await fractions();

        for (const id of Object.keys(before)) {
            expect(after[id], `${id} исчез после изменения размера`).toBeTruthy();
            // Допуск шире у краёв: поле в 20px на узком окне занимает большую
            // долю, и прижатый элемент честно уступает ему место.
            expect(
                Math.abs(after[id].cx - before[id].cx),
                `${id}: разъехался по горизонтали ${before[id].cx.toFixed(3)} → ${after[id].cx.toFixed(3)}`
            ).toBeLessThan(0.06);
            expect(
                Math.abs(after[id].cy - before[id].cy),
                `${id}: разъехался по вертикали ${before[id].cy.toFixed(3)} → ${after[id].cy.toFixed(3)}`
            ).toBeLessThan(0.06);
            // И ничто не должно вылезти за окно — это вторая половина жалобы.
            expect(after[id].left, `${id}: вылез за левый край`).toBeGreaterThanOrEqual(-1);
            expect(after[id].top, `${id}: вылез за верхний край`).toBeGreaterThanOrEqual(-1);
            expect(after[id].right, `${id}: вылез за правый край`).toBeLessThanOrEqual(after[id].vw + 1);
            expect(after[id].bottom, `${id}: вылез за нижний край`).toBeLessThanOrEqual(after[id].vh + 1);
        }

        await resetDisplayState(control, display);
    } finally {
        await app.close();
    }
});

test('раскладка переживает переоткрытие окна дисплея', async () => {
    test.setTimeout(60000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2200);
        let display = await findDisplay(app);
        expect(display).not.toBeNull();
        await openDisplayDrawer(control);

        await control.locator('#displayLayoutGrid .layout-btn[data-layout="dashboard"]').click();
        await display.waitForTimeout(900);
        const before = await readBoxes(display, ['currentTimeBlock', 'endTimeBlock']);

        await control.evaluate(() => window.ipcRenderer.send('close-display'));
        await control.waitForTimeout(800);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2400);
        display = await findDisplay(app);
        expect(display).not.toBeNull();
        await display.waitForTimeout(600);

        const after = await readBoxes(display, ['currentTimeBlock', 'endTimeBlock']);
        for (const id of ['currentTimeBlock', 'endTimeBlock']) {
            expect(Math.abs(after[id].left - before[id].left), `${id}: позиция не пережила переоткрытие`).toBeLessThan(6);
            expect(Math.abs(after[id].top - before[id].top), `${id}: позиция не пережила переоткрытие`).toBeLessThan(6);
            expect(Math.abs(after[id].width - before[id].width), `${id}: масштаб не пережил переоткрытие`).toBeLessThan(6);
        }

        await resetDisplayState(control, display);
    } finally {
        await app.close();
    }
});

test('раскладка не зависит от того, какой масштаб был на экране до неё', async () => {
    // Жалоба 18.08.2026: «при масштабировании полноэкранного вида пресеты
    // ставят элементы неровно».
    //
    // Раскладка — ФУНКЦИЯ окна и содержимого элементов, а не того, что было на
    // экране мгновение назад. Проверяется это единственным честным способом:
    // одна и та же раскладка применяется из ДВУХ разных исходных состояний, и
    // прямоугольники обязаны совпасть.
    //
    // Что ловится и чем это было измерено. `applyLayout` брал натуральный
    // габарит блока как `getBoundingClientRect() / текущий масштаб`, а у
    // `.info-block` на `transform` висит переход. Замер на живом окне в момент
    // расчёта: `--info-scale` уже `0.95`, а `transform` ещё `matrix(1.2, …)` —
    // переменная меняется мгновенно, transform едет 400 мс. Габарит выходил
    // завышенным ровно в 1.2/0.95 раза (269.2 вместо 213.1), и у каждого блока
    // СВОЙ — он пропорционален ширине. Отсюда и «неровно»: ряд из четырёх
    // карточек вставал с просветами 441/461/428 вместо равных.
    //
    // Исходное состояние задаётся КОЛЕСОМ, а не соседней раскладкой: чем
    // дальше прошлый масштаб от нового, тем крупнее ошибка, и версия этого
    // теста, гонявшая «Классика → Сводка» (120 → 95), проходила зелёной на
    // сломанном коде — 25 процентных пунктов разницы прятались в допуске.
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithEverything(control, app);
        await openDisplayDrawer(control);
        const applyLayout = async (id) => {
            await control.click(`.layout-btn[data-layout="${id}"]`);
            await display.waitForTimeout(1000);
        };
        // Раскрутить блоки колесом далеко вверх — это и есть «масштабирование»
        // из жалобы. Десять щелчков над каждым блоком.
        const spinUp = async () => {
            for (const m of MOVABLE) {
                for (let i = 0; i < 40; i++) {
                    await display.evaluate((nodeId) => {
                        document.getElementById(nodeId).dispatchEvent(new WheelEvent('wheel', {
                            deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
                        }));
                    }, m.node);
                }
            }
            await display.waitForTimeout(600);
        };

        // Эталон: раскладка применяется ВТОРОЙ раз подряд, то есть масштабы уже
        // равны её собственным и переходу нечего интерполировать.
        await applyLayout('dashboard');
        await applyLayout('dashboard');
        const settled = await readBoxes(display, NODES);
        const settledScales = await readScales(display);

        // А теперь то же самое, но из раскрученного состояния.
        await spinUp();
        await applyLayout('dashboard');
        const afterSpin = await readBoxes(display, NODES);
        const spinScales = await readScales(display);

        const report = [];
        for (const node of NODES) {
            const a = settled[node]; const b = afterSpin[node];
            if (!a || !b) { continue; }
            report.push(`${node}: ${Math.round(a.left)},${Math.round(a.top)} → ${Math.round(b.left)},${Math.round(b.top)}`);
        }
        console.log('   с осевшего масштаба → с раскрученного:\n   ' + report.join('\n   '));
        console.log('   масштабы осевшие:', JSON.stringify(settledScales));
        console.log('   масштабы после раскрутки:', JSON.stringify(spinScales));

        // МАСШТАБ — главное из того, что разъезжалось: «Сводка» приезжала с
        // карточками 62 % рядом с 95 %, и ряд из четырёх плашек выходил двух
        // разных размеров. Сравнивается точно, без допуска: его задаёт
        // раскладка, а не бегущие цифры внутри блока.
        expect(spinScales, 'масштабы зависят от того, что было на экране до раскладки')
            .toEqual(settledScales);

        for (const node of NODES) {
            const a = settled[node]; const b = afterSpin[node];
            if (!a || !b) { continue; }
            // Допуск 2px: «Текущее время» показывает бегущие цифры, и его
            // коробка сама по себе гуляет на доли пикселя при смене знака.
            expect(Math.abs(a.left - b.left), `${node}: X зависит от прошлого масштаба`).toBeLessThanOrEqual(2);
            expect(Math.abs(a.top - b.top), `${node}: Y зависит от прошлого масштаба`).toBeLessThanOrEqual(2);
            expect(Math.abs(a.width - b.width), `${node}: ширина зависит от прошлого масштаба`).toBeLessThanOrEqual(2);
        }

        // Профиль e2e общий на весь прогон. «Сводка» выключает плашку
        // состояния, и без возврата соседняя спека меряла бы зазор до
        // СКРЫТОГО элемента: display-timer-scale так и упала с «таймер лёг на
        // плашку» и разницей в 1394 px, оставаясь зелёной в одиночку.
        await resetDisplayState(control, display);
    } finally {
        await app.close();
    }
});

/**
 * Раскладка на НИЗКОМ окне: карточка не ложится на подпись «Осталось».
 *
 * Все остальные проверки раскладок идут на полноэкранном окне, то есть на
 * экране той машины, где прогон. У разработчика это 3440×1440, и дефект
 * 19.08.2026 там не воспроизводился вовсе: подъём карточек до 150 % положил
 * «Текущее время» на подпись при 1440×900 и 1280×720, а на 1920×1080 — нет.
 * Нашла его матрица CI (macOS-раннер 1440×900), и это ровно тот случай, ради
 * которого размер окна задаётся ЧИСЛОМ, а не берётся с монитора.
 *
 * Причина была не в размере карточек, а в том, ЧТО раскладка считала
 * препятствием: коробку таймера — без подписи, которая стоит НАД ним. Плюс
 * колонка мерилась со сдвигом от полосы сверху, которую эта же раскладка через
 * мгновение обнуляла (замер: полоса 44px, hero.top 178 вместо 156).
 */
const LOW_SIZES = [{ w: 1440, h: 900 }, { w: 1280, h: 720 }];

test('раскладка на низком окне не кладёт карточку на подпись и не выпускает её за край', async () => {
    test.setTimeout(180000);
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithEverything(control, app);
        await openDisplayDrawer(control);

        const area = await app.evaluate(({ screen }) => {
            const wa = screen.getPrimaryDisplay().workAreaSize;
            return { width: wa.width, height: wa.height };
        });
        // Размеры — помещающиеся из списка, а если таких меньше двух, то
        // выведенные из рабочей области: на раннерах CI экран 1024×720…1280×1024,
        // и фиксированный список не проверял бы там ровно ничего.
        const sizes = pickWindowSizes(area, LOW_SIZES);
        console.log(`   рабочая область ${area.width}×${area.height}: проверяем ${JSON.stringify(sizes)}`);
        expect(sizes.length, 'экран прогона мал даже для выведенных размеров — проверка не выполнена')
            .toBeGreaterThan(0);

        for (const size of sizes) {
            // Размер ставится по УСЛОВИЮ: выход из полноэкранного режима на
            // macOS анимирован, и setBounds посреди анимации не доезжает.
            let got = null;
            for (let attempt = 0; attempt < 6; attempt++) {
                await app.evaluate(async ({ BrowserWindow }, s) => {
                    const win = BrowserWindow.getAllWindows()
                        .find((w) => w.webContents.getURL().includes('display.html'));
                    if (win.isFullScreen()) {
                        win.setFullScreen(false);
                        await new Promise((r) => setTimeout(r, 800));
                    }
                    win.setBounds({ x: 20, y: 20, width: s.w, height: s.h });
                }, size);
                await display.waitForTimeout(700);
                got = await display.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
                if (Math.abs(got.w - size.w) <= 2 && Math.abs(got.h - size.h) <= 2) { break; }
            }
            expect(`${got.w}×${got.h}`, 'окно не приняло заданный размер — замер относится не к тому кадру')
                .toBe(`${size.w}×${size.h}`);

            for (const layout of DL.LAYOUTS) {
                await control.locator(`#displayLayoutGrid .layout-btn[data-layout="${layout.id}"]`).click();
                await display.waitForTimeout(1000);

                const seen = await display.evaluate((ids) => {
                    const out = {};
                    for (const id of ids.concat(['heroLabel'])) {
                        const el = document.getElementById(id);
                        if (!el) { continue; }
                        const r = el.getBoundingClientRect();
                        if (!r.width || !r.height || getComputedStyle(el).display === 'none') { continue; }
                        out[id] = { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
                    }
                    return { boxes: out, vw: window.innerWidth, vh: window.innerHeight };
                }, NODES);

                const ids = Object.keys(seen.boxes);
                // «Минимум» не показывает ничего, кроме таймера, — мерить в нём
                // нечего, и требовать элементы значило бы проверять не то.
                if (Object.keys(layout.elements).length === 0) {
                    expect(ids.length, `${layout.id}: раскладка обещала пустой кадр, а элементы остались`).toBe(0);
                    continue;
                }
                expect(ids.length, `${size.w}×${size.h}/${layout.id}: на экране нечего мерить`).toBeGreaterThan(1);

                for (const id of ids) {
                    const b = seen.boxes[id];
                    expect(b.right, `${size.w}×${size.h}/${layout.id}: «${id}» вылез за правый край`)
                        .toBeLessThanOrEqual(seen.vw + 1);
                    expect(b.bottom, `${size.w}×${size.h}/${layout.id}: «${id}» вылез за нижний край`)
                        .toBeLessThanOrEqual(seen.vh + 1);
                    expect(b.left, `${size.w}×${size.h}/${layout.id}: «${id}» вылез за левый край`).toBeGreaterThanOrEqual(-1);
                    expect(b.top, `${size.w}×${size.h}/${layout.id}: «${id}» вылез за верхний край`).toBeGreaterThanOrEqual(-1);
                }
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        expect(
                            overlaps(seen.boxes[ids[i]], seen.boxes[ids[j]]),
                            `${size.w}×${size.h}/${layout.id}: «${ids[i]}» и «${ids[j]}» накладываются`
                        ).toBe(false);
                    }
                }
            }
        }

        await resetDisplayState(control, display);
    } finally {
        await app.close();
    }
});

/**
 * Перещёлкивание стилей не двигает разложенные карточки.
 *
 * Жалоба 19.08.2026: «при перещёлкивании стилей раскладки съезжают в
 * полноэкранном режиме». Так и было, и причина не в раскладке, а в том, что
 * место карточки хранится долей окна для ЦЕНТРА, а смена стиля меняет её
 * РАЗМЕР: карточка оставалась стоять прежним левым верхним углом и росла из
 * него, унося центр.
 *
 * Замер до правки («Совещание», 3440×1440): «Текущее время» 245×121 в круге,
 * 262×136 во флипе, 190×144 в аналоге; доля центра 0.783/0.120 → 0.785/0.124 →
 * 0.776/0.127. Четыре карточки ряда разъезжались каждая на своё число.
 *
 * Проверяется ДОЛЯ, а не пиксель: пиксель обязан меняться вместе с размером
 * карточки, а доля — нет, она и есть сохранённое место.
 */
test('перещёлкивание стилей не сдвигает разложенные карточки', async () => {
    test.setTimeout(180000);
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithEverything(control, app);
        await openDisplayDrawer(control);
        await control.evaluate(() => {
            const el = document.getElementById('eventTitleInput');
            if (el) { el.value = 'Ежегодная конференция'; el.dispatchEvent(new Event('input', { bubbles: true })); }
        });

        const fractions = () => display.evaluate((ids) => {
            const out = {};
            for (const id of ids) {
                const el = document.getElementById(id);
                if (!el) { continue; }
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height || getComputedStyle(el).display === 'none') { continue; }
                out[id] = {
                    cx: +((r.left + r.width / 2) / window.innerWidth).toFixed(4),
                    cy: +((r.top + r.height / 2) / window.innerHeight).toFixed(4),
                    w: Math.round(r.width),
                    h: Math.round(r.height)
                };
            }
            return out;
        }, MOVABLE.filter((m) => m.id !== 'heroLabel' && m.id !== 'statusPill').map((m) => m.node));

        for (const layout of ['conference', 'dashboard']) {
            await control.locator(`#displayLayoutGrid .layout-btn[data-layout="${layout}"]`).click();
            await display.waitForTimeout(1200);
            const base = await fractions();
            expect(Object.keys(base).length, `${layout}: карточек на экране нет`).toBeGreaterThan(2);

            let sizeChanged = false;
            for (const style of ['flip', 'analog', 'digits', 'circle']) {
                await control.click(`#displayTimerStyle button[data-val="${style}"]`);
                await display.waitForTimeout(900);
                const now = await fractions();
                for (const id of Object.keys(base)) {
                    const a = base[id];
                    const b = now[id];
                    expect(b, `${layout}/${style}: «${id}» исчез`).toBeTruthy();
                    if (a.w !== b.w || a.h !== b.h) { sizeChanged = true; }
                    expect(
                        Math.abs(b.cx - a.cx),
                        `${layout}/${style}: «${id}» уехал по горизонтали ${a.cx} → ${b.cx} (размер ${a.w}×${a.h} → ${b.w}×${b.h})`
                    ).toBeLessThanOrEqual(0.002);
                    expect(
                        Math.abs(b.cy - a.cy),
                        `${layout}/${style}: «${id}» уехал по вертикали ${a.cy} → ${b.cy} (размер ${a.w}×${a.h} → ${b.w}×${b.h})`
                    ).toBeLessThanOrEqual(0.002);
                }
            }
            // Проверка проверки: если карточки НЕ меняли размер, то доказано
            // ничего — совпадение долей вышло бы и без всякого пересчёта.
            expect(sizeChanged, `${layout}: карточки не изменили размер ни в одном стиле — проверка холостая`).toBe(true);
        }

        await resetDisplayState(control, display);
    } finally {
        await app.close();
    }
});
