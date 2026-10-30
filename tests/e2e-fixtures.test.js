'use strict';

/**
 * Каждая e2e-спека берёт `test` из e2e/fixtures.js.
 *
 * Там авто-фикстура, которая после упавшего теста кладёт в test-results/
 * снимки и состояние окон (e2e/failure-artifacts.js). Спека, взявшая `test`
 * прямо из '@playwright/test', работает так же — пока не упадёт: тогда следов
 * у неё нет, и узнают об этом ровно тогда, когда они нужны.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./helpers/source-scan');

const SPEC_DIR = path.join(__dirname, '..', 'e2e');
const specs = fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.js'));

/** Откуда спека берёт `test`: список проблем, пустой — всё верно. */
function problems(src) {
    const code = codeOnly(src);
    const out = [];
    if (/require\(\s*['"]@playwright\/test['"]\s*\)/.test(code)) {
        out.push("require('@playwright/test') — `test` без следов упавшего теста");
    }
    if (/from\s+['"]@playwright\/test['"]/.test(code)) {
        out.push("import из '@playwright/test' — `test` без следов упавшего теста");
    }
    if (!/\btest\b[^;]*=\s*require\(\s*['"]\.\/fixtures(?:\.js)?['"]\s*\)/.test(code)) {
        out.push("нет `const { test … } = require('./fixtures')`");
    }
    return out;
}

test('каждая e2e-спека берёт test из ./fixtures, а не из @playwright/test', () => {
    assert.ok(specs.length > 0, 'в e2e/ не нашлось ни одной спеки');
    const offenders = [];
    for (const file of specs) {
        const found = problems(fs.readFileSync(path.join(SPEC_DIR, file), 'utf8'));
        if (found.length) { offenders.push(`${file}: ${found.join('; ')}`); }
    }
    assert.deepEqual(offenders, [], `спеки без следов упавшего теста:\n  ${offenders.join('\n  ')}`);
});

test('зонд импорта проверяет сам себя', () => {
    assert.deepEqual(problems("const { test, expect } = require('./fixtures');"), []);
    assert.equal(problems("const { test, expect } = require('@playwright/test');").length, 2,
        'зонд не видит прямой импорт @playwright/test');
    assert.equal(problems("import { test } from '@playwright/test';").length, 2);
    // Закомментированная правильная строка — не правильная строка.
    assert.equal(problems("// const { test } = require('./fixtures');").length, 1);
});

test('фикстура следов автоматическая и экспортирует test и expect', () => {
    const src = codeOnly(fs.readFileSync(path.join(SPEC_DIR, 'fixtures.js'), 'utf8'));
    assert.match(src, /_failureArtifacts\s*:\s*\[/, 'нет фикстуры _failureArtifacts');
    assert.match(src, /auto\s*:\s*true/, 'фикстура следов не автоматическая — без auto она не исполняется');
    assert.match(src, /testInfo\.status\s*!==\s*testInfo\.expectedStatus/, 'следы снимаются не по факту сбоя');
    const mod = require(path.join(SPEC_DIR, 'fixtures.js'));
    assert.equal(typeof mod.test, 'function');
    assert.equal(typeof mod.expect, 'function');
});

test('launchApp регистрирует приложение для снимка ПОСЛЕ сторожа профиля', () => {
    const src = codeOnly(fs.readFileSync(path.join(SPEC_DIR, 'launch.js'), 'utf8'));
    const watch = src.indexOf('profileGuard.watch(');
    const track = src.indexOf('track(app)');
    assert.ok(watch > 0 && track > 0, 'launchApp не зовёт profileGuard.watch и track(app)');
    // Обёртка, поставленная последней, выполняется первой: снимок обязан
    // увидеть окна раньше, чем сторож закроет дисплей и вернёт профиль.
    assert.ok(track > watch, 'track(app) стоит раньше profileGuard.watch — снимок увидит окна после сторожа');
});
