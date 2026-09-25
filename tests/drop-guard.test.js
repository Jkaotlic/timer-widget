'use strict';

/**
 * SEC-06: сброшенный на окно файл не открывается вместо окна.
 *
 * Без обработчика Chromium на `drop` файла делает навигацию на его file://.
 * Главный процесс такую навигацию теперь отвергает (navigation-guard.js), но
 * окно не должно даже пытаться: второй замок — на стороне документа. У панели
 * он свой (custom-sounds.js: там есть зона сброса звука), здесь — для виджета,
 * часов и дисплея, у которых сбрасывать некуда вовсе.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DropGuard = require('../drop-guard');

function fakeDocument() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(type, fn) {
            if (!listeners.has(type)) { listeners.set(type, []); }
            listeners.get(type).push(fn);
        },
        dispatch(type, event) {
            for (const fn of listeners.get(type) || []) { fn(event); }
        }
    };
}

function fakeDragEvent() {
    const e = { prevented: false, dataTransfer: { dropEffect: 'copy' } };
    e.preventDefault = () => { e.prevented = true; };
    return e;
}

test('dragover и drop гасятся на уровне документа', () => {
    const doc = fakeDocument();
    DropGuard.blockFileDrops(doc);

    const over = fakeDragEvent();
    doc.dispatch('dragover', over);
    assert.equal(over.prevented, true, 'dragover не погашен');
    assert.equal(over.dataTransfer.dropEffect, 'none', 'курсор обязан показывать «сюда нельзя»');

    const drop = fakeDragEvent();
    doc.dispatch('drop', drop);
    assert.equal(drop.prevented, true, 'drop не погашен — файл откроется вместо окна');
});

test('событие без dataTransfer не роняет обработчик', () => {
    const doc = fakeDocument();
    DropGuard.blockFileDrops(doc);
    const e = { prevented: false, preventDefault() { this.prevented = true; } };
    doc.dispatch('dragover', e);
    assert.equal(e.prevented, true);
});

test('модуль подключён в виджете, часах и дисплее — и не в панели', () => {
    // Панель держит свою зону сброса звука (custom-sounds.js); общий гаситель
    // уровня документа у неё уже есть и знает про зону. Второй, не знающий,
    // здесь только мешал бы.
    const root = path.join(__dirname, '..');
    for (const file of ['electron-widget.html', 'electron-clock-widget.html', 'display.html']) {
        const html = fs.readFileSync(path.join(root, file), 'utf8');
        assert.match(html, /<script src="drop-guard\.js"><\/script>/, `${file}: drop-guard.js не подключён`);
    }
    const control = fs.readFileSync(path.join(root, 'electron-control.html'), 'utf8');
    assert.doesNotMatch(control, /drop-guard\.js/);
});
