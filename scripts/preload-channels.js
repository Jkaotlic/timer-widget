#!/usr/bin/env node
'use strict';

/**
 * preload-channels.js — вписывает в preload.js каналы каждого окна.
 *
 *   node scripts/preload-channels.js           сверить (по умолчанию, = --check)
 *   node scripts/preload-channels.js --write   переписать блок в preload.js
 *   npm run preload:channels -- --write        то же через npm
 *
 * Зачем генератор. Источник таблицы — SENDERS и RECEIVERS в ipc-senders.js,
 * но preload работает в песочнице (sandbox: true), где `require` грузит ТОЛЬКО
 * `electron` (docs/tutorial/sandbox.md): прочитать ipc-senders.js мост не может.
 * Рукописная копия расходилась бы с источником — так и жили два белых списка
 * до 25.09.2026. Поэтому копия генерируется, а tests/preload-channels.test.js
 * падает, если она отстала.
 *
 * Почему один preload с таблицей всех окон, а не четыре файла. Окно выбирает
 * свою строку по роли из `process.argv` (главный процесс передаёт её через
 * `webPreferences.additionalArguments`, main-windows.js). Роль задаёт главный
 * процесс до запуска рендерера — страница её не подменит; без роли мост закрыт
 * целиком. Четыре файла дали бы то же самое ценой трёх лишних файлов в сборке
 * (build.files, verify-packed) и четырёх копий кода моста.
 */

const fs = require('fs');
const path = require('path');
const { ROLES, ROLE_ARG_PREFIX, channelsFor } = require('../ipc-senders');

const PRELOAD = path.join(__dirname, '..', 'preload.js');
const BEGIN = '// <preload-channels> — сгенерировано scripts/preload-channels.js из ipc-senders.js, руками не править';
const END = '// </preload-channels>';

function renderBlock() {
    const q = (ch) => `'${ch}'`;
    const list = (xs) => (xs.length ? `[\n            ${xs.map(q).join(',\n            ')}\n        ]` : '[]');
    const rows = ROLES.map((role) => {
        const own = channelsFor(role);
        return `    ${role}: Object.freeze({\n        send: ${list(own.send)},\n        receive: ${list(own.receive)}\n    })`;
    });
    return [
        `const ROLE_ARG_PREFIX = '${ROLE_ARG_PREFIX}';`,
        'const CHANNELS_BY_ROLE = Object.freeze({',
        rows.join(',\n'),
        '});'
    ].join('\n');
}

function markers(src) {
    const b = src.indexOf(BEGIN);
    const e = src.indexOf(END);
    if (b === -1 || e === -1 || e < b) { throw new Error('preload-channels: маркер блока не найден в preload.js'); }
    return { from: b + BEGIN.length + 1, to: e - 1 };
}

function extractBlock(src) {
    const { from, to } = markers(src);
    return src.slice(from, to);
}

function replaceBlock(src, block) {
    const { from, to } = markers(src);
    return src.slice(0, from) + block + src.slice(to);
}

function main(argv) {
    const src = fs.readFileSync(PRELOAD, 'utf8');
    const fresh = renderBlock();
    if (argv.includes('--write')) {
        const next = replaceBlock(src, fresh);
        if (next !== src) { fs.writeFileSync(PRELOAD, next); }
        console.log(next === src ? 'preload.js: таблица каналов уже актуальна' : 'preload.js: таблица каналов обновлена');
        return 0;
    }
    if (extractBlock(src) !== fresh) {
        console.error('preload.js: таблица каналов отстала от ipc-senders.js — npm run preload:channels -- --write');
        return 1;
    }
    console.log('preload.js: таблица каналов актуальна');
    return 0;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { BEGIN, END, renderBlock, extractBlock, replaceBlock };
