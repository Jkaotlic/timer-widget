'use strict';

/**
 * Верхний край экрана доступен виджету и часам.
 *
 * Три условия держат эту возможность, и e2e видит только два из них:
 *
 *  1. `enableLargerThanScreen` — опция КОНСТРУКТОРА, отключающая
 *     `-[NSWindow constrainFrameRect:toScreen:]`. Без неё окно поджимается к
 *     рабочей области (замерено: y = 30 при любом уровне окна, и через
 *     setPosition, и через setBounds).
 *  2. Уровень выше полоски меню. Полоска — уровень 24, `floating` (3) уходит под
 *     неё: на снимке экрана верхние 30 px окна закрыты меню, на `status` (25)
 *     окно видно целиком. Z-порядок из BrowserWindow.getBounds() не читается —
 *     e2e эту половину проверить не может, поэтому она стережётся здесь.
 *  3. Поджатие в главном процессе идёт по ГРАНИЦАМ экрана, а не по рабочей
 *     области: иначе восстановление позиции возвращало бы окно под меню.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { functionBody, codeOnly } = require('./helpers/source-scan');

const repoRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(repoRoot, 'electron-main.js'), 'utf8');

const CREATORS = [
    { fn: 'createWidgetWindow', name: 'виджет' },
    { fn: 'createClockWidgetWindow', name: 'часы' }
];

test('виджет и часы создаются с enableLargerThanScreen', () => {
    for (const { fn, name } of CREATORS) {
        const body = codeOnly(functionBody(source, fn));
        assert.match(
            body,
            /enableLargerThanScreen:\s*true/,
            `${name}: без enableLargerThanScreen macOS поджимает окно к рабочей области`
        );
    }
});

test('виджет и часы поднимаются на уровень выше полоски меню', () => {
    // Уровень задаётся ОДНОЙ константой на оба окна: разъехавшись, они получили
    // бы разное поведение у верхнего края, и заметить это можно только глазами.
    const levelMatch = source.match(/const\s+WINDOW_LEVEL_ABOVE_MENU_BAR\s*=\s*'([^']+)'/);
    assert.ok(levelMatch, 'ожидается константа WINDOW_LEVEL_ABOVE_MENU_BAR');
    assert.equal(
        levelMatch[1],
        'status',
        'status (25) — первый уровень выше полоски меню (24); floating (3) уходит под неё'
    );

    for (const { fn, name } of CREATORS) {
        const body = codeOnly(functionBody(source, fn));
        assert.match(
            body,
            /setAlwaysOnTop\(true,\s*WINDOW_LEVEL_ABOVE_MENU_BAR\)/,
            `${name}: окно у верхнего края обязано рисоваться поверх полоски меню`
        );
    }
});

test('поджатие геометрии идёт по границам экрана, а не по рабочей области', () => {
    for (const fn of ['resizeWindowClamped', 'positionWindowClamped']) {
        const body = codeOnly(functionBody(source, fn));
        assert.doesNotMatch(
            body,
            /\bworkArea\b/,
            `${fn}: поджатие по рабочей области возвращает окно под полоску меню`
        );
        // Форма доступа не важна (`host.bounds` или `{ bounds: … }`), важно, что
        // область берётся из границ дисплея.
        assert.match(
            body,
            /\bbounds\b/,
            `${fn}: областью укладки обязаны быть границы экрана`
        );
    }
});
