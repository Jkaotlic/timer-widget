'use strict';

/**
 * relay-store.js — память ретрансляторов главного процесса в файле
 * `userData/relay-state.json`.
 *
 * Зачем. Главный процесс помнит последние настройки окон (`relay.*`,
 * main-state.js), чтобы дослать их окну, открытому позже. До 29.10.2026 эта
 * память жила только в процессе: после запуска она была пуста, пока панель не
 * дошлёт настройки таймерами 200/500/600 мс (control-app.js). В этот зазор
 * виджет вставал поверх окон вопреки выключенной настройке, выгрузка CSV брала
 * ставку и название из пустого объекта, а окно, открытое из трея, получало
 * неполный снимок.
 *
 * Что хранится: цвета трёх окон, стиль виджета, настройки дисплея БЕЗ картинки
 * фона (она до ~13 МБ и живёт в localStorage окна), настройки часов. Тема и
 * замок — нет (почему — в комментарии над CLOCK_SETTINGS_KEYS). Индекс монитора дисплея
 * не хранится — это выбор на одно открытие.
 *
 * Панель остаётся источником правды: её посылки на старте перезаписывают
 * память, как и раньше. Файл только закрывает зазор до них.
 *
 * Файл — НЕДОВЕРЕННЫЙ вход (сбой, ручная правка, другая версия). Правило то же,
 * что у живого канала (relay-payload.js): плоские примитивы, потолок размера,
 * лишнее отброшено по ключу. Битое → пустая память и строка в журнал, не
 * исключение. Старая версия приложения файл просто не читает.
 *
 * Модуль без Electron: путь профиля и журнал приходят параметрами
 * (tests/relay-store.test.js).
 */

const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync } = require('./atomic-write');
const { sanitizeRelayPayload, withoutBgImage } = require('./relay-payload');

const RELAY_STATE_FILE = 'relay-state.json';
// Формат файла. Чужая версия читается как «файла нет»: угадывать смысл полей
// другой версии опаснее, чем подождать 600 мс до посылки панели.
const RELAY_STATE_VERSION = 1;
// Шесть объектов по 64 К символов (потолок relay-payload) — с запасом. Больше
// — не наш файл, и в память целиком он не читается.
const MAX_FILE_BYTES = 512 * 1024;
// Склейка: панель шлёт настройки на каждое нажатие клавиши и шаг ползунка.
const DEFAULT_DELAY_MS = 500;

// Поле памяти → канал, по правилу которого оно проверяется.
const OBJECT_FIELDS = Object.freeze({
    lastWidgetColors: 'widget-colors-update',
    lastClockColors: 'clock-colors-update',
    lastDisplayColors: 'display-colors-update',
    lastWidgetStyle: 'widget-style-update',
    lastDisplaySettings: 'display-settings-update',
    lastClockSettings: 'clock-widget-settings'
});
// Тема и замок (relay.uiTheme / relay.uiLocked) в файл НЕ идут намеренно.
// Окна читают их сами из localStorage в <head>, а досланный из файла
// устаревший замок окно, открытое до посылки панели, записало бы в общий
// профиль (ui-lock.js, writeLock) — значение файла стало бы настройкой.
// Снимок main несёт их только после посылки панели в ЭТОЙ сессии.

// Настройки часов НАКАПЛИВАЮТСЯ слиянием (main-relay-ipc.js), и с файлом
// накопление пережило бы перезапуски: ключ, который панель перестала слать,
// жил бы вечно. Из файла читаются только известные ключи: таблица
// clock-settings-schema.js плюс showTicks, который pushClockSettings
// (panel-clock.js) шлёт сверх таблицы.
const CLOCK_SETTINGS_KEYS = new Set(
    require('./clock-settings-schema').CLOCK_SETTINGS.map((row) => row.key).concat(['showTicks'])
);

function onlyKnownClockKeys(settings) {
    const out = {};
    for (const [key, value] of Object.entries(settings)) {
        if (CLOCK_SETTINGS_KEYS.has(key)) { out[key] = value; }
    }
    return out;
}

function getRelayStatePath(userDataPath) {
    return path.join(userDataPath, RELAY_STATE_FILE);
}

/** Что из памяти уходит в файл. Пустые поля (null) не пишутся. */
function relaySnapshot(relay) {
    const out = {};
    for (const field of Object.keys(OBJECT_FIELDS)) {
        const value = relay[field];
        if (value === null || value === undefined) { continue; }
        out[field] = field === 'lastDisplaySettings' ? withoutBgImage(value) : value;
    }
    return out;
}

function serializeRelayState(relay) {
    return JSON.stringify({ version: RELAY_STATE_VERSION, relay: relaySnapshot(relay) });
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Разбор текста файла.
 *
 * @param {string} text
 * @returns {object|null} проверенные поля памяти или null — «формат не наш»
 */
function parseRelayState(text) {
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (!isPlainObject(data) || data.version !== RELAY_STATE_VERSION || !isPlainObject(data.relay)) {
        return null;
    }
    const src = data.relay;
    const own = (key) => Object.prototype.hasOwnProperty.call(src, key);
    const out = {};
    for (const [field, channel] of Object.entries(OBJECT_FIELDS)) {
        if (!own(field)) { continue; }
        const clean = sanitizeRelayPayload(channel, src[field]);
        if (clean === null) { continue; }
        // Картинки в файле быть не должно; оказавшаяся там — отбрасывается:
        // «ключа нет» у дисплея значит «без изменений», и своя копия окна цела.
        if (field === 'lastDisplaySettings') { out[field] = withoutBgImage(clean); }
        else if (field === 'lastClockSettings') { out[field] = onlyKnownClockKeys(clean); }
        else { out[field] = clean; }
    }
    return out;
}

/** Код ошибки без пути: сообщение fs несёт путь профиля, а в нём имя учётной записи (SEC-11). */
function errorCode(err) {
    return (err && (err.code || err.name)) || 'ошибка';
}

/**
 * Прочитать файл в память. Никогда не бросает: старт с пустой памятью лучше,
 * чем приложение, которое не открывается.
 */
function loadRelayState(userDataPath, relay, log) {
    const file = getRelayStatePath(userDataPath);
    let text;
    try {
        const stat = fs.statSync(file);
        if (stat.size > MAX_FILE_BYTES) {
            log.warn(`[relay-state] файл больше ${MAX_FILE_BYTES} байт — не читается`);
            return;
        }
        text = fs.readFileSync(file, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') { return; }
        log.warn(`[relay-state] файл не прочитан: ${errorCode(err)}`);
        return;
    }
    const fields = parseRelayState(text);
    if (fields === null) {
        log.warn('[relay-state] формат не распознан — старт с пустой памятью');
        return;
    }
    for (const [field, value] of Object.entries(fields)) { relay[field] = value; }
    log.info(`[relay-state] память восстановлена: ${Object.keys(fields).join(', ') || 'пусто'}`);
}

/** Записать память атомарно (бросает — ловит createRelayPersister). */
function writeRelayState(userDataPath, relay) {
    writeFileAtomicSync(getRelayStatePath(userDataPath), serializeRelayState(relay));
}

/** Удалить файл. Его могло и не быть. */
function deleteRelayState(userDataPath) {
    try { fs.unlinkSync(getRelayStatePath(userDataPath)); } catch { /* его могло и не быть */ }
}

/**
 * Обвязка для главного процесса: чтение на старте, склеенная запись, запись
 * на выходе, удаление при сбросе.
 *
 * @param {object} deps
 * @param {() => string} deps.getUserDataPath — app.getPath('userData')
 * @param {object} deps.relay — память ретрансляторов (main-state.js)
 * @param {object} deps.log
 * @param {number} [deps.delayMs]
 * @param {Function} [deps.setTimer] - подменяется в тестах
 * @param {Function} [deps.clearTimer]
 * @param {Function} [deps.write] - writeRelayState, подменяется в тестах
 * @param {boolean} [deps.disabled] - стенд съёмки: не читать и не писать
 *        (кадр не зависит от прошлого прогона); сброс файл всё равно удаляет
 */
function createRelayPersister({
    getUserDataPath, relay, log, disabled = false,
    delayMs = DEFAULT_DELAY_MS,
    setTimer = setTimeout, clearTimer = clearTimeout,
    write = writeRelayState
}) {
    let timer = null;
    // Последний записанный (или прочитанный) текст: тот же снимок второй раз
    // диск не трогает — панель на старте присылает ровно то, что уже лежит.
    let lastWritten = null;
    // После «Сбросить всё» память в файл больше не пишется: выход
    // (before-quit) иначе воскресил бы только что удалённое.
    let discarded = !!disabled;
    // Пока файл не прочитан, память в него не пишется: процесс, не читавший
    // файл (второй экземпляр, выходящий сразу), стёр бы его пустой памятью.
    let loaded = false;

    function cancel() {
        if (timer !== null) { clearTimer(timer); timer = null; }
    }

    function flush() {
        cancel();
        if (discarded || !loaded) { return; }
        const text = serializeRelayState(relay);
        if (text === lastWritten) { return; }
        try {
            write(getUserDataPath(), relay);
            lastWritten = text;
        } catch (err) {
            log.warn(`[relay-state] память не записана: ${errorCode(err)}`);
        }
    }

    function schedule() {
        if (discarded || !loaded || timer !== null) { return; }
        timer = setTimer(() => { timer = null; flush(); }, delayMs);
        // Таймер не держит процесс: на выходе запись делает flush().
        if (timer && typeof timer.unref === 'function') { timer.unref(); }
    }

    function loadOnStart() {
        if (disabled) { return; }
        loadRelayState(getUserDataPath(), relay, log);
        lastWritten = serializeRelayState(relay);
        loaded = true;
    }

    function discard() {
        cancel();
        discarded = true;
        deleteRelayState(getUserDataPath());
    }

    return { loadOnStart, schedule, flush, discard };
}

module.exports = {
    RELAY_STATE_FILE, RELAY_STATE_VERSION, MAX_FILE_BYTES, DEFAULT_DELAY_MS,
    getRelayStatePath, relaySnapshot, serializeRelayState, parseRelayState,
    loadRelayState, writeRelayState, deleteRelayState, createRelayPersister
};
