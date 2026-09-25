const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidChannel, ALLOWED_CHANNELS } = require('../channel-validator');

test('isValidChannel allows valid send channels', () => {
    assert.equal(isValidChannel('timer-command', 'send'), true);
    assert.equal(isValidChannel('widget-colors-update', 'send'), true);
    assert.equal(isValidChannel('quit-app', 'send'), true);
    assert.equal(isValidChannel('get-timer-state', 'send'), true);
});

test('isValidChannel allows valid receive channels', () => {
    assert.equal(isValidChannel('timer-state', 'receive'), true);
    assert.equal(isValidChannel('widget-colors-update', 'receive'), true);
    assert.equal(isValidChannel('timer-reached-zero', 'receive'), true);
    assert.equal(isValidChannel('display-window-state', 'receive'), true);
});

test('isValidChannel blocks unauthorized channels', () => {
    assert.equal(isValidChannel('evil-channel', 'send'), false);
    assert.equal(isValidChannel('evil-channel', 'receive'), false);
    assert.equal(isValidChannel('__proto__', 'send'), false);
    assert.equal(isValidChannel('constructor', 'receive'), false);
});

test('isValidChannel enforces direction', () => {
    // timer-state is receive-only, not send
    assert.equal(isValidChannel('timer-state', 'send'), false);
    // timer-command is send-only, not receive
    assert.equal(isValidChannel('timer-command', 'receive'), false);
});

test('isValidChannel handles invalid inputs', () => {
    assert.equal(isValidChannel('', 'send'), false);
    assert.equal(isValidChannel(null, 'send'), false);
    assert.equal(isValidChannel(undefined, 'send'), false);
    assert.equal(isValidChannel(123, 'send'), false);
    assert.equal(isValidChannel('timer-command', 'invalid'), false);
    assert.equal(isValidChannel('timer-command', ''), false);
    assert.equal(isValidChannel('timer-command', null), false);
});

test('ALLOWED_CHANNELS has expected structure', () => {
    assert.ok(Array.isArray(ALLOWED_CHANNELS.send));
    assert.ok(Array.isArray(ALLOWED_CHANNELS.receive));
    assert.ok(ALLOWED_CHANNELS.send.length > 0);
    assert.ok(ALLOWED_CHANNELS.receive.length > 0);
    // No duplicates
    assert.equal(ALLOWED_CHANNELS.send.length, new Set(ALLOWED_CHANNELS.send).size);
    assert.equal(ALLOWED_CHANNELS.receive.length, new Set(ALLOWED_CHANNELS.receive).size);
});

test('channel-validator.js — вид на ipc-senders.js, а не своя копия', () => {
    // До 25.09.2026 здесь сверялись два рукописных списка (валидатор и preload).
    // Теперь источник один — таблицы ipc-senders.js; мосты окон собираются из
    // них генератором (tests/preload-channels.test.js), валидатор — их объединение.
    const { SENDERS, RECEIVERS } = require('../ipc-senders');
    assert.deepEqual([...ALLOWED_CHANNELS.send].sort(), Object.keys(SENDERS).sort());
    assert.deepEqual([...ALLOWED_CHANNELS.receive].sort(), Object.keys(RECEIVERS).sort());
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'channel-validator.js'), 'utf8');
    assert.doesNotMatch(src, /'timer-command'/, 'в валидаторе снова рукописный список каналов');
});
