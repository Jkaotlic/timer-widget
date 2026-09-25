'use strict';

/**
 * Мост каждого окна открывает ТОЛЬКО каналы этого окна.
 *
 * До 25.09.2026 один preload.js с одним белым списком стоял во всех четырёх
 * окнах: виджет мог отправить `reset-and-relaunch` и подписаться на
 * `timer-recovery-available`. Главный процесс отправителя проверяет
 * (ipc-senders.js, SEC-07) — мост по окнам — второй слой той же обороны.
 *
 * Источник один: SENDERS и RECEIVERS в ipc-senders.js. Мост не может их
 * прочитать (песочница: `require` грузит только `electron`), поэтому таблица
 * вписана в preload.js генератором scripts/preload-channels.js, а здесь
 * проверяется, что вписанная не отстала от источника.
 *
 * Сверка с кодом окон — в ОБЕ стороны: окно шлёт/слушает неоткрытое — клавиша
 * молча не работает; мост открывает неиспользуемое — разрешение без функции.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { ROLES, SENDERS, RECEIVERS, channelsFor, windowArgument } = require('../ipc-senders');
const { sentBy, receivedBy } = require('./helpers/ipc-scan');
const gen = require('../scripts/preload-channels');

const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

const sorted = (xs) => [...xs].sort();

// --- Таблица и код окон --------------------------------------------------------

test('RECEIVERS: только известные окна, ни одной пустой строки', () => {
    assert.ok(Object.keys(RECEIVERS).length > 15, 'подозрительно короткая таблица приёма');
    for (const [ch, roles] of Object.entries(RECEIVERS)) {
        assert.ok(roles.length > 0, `${ch}: канал никто не слушает`);
        for (const r of roles) { assert.ok(ROLES.includes(r), `${ch}: неизвестное окно ${r}`); }
    }
});

for (const role of ROLES) {
    test(`${role}: мост открывает на отправку РОВНО то, что окно шлёт`, () => {
        assert.deepEqual(sorted(channelsFor(role).send), sorted(sentBy(role)));
    });
    test(`${role}: мост открывает на приём РОВНО то, что окно слушает`, () => {
        assert.deepEqual(sorted(channelsFor(role).receive), sorted(receivedBy(role)));
    });
}

test('сканер видит то, что должен, и не видит лишнего (проверка самой проверки)', () => {
    assert.ok(sentBy('control').has('quit-app'));
    assert.ok(!sentBy('widget').has('quit-app'));
    // Литерал полезной нагрузки — не канал.
    assert.ok(!sentBy('widget').has('pause'), 'send(\'timer-control\', \'pause\'): pause принят за канал');
    assert.ok(sentBy('widget').has('open-display'), 'тернарник в send(...) не распознан');
    assert.ok(sentBy('widget').has('widget-set-position'), 'поле position: конфига не распознано');
    // Общий модуль: bindLockSync зовут виджет, часы и дисплей, но НЕ панель,
    // хотя ui-lock.js подключён и к ней.
    assert.ok(receivedBy('widget').has('ui-lock-update'));
    assert.ok(!receivedBy('control').has('ui-lock-update'), 'подписка в незваной функции модуля засчитана');
    // Подписка в методе примеси (panel-display.js) — засчитана.
    assert.ok(receivedBy('control').has('event-export-done'));
});

test('channelsFor собран из SENDERS и RECEIVERS, а не отдельным списком', () => {
    for (const role of ROLES) {
        const own = channelsFor(role);
        assert.deepEqual(sorted(own.send), sorted(Object.keys(SENDERS).filter((c) => SENDERS[c].includes(role))));
        assert.deepEqual(sorted(own.receive), sorted(Object.keys(RECEIVERS).filter((c) => RECEIVERS[c].includes(role))));
    }
    assert.throws(() => channelsFor('evil'), /неизвестное окно/);
});

// --- Сгенерированный блок в preload.js ------------------------------------------

test('таблица в preload.js совпадает с ipc-senders.js (иначе: npm run preload:channels -- --write)', () => {
    assert.equal(gen.extractBlock(PRELOAD), gen.renderBlock());
});

test('генератор: блок заменяется целиком, остальной файл не трогается', () => {
    const src = `head\n${gen.BEGIN}\nстарое\n${gen.END}\ntail\n`;
    const out = gen.replaceBlock(src, 'НОВОЕ');
    assert.equal(out, `head\n${gen.BEGIN}\nНОВОЕ\n${gen.END}\ntail\n`);
    assert.throws(() => gen.replaceBlock('без маркеров', 'x'), /маркер/);
});

// --- Поведение моста на подставке -----------------------------------------------

function loadPreload(argv) {
    const calls = { send: [], on: [], once: [], removeListener: [], removeAllListeners: [] };
    const errors = [];
    let api = null;
    const ipcRenderer = {};
    for (const k of Object.keys(calls)) { ipcRenderer[k] = (...a) => { calls[k].push(a[0]); }; }
    const electron = {
        contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'electronAPI'); api = value; } },
        ipcRenderer
    };
    vm.runInNewContext(PRELOAD, {
        // Песочница Electron: require грузит только electron.
        require: (m) => {
            if (m === 'electron') { return electron; }
            throw new Error(`sandboxed preload: require('${m}') недоступен`);
        },
        process: { argv },
        console: { error: (msg) => errors.push(String(msg)), log() {}, warn() {} }
    });
    assert.ok(api, 'мост не выставлен');
    return { api, calls, errors };
}

const ARGV = (role) => ['/path/to/electron', '--type=renderer', windowArgument(role)];

test('мост принимает каналы своего окна и отвергает чужие — для каждого окна', () => {
    const allSend = Object.keys(SENDERS);
    const allReceive = Object.keys(RECEIVERS);
    for (const role of ROLES) {
        const own = channelsFor(role);
        const { api, calls } = loadPreload(ARGV(role));
        for (const ch of allSend) { api.send(ch, {}); }
        assert.deepEqual(sorted(calls.send), sorted(own.send), `${role}: send`);
        for (const ch of allReceive) { api.on(ch, () => {}); api.once(ch, () => {}); }
        assert.deepEqual(sorted(calls.on), sorted(own.receive), `${role}: on`);
        assert.deepEqual(sorted(calls.once), sorted(own.receive), `${role}: once`);
    }
});

test('виджет не может стереть профиль и не слышит панельные каналы', () => {
    const { api, calls, errors } = loadPreload(ARGV('widget'));
    api.send('reset-and-relaunch');
    api.send('quit-app');
    const off = api.on('timer-recovery-available', () => {});
    api.removeAllListeners('timer-recovery-available');
    assert.deepEqual(calls.send, []);
    assert.deepEqual(calls.on, []);
    assert.deepEqual(calls.removeAllListeners, []);
    assert.equal(typeof off, 'function', 'отказ всё равно возвращает функцию отписки');
    assert.ok(errors.some((e) => e.includes('reset-and-relaunch')), 'отказ не записан');
    // И своё проходит — иначе зелёный тест значил бы «мост закрыт целиком».
    api.send('widget-move', { deltaX: 1, deltaY: 0 });
    assert.deepEqual(calls.send, ['widget-move']);
});

test('без роли, с чужой ролью или с двумя ролями мост закрыт целиком', () => {
    for (const argv of [
        ['/electron'],
        ['/electron', '--tw-window=evil'],
        ['/electron', '--tw-window=__proto__'],
        ['/electron', '--tw-window=constructor'],
        ['/electron', windowArgument('widget'), windowArgument('control')],
        undefined
    ]) {
        const { api, calls, errors } = loadPreload(argv);
        for (const ch of Object.keys(SENDERS)) { api.send(ch); }
        for (const ch of Object.keys(RECEIVERS)) { api.on(ch, () => {}); }
        assert.deepEqual(calls.send, [], `argv ${JSON.stringify(argv)}: send прошёл`);
        assert.deepEqual(calls.on, [], `argv ${JSON.stringify(argv)}: on прошёл`);
        assert.ok(errors.some((e) => /роли/.test(e)), 'закрытый мост обязан сказать почему');
    }
});

test('мусорный канал и направление не путаются', () => {
    const { api, calls } = loadPreload(ARGV('control'));
    for (const bad of [null, undefined, 42, '', '__proto__', 'toString', 'constructor']) {
        api.send(bad);
        api.on(bad, () => {});
    }
    // timer-state — только приём, quit-app — только отправка.
    api.send('timer-state');
    api.on('quit-app', () => {});
    assert.deepEqual(calls.send, []);
    assert.deepEqual(calls.on, []);
});

test('мост не выставляет invoke и ничего сверх пяти методов', () => {
    const { api } = loadPreload(ARGV('control'));
    assert.deepEqual(sorted(Object.keys(api)), ['on', 'once', 'removeAllListeners', 'removeListener', 'send']);
});
