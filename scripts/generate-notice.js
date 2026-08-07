#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'NOTICE');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let raw;
try {
    raw = execSync('npx --yes license-checker --json --excludePrivatePackages', {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8'
    });
} catch (err) {
    console.error('license-checker failed:', err.message);
    process.exit(1);
}

const packages = JSON.parse(raw);

// Встроенные шрифты. generate-notice обходит node_modules, а шрифты лежат
// в fonts/ файлами и зависимостями не являются — то есть до этой секции
// Inter и JetBrains Mono не были атрибутированы вообще. OFL требует
// прикладывать копирайт И текст лицензии — копирайт идёт из реестра,
// текст лежит рядом в fonts/OFL.txt (скопирован из пакета @fontsource/*,
// один и тот же байт-в-байт во всех шести: OFL 1.1 не параметризуется по
// шрифту, кроме копирайта, а копирайт уже отдельной строкой ниже).
// Реестр один: digits-style.js.
const { DIGIT_FONTS } = require('../digits-style');

// DIGIT_FONTS[].files — это «что нужно стилю Цифры для замера эталона»
// (один файл-представитель на семью), а НЕ «что вообще лежит в fonts/».
// Для Inter и JetBrains Mono это разные множества: обе семьи используются
// всем приложением на 6 и 4 начертаниях × 2 набора символов, а не только
// стилем Цифры. NOTICE обязан перечислять реально встроенные файлы, поэтому
// раскладка идёт по факту диска, а не по этому полю.
const FONTS_DIR = path.join(ROOT, 'fonts');
const allFontFiles = fs.readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2'));

// Слаг из label ('JetBrains Mono' -> 'jetbrains-mono') должен совпасть с
// префиксом файла на диске — не угадываем, а проверяем: каждый файл обязан
// достаться РОВНО одному шрифту, иначе NOTICE снова начнёт занижать (или
// задваивать) состав, только тише, цифрами внутри Files, а не отсутствующей
// секцией целиком.
const filesByFont = DIGIT_FONTS.map((font) => {
    const slug = font.label.toLowerCase().replace(/\s+/g, '-');
    return { font, files: allFontFiles.filter((f) => f.startsWith(slug + '-')).sort() };
});

const claimed = filesByFont.flatMap((entry) => entry.files);
const unclaimed = allFontFiles.filter((f) => !claimed.includes(f));
if (unclaimed.length > 0) {
    throw new Error(`generate-notice: файлы в fonts/ не привязаны ни к одному шрифту реестра — ${unclaimed.join(', ')}`);
}
const claimCounts = new Map();
for (const file of claimed) { claimCounts.set(file, (claimCounts.get(file) || 0) + 1); }
const duplicated = [...claimCounts].filter(([, count]) => count > 1).map(([file]) => file);
if (duplicated.length > 0) {
    throw new Error(`generate-notice: файл fonts/ привязан к нескольким шрифтам сразу — ${duplicated.join(', ')}`);
}

// Одна ссылка на лицензию для всей секции, а не по строке на шрифт — но
// только если у всех шести шрифтов ДЕЙСТВИТЕЛЬНО одна и та же лицензия;
// иначе одна ссылка на всех была бы враньём для того, кто зайдёт проверять.
const licenses = new Set(DIGIT_FONTS.map((font) => font.license));
if (licenses.size !== 1) {
    throw new Error(`generate-notice: секция BUNDLED FONTS ссылается на fonts/OFL.txt один раз для всех, а в реестре разные лицензии — ${[...licenses].join(', ')}`);
}

const fontsSection = [
    '',
    '='.repeat(80),
    '',
    'BUNDLED FONTS',
    '',
    'The following fonts are embedded in fonts/ and are not npm dependencies.',
    `Full license text (same for all ${DIGIT_FONTS.length}): fonts/OFL.txt — ${[...licenses][0]}.`,
    ''
].concat(filesByFont.map(({ font, files }) => [
    `=== ${font.label} ===`,
    `License: ${font.license}`,
    font.copyright,
    `Files: ${files.join(', ')}`,
    ''
].join('\n'))).join('\n');

const header = `Timer Widget
Copyright (c) 2026 ${pkg.author && pkg.author.name ? pkg.author.name : pkg.author || 'Jkaotlic'}
Licensed under the ${pkg.license || 'MIT'} License.

This software includes the following third-party components.
Each is distributed under its own license terms (listed below).

For the embedded Electron runtime (Chromium, V8, Node.js, libuv and their dependencies),
see LICENSES.chromium.html shipped with the application installation.

================================================================================

`;

const entries = Object.entries(packages)
    .filter(([name]) => !name.startsWith('timer-widget@'))
    .sort(([a], [b]) => a.localeCompare(b));

const blocks = entries.map(([nameVer, info]) => {
    const [name, version] = nameVer.split(/@(?=[^@]+$)/);
    const lines = [
        `=== ${name} ===`,
        `Version: ${version || 'unknown'}`,
        `License: ${info.licenses || 'UNKNOWN'}`
    ];
    if (info.repository) { lines.push(`Repository: ${info.repository}`); }
    if (info.publisher) { lines.push(`Publisher: ${info.publisher}`); }
    if (info.url) { lines.push(`Homepage: ${info.url}`); }
    return lines.join('\n');
});

const body = blocks.join('\n\n');
fs.writeFileSync(OUT, header + body + '\n' + fontsSection, 'utf8');
console.log(`NOTICE written: ${entries.length} packages + ${DIGIT_FONTS.length} fonts (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
