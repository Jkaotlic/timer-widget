'use strict';

/**
 * PANEL-013 (аудит 27.10.2026): режим ручного ввода не снимался, когда таймер
 * запускали из другого окна (кнопка виджета, горячая клавиша часов).
 * _onTimerState обновлял isRunning, а renderPanelState выбирал режим 'input'
 * по одному флагу inputMode: панель показывала поля ЧЧ:ММ:СС и «Поставить» при
 * бегущем таймере, Enter слал set, который main молча отклонял.
 *
 * Состояние панели выводится из ТАЙМЕРА (правило renderPanelState), а
 * setInputMode уже отказывается включать ввод при отсчёте — значит и
 * пришедший отсчёт обязан ввод снимать.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const RendererShared = require('../renderer-shared.js');
const { PanelStateMixin } = require('../panel-state.js');

// Документ, на котором можно вызвать что угодно: проверяется решение о
// режиме, а не вёрстка.
const any = new Proxy(function stub() {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : (key === 'length' ? 0 : any)),
    apply: () => any,
    set: () => true
});

function render(host) {
    const prev = { window: global.window, document: global.document, requestAnimationFrame: global.requestAnimationFrame };
    const classes = [];
    global.document = new Proxy({}, {
        get: (_t, key) => {
            if (key === 'body') {
                return new Proxy({}, {
                    get: (_b, k) => (k === 'classList'
                        ? { add: (c) => classes.push(c), remove: () => {}, toggle: () => {}, contains: () => false }
                        : any)
                });
            }
            return any;
        }
    });
    global.window = new Proxy({ RendererShared }, { get: (t, k) => (k in t ? t[k] : any) });
    global.requestAnimationFrame = () => 0;
    try {
        host.renderPanelState();
        return classes;
    } finally { Object.assign(global, prev); }
}

test('PANEL-013: пришедший отсчёт снимает режим ручного ввода', () => {
    const blurred = [];
    const host = Object.setPrototypeOf(Object.assign({
        inputMode: true,
        isRunning: true,
        isPaused: false,
        remainingSeconds: 290,
        totalSeconds: 300,
        _timeFields: [{ id: 'manualMinutes', el: { blur: () => blurred.push('m'), value: '' } }]
    }, PanelStateMixin), any);
    const classes = render(host);
    assert.equal(host.inputMode, false, 'ввод остался открытым при бегущем таймере');
    assert.ok(!classes.includes('state-input'), 'панель показывает state-input при отсчёте');
    assert.ok(classes.includes('state-running'), 'панель не перешла в отсчёт: ' + classes.join(','));
    assert.ok(blurred.length > 0, 'поля ввода не отпустили фокус');
});

test('PANEL-013: в покое режим ввода сохраняется', () => {
    const host = Object.setPrototypeOf(Object.assign({
        inputMode: true, isRunning: false, isPaused: false, remainingSeconds: 300, totalSeconds: 300, _timeFields: []
    }, PanelStateMixin), any);
    const classes = render(host);
    assert.equal(host.inputMode, true);
    assert.ok(classes.includes('state-input'));
});
