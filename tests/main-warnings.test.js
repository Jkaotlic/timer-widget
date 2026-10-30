'use strict';

/**
 * Фильтр предупреждений главного процесса гасит РОВНО MODULE_TYPELESS_PACKAGE_JSON.
 * Фильтр, проглотивший всё, тоже «убрал бы шум» — поэтому проверяется и то,
 * что чужой код проходит, во всех формах вызова emitWarning.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { installWarningFilter, SILENCED_CODE } = require('../main-warnings');

const ROOT = path.join(__dirname, '..');

function fakeProcess() {
    const seen = [];
    const proc = { emitWarning(warning, ...rest) { seen.push([warning, ...rest]); } };
    return { proc, seen };
}

test('гасит MODULE_TYPELESS_PACKAGE_JSON в любой форме вызова', () => {
    const { proc, seen } = fakeProcess();
    installWarningFilter(/** @type {any} */ (proc));
    proc.emitWarning('typeless', { code: SILENCED_CODE });
    proc.emitWarning('typeless', 'Warning', SILENCED_CODE);
    proc.emitWarning(Object.assign(new Error('typeless'), { code: SILENCED_CODE }));
    assert.deepEqual(seen, []);
});

test('пропускает любой другой код и предупреждение без кода', () => {
    const { proc, seen } = fakeProcess();
    installWarningFilter(/** @type {any} */ (proc));
    proc.emitWarning('other', { code: 'MY_CUSTOM_CODE' });
    proc.emitWarning('other', 'DeprecationWarning', 'DEP0001');
    proc.emitWarning('plain');
    assert.equal(seen.length, 3);
    assert.deepEqual(seen.map((c) => c[0]), ['other', 'other', 'plain']);
});

test('повторная установка не оборачивает дважды', () => {
    const { proc } = fakeProcess();
    installWarningFilter(/** @type {any} */ (proc));
    const once = proc.emitWarning;
    installWarningFilter(/** @type {any} */ (proc));
    assert.equal(proc.emitWarning, once);
});

test('настоящий Node: require графа модулей молчит, чужое предупреждение печатается', () => {
    const code = [
        "require('./main-warnings').installWarningFilter();",
        "require('./utils.js');",
        "process.emitWarning('probe', { code: 'MY_CUSTOM_CODE' });",
    ].join('\n');
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const r = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /MODULE_TYPELESS_PACKAGE_JSON/);
    assert.match(r.stderr, /MY_CUSTOM_CODE/);
    // Самопроверка: без фильтра тот же require предупреждение ПЕЧАТАЕТ, иначе
    // зелёный выше ничего бы не доказывал.
    const bare = spawnSync(process.execPath, ['-e', "require('./utils.js');"], { cwd: ROOT, encoding: 'utf8', env });
    assert.match(bare.stderr, /MODULE_TYPELESS_PACKAGE_JSON/);
});
