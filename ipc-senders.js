'use strict';

/**
 * ipc-senders.js — КТО вправе прислать каждый канал (SEC-07).
 *
 * До 25.09.2026 белый список preload.js был один на все четыре окна: он
 * отвечал на вопрос «существует ли такой канал», но не «чей он». Виджет — или страница,
 * оказавшаяся в его окне, — мог позвать `reset-and-relaunch` (стирает весь
 * профиль), `quit-app`, `event-reset` (обнуляет деньги мероприятия). Ни один
 * обработчик в главном процессе не смотрел, откуда пришло сообщение.
 *
 * Здесь ОДНА таблица «канал → окна-отправители» и ОДНА обвязка ipcMain, через
 * которую проходит регистрация каждого обработчика. Проверка не копируется по
 * обработчикам: скопированная в сорок мест, она в сорок первом была бы забыта.
 *
 * Таблица списана с того, что окна ШЛЮТ сегодня (grep по `send(` в страницах и
 * подключённых к ним модулях), а не с того, что им «логично» слать: каждое
 * лишнее окно в строке — лишнее разрешение, каждое пропущенное — молча
 * сломанная клавиша. Трей и глобальные клавиши через IPC не ходят (зовут
 * функции главного процесса напрямую), поэтому в таблице их нет.
 *
 * Модуль чистый (без require('electron')): окно отправителя, окна по ролям и
 * предикат «своя страница» передаёт вызывающий. Так его проверяет
 * tests/ipc-senders.test.js на подставках.
 */

const ROLES = Object.freeze(['control', 'widget', 'clock', 'display']);

const ALL = ROLES;

// Канал → окна, которым разрешено его прислать.
const SENDERS = Object.freeze({
    // --- Состояние таймера ---------------------------------------------------
    // Часы состояние не запрашивают: снимок им досылает главный процесс при
    // загрузке (BUG-01). Строка — ровно те, кто шлёт: с 25.09.2026 из неё же
    // собирается мост окна, и лишнее окно здесь — открытый в нём канал.
    'get-timer-state': ['control', 'widget', 'display'],
    // Space/цифры в окнах ставят пресет и паузу этим же каналом.
    'timer-command': ALL,
    'timer-control': ['widget', 'clock', 'display'],

    // --- Настройки: владелец — панель -----------------------------------------
    'get-displays': ['control'],
    'widget-colors-update': ['control'],
    'clock-colors-update': ['control'],
    'display-colors-update': ['control'],
    'widget-style-update': ['control'],
    'display-settings-update': ['control'],
    'clock-widget-set-style': ['control'],
    'clock-widget-settings': ['control'],
    'display-layout': ['control'],
    'display-restore-state': ['control'],
    'ui-theme-update': ['control'],
    'ui-lock-update': ['control'],
    'open-releases-page': ['control'],

    // --- Окно панели ----------------------------------------------------------
    'resize-control-window': ['control'],
    'control-collapse': ['control'],
    'control-drawer': ['control'],

    // --- Открыть/закрыть окна: клавиши W / C / D есть в каждом окне ----------
    // «Открыть себя» окно не шлёт — оно уже открыто.
    'open-widget': ['control', 'clock', 'display'],
    'open-clock-widget': ['control', 'widget', 'display'],
    'open-display': ['control', 'widget', 'clock'],
    'close-widget': ALL,
    'close-clock-widget': ALL,
    'close-display': ALL,

    // --- Геометрия: окно двигает и масштабирует само себя --------------------
    'widget-set-position': ['widget'],
    'widget-resize': ['widget'],
    'widget-move': ['widget'],
    'clock-widget-set-position': ['clock'],
    'clock-widget-move': ['clock'],
    // Масштаб часов меняет и ползунок панели.
    'clock-widget-resize': ['control', 'clock'],
    'display-move': ['display'],
    'toggle-fullscreen': ['display'],
    'minimize-window': ['control', 'display'],
    'report-scale': ['widget', 'clock', 'display'],
    'display-block-hidden': ['display'],

    // --- Просьбы окон к панели (клавиши вне панели) --------------------------
    'preset-apply': ['display'],
    'sound-toggle': ['widget', 'clock', 'display'],

    // --- Необратимое: только панель -------------------------------------------
    'event-finish': ['control'],
    'event-export': ['control'],
    'event-reset': ['control'],
    'quit-app': ['control'],
    'reset-and-relaunch': ['control']
});

/**
 * Проверка отправителя.
 *
 * @param {object} deps
 * @param {(webContents) => object|null} deps.windowOf — BrowserWindow.fromWebContents
 * @param {() => Record<string, object|null>} deps.windowsByRole — живые окна по ролям
 * @param {(url: string) => boolean} deps.isAppPage — предикат navigation-guard.js
 * @param {(channel: string, reason: string) => void} [deps.onReject]
 * @returns {(channel: string, event: object) => boolean}
 */
function createSenderGate({ windowOf, windowsByRole, isAppPage, onReject = () => {} }) {
    return function isAllowedSender(channel, event) {
        const allowed = SENDERS[channel];
        if (!allowed) { onReject(channel, 'нет владельца'); return false; }

        const sender = event && event.sender;
        if (!sender) { onReject(channel, 'нет отправителя'); return false; }

        // Только главный кадр. Субфрейм (iframe) живёт в том же webContents и
        // видит тот же preload, но его страница — не наша, даже если окно наше.
        const frame = event.senderFrame;
        if (!frame || frame !== sender.mainFrame) { onReject(channel, 'субфрейм'); return false; }

        // Адрес — ещё раз, хотя навигацию стережёт navigation-guard: сообщение
        // могло уйти в зазор между переходом и его отменой, а проверка здесь
        // стоит одну строку.
        if (!isAppPage(frame.url)) { onReject(channel, 'чужая страница'); return false; }

        const win = windowOf(sender);
        if (!win) { onReject(channel, 'не окно'); return false; }
        const byRole = windowsByRole();
        const role = ROLES.find((r) => byRole[r] === win);
        if (!role) { onReject(channel, 'неизвестное окно'); return false; }
        if (!allowed.includes(role)) { onReject(channel, `окно ${role}`); return false; }
        return true;
    };
}

/**
 * ipcMain с проверкой отправителя на КАЖДОЙ регистрации.
 *
 * Возвращает объект с теми же `on`/`handle`, что у ipcMain, поэтому код
 * главного процесса пишет привычное `ipcMain.on('канал', …)` — и не может
 * зарегистрировать обработчик мимо проверки. Канал без строки в таблице падает
 * при ЗАГРУЗКЕ: забытое разрешение обнаруживается первым же запуском тестов,
 * а не отказом клавиши у пользователя.
 */
function guardIpcMain(ipcMain, isAllowedSender) {
    const requireOwner = (channel) => {
        if (!SENDERS[channel]) {
            throw new Error(`ipc-senders: у канала «${channel}» нет строки в таблице отправителей`);
        }
    };
    return {
        on(channel, handler) {
            requireOwner(channel);
            ipcMain.on(channel, (event, ...args) => {
                if (!isAllowedSender(channel, event)) { return undefined; }
                return handler(event, ...args);
            });
        },
        handle(channel, handler) {
            requireOwner(channel);
            ipcMain.handle(channel, (event, ...args) => {
                if (!isAllowedSender(channel, event)) { throw new Error('отправитель не допущен'); }
                return handler(event, ...args);
            });
        }
    };
}

/**
 * Журнал отказов: один раз на пару «канал + причина».
 *
 * Отвергнутое сообщение приходит обычно очередью (перетаскивание — это
 * десятки `move` в секунду), и запись на каждое засыпала бы журнал. В запись
 * идёт только ИМЯ канала и причина — ни payload, ни адрес (SEC-11).
 */
function onceLogger(write) {
    const seen = new Set();
    return (channel, reason) => {
        const key = `${channel}|${reason}`;
        if (seen.has(key)) { return; }
        seen.add(key);
        write(`[ipc] отклонено ${channel}: ${reason}`);
    };
}

// Канал → окна, которые его СЛУШАЮТ (main → renderer).
//
// Главному процессу эта таблица не нужна — адресата он выбирает сам. Она нужна
// мосту: из SENDERS и RECEIVERS собирается список каналов, открытых в preload
// каждого окна (channelsFor → scripts/preload-channels.js → preload.js).
// Списана с подписок окон (`.on('…'` в странице и её модулях); сверку в обе
// стороны держит tests/preload-channels.test.js.
const RECEIVERS = Object.freeze({
    'timer-state': ALL,
    'ui-theme-update': ALL,
    // Замок шлёт панель — сама она его не слушает (bindLockSync не зовёт).
    'ui-lock-update': ['widget', 'clock', 'display'],
    'display-settings-update': ['widget', 'clock', 'display'],

    // Каждое окно знает, открыты ли ДВА других (клавиши W / C / D).
    'widget-window-state': ['control', 'clock', 'display'],
    'clock-window-state': ['control', 'widget', 'display'],
    'display-window-state': ['control', 'widget', 'clock'],

    // --- Панель ------------------------------------------------------------------
    'timer-minute': ['control'],
    'timer-reached-zero': ['control'],
    'timer-overrun-minute': ['control'],
    'timer-recovery-available': ['control'],
    'displays-list': ['control'],
    'scale-report': ['control'],
    'block-hidden': ['control'],
    'preset-apply': ['control'],
    'sound-toggle': ['control'],
    'event-export-done': ['control'],
    'event-overrun-state': ['control', 'display'],

    // --- Виджет и часы -----------------------------------------------------------
    'widget-colors-update': ['widget'],
    'widget-style-update': ['widget'],
    'clock-colors-update': ['clock'],
    'set-clock-style': ['clock'],
    'clock-settings': ['clock'],
    'window-geometry': ['widget', 'clock'],

    // --- Дисплей -----------------------------------------------------------------
    'display-colors-update': ['display'],
    'display-layout': ['display'],
    'display-restore-state': ['display']
});

// Роль окна доходит до его preload аргументом командной строки рендерера
// (`webPreferences.additionalArguments` → `process.argv`). Префикс один на
// главный процесс, генератор моста и тесты.
const ROLE_ARG_PREFIX = '--tw-window=';

function windowArgument(role) {
    if (!ROLES.includes(role)) { throw new Error(`ipc-senders: неизвестное окно «${role}»`); }
    return ROLE_ARG_PREFIX + role;
}

/**
 * Каналы, открытые в мосте окна: что оно вправе слать и что слушает.
 * @param {string} role
 * @returns {{send: string[], receive: string[]}}
 */
function channelsFor(role) {
    if (!ROLES.includes(role)) { throw new Error(`ipc-senders: неизвестное окно «${role}»`); }
    const pick = (table) => Object.keys(table).filter((ch) => table[ch].includes(role));
    return { send: pick(SENDERS), receive: pick(RECEIVERS) };
}

module.exports = {
    ROLES, SENDERS, RECEIVERS, ROLE_ARG_PREFIX,
    channelsFor, windowArgument, createSenderGate, guardIpcMain, onceLogger
};
