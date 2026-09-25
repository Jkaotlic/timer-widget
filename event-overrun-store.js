'use strict';

/**
 * event-overrun-store.js — накопитель перелимита мероприятия на диске.
 *
 * Хранится ОДНО непересчитываемое число: секунды перелимита закрытых
 * докладов. Всё остальное (обе суммы в рублях) выводится из него, ставки и
 * состояния таймера, поэтому на диск не попадает.
 *
 * Секунды, а не рубли: ставка, поправленная посреди мероприятия, обязана
 * пересчитать уже накопленное — иначе итог собран из двух прейскурантов.
 *
 * Почему не recovery.js: там MAX_AGE_MS = 5 минут, и запись старше пяти минут
 * отбрасывается. Для мероприятия на два часа это означало бы обнуление итога
 * при перезапуске. Здесь срока годности нет.
 *
 * Путь к userData приходит параметром — модуль не импортирует Electron и
 * проверяется в голом `node --test`.
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync } = require('./atomic-write');

const STORE_FILENAME = 'event-overrun.json';

/**
 * Потолок длины журнала докладов.
 *
 * Одно мероприятие — это десятки докладов, а не сотни; 500 — защита от
 * бесконечного роста файла, который пишется СИНХРОННО (см. saveStore ниже).
 * При переполнении отбрасываются самые старые записи, и это безопасно ровно
 * потому, что итог мероприятия живёт ОТДЕЛЬНЫМ числом: обрезанная разбивка не
 * делает итог неверным, а неверный итог — это деньги, объявленные залу.
 */
const MAX_TALKS = 500;

function getStorePath(userDataPath) {
    return path.join(userDataPath, STORE_FILENAME);
}

/**
 * Одна запись журнала или null, если запись не имеет смысла.
 *
 * Вход недоверенный так же, как и весь файл. Ноль — ЗАКОННАЯ запись: доклад,
 * уложившийся в срок. До 10.09.2026 ноль здесь выбрасывался, потому что про
 * такие доклады приложение не знало; теперь конец доклада фиксируется при
 * возврате запущенного таймера в покой, и выбросить ноль при чтении значило
 * бы молча стирать уложившиеся доклады на каждом перезапуске. Отрицательное и
 * нечисловое по-прежнему мусор.
 */
function normalizeTalk(raw) {
    if (raw === null || typeof raw !== 'object') { return null; }
    const seconds = Number(raw.overrunSeconds);
    if (!Number.isFinite(seconds) || seconds < 0) { return null; }
    const endedAt = typeof raw.endedAt === 'string' ? raw.endedAt : '';
    if (!endedAt || Number.isNaN(Date.parse(endedAt))) { return null; }
    return { endedAt, overrunSeconds: Math.floor(seconds) };
}

/**
 * Журнал целиком: мусор отброшен, длина обрезана, номера расставлены.
 *
 * Номер — это ПОЗИЦИЯ доклада в мероприятии, а не то, что записано в файле.
 * Файл могли отредактировать руками, а после обрезки журнала нумерация обязана
 * снова читаться подряд: отчёт со строками 51, 52, 53 выглядит как потерянные
 * пятьдесят докладов, хотя их секунды целы в итоге.
 */
function normalizeTalks(raw) {
    if (!Array.isArray(raw)) { return []; }
    const clean = [];
    for (const item of raw) {
        const talk = normalizeTalk(item);
        if (talk) { clean.push(talk); }
    }
    return clean.slice(-MAX_TALKS).map((talk, i) => ({
        n: i + 1,
        endedAt: talk.endedAt,
        overrunSeconds: talk.overrunSeconds
    }));
}

/**
 * Приведение прочитанного к смыслу. Вход недоверенный: файл мог быть обрезан
 * падением или отредактирован руками.
 *
 * Итог и журнал независимы намеренно. Старый файл (до появления журнала) даёт
 * итог без разбивки — и это честный ответ «сколько накопилось, знаю; чем
 * именно, не знаю», а не повод потерять накопленное.
 */
function normalizeStore(data) {
    const empty = { overrunSeconds: 0, finished: false, talks: [] };
    if (data === null || typeof data !== 'object') { return empty; }
    const raw = Number(data.overrunSeconds);
    const seconds = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    const store = {
        overrunSeconds: seconds,
        finished: !!data.finished,
        talks: normalizeTalks(data.talks)
    };
    // Замороженному итогу живой перелимит не принадлежит (как и в памяти:
    // accrueOverrun после «Завершить» его не копит).
    const pending = store.finished ? null : normalizePending(data.pending);
    if (pending) { store.pending = pending; }
    return store;
}

/**
 * Живой перелимит, записанный краш-обработчиком (BUG-04), или null.
 *
 * Секунды текущего минуса в итог не входят, пока доклад не кончился, — и
 * сбой посреди перелимита терял их целиком. Сложить их в итог прямо в
 * обработчике нельзя: после uncaughtException процесс может жить дальше, и
 * следующий тик посчитал бы те же секунды ещё раз. Поэтому они пишутся
 * РЯДОМ с итогом и складываются в него при следующем запуске (foldPending).
 *
 * `talkSeconds` — перелимит всего прерванного доклада (для строки журнала);
 * null — доклад строки не получает (отсечён «Новым мероприятием»).
 */
function normalizePending(raw) {
    if (raw === null || typeof raw !== 'object') { return null; }
    const live = Number(raw.liveSeconds);
    if (!Number.isFinite(live) || live <= 0) { return null; }
    const endedAt = typeof raw.endedAt === 'string' && !Number.isNaN(Date.parse(raw.endedAt))
        ? raw.endedAt : null;
    const talk = raw.talkSeconds === null || raw.talkSeconds === undefined ? null : Number(raw.talkSeconds);
    return {
        liveSeconds: Math.floor(live),
        talkSeconds: Number.isFinite(talk) && talk >= 0 ? Math.floor(talk) : null,
        endedAt
    };
}

/**
 * Свернуть pending в итог — ровно один раз, на запуске.
 *
 * Два исхода, и различает их то, поднял ли запуск таймер из снимка
 * восстановления:
 *  - не поднял (снимок протух, выход был не падением) — доклад кончился
 *    вместе с процессом: секунды в итог, строка в журнал;
 *  - поднял в минусе — доклад продолжается. Секунды в итог, но минус
 *    восстановленного таймера уже посчитан в них, поэтому он становится
 *    отсечкой (excludedLiveSeconds) — иначе дисплей и конец доклада сложили
 *    бы его второй раз. Строки нет: её допишет конец доклада, с перелимитом
 *    из resumeTalk.
 *
 * @param {object} store — результат normalizeStore
 * @param {{restoredRemaining: number|null}} opts — остаток поднятого таймера
 * @returns {{store: object, excludedLiveSeconds: number, resumed: boolean,
 *            resumeTalk: ({overrun: number}|null), changed: boolean}}
 */
function foldPending(store, opts = {}) {
    const pending = store && store.pending;
    const clean = Object.assign({}, store);
    delete clean.pending;
    if (!pending) {
        return { store: clean, excludedLiveSeconds: 0, resumed: false, resumeTalk: null, changed: false };
    }
    clean.overrunSeconds = store.overrunSeconds + pending.liveSeconds;
    const restored = Number(opts.restoredRemaining);
    const resumed = opts.restoredRemaining !== null && opts.restoredRemaining !== undefined
        && Number.isFinite(restored) && restored < 0;
    if (resumed) {
        return {
            store: clean,
            excludedLiveSeconds: Math.floor(-restored),
            resumed: true,
            resumeTalk: pending.talkSeconds === null ? null : { overrun: pending.talkSeconds },
            changed: true
        };
    }
    if (pending.talkSeconds !== null) {
        clean.talks = normalizeTalks(store.talks.concat([{
            // Без даты секунды не теряются: доклад датируется запуском.
            endedAt: pending.endedAt || new Date().toISOString(),
            overrunSeconds: pending.talkSeconds
        }]));
    }
    return { store: clean, excludedLiveSeconds: 0, resumed: false, resumeTalk: null, changed: true };
}

/**
 * Чтение синхронное: делается один раз на старте, до открытия окон.
 * Не бросает никогда — отсутствие файла и битый JSON дают чистое состояние.
 */
function loadStore(userDataPath, logger) {
    try {
        const raw = fs.readFileSync(getStorePath(userDataPath), 'utf8');
        return normalizeStore(JSON.parse(raw));
    } catch (err) {
        if (err && err.code !== 'ENOENT' && logger && logger.warn) {
            logger.warn('loadStore failed:', err);
        }
        return { overrunSeconds: 0, finished: false, talks: [] };
    }
}

/**
 * Запись синхронная намеренно: она случается редко (закрытие доклада,
 * завершение мероприятия, обнуление) и обязана пережить немедленный выход
 * приложения. Асинхронная запись здесь потеряла бы итог при закрытии окна
 * сразу после «Завершить мероприятие».
 */
/**
 * И атомарная (BUG-09): прямая запись поверх старого файла сначала обрезает
 * его, и сбой в этот миг оставлял битый JSON — loadStore читал его как ноль,
 * итог мероприятия пропадал. Сорвавшаяся запись теперь оставляет прежний файл.
 */
function saveStore(userDataPath, state, logger) {
    try {
        writeFileAtomicSync(getStorePath(userDataPath), JSON.stringify(normalizeStore(state)));
    } catch (err) {
        if (logger && logger.error) { logger.error('saveStore failed:', err); }
    }
}

module.exports = {
    STORE_FILENAME,
    MAX_TALKS,
    getStorePath,
    normalizeStore,
    foldPending,
    loadStore,
    saveStore
};
