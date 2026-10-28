'use strict';

/**
 * PANEL-010 (аудит 27.10.2026): Esc не закрывал модалки «Завершить
 * мероприятие» и «Новое мероприятие» (их строит panel-display.js, а Esc панели
 * знал только три модалки поимённо), зато закрывал ящик настроек ПОД ними:
 * обработчик ящика висит на document, а фокус в модалке — на кнопке.
 * Правило проекта: Esc закрывает СЛОИ интерфейса, ближний первым, и окон не
 * гасит. Поэтому Esc обслуживает сам modal-manager — для любой модалки, — и
 * нажатие дальше ближнего слоя не уходит. Тот же дефект у справки F1: одно
 * нажатие закрывало и её, и ящик.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { codeOnly } = require('./helpers/source-scan');
const { readSource } = require('./helpers/window-source');

function fakeModal() {
    const listeners = {};
    const classes = new Set();
    return {
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
        querySelectorAll: () => [],
        fire(type, ev) { for (const fn of [...(listeners[type] || [])]) { fn(ev); } },
        listeners
    };
}

test('PANEL-010: Esc закрывает ЛЮБУЮ модалку, открытую через openModal, и дальше не уходит', () => {
    const prevDoc = global.document;
    global.document = { activeElement: null };
    try {
        const { openModal } = require('../modal-manager.js');
        const modal = fakeModal();
        openModal(modal);
        assert.ok(modal.classList.contains('show'));
        let stopped = false;
        let prevented = false;
        modal.fire('keydown', {
            key: 'Escape',
            stopPropagation: () => { stopped = true; },
            preventDefault: () => { prevented = true; }
        });
        assert.equal(modal.classList.contains('show'), false, 'Esc не закрыл модалку');
        assert.ok(stopped, 'Esc ушёл дальше модалки — закроет и ящик под ней');
        assert.ok(prevented);
        assert.equal((modal.listeners.keydown || []).length, 0, 'обработчики модалки не сняты при закрытии');
    } finally { global.document = prevDoc; }
});

test('PANEL-010: справка F1 ловит Esc на погружении и не отдаёт его ящику', () => {
    const src = codeOnly(readSource('shortcuts-help.js'));
    assert.match(src, /addEventListener\('keydown', _onOverlayKey, true\)/, 'Esc справки не на погружении');
    assert.match(src, /removeEventListener\('keydown', _onOverlayKey, true\)/, 'снятие не совпадает с установкой');
    assert.match(src, /e\.stopPropagation\(\)/, 'Esc справки уходит дальше — закроет ящик');
});
