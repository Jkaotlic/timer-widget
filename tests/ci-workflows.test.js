'use strict';

/**
 * Что обязаны делать workflow CI — проверки, которых нет в самом приложении.
 *
 * Зачем тест на YAML. Шаг CI, который «проверяет» пакет, исчезает бесследно:
 * удалённый шаг не краснеет, он просто перестаёт что-либо утверждать. ПСИ
 * 28.09.2026 ловила ровно то, чего в CI не было (lintian, запуск с
 * `--no-sandbox`, purge, обновление с опубликованной версии), поэтому здесь
 * закреплено, что эти шаги есть и стоят в нужных job.
 *
 * Разбор — срезами текста по отступам, без парсера YAML: зависимость ради
 * двух файлов не нужна, а структура workflow (job — два пробела, шаг — «- »)
 * в проекте стабильна. Срез проверяется сам на себе в первом тесте.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(WORKFLOWS, f), 'utf8');

/** Строки YAML без комментариев: пояснение «здесь нет lintian» не должно
 *  засчитываться как шаг. Комментарий — `#` в начале или после пробела. */
function yamlCode(src) {
    return src.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
}

/** Тело job `name` (до следующего job того же отступа). */
function jobBlock(src, name) {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => l === `  ${name}:`);
    if (start === -1) { return null; }
    let end = start + 1;
    while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end])) { end++; }
    return lines.slice(start, end).join('\n');
}

/** Шаг по началу имени: от `- name: …` до следующего `- ` того же отступа. */
function stepBlock(job, namePrefix) {
    const lines = job.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^\\s*- name: ${namePrefix}`).test(l));
    if (start === -1) { return null; }
    const indent = lines[start].indexOf('-');
    let end = start + 1;
    while (end < lines.length && !(lines[end].indexOf('- ') === indent && /^\s*- /.test(lines[end]))) { end++; }
    return lines.slice(start, end).join('\n');
}

const NODEJS = read('nodejs.yml');

test('срезы job и шага режут по структуре (проверка себя)', () => {
    const sample = 'jobs:\n  a:\n    steps:\n      - name: One\n        run: x\n      - name: Two\n        run: y\n  b:\n    steps: []\n';
    assert.equal(jobBlock(sample, 'b'), '  b:\n    steps: []\n');
    assert.match(jobBlock(sample, 'a'), /Two/);
    assert.doesNotMatch(jobBlock(sample, 'a'), /steps: \[\]/);
    assert.equal(stepBlock(jobBlock(sample, 'a'), 'One'), '      - name: One\n        run: x');
    assert.equal(yamlCode('run: a # lintian\n# lintian'), 'run: a\n');
    assert.ok(jobBlock(NODEJS, 'linux-sandbox'), 'в nodejs.yml нет job linux-sandbox — срез сломан или job переименован');
});

test('lintian гоняется по собранному deb и валит сборку на error', () => {
    const job = yamlCode(jobBlock(NODEJS, 'linux-sandbox'));
    assert.match(job, /apt-get install[^\n]*\blintian\b/, 'lintian не ставится в job linux-sandbox');
    assert.match(job, /lintian --fail-on error\b[^\n]*--info\b[^\n]*"\$DEB"/,
        'lintian запускается без --fail-on error / --info или не по собранному deb');
    const build = job.indexOf('electron-builder --linux deb');
    const lint = job.indexOf('lintian --fail-on');
    const upload = job.indexOf('upload-artifact');
    assert.ok(build > -1 && build < lint && lint < upload,
        'lintian обязан идти после сборки и до выкладки deb — битый пакет не должен уезжать на установку');
    assert.doesNotMatch(stepBlock(job, 'lintian') || '', /continue-on-error:\s*true/, 'шаг lintian неблокирующий');
});
