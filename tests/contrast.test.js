'use strict';

/**
 * Контраст текстовых токенов темы по WCAG 2.1.
 *
 * Зачем тест: палитру правят «на глаз», и полупрозрачный белый по тёмному стеклу
 * выглядит убедительно задолго до того, как становится читаемым. `--tw-fg-dim`
 * при alpha 0.42 давал 4.05:1 там, где для текста 11–12px нужно 4.5:1 — и красил
 * подписи в 13 местах панели управления. Заметить это чтением невозможно, только
 * счётом.
 *
 * КЛЮЧЕВОЙ МОМЕНТ РАСЧЁТА: полупрозрачный текст сначала смешивается с фоном
 * (alpha compositing) и только потом сравнивается с ним же. Если считать по
 * «чистому» цвету без смешивания, результат завышается в свою пользу и тест
 * становится бесполезным.
 *
 * Проверяется ТОЛЬКО тёмная тема: `[data-theme="light"]` и `[data-theme="hc-dark"]`
 * в приложении недостижимы — атрибут `data-theme` не выставляет никто, а
 * `prefers-color-scheme` в проекте не используется вовсе.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOKENS = fs.readFileSync(path.join(__dirname, '..', 'design-tokens.css'), 'utf8');

// --- WCAG 2.1 relative luminance + contrast ratio ---
function channelToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
    return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}
function contrast(fgRgb, bgRgb) {
    const a = luminance(fgRgb);
    const b = luminance(bgRgb);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function parseColor(value) {
    const v = String(value).trim();
    let m = /^#([0-9a-fA-F]{6})$/.exec(v);
    if (m) {
        const n = parseInt(m[1], 16);
        return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
    }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v);
    if (m) {
        return { rgb: [+m[1], +m[2], +m[3]], alpha: m[4] === undefined ? 1 : parseFloat(m[4]) };
    }
    throw new Error(`не разобран цвет: ${value}`);
}
// Накладывает (возможно полупрозрачный) слой на непрозрачную основу.
function composite(layer, baseRgb) {
    const { rgb, alpha } = parseColor(layer);
    return rgb.map((c, i) => Math.round(c * alpha + baseRgb[i] * (1 - alpha)));
}

// Достаёт значение токена из блока тёмной темы (`:root, [data-theme="dark"]`).
function darkToken(name) {
    const block = TOKENS.slice(0, TOKENS.indexOf('[data-theme="light"]'));
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
    assert.ok(m, `токен --${name} не найден в блоке тёмной темы`);
    return m[1].trim();
}

// Непрозрачные фоны, на которых реально лежит текст панели.
const BASE = parseColor(darkToken('tw-bg-dark')).rgb;
const SURFACE = composite(darkToken('tw-bg-surface'), BASE);
const GLASS = composite(darkToken('tw-bg-glass'), BASE);

// Порог 4.5:1 — обычный текст WCAG AA. Крупный (≥24px или ≥19px bold) допускает
// 3:1, но перечисленные ниже токены красят подписи 11–14px, поэтому порог полный.
const AA_NORMAL = 4.5;

const TEXT_TOKENS = [
    'tw-fg',
    'tw-fg-secondary',
    'tw-fg-muted',
    'tw-fg-dim'
];

test('текстовые токены тёмной темы проходят WCAG AA на обоих фонах', () => {
    const report = [];
    for (const token of TEXT_TOKENS) {
        const value = darkToken(token);
        for (const [bgName, bg] of [['surface', SURFACE], ['glass', GLASS]]) {
            const ratio = contrast(composite(value, bg), bg);
            report.push(`--${token} на ${bgName}: ${ratio.toFixed(2)}:1`);
            assert.ok(
                ratio >= AA_NORMAL,
                `--${token} (${value}) на --tw-bg-${bgName}: ${ratio.toFixed(2)}:1, `
                + `нужно ${AA_NORMAL}:1. Подписи этим токеном идут 11–12px — порог полный.`
            );
        }
    }
    console.log('   ' + report.join('\n   '));
});

test('семантические цвета статусов читаемы на стекле', () => {
    // Зелёный/красный/оранжевый/жёлтый — подписи статуса и цифры таймера.
    for (const token of ['tw-green', 'tw-red', 'tw-orange', 'tw-yellow', 'tw-blue']) {
        const value = darkToken(token);
        const ratio = contrast(composite(value, GLASS), GLASS);
        assert.ok(
            ratio >= AA_NORMAL,
            `--${token} (${value}) на стекле: ${ratio.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
        );
    }
});

test('красный перерасхода читаем как крупный текст', () => {
    // #ff4444 — цифры таймера в перерасходе, они крупные (порог 3:1),
    // но проверить всё равно надо: этот цвет задан в коде, а не токеном.
    const ratio = contrast(composite('#ff4444', GLASS), GLASS);
    assert.ok(ratio >= 3.0, `#ff4444 на стекле: ${ratio.toFixed(2)}:1, нужно 3:1`);
});

test('faint используется только для заливок, но не для текста', () => {
    // --tw-fg-faint (10% белого) для текста непригоден в принципе. Тест
    // фиксирует, что им не начали красить color: иначе подпись станет невидимой.
    const control = fs.readFileSync(path.join(__dirname, '..', 'control.css'), 'utf8');
    const asColor = [...control.matchAll(/(^|[\s;{])color:\s*var\(--tw-fg-faint\)/gm)];
    assert.equal(
        asColor.length, 0,
        '--tw-fg-faint попал в color: 10% белого нечитаемы ни на каком фоне'
    );
});

test('расчёт контраста сверен с эталонными парами WCAG', () => {
    // Защита от ошибки в самой математике: без этих опор тест мог бы уверенно
    // «проверять» палитру неверной формулой.
    assert.equal(contrast([255, 255, 255], [0, 0, 0]).toFixed(0), '21');
    assert.equal(contrast([0, 0, 0], [0, 0, 0]).toFixed(0), '1');
    // #767676 на белом — канонический порог 4.5:1 из спецификации WCAG.
    const ratio = contrast([0x76, 0x76, 0x76], [255, 255, 255]);
    assert.ok(ratio > 4.45 && ratio < 4.6, `#767676 на белом должен давать ≈4.5:1, вышло ${ratio.toFixed(2)}`);
});
