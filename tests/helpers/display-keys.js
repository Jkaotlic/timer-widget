'use strict';

/**
 * Обработчик клавиш дисплея — НАСТОЯЩИЙ, из display-script.js: метод
 * setupKeyboardShortcuts() вынимается из исходника и исполняется на поддельном
 * `this` с поддельными document/window. Возвращает функцию «нажать клавишу» и
 * журнал того, что окно отправило в главный процесс.
 */

const fs = require('node:fs');
const path = require('node:path');
const { balancedBlockAt, maskNonCode } = require('./source-scan');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'display-script.js'), 'utf8');

function setupKeyboardShortcutsFn() {
    const mask = maskNonCode(SRC);
    const m = /\n\s+setupKeyboardShortcuts\(\)\s*\{/.exec(mask);
    if (!m) { throw new Error('setupKeyboardShortcuts не найден'); }
    const block = balancedBlockAt(SRC, m.index, 'setupKeyboardShortcuts');
    const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
     
    return new Function('document', 'window', body);
}

/**
 * @param {{isRunning?: boolean}} [state]
 * @returns {{press: (init: object) => object, sent: Array<[string, any]>}}
 */
function displayKeys(state = {}) {
    const sent = [];
    let handler = null;
    const fakeDocument = {
        addEventListener: (type, fn) => { if (type === 'keydown') { handler = fn; } }
    };
    const fakeWindow = { CONFIG: { PRESET_DURATIONS: [300, 600, 900, 1800] } };
    const self = {
        isRunning: !!state.isRunning,
        ipcHandlers: {},
        _handlers: {},
        ipcRenderer: {
            on() {},
            send: (channel, payload) => sent.push([channel, payload])
        }
    };
    setupKeyboardShortcutsFn().call(self, fakeDocument, fakeWindow);
    if (!handler) { throw new Error('обработчик keydown не повешен'); }
    const press = (init) => {
        const event = {
            ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
            ...init
        };
        handler(event);
        return event;
    };
    return { press, sent, self };
}

module.exports = { displayKeys };
