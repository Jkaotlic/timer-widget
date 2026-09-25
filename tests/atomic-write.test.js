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
 * пути (fsyncSync / writeSync): так проверяется ровно «запись сорвалась на
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
    t.mock.method(fs, 'writeSync', () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); });

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
