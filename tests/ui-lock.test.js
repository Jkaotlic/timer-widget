'use strict';

/**
 * Замок «Закрепить положение»: чистая логика + проводка во всех четырёх окнах.
 *
 * Просьба 19.08.2026: «введём настройку закрепления положения всего, когда всё
 * настроил, чтобы случайно что-то не сдвинуть».
 *
 * Тест держит цепочку целиком: модуль → `<head>` каждого окна → канал в ОБОИХ
 * списках → рассылка в главном процессе → кнопка в панели → проверка в каждом
 * жесте. Разрыв в любом звене даёт замок, который закрывается в одном окне и не
 * закрывается в остальных, — а выглядит это как «замок не работает», причём
 * ровно в тот момент, когда на него понадеялись.
 *
 * Чем это НЕ является: проверкой того, что жест действительно не сработал. Это
 * меряется на живых окнах в e2e/ui-lock.spec.js — здесь только то, что каждая
 * сторона про замок ЗНАЕТ.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const UILock = require(path.join(ROOT, 'ui-lock.js'));
const { codeOnly } = require('./helpers/source-scan.js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const WINDOWS = [
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html'
];

/** Поддельное хранилище: тот же приём, что в tests/window-geometry.test.js. */
function fakeStorage(initial = {}) {
    const data = { ...initial };
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        data
    };
}

test('умолчание — ОТКРЫТО: пустой профиль обязан позволять настраивать', () => {
    assert.equal(UILock.readLock(fakeStorage()), false);
});

test('состояние переживает запись и чтение', () => {
    const store = fakeStorage();
    UILock.writeLock(true, store);
    assert.equal(store.data[UILock.UI_LOCK_STORAGE_KEY], '1');
    assert.equal(UILock.readLock(store), true);

    UILock.writeLock(false, store);
    assert.equal(UILock.readLock(store), false);
});

test('мусор в хранилище читается как ОТКРЫТО, а не как правда', () => {
    // Значение пишет только этот модуль, но профиль переживает версии, а
    // «замок закрылся сам» — худший из возможных сюрпризов.
    for (const junk of ['да', 'true', '', 'null', '2']) {
        assert.equal(UILock.readLock(fakeStorage({ uiLocked: junk })), false, `«${junk}» прочиталось как закрыто`);
    }
});

test('сломанное хранилище не роняет ни чтение, ни запись', () => {
    const broken = {
        getItem() { throw new Error('storage is dead'); },
        setItem() { throw new Error('storage is dead'); }
    };
    assert.equal(UILock.readLock(broken), false);
    assert.equal(UILock.writeLock(true, broken), true);
});

test('каждое из четырёх окон подключает ui-lock.js и применяет замок в <head>', () => {
    // ДО первого кадра, рядом с темой: окно, применившее замок позже, успевает
    // показать подсветку перетаскивания, которой быть не должно.
    for (const file of WINDOWS) {
        const html = read(file);
        assert.match(html, /<script src="ui-lock\.js"><\/script>/, `${file}: нет ui-lock.js`);
        assert.match(html, /window\.UILock\.initLock\(\)/, `${file}: замок не применяется в <head>`);
        const head = html.slice(0, html.indexOf('</head>'));
        assert.ok(head.includes('window.UILock.initLock()'), `${file}: initLock вызывается ПОСЛЕ <head>`);
    }
});

test('канал ui-lock-update объявлен в ОБА конца и рассылается всем окнам', () => {
    const validator = read('channel-validator.js');
    const preload = read('preload.js');
    // Канал двусторонний: панель шлёт, все окна принимают. В валидаторе два
    // списка, и попадание только в один — это «шлём в никуда» или «слушаем
    // то, чего не пришлют».
    assert.equal((validator.match(/'ui-lock-update'/g) || []).length, 2, 'канала нет в обоих списках валидатора');
    assert.equal((preload.match(/'ui-lock-update'/g) || []).length, 2, 'канала нет в обоих списках preload');

    const main = codeOnly(read('electron-main.js'));
    assert.match(main, /ipcMain\.on\('ui-lock-update'/, 'главный процесс не принимает канал');
    // Рассылка ВСЕМ четырём окнам, как у темы: замок общий для приложения.
    const relay = main.slice(main.indexOf("ipcMain.on('ui-lock-update'"));
    assert.match(
        relay.slice(0, 600),
        /\[controlWindow, widgetWindow, displayWindow, clockWidgetWindow\]/,
        'замок рассылается не всем окнам'
    );
    assert.match(relay.slice(0, 600), /typeof locked !== 'boolean'/, 'payload замка не проверяется на тип');
});

test('панель ставит замок кнопкой и сообщает о нём при старте', () => {
    // Проводка живёт в panel-lock.js: у панели храповик на размер, и
    // самодостаточный блок выносится, а не дописывается в god-файл.
    const control = codeOnly(read('electron-control.html'));
    assert.match(control, /id="lockToggle"/, 'в титлбаре нет кнопки замка');
    assert.match(control, /<script src="panel-titlebar\.js"><\/script>/, 'панель не подключает panel-lock.js');
    assert.match(control, /window\.PanelTitlebar\.bindLockToggle\(/, 'кнопка замка ни к чему не привязана');

    const panelLock = codeOnly(read('panel-titlebar.js'));
    assert.match(panelLock, /lock\.writeLock\(value\)/, 'кнопка не сохраняет состояние');
    assert.match(panelLock, /lock\.applyLock\(value\)/, 'кнопка не применяет состояние в своём окне');
    assert.match(panelLock, /ipc\.send\('ui-lock-update', \{ locked: value \}\)/, 'кнопка не сообщает окнам');
    assert.match(
        panelLock,
        /send\('ui-lock-update', \{ locked: lock\.readLock\(\) \}\)/,
        'состояние замка не уезжает в окна при старте панели'
    );
});

test('проводка кнопки замка работает на поддельных документе и ipc', () => {
    // Ни окна, ни Electron: зависимости внедряются, поэтому поведение кнопки
    // проверяется здесь, а не только глазами в живом окне.
    const PanelTitlebar = require(path.join(ROOT, 'panel-titlebar.js'));
    const listeners = {};
    const button = {
        attrs: {}, classes: new Set(), textContent: '', title: '',
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; },
        classList: {
            toggle: (cls, on) => { if (on) { button.classes.add(cls); } else { button.classes.delete(cls); } }
        },
        addEventListener: (type, fn) => { listeners[type] = fn; }
    };
    const doc = { getElementById: (id) => (id === 'lockToggle' ? button : null) };
    const sent = [];
    const ipc = { send: (channel, payload) => sent.push([channel, payload]) };

    let stored = false;
    const lock = {
        readLock: () => stored,
        writeLock: (v) => { stored = !!v; return stored; },
        applyLock: (v) => !!v
    };

    const api = PanelTitlebar.bindLockToggle({ doc, ipc, lock });
    assert.ok(api, 'проводка не вернула управление');
    // Старт: состояние ушло в окна ещё до первого клика.
    assert.deepEqual(sent[0], ['ui-lock-update', { locked: false }]);
    assert.equal(button.textContent, '🔓');

    listeners.click();
    assert.equal(stored, true, 'клик не сохранил состояние');
    assert.equal(button.textContent, '🔒', 'глиф не сменился — состояние отличимо только цветом');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(sent[sent.length - 1], ['ui-lock-update', { locked: true }]);

    listeners.click();
    assert.equal(stored, false, 'второй клик не снял замок');
    assert.deepEqual(sent[sent.length - 1], ['ui-lock-update', { locked: false }]);
});

test('каждый жест спрашивает замок: перетаскивание и колесо во всех трёх окнах', () => {
    // Проверяется НАЛИЧИЕ вопроса в каждом жесте. Забытый жест — это не «замок
    // сломан», а «замок работает, кроме одного места», и найти такое можно
    // только перечислив места.
    const display = codeOnly(read('display-script.js'));
    assert.match(display, /this\._handlers\.wheel[\s\S]{0,400}window\.UILock/, 'дисплей: колесо не спрашивает замок');
    assert.match(display, /blockMousedown = \(e\) => \{[\s\S]{0,200}window\.UILock/, 'дисплей: перетаскивание карточки не спрашивает замок');
    assert.match(display, /altKeydown = \(e\) => \{[\s\S]{0,300}window\.UILock/, 'дисплей: подсветка Alt не спрашивает замок');
    assert.match(display, /window\.UILock\.bindLockSync\(/, 'дисплей не подписан на смену замка');

    const geometry = codeOnly(read('window-geometry.js'));
    assert.match(geometry, /function bindWindowDrag\(\{[^}]*isLocked/, 'общий модуль перетаскивания не принимает предикат замка');
    assert.match(geometry, /typeof isLocked === 'function' && isLocked\(\)/, 'предикат замка не проверяется');

    for (const file of ['electron-widget.html', 'electron-clock-widget.html']) {
        const code = codeOnly(read(file));
        assert.match(code, /isLocked: \(\) => !!\(window\.UILock/, `${file}: перетаскивание окна не спрашивает замок`);
        assert.match(code, /onWheel = \(e\) => \{[\s\S]{0,300}window\.UILock/, `${file}: колесо не спрашивает замок`);
    }
});

test('под замком крестик карточки не показывается ни при каких условиях', () => {
    const css = read('display.css');
    assert.match(css, /html\.ui-locked \.info-close \{[^}]*display: none/, 'крестик не скрыт под замком');
});

test('ключ замка объявлен в реестре хранилища', () => {
    const constants = read('constants.js');
    assert.ok(
        constants.includes("UI_LOCKED: 'uiLocked'"),
        'ключ uiLocked не объявлен в CONFIG.STORAGE_KEYS — реестр обязан знать все ключи профиля'
    );
});
