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

const repoRoot = path.join(__dirname, '..');

// --- Заглушки -------------------------------------------------------------

function createStubs() {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-main-load-'));
    const ipcHandlers = new Map();
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
            this._fullscreen = !!opts.fullscreen;
            this._destroyed = false;
            this.webContents = {
                on: noop, once: noop,
                send: (channel, payload) => { sent.push({ channel, payload }); },
                isDestroyed: () => this._destroyed,
                setWindowOpenHandler: noop, setZoomFactor: noop,
                setZoomLevel: noop, setVisualZoomLevelLimits: noop, openDevTools: noop
            };
            created.push(this);
        }
        static getAllWindows() { return created; }
        loadFile(file) { this._file = file; return Promise.resolve(); }
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
            on: noop,
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
            on: (channel, handler) => { ipcHandlers.set(channel, handler); }
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
        Tray: class { setToolTip() {} setContextMenu() {} on() {} },
        nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
        powerMonitor: { on: noop },
        session: { defaultSession: {} }
    };

    return { electron, ipcHandlers, created, sent, lastSent, userDataDir };
}

// Загружает electron-main.js с подменённым 'electron' и 'electron-log/main'.
function loadMain(stubs) {
    const logNoop = () => {};
    const logStub = {
        initialize: logNoop,
        info: logNoop, warn: logNoop, error: logNoop, debug: logNoop, verbose: logNoop,
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
 * Поддельный отправитель IPC — то, чем для главного процесса является окно.
 *
 * Обработчики, которые ОТВЕЧАЮТ спросившему, без него проверить нельзя:
 * `loadMain` окон не создаёт, и ответ уходил бы в никуда. Записанное сюда
 * попадает в тот же журнал `sent`, что и обычная рассылка.
 */
function fakeEvent(stubs) {
    return {
        sender: {
            isDestroyed: () => false,
            send: (channel, payload) => { stubs.sent.push({ channel, payload }); }
        }
    };
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
