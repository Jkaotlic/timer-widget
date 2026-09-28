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

test('SBOM артефакта: пустой каталог — провал, а не «чисто»', () => {
    const pkg = { dependencies: { 'electron-log': '^5.4.4' } };
    assert.deepEqual(gate.missingRuntimeDeps(pkg, { components: [] }), ['electron-log']);
    assert.deepEqual(gate.missingRuntimeDeps(pkg, { components: [{ name: 'electron-log', version: '5.4.4' }] }), []);
});

// ── P5: принятые находки сканеров ────────────────────────────────────────────
// Исключение в osv-scanner.toml / .grype.yaml глушит находку навсегда, если у
// него нет срока: «принятая» уязвимость молча становится вечной, а приёмка
// видит её в своём сканере. Каждое исключение обязано нести причину и срок, и
// истёкший срок валит сборку — пересмотр перестаёт зависеть от памяти.
const TODAY = '2026-09-28';

test('исключения OSV: без причины, без срока или с истёкшим сроком — провал (проверка себя)', () => {
    const expired = '[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nignoreUntil = 2026-01-31\nreason = "только dev"\n';
    const problems = gate.osvExceptionProblems(expired, TODAY);
    assert.equal(problems.length, 1, 'истёкший срок не пойман');
    assert.match(problems[0], /GHSA-aaaa-bbbb-cccc.*2026-01-31/);
    // Срок «сегодня» — уже истёк: пересмотреть надо было до него.
    assert.equal(gate.osvExceptionProblems(expired.replace('2026-01-31', TODAY), TODAY).length, 1);
    assert.equal(gate.osvExceptionProblems('[[IgnoredVulns]]\nid = "X"\nreason = "r"\n', TODAY).length, 1, 'нет срока');
    assert.equal(gate.osvExceptionProblems('[[IgnoredVulns]]\nid = "X"\nignoreUntil = 2027-01-01\n', TODAY).length, 1, 'нет причины');
    assert.equal(gate.osvExceptionProblems('[[IgnoredVulns]]\nid = "X"\nignoreUntil = 2027-01-01\nreason = ""\n', TODAY).length, 1, 'пустая причина');
    // Правильные записи проходят — во всех написаниях даты TOML.
    for (const d of ['2027-01-01', '"2027-01-01"', '2027-01-01T00:00:00Z']) {
        assert.deepEqual(gate.osvExceptionProblems(`[[IgnoredVulns]]\nid = "X"\nignoreUntil = ${d}\nreason = "r"\n`, TODAY), [], d);
    }
    // Переопределение пакета с ignore — тоже исключение, срок у него effectiveUntil.
    assert.equal(gate.osvExceptionProblems('[[PackageOverrides]]\nname = "x"\nignore = true\nreason = "r"\n', TODAY).length, 1);
    // Подтаблица записи — та же запись: `ignore` под [PackageOverrides.vulnerability].
    const sub = '[[PackageOverrides]]\nname = "x"\nreason = "r"\n[PackageOverrides.vulnerability]\nignore = true\n';
    assert.equal(gate.osvExceptionProblems(sub, TODAY).length, 1, 'подтаблица vulnerability обходит проверку срока');
    assert.deepEqual(gate.osvExceptionProblems(sub.replace('reason = "r"\n', 'reason = "r"\neffectiveUntil = 2027-01-01\n'), TODAY), []);
    // Inline-таблица (`vulnerability = { ignore = true }`) — валидный TOML,
    // построчно не разбирается: отвергается, а не пропускается (fail closed).
    const inline = '[[PackageOverrides]]\nname = "a"\nvulnerability = { ignore = true }\n';
    assert.equal(gate.osvExceptionProblems(inline, TODAY).length, 1, 'inline-таблица обходит проверку');
    assert.match(gate.osvExceptionProblems(inline, TODAY)[0], /inline-таблицу/);
    assert.equal(gate.osvExceptionProblems('[[IgnoredVulns]]\nid = "X"\nignoreUntil = 2027-01-01\nreason = "r"\nx = [{ a = 1 }]\n', TODAY).length, 1,
        'inline-массив таблиц обходит проверку');
    // Строка с фигурной скобкой внутри кавычек — не inline-таблица.
    assert.deepEqual(gate.osvExceptionProblems('[[IgnoredVulns]]\nid = "X"\nignoreUntil = 2027-01-01\nreason = "см. {issue}"\n', TODAY), []);
    // Закомментированный образец — не запись.
    assert.deepEqual(gate.osvExceptionProblems('# [[IgnoredVulns]]\n# id = "X"\n', TODAY), []);
});

test('исключения Grype: у каждой записи ignore — «# reason: … until: ГГГГ-ММ-ДД» в будущем (проверка себя)', () => {
    const expired = 'ignore:\n  # reason: не достижимо из приложения until: 2026-01-31\n  - vulnerability: CVE-2026-0001\n';
    const problems = gate.grypeExceptionProblems(expired, TODAY);
    assert.equal(problems.length, 1, 'истёкший срок не пойман');
    assert.match(problems[0], /CVE-2026-0001.*2026-01-31/);
    assert.deepEqual(gate.grypeExceptionProblems(expired.replace('2026-01-31', '2027-03-01'), TODAY), []);
    // Комментарий в той же строке тоже годится.
    assert.deepEqual(gate.grypeExceptionProblems('ignore:\n  - vulnerability: CVE-1 # reason: x until: 2027-01-01\n', TODAY), []);
    assert.equal(gate.grypeExceptionProblems('ignore:\n  - vulnerability: CVE-1\n', TODAY).length, 1, 'запись без комментария');
    assert.equal(gate.grypeExceptionProblems('ignore:\n  - vulnerability: CVE-1 # until: 2027-01-01\n', TODAY).length, 1, 'нет причины');
    assert.equal(gate.grypeExceptionProblems('ignore:\n  - vulnerability: CVE-1 # reason: x\n', TODAY).length, 1, 'нет срока');
    // Поля записи (`package:` под `- vulnerability:`) — не отдельные записи.
    assert.deepEqual(gate.grypeExceptionProblems(
        'ignore:\n  # reason: x until: 2027-01-01\n  - vulnerability: CVE-1\n    package:\n      name: y\nother: 1\n', TODAY), []);
    // Непустой список в строку не разобрать построчно — отвергается, а не пропускается.
    assert.equal(gate.grypeExceptionProblems('ignore: [{vulnerability: CVE-1}]\n', TODAY).length, 1);
    assert.deepEqual(gate.grypeExceptionProblems('ignore: []\n', TODAY), []);
});

test('реальные osv-scanner.toml и .grype.yaml: у каждого исключения причина и срок в будущем', () => {
    const today = new Date().toISOString().slice(0, 10);
    const osv = fs.readFileSync(path.join(__dirname, '..', 'osv-scanner.toml'), 'utf8');
    const grype = fs.readFileSync(path.join(__dirname, '..', '.grype.yaml'), 'utf8');
    // Зонд прочёл файл, а не пустоту: ключ ignore у Grype обязан быть.
    assert.match(grype, /^ignore:/m, '.grype.yaml без ключа ignore — зонд не на что проверять');
    assert.deepEqual(gate.osvExceptionProblems(osv, today), []);
    assert.deepEqual(gate.grypeExceptionProblems(grype, today), []);
});
