'use strict';

/**
 * Ctrl+1…4 в полноэкранном окне применяет пресет ВИДА (аудит 27.10.2026,
 * DISPLAY-KB-01).
 *
 * Ветка `preset-apply` стояла ПОСЛЕ раннего выхода
 * `if (e.ctrlKey || e.altKey || e.metaKey) return` и не исполнялась никогда:
 * канал был разрешён (ipc-senders.js), проброшен (main-relay-ipc.js) и слушался
 * панелью (panel-presets.js), а жест на дисплее молчал.
 *
 * Голые 1…4 остаются пресетами ВРЕМЕНИ; Ctrl+Shift+N на дисплее ничего не
 * делает (на панели это запись ячейки — окну её делать нечем).
 */

const test = require('node:test');
const assert = require('node:assert');
const { displayKeys } = require('./helpers/display-keys');

test('Ctrl+1…4 шлёт preset-apply с номером ячейки', () => {
    for (const n of [1, 2, 3, 4]) {
        const { press, sent } = displayKeys();
        const ev = press({ code: `Digit${n}`, ctrlKey: true });
        assert.deepStrictEqual(sent, [['preset-apply', { slot: n }]], `Ctrl+${n}`);
        assert.ok(ev.defaultPrevented);
    }
});

test('Cmd+1 (macOS) — то же', () => {
    const { press, sent } = displayKeys();
    press({ code: 'Digit1', metaKey: true });
    assert.deepStrictEqual(sent, [['preset-apply', { slot: 1 }]]);
});

test('голая цифра — по-прежнему пресет времени, не вида', () => {
    const { press, sent } = displayKeys();
    press({ code: 'Digit2' });
    assert.deepStrictEqual(sent, [['timer-command', { type: 'set', seconds: 600 }]]);
});

test('Ctrl+5, Ctrl+Shift+1, Alt+1 и Ctrl+Space ничего не шлют', () => {
    const { press, sent } = displayKeys();
    press({ code: 'Digit5', ctrlKey: true });
    press({ code: 'Digit1', ctrlKey: true, shiftKey: true });
    press({ code: 'Digit1', altKey: true });
    press({ code: 'Space', ctrlKey: true });
    assert.deepStrictEqual(sent, []);
});
