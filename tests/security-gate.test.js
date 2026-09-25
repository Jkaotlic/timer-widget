'use strict';

/**
 * Ворота уязвимостей (scripts/security-gate.js) — проверка самих ворот.
 *
 * Ворота утверждают ОТСУТСТВИЕ находок, а зелёный такой проверки значит и
 * «чисто», и «разбор не работает». Поэтому здесь каждое правило проверяется
 * на отчёте, который ОБЯЗАН провалиться, и на реальных файлах репозитория.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('../scripts/security-gate');

const ROOT = path.join(__dirname, '..');

function report(groups, { withSbom = true, withElectron = true } = {}) {
    const pkgs = [{ package: { name: 'left-pad', version: '1.0.0', ecosystem: 'npm' }, groups }];
    if (withElectron) { pkgs.push({ package: { name: 'electron', version: '44.4.5', ecosystem: 'npm' } }); }
    const results = [{ source: { path: '/w/package-lock.json', type: 'lockfile' }, packages: pkgs }];
    if (withSbom) { results.push({ source: { path: '/w/sbom.cdx.json', type: 'sbom' }, packages: pkgs }); }
    return { results };
}

test('osv: high и critical блокируют, ниже порога — предупреждение', () => {
    const r = gate.classifyOsvReport(report([
        { ids: ['GHSA-aaaa'], max_severity: '9.8' },
        { ids: ['GHSA-bbbb'], max_severity: '7.0' },
        { ids: ['GHSA-cccc'], max_severity: '5.3' }
    ], { withSbom: false }));
    assert.equal(r.blocking.length, 2);
    assert.match(r.blocking.join('\n'), /GHSA-aaaa/);
    assert.match(r.blocking.join('\n'), /GHSA-bbbb/);
    assert.deepEqual(r.advisory.map((a) => a.includes('GHSA-cccc')), [true]);
});

test('osv: находка без оценки тяжести блокирует, а не считается лёгкой', () => {
    const r = gate.classifyOsvReport(report([{ ids: ['GHSA-dddd'], max_severity: '' }]));
    assert.equal(r.blocking.length, 2, 'по находке на каждый источник');
    assert.match(r.blocking[0], /тяжесть не указана/);
});

test('osv: чистый полный отчёт проходит', () => {
    const r = gate.classifyOsvReport(report([]));
    assert.deepEqual(r, { blocking: [], advisory: [], problems: [] });
});

test('osv: отчёт без SBOM или без Electron — неполный, а не чистый', () => {
    assert.ok(gate.classifyOsvReport(report([], { withSbom: false })).problems.some((p) => /sbom/.test(p)));
    assert.ok(gate.classifyOsvReport(report([], { withElectron: false })).problems.some((p) => /electron/.test(p)));
    assert.ok(gate.classifyOsvReport({ results: [] }).problems.length >= 2, 'пустой отчёт обязан быть проблемой');
});

test('SBOM: scope из group и вложенные компоненты попадают в набор', () => {
    const set = gate.packageSetFromSbom({
        components: [{ group: '@electron', name: 'fuses', version: '1.8.0', components: [{ name: 'x', version: '1.0.0' }] }]
    });
    assert.deepEqual([...set].sort(), ['@electron/fuses@1.8.0', 'x@1.0.0']);
});

test('lockfile: имя берётся из пути node_modules, корень проекта пропускается', () => {
    const set = gate.packageSetFromLock({
        packages: {
            '': { name: 'timer-widget', version: '2.10.0' },
            'node_modules/a/node_modules/@s/b': { version: '2.0.0' }
        }
    });
    assert.deepEqual([...set], ['@s/b@2.0.0']);
});

test('расхождение наборов видно в обе стороны', () => {
    const d = gate.diffSets(new Set(['a@1', 'b@1']), new Set(['b@1', 'c@1']));
    assert.deepEqual(d, { onlyInA: ['a@1'], onlyInB: ['c@1'] });
});

test('реальные sbom.json и package-lock.json сейчас совпадают и несут один Electron', () => {
    const lock = gate.packageSetFromLock(JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')));
    const sbom = gate.packageSetFromSbom(JSON.parse(fs.readFileSync(path.join(ROOT, 'sbom.json'), 'utf8')));
    assert.ok(lock.size > 100, `в lockfile подозрительно мало пакетов (${lock.size}) — разбор сломан?`);
    assert.deepEqual(gate.diffSets(lock, sbom), { onlyInA: [], onlyInB: [] }, 'sbom.json устарел — `npm run sbom`');
    assert.equal([...lock].filter((x) => x.startsWith('electron@')).length, 1);
});

test('версия Electron читается из бинаря', () => {
    const buf = Buffer.from('\0\0Mozilla/5.0 Chrome/152 Electron/44.4.5 Safari\0Electron/44.4.5\0');
    assert.deepEqual(gate.electronVersionInBinary(buf), ['44.4.5']);
    assert.deepEqual(gate.electronVersionInBinary(Buffer.from('ничего')), []);
});

test('последний патч ищется в своей мажорной линии, пререлизы не считаются', () => {
    const v = ['43.9.9', '44.1.1', '44.4.5', '44.10.0', '45.0.0-alpha.1', '45.0.0'];
    assert.equal(gate.latestInMajor(v, '44.1.1'), '44.10.0');
    assert.equal(gate.latestInMajor(v, '45.0.0'), '45.0.0');
    assert.ok(gate.compareSemver('44.10.0', '44.4.5') > 0, 'сравнение числовое, а не строковое');
});
