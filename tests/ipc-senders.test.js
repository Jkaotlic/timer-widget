'use strict';

/**
 * SEC-07: таблица «канал → окна-отправители» и проверка отправителя.
 *
 * Три вещи, каждая из которых ломается молча:
 *  1. канал без строки в таблице — значит, либо обработчик регистрируется мимо
 *     проверки, либо (с обвязкой) главный процесс не загрузится;
 *  2. лишнее окно в строке необратимого канала — ровно та дыра, которую
 *     закрывали (виджет стирает профиль);
 *  3. окно, которое ШЛЁТ канал, но не записано в строку, — клавиша, которая
 *     перестала работать, и ни один unit-тест этого не увидит.
 *
 * Поведение на настоящем electron-main.js — в tests/electron-main-load.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { codeOnly } = require('./helpers/source-scan');
const { ROLES, SENDERS, createSenderGate, guardIpcMain, onceLogger } = require('../ipc-senders');
const { ALLOWED_CHANNELS } = require('../channel-validator');

const repoRoot = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const PAGES = {
    control: 'electron-control.html',
    widget: 'electron-widget.html',
    clock: 'electron-clock-widget.html',
    display: 'display.html'
};

// Страница + все её <script src>: канал шлёт не только инлайн-код окна, но и
// модули, подключённые к нему (панель — двадцать с лишним файлов).
function roleCode(role) {
    const html = read(PAGES[role]);
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    return codeOnly([html, ...srcs.map(read)].join('\n'));
}

// Каналы, которые окно действительно ОТПРАВЛЯЕТ: литералы внутри `send(…)`
// (включая тернарник «открыть/закрыть») и поля конфигурации геометрии
// (`move: 'widget-move'` — window-geometry.js шлёт их через send(channels.x)).
function sentBy(role) {
    const code = roleCode(role);
    const out = new Set();
    for (const m of code.matchAll(/\bsend\(([^)]*)/g)) {
        for (const lit of m[1].matchAll(/['"`]([a-z-]+)['"`]/g)) {
            if (ALLOWED_CHANNELS.send.includes(lit[1])) { out.add(lit[1]); }
        }
    }
    for (const m of code.matchAll(/\b(?:move|resize|position):\s*['"`]([a-z-]+)['"`]/g)) {
        if (ALLOWED_CHANNELS.send.includes(m[1])) { out.add(m[1]); }
    }
    return out;
}

function mainChannels() {
    const src = codeOnly(read('electron-main.js'));
    return [...src.matchAll(/ipcMain\.(?:on|handle)\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
}

function preloadSendList() {
    const src = read('preload.js');
    const block = src.slice(src.indexOf('send: ['), src.indexOf('receive: ['));
    return [...codeOnly(block).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
}

test('у КАЖДОГО канала есть строка в таблице отправителей', () => {
    const channels = new Set([...mainChannels(), ...ALLOWED_CHANNELS.send, ...preloadSendList()]);
    assert.ok(channels.size > 30, `сканер нашёл подозрительно мало каналов: ${channels.size}`);
    const orphans = [...channels].filter((ch) => !SENDERS[ch]);
    assert.deepEqual(orphans, [], 'канал без владельца: ' + orphans.join(', '));
});

test('в таблице нет строк для несуществующих каналов', () => {
    // Строка без канала — разрешение без функции: канал вернут под тем же
    // именем, и он получит права, о которых никто не подумал.
    const stale = Object.keys(SENDERS).filter((ch) => !ALLOWED_CHANNELS.send.includes(ch));
    assert.deepEqual(stale, [], 'строки без канала: ' + stale.join(', '));
});

test('в строках только известные окна, и ни одной пустой', () => {
    for (const [ch, roles] of Object.entries(SENDERS)) {
        assert.ok(roles.length > 0, `${ch}: пустая строка — канал никому не разрешён`);
        for (const r of roles) { assert.ok(ROLES.includes(r), `${ch}: неизвестное окно ${r}`); }
    }
});

test('необратимые каналы и настройки шлёт ТОЛЬКО панель', () => {
    for (const ch of ['quit-app', 'reset-and-relaunch', 'event-reset', 'event-export', 'event-finish',
        'display-settings-update', 'widget-style-update', 'widget-colors-update',
        'clock-colors-update', 'display-colors-update', 'clock-widget-settings',
        'clock-widget-set-style', 'ui-theme-update', 'ui-lock-update', 'open-releases-page']) {
        assert.deepEqual([...SENDERS[ch]], ['control'], `${ch}: разрешён не только панели`);
    }
});

test('каждое окно вправе слать всё, что шлёт сегодня (ни одна клавиша не отвалится)', () => {
    for (const role of ROLES) {
        const sent = sentBy(role);
        assert.ok(sent.size > 0, `${role}: сканер не нашёл ни одной отправки — регулярка сломана`);
        const denied = [...sent].filter((ch) => !SENDERS[ch] || !SENDERS[ch].includes(role));
        assert.deepEqual(denied, [], `${role} шлёт, но не допущен: ${denied.join(', ')}`);
    }
});

test('сканер отправок видит тернарник и конфиг геометрии (проверка самой проверки)', () => {
    // Без этого зелёный тест выше значил бы и «всё допущено», и «регулярка
    // ничего не нашла» (CLAUDE.md: тест на отсутствие проверяет сам себя).
    assert.ok(sentBy('widget').has('open-display'), 'тернарник в send(...) не распознан');
    assert.ok(sentBy('widget').has('widget-set-position'), 'поле position: конфига не распознано');
    assert.ok(sentBy('control').has('quit-app'));
    assert.ok(!sentBy('widget').has('quit-app'), 'виджет не шлёт quit-app — сканер врёт');
});

// --- Проверка отправителя на подставках ------------------------------------

function fixture() {
    const frames = {};
    const wins = {};
    const contents = {};
    for (const role of ROLES) {
        frames[role] = { url: `file:///app/${PAGES[role]}` };
        contents[role] = { mainFrame: frames[role] };
        wins[role] = { role };
    }
    const rejected = [];
    const gate = createSenderGate({
        windowOf: (wc) => ROLES.map((r) => (contents[r] === wc ? wins[r] : null)).find(Boolean) || null,
        windowsByRole: () => wins,
        isAppPage: (url) => typeof url === 'string' && url.startsWith('file:///app/'),
        onReject: (ch, reason) => rejected.push(`${ch}:${reason}`)
    });
    const from = (role, frame) => ({ sender: contents[role], senderFrame: frame || frames[role] });
    return { gate, from, rejected, frames, contents, wins };
}

test('окно из строки допущено, окно не из строки — нет', () => {
    const f = fixture();
    assert.equal(f.gate('quit-app', f.from('control')), true);
    assert.equal(f.gate('quit-app', f.from('widget')), false);
    assert.equal(f.gate('reset-and-relaunch', f.from('display')), false);
    assert.equal(f.gate('timer-command', f.from('clock')), true);
    assert.deepEqual(f.rejected, ['quit-app:окно widget', 'reset-and-relaunch:окно display']);
});

test('субфрейм отвергается даже в окне панели', () => {
    const f = fixture();
    assert.equal(f.gate('quit-app', f.from('control', { url: f.frames.control.url })), false);
    assert.equal(f.gate('quit-app', { sender: f.contents.control, senderFrame: null }), false);
});

test('чужая страница в своём окне отвергается', () => {
    const f = fixture();
    f.frames.control.url = 'file:///Users/someone/evil.html';
    assert.equal(f.gate('quit-app', f.from('control')), false);
});

test('webContents, не принадлежащий ни одному из четырёх окон, отвергается', () => {
    const f = fixture();
    const stray = { mainFrame: { url: 'file:///app/electron-control.html' } };
    assert.equal(f.gate('quit-app', { sender: stray, senderFrame: stray.mainFrame }), false);
    // Закрытое окно: глобал уже null, а сообщение ещё в пути.
    f.wins.control = null;
    assert.equal(f.gate('quit-app', f.from('control')), false);
});

test('мусорное событие и неизвестный канал не роняют проверку', () => {
    const f = fixture();
    for (const ev of [undefined, null, {}, { sender: null }]) {
        assert.equal(f.gate('quit-app', ev), false);
    }
    assert.equal(f.gate('нет-такого', f.from('control')), false);
});

test('обвязка: обработчик зовётся только для допущенного, канал без строки падает при регистрации', () => {
    const registered = new Map();
    const raw = { on: (ch, fn) => registered.set(ch, fn), handle: (ch, fn) => registered.set(ch, fn) };
    const f = fixture();
    const ipc = guardIpcMain(raw, f.gate);
    const calls = [];
    ipc.on('quit-app', (_e, x) => calls.push(x));
    registered.get('quit-app')(f.from('widget'), 'из виджета');
    registered.get('quit-app')(f.from('control'), 'из панели');
    assert.deepEqual(calls, ['из панели']);
    assert.throws(() => ipc.on('канал-без-строки', () => {}), /нет строки/);
});

test('журнал отказов: одна запись на канал и причину', () => {
    const lines = [];
    const log = onceLogger((s) => lines.push(s));
    for (let i = 0; i < 50; i++) { log('widget-move', 'окно clock'); }
    log('quit-app', 'окно widget');
    assert.deepEqual(lines, ['[ipc] отклонено widget-move: окно clock', '[ipc] отклонено quit-app: окно widget']);
});
