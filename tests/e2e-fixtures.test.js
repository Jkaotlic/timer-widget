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

/**
 * Прямой запуск Electron без track(): список проблем спеки.
 *
 * Считается ЧИСЛО: запусков не больше, чем вызовов track(). Прежняя проверка
 * «есть хоть один track(» пропускала второй запуск в файле, где первый
 * обёрнут (relay-persist запускает дважды).
 */
function launchProblems(src) {
    const code = codeOnly(src);
    const launches = (code.match(/(?:_electron|\belectron)\s*\.\s*launch\s*\(/g) || []).length;
    const tracks = (code.match(/\btrack\s*\(/g) || []).length;
    if (launches > tracks) {
        return [`запускает Electron напрямую ${launches} раз(а), а track() — ${tracks}: не каждое приложение обёрнуто`];
    }
    return [];
}

test('спека, запускающая Electron напрямую, оборачивает приложение в track()', () => {
    const offenders = [];
    for (const file of specs) {
        const found = launchProblems(fs.readFileSync(path.join(SPEC_DIR, file), 'utf8'));
        if (found.length) { offenders.push(`${file}: ${found.join('; ')}`); }
    }
    assert.deepEqual(offenders, [], `спеки без track():\n  ${offenders.join('\n  ')}`);
});

test('зонд прямого запуска проверяет сам себя', () => {
    assert.equal(launchProblems('const app = await electron.launch({ args: [] });').length, 1,
        'зонд не видит electron.launch без track');
    assert.equal(launchProblems('const app = await _electron.launch({});').length, 1);
    assert.deepEqual(launchProblems('const app = track(await electron.launch({}));'), []);
    assert.deepEqual(launchProblems('const app = await launchApp();'), []);
    // track() в комментарии — не track().
    assert.equal(launchProblems('// track(app)\nawait electron.launch({});').length, 1);
    // Два запуска при одном track() — второй без следов.
    assert.equal(launchProblems('const a = track(await electron.launch({}));\nconst b = await electron.launch({});').length, 1,
        'второй запуск без track() не виден');
    assert.deepEqual(launchProblems('const a = track(await electron.launch({}));\nconst b = track(await electron.launch({}));'), []);
});

test('живые приложения при сбое: своё — live, запущенное раньше — live-earlier, умершее — пропуск', () => {
    const { livePlan } = require(path.join(SPEC_DIR, 'failure-artifacts.js'));
    const app = (exitCode = null, signalCode = null) => ({ process: () => ({ exitCode, signalCode }) });
    const mine = app();
    const shared = app();
    const killed = app(null, 'SIGKILL');
    const plan = livePlan(new Map([[shared, 1], [mine, 2], [killed, 2]]), 2);
    assert.deepEqual(plan.map((p) => [p.app === mine ? 'mine' : 'shared', p.phase]),
        [['mine', 'live'], ['shared', 'live-earlier']]);
    const two = livePlan(new Map([[app(), 3], [app(), 3]]), 3).map((p) => p.phase);
    assert.deepEqual(two, ['live1', 'live2']);
});

// Ревью B4, M1: помощники снимка (e2e/window-ready.js, waitForMainSnapshot)
// ЖДУТ снимок, но не доказывают его — и сами шлют окну метку на канале флага
// соседа. Спека, утверждающая снимок при загрузке, на них дала бы зелёный при
// снимке, потерявшем поле. Список спек — те, что снимок утверждают.
const SNAPSHOT_SPECS = ['window-state-sync.spec.js', 'relay-persist.spec.js'];
const SNAPSHOT_HELPER = /\b(?:wait(?:ForMain|ForDisplay|ForWidget|ForClock)Snapshot|relayBarrier)\b/;

function usesSnapshotHelper(src) { return SNAPSHOT_HELPER.test(codeOnly(src)); }

test('спеки снимка при загрузке не ждут его помощником, который его подменяет', () => {
    for (const file of SNAPSHOT_SPECS) {
        assert.ok(fs.existsSync(path.join(SPEC_DIR, file)), `${file} не найдена — обновите SNAPSHOT_SPECS`);
        assert.equal(usesSnapshotHelper(fs.readFileSync(path.join(SPEC_DIR, file), 'utf8')), false,
            `${file} зовёт waitFor*Snapshot: помощник шлёт окну свою метку и снимок не доказывает`);
    }
});

test('зонд помощника снимка проверяет сам себя', () => {
    assert.equal(usesSnapshotHelper('await waitForWidgetSnapshot(app, w);'), true);
    assert.equal(usesSnapshotHelper('const { waitForMainSnapshot } = require("./window-ready");'), true);
    assert.equal(usesSnapshotHelper('await waitForDisplaySnapshot(app, d, control);'), true);
    assert.equal(usesSnapshotHelper('// waitForClockSnapshot тут не нужен'), false);
    assert.equal(usesSnapshotHelper('await waitForWidget(app);'), false);
    // relayBarrier шлёт ту же метку (e2e-B7b).
    assert.equal(usesSnapshotHelper('await relayBarrier(app, control, [widget]);'), true);
});
