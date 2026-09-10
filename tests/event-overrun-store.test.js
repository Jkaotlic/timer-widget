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
    assert.deepEqual(Store.loadStore(dir), { overrunSeconds: 42, finished: true, talks: [] });
});

test('файла нет — чистое состояние, а не исключение', () => {
    const dir = tempDir();
    assert.deepEqual(Store.loadStore(dir), { overrunSeconds: 0, finished: false, talks: [] });
});

test('битый JSON не роняет запуск', () => {
    const dir = tempDir();
    fs.writeFileSync(Store.getStorePath(dir), '{"overrunSeconds": 4');
    assert.deepEqual(Store.loadStore(dir), { overrunSeconds: 0, finished: false, talks: [] });
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
    // Журнал в ответе есть ВСЕГДА — пустой, если его не было во входе. Пустой
    // массив и отсутствие поля для читателя разные вещи: во втором случае
    // главному процессу пришлось бы проверять наличие поля на каждом обращении.
    const empty = { overrunSeconds: 0, finished: false, talks: [] };
    assert.deepEqual(Store.normalizeStore(null), empty);
    assert.deepEqual(Store.normalizeStore('строка'), empty);
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: -7 }), empty);
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: 'нет' }), empty);
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: Infinity }), empty);
    assert.deepEqual(Store.normalizeStore({ overrunSeconds: 5.7 }), { overrunSeconds: 5, finished: false, talks: [] });
    assert.deepEqual(
        Store.normalizeStore({ overrunSeconds: 5, finished: 'да' }),
        { overrunSeconds: 5, finished: true, talks: [] }
    );
});

test('запись в несуществующий каталог не бросает, а сообщает логгеру', () => {
    const logged = [];
    const logger = { error: (...args) => logged.push(args) };
    Store.saveStore(path.join(tempDir(), 'нет', 'такого'), { overrunSeconds: 1, finished: false }, logger);
    assert.equal(logged.length, 1, 'ошибка записи обязана быть замечена, а не проглочена молча');
});

// --- Журнал докладов -------------------------------------------------------
//
// Рядом с итогом хранится разбивка: чем закончился каждый доклад. Итог при
// этом остаётся НЕЗАВИСИМЫМ числом, и это не дублирование: он обязан быть
// верным даже там, где разбивка неполна — после миграции старого файла и при
// переполнении потолка записей. За деньги отвечает итог.

test('normalizeStore: старый файл без talks читается с сохранением итога', () => {
    // Миграция. Выдумывать записи задним числом нельзя, терять итог — тем
    // более: у человека это деньги, которые он объявил залу.
    const out = Store.normalizeStore({ overrunSeconds: 461, finished: true });
    assert.strictEqual(out.overrunSeconds, 461);
    assert.strictEqual(out.finished, true);
    assert.deepStrictEqual(out.talks, []);
});

test('normalizeStore: мусор в talks отбрасывается по одной записи', () => {
    const out = Store.normalizeStore({
        overrunSeconds: 10,
        talks: [
            { n: 1, endedAt: '2026-09-09T14:32:10.000Z', overrunSeconds: 135 },
            null,
            { n: 2, endedAt: 'не дата', overrunSeconds: 5 },
            { n: 3, endedAt: '2026-09-09T15:00:00.000Z', overrunSeconds: -7 },
            { n: 4, endedAt: '2026-09-09T15:00:00.000Z', overrunSeconds: 'нет' },
            'строка'
        ]
    });
    assert.strictEqual(out.talks.length, 1, 'выжить обязана только целая запись');
    assert.strictEqual(out.talks[0].overrunSeconds, 135);
});

test('normalizeStore: доклад, уложившийся в срок, — законная запись с нулём', () => {
    // До 10.09.2026 ноль здесь считался мусором: журнал перечислял только
    // доклады с перелимитом, потому что про остальные приложение не знало.
    // Теперь знает (конец доклада — возврат запущенного таймера в покой), и
    // выбросить ноль при чтении значило бы молча стереть уложившиеся доклады
    // при каждом перезапуске.
    const out = Store.normalizeStore({
        overrunSeconds: 135,
        talks: [
            { n: 1, endedAt: '2026-09-09T14:00:00.000Z', overrunSeconds: 0 },
            { n: 2, endedAt: '2026-09-09T14:32:10.000Z', overrunSeconds: 135 }
        ]
    });
    assert.deepStrictEqual(out.talks.map((t) => t.overrunSeconds), [0, 135]);
    assert.strictEqual(out.overrunSeconds, 135, 'нули на итог не влияют');
});

test('normalizeStore: talks не массив — пустой журнал, итог цел', () => {
    const out = Store.normalizeStore({ overrunSeconds: 42, talks: 'нет' });
    assert.strictEqual(out.overrunSeconds, 42);
    assert.deepStrictEqual(out.talks, []);
});

test('normalizeStore: номер — это позиция, а не то, что записано в файле', () => {
    const out = Store.normalizeStore({
        overrunSeconds: 20,
        talks: [
            { n: 7, endedAt: '2026-09-09T10:00:00.000Z', overrunSeconds: 10 },
            { n: 7, endedAt: '2026-09-09T11:00:00.000Z', overrunSeconds: 10 }
        ]
    });
    assert.deepStrictEqual(out.talks.map((t) => t.n), [1, 2]);
});

test('normalizeStore: потолок записей не роняет ИТОГ', () => {
    const many = [];
    for (let i = 0; i < Store.MAX_TALKS + 50; i++) {
        many.push({ n: i + 1, endedAt: '2026-09-09T10:00:00.000Z', overrunSeconds: 1 });
    }
    const out = Store.normalizeStore({ overrunSeconds: 999, talks: many });
    assert.strictEqual(out.talks.length, Store.MAX_TALKS, 'журнал обрезается');
    assert.strictEqual(out.overrunSeconds, 999, 'итог обязан пережить обрезку журнала');
    assert.strictEqual(out.talks[0].n, 1, 'после обрезки нумерация снова с единицы');
});

test('журнал переживает запись и чтение с диска', () => {
    const dir = tempDir();
    try {
        Store.saveStore(dir, {
            overrunSeconds: 135,
            finished: false,
            talks: [{ n: 1, endedAt: '2026-09-09T14:32:10.000Z', overrunSeconds: 135 }]
        });
        const back = Store.loadStore(dir);
        assert.strictEqual(back.talks.length, 1);
        assert.strictEqual(back.talks[0].endedAt, '2026-09-09T14:32:10.000Z');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
