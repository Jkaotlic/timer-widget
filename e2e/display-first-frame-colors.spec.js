const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    openDisplay, closeDisplay, waitForWidget, waitForWidgetGone, waitForSteady
} = require('./window-ready');

/**
 * ПЕРВЫЙ кадр окна — в цветах СВОЕГО ключа, до досылки главного процесса.
 *
 * Дефект (разведка 29.10.2026): дисплей на старте красился `timerColors`, а
 * это цвета ВИДЖЕТА (панель пишет их туда ради отката на прошлую версию).
 * Свои `displayColors` дисплей получал только досылкой main после открытия,
 * поэтому до неё — чужой цвет. Виджет тоже читал `timerColors`, хотя его
 * ключ — `widgetColors`.
 *
 * Как снимается «до досылки»: досылку перехватываем в ГЛАВНОМ процессе —
 * `WebContents.prototype.send` роняет канал цветов окна, пока идёт замер.
 * Тогда всё, что окно показывает, оно взяло из хранилища само, при загрузке.
 * Ждать «пока досылка не пришла» нельзя: она приходит на did-finish-load,
 * то есть раньше, чем тест успевает прочитать окно.
 *
 * Читаем ВЫЧИСЛЕННОЕ значение `--timer-color` на корне — им красятся цифры
 * всех стилей; на чистом профиле его нет вовсе (владелец умолчания — CSS).
 */

let app;
let control;

const KEYS = ['widgetColors', 'displayColors', 'timerColors'];
const RED = '#ff0000';
const GREEN = '#00ff00';
const BLUE = '#0000ff';

function readTimerColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--timer-color').trim();
}

/** Засеять цвета в общий localStorage (origin один на четыре окна). */
async function seed(entries) {
    await control.evaluate(({ keys, entries: e }) => {
        for (const k of keys) { localStorage.removeItem(k); }
        for (const [k, v] of Object.entries(e)) { localStorage.setItem(k, JSON.stringify(v)); }
    }, { keys: KEYS, entries });
}

/** Ронять в main рассылку канала `channel`; возвращает функцию снятия. */
async function blockChannel(channel) {
    await app.evaluate(({ webContents }, ch) => {
        const proto = Object.getPrototypeOf(webContents.getAllWebContents()[0]);
        if (!globalThis.__twOrigSend) { globalThis.__twOrigSend = proto.send; }
        globalThis.__twDropped = 0;
        proto.send = function (name, ...args) {
            if (name === ch) { globalThis.__twDropped += 1; return; }
            return globalThis.__twOrigSend.call(this, name, ...args);
        };
    }, channel);
    return async () => app.evaluate(({ webContents }) => {
        const proto = Object.getPrototypeOf(webContents.getAllWebContents()[0]);
        if (globalThis.__twOrigSend) { proto.send = globalThis.__twOrigSend; }
        delete globalThis.__twOrigSend;
        return globalThis.__twDropped;
    });
}

let saved;

test.beforeAll(async () => {
    ({ app, control } = await launchApp());
    saved = await control.evaluate((keys) => Object.fromEntries(
        keys.map((k) => [k, localStorage.getItem(k)])
    ), KEYS);
});

test.afterAll(async () => {
    // Профиль общий на прогон: вернуть ровно то, что было.
    await control.evaluate((s) => {
        for (const [k, v] of Object.entries(s)) {
            if (v === null) { localStorage.removeItem(k); } else { localStorage.setItem(k, v); }
        }
    }, saved).catch(() => {});
    await app.close();
});

test('дисплей: первый кадр — цвета displayColors, а не timerColors виджета', async () => {
    await seed({ widgetColors: { timer: RED }, displayColors: { timer: GREEN }, timerColors: { timer: RED } });
    const unblock = await blockChannel('display-colors-update');
    let dropped;
    try {
        const display = await openDisplay(app, control);
        const color = await display.evaluate(readTimerColor);
        console.log(`[first-frame] display --timer-color = ${color}`);
        expect(color, 'дисплей обязан краситься СВОИМ ключом displayColors').toBe(GREEN);
        await closeDisplay(app, control);
    } finally {
        // Не маскировать исходный сбой, если приложение уже упало.
        dropped = await unblock().catch(() => undefined);
    }
    console.log(`[first-frame] перехвачено досылок display-colors-update: ${dropped}`);
    // Самопроверка: досылка БЫЛА и была перехвачена. Иначе сломанный перехват
    // оставлял бы тест зелёным, проверяя уже не первый кадр.
    expect(dropped, 'досылка display-colors-update не перехвачена').toBeGreaterThan(0);
});

test('дисплей, профиль старше поканальных цветов: первый кадр = осевший (без запасного пути)', async () => {
    // Панель досылает дисплею `displayColors || {}` — без timerColors, — и
    // осевшее состояние такого профиля есть CSS-умолчание. Запасной путь на
    // timerColors давал вспышку цветов ВИДЖЕТА до досылки на самом частом
    // профиле (меняли только цвета виджета). Сравниваем с ОСЕВШИМ значением,
    // а не с литералом: то, к чему окно приходит, задаёт досылка панели.
    await seed({ timerColors: { timer: BLUE } });
    const unblock = await blockChannel('display-colors-update');
    let display;
    let first;
    try {
        display = await openDisplay(app, control);
        first = await display.evaluate(readTimerColor);
    } finally {
        await unblock().catch(() => {});
    }
    // Досылка с ЭТИМ профилем: панель раскладывает цвета заново и шлёт их тем
    // же путём, что на старте; main передаёт их открытому дисплею.
    await control.evaluate(() => window.timerController.loadWindowColors());
    const settled = await waitForSteady(display, readTimerColor, { name: '--timer-color дисплея' });
    console.log(`[first-frame] old profile: first = '${first}', settled = '${settled}'`);
    expect(first, 'первый кадр дисплея обязан совпасть с осевшим').toBe(settled);
    expect(first, 'дисплей взял timerColors виджета').not.toBe(BLUE);
    await closeDisplay(app, control);
});

test('дисплей: displayColors = {} — свой ключ («всё по CSS»), timerColors не берётся', async () => {
    await seed({ displayColors: {}, timerColors: { timer: RED } });
    const unblock = await blockChannel('display-colors-update');
    try {
        const display = await openDisplay(app, control);
        expect(await display.evaluate(readTimerColor)).toBe('');
        await closeDisplay(app, control);
    } finally {
        await unblock().catch(() => {});
    }
});

test('виджет: первый кадр — цвета widgetColors, а не timerColors', async () => {
    // Панель пишет оба ключа одним значением, поэтому расхождение засеяно
    // руками: проверяется, КАКОЙ ключ окно читает.
    await seed({ widgetColors: { timer: RED }, timerColors: { timer: BLUE } });
    const unblock = await blockChannel('widget-colors-update');
    let dropped;
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-widget'));
        const widget = await waitForWidget(app);
        expect(await widget.evaluate(readTimerColor)).toBe(RED);
        await control.evaluate(() => window.ipcRenderer.send('close-widget'));
        await waitForWidgetGone(app);
    } finally {
        dropped = await unblock().catch(() => undefined);
    }
    console.log(`[first-frame] перехвачено досылок widget-colors-update: ${dropped}`);
    expect(dropped, 'досылка widget-colors-update не перехвачена').toBeGreaterThan(0);
});
