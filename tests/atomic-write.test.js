'use strict';

/**
 * BUG-09: запись файлов состояния — атомарная.
 *
 * `writeFileSync` поверх старого файла сначала ОБРЕЗАЕТ его, потом пишет.
 * Падение, выключение питания или полный диск между этими шагами оставляли
 * пустой или обрезанный JSON — и накопитель перелимита молча читался как
 * ноль: деньги мероприятия пропадали. Теперь пишется временный файл рядом,
 * fsync, и только потом rename поверх старого.
 *
 * Отказ записи имитируется подменой ОДНОЙ функции `fs` — той, что в середине
 * пути (fsyncSync / writeFileSync): так проверяется ровно «запись сорвалась на
 * полпути», а не «файл не открылся».
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeFileAtomicSync } = require('../atomic-write');
const OverrunStore = require('../event-overrun-store');
const recovery = require('../recovery');
const { codeOnly } = require('./helpers/source-scan');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
}

// Всё, что осталось в каталоге, кроме самого файла, — брошенный временный.
function leftovers(dir, keep) {
    return fs.readdirSync(dir).filter((name) => name !== keep);
}

test('запись кладёт содержимое и не оставляет временных файлов', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'state.json');
    writeFileAtomicSync(file, '{"a":1}');
    writeFileAtomicSync(file, '{"a":2}');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"a":2}');
    assert.deepEqual(leftovers(dir, 'state.json'), []);
});

test('сорвавшаяся запись оставляет старый файл целым и убирает временный', (t) => {
    const dir = tmpDir();
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, '{"old":true}');
    t.mock.method(fs, 'fsyncSync', () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); });

    assert.throws(() => writeFileAtomicSync(file, '{"new":true}'), /EIO/);
    t.mock.restoreAll();
    assert.equal(fs.readFileSync(file, 'utf8'), '{"old":true}');
    assert.deepEqual(leftovers(dir, 'state.json'), [], 'временный файл брошен в каталоге');
});

test('накопитель перелимита: сорвавшаяся запись не обнуляет итог на диске', (t) => {
    const dir = tmpDir();
    OverrunStore.saveStore(dir, { overrunSeconds: 900, finished: false, talks: [] });
    t.mock.method(fs, 'writeFileSync', () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); });

    const errors = [];
    OverrunStore.saveStore(dir, { overrunSeconds: 1200, finished: false, talks: [] },
        { error: (...a) => errors.push(a) });
    t.mock.restoreAll();

    assert.equal(errors.length, 1, 'отказ обязан дойти до журнала');
    assert.equal(OverrunStore.loadStore(dir).overrunSeconds, 900, 'итог на диске потерян');
    assert.deepEqual(leftovers(dir, OverrunStore.STORE_FILENAME), []);
});

test('снимок восстановления: сорвавшаяся запись оставляет прежний снимок', (t) => {
    const dir = tmpDir();
    recovery.saveTimerStateToFileSync(dir, { totalSeconds: 300, remainingSeconds: 200, presetSeconds: 300, isRunning: true });
    t.mock.method(fs, 'fsyncSync', () => { throw new Error('EIO'); });
    recovery.saveTimerStateToFileSync(dir, { totalSeconds: 300, remainingSeconds: 100, presetSeconds: 300, isRunning: true });
    t.mock.restoreAll();

    const saved = recovery.loadSavedTimerState(dir);
    assert.ok(saved, 'снимок пропал');
    assert.equal(saved.remainingSeconds, 200);
    assert.deepEqual(leftovers(dir, 'last-state.json'), []);
});

// R7 (docs/superpowers/specs/2026-09-28-psi-hardening.md, добивка перед
// повторной сдачей ПСИ): временный файл создаётся `wx` (эксклюзивно) с
// правами 0o600 — файл состояния может содержать итог перелимита (деньги),
// читать его не должен никто, кроме владельца процесса.
test('R7: права созданного файла — 0o600 (POSIX)', { skip: process.platform === 'win32' }, () => {
    const dir = tmpDir();
    const file = path.join(dir, 'state.json');
    writeFileAtomicSync(file, '{"a":1}');
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600, `права файла обязаны быть 0o600, получены ${mode.toString(8)}`);
});

// constraints.md, review focus #3: залежавшийся `.tmp` от прошлого сбоя с
// ТЕМ ЖЕ pid (перезапуск процесса переиспользует pid) не должен ронять
// новую запись на EEXIST — `wx` бросает именно на существующем файле.
test('R7: залежавшийся tmp того же имени не мешает следующей записи', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'state.json');
    const tmpPath = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, 'мусор от прошлого краха');

    assert.doesNotThrow(() => writeFileAtomicSync(file, '{"a":1}'));
    assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
    assert.deepEqual(leftovers(dir, 'state.json'), []);
});

test('R7 source-level: временный файл открывается wx с правами 0o600, а не просто w', () => {
    const src = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'atomic-write.js'), 'utf8'));
    assert.match(src, /openSync\(tmpPath,\s*'wx',\s*0o600\)/,
        'atomic-write.js обязан открывать временный файл эксклюзивно (wx) с правами 0o600');
    assert.doesNotMatch(src, /openSync\(tmpPath,\s*'w'\)/,
        'старое открытие без wx/0o600 не должно остаться в коде');
});

test('oversized journal and recovery files fall back without reading bytes or logging profile paths', (t) => {
    const dir = tmpDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const file of [OverrunStore.getStorePath(dir), recovery.getRecoveryStatePath(dir)]) {
        fs.writeFileSync(file, '');
        fs.truncateSync(file, 256 * 1024);
    }
    const read = t.mock.method(fs, 'readSync');
    const wholeFile = t.mock.method(fs, 'readFileSync');
    const warnings = [];
    const log = { warn: (...args) => warnings.push(args.join(' ')) };
    assert.equal(OverrunStore.loadStore(dir, log).overrunSeconds, 0);
    assert.equal(recovery.loadSavedTimerState(dir, log), null);
    assert.equal(read.mock.callCount(), 0);
    assert.equal(wholeFile.mock.callCount(), 0);
    assert.equal(warnings.length, 2);
    for (const warning of warnings) {
        assert.match(warning, /EFBIG/);
        assert.ok(!warning.includes(dir));
    }
});

test('atomic writer persists the entire UTF-8 payload when a raw write would be short', (t) => {
    const dir = tmpDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'state.json');
    const data = JSON.stringify({ title: 'Доклад'.repeat(1000) });
    const rawWrite = fs.writeSync.bind(fs);
    let partialWrites = 0;
    t.mock.method(fs, 'writeSync', (fd, buffer, offset, length) => {
        const chunk = Math.min(length, 127);
        if (chunk < length) { partialWrites++; }
        return rawWrite(fd, buffer, offset, chunk);
    });
    writeFileAtomicSync(file, data);
    assert.ok(partialWrites > 1);
    assert.equal(fs.readFileSync(file, 'utf8'), data);
});
