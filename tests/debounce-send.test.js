const test = require('node:test');
const assert = require('node:assert/strict');
const { debounce, safelySendToWindow } = require('../utils');

// --- debounce tests ---

test('debounce delays function execution', async () => {
    let callCount = 0;
    const fn = debounce(() => { callCount++; }, 50);

    fn();
    fn();
    fn();

    assert.equal(callCount, 0, 'should not call immediately');

    await new Promise(r => setTimeout(r, 80));
    assert.equal(callCount, 1, 'should call once after delay');
});

test('debounce passes arguments correctly', async () => {
    let received = null;
    const fn = debounce((a, b) => { received = { a, b }; }, 30);

    fn(1, 2);

    await new Promise(r => setTimeout(r, 60));
    assert.deepEqual(received, { a: 1, b: 2 });
});

test('debounce resets timer on repeated calls', async () => {
    let callCount = 0;
    const fn = debounce(() => { callCount++; }, 50);

    fn();
    await new Promise(r => setTimeout(r, 30));
    fn(); // reset timer
    await new Promise(r => setTimeout(r, 30));
    assert.equal(callCount, 0, 'should not call yet');

    await new Promise(r => setTimeout(r, 40));
    assert.equal(callCount, 1, 'should call once after final delay');
});

test('debounce uses default delay of 120ms', async () => {
    let called = false;
    const fn = debounce(() => { called = true; });

    fn();
    await new Promise(r => setTimeout(r, 80));
    assert.equal(called, false, 'should not call before 120ms');

    await new Promise(r => setTimeout(r, 60));
    assert.equal(called, true, 'should call after 120ms');
});

// --- safelySendToWindow tests ---

test('safelySendToWindow returns false for null window', () => {
    assert.equal(safelySendToWindow(null, 'test'), false);
    assert.equal(safelySendToWindow(undefined, 'test'), false);
});

test('safelySendToWindow returns false for destroyed window', () => {
    const mockWindow = { isDestroyed: () => true };
    assert.equal(safelySendToWindow(mockWindow, 'test'), false);
});

test('safelySendToWindow returns false for destroyed webContents', () => {
    const mockWindow = {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => true, send: () => {} }
    };
    assert.equal(safelySendToWindow(mockWindow, 'test'), false);
});

test('safelySendToWindow returns true on successful send', () => {
    let sentChannel = null;
    let sentArgs = null;
    const mockWindow = {
        isDestroyed: () => false,
        webContents: {
            isDestroyed: () => false,
            send: (ch, ...args) => { sentChannel = ch; sentArgs = args; }
        }
    };

    const result = safelySendToWindow(mockWindow, 'timer-state', { time: 60 });
    assert.equal(result, true);
    assert.equal(sentChannel, 'timer-state');
    assert.deepEqual(sentArgs, [{ time: 60 }]);
});

test('safelySendToWindow returns false when webContents is null', () => {
    const mockWindow = {
        isDestroyed: () => false,
        webContents: null
    };
    assert.equal(safelySendToWindow(mockWindow, 'test'), false);
});

test('safelySendToWindow catches errors and returns false', () => {
    const mockWindow = {
        isDestroyed: () => false,
        webContents: {
            isDestroyed: () => false,
            send: () => { throw new Error('send failed'); }
        }
    };
    assert.equal(safelySendToWindow(mockWindow, 'test'), false);
});
