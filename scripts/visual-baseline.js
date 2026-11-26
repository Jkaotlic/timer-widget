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
const { CAPTURE_MANIFEST, isTimeDependent } = require('../visual-diff');

function readCapturedFrames(srcDir) {
    const manifest = path.join(srcDir, CAPTURE_MANIFEST);
    if (!fs.existsSync(manifest)) {
        throw new Error('нет завершённой съёмки — сначала выполните `npm run screenshot`');
    }
    const shots = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (!Array.isArray(shots) || !shots.every((name) => typeof name === 'string' && /^[a-z0-9-]+\.png$/.test(name))) {
        throw new Error('некорректный список кадров');
    }
    return shots;
}

function promoteBaseline(srcDir, dstDir) {
    const shots = readCapturedFrames(srcDir);
    const selected = new Set(shots.filter((name) => !isTimeDependent(name)));
    if (!selected.size) { throw new Error('в завершённой съёмке нет сравнимых кадров'); }

    // Проверяем источники до замены старого эталона.
    for (const name of selected) {
        const stat = fs.statSync(path.join(srcDir, name), { throwIfNoEntry: false });
        if (!stat?.isFile() || !stat.size) { throw new Error(`кадр ${name} отсутствует или пуст`); }
    }

    fs.mkdirSync(dstDir, { recursive: true });
    for (const name of selected) {
        fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name));
    }
    for (const stale of fs.readdirSync(dstDir).filter((name) => name.endsWith('.png'))) {
        if (!selected.has(stale)) {
            fs.unlinkSync(path.join(dstDir, stale));
            console.log(`[visual] удалён устаревший эталон ${stale}`);
        }
    }
    return { copied: selected.size, skipped: shots.length - selected.size };
}

if (require.main === module) {
    const repoRoot = path.join(__dirname, '..');
    try {
        const result = promoteBaseline(path.join(repoRoot, 'screenshots'), path.join(repoRoot, 'tests', 'visual-baseline'));
        console.log(`[visual] эталонов записано: ${result.copied}, пропущено зависящих от времени: ${result.skipped}`);
    } catch (error) {
        console.error(`[visual] ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { promoteBaseline };
