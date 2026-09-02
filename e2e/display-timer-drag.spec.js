const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForDisplay } = require('./window-ready');

/**
 * Таймер полноэкранного окна ПЕРЕТАСКИВАЕТСЯ (просьба 24.08.2026: «в
 * полноэкранном режиме „Для совещания“ много воздуха сверху — сделать, чтобы
 * его можно было перемещать везде»).
 *
 * До этой правки двигались семь элементов из восьми: четыре карточки времени,
 * название, подпись и плашка. Сам таймер стоял по центру окна и подвинуть его
 * было НЕЧЕМ — оставалось менять раскладку целиком. «Воздух сверху» и есть
 * это: колонка героя центрируется по окну, и на широком экране над таймером
 * остаётся полоса, которую нечем занять.
 *
 * Проверяется движение, а не наличие обработчика: жест синтетический, но
 * ходит теми же событиями (altKey + screenX/screenY), что и мышь, а замер
 * снимается с НАСТОЯЩЕЙ коробки таймера.
 *
 * Тащим К ЦЕНТРУ окна: у края любой жест упрётся в поджатие, и тест мерил бы
 * границу, а не движение (этот класс ошибки в проекте уже был).
 */

/** Центр видимой коробки таймера и подписи над ним. */
const geometry = () => {
    const box = (el) => {
        if (!el) { return null; }
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), h: Math.round(r.height) };
    };
    const active = ['timerRing', 'timerFlip', 'timerAnalog', 'timerDigits']
        .map((id) => document.getElementById(id))
        .find((el) => el && el.classList.contains('active'));
    return {
        timer: box(active),
        label: box(document.getElementById('heroLabel')),
        moved: document.querySelector('.display-container').classList.contains('custom-position')
    };
};

/** Alt+перетаскивание за точку внутри коробки таймера. */
const dragTimer = (display, dx, dy, opts = {}) => display.evaluate(async ([dX, dY, alt]) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const active = ['timerRing', 'timerFlip', 'timerAnalog', 'timerDigits']
        .map((id) => document.getElementById(id))
        .find((el) => el && el.classList.contains('active'));
    const r = active.getBoundingClientRect();
    const o = (x, y) => new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, button: 0, altKey: alt,
        screenX: x, screenY: y, clientX: x, clientY: y
    });
    const down = (x, y) => new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, altKey: alt,
        screenX: x, screenY: y, clientX: x, clientY: y
    });
    const up = (x, y) => new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, altKey: alt,
        screenX: x, screenY: y, clientX: x, clientY: y
    });
    const px = Math.round(r.left + r.width / 2);
    const py = Math.round(r.top + r.height / 2);
    active.dispatchEvent(down(px, py));
    await wait(60);
    for (let i = 1; i <= 4; i++) {
        document.dispatchEvent(o(px + (dX * i) / 4, py + (dY * i) / 4));
        await wait(40);
    }
    document.dispatchEvent(up(px + dX, py + dY));
    await wait(60);
}, [dx, dy, opts.alt !== false]);

test('Alt+перетаскивание двигает таймер вместе с подписью и переживает переоткрытие', async () => {
    test.setTimeout(150000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        const display = await waitForDisplay(app);
        await control.waitForTimeout(2400);

        const before = await display.evaluate(geometry);
        expect(before.moved, 'таймер стоит сдвинутым ещё до жеста — профиль не чист').toBe(false);

        // Без Alt жест не должен делать ничего: проверка проверки.
        await dragTimer(display, 150, -100, { alt: false });
        const idle = await display.evaluate(geometry);
        expect(idle.timer, 'таймер поехал БЕЗ Alt — двигает что-то другое, и замер ниже ничего не значит')
            .toEqual(before.timer);

        // Дельта берётся ИЗ ОКНА, а не с монитора разработчика.
        //
        // Колонка героя поджимается к краям (display-script.js, MARGIN в
        // place()), и ход вверх равен ровно `colTop - 20`. Замер 26.08.2026 на
        // размерах раннеров: 1280×1024 — 118 px, 1024×737 — 66, 1024×720 — 63.
        // Прежние жёсткие −120 не помещались НИ на macOS, ни на Windows (там
        // спека и краснела), а на Linux помещались с запасом в два пикселя,
        // то есть держались на допуске.
        //
        // Половина расстояния до края помещается всегда, когда самого места
        // больше 40 px: поджатие стоит на 20. По горизонтали меряется коробка
        // ТАЙМЕРА, а не колонки: в потоке колонка занимает всю ширину окна и
        // про горизонтальный запас не говорит ничего.
        const room = await display.evaluate(() => {
            const c = document.querySelector('.display-container').getBoundingClientRect();
            const t = ['timerRing', 'timerFlip', 'timerAnalog', 'timerDigits']
                .map((id) => document.getElementById(id))
                .find((el) => el && el.classList.contains('active'))
                .getBoundingClientRect();
            return { up: Math.round(c.top), left: Math.round(t.left), h: window.innerHeight, w: window.innerWidth };
        });
        expect(room.up, `окно ${room.w}×${room.h}: до верхнего края ${room.up} px — двигать некуда, спека была бы холостой`)
            .toBeGreaterThanOrEqual(60);
        expect(room.left, `окно ${room.w}×${room.h}: до левого края ${room.left} px — двигать некуда`)
            .toBeGreaterThanOrEqual(120);
        const DX = -Math.floor(room.left / 2);
        const DY = -Math.floor(room.up / 2);
        console.log(`   окно ${room.w}×${room.h}, до края вверх ${room.up} влево ${room.left} → дельта ${DX},${DY}`);
        await dragTimer(display, DX, DY);
        await display.waitForTimeout(500);

        const after = await display.evaluate(geometry);
        console.log(`   таймер ${before.timer.x},${before.timer.y} → ${after.timer.x},${after.timer.y}`);
        expect(after.moved, 'таймер не перешёл в свободное положение').toBe(true);
        expect(Math.abs(after.timer.x - (before.timer.x + DX)),
            `таймер уехал не туда по X: ${after.timer.x} вместо ${before.timer.x + DX}`).toBeLessThanOrEqual(6);
        expect(Math.abs(after.timer.y - (before.timer.y + DY)),
            `таймер уехал не туда по Y: ${after.timer.y} вместо ${before.timer.y + DY}`).toBeLessThanOrEqual(6);

        // Подпись едет ВМЕСТЕ с таймером: она стоит в его колонке.
        console.log(`   подпись ${before.label.x},${before.label.y} → ${after.label.x},${after.label.y}`);
        expect(Math.abs(after.label.y - (before.label.y + DY)),
            'подпись отстала от таймера').toBeLessThanOrEqual(8);

        // Переоткрытие окна: место сохранено.
        await control.evaluate(() => window.ipcRenderer.send('close-display'));
        await control.waitForTimeout(900);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        const reopened = await waitForDisplay(app);
        await control.waitForTimeout(2600);
        const restored = await reopened.evaluate(geometry);
        console.log(`   после переоткрытия ${restored.timer.x},${restored.timer.y}`);
        expect(Math.abs(restored.timer.x - after.timer.x), 'место таймера не пережило переоткрытие').toBeLessThanOrEqual(8);
        expect(Math.abs(restored.timer.y - after.timer.y), 'место таймера не пережило переоткрытие').toBeLessThanOrEqual(8);

        // Раскладка возвращает таймер в поток: она владеет композицией целиком.
        await control.click('.tab-btn[data-tab="display"]');
        await control.click('#displayLayoutGrid button[data-layout="classic"]');
        await reopened.waitForTimeout(1200);
        const afterLayout = await reopened.evaluate(geometry);
        expect(afterLayout.moved, 'раскладка не вернула таймер в поток').toBe(false);
    } finally {
        // Профиль общий: раскладка включила тумблеры и записала места карточек,
        // а соседние спеки меряют вид ПО УМОЛЧАНИЮ.
        await control.evaluate(() => {
            localStorage.removeItem('displayBlockPositions');
            localStorage.removeItem('displayBlockScales');
            for (const key of ['showCurrentTime', 'showEventTime', 'showEndTime', 'showTimeLeft', 'showEventTitle']) {
                const el = document.getElementById(key);
                if (el && el.checked) { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }
            }
        }).catch(() => {});
        await control.waitForTimeout(500);
        await app.close();
    }
});

test('замок «Закрепить положение» держит и таймер', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        const display = await waitForDisplay(app);
        await control.waitForTimeout(2400);

        await control.click('#lockToggle');
        await display.waitForTimeout(700);
        const locked = await display.evaluate(() => document.documentElement.classList.contains('ui-locked'));
        expect(locked, 'замок не доехал до дисплея — проверять нечего').toBe(true);

        const before = await display.evaluate(geometry);
        await dragTimer(display, -160, -100);
        await display.waitForTimeout(400);
        const after = await display.evaluate(geometry);
        expect(after.timer, 'замок не остановил перетаскивание таймера').toEqual(before.timer);
    } finally {
        await control.click('#lockToggle').catch(() => {});
        await control.waitForTimeout(400);
        await app.close();
    }
});

/**
 * Пресет вида возвращает таймер НА МЕСТО.
 *
 * Снимок, записанный до того, как таймер двигали, ничего про него не знает:
 * в `displayBlockPositions` его записи просто нет. Применение обязано вернуть
 * колонку в поток — иначе на экране не тот вид, что записан, а ряд ячеек
 * показывает именно это сравнение (жалоба 24.08.2026 «не выделен никак, когда
 * я применил»).
 *
 * Возвращаются только те, чьё место — ПОТОК: подпись, плашка и колонка героя.
 * У карточки места в потоке нет вовсе, её положение задаёт класс угла.
 */
test('пресет возвращает сдвинутый таймер в поток и помечается применённым', async () => {
    test.setTimeout(150000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => {
            localStorage.removeItem('uiPresets');
            localStorage.removeItem('displayBlockPositions');
        });
        await control.reload();
        await control.waitForTimeout(1200);

        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        const display = await waitForDisplay(app);
        await control.waitForTimeout(2400);

        // Записываем вид, в котором таймер стоит по центру.
        const home = await display.evaluate(geometry);
        expect(home.moved, 'таймер уже сдвинут — записывать нечего').toBe(false);
        await control.click('#presetSlot3', { modifiers: ['Shift'] });
        await control.waitForTimeout(800);

        // Двигаем таймер — отметка обязана погаснуть.
        await dragTimer(display, -200, -140);
        await display.waitForTimeout(800);
        const moved = await display.evaluate(geometry);
        expect(moved.moved, 'таймер не сдвинулся — проверять нечего').toBe(true);
        const off = await control.evaluate(
            () => document.getElementById('presetSlot3').classList.contains('active')
        );
        expect(off, 'отметка не погасла после перетаскивания таймера').toBe(false);

        // Применяем ячейку: таймер обязан вернуться, ячейка — загореться.
        await control.click('#presetSlot3');
        await control.waitForTimeout(1600);

        const back = await display.evaluate(geometry);
        console.log(`   таймер ${moved.timer.x},${moved.timer.y} → ${back.timer.x},${back.timer.y} (был ${home.timer.x},${home.timer.y})`);
        expect(back.moved, 'пресет не вернул таймер в поток').toBe(false);
        expect(Math.abs(back.timer.x - home.timer.x), 'таймер вернулся не туда').toBeLessThanOrEqual(8);

        const on = await control.evaluate(() => ({
            active: document.getElementById('presetSlot3').classList.contains('active'),
            caption: document.getElementById('presetCaption').textContent
        }));
        console.log(`   ячейка после применения: ${JSON.stringify(on)}`);
        expect(on.active, 'применённая ячейка не помечена').toBe(true);
        expect(on.caption, 'подпись ряда не назвала ячейку').toContain('3');
    } finally {
        await control.evaluate(() => {
            localStorage.removeItem('uiPresets');
            localStorage.removeItem('displayBlockPositions');
        }).catch(() => {});
        await app.close();
    }
});
