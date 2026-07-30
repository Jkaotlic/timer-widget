'use strict';

/**
 * Реестр CONFIG.STORAGE_KEYS обязан совпадать с ключами, которыми код реально
 * пользуется — в ОБА конца.
 *
 * Почему это нужно отдельным тестом: рендереры обращаются к localStorage
 * строковыми литералами (обёрток нет, сборщика нет), поэтому реестр физически не
 * может «сломаться» — он молча устаревает. К моменту прохода 30.07.2026 в нём
 * лежало 16 фантомных ключей (widgetStyle, timerSound, widgetPosition, clockSize,
 * timerConfig и др. — ни одного обращения в коде) и не хватало 10 настоящих
 * (widgetGeometry, clockGeometry, displayBlockPositions, selectedDisplay …).
 * Такая документация хуже отсутствующей: она уверенно врёт.
 *
 * Заодно тест ловит две реальные поломки настроек:
 *   - ключ ПИШЕТСЯ, но никогда не читается → настройка уходит в никуда;
 *   - ключ ЧИТАЕТСЯ, но никогда не пишется → всегда возвращается default.
 * Оба случая в этом проекте уже случались: clockShowTicks писался и не читался,
 * timerState читался мёртвой браузерной веткой дисплея и не писался никем.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = require('../constants');

const ROOT = path.join(__dirname, '..');

// Файлы рантайма: только те, что реально грузятся в окнах и главном процессе.
function runtimeFiles() {
    return fs.readdirSync(ROOT)
        .filter((f) => /\.(js|html)$/.test(f))
        .filter((f) => f !== 'eslint.config.js' && f !== 'playwright.config.js' && f !== 'visual-diff.js');
}

const READ_PATTERNS = [
    /localStorage\.getItem\(\s*['"]([^'"]+)['"]/g,
    /safeGetJSON\(\s*\w+,\s*['"]([^'"]+)['"]/g
];
const WRITE_PATTERNS = [
    /localStorage\.(?:setItem|removeItem)\(\s*['"]([^'"]+)['"]/g,
    /safeSetJSON\(\s*\w+,\s*['"]([^'"]+)['"]/g,
    /_safeSetItem\(\s*['"]([^'"]+)['"]/g
];

// Часть обращений идёт не литералом, а через локальную константу:
// `const STORAGE_KEY = 'displayBlockPositions'; ... localStorage.getItem(STORAGE_KEY)`
// (так устроены restoreBlockPositions/setupBlockControls в display-script.js).
// Без разворачивания таких связок ключ выглядел бы «пишется, но не читается».
function constBindings(src) {
    const map = new Map();
    for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]\s*;/g)) {
        map.set(m[1], m[2]);
    }
    return map;
}

const READ_VIA_CONST = /localStorage\.getItem\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
const WRITE_VIA_CONST = /(?:localStorage\.(?:setItem|removeItem)|_safeSetItem)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;

function collect() {
    const reads = new Map();
    const writes = new Map();
    const note = (map, key, file) => {
        if (!map.has(key)) { map.set(key, new Set()); }
        map.get(key).add(file);
    };

    for (const file of runtimeFiles()) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const re of READ_PATTERNS) {
            for (const m of src.matchAll(re)) { note(reads, m[1], file); }
        }
        for (const re of WRITE_PATTERNS) {
            for (const m of src.matchAll(re)) { note(writes, m[1], file); }
        }

        const bindings = constBindings(src);
        for (const m of src.matchAll(READ_VIA_CONST)) {
            const key = bindings.get(m[1]);
            if (key) { note(reads, key, file); }
        }
        for (const m of src.matchAll(WRITE_VIA_CONST)) {
            const key = bindings.get(m[1]);
            if (key) { note(writes, key, file); }
        }
    }
    return { reads, writes };
}

const { reads, writes } = collect();
const used = new Set([...reads.keys(), ...writes.keys()]);
const registered = new Set(Object.values(CONFIG.STORAGE_KEYS));

test('в реестре нет ключей, которых нет в коде', () => {
    const phantom = [...registered].filter((k) => !used.has(k)).sort();
    assert.deepEqual(
        phantom, [],
        'эти ключи объявлены в CONFIG.STORAGE_KEYS, но код к ним не обращается — '
        + 'либо удали их из реестра, либо начни использовать'
    );
});

test('в коде нет ключей, которых нет в реестре', () => {
    const unregistered = [...used].filter((k) => !registered.has(k)).sort();
    assert.deepEqual(
        unregistered, [],
        'эти ключи используются в коде, но не заведены в CONFIG.STORAGE_KEYS — '
        + 'реестр перестаёт быть полным и начинает врать'
    );
});

test('нет ключей, которые пишутся и никогда не читаются', () => {
    // «Настройка в никуда»: пользователь что-то переключает, значение ложится в
    // хранилище, а прочитать его никто не пробует — при перезапуске всё сбрасывается.
    const writeOnly = [...writes.keys()]
        .filter((k) => !reads.has(k))
        .map((k) => `${k} (пишет: ${[...writes.get(k)].join(', ')})`)
        .sort();
    assert.deepEqual(writeOnly, []);
});

test('нет ключей, которые читаются и никогда не пишутся', () => {
    // Обратный случай: чтение всегда отдаёт default, а ветка вокруг него мертва.
    const readOnly = [...reads.keys()]
        .filter((k) => !writes.has(k))
        .map((k) => `${k} (читает: ${[...reads.get(k)].join(', ')})`)
        .sort();
    assert.deepEqual(readOnly, []);
});

test('реестр заморожен и содержит только строки', () => {
    assert.equal(Object.isFrozen(CONFIG.STORAGE_KEYS), true);
    for (const [name, value] of Object.entries(CONFIG.STORAGE_KEYS)) {
        assert.equal(typeof value, 'string', `${name}: значение должно быть строкой`);
        assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${name}: имя константы — UPPER_SNAKE_CASE`);
    }
});
