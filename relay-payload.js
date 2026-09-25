'use strict';

/**
 * relay-payload.js — что главный процесс соглашается ЗАПОМНИТЬ и разослать
 * (SEC-10).
 *
 * Каналы-ретрансляторы (цвета, стиль виджета, настройки дисплея и часов) не
 * просто передают сообщение: они кладут его в `last*` и досылают каждому окну
 * при открытии. Поэтому непроверенный payload становился постоянным — строка
 * в сотни мегабайт жила в памяти главного процесса и заново уходила в окно на
 * каждом открытии, а объект с неожиданной формой ломал окно, которое его
 * получало, уже после перезапуска панели.
 *
 * Все эти payload'ы сегодня ПЛОСКИЕ: ключ → строка/число/булево/null (сборки в
 * panel-display.js, panel-state.js, panel-colors.js, clock-settings-schema.js).
 * Поэтому правило одно на всех: плоский объект примитивов, лишнее — отбросить
 * по ключу, слишком большое — отвергнуть целиком. Обрезать картинку или цвет
 * нельзя: обрезанное значение — ДРУГОЕ значение, и окно показало бы его как
 * настоящее. Единственное исключение — название мероприятия: у поля в панели
 * `maxlength="60"`, и обрезка повторяет её, а не придумывает новое значение.
 *
 * Модуль чистый: проверяет tests/relay-payload.test.js.
 */

const CONFIG = require('./constants');

// Сверх этого числа символов payload не принимается. Считаются ключи и
// строки; число/булево/null — по 8, как их след в памяти.
const RELAY_LIMITS = Object.freeze({
    // В настройках дисплея едет картинка фона: local-background.js пускает
    // файл до MAX_IMAGE_FILE_SIZE (10 МБ), base64 — это 4/3 от байтов (~13,4 М
    // символов) плюс префикс data URL и остальные поля. Полтора мегабайта
    // запаса — на поля и на префикс, а не на второй файл.
    'display-settings-update': Math.ceil(CONFIG.MAX_IMAGE_FILE_SIZE / 3) * 4 + 1536 * 1024,
    // Остальным хватает с большим запасом: самый крупный — настройки дисплея
    // без картинки, это сотни символов.
    default: 64 * 1024
});

const MAX_KEYS = 200;
const EVENT_TITLE_MAX = 60;
// Стиль часов едет голой строкой ('circle', 'flip', …). Список стилей знает
// окно (и переводит старые имена), поэтому здесь — только форма.
const STYLE_NAME_MAX = 32;

// Эти имена, присвоенные обычному объекту, меняют не поле, а сам объект.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const OBJECT_CHANNELS = new Set([
    'widget-colors-update',
    'clock-colors-update',
    'display-colors-update',
    'widget-style-update',
    'display-settings-update',
    'clock-widget-settings'
]);

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { return false; }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function isPrimitive(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') { return true; }
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {object|string|null} проверенная копия или null — «не принимать»
 */
function sanitizeRelayPayload(channel, payload) {
    if (channel === 'clock-widget-set-style') {
        return typeof payload === 'string' && payload.length > 0 && payload.length <= STYLE_NAME_MAX
            ? payload : null;
    }
    if (!OBJECT_CHANNELS.has(channel)) {
        throw new Error(`relay-payload: для канала «${channel}» нет правила`);
    }
    if (!isPlainObject(payload)) { return null; }

    const keys = Object.keys(payload);
    if (keys.length > MAX_KEYS) { return null; }

    const limit = RELAY_LIMITS[channel] || RELAY_LIMITS.default;
    const out = {};
    let size = 0;
    for (const key of keys) {
        if (FORBIDDEN_KEYS.has(key)) { continue; }
        let value = payload[key];
        if (!isPrimitive(value)) { continue; }
        if (key === 'eventTitle' && typeof value === 'string') {
            value = value.slice(0, EVENT_TITLE_MAX);
        }
        size += key.length + (typeof value === 'string' ? value.length : 8);
        if (size > limit) { return null; }
        out[key] = value;
    }
    return out;
}

/**
 * Запомнить настройки дисплея, не теряя картинку фона (BUG-10).
 *
 * Панель слала весь фон — до ~13 М символов base64 — на каждое нажатие
 * клавиши в названии мероприятия и каждый шаг ползунка. Теперь `bgLocalImage`
 * едет только при СМЕНЕ: ключа нет — «без изменений», пустая строка —
 * «картинки нет». Главный процесс помнит последнюю, потому что досылает
 * настройки окну, открытому позже, и оно обязано получить фон целиком.
 */
function mergeDisplaySettings(prev, incoming) {
    const out = Object.assign({}, incoming);
    const hasOwn = Object.prototype.hasOwnProperty;
    if (!hasOwn.call(out, 'bgLocalImage') && prev && hasOwn.call(prev, 'bgLocalImage')) {
        out.bgLocalImage = prev.bgLocalImage;
    }
    return out;
}

/**
 * Те же настройки без картинки — для окон, которые фона дисплея не рисуют
 * (виджет, часы): им эти мегабайты незачем ни по каналу, ни в памяти окна.
 */
function withoutBgImage(settings) {
    if (!settings) { return settings; }
    const out = Object.assign({}, settings);
    delete out.bgLocalImage;
    return out;
}

/**
 * Payload канала — объект (а не null, строка или число).
 *
 * Самая первая проверка любого обработчика главного процесса, читающего поля
 * payload: `payload = {}` спасает только от undefined, а явный null доходил до
 * деструктуризации и ронял обработчик. Живёт здесь, а не в одном из модулей
 * main-*.js, потому что её зовут все: геометрия, таймер, окна, ретрансляторы.
 */
function isPayloadObject(payload) {
    return payload !== null && typeof payload === 'object';
}

module.exports = {
    sanitizeRelayPayload, RELAY_LIMITS, EVENT_TITLE_MAX, mergeDisplaySettings, withoutBgImage, isPayloadObject
};
