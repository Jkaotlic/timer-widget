'use strict';

/**
 * Сборка исходника окна для source-level тестов (tests/helpers/window-source.js)
 * и порядок таблиц виджета и часов.
 *
 * Помощник — точка, через которую сотни проверок видят код окна после выноса
 * инлайна в файлы (CSP `script-src 'self'; style-src 'self'`, 25.09.2026).
 * Если он потеряет файл страницы, проверки НАЛИЧИЯ упадут, а проверки
 * ОТСУТСТВИЯ молча позеленеют — поэтому его список сверяется с разметкой.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { WINDOW_OWN, readSource, readRaw } = require('./helpers/window-source');

const ROOT = path.join(__dirname, '..');

const refs = (html) => [
    ...[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1])
];

// Файлы страниц по имени — то, что до 25.09.2026 было инлайном окна.
const PAGE_FILE = /^(theme-init(-tone)?\.js|[a-z-]+-app\.js|[a-z-]+-theme-sync\.js|widget\.css|clock-widget\.css)$/;

test('каждый собственный файл окна существует и подключён ровно один раз', () => {
    for (const [file, own] of Object.entries(WINDOW_OWN)) {
        const html = readRaw(file);
        for (const f of own) {
            assert.ok(fs.existsSync(path.join(ROOT, f)), `${file}: нет файла ${f}`);
            assert.equal(refs(html).filter((r) => r === f).length, 1, `${file}: ${f} подключён не один раз`);
        }
    }
});

test('каждый файл страницы, подключённый окном, помощнику известен', () => {
    // Обратное направление: новый widget-что-то-app.js, не внесённый в список,
    // тесты перестали бы видеть — и проверки отсутствия в нём ослепли бы.
    for (const [file, own] of Object.entries(WINDOW_OWN)) {
        for (const r of refs(readRaw(file)).filter((x) => PAGE_FILE.test(x))) {
            assert.ok(own.includes(r), `${file} подключает ${r}, а tests/helpers/window-source.js о нём не знает`);
        }
    }
    // И регулярка файлов страницы не пустая: без этого «всё известно» было бы
    // верно при любом списке.
    assert.ok(PAGE_FILE.test('widget-app.js') && PAGE_FILE.test('widget.css') && !PAGE_FILE.test('widget-geometry.js'));
});

test('развёрнутый исходник несёт код файлов на их местах', () => {
    for (const [file, own] of Object.entries(WINDOW_OWN)) {
        const src = readSource(file);
        let prev = -1;
        for (const f of own) {
            assert.ok(!refs(src).includes(f), `${file}: ${f} не развёрнут`);
            const body = readRaw(f);
            const at = src.indexOf(body);
            assert.ok(at !== -1, `${file}: содержимого ${f} нет в исходнике окна`);
            assert.ok(at > prev, `${file}: ${f} стоит не на своём месте — порядок подключения важен`);
            prev = at;
        }
    }
    // Не-окно читается как есть.
    assert.equal(readSource('utils.js'), readRaw('utils.js'));
});

test('таблицы виджета и часов: fonts.css первой, своя таблица окна — последней', () => {
    // Требования те же, что у панели и дисплея (control-decomposition.test.js):
    //   1. fonts.css первым — @font-face до правил, которые им рисуют;
    //   2. таблица окна последней — на месте бывшего inline-<style>, который
    //      стоял после всех <link> и выигрывал у них при равной специфичности.
    for (const [file, own] of [['electron-widget.html', 'widget.css'], ['electron-clock-widget.html', 'clock-widget.css']]) {
        const order = [...readRaw(file).matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
        assert.deepEqual(
            order,
            ['fonts.css', 'design-tokens.css', 'flip-card.css', 'surface-tones.css', own],
            `${file}: порядок таблиц изменился — проверьте, что понимаете, зачем`
        );
    }
});
