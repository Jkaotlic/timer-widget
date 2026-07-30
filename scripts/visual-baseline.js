#!/usr/bin/env node
'use strict';

/**
 * Промоутит текущие снимки из screenshots/ в эталоны tests/visual-baseline/.
 *
 * Порядок работы:
 *   npm run screenshot        — снять текущее состояние и посмотреть глазами
 *   npm run visual:baseline   — принять его как эталон (осознанное действие)
 *   npm run visual:check      — снять заново и сравнить с эталоном
 *
 * Снимки виджета часов не копируются: они показывают реальное текущее время и
 * отличаются при каждом запуске by design (см. isTimeDependent в visual-diff.js).
 */

const fs = require('node:fs');
const path = require('node:path');
const { isTimeDependent } = require('../visual-diff');

const repoRoot = path.join(__dirname, '..');
const srcDir = path.join(repoRoot, 'screenshots');
const dstDir = path.join(repoRoot, 'tests', 'visual-baseline');

if (!fs.existsSync(srcDir)) {
    console.error('[visual] нет папки screenshots/ — сначала выполните `npm run screenshot`');
    process.exit(1);
}

const shots = fs.readdirSync(srcDir).filter((f) => f.endsWith('.png')).sort();
if (shots.length === 0) {
    console.error('[visual] в screenshots/ нет PNG — сначала выполните `npm run screenshot`');
    process.exit(1);
}

fs.mkdirSync(dstDir, { recursive: true });

// Убираем эталоны, которых больше нет среди снимков, — иначе папка копит мусор
// от переименованных сценариев и сверка начинает врать про «нет эталона».
for (const stale of fs.readdirSync(dstDir).filter((f) => f.endsWith('.png'))) {
    if (!shots.includes(stale)) {
        fs.unlinkSync(path.join(dstDir, stale));
        console.log(`[visual] удалён устаревший эталон ${stale}`);
    }
}

let copied = 0;
let skipped = 0;
for (const name of shots) {
    if (isTimeDependent(name)) { skipped++; continue; }
    fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name));
    copied++;
}

console.log(`[visual] эталонов записано: ${copied}, пропущено зависящих от времени: ${skipped}`);
console.log(`[visual] папка: ${path.relative(repoRoot, dstDir)}`);
