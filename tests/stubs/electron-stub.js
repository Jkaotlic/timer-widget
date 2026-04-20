
'use strict';
const noop = () => {};
const chainable = new Proxy(function() {}, {
    get: () => chainable,
    apply: () => chainable
});
module.exports = {
    app: {
        getVersion: () => '0.0.0-test',
        getPath: () => require('os').tmpdir(),
        whenReady: () => Promise.resolve(),
        on: noop,
        setLoginItemSettings: noop,
        getLoginItemSettings: () => ({ openAtLogin: false }),
        quit: noop,
        setAsDefaultProtocolClient: noop
    },
    BrowserWindow: class {
        constructor() { this.webContents = { on: noop, once: noop, setWindowOpenHandler: noop, setZoomFactor: noop, setZoomLevel: noop, setVisualZoomLevelLimits: noop }; }
        loadFile() { return { catch: noop }; }
        on() {} once() {} isDestroyed() { return false; } getPosition() { return [0, 0]; } setPosition() {} setSize() {} setOpacity() {} setBounds() {} show() {} hide() {} focus() {} close() {} isVisible() { return false; } setAlwaysOnTop() {} setIgnoreMouseEvents() {}
        static getAllWindows() { return []; }
    },
    ipcMain: { on: noop, handle: noop, removeHandler: noop },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), getAllDisplays: () => [], on: noop },
    Menu: { setApplicationMenu: noop, buildFromTemplate: () => ({}) },
    Tray: class { constructor() {} setToolTip() {} setContextMenu() {} on() {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }), createEmpty: () => ({}) },
    dialog: { showSaveDialog: () => Promise.resolve({ canceled: true }) },
    session: { defaultSession: { clearStorageData: () => Promise.resolve(), clearCache: () => Promise.resolve() } }
};
