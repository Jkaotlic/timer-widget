'use strict';

/**
 * Проверка цвета должна быть ОДНА, и это `SecurityUtils.isSafeColor`.
 *
 * Цвета приходят из localStorage и по IPC, а попадают прямо в `style.color` и в
 * строку `linear-gradient(...)`. Поэтому проверка тут не косметика: она стоит
 * между чужим значением и CSS.
 *
 * Канонический валидатор в security.js разбирает `rgb()/rgba()` по компонентам
 * и проверяет диапазоны. Рядом жили три копии, написанные одной регуляркой
 * `^rgba?\([\d,.\s%]+\)$` — она принимает ЛЮБОЙ набор цифр, запятых и точек:
 * `rgb(999,999,999)`, `rgba(1,2,3,77)`, `rgb(,,,)` и даже `rgba(   )`. Замерено
 * ниже. Часы уже пользовались каноническим — расходились именно копии.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isSafeColor } = require('../security');
const { codeOnly } = require('./helpers/source-scan');

const repoRoot = path.join(__dirname, '..');
const read = (file) => codeOnly(fs.readFileSync(path.join(repoRoot, file), 'utf8'));

// Файлы, которые красят что-либо значением из хранилища или из IPC.
const PAINTING_FILES = ['electron-widget.html', 'electron-clock-widget.html', 'display-script.js'];

test('канонический валидатор отбраковывает то, что пропускала копия', () => {
    // Ровно те значения, на которых копии говорили «безопасно».
    for (const junk of ['rgb(999,999,999)', 'rgba(1,2,3,77)', 'rgb(,,,)', 'rgba(   )', 'rgb(1.5.5,2,3)']) {
        assert.equal(isSafeColor(junk), false, `${junk} не должен считаться цветом`);
    }

    // И не стал строже там, где не надо: этими формами пользуется само приложение.
    for (const good of ['#fff', '#0a84ff', '#0a84ff80', 'rgb(255, 255, 255)', 'rgba(15, 12, 41, 0.7)']) {
        assert.equal(isSafeColor(good), true, `${good} — законный цвет`);
    }
});

test('окна пользуются общим валидатором, а не своей регуляркой', () => {
    for (const file of PAINTING_FILES) {
        const src = read(file);
        assert.match(
            src,
            /SecurityUtils\.isSafeColor/,
            `${file}: проверка цвета должна идти через SecurityUtils.isSafeColor`
        );
    }
});

test('ослабленная копия не вернулась ни в один из файлов', () => {
    // Именно эта регулярка и была дырой. Проверяем её отсутствие по КОДУ:
    // пояснение выше само её цитирует, и на сыром тексте проверка сработала бы
    // на собственном комментарии (CLAUDE.md, Gotchas).
    const weakForm = /\^rgba\?\\\(\[\\d,\.\\s%\]\+\\\)\$/;
    for (const file of [...PAINTING_FILES, 'electron-control.html']) {
        assert.doesNotMatch(read(file), weakForm, `${file}: вернулась проверка цвета «любые цифры в скобках»`);
    }
});
