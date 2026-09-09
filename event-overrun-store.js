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
 * Вход недоверенный так же, как и весь файл. Запись без положительного
 * перелимита выбрасывается: журнал перечисляет доклады, которые ВЫШЛИ за
 * время, и строка «0 секунд» в нём означала бы, что приложение знает про
 * доклады, уложившиеся в срок, — а оно про них не знает (отдельного сигнала
 * «доклад начался» в приложении нет).
 */
function normalizeTalk(raw) {
    if (raw === null || typeof raw !== 'object') { return null; }
    const seconds = Number(raw.overrunSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) { return null; }
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
    return {
        overrunSeconds: seconds,
        finished: !!data.finished,
        talks: normalizeTalks(data.talks)
    };
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
function saveStore(userDataPath, state, logger) {
    try {
        fs.writeFileSync(getStorePath(userDataPath), JSON.stringify(normalizeStore(state)));
    } catch (err) {
        if (logger && logger.error) { logger.error('saveStore failed:', err); }
    }
}

module.exports = {
    STORE_FILENAME,
    MAX_TALKS,
    getStorePath,
    normalizeStore,
    loadStore,
    saveStore
};
