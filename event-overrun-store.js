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

function getStorePath(userDataPath) {
    return path.join(userDataPath, STORE_FILENAME);
}

/**
 * Приведение прочитанного к смыслу. Вход недоверенный: файл мог быть обрезан
 * падением или отредактирован руками.
 */
function normalizeStore(data) {
    const empty = { overrunSeconds: 0, finished: false };
    if (data === null || typeof data !== 'object') { return empty; }
    const raw = Number(data.overrunSeconds);
    const seconds = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    return { overrunSeconds: seconds, finished: !!data.finished };
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
        return { overrunSeconds: 0, finished: false };
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
    getStorePath,
    normalizeStore,
    loadStore,
    saveStore
};
