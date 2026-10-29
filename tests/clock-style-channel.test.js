'use strict';

/**
 * Стиль часов — ОДИН канал: `clock-widget-set-style` (панель → main) →
 * `set-clock-style` (main → часы). Главный процесс его ПОМНИТ
 * (`relay.lastClockStyle`), пишет в relay-state.json и досылает часам при
 * открытии.
 *
 * До 29.10.2026 стиль ехал двумя дорогами, и обе считала одна формула панели
 * (`effectiveClockStyle()`): адресный канал, который main только
 * ретранслировал и ничего о нём не помнил, и поле `clockStyle` внутри
 * `display-settings-update` — посылки ДИСПЛЕЯ, которую main помнил. Окно часов,
 * открытое позже, получало стиль второй дорогой, то есть из чужого payload; а
 * сам дисплей это поле не читал. Две дороги — два места, которые надо держать
 * согласованными, и снимок, верный лишь потому, что панель сейчас шлёт обе.
 *
 * Проверяется поведением там, где модуль собирается без Electron (relay IPC,
 * create-функция окна, файл памяти), и исходником — там, где сборка payload
 * живёт в примеси панели. Проверки отсутствия сначала проверяют сами себя.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { registerRelayIpc } = require('../main-relay-ipc');
const { createWindows } = require('../main-windows');
const { createRelayMemory } = require('../main-state');
const RelayStore = require('../relay-store');
const { RECEIVERS } = require('../ipc-senders');
const { codeOnly } = require('./helpers/source-scan');
const { readSource } = require('./helpers/window-source');

const ROOT = path.join(__dirname, '..');

function quietLog() {
    return { info() {}, warn() {}, error() {} };
}

/** Живое окно-заглушка: safelySendToWindow пишет посылки в `sent`. */
function fakeWin(name) {
    return { name, isDestroyed: () => false };
}

function relayHarness() {
    const handlers = new Map();
    const sent = [];
    const relay = createRelayMemory();
    const windows = {
        controlWindow: fakeWin('control'), widgetWindow: fakeWin('widget'),
        clockWidgetWindow: fakeWin('clock'), displayWindow: fakeWin('display')
    };
    let persisted = 0;
    registerRelayIpc({
        ipcMain: { on: (channel, fn) => handlers.set(channel, fn) },
        windows, relay, log: quietLog(),
        safelySendToWindow: (win, channel, payload) => { if (win) { sent.push([win.name, channel, payload]); } },
        applyWidgetMinimumSize() {}, applyWidgetAlwaysOnTop() {},
        persistRelay: () => { persisted++; }
    });
    return {
        relay, sent,
        persisted: () => persisted,
        emit: (channel, payload) => handlers.get(channel)({}, payload)
    };
}

test('main ПОМНИТ стиль часов, пишет память в файл и пересылает часам', () => {
    const h = relayHarness();
    assert.equal(h.relay.lastClockStyle, null, 'чистая память: стиля ещё нет');
    h.emit('clock-widget-set-style', 'flip');
    assert.equal(h.relay.lastClockStyle, 'flip');
    assert.equal(h.persisted(), 1, 'запись в relay-state.json — после каждой записи в relay');
    assert.deepEqual(h.sent, [['clock', 'set-clock-style', 'flip']]);
});

test('мусор в канале стиля не запоминается и не пересылается', () => {
    const h = relayHarness();
    h.emit('clock-widget-set-style', 'analog');
    for (const bad of [null, '', 42, { style: 'flip' }, 'x'.repeat(10000)]) {
        h.emit('clock-widget-set-style', bad);
    }
    assert.equal(h.relay.lastClockStyle, 'analog', 'отказ не стирает запомненное');
    assert.equal(h.persisted(), 1);
    assert.equal(h.sent.length, 1);
});

test('настройки дисплея часам больше не шлются: стиль часов в них не живёт', () => {
    const h = relayHarness();
    h.emit('display-settings-update', { bgMode: 'solid', eventTitle: 'Сессия' });
    assert.deepEqual(h.sent.map(([win]) => win), ['display'],
        'часам из этой посылки ничего не нужно — и не шлётся');
});

/** create-функция окна часов на подделках: возвращает досылку при открытии. */
function clockOpenHarness(relay) {
    let hydrate = null;
    class FakeBrowserWindow {
        constructor() {
            this.webContents = { once() {}, on() {} };
        }
        setAlwaysOnTop() {}
        loadURL() { return Promise.resolve(); }
        once() {}
        on() {}
        isDestroyed() { return false; }
    }
    const api = createWindows({
        BrowserWindow: FakeBrowserWindow,
        screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
        app: { isPackaged: false },
        log: quietLog(),
        CONFIG: require('../constants'),
        safelySendToWindow: (win, channel, payload) => win.sent.push([channel, payload]),
        windows: { controlWindow: null, widgetWindow: null, clockWidgetWindow: null, displayWindow: null },
        relay,
        hooks: {
            blockZoom() {}, hardenWindow() {}, bindRenderCrashHandler() {}, bindRenderConsole() {},
            bindWindowStateSnapshot() {}, broadcastWindowState() {},
            announceWindowOpened: (_win, _channel, fn) => { hydrate = fn; }
        },
        geometry: { bindGeometryReports() {} },
        screenshotMode: false,
        getTimerState: () => ({}),
        eventOverrunPayload: () => ({}),
        bindTrayBehavior() {}
    });
    api.createClockWidgetWindow();
    assert.ok(hydrate, 'createClockWidgetWindow обязана объявлять открытие');
    const win = { sent: [] };
    hydrate(win);
    return win.sent;
}

test('часы при открытии получают запомненный стиль СНИМКОМ', () => {
    const relay = createRelayMemory();
    relay.lastClockStyle = 'digits';
    relay.lastDisplaySettings = { bgMode: 'solid', clockStyle: 'flip' };
    const sent = clockOpenHarness(relay);
    assert.deepEqual(sent.filter(([ch]) => ch === 'set-clock-style'), [['set-clock-style', 'digits']]);
    assert.equal(sent.some(([ch]) => ch === 'display-settings-update'), false,
        'настройки дисплея часам не досылаются — второй дороги стиля нет');
});

test('стиль не запомнен — снимок стиля не шлётся (окно берёт свой из профиля)', () => {
    const sent = clockOpenHarness(createRelayMemory());
    assert.equal(sent.some(([ch]) => ch === 'set-clock-style'), false);
});

test('стиль часов переживает перезапуск: relay-state.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-style-'));
    const saved = createRelayMemory();
    saved.lastClockStyle = 'analog';
    RelayStore.writeRelayState(dir, saved);
    const restored = createRelayMemory();
    RelayStore.loadRelayState(dir, restored, quietLog());
    assert.equal(restored.lastClockStyle, 'analog');
});

test('стиль часов из файла проверяется тем же правилом, что живой канал', () => {
    for (const bad of [42, '', { s: 'flip' }, 'x'.repeat(10000), null]) {
        const parsed = RelayStore.parseRelayState(JSON.stringify({
            version: RelayStore.RELAY_STATE_VERSION, relay: { lastClockStyle: bad, lastClockColors: { timer: '#111111' } }
        }));
        assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'lastClockStyle'), false, `не принимать ${JSON.stringify(bad).slice(0, 20)}`);
        assert.deepEqual(parsed.lastClockColors, { timer: '#111111' }, 'остальное читается');
    }
});

// --- Исходник: второй дороги нет ------------------------------------------------

/** Поле `clockStyle:` в литерале объекта. */
const CLOCK_STYLE_FIELD = /\bclockStyle\s*:/;

test('проверка поля clockStyle сама себя: на прежней сборке она бы сработала', () => {
    assert.match("const base = {\n    clockStyle: this.effectiveClockStyle(),\n    bgMode: 'x'\n};", CLOCK_STYLE_FIELD);
    assert.doesNotMatch("const base = {\n    bgMode: 'x'\n};", CLOCK_STYLE_FIELD);
});

test('payload display-settings-update не несёт clockStyle', () => {
    const src = codeOnly(fs.readFileSync(path.join(ROOT, 'panel-display.js'), 'utf8'));
    // Сборка payload — метод примеси, весь файл и есть её окрестность.
    assert.match(src, /pushDisplaySettings\(\)\s*\{/, 'сборка найдена');
    assert.match(src, /\bbgMode\s*:/, 'проверка видит поля литерала payload');
    assert.doesNotMatch(src, CLOCK_STYLE_FIELD);
    assert.doesNotMatch(src, /effectiveClockStyle/, 'стиль часов к настройкам дисплея отношения не имеет');
    const types = fs.readFileSync(path.join(ROOT, 'types/ipc-payloads.d.ts'), 'utf8');
    const iface = types.match(/interface DisplaySettingsUpdate \{([\s\S]*?)\n\}/);
    assert.ok(iface, 'тип DisplaySettingsUpdate найден');
    assert.doesNotMatch(iface[1], CLOCK_STYLE_FIELD);
});

test('часы не слушают display-settings-update, а clock-settings не несёт стиль', () => {
    const clock = codeOnly(readSource('electron-clock-widget.html'));
    assert.match(clock, /\.on\('set-clock-style'/, 'проверка видит подписку, когда она есть');
    assert.doesNotMatch(clock, /\.on\('display-settings-update'/);
    assert.doesNotMatch(clock, /settings\.clockStyle/);
    assert.equal(RECEIVERS['display-settings-update'].includes('clock'), false,
        'мост часов канал дисплея не открывает');
    // Панель стиль в clock-widget-settings не кладёт: payload собирает таблица
    // часов, а в ней ключа стиля нет.
    const keys = require('../clock-settings-schema').CLOCK_SETTINGS.map((r) => r.key);
    assert.equal(keys.includes('clockStyle'), false);
});
