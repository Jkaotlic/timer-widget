const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidChannel, ALLOWED_CHANNELS } = require('../channel-validator');

test('isValidChannel allows valid send channels', () => {
    assert.equal(isValidChannel('timer-command', 'send'), true);
    assert.equal(isValidChannel('colors-update', 'send'), true);
    assert.equal(isValidChannel('quit-app', 'send'), true);
    assert.equal(isValidChannel('get-timer-state', 'send'), true);
});

test('isValidChannel allows valid receive channels', () => {
    assert.equal(isValidChannel('timer-state', 'receive'), true);
    assert.equal(isValidChannel('colors-update', 'receive'), true);
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

test('channel-validator.js channels match preload.js inline channels', () => {
    const fs = require('fs');
    const path = require('path');
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf-8');

    // Extract send channels from preload.js
    const sendMatch = preloadSource.match(/send:\s*\[([\s\S]*?)\]/);
    const receiveMatch = preloadSource.match(/receive:\s*\[([\s\S]*?)\]/);
    assert.ok(sendMatch, 'preload.js should have send channels');
    assert.ok(receiveMatch, 'preload.js should have receive channels');

    const extractChannels = (str) =>
        str.match(/'([^']+)'/g).map(s => s.replace(/'/g, '')).sort();

    const preloadSend = extractChannels(sendMatch[1]);
    const preloadReceive = extractChannels(receiveMatch[1]);
    const validatorSend = [...ALLOWED_CHANNELS.send].sort();
    const validatorReceive = [...ALLOWED_CHANNELS.receive].sort();

    assert.deepEqual(preloadSend, validatorSend, 'Send channels must be identical in preload.js and channel-validator.js');
    assert.deepEqual(preloadReceive, validatorReceive, 'Receive channels must be identical in preload.js and channel-validator.js');
});
