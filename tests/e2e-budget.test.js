'use strict';

/**
 * Бюджет времени e2e-теста: величина одна, владелец один.
 *
 * История. Релиз 2.8.0 (09.09.2026) собрался с третьей попытки: три прогона CI
 * подряд падали на macOS-раннере, и первый — потому что тест жил на умолчании
 * Playwright в 30 с, а поднимает он настоящий Electron. Лечили тогда поштучно,
 * и к 09.09.2026 61 тест из 241 обзавёлся собственным `test.setTimeout`, 38 из
 * них — ровно на 120000. Число проект выбрал сам, но держал в 38 копиях.
 *
 * Теперь умолчание стоит в playwright.config.js, а здесь проверяется, что его
 * не обходят снизу: `test.setTimeout` законен только чтобы ПОДНЯТЬ бюджет
 * отдельному тяжёлому тесту. Опущенный ниже умолчания он делает тест строже
 * остальных молча — то есть возвращает ровно ту болезнь, от которой лечились.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const configSrc = fs.readFileSync(path.join(repoRoot, 'playwright.config.js'), 'utf8');

/** Умолчание из конфига — читаем ЕГО, а не копию числа в этом тесте. */
function globalTimeout(src) {
    const m = src.match(/^\s*timeout:\s*(\d+),/m);
    return m ? Number(m[1]) : null;
}

const SPEC_DIR = path.join(repoRoot, 'e2e');
const specs = fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.js'));

test('у бюджета e2e-теста один владелец — playwright.config.js', () => {
    const budget = globalTimeout(configSrc);
    assert.ok(budget, 'в playwright.config.js не нашлось поля timeout');
    assert.ok(
        budget >= 120000,
        `умолчание бюджета опустили до ${budget} мс: на 30 с самый долгий тест набора `
        + '(18.7 с локально) идёт с запасом меньше двух раз, а раннер CI медленнее'
    );

    const offenders = [];
    for (const file of specs) {
        const src = fs.readFileSync(path.join(SPEC_DIR, file), 'utf8');
        for (const m of src.matchAll(/test\.setTimeout\((\d+)\)/g)) {
            const value = Number(m[1]);
            if (value <= budget) {
                const line = src.slice(0, m.index).split('\n').length;
                offenders.push(`${file}:${line} → ${value} мс`);
            }
        }
    }

    assert.deepEqual(
        offenders, [],
        'test.setTimeout поднимает бюджет отдельному тесту, а не опускает его ниже '
        + `умолчания (${budget} мс). Лишние копии умолчания тоже сюда: они врут о том, `
        + `что у теста особый бюджет:\n  ${offenders.join('\n  ')}`
    );
});

test('зонд бюджета проверяет сам себя', () => {
    // Тест, утверждающий ОТСУТСТВИЕ, обязан уметь отличать «чисто» от
    // «регулярка не работает»: правило проекта, и оно уже спасало не раз.
    const budget = globalTimeout(configSrc);
    const fake = `test('x', async () => {\n    test.setTimeout(${budget - 1000});\n});`;
    const found = [...fake.matchAll(/test\.setTimeout\((\d+)\)/g)].map((m) => Number(m[1]));
    assert.deepEqual(found, [budget - 1000], 'зонд не видит заведомо заниженный бюджет');

    // И умеет читать конфиг: подменённое число обязано доехать.
    assert.equal(globalTimeout('module.exports = {\n    timeout: 4242,\n};'), 4242);
});
