'use strict';

/**
 * Файл накопителя перелимита мероприятия.
 *
 * Зачем свой файл, а не recovery.js: у восстановления после падения срок
 * годности 5 минут (recovery.js, MAX_AGE_MS), и мероприятие на два часа он
 * выбросил бы. Здесь срока годности нет намеренно — перезапуск приложения
 * посреди мероприятия не должен обнулять то, что объявят залу.
 *
 * Всё, что читается с диска, — недоверенный вход: файл мог быть обрезан
 * падением, отредактирован руками или не существовать вовсе. Ни один из этих
 * случаев не имеет права уронить запуск приложения.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Store = require('../event-overrun-store');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'overrun-store-'));
}

test('круговой рейс: что записали, то и прочли', () => {
    const dir = tempDir();
    Store.saveStore(dir, { overrunSeconds: 42, finished: true });
    assert.deepEqual(Store.loadStore(dir), { overrunSeconds: 42, finished: true });
});

test('файла нет — чистое состояние, а не исключение', () => {
    const dir = tempDir();
    assert.deepEqual(Store.loadStore(dir), { overrunSeconds: 0, finished: false });
});

test('битый JSON не роняет запуск', () => {
    const dir = tempDir();
    fs.writeFileSync(Store.getStorePath(dir), '{"overrunSeconds": 4');
    assert.deepEqual(Store.loadStore(dir), { overrunSeconds: 0, finished: false });
});

test('срока годности НЕТ: старая запись остаётся в силе', () => {
    // Ровно то, чем этот файл отличается от recovery.js. Мероприятие идёт
    // два часа, и перезапуск на втором часе обязан вернуть накопленное.
    const dir = tempDir();
    const stale = { overrunSeconds: 900, finished: false, savedAt: Date.now() - 3 * 60 * 60 * 1000 };
    fs.writeFileSync(Store.getStorePath(dir), JSON.stringify(stale));
    assert.equal(Store.loadStore(dir).overrunSeconds, 900);
});

test('мусор в полях приводится к смыслу', () => {
    assert.deepEqual(Store.normalizeStore(null), { overrunSeconds: 0, finished: false });
    assert.deepEqual(Store.normalizeStore('строка'), { overrunSeconds: 0, finished: false });
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: -7 }), { overrunSeconds: 0, finished: false });
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: 'нет' }), { overrunSeconds: 0, finished: false });
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: Infinity }), { overrunSeconds: 0, finished: false });
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: 5.7 }), { overrunSeconds: 5, finished: false });
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: 5, finished: 'да' }), { overrunSeconds: 5, finished: true });
});

test('запись в несуществующий каталог не бросает, а сообщает логгеру', () => {
    const logged = [];
    const logger = { error: (...args) => logged.push(args) };
    Store.saveStore(path.join(tempDir(), 'нет', 'такого'), { overrunSeconds: 1, finished: false }, logger);
    assert.equal(logged.length, 1, 'ошибка записи обязана быть замечена, а не проглочена молча');
});
