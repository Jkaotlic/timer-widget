#!/usr/bin/env node
'use strict';

/**
 * Ворота уязвимостей для CI и релиза.
 *
 * Зачем. Сборка 2.9.0 не прошла ПСИ по критическим уязвимостям Linux-версии.
 * Сканер приёмки читал package-lock.json и sbom.json — то есть ровно то, что
 * есть и у нас. Здесь CI делает то же самое ДО релиза и валит сборку.
 *
 * Подкоманды:
 *
 *   osv <report.json>
 *       Разбирает отчёт `osv-scanner --format=json --all-packages`.
 *       Блокирует: находку с max_severity >= 7.0 (high/critical по CVSS) и
 *       находку БЕЗ оценки — неизвестная тяжесть не считается лёгкой.
 *       Ниже порога — предупреждение в лог (::warning::), не провал.
 *       Принятые находки перечисляются в osv-scanner.toml с причиной — тогда
 *       сканер их не выдаёт вовсе. Сам отчёт проверяется на полноту: пустой
 *       отчёт одинаково значит «чисто» и «сканер ничего не прочёл», поэтому
 *       требуются оба источника и Electron в каждом.
 *
 *   sbom-sync
 *       Сверяет sbom.json с package-lock.json: одинаковый набор name@version.
 *       SBOM прикладывается к релизу и читается сканером приёмки — устаревший
 *       SBOM сообщает ему чужие версии. «SBOM протухает молча» случилось в 2.7.1.
 *
 *   electron [--binary <путь>] [--require-latest]
 *       Версия Electron в lockfile = в SBOM = (если дан --binary) в собранном
 *       бинаре (строка `Electron/X.Y.Z`). Затем — отставание от последнего
 *       патча своей мажорной линии.
 *
 *       Почему это отдельная проверка, а не часть сканера. Chromium в
 *       пакете — внутри одного бинаря, и ни Grype/Syft, ни Trivy его версию из
 *       бинаря не определяют (замер 25.09.2026: syft по linux-unpacked —
 *       «No packages discovered»). Electron виден сканерам ТОЛЬКО как пакет
 *       npm в lockfile/SBOM, а в базе OSV по нему заведены лишь уязвимости
 *       самого Electron. Уязвимости Chromium закрываются патч-релизами
 *       Electron и отдельными записями на npm-пакет обычно НЕ заводятся —
 *       поэтому «стоит последний патч своей линии» и есть проверка на CVE
 *       Chromium. В CI отставание — предупреждение, в релизе
 *       (--require-latest) — провал.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const HIGH = 7.0;

/** Набор `name@version` из package-lock.json (v2/v3), без корня проекта. */
function packageSetFromLock(lock) {
    const set = new Set();
    for (const [key, meta] of Object.entries(lock.packages || {})) {
        if (!key || meta.link) { continue; }
        const name = meta.name || key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
        set.add(`${name}@${meta.version}`);
    }
    return set;
}

/** Набор `name@version` из CycloneDX: компоненты вложены, scope — в `group`. */
function packageSetFromSbom(sbom) {
    const set = new Set();
    const walk = (list) => {
        for (const c of list || []) {
            const name = c.group ? `${c.group}/${c.name}` : c.name;
            set.add(`${name}@${c.version}`);
            walk(c.components);
        }
    };
    walk(sbom.components);
    return set;
}

function diffSets(a, b) {
    return {
        onlyInA: [...a].filter((x) => !b.has(x)).sort(),
        onlyInB: [...b].filter((x) => !a.has(x)).sort()
    };
}

function versionsOf(set, name) {
    return [...set]
        .filter((x) => x.startsWith(`${name}@`))
        .map((x) => x.slice(name.length + 1));
}

/**
 * Разбор отчёта osv-scanner. Возвращает { blocking, advisory, problems }:
 * blocking/advisory — строки находок, problems — неполнота самого отчёта.
 */
function classifyOsvReport(report, { threshold = HIGH, requirePackage = 'electron' } = {}) {
    const blocking = [];
    const advisory = [];
    const problems = [];
    const results = Array.isArray(report && report.results) ? report.results : [];

    const types = new Set(results.map((r) => r.source && r.source.type));
    for (const need of ['lockfile', 'sbom']) {
        if (!types.has(need)) {
            problems.push(`в отчёте нет источника «${need}» — сканер его не прочёл`);
        }
    }
    for (const r of results) {
        const pkgs = r.packages || [];
        const where = r.source ? r.source.path : '?';
        if (requirePackage && !pkgs.some((p) => p.package && p.package.name === requirePackage)) {
            problems.push(`${where}: в разобранных пакетах нет ${requirePackage} (отчёт без --all-packages или источник не распознан)`);
        }
        for (const p of pkgs) {
            for (const g of p.groups || []) {
                const id = (g.ids || []).join(',');
                const aliases = (g.aliases || []).filter((a) => !(g.ids || []).includes(a));
                const label = `${p.package.name}@${p.package.version} ${id}${aliases.length ? ` (${aliases.join(', ')})` : ''}`;
                const score = parseFloat(g.max_severity);
                if (!Number.isFinite(score)) {
                    blocking.push(`${label} — тяжесть не указана`);
                } else if (score >= threshold) {
                    blocking.push(`${label} — CVSS ${score}`);
                } else {
                    advisory.push(`${label} — CVSS ${score}`);
                }
            }
        }
    }
    return { blocking, advisory, problems };
}

/** Версия Electron, вшитая в бинарь (строка User-Agent `Electron/X.Y.Z`). */
function electronVersionInBinary(buffer) {
    const found = new Set();
    const re = /Electron\/(\d+\.\d+\.\d+)/g;
    const text = buffer.toString('latin1');
    let m;
    while ((m = re.exec(text)) !== null) { found.add(m[1]); }
    return [...found];
}

function compareSemver(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) { return pa[i] - pb[i]; }
    }
    return 0;
}

/** Последний стабильный релиз той же мажорной линии из списка версий npm. */
function latestInMajor(versions, current) {
    const major = current.split('.')[0];
    const stable = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && v.split('.')[0] === major);
    return stable.sort(compareSemver).pop() || null;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
}

function cmdOsv(file) {
    if (!file || !fs.existsSync(file) || fs.statSync(file).size === 0) {
        console.error(`::error::отчёт osv-scanner не найден или пуст (${file}) — сканер упал, находок не знаем`);
        return 1;
    }
    const { blocking, advisory, problems } = classifyOsvReport(JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const a of advisory) { console.log(`::warning::osv (ниже high): ${a}`); }
    for (const p of problems) { console.error(`::error::osv: ${p}`); }
    for (const b of blocking) { console.error(`::error::osv: ${b}`); }
    if (problems.length || blocking.length) {
        console.error(`[security] osv: блокирующих находок ${blocking.length}, проблем отчёта ${problems.length}. ` +
            'Принять находку можно только записью в osv-scanner.toml с причиной и сроком.');
        return 1;
    }
    console.log(`[security] osv: блокирующих находок нет (ниже порога: ${advisory.length})`);
    return 0;
}

function cmdSbomSync() {
    const lock = packageSetFromLock(readJson('package-lock.json'));
    const sbom = packageSetFromSbom(readJson('sbom.json'));
    const { onlyInA, onlyInB } = diffSets(lock, sbom);
    if (onlyInA.length || onlyInB.length) {
        console.error('::error::sbom.json разошёлся с package-lock.json — `npm run sbom` и закоммитить');
        for (const x of onlyInA) { console.error(`  только в lockfile: ${x}`); }
        for (const x of onlyInB) { console.error(`  только в SBOM:     ${x}`); }
        return 1;
    }
    console.log(`[security] sbom.json совпадает с package-lock.json (${lock.size} пакетов)`);
    return 0;
}

function cmdElectron(args) {
    let failed = false;
    const lockVersions = versionsOf(packageSetFromLock(readJson('package-lock.json')), 'electron');
    const sbomVersions = versionsOf(packageSetFromSbom(readJson('sbom.json')), 'electron');
    if (lockVersions.length !== 1) {
        console.error(`::error::в lockfile ожидалась ровно одна версия electron, найдено: ${lockVersions.join(', ') || 'ни одной'}`);
        return 1;
    }
    const version = lockVersions[0];
    console.log(`[security] Electron в lockfile: ${version}`);
    if (sbomVersions.length !== 1 || sbomVersions[0] !== version) {
        console.error(`::error::Electron в SBOM (${sbomVersions.join(', ') || 'нет'}) ≠ в lockfile (${version})`);
        failed = true;
    }

    const binIdx = args.indexOf('--binary');
    if (binIdx > -1) {
        const bin = args[binIdx + 1];
        const inBinary = electronVersionInBinary(fs.readFileSync(bin));
        console.log(`[security] Electron в бинаре ${bin}: ${inBinary.join(', ') || 'не найден'}`);
        if (inBinary.length !== 1 || inBinary[0] !== version) {
            console.error(`::error::собранный бинарь несёт Electron ${inBinary.join(', ') || '?'}, а lockfile/SBOM сообщают сканеру ${version}`);
            failed = true;
        }
    }

    let published;
    try {
        published = JSON.parse(execFileSync('npm', ['view', 'electron', 'versions', '--json'], {
            encoding: 'utf8', shell: process.platform === 'win32'
        }));
    } catch (err) {
        console.error(`::error::не удалось спросить у npm список версий electron: ${err.message}`);
        return 1;
    }
    const latest = latestInMajor(published, version);
    const behind = latest && compareSemver(latest, version) > 0;
    if (behind) {
        const msg = `Electron ${version} отстаёт от ${latest} — патч-релизы Electron несут исправления Chromium`;
        if (args.includes('--require-latest')) {
            console.error(`::error::${msg}; релиз с известными CVE Chromium не выпускается`);
            failed = true;
        } else {
            console.log(`::warning::${msg}`);
        }
    } else {
        console.log(`[security] Electron ${version} — последний патч линии ${version.split('.')[0]}.x`);
    }
    return failed ? 1 : 0;
}

function main(argv) {
    const [cmd, ...rest] = argv;
    if (cmd === 'osv') { return cmdOsv(rest[0]); }
    if (cmd === 'sbom-sync') { return cmdSbomSync(); }
    if (cmd === 'electron') { return cmdElectron(rest); }
    console.error('использование: security-gate.js osv <report.json> | sbom-sync | electron [--binary <путь>] [--require-latest]');
    return 2;
}

if (require.main === module) {
    process.exit(main(process.argv.slice(2)));
}

module.exports = {
    packageSetFromLock,
    packageSetFromSbom,
    diffSets,
    classifyOsvReport,
    electronVersionInBinary,
    latestInMajor,
    compareSemver
};
