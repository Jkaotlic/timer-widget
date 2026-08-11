'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MiniBar = require('../mini-bar.js');

// Поддельный документ: ровно то, чего касается модуль. Настоящего DOM здесь
// нет намеренно — так же сделан onboarding.js, и по той же причине: логику
// режима видно без запуска Electron.
function fakeDoc() {
    const body = { classes: new Set(), classList: null };
    body.classList = {
        add: (c) => body.classes.add(c),
        remove: (c) => body.classes.delete(c),
        contains: (c) => body.classes.has(c)
    };
    const els = new Map();
    const mkEl = (id) => ({
        id,
        handlers: {},
        attrs: {},
        addEventListener(type, fn) { this.handlers[type] = fn; },
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; }
    });
    for (const id of ['miniBarToggle', 'miniBarExpand', 'miniBar']) { els.set(id, mkEl(id)); }
    return {
        body,
        getElementById: (id) => els.get(id) || null,
        _el: (id) => els.get(id)
    };
}

function fakeIpc() {
    const sent = [];
    return { sent, send: (channel, payload) => sent.push({ channel, payload }) };
}

test('свёртывание ставит класс на body и шлёт высоту полосы', () => {
    const doc = fakeDoc();
    const ipc = fakeIpc();
    const bar = MiniBar.init({ doc, ipc });

    bar.collapse();

    assert.equal(bar.isCollapsed(), true);
    assert.equal(doc.body.classList.contains('collapsed'), true);
    assert.deepEqual(ipc.sent, [
        { channel: 'control-collapse', payload: { collapsed: true, height: MiniBar.BAR_HEIGHT } }
    ]);
});

test('разворот снимает класс и шлёт collapsed: false', () => {
    const doc = fakeDoc();
    const ipc = fakeIpc();
    const bar = MiniBar.init({ doc, ipc });

    bar.collapse();
    bar.expand();

    assert.equal(bar.isCollapsed(), false);
    assert.equal(doc.body.classList.contains('collapsed'), false);
    assert.equal(ipc.sent.length, 2);
    assert.deepEqual(ipc.sent[1], { channel: 'control-collapse', payload: { collapsed: false } });
});

test('повторный вызов в том же состоянии не шлёт ничего', () => {
    // Дребезг стоит дорого: каждый лишний setSize на Windows округляет внешний
    // размер окна и даёт дрейф — этим же болел resize-control-window, и там
    // стоит такая же проверка.
    const doc = fakeDoc();
    const ipc = fakeIpc();
    const bar = MiniBar.init({ doc, ipc });

    bar.expand();              // уже развёрнуто
    assert.equal(ipc.sent.length, 0);

    bar.collapse();
    bar.collapse();
    assert.equal(ipc.sent.length, 1);
});

test('перед свёртыванием вызывается onToggle, чтобы закрыть ящик настроек', () => {
    // Ящик обязан закрыться ДО сжатия: он расширяет окно вправо, и полоса с
    // открытым ящиком была бы 716px шириной при высоте 52.
    const doc = fakeDoc();
    const ipc = fakeIpc();
    const calls = [];
    const bar = MiniBar.init({ doc, ipc, onToggle: (state) => calls.push(state) });

    bar.collapse();
    bar.expand();

    assert.deepEqual(calls, [true, false]);
});

test('onToggle вызывается ДО отправки в главный процесс', () => {
    // Порядок наблюдаемый: если ящик закрывается ПОСЛЕ сжатия, окно успевает
    // стать полосой шириной с панель плюс ящик.
    const doc = fakeDoc();
    const ipc = fakeIpc();
    const order = [];
    const bar = MiniBar.init({
        doc,
        ipc: { send: (ch, p) => { order.push('send'); ipc.send(ch, p); } },
        onToggle: () => order.push('toggle')
    });

    bar.collapse();
    assert.deepEqual(order, ['toggle', 'send']);
});

test('без ipc модуль не падает', () => {
    // Панель грузится и без моста (превью вёрстки в браузере), а окно без
    // моста — это отсутствующий window.ipcRenderer, а не исключение.
    const doc = fakeDoc();
    const bar = MiniBar.init({ doc, ipc: null });
    assert.doesNotThrow(() => bar.collapse());
    assert.equal(bar.isCollapsed(), true);
});

test('кнопки полосы и титлбара переключают режим', () => {
    const doc = fakeDoc();
    const ipc = fakeIpc();
    const bar = MiniBar.init({ doc, ipc });

    doc._el('miniBarToggle').handlers.click();
    assert.equal(bar.isCollapsed(), true);
    doc._el('miniBarExpand').handlers.click();
    assert.equal(bar.isCollapsed(), false);
});

test('состояние объявлено для доступности', () => {
    const doc = fakeDoc();
    const bar = MiniBar.init({ doc, ipc: fakeIpc() });

    assert.equal(doc._el('miniBarToggle').getAttribute('aria-expanded'), 'true');
    bar.collapse();
    assert.equal(doc._el('miniBarToggle').getAttribute('aria-expanded'), 'false');
});

test('без документа init возвращает null и ничего не ломает', () => {
    assert.equal(MiniBar.init({}), null);
    assert.equal(MiniBar.init({ doc: {} }), null);
});
