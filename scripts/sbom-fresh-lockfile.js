#!/usr/bin/env node
'use strict';

/**
 * Первый шаг `npm run sbom`: освежить дату скрытого lockfile, если он верен.
 *
 * Зачем (замер 29.10.2026). `node node_modules/electron/install.js` — наш
 * способ докачать бинарник Electron — пишет в `node_modules/electron` ПОСЛЕ
 * npm. Скрытый `node_modules/.package-lock.json` становится старше этой папки,
 * `npm ls` перестаёт ему верить и строит дерево с диска, а там нет `integrity`
 * и пометки `dev`. CycloneDX читает `npm ls`, и SBOM молча теряет integrity и
 * scope у ВСЕХ компонентов (дифф ≈ −3900 строк). Свежая дата скрытого файла
 * это лечит: вывод совпал с поправленным вручную SBOM.
 *
 * Освежать можно, только если скрытый lockfile описывает ТО ЖЕ дерево, что
 * `package-lock.json`: иначе мы заставили бы npm поверить устаревшему файлу.
 * Поэтому сначала сверка `packages` (ключ → version):
 *   - каждый пакет скрытого файла есть в `package-lock.json` той же версии;
 *   - пакет `package-lock.json`, которого нет в скрытом, допустим только
 *     опциональный (бинарники других платформ на этой машине не ставятся).
 * Не совпало — код 1 и просьба `npm ci`; дата не трогается.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const HIDDEN = path.join(REPO, 'node_modules', '.package-lock.json');
const LOCK = path.join(REPO, 'package-lock.json');

/**
 * @param {Record<string, {version?: string}>} hidden
 * @param {Record<string, {version?: string, optional?: boolean, devOptional?: boolean}>} lock
 * @returns {string[]} расхождения; пусто — деревья совпадают
 */
function lockfileMismatches(hidden, lock) {
    const problems = [];
    for (const [key, entry] of Object.entries(hidden)) {
        if (!Object.prototype.hasOwnProperty.call(lock, key)) {
            problems.push(`${key}: есть в node_modules, нет в package-lock.json`);
        } else if (entry.version !== lock[key].version) {
            problems.push(`${key}: ${entry.version} в node_modules, ${lock[key].version} в package-lock.json`);
        }
    }
    for (const [key, entry] of Object.entries(lock)) {
        if (key === '' || Object.prototype.hasOwnProperty.call(hidden, key)) {
            continue;
        }
        if (!entry.optional && !entry.devOptional) {
            problems.push(`${key}: есть в package-lock.json, не установлен`);
        }
    }
    return problems;
}

function main() {
    if (!fs.existsSync(HIDDEN)) {
        console.error('[sbom-fresh-lockfile] нет node_modules/.package-lock.json — запусти `npm ci`.');
        return 1;
    }
    const hidden = JSON.parse(fs.readFileSync(HIDDEN, 'utf8')).packages || {};
    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8')).packages || {};
    const problems = lockfileMismatches(hidden, lock);
    if (problems.length > 0) {
        console.error('[sbom-fresh-lockfile] node_modules не совпадает с package-lock.json — запусти `npm ci`:');
        for (const p of problems.slice(0, 20)) {
            console.error(`  ${p}`);
        }
        if (problems.length > 20) {
            console.error(`  … и ещё ${problems.length - 20}`);
        }
        return 1;
    }
    const now = new Date();
    fs.utimesSync(HIDDEN, now, now);
    console.log(`[sbom-fresh-lockfile] совпадает (${Object.keys(hidden).length} пакетов), дата освежена.`);
    return 0;
}

if (require.main === module) {
    process.exitCode = main();
}

module.exports = { lockfileMismatches };
