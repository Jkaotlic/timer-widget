'use strict';

/**
 * Зонд главного процесса для стиля часов: что ИМЕННО main шлёт окну часов.
 *
 * Стиль у часов едет одним каналом (`set-clock-style`), и main досылает его
 * снимком при открытии из `relay.lastClockStyle`. Конечный класс `style-*` в
 * окне этого не доказывает: часы читают тот же стиль и из своего профиля. Зонд
 * пишет каждую посылку окну (`webContents.send`) — по журналу видно, что стиль
 * пришёл снимком и что настроек дисплея, прежней второй дороги, часам не шло.
 *
 * `blockPanel` — панель «молчит»: её посылки стиля считаются и до main не
 * доходят. Так проверяется, что окно получает стиль ДО любой новой посылки
 * панели — из памяти main, а после перезапуска из relay-state.json.
 */

const WATCHED = ['set-clock-style', 'display-settings-update'];

async function installClockStyleProbe(app, { blockPanel = false } = {}) {
    await app.evaluate(({ app: eapp, ipcMain }, opts) => {
        const probe = { sends: [], blockedPanelPosts: 0 };
        globalThis.__clockStyleProbe = probe;
        if (opts.blockPanel) {
            ipcMain.removeAllListeners('clock-widget-set-style');
            ipcMain.on('clock-widget-set-style', () => { probe.blockedPanelPosts++; });
        }
        eapp.on('browser-window-created', (_e, win) => {
            const wc = win.webContents;
            const send = wc.send.bind(wc);
            wc.send = (channel, ...args) => {
                if (opts.watched.includes(channel)) {
                    probe.sends.push({ id: win.id, channel, payload: args[0] });
                }
                return send(channel, ...args);
            };
        });
    }, { blockPanel, watched: WATCHED });
}

/** Посылки окну часов (по адресу страницы) из журнала зонда. */
async function clockSends(app) {
    return app.evaluate(({ BrowserWindow }) => {
        const clock = BrowserWindow.getAllWindows()
            .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('electron-clock-widget.html'));
        const probe = globalThis.__clockStyleProbe;
        return {
            blockedPanelPosts: probe.blockedPanelPosts,
            sends: clock ? probe.sends.filter((s) => s.id === clock.id) : []
        };
    });
}

module.exports = { installClockStyleProbe, clockSends };
