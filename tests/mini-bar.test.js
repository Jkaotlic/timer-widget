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
    for (const id of ['miniBarToggle', 'miniBarExpand', 'miniBar', 'miniBarTime', 'miniBarDot',
        'miniBarStart', 'miniBarPause', 'miniBarReset']) {
        els.set(id, mkEl(id));
    }
    els.set('titlebar', mkEl('titlebar'));
    return {
        body,
        getElementById: (id) => els.get(id) || null,
        querySelector: (sel) => (sel === '.custom-titlebar' ? els.get('titlebar') : null),
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

test('render пишет время и полосу состояния в полосу', () => {
    // DOM полосы принадлежит модулю полосы: панель отдаёт ей ЗНАЧЕНИЯ, а не
    // лезет в её элементы. Иначе разметка полосы оказывается размазана между
    // двумя файлами, а inline-скрипт панели упирается в свой потолок.
    const doc = fakeDoc();
    const bar = MiniBar.init({ doc, ipc: fakeIpc() });

    bar.render({ text: '−01:30', band: 'danger' });

    assert.equal(doc._el('miniBarTime').textContent, '−01:30');
    assert.equal(doc._el('miniBarDot').className, 'mini-dot danger');
});

test('в паузе кнопка полосы называется «Продолжить», а не «Старт»', () => {
    // Слово принадлежит полосе, а признак — панели: панель знает, что таймер
    // на паузе, полоса знает, каким элементом это показать. Раньше слова не
    // было вовсе — в паузе на экране висела «Пауза», нажатие по которой
    // ставило паузу ещё раз.
    const doc = fakeDoc();
    const bar = MiniBar.init({ doc, ipc: fakeIpc() });

    bar.render({ text: '04:12', band: 'normal', resume: true });
    assert.equal(doc._el('miniBarStart').textContent, 'Продолжить');

    bar.render({ text: '05:00', band: 'normal', resume: false });
    assert.equal(doc._el('miniBarStart').textContent, 'Старт');
});

test('render переводит спокойное состояние в ok, а неизвестное — тоже в ok', () => {
    const doc = fakeDoc();
    const bar = MiniBar.init({ doc, ipc: fakeIpc() });

    bar.render({ text: '05:00', band: 'normal' });
    assert.equal(doc._el('miniBarDot').className, 'mini-dot ok');

    bar.render({ text: '05:00', band: 'нечто' });
    assert.equal(doc._el('miniBarDot').className, 'mini-dot ok');

    bar.render({ text: '01:00', band: 'warning' });
    assert.equal(doc._el('miniBarDot').className, 'mini-dot warning');
});

test('двойной клик по полосе и по титлбару переключает режим, по кнопке — нет', () => {
    // Двойной клик по кнопке — это два клика по кнопке. Превращать его ещё и
    // в смену режима нельзя: пользователь дважды нажал «пауза», а окно
    // схлопнулось.
    const doc = fakeDoc();
    const bar = MiniBar.init({ doc, ipc: fakeIpc() });

    doc._el('miniBar').handlers.dblclick({ target: { closest: () => null } });
    assert.equal(bar.isCollapsed(), true);

    doc._el('miniBar').handlers.dblclick({ target: { closest: (sel) => (sel === 'button' ? {} : null) } });
    assert.equal(bar.isCollapsed(), true, 'двойной клик по кнопке режим не меняет');

    doc._el('titlebar').handlers.dblclick({ target: { closest: () => null } });
    assert.equal(bar.isCollapsed(), false);
});

test('кнопки транспорта полосы ведут в переданные действия', () => {
    // Своего управления таймером у полосы нет: она вызывает ТЕ ЖЕ методы
    // контроллера, что и большие кнопки панели. Действия внедряются, поэтому
    // проводка проверяется здесь, а не только кликом в e2e.
    const doc = fakeDoc();
    const calls = [];
    MiniBar.init({
        doc,
        ipc: fakeIpc(),
        actions: {
            start: () => calls.push('start'),
            pause: () => calls.push('pause'),
            reset: () => calls.push('reset')
        }
    });

    doc._el('miniBarStart').handlers.click();
    doc._el('miniBarPause').handlers.click();
    doc._el('miniBarReset').handlers.click();

    assert.deepEqual(calls, ['start', 'pause', 'reset']);
});

test('без действий кнопки транспорта не роняют модуль', () => {
    const doc = fakeDoc();
    MiniBar.init({ doc, ipc: fakeIpc() });
    assert.doesNotThrow(() => doc._el('miniBarStart').handlers.click());
});
