#!/usr/bin/env node
'use strict';

/**
 * verify-packed.js — проверяет, что в СОБРАННОМ приложении лежит каждый ассет,
 * заявленный в package.json → build.files.
 *
 * Зачем отдельно от tests/packaging.test.js: тот сверяет только СПИСОК в
 * package.json («упомянут ли файл»), а здесь мы смотрим внутрь настоящего
 * app.asar, собранного настоящим electron-builder на настоящей платформе. Ровно
 * так теряется файл, который есть в репозитории и в списке, но не доезжает до
 * пакета — в 2.3.2 таким образом пропал design-tokens.css, и приложение
 * запускалось без половины стилей.
 *
 * Зависимостей нет намеренно: формат заголовка asar простой и стабильный, а
 * тянуть @electron/asar ради одного чтения в проект без бандлера незачем.
 *
 * Формат asar:
 *   [0..3]   uint32  размер следующего pickle (всегда 4)
 *   [4..7]   uint32  размер pickle заголовка
 *   [8..11]  uint32  длина JSON-строки внутри этого pickle
 *   [12..]           сам JSON с деревом файлов
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function findAsar(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) { continue; }
        if (entry.isDirectory()) {
            const found = findAsar(full);
            if (found) { return found; }
        } else if (entry.name === 'app.asar') {
            return full;
        }
    }
    return null;
}

function readAsarHeader(asarPath) {
    const fd = fs.openSync(asarPath, 'r');
    try {
        const head = Buffer.alloc(12);
        fs.readSync(fd, head, 0, 12, 0);
        const jsonLen = head.readUInt32LE(8);
        if (!Number.isFinite(jsonLen) || jsonLen <= 0 || jsonLen > 64 * 1024 * 1024) {
            throw new Error(`неправдоподобная длина заголовка: ${jsonLen}`);
        }
        const json = Buffer.alloc(jsonLen);
        fs.readSync(fd, json, 0, jsonLen, 12);
        return JSON.parse(json.toString('utf8'));
    } finally {
        fs.closeSync(fd);
    }
}

// Дерево заголовка → плоский список путей с прямыми слэшами.
function flatten(node, prefix, acc) {
    for (const [name, value] of Object.entries(node.files || {})) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (value.files) { flatten(value, rel, acc); }
        else { acc.push(rel); }
    }
    return acc;
}

// Сверяет плоский список файлов пакета с объявленным build.files.
// Чистая функция — её и гоняет tests/verify-packed.test.js.
function checkPacked(packedList, declared, dirExists) {
    const packed = new Set(packedList);
    const missing = [];
    const emptyGlobs = [];

    for (const entry of declared) {
        if (entry.includes('*')) {
            // `sounds/**/*` → требуем хотя бы один файл под этим каталогом,
            // но только если каталог вообще есть в репозитории.
            const dir = entry.split('/')[0];
            if (!dirExists(dir)) { continue; }
            const hasAny = [...packed].some((p) => p.startsWith(`${dir}/`));
            if (!hasAny) { emptyGlobs.push(entry); }
            continue;
        }
        if (!packed.has(entry)) { missing.push(entry); }
    }

    return { missing, emptyGlobs, ok: missing.length === 0 && emptyGlobs.length === 0 };
}

function main() {
    const distDir = path.join(ROOT, 'dist');
    const asarPath = findAsar(distDir);
    if (!asarPath) {
        console.error('[verify-packed] app.asar не найден в dist/ — сначала `npm run pack`');
        process.exit(1);
    }
    console.log(`[verify-packed] читаю ${path.relative(ROOT, asarPath)}`);

    const packed = new Set(flatten(readAsarHeader(asarPath), '', []));
    console.log(`[verify-packed] файлов в пакете: ${packed.size}`);

    const declared = require(path.join(ROOT, 'package.json')).build.files;
    const { missing, emptyGlobs } = checkPacked(
        [...packed],
        declared,
        (dir) => fs.existsSync(path.join(ROOT, dir))
    );

    // Скрипты, которые главный процесс требует в рантайме по относительному пути.
    const runtimeRequires = ['scripts/screenshot-runner.js'];
    const optionalMissing = runtimeRequires.filter((f) => !packed.has(f));

    if (missing.length || emptyGlobs.length) {
        console.error('\n[verify-packed] ПАКЕТ НЕПОЛНЫЙ');
        for (const f of missing) { console.error(`  нет файла: ${f}`); }
        for (const g of emptyGlobs) { console.error(`  пустой шаблон: ${g}`); }
        console.error('\nДобавь недостающее в package.json → build.files.');
        process.exit(1);
    }

    console.log('[verify-packed] OK: каждый объявленный ассет на месте');
    if (optionalMissing.length) {
        console.log(`[verify-packed] заметка (не ошибка): ${optionalMissing.join(', ')} — `
            + 'нужны только в режиме --screenshot, в продакшене не вызываются');
    }
}

module.exports = { readAsarHeader, flatten, checkPacked, findAsar };

// Запуск как скрипт — но не при импорте из теста.
if (require.main === module) {
    main();
}
