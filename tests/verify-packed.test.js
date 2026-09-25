'use strict';

/**
 * Тесты проверяльщика собранного пакета (scripts/verify-packed.js).
 *
 * Сам electron-builder здесь не запускается — он тянет тулчейн с GitHub и в CI
 * это отдельный job. Здесь проверяется ЛОГИКА: разбор заголовка asar (формат
 * простой, но легко ошибиться в смещениях) и сверка списка с build.files.
 *
 * ВАЖНО про синтетику: первая версия этих тестов собирала архив по тому же
 * ошибочному раскладу, что и парсер (длина JSON со смещения 8 вместо 12), и
 * поэтому зелёно проходила — а на настоящем app.asar в CI парсер падал на
 * JSON.parse. Поэтому здесь ОБЯЗАТЕЛЬНО есть тест на живой архив из поставки
 * Electron: синтетика проверяет краевые случаи, живой образец — сам формат.
 *
 * Формат (четыре uint32 перед JSON):
 *   [0..3]   uint32  payload size внешнего pickle (всегда 4)
 *   [4..7]   uint32  размер буфера pickle заголовка
 *   [8..11]  uint32  payload size pickle заголовка (= предыдущее − 4)
 *   [12..15] uint32  длина JSON-строки
 *   [16..]           JSON с деревом файлов (+ выравнивание до 4 байт)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    readAsarHeader,
    readAsarFile,
    flatten,
    checkPacked,
    checkHardening,
    checkBridge,
    mainProcessPaths,
    readPackedMainSource,
    expectedFuseWire,
    fuseProblems,
    readFuseWire,
    findElectronExecutable
} = require('../scripts/verify-packed');

function buildAsar(header) {
    const json = Buffer.from(JSON.stringify(header), 'utf8');
    const pad = (4 - (json.length % 4)) % 4;
    const stringFieldSize = 4 + json.length + pad; // uint32 длины + строка + выравнивание
    const headerPayloadSize = stringFieldSize;
    const headerBufSize = 4 + headerPayloadSize;

    const out = Buffer.alloc(16 + json.length + pad);
    out.writeUInt32LE(4, 0);
    out.writeUInt32LE(headerBufSize, 4);
    out.writeUInt32LE(headerPayloadSize, 8);
    out.writeUInt32LE(json.length, 12);
    json.copy(out, 16);
    return out;
}

function withTempAsar(header, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-test-'));
    const file = path.join(dir, 'app.asar');
    fs.writeFileSync(file, buildAsar(header));
    try {
        return fn(file);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('заголовок asar читается, вложенные каталоги разворачиваются в пути', () => {
    const header = {
        files: {
            'electron-main.js': { size: 10, offset: '0' },
            'control.css': { size: 20, offset: '10' },
            fonts: {
                files: {
                    'inter-latin-400-normal.woff2': { size: 5, offset: '30' }
                }
            },
            sounds: {
                files: {
                    nested: {
                        files: { 'a.wav': { size: 1, offset: '35' } }
                    }
                }
            }
        }
    };

    const paths = withTempAsar(header, (file) => flatten(readAsarHeader(file), '', []));

    assert.deepEqual(paths.sort(), [
        'control.css',
        'electron-main.js',
        'fonts/inter-latin-400-normal.woff2',
        'sounds/nested/a.wav'
    ]);
});

test('заголовок с нечётной длиной JSON тоже читается (выравнивание)', () => {
    // Длина JSON почти никогда не кратна 4 — если перепутать смещение или
    // прибавить padding к длине строки, парсер отвалится на мусоре в конце.
    const header = { files: { 'a.js': { size: 1, offset: '0' } } };
    const paths = withTempAsar(header, (file) => flatten(readAsarHeader(file), '', []));
    assert.deepEqual(paths, ['a.js']);
});

test('НАСТОЯЩИЙ asar из поставки Electron читается', () => {
    // Единственная защита от того, чтобы тест снова подтвердил ошибку парсера:
    // архив собран реальным инструментом, а не по моему представлению о формате.
    // Если Electron не установлен (голая проверка исходников) — тест пропускаем.
    const candidates = [
        'node_modules/electron/dist/Electron.app/Contents/Resources/default_app.asar',
        'node_modules/electron/dist/resources/default_app.asar'
    ].map((p) => path.join(__dirname, '..', p));
    const real = candidates.find((p) => fs.existsSync(p));
    if (!real) {
        console.log('  (electron не установлен — пропуск сверки с живым архивом)');
        return;
    }

    const header = readAsarHeader(real);
    const files = flatten(header, '', []);
    assert.ok(files.length > 0, 'в default_app.asar обязаны быть файлы');
    assert.ok(
        files.some((f) => f.endsWith('.js')),
        `ожидались .js-файлы, получено: ${files.slice(0, 5).join(', ')}`
    );
});

test('битый заголовок не проходит молча', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-bad-'));
    const file = path.join(dir, 'app.asar');
    // Правдоподобные первые байты, но длина JSON заведомо абсурдная.
    const buf = Buffer.alloc(64);
    buf.writeUInt32LE(4, 0);
    buf.writeUInt32LE(20, 4);
    buf.writeUInt32LE(16, 8);
    buf.writeUInt32LE(0xffffffff, 12);
    fs.writeFileSync(file, buf);
    try {
        assert.throws(() => readAsarHeader(file), /неправдоподобная длина/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('пропавший ассет ловится', () => {
    const res = checkPacked(
        ['electron-main.js', 'utils.js'],
        ['electron-main.js', 'utils.js', 'design-tokens.css'],
        () => 1   // предикат отдаёт ЧИСЛО файлов; шаблонов в этом наборе нет
    );
    assert.equal(res.ok, false);
    assert.deepEqual(res.missing, ['design-tokens.css']);
});

test('шаблон провален, только если файлы в репозитории есть, а в пакете их нет', () => {
    // 20 шрифтов в репозитории, в пакете ни одного — это ровно тот регресс,
    // из-за которого в 2.3.2 потерялся design-tokens.css.
    const lost = checkPacked(['electron-main.js'], ['electron-main.js', 'fonts/**/*'], () => 20);
    assert.equal(lost.ok, false);
    assert.deepEqual(lost.emptyGlobs, ['fonts/**/*']);

    // Каталог-заготовка (только .gitkeep → 0 файлов) — не ошибка. Так живёт
    // sounds/: шаблон оставлен под будущие аудиофайлы, звуки пока синтезируются.
    const placeholder = checkPacked(['electron-main.js'], ['electron-main.js', 'sounds/**/*'], () => 0);
    assert.equal(placeholder.ok, true, 'пустой каталог-заготовка не должен ронять проверку');
    assert.deepEqual(placeholder.emptyGlobs, []);
});

test('countRepoFilesUnder не считает точечные файлы за содержимое', () => {
    const { countRepoFilesUnder } = require('../scripts/verify-packed');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-count-'));
    try {
        fs.mkdirSync(path.join(root, 'sounds'));
        fs.writeFileSync(path.join(root, 'sounds', '.gitkeep'), '# Sound files directory');
        assert.equal(countRepoFilesUnder(root, 'sounds'), 0, 'только .gitkeep → содержимого нет');

        fs.mkdirSync(path.join(root, 'sounds', 'nested'));
        fs.writeFileSync(path.join(root, 'sounds', 'nested', 'a.wav'), 'x');
        assert.equal(countRepoFilesUnder(root, 'sounds'), 1, 'вложенный файл обязан считаться');

        assert.equal(countRepoFilesUnder(root, 'нет-такого'), 0, 'отсутствующий каталог → 0, без исключения');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('sounds/ в этом репозитории — заготовка, и проверка это учитывает', () => {
    // Зафиксировано намеренно: если однажды в sounds/ появятся настоящие файлы,
    // тест не упадёт, а вот шаг в CI начнёт следить, что они попадают в пакет.
    const { countRepoFilesUnder } = require('../scripts/verify-packed');
    const root = path.join(__dirname, '..');
    const n = countRepoFilesUnder(root, 'sounds');
    assert.ok(n >= 0);
    if (n === 0) {
        const res = checkPacked(['electron-main.js'], ['sounds/**/*'], () => n);
        assert.equal(res.ok, true);
    }
});

test('полный пакет проходит', () => {
    const res = checkPacked(
        ['electron-main.js', 'control.css', 'fonts/a.woff2', 'sounds/b.wav'],
        ['electron-main.js', 'control.css', 'fonts/**/*', 'sounds/**/*'],
        () => 1
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.missing, []);
    assert.deepEqual(res.emptyGlobs, []);
});

test('реальный build.files из package.json разобран и непуст', () => {
    // Страховка от опечатки в самом реестре: если build.files исчезнет или
    // станет не массивом, шаг в CI должен падать осмысленно, а не на undefined.
    const pkg = require('../package.json');
    assert.ok(Array.isArray(pkg.build.files), 'build.files должен быть массивом');
    assert.ok(pkg.build.files.length > 10, 'подозрительно короткий build.files');
    assert.ok(pkg.build.files.includes('design-tokens.css'),
        'design-tokens.css терялся в 2.3.2 — он обязан быть в списке');
});

// ---------------------------------------------------------------------------
// Ворота релиза на упакованном артефакте
// ---------------------------------------------------------------------------

test('содержимое файла достаётся из НАСТОЯЩЕГО asar, а не только из моей фикстуры', () => {
    // Смещения данных в asar считаются вручную (16 + длина JSON + выравнивание
    // до 4 байт). Проверять это на самодельном архиве бессмысленно: он был бы
    // собран с тем же пониманием формата. Поэтому читаем package.json из
    // default_app.asar, который положил сам Electron, и разбираем его как JSON —
    // сдвиг на один байт сделает разбор невозможным.
    const candidates = [
        'node_modules/electron/dist/Electron.app/Contents/Resources/default_app.asar',
        'node_modules/electron/dist/resources/default_app.asar'
    ].map((p) => path.join(__dirname, '..', p));
    const real = candidates.find((p) => fs.existsSync(p));
    if (!real) {
        console.log('  (electron не установлен — пропуск сверки с живым архивом)');
        return;
    }

    const header = readAsarHeader(real);
    const raw = readAsarFile(real, header, 'package.json');
    assert.ok(raw, 'package.json не извлёкся из default_app.asar');
    const parsed = JSON.parse(raw);
    assert.equal(typeof parsed.name, 'string', 'извлечённый package.json разобрался, но без name');

    assert.equal(readAsarFile(real, header, 'нет-такого-файла.js'), null, 'отсутствующий файл обязан дать null');
});

test('ворота релиза ловят открытый режим разработчика в упакованном main', () => {
    const guarded = `
        controlWindow = new BrowserWindow({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                devTools: process.argv.includes('--dev') && !app.isPackaged
            }
        });
    `;
    assert.deepEqual(checkHardening(guarded), [], 'корректный main обязан проходить ворота');

    const unguarded = guarded.replace(
        "devTools: process.argv.includes('--dev') && !app.isPackaged",
        'devTools: true'
    );
    const problems = checkHardening(unguarded);
    assert.equal(problems.length, 1, `ожидалась одна проблема, получено: ${problems.join('; ')}`);
    assert.match(problems[0], /режим разработчика/);

    // Ослабление изоляции — тоже стоп.
    assert.ok(checkHardening(guarded.replace('sandbox: true', 'sandbox: false')).some((p) => /sandbox/.test(p)));
    assert.ok(
        checkHardening(guarded.replace('nodeIntegration: false', 'nodeIntegration: true'))
            .some((p) => /nodeIntegration/.test(p))
    );
    assert.ok(
        checkHardening(guarded.replace('contextIsolation: true', 'contextIsolation: false'))
            .some((p) => /contextIsolation/.test(p))
    );
    assert.ok(checkHardening(guarded + '\nautoUpdater.checkForUpdates();').some((p) => /автообнов/.test(p)));

    // Пропавший файл — тоже провал, а не «нечего проверять».
    assert.equal(checkHardening(null).length, 1);
});

test('второе окно без гарда не проходит ворота (счёт, а не наличие)', () => {
    // Именно этим была слаба прежняя проверка: она сравнивала число совпадений с
    // константой, поэтому окно, добавленное БЕЗ гарда, оставляло счёт прежним.
    const oneGuarded = `
        a = new BrowserWindow({ webPreferences: { devTools: process.argv.includes('--dev') && !app.isPackaged } });
        b = new BrowserWindow({ webPreferences: { } });
    `;
    const problems = checkHardening(oneGuarded);
    assert.ok(
        problems.some((p) => /окон 2, гардов devTools 1/.test(p)),
        `ожидалось указание на нехватку гарда, получено: ${problems.join('; ')}`
    );
});

// --- Фьюзы Electron (SEC-03) ------------------------------------------------
//
// Конфиг фьюзов проверяет tests/release-gates.test.js, но конфиг — это
// намерение. Здесь проверяется читалка, которой verify-packed.js сверяет БИТЫ
// в собранном бинаре: electron-builder, тихо не применивший конфиг (другая
// версия, выключенный шаг), оставил бы сборку открытой при зелёном юните.

const FUSES = require('../package.json').build.electronFuses;
const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';

// Бинарь-подделка: мусор, сентинел, версия провода, длина, состояния.
function fakeBinary(states) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuses-'));
    const file = path.join(dir, 'electron');
    fs.writeFileSync(file, Buffer.concat([
        Buffer.alloc(64, 7),
        Buffer.from(SENTINEL, 'ascii'),
        Buffer.from([1, states.length]),
        Buffer.from(states, 'ascii'),
        Buffer.alloc(64, 7)
    ]));
    return { dir, file };
}

test('ожидаемый провод строится из build.electronFuses по индексам фьюзов', () => {
    const wire = expectedFuseWire(FUSES);
    // Индексы — из @electron/fuses (FuseV1Options), а не из порядка ключей.
    assert.deepEqual(wire, {
        RunAsNode: [0, false],
        EnableCookieEncryption: [1, true],
        EnableNodeOptionsEnvironmentVariable: [2, false],
        EnableNodeCliInspectArguments: [3, false],
        EnableEmbeddedAsarIntegrityValidation: [4, true],
        OnlyLoadAppFromAsar: [5, true],
        LoadBrowserProcessSpecificV8Snapshot: [6, false],
        GrantFileProtocolExtraPrivileges: [7, true]
    });
});

test('перевёрнутый как надо провод проходит, незнакомый хвост не мешает', async () => {
    // Девятый бит (индекс 8) у Electron 44 есть, а @electron/fuses 1.8.0 его
    // не знает — electron-builder его не трогает, и сверять его не с чем.
    const { dir, file } = fakeBinary('01001101' + '1');
    try {
        assert.deepEqual(fuseProblems(await readFuseWire(file), FUSES), []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('каждый неперевёрнутый фьюз называется поимённо', async () => {
    const { dir, file } = fakeBinary('11001100');
    try {
        const problems = fuseProblems(await readFuseWire(file), FUSES);
        assert.equal(problems.length, 2, problems.join('\n'));
        assert.ok(problems.some((p) => p.includes('RunAsNode')));
        assert.ok(problems.some((p) => p.includes('GrantFileProtocolExtraPrivileges')));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('удалённый или отсутствующий фьюз — провал, а не «ну и ладно»', async () => {
    // 'r' — фьюз удалён из этой версии Electron: обещание конфига не
    // исполняется, и сборка обязана это назвать, а не пройти.
    const { dir, file } = fakeBinary('r1001');
    try {
        const problems = fuseProblems(await readFuseWire(file), FUSES);
        assert.ok(problems.some((p) => p.includes('RunAsNode') && p.includes('удал')), problems.join('\n'));
        assert.ok(problems.some((p) => p.includes('OnlyLoadAppFromAsar')), 'короткий провод не замечен');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('пустой конфиг фьюзов — провал, а не пустая зелёная сверка', () => {
    assert.ok(fuseProblems({ version: '1', 0: 48 }, undefined).length > 0);
    assert.ok(fuseProblems({ version: '1', 0: 48 }, {}).length > 0);
});

test('НАСТОЯЩИЙ бинарь Electron читается, и неперевёрнутый не проходит', async () => {
    // Самопроверка на живом образце, а не на подделке по моему представлению
    // о формате (урок первого парсера asar): штатный бинарь из node_modules
    // собран с RunAsNode=1, и ворота обязаны его отвергнуть.
    const candidates = [
        'node_modules/electron/dist/Electron.app',
        'node_modules/electron/dist/electron',
        'node_modules/electron/dist/electron.exe'
    ].map((p) => path.join(__dirname, '..', p));
    const real = candidates.find((p) => fs.existsSync(p));
    if (!real) {
        console.log('  (electron не установлен — пропуск сверки с живым бинарём)');
        return;
    }
    const wire = await readFuseWire(real);
    assert.equal(wire.version, '1');
    assert.equal(wire[0], '1'.charCodeAt(0), 'штатный Electron собран с RunAsNode включённым');
    const problems = fuseProblems(wire, FUSES);
    assert.ok(problems.some((p) => p.includes('RunAsNode')), 'неперевёрнутый бинарь прошёл ворота');
});

test('исполняемый файл находится по раскладке каждой ОС', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
    const touch = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); };
    const pkg = { name: 'timer-widget', build: { productName: 'TimerWidget' } };
    try {
        const win = path.join(root, 'win-unpacked');
        touch(path.join(win, 'resources', 'app.asar'));
        touch(path.join(win, 'TimerWidget.exe'));
        assert.equal(findElectronExecutable(path.join(win, 'resources', 'app.asar'), pkg), path.join(win, 'TimerWidget.exe'));

        const lin = path.join(root, 'linux-unpacked');
        touch(path.join(lin, 'resources', 'app.asar'));
        touch(path.join(lin, 'timer-widget'));
        assert.equal(findElectronExecutable(path.join(lin, 'resources', 'app.asar'), pkg), path.join(lin, 'timer-widget'));

        const app = path.join(root, 'mac-arm64', 'TimerWidget.app');
        const asar = path.join(app, 'Contents', 'Resources', 'app.asar');
        touch(asar);
        assert.equal(findElectronExecutable(asar, pkg), app);

        const empty = path.join(root, 'nothing');
        touch(path.join(empty, 'resources', 'app.asar'));
        assert.equal(findElectronExecutable(path.join(empty, 'resources', 'app.asar'), pkg), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('ворота читают ВЕСЬ главный процесс из пакета, а не одну точку входа', () => {
    // С 25.09.2026 окна создаются в модуле main-windows.js. Ворота по одному
    // electron-main.js насчитали бы ноль окон — и либо упали бы на
    // корректной сборке, либо (будь проверка «окон нет — нечего проверять»)
    // пропустили бы окно без гарда в модуле.
    const packed = ['electron-main.js', 'main-windows.js', 'main-timer.js', 'utils.js', 'fonts/main-x.js'];
    assert.deepEqual(mainProcessPaths(packed), ['electron-main.js', 'main-timer.js', 'main-windows.js']);

    const files = {
        'electron-main.js': "require('./main-windows');",
        'main-windows.js': "new BrowserWindow({ webPreferences: { devTools: true } });",
        'main-timer.js': '',
        'utils.js': "new BrowserWindow({ webPreferences: { sandbox: false } });"
    };
    const read = (f) => (f in files ? files[f] : null);
    const src = readPackedMainSource(read, packed);
    // Окно без гарда в МОДУЛЕ ловится…
    assert.ok(checkHardening(src).some((p) => /режим разработчика/.test(p)),
        'окно без гарда в модуле прошло ворота');
    // …а посторонний файл в главный процесс не подмешивается.
    assert.ok(!src.includes('sandbox: false'), 'в главный процесс попал не его файл');

    // Нет точки входа — нет и проверки: null, и ворота падают.
    assert.equal(readPackedMainSource(() => null, packed), null);
    assert.equal(checkHardening(readPackedMainSource(() => null, packed)).length, 1);
});

// --- Мост по окнам на артефакте ---------------------------------------------

test('checkBridge: настоящие preload.js и главный процесс проходят, порча — нет', () => {
    const bridge = require('../scripts/preload-channels');
    const { readMainSource } = require('./helpers/main-source');
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    const main = readMainSource();
    const check = (p, m) => checkBridge(p, m, bridge.renderBlock(), bridge.extractBlock);

    assert.deepEqual(check(preload, main), [], 'репозиторий обязан проходить ворота');

    assert.match(check(null, main)[0], /preload\.js не найден/);
    assert.match(check('const x = 1;', main).join('\n'), /нет таблицы/);
    const stale = preload.replace("'quit-app'", "'quit-app', 'evil'");
    assert.match(check(stale, main).join('\n'), /отстала/);
    assert.match(check(preload + '\nconst ALLOWED_CHANNELS = {};', main).join('\n'), /общий белый список/);
    const noRole = main.replace("additionalArguments: [windowArgument('widget')],", '');
    assert.notEqual(noRole, main, 'проба не нашла строку роли — проверка ничего не проверила бы');
    assert.match(check(preload, noRole).join('\n'), /окно без роли/);
    const dupRole = main.replace("windowArgument('clock')", "windowArgument('control')");
    assert.match(check(preload, dupRole).join('\n'), /повторяется/);
});
