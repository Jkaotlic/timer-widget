'use strict';

/**
 * Автоповтор удержанной клавиши в полноэкранном окне — не новая команда
 * (аудит 27.10.2026, DISPLAY-KB-02).
 *
 * Обработчик дисплея не смотрел на `e.repeat`: удержанный Space слал
 * start/pause на каждом повторе (таймер дёргался, пока состояние ехало по
 * IPC), удержанная R засыпала главный процесс сбросами. Панель это уже лечит
 * воротами globalHotkeyBlocked() из shortcuts-help.js (PANEL-005); дисплей
 * этот файл не грузит (в нём справка F1 и слои панели, которых у дисплея нет),
 * поэтому здесь — то же первое правило ворот: повтор не исполняется.
 */

const test = require('node:test');
const assert = require('node:assert');
const { displayKeys } = require('./helpers/display-keys');

test('удержанный Space: старт один раз, повторы не шлют ничего', () => {
    const { press, sent } = displayKeys();
    press({ code: 'Space' });
    press({ code: 'Space', repeat: true });
    press({ code: 'Space', repeat: true });
    assert.deepStrictEqual(sent, [['timer-control', 'start']]);
});

test('удержанная R: один сброс', () => {
    const { press, sent } = displayKeys();
    press({ code: 'KeyR' });
    press({ code: 'KeyR', repeat: true });
    assert.deepStrictEqual(sent, [['timer-control', 'reset']]);
});

test('повтор W/C/D/Z/цифры/Ctrl+1 тоже не исполняется', () => {
    const { press, sent } = displayKeys();
    for (const code of ['KeyW', 'KeyC', 'KeyD', 'KeyZ', 'KeyS', 'Digit1']) {
        press({ code, repeat: true });
    }
    press({ code: 'Digit1', ctrlKey: true, repeat: true });
    assert.deepStrictEqual(sent, []);
});

test('отдельные нажатия по-прежнему работают каждое', () => {
    const { press, sent } = displayKeys({ isRunning: true });
    press({ code: 'Space' });
    press({ code: 'Space' });
    assert.deepStrictEqual(sent, [['timer-control', 'pause'], ['timer-control', 'pause']]);
});
