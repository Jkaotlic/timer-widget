'use strict';

/**
 * toast-dom.js — минимум DOM, на котором настоящий Toast (ui-feedback.js)
 * может показаться в Node. Подмены самого Toast нет: модули берут его import-ом,
 * поэтому тесты подкладывают не `window.Toast`, а документ, в который он пишет.
 */

/**
 * Дополняет `doc` методами, которые нужны Toast, и глушит таймеры показа.
 * Возвращает `{ doc, toasts, restore }`: toasts() — показанные тосты.
 * @param {object} doc — поддельный document теста
 */
function installToastDom(doc) {
    const saved = { raf: global.requestAnimationFrame, timeout: global.setTimeout };
    const created = [];
    const node = () => {
        const n = { className: '', textContent: '', classList: { add() {}, remove() {} }, remove() {} };
        n.appendChild = (child) => child;
        return n;
    };
    doc.createElement = () => { const n = node(); created.push(n); return n; };
    doc.body = doc.body || node();
    global.requestAnimationFrame = () => 0;
    global.setTimeout = () => 0;
    return {
        doc,
        toasts: () => created
            .filter((n) => n.className.startsWith('toast '))
            .map((n) => ({ msg: n.textContent, kind: n.className.slice('toast '.length) })),
        restore() {
            global.requestAnimationFrame = saved.raf;
            global.setTimeout = saved.timeout;
        }
    };
}

module.exports = { installToastDom };
