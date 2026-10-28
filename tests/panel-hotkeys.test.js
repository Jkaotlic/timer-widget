'use strict';

/**
 * PANEL-005 (аудит 27.10.2026): глобальные клавиши панели срабатывали там, где
 * клавиша принадлежит другому слою.
 *
 *  1. Автоповтор: удержанный Space слал start/pause на каждом повторе keydown,
 *     пока состояние едет по IPC, — таймер дёргался. То же R, Z, M, W, C, D.
 *  2. SELECT в фокусе: буквы и пробел перехватывались с preventDefault —
 *     список нельзя ни открыть пробелом, ни пролистать по первой букве.
 *  3. Кнопка в фокусе С КЛАВИАТУРЫ (Tab): Space делал preventDefault, и
 *     Chromium не выполнял click — пробелом нельзя было нажать ни одну кнопку.
 *     Замер в живом окне: кнопка в фокусе, Space → click 0 раз. Кнопка, на
 *     которую только что кликнули МЫШЬЮ, остаётся за таймером: «кликнул пресет
 *     5 мин — нажал пробел — пошёл отсчёт» работало всегда и ломать это нельзя.
 *  4. Открытая модалка или справка F1: Space запускал таймер, R сбрасывал его
 *     ЗА диалогом. F1 остаётся рабочим — это переключатель самой справки.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { globalHotkeyBlocked, trackPointerControl } = require('../shortcuts-help.js');
const { codeOnly } = require('./helpers/source-scan');
const { readSource } = require('./helpers/window-source');

// Элемент с `closest` по простому описанию: тег, роль, классы, предки.
function node({ tag = 'div', role = null, cls = [], editable = false, parent = null } = {}) {
    const self = {
        tagName: tag.toUpperCase(), role, cls, isContentEditable: editable, parentElement: parent,
        matchesOne(sel) {
            sel = sel.trim();
            if (sel === 'input' || sel === 'textarea' || sel === 'select' || sel === 'button' || sel === 'summary') {
                return this.tagName === sel.toUpperCase();
            }
            if (sel === 'a[href]') { return this.tagName === 'A'; }
            const r = /^\[role="([a-z]+)"\]$/.exec(sel);
            if (r) { return this.role === r[1]; }
            if (sel.startsWith('.')) { return this.cls.includes(sel.slice(1)); }
            return false;
        },
        closest(selectors) {
            for (let el = this; el; el = el.parentElement) {
                if (selectors.split(',').some((s) => el.matchesOne(s))) { return el; }
            }
            return null;
        }
    };
    return self;
}

const docWith = (openLayer) => ({ querySelector: () => (openLayer ? {} : null) });
const key = (code, target, extra = {}) => Object.assign({ code, key: code, target, repeat: false }, extra);
const body = node({ tag: 'body' });

test('пробел и буквы на <body> работают как раньше', () => {
    for (const code of ['Space', 'KeyR', 'KeyS', 'KeyW', 'KeyC', 'KeyD', 'KeyZ', 'KeyM', 'Digit1', 'F1']) {
        assert.equal(globalHotkeyBlocked(key(code, body), docWith(false), null), false, `${code} на body заблокирован`);
    }
});

test('автоповтор не повторяет команду', () => {
    for (const code of ['Space', 'KeyR', 'KeyZ', 'KeyM', 'KeyW', 'KeyC', 'KeyD']) {
        assert.equal(globalHotkeyBlocked(key(code, body, { repeat: true }), docWith(false), null), true,
            `${code} с автоповтором проходит`);
    }
});

test('поля ввода и SELECT клавиши не отдают', () => {
    for (const tag of ['input', 'textarea', 'select']) {
        for (const code of ['Space', 'KeyR', 'KeyS']) {
            assert.equal(globalHotkeyBlocked(key(code, node({ tag })), docWith(false), null), true,
                `${code} в ${tag} перехватывается`);
        }
    }
    const editable = node({ editable: true });
    assert.equal(globalHotkeyBlocked(key('KeyR', editable), docWith(false), null), true, 'contenteditable');
});

test('пробел на кнопке в фокусе С КЛАВИАТУРЫ — за кнопкой; буквы — за панелью', () => {
    const controls = [
        node({ tag: 'button' }),
        node({ role: 'radio' }),
        node({ role: 'switch' }),
        // Цель — потомок кнопки (иконка): решает сама кнопка.
        node({ tag: 'span', parent: node({ tag: 'button' }) })
    ];
    for (const target of controls) {
        assert.equal(globalHotkeyBlocked(key('Space', target), docWith(false), null), true,
            'Space на кнопке ушёл таймеру — кнопку пробелом не нажать');
        assert.equal(globalHotkeyBlocked(key('KeyR', target), docWith(false), null), false,
            'буква на кнопке перестала работать — её кнопка не потребляет');
    }
});

test('пробел на кнопке, по которой только что кликнули МЫШЬЮ, — по-прежнему таймер', () => {
    const btn = node({ tag: 'button' });
    assert.equal(globalHotkeyBlocked(key('Space', btn), docWith(false), btn), false,
        'клик мышью по пресету и пробел больше не запускают отсчёт');
    const icon = node({ tag: 'span', parent: btn });
    assert.equal(globalHotkeyBlocked(key('Space', icon), docWith(false), btn), false);
});

test('открытая модалка или справка F1 глушат всё, кроме F1', () => {
    for (const code of ['Space', 'KeyR', 'KeyW', 'Digit2']) {
        assert.equal(globalHotkeyBlocked(key(code, body), docWith(true), null), true,
            `${code} сработал за открытым диалогом`);
    }
    assert.equal(globalHotkeyBlocked(key('F1', body), docWith(true), null), false,
        'F1 обязан закрывать собственную справку');
});

test('обработчик панели спрашивает ворота ПЕРВЫМ, старой проверки одного INPUT/TEXTAREA нет', () => {
    const src = codeOnly(readSource('control-app.js'));
    const at = src.indexOf('const _onGlobalShortcutsKeydown');
    assert.notEqual(at, -1);
    const head = src.slice(at, at + 400);
    assert.match(head, /window\.globalHotkeyBlocked\(event, document, /, 'ворота не вызваны в начале обработчика');
    assert.doesNotMatch(src, /event\.target\.tagName === 'INPUT' \|\| event\.target\.tagName === 'TEXTAREA'/,
        'старая неполная проверка вернулась');
});

/*
 * Регрессия первой версии ворот (проверка итога 28.10.2026).
 *
 *  1. Монитор выбрали в #displaySelect МЫШЬЮ — фокус остаётся на списке, и
 *     D / W / C / Space молчали, пока фокус не уйдёт. Раньше работали. Список,
 *     выбранный мышью, — то же, что кнопка, по которой кликнули мышью: клавиши
 *     принадлежат таймеру. Список, до которого дошли Tab'ом, — по-прежнему
 *     вводу (листание по первой букве).
 *  2. `.font-select` пробел НЕ обрабатывает (font-select.js слушает только
 *     стрелки), поэтому в списке «нажимается пробелом сам» ему не место: Space
 *     на нём ничего не делал вовсе.
 */
test('список, выбранный мышью, отдаёт клавиши таймеру; выбранный с клавиатуры — нет', () => {
    const select = node({ tag: 'select' });
    for (const code of ['KeyD', 'KeyW', 'KeyC', 'Space']) {
        assert.equal(globalHotkeyBlocked(key(code, select), docWith(false), select), false,
            `${code} после выбора мышью молчит`);
        assert.equal(globalHotkeyBlocked(key(code, select), docWith(false), null), true,
            `${code} в списке с клавиатуры ушёл таймеру — листание по букве сломано`);
    }
});

test('пробел на .font-select — таймеру: компонент пробел не обрабатывает', () => {
    const fs = node({ cls: ['font-select'] });
    assert.equal(globalHotkeyBlocked(key('Space', fs), docWith(false), null), false,
        'пробел на списке шрифтов не делает ничего');
});

test('клик мышью по SELECT запоминается так же, как по кнопке', () => {
    const handlers = {};
    const doc = { addEventListener: (type, fn) => { handlers[type] = fn; } };
    const current = trackPointerControl(doc);
    const select = node({ tag: 'select' });
    handlers.pointerdown({ target: select });
    handlers.focusin({ target: select });
    assert.equal(current(), select, 'клик по списку забыт — после выбора монитора клавиши молчат');
});

test('кнопка, открывшая модалку мышью, после её закрытия снова отдаёт пробел таймеру', () => {
    // «Сбросить всё» мышью → Esc → Space: фокус вернулся на открыватель
    // (modal-manager возвращает фокус), а метка «кликнули мышью» стёрлась на
    // уходе фокуса В модалку — пробел снова открывал её вместо старта.
    const handlers = {};
    const doc = { addEventListener: (type, fn) => { handlers[type] = fn; } };
    const current = trackPointerControl(doc);
    const opener = node({ tag: 'button' });
    const insideModal = node({ tag: 'button', parent: node({ role: 'dialog' }) });
    handlers.pointerdown({ target: opener });
    handlers.focusin({ target: opener });
    handlers.focusin({ target: insideModal });
    handlers.focusin({ target: opener });
    assert.equal(current(), opener, 'метка мыши потерялась в модалке');

    const other = node({ tag: 'button' });
    handlers.focusin({ target: other });
    assert.equal(current(), null, 'Tab на другую кнопку обязан метку стереть');
});
