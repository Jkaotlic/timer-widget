'use strict';

/**
 * Загружает electron-main.js по-настоящему, подсунув заглушку модуля 'electron'.
 *
 * До этого весь main-процесс покрывался только регексами по исходнику
 * (electron-main-source.test.js), поэтому ошибка времени загрузки — опечатка в
 * имени, обращение к переменной до инициализации, сломанный require — прошла бы
 * мимо тестов. Здесь модуль реально исполняется, а заодно появляется возможность
 * дёрнуть IPC-обработчики и проверить их поведение, а не текст.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { SENDERS } = require('../ipc-senders');

const repoRoot = path.join(__dirname, '..');

// --- Заглушки -------------------------------------------------------------

function createStubs() {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-main-load-'));
    // Обработчики, как их зарегистрировал главный процесс, — уже С проверкой
    // отправителя (SEC-07). Звать их нужно событием от настоящего окна.
    const ipcRaw = new Map();
    const appHandlers = new Map();
    const noop = () => {};

    // Что главный процесс РАССЫЛАЕТ окнам.
    //
    // Пока `send` был заглушкой-пустышкой, подставка молча съедала весь
    // исходящий поток: тест не мог отличить «главный процесс разослал верное
    // состояние» от «не разослал ничего». Для проверок, где важен именно
    // ответ окнам (журнал докладов, результат выгрузки), это разница между
    // проверкой и её видимостью.
    const sent = [];
    const lastSent = (channel) => {
        for (let i = sent.length - 1; i >= 0; i--) {
            if (sent[i].channel === channel) { return sent[i].payload; }
        }
        return null;
    };

    const created = [];
    class StubBrowserWindow {
        constructor(opts = {}) {
            this.opts = opts;
            this._size = [opts.width || 0, opts.height || 0];
            this._position = [opts.x || 0, opts.y || 0];
            this._minWidth = opts.minWidth || 0;
            this._minHeight = opts.minHeight || 0;
            this._maxWidth = opts.maxWidth || 0;
            this._maxHeight = opts.maxHeight || 0;
            this._fullscreen = !!opts.fullscreen;
            this._destroyed = false;
            // Главный кадр: проверка отправителя сравнивает с ним senderFrame и
            // берёт из него адрес страницы. Адрес ставит loadFile — как в Electron.
            // События webContents ХРАНЯТСЯ, как и события окна: гидратация
            // окна живёт на `did-finish-load`, и без этого «окно получило
            // снимок при загрузке» было непроверяемо (BUG-01).
            const wcEvents = new Map();
            const wcOn = (event, fn) => {
                if (!wcEvents.has(event)) { wcEvents.set(event, []); }
                wcEvents.get(event).push(fn);
            };
            this.webContents = {
                mainFrame: { url: '' },
                on: wcOn, once: wcOn,
                emit: (event, ...args) => {
                    for (const fn of (wcEvents.get(event) || []).slice()) { fn(...args); }
                },
                // `win` — кому именно ушло: рассылка всем окнам и адресная
                // отправка одному иначе неразличимы.
                send: (channel, payload) => { sent.push({ channel, payload, win: this }); },
                isDestroyed: () => this._destroyed,
                setWindowOpenHandler: noop, setZoomFactor: noop,
                setZoomLevel: noop, setVisualZoomLevelLimits: noop, openDevTools: noop
            };
            created.push(this);
        }
        static getAllWindows() { return created; }
        static fromWebContents(wc) { return created.find((w) => w.webContents === wc) || null; }
        loadFile(file) {
            this._file = file;
            this.webContents.mainFrame.url = pathToFileURL(path.join(repoRoot, file)).href;
            return Promise.resolve();
        }
        // События окна ХРАНЯТСЯ, а не выбрасываются.
        //
        // Пока `on`/`once` были пустыми, подставка не умела главного, что
        // делает настоящее окно: закрыться. Любая логика главного процесса,
        // построенная на `once('closed', …)` — а на ней держится переоткрытие
        // дисплея, — исполнялась «в пустоту», и тест этого не видел.
        on(event, fn) {
            if (!this._events) { this._events = new Map(); }
            if (!this._events.has(event)) { this._events.set(event, []); }
            this._events.get(event).push(fn);
        }
        once(event, fn) { this.on(event, fn); }
        emit(event, ...args) {
            const list = (this._events && this._events.get(event)) || [];
            // Копия списка: обработчик может подписаться на то же событие.
            for (const fn of list.slice()) { fn(...args); }
        }
        show() {} hide() {} minimize() {}
        // Закрытие как в Electron: окно разрушается СРАЗУ, а событие `closed`
        // приходит следующим оборотом цикла. Между этими двумя моментами
        // ссылка в главном процессе ещё указывает на окно — именно в этот
        // зазор и попадала команда «открыть».
        close() {
            if (this._destroyed) { return; }
            this._destroyed = true;
            setTimeout(() => this.emit('closed'), 0);
        }
        // Настоящее окно на этом бросает «Object has been destroyed».
        focus() {
            if (this._destroyed) { throw new Error('Object has been destroyed'); }
        }
        isFullScreen() { return !!this._fullscreen; }
        setFullScreen(value) {
            const was = this._fullscreen;
            this._fullscreen = !!value;
            if (was && !this._fullscreen) { this.emit('leave-full-screen'); }
        }
        isVisible() { return true; }
        isMinimized() { return false; }
        isDestroyed() { return this._destroyed; }
        getSize() { return this._size.slice(); }
        getPosition() { return this._position.slice(); }
        setPosition(x, y) { this._position = [x, y]; }
        setSize(w, h) { this._size = [w, h]; }
        // Уровень окна: виджет и часы поднимаются выше полоски меню сразу после
        // конструктора. Метода тут не было — и добавление этого вызова роняло
        // создание окна ещё до регистрации остального (см. window-top-edge).
        setAlwaysOnTop(flag, level) { this._alwaysOnTop = { flag, level }; }
        // Подставка обязана уметь то же, что настоящее окно. Пока здесь были
        // только четыре метода выше, главный процесс мог звать getBounds/
        // setBounds/getMinimumSize и падать — но тесты этого не видели, потому
        // что до соответствующих веток не доходили. Отсутствие метода в
        // подставке не делает его ненужным, оно делает проверку слепой.
        getBounds() {
            return { x: this._position[0], y: this._position[1], width: this._size[0], height: this._size[1] };
        }
        setBounds(b) {
            if (Number.isFinite(b.x) && Number.isFinite(b.y)) { this._position = [b.x, b.y]; }
            if (Number.isFinite(b.width) && Number.isFinite(b.height)) { this._size = [b.width, b.height]; }
        }
        getMinimumSize() { return [this._minWidth || 0, this._minHeight || 0]; }
        // Панель теперь реально создаётся в тестах (она — отправитель своих
        // каналов, SEC-07), и её обработчики доходят до потолка и пола окна.
        setMinimumSize(w, h) { this._minWidth = w; this._minHeight = h; }
        getMaximumSize() { return [this._maxWidth || 0, this._maxHeight || 0]; }
        setMaximumSize(w, h) { this._maxWidth = w; this._maxHeight = h; }
        restore() {}
    }

    const electron = {
        app: {
            getVersion: () => '0.0.0-test',
            // userData — ВРЕМЕННЫЙ каталог, а не корень репозитория.
            //
            // Пока здесь стоял repoRoot, тесты писали в рабочее дерево: как
            // только главный процесс научился сохранять журнал докладов, в
            // корне проекта после каждого прогона оседал event-overrun.json.
            // Такой файл ничем не отличается от кода на `git add .` — а
            // состояние прошлого прогона ещё и подмешивалось бы в следующий.
            getPath: () => userDataDir,
            isPackaged: false,
            // События приложения ХРАНЯТСЯ: окно панели создаётся в whenReady
            // (здесь он не резолвится) или по 'second-instance' — второй путь
            // и нужен тестам, которым нужна панель как отправитель.
            on: (event, fn) => { appHandlers.set(event, fn); },
            quit: noop,
            exit: noop,
            // Никогда не резолвится — блок whenReady() не должен исполняться,
            // иначе тест начнёт создавать окна и трей.
            whenReady: () => new Promise(() => {}),
            requestSingleInstanceLock: () => true,
            commandLine: { appendSwitch: noop }
        },
        BrowserWindow: StubBrowserWindow,
        ipcMain: {
            on: (channel, handler) => { ipcRaw.set(channel, handler); }
        },
        screen: {
            _displays: [
                { bounds: { x: 0, y: 0, width: 1920, height: 1080 },
                    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
                    workAreaSize: { width: 1920, height: 1040 } }
            ],
            getAllDisplays() { return this._displays; },
            getPrimaryDisplay() { return this._displays[0]; }
        },
        Menu: { setApplicationMenu: noop, buildFromTemplate: () => ({}) },
        shell: { openExternal: () => Promise.resolve() },
        Tray: class { setToolTip() {} setContextMenu() {} on() {} },
        nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
        powerMonitor: { on: noop },
        session: { defaultSession: {} }
    };

    const stubs = { electron, ipcRaw, appHandlers, created, sent, lastSent, userDataDir };
    stubs.ipcHandlers = legitimateSenders(stubs);
    return stubs;
}

/**
 * Событие IPC от окна — то, что Electron передаёт обработчику.
 * `subframe: true` — сообщение из iframe того же окна.
 */
function eventFrom(win, { subframe = false } = {}) {
    const frame = subframe ? { url: win.webContents.mainFrame.url } : win.webContents.mainFrame;
    return {
        sender: win.webContents,
        senderFrame: frame,
        reply: (channel, payload) => win.webContents.send(channel, payload)
    };
}

const ROLE_FILES = {
    control: 'electron-control.html',
    widget: 'electron-widget.html',
    clock: 'electron-clock-widget.html',
    display: 'display.html'
};

function liveWindow(stubs, role) {
    return stubs.created.find((w) => w._file === ROLE_FILES[role] && !w.isDestroyed()) || null;
}

// Окно панели через штатный путь главного процесса (второй экземпляр).
function openControl(stubs) {
    const existing = liveWindow(stubs, 'control');
    if (existing) { return existing; }
    stubs.appHandlers.get('second-instance')();
    return liveWindow(stubs, 'control');
}

/**
 * `stubs.ipcHandlers.get(канал)(null, payload)` — «прислало окно, которому
 * этот канал принадлежит».
 *
 * Тесты поведения обработчиков (их десятки) писались, когда отправитель не
 * проверялся, и звали обработчик с `null` вместо события. Смысл у них один:
 * «пришло штатное сообщение». Этот адаптер подставляет событие от первого
 * ЖИВОГО окна из строки канала в таблице ipc-senders.js (панель при нужде
 * открывает); явно переданное событие не трогает — им проверяется отказ.
 */
function legitimateSenders(stubs) {
    return {
        has: (channel) => stubs.ipcRaw.has(channel),
        get size() { return stubs.ipcRaw.size; },
        get(channel) {
            const handler = stubs.ipcRaw.get(channel);
            if (!handler) { return undefined; }
            return (event, ...args) => {
                if (event === null || event === undefined) {
                    const roles = SENDERS[channel] || [];
                    let win = roles.map((r) => liveWindow(stubs, r)).find(Boolean);
                    if (!win && roles.includes('control')) { win = openControl(stubs); }
                    event = win ? eventFrom(win) : {};
                }
                return handler(event, ...args);
            };
        }
    };
}

// Загружает electron-main.js с подменённым 'electron' и 'electron-log/main'.
function loadMain(stubs) {
    // Журнал НЕ выбрасывается, а копится в `stubs.logged`: что главный процесс
    // пишет в лог — тоже поведение (полный путь с именем пользователя в файле
    // журнала — утечка, SEC-11), и проверять его можно только поймав записи.
    // Параметры `log.initialize()` сохраняются по той же причине (SEC-05).
    stubs.logged = [];
    const record = (level) => (...args) => {
        stubs.logged.push({ level, text: args.map((a) => String(a)).join(' ') });
    };
    const logStub = {
        initialize: (options) => { stubs.logInitialize = { called: true, options }; },
        info: record('info'), warn: record('warn'), error: record('error'),
        debug: record('debug'), verbose: record('verbose'),
        transports: { file: {}, console: {} }
    };

    // electron-main.js намеренно делает process.exit(1), если унаследована
    // переменная ELECTRON_RUN_AS_NODE (см. guard в начале файла). Тесты вполне
    // могут запускаться из окружения, где она выставлена — например, из
    // терминала внутри Electron-приложения, — поэтому снимаем её на время
    // загрузки и возвращаем обратно.
    const savedRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
    delete process.env.ELECTRON_RUN_AS_NODE;

    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === 'electron') { return stubs.electron; }
        if (request === 'electron-log/main') { return logStub; }
        return originalLoad.call(this, request, parent, isMain);
    };

    const mainPath = require.resolve(path.join(repoRoot, 'electron-main.js'));
    delete require.cache[mainPath];
    try {
        require(mainPath);
    } finally {
        Module._load = originalLoad;
        delete require.cache[mainPath];
        if (savedRunAsNode !== undefined) {
            process.env.ELECTRON_RUN_AS_NODE = savedRunAsNode;
        }
    }
}

// --- Тесты ----------------------------------------------------------------

test('electron-main.js загружается без ошибок и регистрирует IPC-каналы', () => {
    const stubs = createStubs();
    loadMain(stubs);

    // Выборка каналов из разных частей файла — если модуль оборвался на
    // полпути, часть из них не зарегистрируется.
    for (const channel of [
        'timer-command', 'get-timer-state', 'widget-set-position',
        'clock-widget-set-position', 'open-display', 'quit-app'
    ]) {
        assert.ok(stubs.ipcHandlers.has(channel), `канал ${channel} должен быть зарегистрирован`);
    }
});

// Открывает виджет через штатный IPC-путь и возвращает окно-заглушку.
function openWidget(stubs) {
    stubs.ipcHandlers.get('open-widget')(null);
    const win = stubs.created[stubs.created.length - 1];
    assert.ok(win, 'open-widget должен создать окно');
    return win;
}

test('позиция в пределах подключённого монитора восстанавливается как есть', () => {
    const stubs = createStubs();
    loadMain(stubs);
    const win = openWidget(stubs);

    stubs.ipcHandlers.get('widget-set-position')(null, { x: 100, y: 200 });
    assert.deepEqual(win.getPosition(), [100, 200]);
});

test('позиция с отключённого монитора поджимается на экран', () => {
    // Сценарий: виджет сохранил позицию на втором мониторе, монитор отключили.
    // Без клампинга окно уехало бы за пределы видимой области, и вернуть его
    // мышью было бы невозможно.
    //
    // Область укладки — ГРАНИЦЫ экрана (1080), а не рабочая область (1040):
    // виджет держится выше полоски меню и вправе стоять у самого края, иначе
    // поставленное туда окно после перезапуска съезжало бы вниз.
    const stubs = createStubs();
    loadMain(stubs);
    const win = openWidget(stubs);
    const [w, h] = win.getSize();

    // Единственный монитор — 1920×1080, рабочая область 1920×1040.
    stubs.ipcHandlers.get('widget-set-position')(null, { x: 5000, y: 5000 });
    assert.deepEqual(win.getPosition(), [1920 - w, 1080 - h]);

    stubs.ipcHandlers.get('widget-set-position')(null, { x: -5000, y: -5000 });
    assert.deepEqual(win.getPosition(), [0, 0]);
});

test('позиция на втором подключённом мониторе не поджимается', () => {
    const stubs = createStubs();
    // Второй монитор справа от основного.
    stubs.electron.screen._displays.push({
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
        workAreaSize: { width: 1920, height: 1040 }
    });
    loadMain(stubs);
    const win = openWidget(stubs);

    stubs.ipcHandlers.get('widget-set-position')(null, { x: 2500, y: 300 });
    assert.deepEqual(win.getPosition(), [2500, 300]);
});

test('обработчики позиции игнорируют мусорные payload-ы', () => {
    const stubs = createStubs();
    loadMain(stubs);

    for (const channel of ['widget-set-position', 'clock-widget-set-position']) {
        const handler = stubs.ipcHandlers.get(channel);
        for (const payload of [undefined, null, 'строка', 42, [], { x: NaN, y: 0 },
            { x: Infinity, y: 0 }, { x: '10', y: '20' }, {}]) {
            assert.doesNotThrow(
                () => handler(null, payload),
                `${channel} не должен падать на payload ${JSON.stringify(payload)}`
            );
        }
    }
});

test('обработчики геометрии не падают на мусорных payload-ах', () => {
    const stubs = createStubs();
    loadMain(stubs);

    for (const channel of ['widget-resize', 'widget-move', 'clock-widget-resize',
        'clock-widget-move', 'display-move', 'resize-control-window']) {
        const handler = stubs.ipcHandlers.get(channel);
        assert.ok(handler, `канал ${channel} должен быть зарегистрирован`);
        for (const payload of [undefined, null, 'x', 0, [], {}, { width: NaN }]) {
            assert.doesNotThrow(
                () => handler(null, payload),
                `${channel} не должен падать на payload ${JSON.stringify(payload)}`
            );
        }
    }
});

test('timer-command переживает отсутствующий и мусорный payload', () => {
    const stubs = createStubs();
    loadMain(stubs);

    const handler = stubs.ipcHandlers.get('timer-command');
    for (const payload of [undefined, {}, { type: 'нет такого' }, { type: 'set' },
        { type: 'set', seconds: 'абв' }, { type: 'adjust', deltaSeconds: NaN }]) {
        assert.doesNotThrow(
            () => handler(null, payload),
            `timer-command не должен падать на payload ${JSON.stringify(payload)}`
        );
    }
});

// Окна дисплея среди созданных — по файлу, который окно грузило.
function displayWindows(stubs) {
    return stubs.created.filter((w) => w._file === 'display.html');
}

test('«закрыть» и сразу «открыть»: окно дисплея остаётся, и оно ОДНО', async () => {
    // Поведенческая половина разбора «закрывающееся окно — не открытое».
    // Source-тест (electron-main-source.test.js) проверяет, что вопрос задан;
    // здесь проверяется ОТВЕТ — на подставке, которая умеет закрываться так
    // же, как настоящее окно: выйти из полноэкранного режима, дождаться
    // события, закрыться следующим оборотом цикла.
    const stubs = createStubs();
    loadMain(stubs);

    stubs.ipcHandlers.get('open-display')(null, { displayIndex: 'auto' });
    const first = displayWindows(stubs)[0];
    assert.ok(first, 'open-display должен создать окно дисплея');
    assert.equal(first.isFullScreen(), true, 'окно дисплея создаётся полноэкранным');

    // Закрытие началось, но ещё не закончилось: главный процесс ждёт своего
    // таймера в 120 мс после leave-full-screen.
    stubs.ipcHandlers.get('close-display')(null);
    assert.equal(first.isDestroyed(), false, 'закрытие полноэкранного окна не мгновенно');

    // И ровно в этот момент приходит «открыть» — то, что человек делает
    // кнопкой, а раннер CI получает сам собой из-за медленной машины.
    stubs.ipcHandlers.get('open-display')(null, { displayIndex: 'auto' });

    await new Promise((r) => setTimeout(r, 400));

    assert.equal(first.isDestroyed(), true, 'старое окно обязано закрыться');
    const alive = displayWindows(stubs).filter((w) => !w.isDestroyed());
    assert.equal(
        alive.length, 1,
        `после close→open должно остаться РОВНО одно живое окно дисплея, а их ${alive.length}. `
        + '0 — команду «открыть» проглотило закрытие; 2 — у отложенного открытия нет владельца'
    );
    assert.notEqual(alive[0], first, 'живым обязано быть НОВОЕ окно, а не то, что закрывали');
});

test('два «открыть» во время закрытия дают одно окно, а «закрыть» отменяет отложенное', async () => {
    const stubs = createStubs();
    loadMain(stubs);

    stubs.ipcHandlers.get('open-display')(null, { displayIndex: 'auto' });
    stubs.ipcHandlers.get('close-display')(null);
    stubs.ipcHandlers.get('open-display')(null, { displayIndex: 'auto' });
    stubs.ipcHandlers.get('open-display')(null, { displayIndex: 'auto' });
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(
        displayWindows(stubs).filter((w) => !w.isDestroyed()).length, 1,
        'два запроса «открыть» подряд обязаны дать ОДНО окно: второе стало бы неуправляемым'
    );

    // А человек, передумавший посреди закрытия, не должен получить окно назад.
    const stubs2 = createStubs();
    loadMain(stubs2);
    stubs2.ipcHandlers.get('open-display')(null, { displayIndex: 'auto' });
    stubs2.ipcHandlers.get('close-display')(null);
    stubs2.ipcHandlers.get('open-display')(null, { displayIndex: 'auto' });
    stubs2.ipcHandlers.get('close-display')(null);
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(
        displayWindows(stubs2).filter((w) => !w.isDestroyed()).length, 0,
        '«закрыть» обязано отменять отложенное открытие — иначе окно возрождается само'
    );
});

// Окна по файлу, который они грузили: у подставки нет другого признака вида.
function windowsOf(stubs, file) {
    return stubs.created.filter((w) => w._file === file);
}

const REOPEN_CASES = [
    { who: 'виджет', file: 'electron-widget.html', open: 'open-widget', close: 'close-widget' },
    { who: 'часы', file: 'electron-clock-widget.html', open: 'open-clock-widget', close: 'close-clock-widget' }
];

for (const c of REOPEN_CASES) {
    test(`${c.who}: «закрыть» и сразу «открыть» оставляет окно`, async () => {
        // Тот же дефект, что был у дисплея, и полноэкранный режим тут ни при
        // чём: `close()` разрушает окно сразу, а событие `closed` — то, что
        // обнуляет ссылку в главном процессе, — приходит следующим оборотом
        // цикла. Команда «открыть», попавшая в этот зазор, видела живую ссылку
        // и уходила в `focus()`.
        //
        // Замер на настоящем Electron 09.09.2026: `close-widget` и
        // `open-widget` без паузы между ними — через 4 секунды у приложения
        // одно окно, панель. У часов так же. Сценарий человеческий: нажать
        // клавишу закрытия и тут же клавишу открытия.
        const stubs = createStubs();
        loadMain(stubs);

        stubs.ipcHandlers.get(c.open)(null);
        const first = windowsOf(stubs, c.file)[0];
        assert.ok(first, `${c.open} должен создать окно`);

        stubs.ipcHandlers.get(c.close)(null);
        stubs.ipcHandlers.get(c.open)(null);
        await new Promise((r) => setTimeout(r, 100));

        const alive = windowsOf(stubs, c.file).filter((w) => !w.isDestroyed());
        assert.equal(
            alive.length, 1,
            `после close→open должно остаться РОВНО одно живое окно (${c.who}), а их ${alive.length}. `
            + '0 — команду «открыть» проглотило закрытие; 2 — у отложенного открытия нет владельца'
        );
        assert.notEqual(alive[0], first, 'живым обязано быть НОВОЕ окно');
    });

    test(`${c.who}: «закрыть» отменяет запланированное открытие`, async () => {
        const stubs = createStubs();
        loadMain(stubs);

        stubs.ipcHandlers.get(c.open)(null);
        stubs.ipcHandlers.get(c.close)(null);
        stubs.ipcHandlers.get(c.open)(null);
        stubs.ipcHandlers.get(c.close)(null);
        await new Promise((r) => setTimeout(r, 100));

        assert.equal(
            windowsOf(stubs, c.file).filter((w) => !w.isDestroyed()).length, 0,
            'человек, передумавший посреди закрытия, не должен получить окно назад'
        );
    });
}

// --- Журнал докладов -------------------------------------------------------

/**
 * Событие от окна панели — единственного законного отправителя выгрузки.
 *
 * До SEC-07 здесь был «отправитель» без окна: главный процесс не спрашивал,
 * кто пишет. Теперь такое событие отвергается до обработчика, и тест
 * проверял бы тишину. Ответ панели попадает в тот же журнал `sent`.
 */
function fakeEvent(stubs) {
    return eventFrom(openControl(stubs));
}

/**
 * Остановить таймер после теста.
 *
 * С разрешённым минусом таймер не останавливается сам НИКОГДА — в этом весь
 * смысл перелимита. Оставленный работать, он держит цикл событий, и `node
 * --test` не завершается вовсе: прогон выглядит зависшим, хотя все проверки
 * прошли.
 */
function stopTimer(stubs) {
    stubs.ipcHandlers.get('timer-command')(null, { type: 'pause' });
    stubs.ipcHandlers.get('timer-command')(null, { type: 'reset', allowNegative: false });
}

/**
 * Открыть окно дисплея.
 *
 * Без него рассылка состояния мероприятия уходит в никуда: broadcast шлёт
 * ТОЛЬКО в открытые окна, а `loadMain` окон не создаёт (whenReady в подставке
 * не резолвится намеренно). Проверять рассылку, не открыв ни одного окна, —
 * это проверять тишину.
 */
function openDisplay(stubs) {
    stubs.ipcHandlers.get('open-display')(null, { displayIndex: 'auto' });
}

/**
 * Провести доклад с перелимитом: короткий пресет, старт, уход в минус.
 *
 * Ждать нужно ДОЛЬШЕ секунды сверх пресета: перелимит считается целыми
 * секундами (`Math.floor` в money-meter.js), и доклад, просроченный на 300 мс,
 * стоит ноль — накопитель его не заметит, а тест решит, что журнал сломан.
 */
async function runOvertimeTalk(stubs, ms = 2600) {
    // `allowNegative: true` обязателен: без него таймер ОСТАНАВЛИВАЕТСЯ на
    // нуле, перелимита не возникает вовсе, и тест про журнал проверял бы
    // тишину. Перелимит — это про минус, а минус в приложении разрешается
    // настройкой.
    stubs.ipcHandlers.get('timer-command')(null, { type: 'set', seconds: 1, allowNegative: true });
    stubs.ipcHandlers.get('timer-command')(null, { type: 'start', allowNegative: true });
    await new Promise((r) => setTimeout(r, ms));
}

test('закрытый доклад попадает в журнал, а не только в итог', async () => {
    // Доклад «закрывается» при выходе таймера из минуса — это определение уже
    // живёт в accrueOverrun(), и записывать журнал обязано ровно то же место:
    // два места, знающие «доклад закончился», разойдутся на первой правке.
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    await runOvertimeTalk(stubs);
    stubs.ipcHandlers.get('timer-command')(null, { type: 'reset' });
    await new Promise((r) => setTimeout(r, 50));

    const payload = stubs.lastSent('event-overrun-state');
    assert.ok(payload, 'состояние мероприятия обязано рассылаться');
    assert.ok(payload.talksCount >= 1, 'журнал обязан пополниться вместе с итогом');
    assert.ok(payload.overrunSeconds > 0, 'итог тоже обязан вырасти');
    stopTimer(stubs);
});

test('«Завершить мероприятие» дописывает последний доклад в журнал', async () => {
    // Иначе последний доклад окажется в итоге, но не в разбивке, и суммы в
    // отчёте разойдутся без всякой причины.
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    await runOvertimeTalk(stubs);
    stubs.ipcHandlers.get('event-finish')(null);

    const payload = stubs.lastSent('event-overrun-state');
    assert.equal(payload.finished, true);
    assert.ok(payload.talksCount >= 1, 'замороженный итог обязан иметь запись о последнем докладе');
    stopTimer(stubs);
});

test('«Новое мероприятие» очищает журнал вместе с итогом', async () => {
    // Стереть итог, оставив разбивку, — это отчёт о несуществующем.
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    await runOvertimeTalk(stubs);
    stubs.ipcHandlers.get('event-finish')(null);
    stubs.ipcHandlers.get('event-reset')(null);

    const payload = stubs.lastSent('event-overrun-state');
    assert.equal(payload.overrunSeconds, 0);
    assert.equal(payload.talksCount, 0);
    stopTimer(stubs);
});

// --- Выгрузка отчёта -------------------------------------------------------

test('event-export пишет НАСТОЯЩИЙ файл и отвечает результатом', async () => {
    // Файл пишется на диск по-настоящему, во временный каталог: подменять `fs`
    // целиком нельзя — его же используют хранилище и восстановление, и
    // подставка вместо него сделала бы проверку разговором с самой собой.
    // Подменяется только диалог, то есть ровно то, что требует человека с мышью.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    const target = path.join(dir, 'отчёт.csv');
    const stubs = createStubs();
    stubs.electron.dialog = {
        showSaveDialog: async () => ({ canceled: false, filePath: target })
    };
    loadMain(stubs);
    openDisplay(stubs);

    try {
        await runOvertimeTalk(stubs);
        stubs.ipcHandlers.get('event-finish')(null);
        stopTimer(stubs);

        stubs.ipcHandlers.get('event-export')(fakeEvent(stubs));
        await new Promise((r) => setTimeout(r, 120));

        assert.ok(fs.existsSync(target), 'файл обязан появиться на диске');
        const csv = fs.readFileSync(target, 'utf8');
        assert.match(csv, /Итого/);
        assert.equal(csv.charCodeAt(0), 0xFEFF, 'без BOM Excel прочтёт кириллицу как мусор');

        const answer = stubs.lastSent('event-export-done');
        assert.ok(answer, 'панель обязана узнать результат — молчание она показать не может');
        assert.equal(answer.ok, true);
        assert.equal(answer.path, target);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('отмена диалога — не ошибка', async () => {
    // Человек передумал. Тост про ошибку в этом месте — враньё.
    const stubs = createStubs();
    stubs.electron.dialog = {
        showSaveDialog: async () => ({ canceled: true, filePath: undefined })
    };
    loadMain(stubs);
    openDisplay(stubs);

    stubs.ipcHandlers.get('event-export')(fakeEvent(stubs));
    await new Promise((r) => setTimeout(r, 120));

    const answer = stubs.lastSent('event-export-done');
    assert.equal(answer.ok, false);
    assert.equal(answer.canceled, true);
    assert.ok(!answer.error, 'отмена не должна выглядеть поломкой');
});

test('ошибка записи доходит до панели, а не тонет в логе', async () => {
    // Молчаливый выход здесь уже стоил проекту отдельной сессии: человек жмёт
    // кнопку, ничего не происходит, и почему — не сказано нигде.
    const stubs = createStubs();
    stubs.electron.dialog = {
        // Каталога не существует — запись обязана провалиться.
        showSaveDialog: async () => ({ canceled: false, filePath: '/нет/такого/пути/отчёт.csv' })
    };
    loadMain(stubs);
    openDisplay(stubs);

    stubs.ipcHandlers.get('event-export')(fakeEvent(stubs));
    await new Promise((r) => setTimeout(r, 120));

    const answer = stubs.lastSent('event-export-done');
    assert.equal(answer.ok, false);
    assert.ok(answer.error, 'причина отказа обязана дойти до человека');
});

// --- Доклады, уложившиеся в срок -------------------------------------------
//
// Конец доклада — возврат ЗАПУЩЕННОГО таймера в покой: сброс или новый пресет
// дают одно состояние (остаток = тотал, не идёт, не на паузе). Пресет, который
// поставили и не запускали, докладом не считается: иначе журнал наполнялся бы
// строками от перебора пресетов.

const cmd = (stubs, payload) => stubs.ipcHandlers.get('timer-command')(null, payload);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('уложившийся доклад попадает в журнал с нулём перелимита', async () => {
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    cmd(stubs, { type: 'set', seconds: 5 });
    cmd(stubs, { type: 'start' });
    await wait(1300);
    cmd(stubs, { type: 'reset' });
    await wait(50);

    const payload = stubs.lastSent('event-overrun-state');
    assert.ok(payload, 'закрытие доклада обязано разослать состояние');
    assert.equal(payload.talksCount, 1, 'уложившийся доклад — тоже доклад');
    assert.equal(payload.overrunSeconds, 0, 'нули на итог не влияют');
    stopTimer(stubs);
});

test('пресет, который не запускали, докладом не считается', async () => {
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    cmd(stubs, { type: 'set', seconds: 5 });
    cmd(stubs, { type: 'set', seconds: 10 });
    cmd(stubs, { type: 'set', seconds: 15 });
    // «Завершить» рассылает состояние — им и проверяем, что записей нет. Он же
    // заодно проверяет, что завершение не выдумывает доклад из покоя.
    stubs.ipcHandlers.get('event-finish')(null);

    assert.equal(stubs.lastSent('event-overrun-state').talksCount, 0);
});

test('старт и тут же сброс — не доклад', async () => {
    // Случайное нажатие. Ни одной секунды не прошло — записывать нечего.
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    cmd(stubs, { type: 'set', seconds: 5 });
    cmd(stubs, { type: 'start' });
    cmd(stubs, { type: 'reset' });
    await wait(50);
    stubs.ipcHandlers.get('event-finish')(null);

    assert.equal(stubs.lastSent('event-overrun-state').talksCount, 0);
});

test('выход из минуса посреди доклада не дробит его на две записи', async () => {
    // Время можно добавить прямо в перелимите — таймер выходит из минуса, но
    // доклад продолжается. Одна запись на доклад, а его перелимит — сумма.
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    await runOvertimeTalk(stubs);
    cmd(stubs, { type: 'adjust', deltaSeconds: 60 });
    await wait(1200);
    cmd(stubs, { type: 'reset' });
    await wait(50);

    const payload = stubs.lastSent('event-overrun-state');
    assert.equal(payload.talksCount, 1, 'один доклад — одна запись');
    assert.ok(payload.overrunSeconds >= 1, 'перелимит этого доклада обязан быть в итоге');
    stopTimer(stubs);
});

test('после «Завершить» новые доклады в журнал не идут', async () => {
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    stubs.ipcHandlers.get('event-finish')(null);
    cmd(stubs, { type: 'set', seconds: 5 });
    cmd(stubs, { type: 'start' });
    await wait(1300);
    cmd(stubs, { type: 'reset' });
    await wait(50);

    assert.equal(stubs.lastSent('event-overrun-state').talksCount, 0, 'итог заморожен — журнал тоже');
    stopTimer(stubs);
});

test('доклад, шедший во время «Нового мероприятия», в новое не попадает', async () => {
    // Тот же принцип, что у отсечки минуса: текущий доклад к новому
    // мероприятию не относится.
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    cmd(stubs, { type: 'set', seconds: 5 });
    cmd(stubs, { type: 'start' });
    await wait(1300);
    stubs.ipcHandlers.get('event-reset')(null);
    // Доклад ПРОДОЛЖАЕТСЯ после отсечки хотя бы тик. Без этой паузы тест
    // проходил по признаку «секунда не прошла», а не по самой отсечке: первая
    // версия сбрасывала таймер сразу, и снятая отсечка оставалась зелёной —
    // поймано мутацией.
    await wait(1300);
    cmd(stubs, { type: 'reset' });
    await wait(50);

    assert.equal(stubs.lastSent('event-overrun-state').talksCount, 0);

    // А следующий доклад — уже законная запись нового мероприятия.
    cmd(stubs, { type: 'start' });
    await wait(1300);
    cmd(stubs, { type: 'reset' });
    await wait(50);
    assert.equal(stubs.lastSent('event-overrun-state').talksCount, 1);
    stopTimer(stubs);
});

test('«Завершить» посреди уложившегося доклада записывает его', async () => {
    // Мероприятие кончилось на этом докладе — он в нём был.
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    cmd(stubs, { type: 'set', seconds: 30 });
    cmd(stubs, { type: 'start' });
    await wait(1300);
    stubs.ipcHandlers.get('event-finish')(null);

    const payload = stubs.lastSent('event-overrun-state');
    assert.equal(payload.talksCount, 1);
    assert.equal(payload.overrunSeconds, 0);
    stopTimer(stubs);
});

test('«Завершить» после «Нового мероприятия» не пишет отсечённый доклад', async () => {
    // Вторая дорога той же отсечки: доклад, шедший при «Новом мероприятии»,
    // не становится записью и тогда, когда его закрывает «Завершить».
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);

    cmd(stubs, { type: 'set', seconds: 30 });
    cmd(stubs, { type: 'start' });
    await wait(1300);
    stubs.ipcHandlers.get('event-reset')(null);
    await wait(1300);
    stubs.ipcHandlers.get('event-finish')(null);

    assert.equal(stubs.lastSent('event-overrun-state').talksCount, 0);
    stopTimer(stubs);
});

// --- Безопасность главного процесса (ПСИ 2026-09-25) -----------------------

test('SEC-11: в журнал уходит ИМЯ файла отчёта, а не полный путь', async () => {
    // Полный путь сохранения — это почти всегда домашний каталог, то есть имя
    // учётной записи пользователя (`/Users/<имя>/…`, `C:\Users\<имя>\…`).
    // Файл журнала прикладывают к обращениям в поддержку и собирают сканером
    // на ПСИ — утечка личных данных туда недопустима. Для разбора достаточно
    // имени файла и числа строк: где он лежит, человек знает сам.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-log-'));
    const target = path.join(dir, 'отчёт-журнал.csv');
    const stubs = createStubs();
    stubs.electron.dialog = {
        showSaveDialog: async () => ({ canceled: false, filePath: target })
    };
    loadMain(stubs);
    openDisplay(stubs);
    try {
        stubs.ipcHandlers.get('event-export')(fakeEvent(stubs));
        await new Promise((r) => setTimeout(r, 120));
        assert.ok(fs.existsSync(target), 'выгрузка обязана пройти — иначе проверять нечего');

        const exportLines = stubs.logged.filter((l) => l.text.includes('[export]'));
        assert.ok(exportLines.length > 0, 'запись о выгрузке в журнале обязана остаться');
        for (const line of stubs.logged) {
            assert.ok(!line.text.includes(dir), `в журнал ушёл полный путь: ${line.text}`);
        }
        assert.ok(
            exportLines.some((l) => l.text.includes('отчёт-журнал.csv')),
            'имя файла в журнале обязано остаться — по нему запись и находят'
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('SEC-05: electron-log не вешает свой preload в окна', () => {
    // `log.initialize()` без параметров регистрирует ВТОРОЙ preload в каждой
    // сессии: он кладёт в окно `window.__electronLog` и открывает канал
    // `__ELECTRON_LOG__` мимо белого списка preload.js. Рендерерам он не нужен:
    // их консоль и так доходит до журнала через `console-message`
    // (bindRenderConsole).
    const stubs = createStubs();
    loadMain(stubs);
    assert.ok(stubs.logInitialize && stubs.logInitialize.called, 'log.initialize обязан вызываться');
    assert.ok(stubs.logInitialize.options, 'log.initialize вызван без параметров — preload включён по умолчанию');
    assert.equal(stubs.logInitialize.options.preload, false, 'preload electron-log обязан быть выключен');
});

// Грузит main «собранным» приложением с заданными ключами командной строки.
// process.exit подменяется ИСКЛЮЧЕНИЕМ: настоящий выход не даёт исполниться
// ни строке после себя, и подставка обязана вести себя так же — иначе тест
// «ничего не создано» проверял бы продолжение, которого в жизни нет.
function loadPackagedWith(switches) {
    const stubs = createStubs();
    const exits = [];
    stubs.electron.app.isPackaged = true;
    stubs.electron.app.exit = (code) => { exits.push(['app.exit', code]); };
    stubs.electron.app.commandLine = {
        appendSwitch: () => {},
        hasSwitch: (name) => switches.includes(name)
    };
    const EXIT = new Error('process.exit');
    const realExit = process.exit;
    process.exit = (code) => { exits.push(['process.exit', code]); throw EXIT; };
    let threw = null;
    try {
        loadMain(stubs);
    } catch (err) {
        threw = err;
    } finally {
        process.exit = realExit;
    }
    if (threw && threw !== EXIT) { throw threw; }
    return { stubs, exits };
}

for (const sw of ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk']) {
    test(`SEC-04: собранное приложение с --${sw} выходит до первого окна`, () => {
        // Ключ отладки открывает DevTools-протокол: через него исполняется
        // любой код в любом окне — мимо sandbox, CSP и белого списка IPC.
        // Гард devTools в окнах тут не помогает: протокол живёт в Chromium.
        const { stubs, exits } = loadPackagedWith([sw]);
        assert.deepEqual(exits[0], ['app.exit', 1], 'выход обязан быть с кодом 1');
        assert.equal(stubs.created.length, 0, 'окно создано до выхода');
        assert.equal(stubs.ipcHandlers.size, 0, 'IPC зарегистрирован до выхода — main продолжил работу');
    });
}

test('SEC-04: без ключей отладки собранное приложение стартует', () => {
    const { stubs, exits } = loadPackagedWith([]);
    assert.deepEqual(exits, [], 'выход без ключа отладки — гард срабатывает не на то');
    assert.ok(stubs.ipcHandlers.has('timer-command'), 'main не дошёл до регистрации каналов');
});

test('SEC-04: в разработке ключ отладки разрешён (им пользуется Playwright)', () => {
    // e2e поднимает НЕсобранное приложение с --remote-debugging-port — так
    // Playwright к нему и подключается. Гард обязан смотреть на isPackaged.
    const stubs = createStubs();
    stubs.electron.app.commandLine = {
        appendSwitch: () => {},
        hasSwitch: (name) => name === 'remote-debugging-port'
    };
    let exited = false;
    stubs.electron.app.exit = () => { exited = true; };
    loadMain(stubs);
    assert.equal(exited, false);
    assert.ok(stubs.ipcHandlers.has('timer-command'));
});

test('SEC-11: и ошибка записи не приносит в журнал полный путь', async () => {
    // Сообщение fs содержит путь целиком («ENOENT: …, open '/Users/<имя>/…'»),
    // и `log.error(err)` уносил бы его в файл журнала мимо первой правки.
    const stubs = createStubs();
    const secretDir = path.join(os.tmpdir(), 'нет-такого-каталога-sec11', 'имя-пользователя');
    stubs.electron.dialog = {
        showSaveDialog: async () => ({ canceled: false, filePath: path.join(secretDir, 'отчёт.csv') })
    };
    loadMain(stubs);
    openDisplay(stubs);

    stubs.ipcHandlers.get('event-export')(fakeEvent(stubs));
    await new Promise((r) => setTimeout(r, 120));

    assert.equal(stubs.lastSent('event-export-done').ok, false, 'запись обязана провалиться');
    assert.ok(stubs.logged.some((l) => l.text.includes('[export]')), 'провал обязан остаться в журнале');
    for (const line of stubs.logged) {
        assert.ok(!line.text.includes('имя-пользователя'), `в журнал ушёл полный путь: ${line.text}`);
    }
});

// --- SEC-07: кто вправе прислать канал ---------------------------------------

test('SEC-07: каждый зарегистрированный канал проходит проверку отправителя', () => {
    // Обработчик, зарегистрированный мимо обвязки, принял бы и чужое окно.
    // Проверяем на КАЖДОМ канале: событие от окна, не ставшего ни одним из
    // четырёх, обработчик до тела не пускает — ни один не должен бросить и
    // ни один не должен ничего разослать.
    const stubs = createStubs();
    loadMain(stubs);
    const stranger = new stubs.electron.BrowserWindow({});
    stranger.loadFile('electron-control.html');
    const before = stubs.sent.length;
    for (const [channel, handler] of stubs.ipcRaw) {
        assert.doesNotThrow(() => handler(eventFrom(stranger), {}), channel);
    }
    assert.equal(stubs.sent.length, before, 'чужое окно добилось рассылки');
    assert.equal(stubs.created.length, 1, 'чужое окно открыло окно');
});

test('SEC-07: «Новое мероприятие» из виджета игнорируется, из панели — работает', async () => {
    const stubs = createStubs();
    loadMain(stubs);
    const control = openControl(stubs);
    openDisplay(stubs);
    const widget = openWidget(stubs);

    await runOvertimeTalk(stubs);
    stubs.ipcHandlers.get('event-finish')(eventFrom(control));
    stopTimer(stubs);
    const total = () => stubs.lastSent('event-overrun-state').overrunSeconds;
    assert.ok(total() > 0, 'нужен накопленный перелимит, иначе сброс нечем проверить');

    stubs.ipcRaw.get('event-reset')(eventFrom(widget));
    assert.ok(total() > 0, 'виджет обнулил деньги мероприятия');
    stubs.ipcRaw.get('event-reset')(eventFrom(control, { subframe: true }));
    assert.ok(total() > 0, 'iframe в окне панели обнулил деньги мероприятия');

    stubs.ipcRaw.get('event-reset')(eventFrom(control));
    assert.equal(total(), 0, 'панель обязана мочь начать новое мероприятие');
    assert.ok(stubs.logged.some((l) => l.text.includes('отклонено event-reset')), 'отказ не оставил следа');
});

test('SEC-07: timer-command из часов работает (Space в окне — законный отправитель)', () => {
    const stubs = createStubs();
    loadMain(stubs);
    stubs.ipcRaw.get('open-clock-widget')(eventFrom(openControl(stubs)));
    const clock = liveWindow(stubs, 'clock');
    assert.ok(clock, 'часы не открылись');
    stubs.ipcRaw.get('timer-command')(eventFrom(clock), { type: 'set', seconds: 42 });
    assert.equal(stubs.lastSent('timer-state').remainingSeconds, 42);
    // Настройки дисплея часам не принадлежат.
    stubs.ipcRaw.get('display-settings-update')(eventFrom(clock), { eventTitle: 'чужое' });
    assert.ok(!stubs.sent.some((m) => m.channel === 'display-settings-update'),
        'часы разослали настройки дисплея');
});

test('SEC-07: reset-and-relaunch и quit-app из дисплея не исполняются', () => {
    const stubs = createStubs();
    let quits = 0;
    stubs.electron.app.quit = () => { quits++; };
    stubs.electron.app.relaunch = () => { quits++; };
    loadMain(stubs);
    openDisplay(stubs);
    const display = liveWindow(stubs, 'display');
    stubs.ipcRaw.get('quit-app')(eventFrom(display));
    stubs.ipcRaw.get('reset-and-relaunch')(eventFrom(display));
    assert.equal(quits, 0);
});

// --- SEC-10: ретрансляторы помнят только проверенное ---------------------

test('SEC-10: мусорный payload настроек дисплея не запоминается и не рассылается', () => {
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);
    const relayed = () => stubs.sent.filter((m) => m.channel === 'display-settings-update');
    const before = relayed().length;

    for (const bad of [null, 'строка', [1, 2], 42]) {
        stubs.ipcHandlers.get('display-settings-update')(null, bad);
    }
    assert.equal(relayed().length, before, 'не-объект разослан окнам');

    stubs.ipcHandlers.get('display-settings-update')(null, { bgLocalImage: 'A'.repeat(20 * 1024 * 1024) });
    assert.equal(relayed().length, before, '20 МБ строки разосланы окнам');
});

test('SEC-10: разосланы и запомнены только примитивы; название — не длиннее 60', async () => {
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);
    stubs.ipcHandlers.get('display-settings-update')(null, {
        eventTitle: 'Длинное название '.repeat(20), nested: { evil: true }, bgMode: 'solid'
    });
    const relayed = stubs.lastSent('display-settings-update');
    assert.deepEqual(Object.keys(relayed).sort(), ['bgMode', 'eventTitle']);
    assert.equal(relayed.eventTitle.length, 60);

    // Запомненное — то же проверенное: новое окно часов получает его досылкой.
    stubs.ipcHandlers.get('open-clock-widget')(null);
    const hydrated = stubs.lastSent('display-settings-update');
    assert.equal(hydrated.eventTitle.length, 60);
    assert.ok(!('nested' in hydrated));
});

test('SEC-10: цвета и стиль виджета — только плоский объект', () => {
    const stubs = createStubs();
    loadMain(stubs);
    openWidget(stubs);
    stubs.ipcHandlers.get('widget-colors-update')(null, 'не объект');
    assert.equal(stubs.lastSent('widget-colors-update'), null);
    stubs.ipcHandlers.get('widget-colors-update')(null, { timer: '#fff', x: { y: 1 } });
    assert.deepEqual(stubs.lastSent('widget-colors-update'), { timer: '#fff' });
    stubs.ipcHandlers.get('widget-style-update')(null, [1]);
    assert.equal(stubs.lastSent('widget-style-update'), null);
});

// --- BUG-17: одна выгрузка — один ответ, один диалог -------------------------

test('BUG-17: ответ о выгрузке приходит панели ОДИН раз', async () => {
    // Панель — и controlWindow, и event.sender: отвечая обоим, главный процесс
    // показывал два одинаковых тоста.
    const stubs = createStubs();
    stubs.electron.dialog = { showSaveDialog: async () => ({ canceled: true }) };
    loadMain(stubs);
    stubs.ipcHandlers.get('event-export')(fakeEvent(stubs));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(stubs.sent.filter((m) => m.channel === 'event-export-done').length, 1);
});

test('BUG-17: диалог сохранения — дочерний окну панели', async () => {
    const stubs = createStubs();
    const calls = [];
    stubs.electron.dialog = { showSaveDialog: async (...args) => { calls.push(args); return { canceled: true }; } };
    loadMain(stubs);
    const control = openControl(stubs);
    stubs.ipcHandlers.get('event-export')(eventFrom(control));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], control, 'без родителя диалог уходит за окна и не блокирует панель');
    assert.equal(typeof calls[0][1], 'object', 'параметры диалога — вторым аргументом');
});

test('BUG-17: повторный клик, пока диалог открыт, второго диалога не открывает', async () => {
    const stubs = createStubs();
    let opened = 0;
    let close;
    stubs.electron.dialog = {
        showSaveDialog: () => { opened++; return new Promise((r) => { close = r; }); }
    };
    loadMain(stubs);
    const control = openControl(stubs);
    const handler = stubs.ipcHandlers.get('event-export');
    handler(eventFrom(control));
    handler(eventFrom(control));
    handler(eventFrom(control));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(opened, 1, 'три клика — три диалога');

    close({ canceled: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(stubs.sent.filter((m) => m.channel === 'event-export-done').length, 1,
        'проглоченный повтор не должен отвечать отдельно');
    // Диалог закрыт — следующий клик снова работает.
    handler(eventFrom(control));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(opened, 2, 'после закрытия диалога выгрузка заперлась навсегда');
    close({ canceled: true });
    await new Promise((r) => setTimeout(r, 20));
});

// --- BUG-01: часы знают, идёт ли таймер -------------------------------------

test('BUG-01: часы получают timer-state — и в рассылке, и снимком при загрузке', () => {
    // Space в часах решает «старт или пауза» по isRunning из timer-state.
    // Часам его не слали вовсе — пробел запускал, но никогда не ставил на паузу.
    const stubs = createStubs();
    loadMain(stubs);
    const cmdFromControl = (payload) => stubs.ipcHandlers.get('timer-command')(null, payload);
    cmdFromControl({ type: 'set', seconds: 90 });
    stubs.ipcRaw.get('open-clock-widget')(eventFrom(openControl(stubs)));
    const clock = liveWindow(stubs, 'clock');
    assert.ok(clock, 'часы не открылись');
    const toClock = () => stubs.sent.filter((m) => m.win === clock && m.channel === 'timer-state');

    // Снимок при загрузке: окно, открытое ПОСЛЕ старта, обязано знать состояние.
    clock.webContents.emit('did-finish-load');
    assert.equal(toClock().length, 1, 'часы не получили снимок состояния при загрузке');
    assert.equal(toClock()[0].payload.remainingSeconds, 90);

    // Рассылка: старт доходит до часов.
    cmdFromControl({ type: 'start' });
    assert.equal(toClock().at(-1).payload.isRunning, true, 'старт не дошёл до часов');
    cmdFromControl({ type: 'pause' });
    assert.equal(toClock().at(-1).payload.isRunning, false);
    stopTimer(stubs);
});

// --- BUG-07: снимок восстановления следует за состоянием --------------------

test('BUG-07: снимок пишется на паузе и стирается сбросом и новым пресетом', () => {
    // Снимок писался только на ходу и не стирался никогда: сбой в течение
    // пяти минут после сброса «восстанавливал» давно сброшенный отсчёт.
    const stubs = createStubs();
    loadMain(stubs);
    const snapshot = path.join(stubs.userDataDir, 'last-state.json');
    const read = () => (fs.existsSync(snapshot) ? JSON.parse(fs.readFileSync(snapshot, 'utf8')) : null);

    cmd(stubs, { type: 'set', seconds: 60 });
    assert.equal(read(), null, 'пресет в покое — не повод для восстановления');
    cmd(stubs, { type: 'start' });
    assert.equal(read() && read().isRunning, true, 'старт обязан записать снимок сразу, а не через 10 с');
    cmd(stubs, { type: 'pause' });
    assert.ok(read(), 'пауза — тоже состояние, которое стоит восстановить');
    assert.equal(read().isRunning, false);
    cmd(stubs, { type: 'reset' });
    assert.equal(read(), null, 'сброс обязан стереть снимок');

    cmd(stubs, { type: 'start' });
    cmd(stubs, { type: 'pause' });
    cmd(stubs, { type: 'set', seconds: 90 });
    assert.equal(read(), null, 'новый пресет обязан стереть снимок');
    stopTimer(stubs);
});

test('BUG-07: краш-обработчик в покое снимка не пишет', () => {
    const stubs = createStubs();
    loadMain(stubs);
    const snapshot = path.join(stubs.userDataDir, 'last-state.json');
    cmd(stubs, { type: 'set', seconds: 60 });
    // Последний подписчик — обработчик только что загруженного главного процесса.
    const handler = process.listeners('uncaughtException').at(-1);
    handler(new Error('проверка'));
    assert.equal(fs.existsSync(snapshot), false, 'снимок покоя «восстановит» то, что и так на экране, с пометкой о сбое');
});

// --- BUG-04: живой перелимит на выходе и при сбое ---------------------------

const OverrunStoreForTests = require('../event-overrun-store');

test('BUG-04: выход посреди перелимита записывает его в накопитель и журнал', async () => {
    // Дисплей не открываем: полноэкранный дисплей откладывает выход (первый
    // before-quit только выводит его из полноэкранного режима).
    const stubs = createStubs();
    loadMain(stubs);
    await runOvertimeTalk(stubs);
    try {
        stubs.appHandlers.get('before-quit')({ preventDefault() {} });
        const store = OverrunStoreForTests.loadStore(stubs.userDataDir);
        assert.ok(store.overrunSeconds >= 1, 'живой перелимит потерян на выходе');
        assert.equal(store.finished, false, 'выход не завершает мероприятие');
        assert.equal(store.talks.length, 1, 'прерванный выходом доклад — тоже строка журнала');
        assert.equal(store.talks[0].overrunSeconds, store.overrunSeconds);
        assert.ok(!store.pending);

        // Повторный before-quit не считает секунды ещё раз: строка журнала
        // уже записана, и они повисли бы в итоге без строки.
        await wait(1100);
        stubs.appHandlers.get('before-quit')({ preventDefault() {} });
        assert.equal(OverrunStoreForTests.loadStore(stubs.userDataDir).overrunSeconds, store.overrunSeconds);
    } finally {
        // Упавшая проверка не должна оставлять таймер в минусе: он держит
        // цикл событий, и прогон висит вместо того, чтобы упасть.
        stopTimer(stubs);
    }
});

test('BUG-04: сбой пишет живой перелимит в pending, не трогая итог процесса', async () => {
    const stubs = createStubs();
    loadMain(stubs);
    openDisplay(stubs);
    await runOvertimeTalk(stubs);
    try {
        process.listeners('uncaughtException').at(-1)(new Error('проверка'));
        const afterCrash = OverrunStoreForTests.loadStore(stubs.userDataDir);
        assert.ok(afterCrash.pending && afterCrash.pending.liveSeconds >= 1, 'живой перелимит не записан');
        assert.equal(afterCrash.overrunSeconds, 0, 'итог сложен сразу — процесс, живущий дальше, посчитает дважды');

        // Процесс пережил исключение: доклад кончается штатно, секунды — один раз.
        cmd(stubs, { type: 'reset' });
        await wait(50);
        const closed = OverrunStoreForTests.loadStore(stubs.userDataDir);
        assert.ok(!closed.pending, 'штатная запись обязана снять pending');
        assert.equal(closed.overrunSeconds, closed.talks[0].overrunSeconds);
        assert.ok(closed.overrunSeconds >= afterCrash.pending.liveSeconds);
    } finally {
        // Упавшая проверка не должна оставлять таймер в минусе: он держит
        // цикл событий, и прогон висит вместо того, чтобы упасть.
        stopTimer(stubs);
    }
});
