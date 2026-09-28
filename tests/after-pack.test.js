'use strict';

// build/after-pack.js: права разделяемых библиотек в Linux-сборке.
//
// CI 28.09.2026, lintian: E: shared-library-is-executable 0755 на
// libffmpeg.so, libvk_swiftshader.so, libvulkan.so.1 — Electron поставляет их
// с битом исполнения. dlopen() бит x не нужен; fpm берёт права с диска, так
// что снимать его надо в каталоге сборки, до упаковки.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const afterPack = require('../build/after-pack');

// На Windows chmod меняет только бит «только чтение» — проверять нечего.
const SKIP = process.platform === 'win32';

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-afterpack-'));
    const mk = (rel, mode) => {
        const full = path.join(dir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, 'x');
        fs.chmodSync(full, mode);
        return full;
    };
    mk('libffmpeg.so', 0o755);
    mk('libvulkan.so.1', 0o755);
    mk('swiftshader/libvk_swiftshader.so', 0o755);
    mk('timer-widget', 0o755);
    mk('chrome-sandbox', 0o755);
    mk('resources/not-a-lib.sop', 0o755);
    fs.symlinkSync('libffmpeg.so', path.join(dir, 'libalias.so'));
    return dir;
}
const mode = (dir, rel) => fs.statSync(path.join(dir, rel)).mode & 0o777;

test('Linux: у каждой *.so и *.so.N снят бит исполнения, исполняемые файлы не тронуты', { skip: SKIP }, async () => {
    const dir = fixture();
    await afterPack.default({ appOutDir: dir, electronPlatformName: 'linux' });
    assert.equal(mode(dir, 'libffmpeg.so'), 0o644);
    assert.equal(mode(dir, 'libvulkan.so.1'), 0o644);
    assert.equal(mode(dir, 'swiftshader/libvk_swiftshader.so'), 0o644, 'вложенный каталог пропущен');
    assert.equal(mode(dir, 'timer-widget'), 0o755, 'бинарник приложения потерял x');
    assert.equal(mode(dir, 'chrome-sandbox'), 0o755, 'chrome-sandbox потерял x');
    assert.equal(mode(dir, 'resources/not-a-lib.sop'), 0o755, 'сработало на похожем имени');
    assert.ok(fs.lstatSync(path.join(dir, 'libalias.so')).isSymbolicLink(), 'символическая ссылка заменена');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('не Linux: права библиотек не меняются (проверка себя — зонд видит 0755)', { skip: SKIP }, async () => {
    const dir = fixture();
    await afterPack.default({ appOutDir: dir, electronPlatformName: 'darwin' });
    assert.equal(mode(dir, 'libffmpeg.so'), 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
});
