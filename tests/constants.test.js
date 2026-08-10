const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../constants');

test('CONFIG is frozen (immutable)', () => {
    const original = CONFIG.WARNING_THRESHOLD;
    CONFIG.WARNING_THRESHOLD = 999;
    assert.equal(CONFIG.WARNING_THRESHOLD, original, 'CONFIG should be frozen');
});

test('CONFIG has expected core keys', () => {
    assert.ok('WARNING_THRESHOLD' in CONFIG);
    assert.ok('MAX_FLASH_COUNT' in CONFIG);
    assert.ok('ALLOWED_IMAGE_TYPES' in CONFIG);
    assert.ok('STORAGE_KEYS' in CONFIG);
});

test('CONFIG.WARNING_THRESHOLD aligns with getTimerStatus', () => {
    assert.equal(CONFIG.WARNING_THRESHOLD, 60);
});

test('CONFIG.MAX_FLASH_COUNT is 6', () => {
    assert.equal(CONFIG.MAX_FLASH_COUNT, 6);
});

test('CONFIG.ALLOWED_IMAGE_TYPES excludes SVG', () => {
    assert.ok(!CONFIG.ALLOWED_IMAGE_TYPES.includes('image/svg+xml'));
    assert.ok(CONFIG.ALLOWED_IMAGE_TYPES.includes('image/png'));
    assert.ok(CONFIG.ALLOWED_IMAGE_TYPES.includes('image/jpeg'));
});

test('CONFIG.STORAGE_KEYS is an object with string values', () => {
    assert.equal(typeof CONFIG.STORAGE_KEYS, 'object');
    for (const [_key, value] of Object.entries(CONFIG.STORAGE_KEYS)) {
        assert.equal(typeof value, 'string');
    }
});

test('CONFIG.PRESET_DURATIONS holds the 8 keyboard-preset seconds', () => {
    assert.deepEqual(CONFIG.PRESET_DURATIONS, [300, 600, 900, 1200, 1500, 1800, 2700, 3600]);
});

test('CONFIG.PRESET_DURATIONS is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(CONFIG.PRESET_DURATIONS));
    const original = CONFIG.PRESET_DURATIONS[0];
    CONFIG.PRESET_DURATIONS[0] = 999;
    assert.equal(CONFIG.PRESET_DURATIONS[0], original, 'PRESET_DURATIONS should be frozen');
});

test('CONFIG no longer exposes removed dead constants', () => {
    // MIN_SCALE/MAX_SCALE were unused and disagreed with renderer-enforced scale bounds
    assert.ok(!('MIN_SCALE' in CONFIG));
    assert.ok(!('MAX_SCALE' in CONFIG));
    // IPC_CHANNELS was a dead third copy of the channel list (see channel-validator.js)
    assert.ok(!('IPC_CHANNELS' in CONFIG));
});

test('размеры виджета по умолчанию имеют ЧИТАТЕЛЯ, а не только объявление', () => {
    // WIDGET_DEFAULT_WIDTH/HEIGHT лежали в реестре, но конструктор окна зашивал
    // те же числа литералами — то есть значение существовало в двух местах и
    // разошлось молча: реестр и окно говорили 280, а WIDGET_BASE_SIZE в
    // рендерере делает окно КВАДРАТНЫМ, и первое же масштабирование навсегда
    // превращало высоту в 250. Та же болезнь, что была у CONFIG.STORAGE_KEYS:
    // реестр без точки доступа не ломается, он тихо гниёт.
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron-main.js'), 'utf8');

    assert.match(source, /width:\s*CONFIG\.WIDGET_DEFAULT_WIDTH/,
        'конструктор окна виджета обязан читать CONFIG.WIDGET_DEFAULT_WIDTH');
    assert.match(source, /height:\s*CONFIG\.WIDGET_DEFAULT_HEIGHT/,
        'конструктор окна виджета обязан читать CONFIG.WIDGET_DEFAULT_HEIGHT');
    assert.equal(CONFIG.WIDGET_DEFAULT_HEIGHT, CONFIG.WIDGET_DEFAULT_WIDTH,
        'окно виджета квадратное при любом масштабе — стартовый размер обязан быть таким же');
});
