'use strict';

/**
 * Регрессии UI-прохода от 07.08.2026.
 *
 * Проверки идут по исходникам: правила живут в inline-<style> окон и в
 * control.css, импортировать их нечем. По соглашению проекта каждая проверка
 * утверждает И наличие правильного поведения, И отсутствие старого сломанного —
 * иначе регрессия проскочит молча.
 *
 * Проверки отсутствия работают по копии БЕЗ комментариев (codeOnly): в этом
 * репозитории четыре assertion'а уже срабатывали на собственных объясняющих
 * комментариях.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./helpers/source-scan');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CSS = read('control.css');
const CSS_CODE = codeOnly(CSS);
const PANEL = read('electron-control.html');
const PANEL_CODE = codeOnly(PANEL);

/* ───────────────────────── панель: иерархия и геометрия ───────────────────── */

test('заголовок героя и заголовок секции — разные типографические уровни', () => {
    // Совпадали по ВСЕМ пяти свойствам (font-size, font-weight, color,
    // letter-spacing, text-transform), а компактный блок в конце файла сводил
    // их ещё и к одному кеглю: пять одинаковых серых микрополосок и ни одного
    // уровня, за который цепляется глаз.
    assert.match(CSS_CODE, /\.timer-header h1 \{[^}]*font-size:\s*11px/);
    assert.match(CSS_CODE, /\.timer-header h1 \{[^}]*letter-spacing:\s*1\.6px/);
    assert.match(CSS_CODE, /\.group-title \{[^}]*font-size:\s*10px/);
    assert.match(CSS_CODE, /\.group-title \{[^}]*font-weight:\s*700/);
});

test('линия --tw-divider разделяет секции, но НЕ строки внутри секции', () => {
    // Один и тот же токен стоял и между секциями, и между строками внутри
    // «ТОЧНОЙ НАСТРОЙКИ», поэтому «Точное время» и «Считать ниже нуля»
    // читались как самостоятельные разделы.
    for (const sel of ['.manual-time-row', '.timer-mode-row']) {
        const idx = CSS_CODE.indexOf(`${sel} {`);
        assert.ok(idx > 0, `правило ${sel} не найдено`);
        const rule = CSS_CODE.slice(idx, CSS_CODE.indexOf('}', idx));
        assert.ok(
            !/border-top:\s*1px solid var\(--tw-divider\)/.test(rule),
            `${sel} снова разделён секционной линией`
        );
    }
});

test('левый край панели набран ОДНОЙ ручкой', () => {
    // Было 12 / 14 / 16px в шести правилах: заголовок «НАСТРОЙКИ» и полоса
    // вкладок стояли на 2px правее панели, футер — на 2px левее.
    assert.match(CSS_CODE, /--panel-inset:\s*14px/);
    const uses = CSS_CODE.match(/var\(--panel-inset\)/g) || [];
    assert.ok(uses.length >= 6, `--panel-inset использован ${uses.length} раз, ожидалось ≥6`);
});

test('подложка героя рисуется, а не декларируется', () => {
    // 2% белого поверх #1e1e22 давало +4.5/255 в верхней точке и уходило в ноль
    // — ниже порога 8/255, который visual-diff.js вообще считает изменением.
    // Правило было, эффекта не было.
    assert.ok(
        !/\.timer-header \{[^}]*rgba\(255,\s*255,\s*255,\s*0\.02\)\s*0%/.test(CSS_CODE),
        'вернулся нерисуемый градиент 2%'
    );
    assert.match(CSS_CODE, /\.timer-header \{[^}]*rgba\(255,\s*255,\s*255,\s*0\.07\)\s*0%/);
});

test('подзаголовки внутри карточки не заданы инлайновым style', () => {
    // Инлайн бьёт любую тему и переживает любую правку CSS. Три уровня
    // заголовков выглядели одинаково, а разница держалась на style=.
    assert.ok(
        !/class="settings-group-title"\s+style=/.test(PANEL_CODE),
        'инлайновый style на .settings-group-title вернулся'
    );
    assert.match(CSS_CODE, /\.settings-subtitle \{/);
});
