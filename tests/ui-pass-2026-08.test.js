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

/* ────────────────────────── панель: состояния и мишени ───────────────────── */

test('«пуск» во время работы недоступен, а не сломан', () => {
    // Общее .main-btn:disabled даёт opacity .4 + grayscale .6 — зелёный круг
    // превращался в мутно-оливковый и читался как поломка, а не как «пуск
    // сейчас недоступен».
    assert.match(CSS_CODE, /\.main-btn\.start:disabled \{[^}]*filter:\s*none/);
    assert.match(CSS_CODE, /\.main-btn\.start:disabled \{[^}]*opacity:\s*1/);
});

test('плашка статуса панели красится состоянием, но БЕЗ анимации', () => {
    // Панель несла состояние одной 8-пиксельной точкой, тогда как полноэкранное
    // окно заливает плашку целиком: одно состояние в двух окнах показано
    // принципиально по-разному.
    for (const state of ['running', 'paused', 'finished', 'overtime']) {
        assert.match(
            CSS_CODE,
            new RegExp(`\\.timer-status:has\\(\\.status-dot\\.${state}\\)`),
            `нет заливки для состояния ${state}`
        );
    }
    // Пульсация точки — ЕДИНСТВЕННОЕ, что отличает «идёт перерасход» от «уже
    // завершено» при одном красном цвете. Анимация на самой плашке это
    // различие уничтожит.
    const rules = CSS_CODE.match(/\.timer-status:has\([^)]+\)[^{]*\{[^}]*\}/g) || [];
    assert.ok(rules.length > 0, 'правила заливки не найдены');
    for (const rule of rules) {
        assert.ok(!/animation/.test(rule), `анимация на плашке статуса: ${rule.slice(0, 80)}`);
    }
});

test('минус и плюс равнозначны — ни красного, ни синего в ряду', () => {
    // Минусы были покрашены --tw-red, то есть цветом перерасхода: уменьшение
    // времени читалось как опасное действие. Красить минус нейтральным, а плюс
    // синим — та же ошибка с другой стороны: «добавить» становится действием по
    // умолчанию. Направление несёт знак ±.
    assert.ok(
        !/\.adjust-main-btn\.minus \{[^}]*var\(--tw-red\)/.test(CSS_CODE),
        'минус снова покрашен цветом перерасхода'
    );
    assert.match(
        CSS_CODE,
        /\.adjust-main-btn\.minus,\s*\.adjust-main-btn\.plus \{[^}]*var\(--tw-fg-secondary\)/
    );
});

test('разделитель ряда — волосяная линия, а не синяя каретка', () => {
    const rule = CSS_CODE.match(/\.adjust-divider \{[^}]*\}/)[0];
    assert.ok(!/var\(--tw-blue\)|linear-gradient/.test(rule), 'вернулась синяя черта');
    assert.match(rule, /width:\s*1px/);
    assert.match(rule, /var\(--tw-border-strong\)/);
});

test('кружок под значком окна имеет габарит', () => {
    // Компактный блок обнулял width/height, оставляя фон и border-radius: 50%:
    // вместо кружка рисовалось тесное пятно по размеру глифа, и заливка
    // активного состояния почти не читалась.
    assert.ok(
        !/\.quick-window-btn \.qw-icon \{[^}]*width:\s*auto/.test(CSS_CODE),
        'габарит подложки значка снова обнулён'
    );
    assert.match(CSS_CODE, /\.quick-window-btn \.qw-icon \{[^}]*width:\s*18px/);
});

test('закрытое окно в ряду ОКНА не выглядит открытым', () => {
    // И покой, и активность были залиты синим одного семейства, различие несла
    // в основном альфа. Состояние должны нести только .active и индикатор.
    const idx = CSS_CODE.indexOf('.quick-window-btn {');
    const rule = CSS_CODE.slice(idx, CSS_CODE.indexOf('}', idx));
    assert.ok(!/var\(--tw-blue\)/.test(rule), 'покой снова залит акцентом');
});

test('мишени панели используют собственный токен проекта', () => {
    // --tw-hit-min: 32px объявлен в design-tokens.css и не был использован ни разу.
    const uses = CSS_CODE.match(/var\(--tw-hit-min\)/g) || [];
    assert.ok(uses.length >= 5, `--tw-hit-min использован ${uses.length} раз, ожидалось ≥5`);
});

test('зона попадания кнопок окна расширена псевдоэлементом, а не габаритом', () => {
    // Вариант с width: 24px + padding + background-clip: content-box рисует
    // скруглённые КВАДРАТЫ: border-radius: 50% считается по border-боксу 24px,
    // а заливка обрезается по контент-боксу 12×12. Проверено на превью.
    assert.ok(
        !/\.custom-titlebar \.win-btn \{[^}]*background-clip:\s*content-box/.test(CSS_CODE),
        'вернулся background-clip, рисующий квадраты'
    );
    assert.match(CSS_CODE, /\.custom-titlebar \.win-btn::after \{[^}]*inset:\s*-6px/);
});

/* ─────────────────────────────── ящик настроек ───────────────────────────── */

test('значки групп — inline SVG, а не эмодзи', () => {
    // Эмодзи рисуются системным emoji-шрифтом: не наследуют currentColor, не
    // участвуют ни в одной теме и выглядят по-разному на macOS, Windows и
    // Linux. В светлой теме ✨ у «ЦВЕТА ЧАСОВ» — почти невидимый бледно-жёлтый
    // глиф на белой карточке.
    // Плюс у .icon не было aria-hidden (в отличие от .hint-icon рядом), поэтому
    // скринридер зачитывал НАЗВАНИЯ эмодзи прямо внутри заголовка группы.
    const icons = PANEL_CODE.match(/<span class="icon"[^>]*>[\s\S]*?<\/span>/g) || [];
    assert.ok(icons.length >= 9, `значков ${icons.length}, ожидалось ≥9`);
    for (const icon of icons) {
        assert.match(icon, /aria-hidden="true"/, `значок без aria-hidden: ${icon.slice(0, 50)}`);
        assert.match(icon, /<svg/, `значок остался эмодзи: ${icon.slice(0, 50)}`);
        assert.match(icon, /stroke="currentColor"/, `значок не наследует цвет: ${icon.slice(0, 50)}`);
    }
    assert.ok(
        !/[\u{1F300}-\u{1FAFF}]/u.test(icons.join('')),
        'в значках остались эмодзи'
    );
});

test('подсветка эмодзи снята — штриховому значку она не нужна', () => {
    assert.ok(
        !/\.settings-group-title \.icon \{[^}]*filter:\s*brightness/.test(CSS_CODE),
        'brightness(1.3) вернулся'
    );
    assert.match(CSS_CODE, /\.settings-group-title \.icon[^{]*\{[^}]*width:\s*13px/);
});
