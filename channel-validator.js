// IPC Channel validation for Timer Widget

const ALLOWED_CHANNELS = {
    send: [
        'get-timer-state',
        'get-displays',
        'timer-command',
        'timer-control',
        'widget-colors-update',
        'clock-colors-update',
        'display-colors-update',
        'widget-style-update',
        'display-settings-update',
        'open-widget',
        'close-widget',
        'open-display',
        'close-display',
        'open-clock-widget',
        'close-clock-widget',
        'clock-widget-resize',
        'clock-widget-move',
        'clock-widget-set-position',
        'clock-widget-set-style',
        'clock-widget-settings',
        'resize-control-window',
        // Свёртывание окна управления в полосу. Отдельный канал, а не
        // resize-control-window: тот ЗАЖИМАЕТ высоту снизу минимумом окна
        // (660), и полоса в 52px через него недостижима в принципе.
        'control-collapse',
        // Открытие/закрытие ящика настроек. Отдельный канал по той же причине,
        // что и control-collapse: resize-control-window зажимает ширину сверху
        // потолком окна, а ящику потолок надо ПОДНЯТЬ. Выводить это из
        // запрошенной ширины нельзя — тогда потолок обходится любым запросом.
        'control-drawer',
        'widget-set-position',
        'widget-resize',
        'widget-move',
        'report-scale',
        'display-move',
        // Тема интерфейса. Канал в ОБОИХ списках: панель отправляет смену,
        // все окна её принимают (ui-theme.js).
        'ui-theme-update',
        'open-releases-page',
    'minimize-window',
        'toggle-fullscreen',
        'quit-app',
        'reset-and-relaunch'
    ],
    receive: [
        'timer-state',
        'widget-colors-update',
        'clock-colors-update',
        'display-colors-update',
        'widget-style-update',
        'timer-minute',
        'timer-reached-zero',
        'timer-overrun-minute',
        'display-settings-update',
        'displays-list',
        'set-clock-style',
        'clock-settings',
        'display-window-state',
        'widget-window-state',
        'clock-window-state',
        'scale-report',
        // Границы окна, как их видит ГЛАВНЫЙ процесс. Он ими и владеет: окно
        // двигают и масштабируют его вызовы. Виджет и часы записывают в
        // localStorage то, что пришло сюда, а не то, что насчитали сами по
        // outerWidth/screenX — на мониторе с масштабом ≠ 100 % это разные
        // единицы (см. window-geometry.js).
        'window-geometry',
        'ui-theme-update',
        'timer-recovery-available'
    ]
};

/**
 * Validate IPC channel to prevent arbitrary channel access
 * @param {string} channel - Channel name
 * @param {string} direction - 'send' or 'receive'
 * @returns {boolean}
 */
function isValidChannel(channel, direction) {
    if (!channel || typeof channel !== 'string') { return false; }
    if (!ALLOWED_CHANNELS[direction]) { return false; }
    return ALLOWED_CHANNELS[direction].includes(channel);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isValidChannel, ALLOWED_CHANNELS };
}
