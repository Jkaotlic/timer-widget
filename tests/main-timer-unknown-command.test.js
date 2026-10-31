'use strict';

/**
 * `timer-command` НЕИЗВЕСТНОГО типа в главном процессе — пустая операция:
 * состояние не меняется, окнам ничего не уходит, снимок восстановления не
 * пишется, трей не трогается.
 *
 * На этом держится барьер e2e `moveBarrier` (e2e/window-ready.js): окно шлёт
 * `timer-command` с типом `e2e-barrier` и меткой, и ждёт, что main её ПОЛУЧИЛ
 * — по порядку посылок одного окна. Если неизвестный тип когда-нибудь начнёт
 * что-то делать (`default` с побочным эффектом), барьер начнёт это делать на
 * каждом вызове молча; этот тест покраснеет раньше (ревью e2e-B7b, M2).
 *
 * Положительный контроль — известный тип через тот же обработчик: `set`
 * рассылает состояние. Без него зелёный значил бы и «пусто», и «обработчик
 * вообще не подписан».
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTimer } = require('../main-timer');
const CONFIG = require('../constants.js');

function rig() {
    const sent = [];
    const calls = { accrue: 0, persist: 0, tray: 0 };
    const win = (name) => ({ name });
    const windows = {
        controlWindow: win('control'), widgetWindow: win('widget'),
        displayWindow: win('display'), clockWidgetWindow: win('clock')
    };
    const timer = createTimer({
        windows,
        CONFIG,
        safelySendToWindow: (w, channel, payload) => { sent.push({ to: w && w.name, channel, payload }); },
        accrueOverrun: () => { calls.accrue++; },
        persistRecoverySnapshot: () => { calls.persist++; },
        updateTrayMenu: () => { calls.tray++; }
    });
    const ipcMain = new EventEmitter();
    timer.registerIpc(ipcMain);
    return { timer, ipcMain, sent, calls };
}

test('timer-command неизвестного типа ничего не меняет и ничего не шлёт', () => {
    const { timer, ipcMain, sent, calls } = rig();
    const before = JSON.stringify(timer.getState());
    ipcMain.emit('timer-command', {}, { type: 'e2e-barrier', e2eBarrier: 'barrier#1' });
    assert.equal(JSON.stringify(timer.getState()), before, 'состояние таймера изменилось');
    assert.deepEqual(sent, [], 'окнам ушла посылка');
    assert.deepEqual(calls, { accrue: 0, persist: 0, tray: 0 }, 'тронут учёт, снимок или трей');
    timer.clearTimerInterval();
});

test('положительный контроль: известная команда через тот же обработчик рассылает состояние', () => {
    const { timer, ipcMain, sent } = rig();
    ipcMain.emit('timer-command', {}, { type: 'set', seconds: 90 });
    assert.equal(timer.getState().totalSeconds, 90);
    assert.ok(sent.some((s) => s.channel === 'timer-state'), 'set не разослал timer-state');
    timer.clearTimerInterval();
});
