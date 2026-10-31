'use strict';

/**
 * main-control-ipc.js на поддельных окне и экране: обработчики размера панели
 * и режима «полоса» вызываются по-настоящему, проверяются ГРАНИЦЫ окна.
 *
 * Модуль получает electron параметрами, поэтому подставка тут — ровно то, что
 * он трогает: окно (размер, позиция, пол и потолок) и screen (мониторы).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG = require('../constants');
const { registerControlIpc } = require('../main-control-ipc');

function makeWindow({ x, y, width, height }) {
    return {
        _pos: [x, y],
        _size: [width, height],
        _min: [CONFIG.CONTROL_WINDOW_MIN_WIDTH, CONFIG.CONTROL_WINDOW_MIN_HEIGHT],
        _max: [CONFIG.CONTROL_WINDOW_MAX_WIDTH_WITH_DRAWER, CONFIG.CONTROL_WINDOW_MAX_HEIGHT_WITH_DRAWER],
        _onTop: false,
        // События webContents ХРАНЯТСЯ: перезагрузка страницы — это событие,
        // и без него «main узнал о reload» непроверяемо.
        webContents: (() => {
            const ev = new Map();
            const on = (e, fn) => { if (!ev.has(e)) { ev.set(e, []); } ev.get(e).push(fn); };
            return {
                on, once: on,
                emit: (e, ...a) => { for (const fn of (ev.get(e) || []).slice()) { fn(...a); } },
                listenerCount: (e) => (ev.get(e) || []).length
            };
        })(),
        isDestroyed: () => false,
        getSize() { return this._size.slice(); },
        setSize(w, h) { this._size = [w, h]; },
        getPosition() { return this._pos.slice(); },
        setPosition(px, py) { this._pos = [px, py]; },
        getBounds() { return { x: this._pos[0], y: this._pos[1], width: this._size[0], height: this._size[1] }; },
        setBounds(b) { this._pos = [b.x, b.y]; this._size = [b.width, b.height]; },
        getMaximumSize() { return this._max.slice(); },
        setMaximumSize(w, h) { this._max = [w, h]; },
        getMinimumSize() { return this._min.slice(); },
        setMinimumSize(w, h) { this._min = [w, h]; },
        setAlwaysOnTop(flag) { this._onTop = flag; }
    };
}

// Главный монитор 1920×1080 (полоска меню 25px сверху, workArea 1920×1015)
// и второй ПОД ним: глобальный y второго начинается с 1080.
const PRIMARY = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1015 },
    workAreaSize: { width: 1920, height: 1015 }
};
const BELOW = {
    bounds: { x: 0, y: 1080, width: 2560, height: 1440 },
    workArea: { x: 0, y: 1080, width: 2560, height: 1400 },
    workAreaSize: { width: 2560, height: 1400 }
};

function makeScreen(displays) {
    const contains = (d, r) => {
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        return cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width
            && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height;
    };
    return {
        getPrimaryDisplay: () => displays[0],
        getAllDisplays: () => displays,
        getDisplayMatching: (r) => displays.find((d) => contains(d, r)) || displays[0]
    };
}

function setup(win, displays) {
    const handlers = new Map();
    const windows = { controlWindow: win };
    const noop = () => {};
    registerControlIpc({
        ipcMain: { on: (ch, fn) => handlers.set(ch, fn) },
        windows,
        screen: makeScreen(displays),
        CONFIG,
        shell: { openExternal: () => Promise.resolve() },
        app: { quit: noop },
        log: { warn: noop, error: noop, info: noop },
        getSession: () => ({}),
        clearTimerInterval: noop
    });
    return { handlers, windows };
}

test('MAIN-01: ресайз панели на мониторе ПОД главным не переносит её на главный', () => {
    const win = makeWindow({ x: 100, y: 1200, width: 400, height: 700 });
    const { handlers } = setup(win, [PRIMARY, BELOW]);
    // Открытие ящика: панель шлёт только ширину.
    handlers.get('resize-control-window')(null, { width: 736 });

    const b = win.getBounds();
    assert.equal(b.width, 736);
    assert.deepEqual([b.x, b.y], [100, 1200], 'окно влезает в свой монитор — позиция не трогается');
});

test('MAIN-01: вылезающее за низ своего монитора окно поднимается в ЕГО рабочей области', () => {
    const win = makeWindow({ x: 100, y: 2000, width: 400, height: 700 });
    const { handlers } = setup(win, [PRIMARY, BELOW]);
    handlers.get('resize-control-window')(null, { height: 1000 });

    const b = win.getBounds();
    assert.equal(b.height, 1000);
    const bottom = BELOW.workArea.y + BELOW.workArea.height;
    assert.ok(b.y >= BELOW.workArea.y, `верх ${b.y} внутри монитора, а не на главном`);
    assert.ok(b.y + b.height <= bottom, `низ ${b.y + b.height} не ниже рабочей области ${bottom}`);
});

test('MAIN-01: подъём учитывает workArea.y (панель задач Windows сверху)', () => {
    // Панель задач 60px СВЕРХУ: рабочая область начинается с y = 60.
    const TOP_TASKBAR = {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 60, width: 1920, height: 1020 },
        workAreaSize: { width: 1920, height: 1020 }
    };
    const win = makeWindow({ x: 100, y: 300, width: 400, height: 700 });
    const { handlers } = setup(win, [TOP_TASKBAR]);
    // Высота почти во всю рабочую область: прежний подъём считал от y = 0
    // и ставил верх окна ПОД панель задач.
    handlers.get('resize-control-window')(null, { height: 1100 });

    const b = win.getBounds();
    const wa = TOP_TASKBAR.workArea;
    assert.ok(b.y >= wa.y, `верх ${b.y} не под панелью задач (${wa.y})`);
    assert.ok(b.y + b.height <= wa.y + wa.height);
});

test('MAIN-01: размер не изменился — окно не трогается вовсе (без дрейфа)', () => {
    const win = makeWindow({ x: 100, y: 2000, width: 400, height: 700 });
    let calls = 0;
    win.setSize = () => { calls++; };
    win.setPosition = () => { calls++; };
    const { handlers } = setup(win, [PRIMARY, BELOW]);
    handlers.get('resize-control-window')(null, { width: 400, height: 700 });
    assert.equal(calls, 0);
});

test('MAIN-09: перезагрузка страницы свёрнутой панели разворачивает окно в main', () => {
    // Рендерер после reload (крах → bindRenderCrashHandler) стартует
    // развёрнутым, а main держал окно полосой: пол снят, поверх всех окон.
    const win = makeWindow({ x: 100, y: 200, width: 400, height: 700 });
    const { handlers } = setup(win, [PRIMARY]);
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    assert.equal(win.getBounds().height, 52);
    assert.equal(win._onTop, true);

    win.webContents.emit('did-start-loading');

    assert.deepEqual(win.getBounds(), { x: 100, y: 200, width: 400, height: 700 }, 'прежние границы вернулись');
    assert.equal(win._onTop, false, 'поверх всех окон снято');
    assert.deepEqual(win.getMinimumSize(), [CONFIG.CONTROL_WINDOW_MIN_WIDTH, CONFIG.CONTROL_WINDOW_MIN_HEIGHT], 'пол вернулся');
});

test('MAIN-09: повторное «свернуть» не перезаписывает границы до свёртки границами полосы', () => {
    const win = makeWindow({ x: 100, y: 200, width: 400, height: 700 });
    const { handlers } = setup(win, [PRIMARY]);
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    handlers.get('control-collapse')(null, { collapsed: false });
    assert.deepEqual(win.getBounds(), { x: 100, y: 200, width: 400, height: 700 });
});

test('MAIN-09: свёртка нового окна панели берёт ЕГО границы, а не оставшиеся от старого', () => {
    const first = makeWindow({ x: 100, y: 200, width: 400, height: 700 });
    const { handlers, windows } = setup(first, [PRIMARY]);
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    // Панель закрыли полосой и создали заново (трей).
    const second = makeWindow({ x: 500, y: 300, width: 420, height: 720 });
    windows.controlWindow = second;
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    handlers.get('control-collapse')(null, { collapsed: false });
    assert.deepEqual(second.getBounds(), { x: 500, y: 300, width: 420, height: 720 });
});

test('MAIN-09: обработчик перезагрузки вешается на окно один раз, а не на каждую свёртку', () => {
    const win = makeWindow({ x: 100, y: 200, width: 400, height: 700 });
    const { handlers } = setup(win, [PRIMARY]);
    for (let i = 0; i < 5; i++) {
        handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
        handlers.get('control-collapse')(null, { collapsed: false });
    }
    assert.ok(win.webContents.listenerCount('did-start-loading') <= 1);
});

test('MINIBAR-RACE: запрос размера по содержимому, пришедший в свёрнутую панель, окно не разворачивает', () => {
    // Панель через 100 мс после загрузки шлёт resize-control-window
    // (autoResizeWindow, control-app.js). Свёртка, успевшая раньше, им
    // перезаписывалась: окно 400×660 поверх всех окон, разметка полосой.
    const win = makeWindow({ x: 100, y: 200, width: 400, height: 700 });
    const { handlers } = setup(win, [PRIMARY]);
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    const bar = win.getBounds();

    handlers.get('resize-control-window')(null, { width: 400, height: 660 });
    handlers.get('resize-control-window')(null, { width: 736 });

    assert.deepEqual(win.getBounds(), bar, 'полоса осталась полосой');
    assert.equal(win._onTop, true);

    handlers.get('control-collapse')(null, { collapsed: false });
    assert.deepEqual(win.getBounds(), { x: 100, y: 200, width: 400, height: 700 }, 'разворот вернул границы до свёртки');
});

test('MINIBAR-RACE: после разворота запрос размера снова работает', () => {
    const win = makeWindow({ x: 100, y: 200, width: 400, height: 700 });
    const { handlers } = setup(win, [PRIMARY]);
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    handlers.get('control-collapse')(null, { collapsed: false });
    handlers.get('resize-control-window')(null, { height: 800 });
    assert.equal(win.getBounds().height, 800);
});

test('MINIBAR-RACE: перезагрузка свёрнутой панели снимает запрет на размер', () => {
    // Путь краш-обработчика: reload разворачивает окно в main (MAIN-09), и
    // первый авто-размер новой страницы обязан пройти.
    const win = makeWindow({ x: 100, y: 200, width: 400, height: 700 });
    const { handlers } = setup(win, [PRIMARY]);
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    win.webContents.emit('did-start-loading');
    handlers.get('resize-control-window')(null, { height: 800 });
    assert.equal(win.getBounds().height, 800);
});

test('MINIBAR-RACE: запрет — у свёрнутого ОКНА, панель, пересозданная из трея, его не наследует', () => {
    const first = makeWindow({ x: 100, y: 200, width: 400, height: 700 });
    const { handlers, windows } = setup(first, [PRIMARY]);
    handlers.get('control-collapse')(null, { collapsed: true, height: 52 });
    const second = makeWindow({ x: 500, y: 300, width: 420, height: 720 });
    windows.controlWindow = second;
    handlers.get('resize-control-window')(null, { height: 800 });
    assert.equal(second.getBounds().height, 800);
});
