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

const { readAsarHeader, flatten, checkPacked } = require('../scripts/verify-packed');

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
        () => true
    );
    assert.equal(res.ok, false);
    assert.deepEqual(res.missing, ['design-tokens.css']);
});

test('пустой шаблон ловится, но только если каталог есть в репозитории', () => {
    // fonts/ есть, но в пакет не попал ни один файл — это регресс.
    const withDir = checkPacked(['electron-main.js'], ['electron-main.js', 'fonts/**/*'], () => true);
    assert.equal(withDir.ok, false);
    assert.deepEqual(withDir.emptyGlobs, ['fonts/**/*']);

    // Каталога нет вовсе — шаблон просто ни к чему не относится, это не ошибка.
    const withoutDir = checkPacked(['electron-main.js'], ['electron-main.js', 'fonts/**/*'], () => false);
    assert.equal(withoutDir.ok, true);
});

test('полный пакет проходит', () => {
    const res = checkPacked(
        ['electron-main.js', 'control.css', 'fonts/a.woff2', 'sounds/b.wav'],
        ['electron-main.js', 'control.css', 'fonts/**/*', 'sounds/**/*'],
        () => true
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
