'use strict';

/**
 * channel-validator.js — ВИД на таблицы ipc-senders.js: все каналы приложения
 * по направлениям, без разбивки по окнам.
 *
 * До 25.09.2026 здесь жил рукописный белый список, и его копия — в preload.js.
 * Теперь источник один: SENDERS (кто шлёт) и RECEIVERS (кто слушает) в
 * ipc-senders.js. Мост окна получает из них СВОЮ строку
 * (scripts/preload-channels.js), а этот модуль — объединение всех строк для
 * проверок «у канала есть оба конца» (tests/ipc-liveness.test.js).
 * В рендерер модуль не грузится и в сборку не входит.
 */

const { SENDERS, RECEIVERS } = require('./ipc-senders');

const ALLOWED_CHANNELS = Object.freeze({
    send: Object.freeze(Object.keys(SENDERS)),
    receive: Object.freeze(Object.keys(RECEIVERS))
});

/**
 * @param {string} channel - Channel name
 * @param {string} direction - 'send' or 'receive'
 * @returns {boolean}
 */
function isValidChannel(channel, direction) {
    if (!channel || typeof channel !== 'string') { return false; }
    if (direction !== 'send' && direction !== 'receive') { return false; }
    return ALLOWED_CHANNELS[direction].includes(channel);
}

module.exports = { isValidChannel, ALLOWED_CHANNELS };
