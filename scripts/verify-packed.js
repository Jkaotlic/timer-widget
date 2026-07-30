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
 * Формат asar — ЧЕТЫРЕ uint32 перед JSON, а не три:
 *   [0..3]   uint32  payload size внешнего pickle (всегда 4)
 *   [4..7]   uint32  размер буфера pickle заголовка (вместе с его собственным полем)
 *   [8..11]  uint32  payload size pickle заголовка (= предыдущее − 4)
 *   [12..15] uint32  длина JSON-строки
 *   [16..]           сам JSON с деревом файлов (далее выравнивание до 4 байт)
 *
 * Смещения сверены с настоящим архивом (node_modules/electron/dist/…/
 * default_app.asar): `04 00 00 00 | fc 0c 00 00 | f8 0c 00 00 | f4 0c 00 00 | {"files"…`.
 * Тест читает этот же архив — синтетика одна, без живого образца, уже дала
 * ложную уверенность: первая версия парсера брала длину со смещения 8, а тест
 * собирал архив по тому же ошибочному раскладу и проходил.
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
        const head = Buffer.alloc(16);
        fs.readSync(fd, head, 0, 16, 0);
        const jsonLen = head.readUInt32LE(12);
        if (!Number.isFinite(jsonLen) || jsonLen <= 0 || jsonLen > 64 * 1024 * 1024) {
            throw new Error(`неправдоподобная длина заголовка: ${jsonLen}`);
        }
        const json = Buffer.alloc(jsonLen);
        fs.readSync(fd, json, 0, jsonLen, 16);
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

// Достаёт содержимое одного файла из asar по его записи в заголовке.
// Данные лежат подряд после заголовка: offset у записи — смещение ОТ начала
// области данных, то есть от 16 + размер JSON, выровненного пикклом до 4 байт.
function readAsarFile(asarPath, header, relPath) {
    const parts = relPath.split('/');
    let node = header;
    for (const part of parts) {
        node = node.files && node.files[part];
        if (!node) { return null; }
    }
    if (node.files || node.offset === undefined) { return null; }

    const fd = fs.openSync(asarPath, 'r');
    try {
        const head = Buffer.alloc(16);
        fs.readSync(fd, head, 0, 16, 0);
        const jsonLen = head.readUInt32LE(12);
        // Пиккл выравнивает полезную нагрузку до 4 байт.
        const dataStart = 16 + jsonLen + ((4 - (jsonLen % 4)) % 4);
        const buf = Buffer.alloc(Number(node.size));
        fs.readSync(fd, buf, 0, buf.length, dataStart + Number(node.offset));
        return buf.toString('utf8');
    } finally {
        fs.closeSync(fd);
    }
}

// Ворота релиза, проверяемые НА УПАКОВАННОМ артефакте, а не на исходниках.
// Unit-тесты читают файлы репозитория; здесь проверяется то, что реально уехало
// в сборку — между этими двумя состояниями стоит electron-builder со своими
// заменами (см. build/after-pack.js), и доверять надо последнему слову.
function checkHardening(source) {
    const problems = [];
    if (source === null) {
        return ['electron-main.js не найден внутри app.asar'];
    }
    const windows = (source.match(/new BrowserWindow\(\{/g) || []).length;
    const guards = (source.match(
        /devTools:\s*process\.argv\.includes\('--dev'\)\s*&&\s*!app\.isPackaged/g
    ) || []).length;
    if (windows === 0) { problems.push('в упакованном main нет ни одного BrowserWindow'); }
    if (guards < windows) {
        problems.push(`окон ${windows}, гардов devTools ${guards} — в сборке остался режим разработчика`);
    }
    if (/sandbox:\s*false/.test(source)) { problems.push('в сборке окно с sandbox: false'); }
    if (/nodeIntegration:\s*true/.test(source)) { problems.push('в сборке окно с nodeIntegration: true'); }
    if (/contextIsolation:\s*false/.test(source)) { problems.push('в сборке окно с contextIsolation: false'); }
    if (/autoUpdater/.test(source)) { problems.push('в сборке появился автообновлятель'); }
    return problems;
}

// Сверяет плоский список файлов пакета с объявленным build.files.
// Чистая функция — её и гоняет tests/verify-packed.test.js.
function checkPacked(packedList, declared, countRepoFiles) {
    const packed = new Set(packedList);
    const missing = [];
    const emptyGlobs = [];

    for (const entry of declared) {
        if (entry.includes('*')) {
            // Шаблон вида `sounds/**/*` считается ПРОВАЛЕННЫМ только если файлы
            // под этим каталогом в репозитории ЕСТЬ, а в пакет не попал ни один —
            // ровно тот случай, когда ассет объявлен, лежит на месте и всё равно
            // не доезжает до сборки (так в 2.3.2 потерялся design-tokens.css).
            //
            // Пустой каталог-заготовка — не ошибка: `sounds/` держится одним
            // `.gitkeep` под будущие аудиофайлы (сейчас все 29 звуков синтезируются
            // осцилляторами в sound-bank.js). Шаблон оставлен намеренно, чтобы
            // добавленный позже файл поехал в пакет сам, без правки build.files.
            // Точки-файлы (.gitkeep и подобные) за содержимое не считаем.
            const dir = entry.split('/')[0];
            if (countRepoFiles(dir) === 0) { continue; }
            const hasAny = [...packed].some((p) => p.startsWith(`${dir}/`));
            if (!hasAny) { emptyGlobs.push(entry); }
            continue;
        }
        if (!packed.has(entry)) { missing.push(entry); }
    }

    return { missing, emptyGlobs, ok: missing.length === 0 && emptyGlobs.length === 0 };
}

// Сколько НЕ-точечных файлов лежит под каталогом в репозитории (рекурсивно).
function countRepoFilesUnder(root, dir) {
    const start = path.join(root, dir);
    let total = 0;
    const walk = (d) => {
        let entries;
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (e.name.startsWith('.')) { continue; }
            if (e.isSymbolicLink()) { continue; }
            if (e.isDirectory()) { walk(path.join(d, e.name)); }
            else { total++; }
        }
    };
    walk(start);
    return total;
}

function main() {
    const distDir = path.join(ROOT, 'dist');
    const asarPath = findAsar(distDir);
    if (!asarPath) {
        console.error('[verify-packed] app.asar не найден в dist/ — сначала `npm run pack`');
        process.exit(1);
    }
    console.log(`[verify-packed] читаю ${path.relative(ROOT, asarPath)}`);

    const header = readAsarHeader(asarPath);
    const packed = new Set(flatten(header, '', []));
    console.log(`[verify-packed] файлов в пакете: ${packed.size}`);

    // Ворота релиза на самом артефакте: режим разработчика закрыт, окна
    // изолированы, самообновления нет.
    const hardening = checkHardening(readAsarFile(asarPath, header, 'electron-main.js'));
    if (hardening.length) {
        console.error('\n[verify-packed] СБОРКА НЕ ПРОШЛА ВОРОТА');
        for (const p of hardening) { console.error(`  ${p}`); }
        process.exit(1);
    }
    console.log('[verify-packed] OK: режим разработчика закрыт, окна изолированы, автообновления нет');

    const declared = require(path.join(ROOT, 'package.json')).build.files;
    const { missing, emptyGlobs } = checkPacked(
        [...packed],
        declared,
        (dir) => countRepoFilesUnder(ROOT, dir)
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

module.exports = {
    readAsarHeader,
    readAsarFile,
    flatten,
    checkPacked,
    checkHardening,
    findAsar,
    countRepoFilesUnder
};

// Запуск как скрипт — но не при импорте из теста.
if (require.main === module) {
    main();
}
