/**
 * Preload — мост окна к главному процессу (contextBridge).
 *
 * Мост каждого окна открывает ТОЛЬКО каналы этого окна: панель не слышит
 * геометрию виджета, виджет не может послать `reset-and-relaunch`. Это второй
 * слой обороны; первый — проверка отправителя в главном процессе
 * (ipc-senders.js, SEC-07), и он остаётся.
 *
 * Откуда список. Таблица ниже СГЕНЕРИРОВАНА из SENDERS/RECEIVERS в
 * ipc-senders.js (scripts/preload-channels.js): песочница (sandbox: true)
 * разрешает здесь `require` только модуля `electron`, прочитать локальный файл
 * мост не может. Свежесть таблицы держит tests/preload-channels.test.js.
 *
 * Откуда роль. Главный процесс передаёт её аргументом рендерера
 * (`webPreferences.additionalArguments: ['--tw-window=<роль>']`, main-windows.js),
 * он приходит в `process.argv` — один из немногих разделов `process`,
 * доступных в песочнице. Роль задаётся до запуска рендерера, страница её не
 * подменит. Нет роли, чужая или их две — мост закрыт целиком и говорит почему.
 */

const { contextBridge, ipcRenderer } = require('electron');

// <preload-channels> — сгенерировано scripts/preload-channels.js из ipc-senders.js, руками не править
const ROLE_ARG_PREFIX = '--tw-window=';
const CHANNELS_BY_ROLE = Object.freeze({
    control: Object.freeze({
        send: [
            'get-timer-state',
            'timer-command',
            'get-displays',
            'widget-colors-update',
            'clock-colors-update',
            'display-colors-update',
            'widget-style-update',
            'display-settings-update',
            'clock-widget-set-style',
            'clock-widget-settings',
            'display-layout',
            'display-restore-state',
            'ui-theme-update',
            'ui-lock-update',
            'open-releases-page',
            'resize-control-window',
            'control-collapse',
            'control-drawer',
            'open-widget',
            'open-clock-widget',
            'open-display',
            'close-widget',
            'close-clock-widget',
            'close-display',
            'clock-widget-resize',
            'minimize-window',
            'event-finish',
            'event-export',
            'event-reset',
            'quit-app',
            'reset-and-relaunch'
        ],
        receive: [
            'timer-state',
            'ui-theme-update',
            'widget-window-state',
            'clock-window-state',
            'display-window-state',
            'timer-minute',
            'timer-reached-zero',
            'timer-overrun-minute',
            'timer-recovery-available',
            'displays-list',
            'scale-report',
            'block-hidden',
            'preset-apply',
            'sound-toggle',
            'event-export-done',
            'event-overrun-state'
        ]
    }),
    widget: Object.freeze({
        send: [
            'get-timer-state',
            'timer-command',
            'timer-control',
            'open-clock-widget',
            'open-display',
            'close-widget',
            'close-clock-widget',
            'close-display',
            'widget-set-position',
            'widget-resize',
            'widget-move',
            'report-scale',
            'sound-toggle'
        ],
        receive: [
            'timer-state',
            'ui-theme-update',
            'ui-lock-update',
            'display-settings-update',
            'clock-window-state',
            'display-window-state',
            'widget-colors-update',
            'widget-style-update',
            'window-geometry'
        ]
    }),
    clock: Object.freeze({
        send: [
            'timer-command',
            'timer-control',
            'open-widget',
            'open-display',
            'close-widget',
            'close-clock-widget',
            'close-display',
            'clock-widget-set-position',
            'clock-widget-move',
            'clock-widget-resize',
            'report-scale',
            'sound-toggle'
        ],
        receive: [
            'timer-state',
            'ui-theme-update',
            'ui-lock-update',
            'display-settings-update',
            'widget-window-state',
            'display-window-state',
            'clock-colors-update',
            'set-clock-style',
            'clock-settings',
            'window-geometry'
        ]
    }),
    display: Object.freeze({
        send: [
            'get-timer-state',
            'timer-command',
            'timer-control',
            'open-widget',
            'open-clock-widget',
            'close-widget',
            'close-clock-widget',
            'close-display',
            'display-move',
            'toggle-fullscreen',
            'minimize-window',
            'report-scale',
            'display-block-hidden',
            'preset-apply',
            'sound-toggle'
        ],
        receive: [
            'timer-state',
            'ui-theme-update',
            'ui-lock-update',
            'display-settings-update',
            'widget-window-state',
            'clock-window-state',
            'event-overrun-state',
            'display-colors-update',
            'display-layout',
            'display-restore-state'
        ]
    })
});
// </preload-channels>

function roleFromArgv(argv) {
    const hits = (Array.isArray(argv) ? argv : [])
        .filter((a) => typeof a === 'string' && a.startsWith(ROLE_ARG_PREFIX));
    if (hits.length !== 1) { return null; }
    const role = hits[0].slice(ROLE_ARG_PREFIX.length);
    return Object.prototype.hasOwnProperty.call(CHANNELS_BY_ROLE, role) ? role : null;
}

const ROLE = roleFromArgv(process.argv);
const OWN = ROLE ? CHANNELS_BY_ROLE[ROLE] : { send: [], receive: [] };
if (!ROLE) {
    console.error('[preload] окно запущено без роли (--tw-window=…) — мост закрыт');
}

function isValidChannel(channel, direction) {
    if (!channel || typeof channel !== 'string') { return false; }
    return OWN[direction].includes(channel);
}

function blocked(what, channel) {
    console.error(`Blocked attempt to ${what} unauthorized channel: ${channel} (окно ${ROLE || 'без роли'})`);
}

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * @param {string} channel - IPC channel name
     * @param {any} data - Data to send
     */
    send: (channel, data) => {
        if (isValidChannel(channel, 'send')) {
            ipcRenderer.send(channel, data);
        } else {
            blocked('send to', channel);
        }
    },

    // Двустороннего `invoke` здесь намеренно НЕТ: `ipcMain.handle` в проекте
    // нет ни одного, поэтому вызов повис бы без ответа. Мост — единственное
    // окно из песочницы наружу, и держать в нём нерабочую возможность значит
    // расширять поверхность впустую. Появится обработчик — вернуть обёртку;
    // за этим следит tests/ipc-liveness.test.js, проверяя обе стороны сразу.

    /**
     * @param {string} channel - IPC channel name
     * @param {Function} callback - Callback function
     * @returns {Function} Cleanup function to remove listener
     */
    on: (channel, callback) => {
        if (isValidChannel(channel, 'receive')) {
            const subscription = (event, ...args) => callback(...args);
            ipcRenderer.on(channel, subscription);
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        }
        blocked('listen to', channel);
        return () => {};
    },

    /**
     * @param {string} channel - IPC channel name
     * @param {Function} callback - Callback function
     */
    once: (channel, callback) => {
        if (isValidChannel(channel, 'receive')) {
            ipcRenderer.once(channel, (event, ...args) => callback(...args));
        } else {
            blocked('listen to', channel);
        }
    },

    /**
     * NOTE: Due to contextBridge limitations, it's better to use the cleanup
     * function returned by on() instead of this method
     * @param {string} channel - IPC channel name
     * @param {Function} callback - Callback function to remove
     */
    removeListener: (channel, callback) => {
        if (isValidChannel(channel, 'receive')) {
            ipcRenderer.removeListener(channel, callback);
        } else {
            blocked('remove listener from', channel);
        }
    },

    /**
     * @param {string} channel - IPC channel name
     */
    removeAllListeners: (channel) => {
        if (isValidChannel(channel, 'receive')) {
            ipcRenderer.removeAllListeners(channel);
        } else {
            blocked('remove all listeners from', channel);
        }
    }
});
