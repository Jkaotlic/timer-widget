'use strict';

/**
 * Скрытый режим «47-й этаж» ПО КЛИКУ.
 *
 * Unit-тесты проверяют арифметику (money-meter) и проводку (floor-47); здесь
 * проверяется то, чего они увидеть не могут: доезжают ли деньги до
 * НАСТОЯЩЕГО окна дисплея и в тех ли числах.
 *
 * Профиль e2e общий, поэтому спека возвращает глобальное состояние: режим
 * запирается обратно, тумблеры гасятся, накопитель обнуляется.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/** Неразрывный пробел — им разделены разряды суммы (money-meter.js). */
const NB = '\u00A0';

const IS_DISPLAY = () => !!document.getElementById('progressRing');

async function findDisplay(app) {
    for (const w of app.windows()) {
        if (await w.evaluate(IS_DISPLAY).catch(() => false)) { return w; }
    }
    return null;
}

/**
 * Тумблер переключается КЛИКОМ по ползунку, а не присвоением `.checked`:
 * сам чекбокс спрятан вёрсткой (`opacity: 0; width: 0`), и Playwright по нему
 * не попадёт. Клик по ползунку — то же, что делает рука.
 */
async function setToggle(control, id, on) {
    const box = control.locator(`#${id}`);
    if (await box.isChecked() === on) { return; }
    await control.locator(`#${id} + .toggle-slider`).click();
    await expect(box).toBeChecked({ checked: on });
}

/** Секция живёт в ящике настроек — без открытой вкладки её не видно. */
async function openDisplayTab(control) {
    await control.click('.tab-btn[data-tab="display"]');
    await control.waitForTimeout(600);
}

/**
 * Тройной клик — ОДНИМ жестом (clickCount: 3), а не тремя вызовами click():
 * разблокировка смотрит на `event.detail`, который браузер считает сам, и три
 * разнесённых во времени клика дали бы detail = 1.
 */
async function unlock(control) {
    await control.locator('#panelFooter').click({ clickCount: 3 });
    await expect(control.locator('#floor47Section')).toBeVisible();
}

/** Вернуть общий профиль в исходное состояние. */
async function relock(control) {
    await control.evaluate(() => {
        window.ipcRenderer.send('event-reset');
        for (const id of ['showOverrunCost', 'showTotalCost', 'floor47Unlocked']) {
            const el = document.getElementById(id);
            if (el && el.checked) { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }
    }).catch(() => {});
}

test('до разблокировки денег в панели нет — и зонд это умеет отличить', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        // Вкладку открываем ДО проверки: иначе «не видно» означало бы всего лишь
        // «ящик закрыт», и спека была бы зелёной при полностью открытом режиме.
        await openDisplayTab(control);
        await expect(control.locator('#floor47Section')).toBeHidden();
        const hiddenProp = await control.evaluate(() => document.getElementById('floor47Section').hidden);
        expect(hiddenProp, 'секция не скрыта своим атрибутом, а лишь не видна').toBe(true);

        // Само-проверка: тот же зонд ПОСЛЕ разблокировки находит секцию. Без
        // этой пары зелёный означал бы и «скрыто», и «зонд ничего не ищет».
        await unlock(control);
        await expect(control.locator('#floor47Section')).toBeVisible();
    } finally {
        await relock(control);
        await app.close();
    }
});

test('ступени: 1000 ₽ за каждые 3 секунды перелимита — числом', async () => {
    test.setTimeout(150000);
    const { app, control } = await launchApp();
    try {
        await openDisplayTab(control);
        await unlock(control);
        await control.fill('#overrunPrice', '1000');
        await control.fill('#overrunPeriod', '3');
        await setToggle(control, 'showOverrunCost', true);
        await setToggle(control, 'showTotalCost', true);
        await control.waitForTimeout(400);

        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2400);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        // Перелимит задаётся ПРЯМО, а не выжидается: настоящие секунды сделали
        // бы спеку медленной и зависящей от скорости машины, а проверяется
        // здесь не ход времени, а арифметика ступени на границах периода.
        const money = async (secondsOver) => {
            await display.evaluate((s) => {
                window.displayTimer.remainingSeconds = -s;
                window.displayTimer.updateMoneyBlocks();
            }, secondsOver);
            return {
                over: await display.locator('#overrunCostValue').textContent(),
                total: await display.locator('#totalCostValue').textContent()
            };
        };

        const table = [[2, `0${NB}₽`], [3, `1${NB}000${NB}₽`], [5, `1${NB}000${NB}₽`], [6, `2${NB}000${NB}₽`]];
        for (const [seconds, expected] of table) {
            const got = await money(seconds);
            console.log(`   перелимит ${seconds} с → «${got.over}», итого «${got.total}»`);
            expect(got.over, `${seconds} с при ставке 1000/3`).toBe(expected);
        }

        // Оба блока слушаются ТУМБЛЕРА и в плюсе тоже: раскладка кладёт
        // элементы по живым габаритам, а у спрятанного прямоугольник нулевой —
        // прятавшийся «Перелимит» оставался в домашнем углу поверх соседа.
        await display.evaluate(() => {
            window.displayTimer.remainingSeconds = 60;
            window.displayTimer.updateMoneyBlocks();
        });
        await expect(display.locator('#overrunCostBlock')).toHaveClass(/visible/);
        await expect(display.locator('#totalCostBlock')).toHaveClass(/visible/);
        expect(await display.locator('#overrunCostValue').textContent(),
            'в плюсе перелимит обязан показывать ноль, а не прошлую сумму').toBe(`0${NB}₽`);
    } finally {
        await control.evaluate(() => window.ipcRenderer.send('close-display')).catch(() => {});
        await relock(control);
        await app.close();
    }
});

test('«Новое мероприятие» спрашивает и обнуляет накопитель', async () => {
    test.setTimeout(150000);
    const { app, control } = await launchApp();
    try {
        await openDisplayTab(control);
        await unlock(control);
        await control.fill('#overrunPrice', '1000');
        await control.fill('#overrunPeriod', '3');
        await setToggle(control, 'showTotalCost', true);

        // Завершение мероприятия закрывает текущий перелимит и замораживает
        // итог. С 27.08.2026 оно тоже спрашивает подтверждение: вернуть счёт
        // можно только начав новое мероприятие, а это стирает накопленное.
        await control.locator('#eventFinishBtn').click();
        await expect(control.locator('#eventFinish')).toBeVisible();
        await control.locator('#eventFinishConfirm').click();
        await expect(control.locator('#eventFinish')).toBeHidden();

        // Обнуление необратимо и спрашивает модалкой, а не window.confirm.
        await control.locator('#eventResetBtn').click();
        await expect(control.locator('#eventReset')).toBeVisible();
        await control.locator('#eventResetConfirm').click();
        await expect(control.locator('#eventReset')).toBeHidden();

        // Обнуление обязано доехать до накопителя, а не только до кнопки:
        // окно, открытое ПОСЛЕ него, снимает состояние на загрузке.
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2400);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();
        const total = await display.locator('#totalCostValue').textContent();
        console.log(`   итого после обнуления: «${total}»`);
        expect(total).toBe('0\u00A0₽');
    } finally {
        await control.evaluate(() => window.ipcRenderer.send('close-display')).catch(() => {});
        await relock(control);
        await app.close();
    }
});

test('раскладка «47-й этаж» появляется только с режимом и раскладывает деньги ПО КЛИКУ', async () => {
    test.setTimeout(200000);
    const { app, control } = await launchApp();
    try {
        await openDisplayTab(control);
        // Кнопки секретной раскладки на запертом профиле нет вовсе — иначе она
        // рассказывала бы про режим каждому, кто открыл настройки.
        const btn = control.locator('#displayLayoutGrid .layout-btn[data-layout="floor47"]');
        await expect(btn).toHaveCount(0);
        // Само-проверка зонда: обычные кнопки он видит и на запертом профиле.
        await expect(control.locator('#displayLayoutGrid .layout-btn')).not.toHaveCount(0);

        await unlock(control);
        await expect(btn).toHaveCount(1);

        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2400);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        await btn.click();
        await display.waitForTimeout(1600);

        const seen = await display.evaluate(() => {
            const box = (id) => {
                const el = document.getElementById(id);
                const r = el.getBoundingClientRect();
                return {
                    visible: el.classList.contains('visible'),
                    cx: Math.round(r.left + r.width / 2),
                    cy: Math.round(r.top + r.height / 2)
                };
            };
            return { over: box('overrunCostBlock'), total: box('totalCostBlock'), w: window.innerWidth };
        });
        console.log(`   перелимит ${seen.over.cx},${seen.over.cy} · итого ${seen.total.cx},${seen.total.cy} · окно ${seen.w}`);

        expect(seen.over.visible, 'раскладка не включила «Перелимит»').toBe(true);
        expect(seen.total.visible, 'раскладка не включила «Итого»').toBe(true);
        // Зеркально по бокам от таймера: один левее середины, другой правее.
        expect(seen.over.cx, '«Перелимит» не слева от центра').toBeLessThan(seen.w / 2);
        expect(seen.total.cx, '«Итого» не справа от центра').toBeGreaterThan(seen.w / 2);
        // И на одной высоте — раскладка задумана симметричной.
        expect(Math.abs(seen.over.cy - seen.total.cy),
            `деньги встали на разной высоте: ${seen.over.cy} против ${seen.total.cy}`).toBeLessThanOrEqual(8);
    } finally {
        await control.evaluate(() => {
            window.ipcRenderer.send('close-display');
            localStorage.removeItem('displayBlockPositions');
            localStorage.removeItem('displayBlockScales');
        }).catch(() => {});
        await relock(control);
        await app.close();
    }
});

test('«Новое мероприятие» обнуляет экран, даже когда таймер в МИНУСЕ', async () => {
    // Жалоба 27.08.2026 «нельзя скинуть итог». Накопитель обнулялся, а на
    // экране оставалась прежняя сумма: дисплей прибавляет к накопителю ТЕКУЩИЙ
    // перелимит, и таймер в этот момент всё ещё в минусе.
    //
    // Таймер здесь уводится в минус ПО-НАСТОЯЩЕМУ, а не присвоением поля: весь
    // смысл проверки в том, что про минус знает и главный процесс, который
    // ставит отсечку.
    test.setTimeout(200000);
    const { app, control } = await launchApp();
    try {
        await openDisplayTab(control);
        await unlock(control);
        await control.fill('#overrunPrice', '1000');
        await control.fill('#overrunPeriod', '3');
        await setToggle(control, 'showOverrunCost', true);
        await setToggle(control, 'showTotalCost', true);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2400);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        await control.evaluate(() => window.ipcRenderer.send('timer-command',
            { type: 'set', seconds: 1, allowNegative: true }));
        await control.waitForTimeout(300);
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
        await control.waitForTimeout(8000);

        const money = () => display.evaluate(() => ({
            over: document.getElementById('overrunCostValue').textContent,
            total: document.getElementById('totalCostValue').textContent
        }));
        const before = await money();
        console.log(`   в минусе: перелимит «${before.over}», итого «${before.total}»`);
        expect(before.total, 'таймер не ушёл в минус — обнулять нечего').not.toBe(`0${NB}₽`);

        await control.locator('#eventResetBtn').click();
        await expect(control.locator('#eventReset')).toBeVisible();
        await control.locator('#eventResetConfirm').click();
        await control.waitForTimeout(1200);

        const after = await money();
        console.log(`   после сброса: перелимит «${after.over}», итого «${after.total}»`);
        expect(after.total, 'итог не обнулился, пока таймер в минусе').toBe(`0${NB}₽`);
        expect(after.over, 'перелимит не обнулился, пока таймер в минусе').toBe(`0${NB}₽`);

        // Отсечка снимается сама: минус, натикавший ПОСЛЕ сброса, снова считается.
        await control.waitForTimeout(4500);
        const later = await money();
        console.log(`   ещё 4,5 с спустя: перелимит «${later.over}»`);
        expect(later.over, 'после сброса счёт не возобновился').not.toBe(`0${NB}₽`);
    } finally {
        await control.evaluate(() => {
            window.ipcRenderer.send('timer-command', { type: 'reset' });
            window.ipcRenderer.send('close-display');
        }).catch(() => {});
        await relock(control);
        await app.close();
    }
});
