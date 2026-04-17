const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBlockPositions, canSafelyStore } = require('../display-script');

test('validateBlockPositions returns null for non-objects', () => {
    assert.equal(validateBlockPositions(null), null);
    assert.equal(validateBlockPositions(undefined), null);
    assert.equal(validateBlockPositions('string'), null);
    assert.equal(validateBlockPositions(42), null);
    assert.equal(validateBlockPositions(true), null);
});

test('validateBlockPositions accepts valid position object', () => {
    const positions = {
        currentTime: { left: 100, top: 50 },
        eventTime: { left: 200, top: 100 }
    };
    const result = validateBlockPositions(positions);
    assert.deepEqual(result, {
        currentTime: { left: 100, top: 50 },
        eventTime: { left: 200, top: 100 }
    });
});

test('validateBlockPositions skips entries with non-finite coordinates', () => {
    const positions = {
        good: { left: 10, top: 20 },
        nan: { left: NaN, top: 30 },
        inf: { left: Infinity, top: 40 },
        missing: { top: 5 },
        nullLeft: { left: null, top: 10 }
    };
    const result = validateBlockPositions(positions);
    assert.deepEqual(result, { good: { left: 10, top: 20 } });
});

test('validateBlockPositions clamps out-of-range values', () => {
    const positions = {
        tooFarRight: { left: 99999, top: 10 },
        tooFarLeft: { left: -99999, top: 10 },
        tooFarDown: { left: 10, top: 99999 },
        tooFarUp: { left: 10, top: -99999 }
    };
    const result = validateBlockPositions(positions);
    assert.equal(result.tooFarRight.left, 5000);
    assert.equal(result.tooFarLeft.left, -5000);
    assert.equal(result.tooFarDown.top, 5000);
    assert.equal(result.tooFarUp.top, -5000);
});

test('validateBlockPositions skips null/non-object entries', () => {
    const positions = {
        good: { left: 0, top: 0 },
        nullEntry: null,
        arrEntry: [1, 2],      // array.left/top undefined → skipped
        primEntry: 42,         // primitive → skipped
        strEntry: 'nope'       // string → skipped (not an object per typeof... actually typeof 'x' === 'string', skipped)
    };
    const result = validateBlockPositions(positions);
    assert.deepEqual(Object.keys(result), ['good']);
    assert.equal(result.good.left, 0);
    assert.equal(result.good.top, 0);
});

test('validateBlockPositions handles empty object', () => {
    assert.deepEqual(validateBlockPositions({}), {});
});

test('canSafelyStore accepts small strings', () => {
    assert.equal(canSafelyStore('hello'), true);
    assert.equal(canSafelyStore(''), true);
    assert.equal(canSafelyStore(JSON.stringify({ a: 1, b: 2 })), true);
});

test('canSafelyStore rejects values over 1 MB', () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    assert.equal(canSafelyStore(big), false);
});

test('canSafelyStore accepts values exactly at 1 MB', () => {
    const exact = 'x'.repeat(1024 * 1024);
    assert.equal(canSafelyStore(exact), true);
});

test('canSafelyStore rejects non-string input', () => {
    assert.equal(canSafelyStore(null), false);
    assert.equal(canSafelyStore(undefined), false);
    assert.equal(canSafelyStore(123), false);
    assert.equal(canSafelyStore({}), false);
    assert.equal(canSafelyStore([]), false);
});

test('canSafelyStore respects custom limitBytes', () => {
    assert.equal(canSafelyStore('abcdef', 5), false);
    assert.equal(canSafelyStore('abc', 5), true);
});

test('validateBlockPositions: malformed JSON simulation (edge cases)', () => {
    // Simulate what happens when JSON.parse returns odd types
    assert.equal(validateBlockPositions(JSON.parse('null')), null);
    assert.deepEqual(validateBlockPositions(JSON.parse('{}')), {});
    assert.deepEqual(
        validateBlockPositions(JSON.parse('{"x":{"left":1,"top":2}}')),
        { x: { left: 1, top: 2 } }
    );
});
