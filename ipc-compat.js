/**
 * IPC Compatibility Layer
 * Provides backward compatibility wrapper for old ipcRenderer code
 * Maps old ipcRenderer calls to new secure electronAPI
 *
 * USAGE: Include this script BEFORE any code that uses ipcRenderer
 * <script src="ipc-compat.js"></script>
 */

(function() {
    'use strict';

    // Check if electronAPI is available (from preload.js)
    if (typeof window.electronAPI === 'undefined') {
        console.error('electronAPI not available! Make sure preload.js is loaded.');
        return;
    }

    // Create compatibility shim for ipcRenderer
    window.ipcRenderer = {
        /**
         * Send message to main process
         * @param {string} channel - Channel name
         * @param {any} data - Data to send
         */
        send: function(channel, data) {
            window.electronAPI.send(channel, data);
        },

        /**
         * Register event listener
         * @param {string} channel - Channel name
         * @param {Function} callback - Callback function (event, ...args) => void
         * @returns {Function} - Cleanup function
         */
        on: function(channel, callback) {
            // Wrap callback to match old ipcRenderer signature (event, ...args)
            const wrappedCallback = function(...args) {
                // Create a fake event object for compatibility
                const fakeEvent = { sender: null };
                callback(fakeEvent, ...args);
            };

            // Store the cleanup function
            const cleanup = window.electronAPI.on(channel, wrappedCallback);

            // Store reference for removeListener
            if (!this._listeners) {
                this._listeners = new Map();
            }
            if (!this._listeners.has(channel)) {
                this._listeners.set(channel, []);
            }
            this._listeners.get(channel).push({
                original: callback,
                wrapped: wrappedCallback,
                cleanup: cleanup
            });

            return cleanup;
        },

        /**
         * Register one-time event listener
         * @param {string} channel - Channel name
         * @param {Function} callback - Callback function
         */
        once: function(channel, callback) {
            const wrappedCallback = function(...args) {
                const fakeEvent = { sender: null };
                callback(fakeEvent, ...args);
            };
            window.electronAPI.once(channel, wrappedCallback);
        },

        /**
         * Remove specific event listener
         * @param {string} channel - Channel name
         * @param {Function} callback - Original callback function
         */
        removeListener: function(channel, callback) {
            if (!this._listeners || !this._listeners.has(channel)) {
                return;
            }

            const listeners = this._listeners.get(channel);
            const index = listeners.findIndex(l => l.original === callback);

            if (index !== -1) {
                // Call cleanup function
                listeners[index].cleanup();
                // Remove from array
                listeners.splice(index, 1);

                // Clean up empty channel
                if (listeners.length === 0) {
                    this._listeners.delete(channel);
                }
            }
        },

        /**
         * Remove all listeners for a channel
         * @param {string} channel - Channel name
         */
        removeAllListeners: function(channel) {
            if (this._listeners && this._listeners.has(channel)) {
                const listeners = this._listeners.get(channel);
                // Call all cleanup functions
                listeners.forEach(l => l.cleanup());
                this._listeners.delete(channel);
            }
            window.electronAPI.removeAllListeners(channel);
        },

        /**
         * Internal storage for listener references
         * @private
         */
        _listeners: new Map()
    };

    // Freeze the ipcRenderer object to prevent modifications
    Object.freeze(window.ipcRenderer);

    console.log('IPC compatibility layer initialized');
})();
