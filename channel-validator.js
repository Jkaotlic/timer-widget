// IPC Channel validation for Timer Widget

const ALLOWED_CHANNELS = {
    send: [
        'get-timer-state',
        'get-displays',
        'timer-command',
        'timer-control',
        'colors-update',
        'display-settings-update',
        'open-widget',
        'close-widget',
        'open-display',
        'close-display',
        'open-clock-widget',
        'close-clock-widget',
        'clock-widget-resize',
        'clock-widget-scale',
        'clock-widget-set-style',
        'clock-widget-settings',
        'resize-control-window',
        'widget-set-opacity',
        'widget-set-position',
        'widget-resize',
        'widget-scale',
        'widget-move',
        'minimize-window',
        'close-window',
        'quit-app'
    ],
    receive: [
        'timer-state',
        'colors-update',
        'timer-minute',
        'timer-reached-zero',
        'timer-overrun-minute',
        'display-settings-update',
        'displays-list',
        'set-clock-style',
        'clock-settings',
        'display-window-state',
        'widget-window-state',
        'clock-window-state'
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
