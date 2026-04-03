/**
 * Preload script for Electron renderer processes
 * Provides secure IPC communication via contextBridge
 *
 * SECURITY: Uses contextIsolation to prevent renderer from accessing Node.js APIs
 * NOTE: channel-validator is inlined here because sandbox:true restricts require()
 * to built-in modules only — local file requires are not allowed in sandboxed preloads.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Inlined from channel-validator.js (cannot require local files in sandboxed preload)
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

function isValidChannel(channel, direction) {
    if (!channel || typeof channel !== 'string') { return false; }
    if (!ALLOWED_CHANNELS[direction]) { return false; }
    return ALLOWED_CHANNELS[direction].includes(channel);
}

// Expose protected methods to renderer process via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Send IPC message to main process
     * @param {string} channel - IPC channel name
     * @param {any} data - Data to send
     */
    send: (channel, data) => {
        if (isValidChannel(channel, 'send')) {
            ipcRenderer.send(channel, data);
        } else {
            console.error(`Blocked attempt to send to unauthorized channel: ${channel}`);
        }
    },

    /**
     * Register IPC event listener
     * @param {string} channel - IPC channel name
     * @param {Function} callback - Callback function
     * @returns {Function} Cleanup function to remove listener
     */
    on: (channel, callback) => {
        if (isValidChannel(channel, 'receive')) {
            const subscription = (event, ...args) => callback(...args);
            ipcRenderer.on(channel, subscription);

            // Return cleanup function
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        } else {
            console.error(`Blocked attempt to listen to unauthorized channel: ${channel}`);
            return () => {}; // Return no-op cleanup function
        }
    },

    /**
     * Register one-time IPC event listener
     * @param {string} channel - IPC channel name
     * @param {Function} callback - Callback function
     */
    once: (channel, callback) => {
        if (isValidChannel(channel, 'receive')) {
            ipcRenderer.once(channel, (event, ...args) => callback(...args));
        } else {
            console.error(`Blocked attempt to listen to unauthorized channel: ${channel}`);
        }
    },

    /**
     * Remove specific IPC event listener
     * NOTE: Due to contextBridge limitations, it's better to use the cleanup
     * function returned by on() instead of this method
     * @param {string} channel - IPC channel name
     * @param {Function} callback - Callback function to remove
     */
    removeListener: (channel, callback) => {
        if (isValidChannel(channel, 'receive')) {
            ipcRenderer.removeListener(channel, callback);
        } else {
            console.error(`Blocked attempt to remove listener from unauthorized channel: ${channel}`);
        }
    },

    /**
     * Remove all IPC event listeners for a channel
     * @param {string} channel - IPC channel name
     */
    removeAllListeners: (channel) => {
        if (isValidChannel(channel, 'receive')) {
            ipcRenderer.removeAllListeners(channel);
        } else {
            console.error(`Blocked attempt to remove all listeners from unauthorized channel: ${channel}`);
        }
    }
});
