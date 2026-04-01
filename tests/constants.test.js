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
