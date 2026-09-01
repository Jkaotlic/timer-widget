'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CONFIG = require('../constants.js');
const WindowGeometry = require('../window-geometry.js');
const DisplayLayouts = require('../display-layouts.js');
const SCHEMA = require('../settings-schema.js');
const { codeOnly } = require('./helpers/source-scan.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/**
 * Диапазон масштаба обязан быть ДОСТИЖИМ целиком.
 *
 * Замер 01.09.2026 зондом: ползунок панели на 30 %, окно виджета 120 px при
 * базе 250 — то есть 48 %, окно часов 120 px при базе 220 — 55 %. Пять первых
 * делений ползунка часов (30…50 %) давали ОДИН И ТОТ ЖЕ размер. Панель при
 * этом честно показывала «30 %»: расходились не подписи, а само обещание.
 *
 * Причина — пол окна был литералом, не связанным ни с базовым размером, ни с
 * MIN_SCALE_PCT. Поэтому проверяется РАВЕНСТВО, а не «пол не больше»: пол ниже
 * нужного означал бы, что колесо упирается раньше окна, и жест снова врёт.
 */
test('пол окна виджета — это его размер при MIN_SCALE_PCT', () => {
    const expected = Math.round(CONFIG.WIDGET_DEFAULT_WIDTH * WindowGeometry.MIN_SCALE_PCT / 100);
    assert.strictEqual(CONFIG.WIDGET_MIN_WIDTH, expected,
        `виджет: пол ${CONFIG.WIDGET_MIN_WIDTH} px, а ${WindowGeometry.MIN_SCALE_PCT} % от ${CONFIG.WIDGET_DEFAULT_WIDTH} — это ${expected} px`);
});

test('пол окна часов — это его размер при MIN_SCALE_PCT', () => {
    const expected = Math.round(CONFIG.CLOCK_WIDGET_DEFAULT_SIZE * WindowGeometry.MIN_SCALE_PCT / 100);
    assert.strictEqual(CONFIG.CLOCK_WIDGET_MIN_SIZE, expected,
        `часы: пол ${CONFIG.CLOCK_WIDGET_MIN_SIZE} px, а ${WindowGeometry.MIN_SCALE_PCT} % от ${CONFIG.CLOCK_WIDGET_DEFAULT_SIZE} — это ${expected} px`);
});

/**
 * Окно виджета квадратное при ЛЮБОМ масштабе.
 *
 * Высоту виджет выводит из ширины (windowHeightFor → width), а минимум
 * применяется по КАЖДОЙ оси независимо (fitScaledBounds/sideSize). Значит
 * разные минимумы по осям и означают «ниже такого-то процента окно перестаёт
 * быть квадратом»: замерено 120×140 при 30 %, 125×140 при 50 %, 138×140 при
 * 55 %. WIDGET_MIN_HEIGHT 140 — наследие полосы LED, которой больше нет.
 */
test('минимум виджета квадратный: иначе окно ниже порога вытягивается', () => {
    assert.strictEqual(CONFIG.WIDGET_MIN_HEIGHT, CONFIG.WIDGET_MIN_WIDTH,
        `минимум ${CONFIG.WIDGET_MIN_WIDTH}×${CONFIG.WIDGET_MIN_HEIGHT} — окно перестанет быть квадратом ниже ${Math.round(CONFIG.WIDGET_MIN_HEIGHT / CONFIG.WIDGET_DEFAULT_WIDTH * 100)} %`);
});

/** Базу масштаба рендерер и реестр обязаны понимать одинаково. */
test('WIDGET_BASE_SIZE и CLOCK_BASE_SIZE в окнах равны реестру', () => {
    const widget = read('electron-widget.html').match(/const WIDGET_BASE_SIZE = (\d+)/);
    const clock = read('electron-clock-widget.html').match(/const CLOCK_BASE_SIZE = (\d+)/);
    assert.ok(widget, 'в окне виджета не найден WIDGET_BASE_SIZE');
    assert.ok(clock, 'в окне часов не найден CLOCK_BASE_SIZE');
    assert.strictEqual(Number(widget[1]), CONFIG.WIDGET_DEFAULT_WIDTH);
    assert.strictEqual(Number(clock[1]), CONFIG.CLOCK_WIDGET_DEFAULT_SIZE);
});

/**
 * Умолчание масштаба блоков — ОДНО.
 *
 * Замер: на чистом профиле ползунок панели показывал 100 %, а блоки дисплея
 * стояли на 150 %. Первое же движение ползунка вниз роняло все блоки со 150 до
 * ~100 — видимый скачок из ниоткуда.
 */
test('умолчание «Масштаба блоков» в панели совпадает с умолчанием дисплея', () => {
    const row = SCHEMA.SETTINGS_DESCRIPTORS.find((r) => r.key === 'timeBlocksScale');
    assert.ok(row, 'в таблице настроек нет строки timeBlocksScale');
    assert.strictEqual(row.def, DisplayLayouts.DEFAULT_BLOCK_SCALE);
});

test('ползунок «Масштаба блоков» в разметке стоит на том же умолчании', () => {
    const html = read('electron-control.html');
    const m = html.match(/id="timeBlocksScale"[^>]*value="(\d+)"/);
    assert.ok(m, 'ползунок timeBlocksScale не найден');
    assert.strictEqual(Number(m[1]), DisplayLayouts.DEFAULT_BLOCK_SCALE);
});

/**
 * Пределы масштаба блоков живут в реестре, а не копией в окне.
 *
 * Тест утверждает ОТСУТСТВИЕ, поэтому проверяет сам себя: на подделанном
 * исходнике та же регулярка обязана сработать, иначе зелёный значит «регулярка
 * не работает», а не «копий нет».
 */
const BLOCK_LIMIT_COPY = /const\s+BLOCK_(?:MIN|MAX)_SCALE\s*=\s*\d+/g;

test('пределы масштаба блоков не продублированы литералами в display-script.js', () => {
    const code = codeOnly(read('display-script.js'));
    const found = code.match(BLOCK_LIMIT_COPY) || [];
    assert.deepStrictEqual(found, [],
        `литеральные пределы вместо DisplayLayouts.MIN/MAX_ELEMENT_SCALE: ${found.join(', ')}`);
});

test('зонд самопроверки: регулярка литеральных пределов ловит подделку', () => {
    const fake = 'const BLOCK_MIN_SCALE = 50;\nconst BLOCK_MAX_SCALE = 600;\n';
    assert.strictEqual((codeOnly(fake).match(BLOCK_LIMIT_COPY) || []).length, 2);
});

// ---------------------------------------------------------------------------
// Приём отчёта о масштабе (scale-report.js) — на поддельных документе и
// хранилище: до 01.09.2026 эта логика жила внутри inline-скрипта панели и
// проверялась только регуляркой по исходнику.
// ---------------------------------------------------------------------------
const ScaleReport = require('../scale-report.js');

function fakeDoc(sliders) {
    const nodes = {};
    for (const [id, attrs] of Object.entries(sliders)) {
        nodes[id] = Object.assign({ id, value: null, textContent: null }, attrs);
    }
    return { nodes, getElementById: (id) => nodes[id] || null };
}

function fakeStorage(initial) {
    const data = { ...initial };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); }
    };
}

const DEPS = (doc, storage) => ({
    doc, storage,
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    parseJSON: (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } }
});

test('отчёт виджета двигает ползунок и пишет ТОЛЬКО свои ключи', () => {
    const doc = fakeDoc({ timerScale: { min: '30', max: '600' }, timerScaleValue: {} });
    const storage = fakeStorage({
        displayExtSettings: JSON.stringify({ widgetTimerStyle: 'circle', timeBlocksScale: 150 })
    });
    const applied = ScaleReport.applyScaleReport(
        { source: 'widget', scalePct: 180 }, DEPS(doc, storage));

    assert.strictEqual(applied, 180);
    assert.strictEqual(doc.nodes.timerScale.value, 180);
    assert.strictEqual(doc.nodes.timerScaleValue.textContent, '180%');
    const profile = JSON.parse(storage.data.displayExtSettings);
    assert.strictEqual(profile.widgetTimerScale, 180);
    assert.strictEqual(profile.timerScale, 180, 'устаревший ключ пишется ради отката');
    // Соседние настройки НЕ трогаются: отчёт сообщил одну величину.
    assert.strictEqual(profile.widgetTimerStyle, 'circle');
    assert.strictEqual(profile.timeBlocksScale, 150);
});

test('отчёт часов подтягивает ползунок, но в профиль не пишет', () => {
    const doc = fakeDoc({ clockScale: { min: '30', max: '600' }, clockScaleValue: {} });
    const storage = fakeStorage({ displayExtSettings: JSON.stringify({ widgetTimerStyle: 'flip' }) });
    ScaleReport.applyScaleReport({ source: 'clock', scalePct: 240 }, DEPS(doc, storage));

    assert.strictEqual(doc.nodes.clockScale.value, 240);
    // Масштаб часов живёт в clockGeometry, и владелец у него — окно часов.
    assert.deepStrictEqual(JSON.parse(storage.data.displayExtSettings), { widgetTimerStyle: 'flip' });
});

test('отчёт поджимается ГРАНИЦАМИ ползунка, а не своими числами', () => {
    const doc = fakeDoc({ displayTimerScale: { min: '30', max: '300' }, displayTimerScaleValue: {} });
    const storage = fakeStorage({});
    const applied = ScaleReport.applyScaleReport(
        { source: 'display', scalePct: 600 }, DEPS(doc, storage));
    assert.strictEqual(applied, 300);
});

test('мусорный отчёт отвергается и ничего не пишет', () => {
    const doc = fakeDoc({ timerScale: { min: '30', max: '600' } });
    const storage = fakeStorage({});
    for (const bad of [null, {}, { source: 'widget' }, { source: 'нет такого', scalePct: 100 },
        { source: 'widget', scalePct: NaN }, { source: 'widget', scalePct: 'сто' }]) {
        assert.strictEqual(ScaleReport.applyScaleReport(bad, DEPS(doc, storage)), null,
            `принят мусор: ${JSON.stringify(bad)}`);
    }
    assert.deepStrictEqual(storage.data, {});
});

test('источники отчёта совпадают с теми, что пропускает главный процесс', () => {
    const main = read('electron-main.js');
    const allowed = main.match(/const SCALE_REPORT_SOURCES = new Set\(\[([^\]]+)\]\)/);
    assert.ok(allowed, 'в главном процессе не найден список источников');
    const fromMain = allowed[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, '')).sort();
    assert.deepStrictEqual(Object.keys(ScaleReport.SCALE_TARGETS).sort(), fromMain,
        'панель и главный процесс знают разные наборы источников');
});
