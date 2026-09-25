'use strict';

/**
 * Что каждое окно ДЕЙСТВИТЕЛЬНО шлёт и слушает — по исходникам его страницы и
 * подключённых к ней модулей.
 *
 * Общий сканер для двух сверок: таблица отправителей главного процесса
 * (tests/ipc-senders.test.js) и списки мостов окон (tests/preload-channels.test.js).
 * Обе обязаны видеть окно одинаково: иначе одна из них была бы зелёной на том,
 * что другая считает дырой.
 *
 * Сканер НЕ фильтрует по известным каналам: отправка канала, которого нет ни в
 * одной таблице, тоже должна попасть в результат — иначе сверка «окно шлёт
 * только разрешённое» не увидела бы как раз новый, забытый канал.
 */

const fs = require('node:fs');
const path = require('node:path');
const { codeOnly, maskNonCode, balancedBlockAt, afterBalanced } = require('./source-scan');
const { WINDOW_OWN, readSource } = require('./window-source');

const repoRoot = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const PAGES = Object.freeze({
    control: 'electron-control.html',
    widget: 'electron-widget.html',
    clock: 'electron-clock-widget.html',
    display: 'display.html'
});

// Страница и её <script src> по отдельности: подписка внутри общей функции
// модуля (bindLockSync) считается окну, только если окно эту функцию зовёт.
// Страница — вместе со СВОИМИ файлами (widget-app.js…, tests/helpers/window-source.js):
// до 25.09.2026 это был её inline-<script>, и он остаётся кодом страницы.
function roleFiles(role) {
    const html = readSource(PAGES[role]);
    const own = WINDOW_OWN[PAGES[role]];
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
        .filter((f) => !own.includes(f));
    return [
        { file: PAGES[role], code: codeOnly(html), page: true },
        ...srcs.map((f) => ({ file: f, code: codeOnly(read(f)), page: false }))
    ];
}

// Выражение канала — первый аргумент до запятой верхнего уровня. Литералы в
// нём — это канал (или две ветки тернарника «открыть/закрыть»); литералы
// дальше — полезная нагрузка (`send('timer-control', 'pause')`).
function channelExpr(args) {
    let depth = 0;
    let quote = null;
    for (let i = 0; i < args.length; i++) {
        const ch = args[i];
        if (quote) { if (ch === quote) { quote = null; } continue; }
        if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
        if (ch === '(' || ch === '{' || ch === '[') { depth++; }
        if (ch === ')' || ch === '}' || ch === ']') { depth--; }
        if (ch === ',' && depth === 0) { return args.slice(0, i); }
    }
    return args;
}

function sentBy(role) {
    const out = new Set();
    for (const { code } of roleFiles(role)) {
        for (const m of code.matchAll(/\bsend\(([^)]*)/g)) {
            for (const lit of channelExpr(m[1]).matchAll(/['"`]([^'"`]+)['"`]/g)) { out.add(lit[1]); }
        }
        // window-geometry.js шлёт поля конфига: send(channels.move, …).
        for (const m of code.matchAll(/\b(?:move|resize|position):\s*['"`]([a-z-]+)['"`]/g)) {
            out.add(m[1]);
        }
    }
    return out;
}

// Функция верхнего уровня (`function имя(` с начала строки), ТЕЛО которой
// содержит позицию. Границы — по балансу скобок, а не «последнее объявление
// выше»: иначе подписка в методе примеси приписалась бы соседней функции.
function enclosingTopLevelFunction(code, index) {
    const mask = maskNonCode(code);
    for (const m of code.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
        if (m.index > index) { break; }
        const afterParams = afterBalanced(mask, m.index + m[0].length - 1, '(', ')', m[1]);
        const end = m.index + balancedBlockAt(code, m.index, m[1], afterParams).length;
        if (index < end) { return m[1]; }
    }
    return null;
}

function receivedBy(role) {
    const files = roleFiles(role);
    const out = new Set();
    for (const { file, code, page } of files) {
        for (const m of code.matchAll(/\b(?:ipcRenderer|ipc|electronAPI)\.(?:on|once)\(\s*['"`]([^'"`]+)['"`]/g)) {
            if (!page) {
                const fn = enclosingTopLevelFunction(code, m.index);
                if (fn) {
                    const callRe = new RegExp(`\\b${fn}\\(`);
                    const called = files.some((f) => f.file !== file && callRe.test(f.code));
                    if (!called) { continue; }
                }
            }
            out.add(m[1]);
        }
    }
    return out;
}

/**
 * Окна, в мосте которых канал открыт в направлении `dir` ('send' | 'receive').
 * Таблица в preload.js сгенерирована из тех же SENDERS/RECEIVERS, её свежесть —
 * tests/preload-channels.test.js, поэтому проверять канал можно по источнику.
 */
function bridgeRoles(channel, dir) {
    const { ROLES, channelsFor } = require('../../ipc-senders');
    return ROLES.filter((r) => channelsFor(r)[dir].includes(channel));
}

module.exports = { PAGES, sentBy, receivedBy, bridgeRoles };
