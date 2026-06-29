'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getByteSize,
    safeGetJSON,
    safeSetJSON
} = require('../renderer-storage');

function createStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return data.has(key) ? data.get(key) : null;
        },
        setItem(key, value) {
            data.set(key, String(value));
        },
        dump() {
            return Object.fromEntries(data.entries());
        }
    };
}

test('getByteSize counts UTF-8 bytes', () => {
    assert.equal(getByteSize('abc'), 3);
    assert.equal(getByteSize('таймер'), Buffer.byteLength('таймер', 'utf8'));
});

test('safeSetJSON stores small JSON values', () => {
    const storage = createStorage();

    const result = safeSetJSON(storage, 'customSounds', [{ name: 'beep', data: 'x' }]);

    assert.deepEqual(result, { ok: true, bytes: 28 });
    assert.equal(storage.getItem('customSounds'), '[{"name":"beep","data":"x"}]');
});

test('safeSetJSON rejects values over byte limit before storage write', () => {
    let wrote = false;
    const storage = {
        setItem() {
            wrote = true;
        }
    };

    const result = safeSetJSON(storage, 'customSounds', { data: '1234567890' }, { limitBytes: 8 });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'too-large');
    assert.equal(result.bytes > 8, true);
    assert.equal(wrote, false);
});

test('safeSetJSON reports quota failures', () => {
    const storage = {
        setItem() {
            const err = new Error('quota');
            err.name = 'QuotaExceededError';
            throw err;
        }
    };

    const result = safeSetJSON(storage, 'customSounds', ['x']);

    assert.deepEqual(result, { ok: false, reason: 'quota' });
});

test('safeGetJSON returns fallback for invalid JSON', () => {
    const storage = createStorage({ customSounds: 'not json' });

    const result = safeGetJSON(storage, 'customSounds', []);

    assert.deepEqual(result, []);
});
