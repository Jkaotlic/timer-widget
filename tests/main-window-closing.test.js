'use strict';

/**
 * main-window-closing.js на поддельных окнах и поддельном времени: отложенное
 * открытие (queueOpenAfterClose) — поведение, а не текст.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWindowClosing, WINDOW_REOPEN_TIMEOUT_MS } = require('../main-window-closing');

function fakeWindow() {
    const handlers = new Map();
    return {
        isDestroyed: () => false,
        once(event, fn) { handlers.set(event, fn); },
        emit(event) {
            const fn = handlers.get(event);
            handlers.delete(event);
            if (fn) { fn(); }
        }
    };
}

test('MAIN-03: страховка прошлого запроса не открывает окно за следующий', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { queueOpenAfterClose } = createWindowClosing({ windows: {} });
    const made = [];

    // Первый запрос: окно A закрывается, `closed` приходит через 100 мс.
    const a = fakeWindow();
    assert.equal(queueOpenAfterClose('display', a, () => made.push('first')), true);
    t.mock.timers.tick(100);
    a.emit('closed');
    assert.deepEqual(made, ['first']);

    // Через 0,5 с — новое закрытие и новое «открыть», окно B ещё уходит.
    t.mock.timers.tick(400);
    const b = fakeWindow();
    assert.equal(queueOpenAfterClose('display', b, () => made.push('second')), true);

    // Страховка ПЕРВОГО запроса (3 с от его начала) не вправе исполнить второй:
    // B ещё не закрыт, а для него страховка — 3 с от ЕГО начала.
    t.mock.timers.tick(WINDOW_REOPEN_TIMEOUT_MS - 500);
    assert.deepEqual(made, ['first'], 'чужая страховка открыла окно раньше closed');

    b.emit('closed');
    assert.deepEqual(made, ['first', 'second']);

    // И своя страховка второго запроса не создаёт окно повторно.
    t.mock.timers.tick(WINDOW_REOPEN_TIMEOUT_MS);
    assert.deepEqual(made, ['first', 'second']);
});

test('MAIN-03: своя страховка по-прежнему открывает окно, если closed не пришёл', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { queueOpenAfterClose } = createWindowClosing({ windows: {} });
    const made = [];
    queueOpenAfterClose('widget', fakeWindow(), () => made.push('w'));
    t.mock.timers.tick(WINDOW_REOPEN_TIMEOUT_MS - 1);
    assert.deepEqual(made, []);
    t.mock.timers.tick(1);
    assert.deepEqual(made, ['w']);
});

test('MAIN-03: «закрыть» отменяет и страховку; последний запрос побеждает', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { queueOpenAfterClose, cancelQueuedOpen } = createWindowClosing({ windows: {} });
    const made = [];
    const w = fakeWindow();
    queueOpenAfterClose('clock', w, () => made.push('old'));
    queueOpenAfterClose('clock', null, () => made.push('new'));
    w.emit('closed');
    assert.deepEqual(made, ['new']);

    const w2 = fakeWindow();
    queueOpenAfterClose('clock', w2, () => made.push('cancelled'));
    cancelQueuedOpen('clock');
    t.mock.timers.tick(WINDOW_REOPEN_TIMEOUT_MS);
    w2.emit('closed');
    assert.deepEqual(made, ['new']);
});
