'use strict';

/**
 * main-window-hooks.js — привязки, которые получает КАЖДОЕ окно при создании.
 *
 * Запреты навигации (SEC-06), запрет масштаба страницы, журнал рендерера,
 * перезагрузка после падения рендерера, снимок состояния окон на загрузке и
 * объявление «окно открылось». Всё это зовут create-функции
 * (main-windows.js) — единственный владелец события «окно открылось».
 *
 * Модуль не требует electron: окна приходят объектами, журнал — параметром.
 */

const NavigationGuard = require('./navigation-guard');

/**
 * @param {object} deps
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.log — electron-log
 * @param {Function} deps.safelySendToWindow — utils.js
 * @param {string[]} deps.appPageUrls — адреса четырёх страниц (navigation-guard.js)
 * @param {Function} deps.logBlockedNavigation — журнал отказа навигации
 * @param {Function} deps.updateTrayMenu — трей перестраивает меню по открытию окон
 */
function createWindowHooks({ windows, log, safelySendToWindow, appPageUrls, logBlockedNavigation, updateTrayMenu }) {
    const APP_PAGE_URLS = appPageUrls;

    // Block Ctrl+=/- keyboard zoom and Ctrl+Wheel page zoom on all windows
    function blockZoom(win) {
        if (!win || !win.webContents) {return;}
        win.webContents.on('before-input-event', (event, input) => {
            if (win.isDestroyed()) {return;}
            if (input.control && (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')) {
                event.preventDefault();
            }
        });
        // Reset zoom and block Ctrl+Wheel page zoom
        win.webContents.setZoomFactor(1);
        win.webContents.setZoomLevel(0);
        win.webContents.setVisualZoomLevelLimits(1, 1);
    }

    // Защита от навигации и открытия новых окон (SEC-06): переход разрешён
    // ТОЛЬКО на четыре страницы приложения. Те же запреты ставит на КАЖДЫЙ
    // webContents обработчик `web-contents-created` в точке входа; здесь они
    // ставятся в том же месте, где окно родилось, и тест release-gates считает
    // эти вызовы.
    function hardenWindow(win) {
        NavigationGuard.guardWebContents(win.webContents, APP_PAGE_URLS, logBlockedNavigation);
    }

    // Render process crash handler
    function bindRenderCrashHandler(win, label) {
        if (!win || !win.webContents) { return; }
        win.webContents.on('render-process-gone', (_event, details) => {
            log.error(`Render process gone in ${label}: ${JSON.stringify(details)}`);
            if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
                try { win.reload(); } catch (err) { log.error('Reload failed:', err); }
            }
        });
    }

    // Forward renderer console + preload + responsiveness events into electron-log.
    // Lets us see inline-script errors (which otherwise die silently) in the log file.
    function bindRenderConsole(win, label) {
        if (!win || !win.webContents) { return; }
        win.webContents.on('console-message', (e) => {
            try {
                const level = (e && e.level) || 'info';
                const src = e && e.sourceId ? ` @ ${e.sourceId}:${e.lineNumber || '?'}` : '';
                const msg = `[renderer:${label}] ${(e && e.message) || ''}${src}`;
                if (level === 'error') { log.error(msg); }
                else if (level === 'warning' || level === 'warn') { log.warn(msg); }
                else if (level === 'debug' || level === 'verbose') { log.debug(msg); }
                else { log.info(msg); }
            } catch { /* best effort */ }
        });
        win.webContents.on('preload-error', (_e, preloadPath, error) => {
            log.error(`[renderer:${label}] preload-error in ${preloadPath}: ${error && error.message}`);
        });
        win.on('unresponsive', () => log.warn(`[renderer:${label}] window unresponsive`));
        win.on('responsive', () => log.info(`[renderer:${label}] window responsive again`));
    }

    // Broadcast window state to all windows
    function broadcastWindowState(channel, data) {
        safelySendToWindow(windows.controlWindow, channel, data);
        safelySendToWindow(windows.widgetWindow, channel, data);
        safelySendToWindow(windows.displayWindow, channel, data);
        safelySendToWindow(windows.clockWidgetWindow, channel, data);
        // F-022: widget/clock open-close changes tray menu checkboxes; trigger rebuild.
        updateTrayMenu();
    }

    // Полный СНИМОК состояния окон одному адресату — досылается каждому окну сразу
    // после загрузки его содержимого.
    //
    // Зачем: решение «открыть или закрыть» и в горячих клавишах W/C/D, и в кнопках
    // панели принимается по ЛОКАЛЬНОМУ флагу окна, а тот инициализируется в false и
    // обновляется только сообщениями `*-window-state`. Рассылались они лишь в момент
    // открытия/закрытия, поэтому окно, загрузившееся ПОЗЖЕ, о ранее открытых окнах не
    // узнавало никогда. Сценарий из обычной работы: открыть часы, потом виджет и
    // нажать в виджете C — виджет считает часы закрытыми и шлёт open-clock-widget,
    // главный процесс лишь фокусирует уже открытое окно, и тоггл не работает.
    // Тот же провал после перезагрузки рендерера краш-обработчиком
    // (bindRenderCrashHandler → win.reload()) и после повторного создания панели из трея.
    //
    // Слушатель именно `on`, а не `once`: перезагрузка окна обязана получить снимок заново.
    function sendWindowStatesTo(win) {
        safelySendToWindow(win, 'widget-window-state', { isOpen: !!windows.widgetWindow });
        safelySendToWindow(win, 'clock-window-state', { isOpen: !!windows.clockWidgetWindow });
        safelySendToWindow(win, 'display-window-state', { isOpen: !!windows.displayWindow });
    }

    function bindWindowStateSnapshot(win) {
        if (!win || !win.webContents) { return; }
        win.webContents.on('did-finish-load', () => sendWindowStatesTo(win));
    }

    // Обратная сторона снимка: остальные окна узнают, что появилось новое, а само
    // новое окно получает накопленное состояние.
    //
    // Живёт здесь, а НЕ в обработчике `ipcMain.on('open-*')`, потому что у события
    // «окно открылось» должен быть один владелец — функция создания окна. Пункты
    // трея зовут create-функции напрямую, и всё, что лежало в обработчике канала,
    // мимо них проходило: панель не подсвечивала кнопку, горячая клавиша W/C
    // считала окно закрытым и слала `open-*`, а главный процесс лишь фокусировал
    // уже живое окно — переключатель выглядел мёртвым.
    //
    // Слушатель `on`, а не `once`, по той же причине, что и у снимка: рендерер,
    // перезагруженный краш-обработчиком, обязан получить данные заново.
    function announceWindowOpened(win, stateChannel, hydrate) {
        if (!win || !win.webContents) { return; }
        win.webContents.on('did-finish-load', () => {
            if (win.isDestroyed()) { return; }
            hydrate(win);
        });
        broadcastWindowState(stateChannel, { isOpen: true });
    }

    return {
        blockZoom, hardenWindow, bindRenderCrashHandler, bindRenderConsole,
        broadcastWindowState, sendWindowStatesTo, bindWindowStateSnapshot, announceWindowOpened
    };
}

module.exports = { createWindowHooks };
