'use strict';

/**
 * main-window-ipc.js — каналы окон: открыть / закрыть виджет, часы и дисплей,
 * список мониторов, перемещение и размер окон.
 *
 * Обработчики намеренно ТОНКИЕ: создать окно или сфокусировать живое. Досылка
 * состояния и объявление «окно открылось» принадлежат create-функциям
 * (main-windows.js) — окна открывают ещё и из трея, мимо этих каналов.
 * Закрывающееся окно открытым не считается — см. main-window-closing.js.
 *
 * `ipcMain` сюда приходит УЖЕ обвязанным проверкой отправителя (SEC-07,
 * ipc-senders.js): модуль не может зарегистрировать канал мимо неё.
 */

const { isPayloadObject } = require('./relay-payload');

/**
 * @param {object} deps
 * @param {object} deps.ipcMain — обвязка ipc-senders.guardIpcMain
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.relay — память ретрансляторов (lastDisplayIndex)
 * @param {object} deps.screen
 * @param {Function} deps.BrowserWindow — fromWebContents
 * @param {object} deps.closing — main-window-closing.js
 * @param {object} deps.creators — create-функции main-windows.js
 * @param {object} deps.geometry — main-geometry.js
 */
function registerWindowIpc({ ipcMain, windows, relay, screen, BrowserWindow, closing, creators, geometry }) {
    const { isUsableWindow, queueOpenAfterClose, cancelQueuedOpen, markClosing, closeDisplayWindow } = closing;
    const { createWidgetWindow, createClockWidgetWindow, createDisplayWindow } = creators;
    const { moveWindowBy, resizeWindowClamped, positionWindowClamped } = geometry;

    // Обработчик намеренно тонкий: рассылка состояния и досылка настроек живут в
    // createWidgetWindow, потому что окно открывают ещё и из трея — мимо этого канала.
    ipcMain.on('open-widget', () => {
        // ЗАКРЫВАЮЩЕЕСЯ окно открытым не считается — см. pendingOpens в
        // main-window-closing.js.
        if (isUsableWindow(windows.widgetWindow)) {
            windows.widgetWindow.focus();
            return;
        }
        if (windows.widgetWindow && queueOpenAfterClose('widget', windows.widgetWindow, createWidgetWindow)) {
            return;
        }
        createWidgetWindow();
    });

    ipcMain.on('close-widget', () => {
        // «Закрыть» отменяет отложенное открытие: человек передумал.
        cancelQueuedOpen('widget');
        if (windows.widgetWindow) {
            markClosing(windows.widgetWindow).close();
            // Уведомление отправится в обработчике 'closed' события окна
        }
    });

    ipcMain.on('minimize-window', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) { win.minimize(); }
    });

    ipcMain.on('display-move', (_event, payload) => {
        moveWindowBy(windows.displayWindow, payload);
    });

    ipcMain.on('toggle-fullscreen', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) { win.setFullScreen(!win.isFullScreen()); }
    });

    // Здесь жил обработчик 'close-window' — «закрой окно отправителя». Его никто не
    // слал: окна закрываются адресными close-widget / close-clock-widget /
    // close-display, а панель — quit-app. Канал стоял в обоих белых списках, то есть
    // расширял поверхность IPC ради несуществующей команды.

    // Виджет часов
    // Тонкий обработчик — см. комментарий у open-widget.
    ipcMain.on('open-clock-widget', () => {
        if (isUsableWindow(windows.clockWidgetWindow)) {
            windows.clockWidgetWindow.focus();
            return;
        }
        if (windows.clockWidgetWindow
            && queueOpenAfterClose('clock', windows.clockWidgetWindow, createClockWidgetWindow)) {
            return;
        }
        createClockWidgetWindow();
    });

    ipcMain.on('close-clock-widget', () => {
        cancelQueuedOpen('clock');
        if (windows.clockWidgetWindow) {
            markClosing(windows.clockWidgetWindow).close();
            // Уведомление отправится в обработчике 'closed' события окна
        }
    });

    ipcMain.on('clock-widget-resize', (_event, payload) => {
        resizeWindowClamped(windows.clockWidgetWindow, payload);
    });

    ipcMain.on('clock-widget-move', (_event, payload) => {
        moveWindowBy(windows.clockWidgetWindow, payload);
    });

    ipcMain.on('clock-widget-set-position', (_event, payload) => {
        positionWindowClamped(windows.clockWidgetWindow, payload);
    });

    // Получение списка мониторов
    ipcMain.on('get-displays', (event) => {
        const displays = screen.getAllDisplays();
        event.sender.send('displays-list', displays);
    });

    ipcMain.on('open-display', (event, options) => {
        // Payload здесь НЕОБЯЗАТЕЛЕН: виджет и часы по клавише D шлют канал без
        // аргументов, и это значит «взять последний выбранный монитор». Поэтому
        // мусор нормализуем к пустому объекту, а не отбрасываем сообщение целиком —
        // ранний выход убил бы клавишу D. Значение по умолчанию `= {}` спасало
        // только от undefined: явный null доходил до чтения поля и ронял обработчик.
        const opts = isPayloadObject(options) ? options : {};
        // Use provided displayIndex, or fall back to last used
        const displayIndex = opts.displayIndex !== undefined ? opts.displayIndex : relay.lastDisplayIndex;
        relay.lastDisplayIndex = displayIndex;

        // Открытие уже запланировано на закрытие текущего окна — владелец у него
        // один (pendingOpens), и последний запрошенный монитор побеждает: пока
        // окно закрывалось, человек мог выбрать другой экран.
        if (queueOpenAfterClose('display', null, () => createDisplayWindow(displayIndex))) {
            return;
        }

        // Если дисплей уже открыт и запрос на тот же монитор - просто фокус.
        //
        // ЗАКРЫВАЮЩЕЕСЯ окно открытым не считается. Оно живо по ссылке всё время,
        // пока идёт выход из полноэкранного режима (см. closeDisplayWindow), и
        // без этой проверки «закрыть, тут же открыть» фокусировало обречённое окно
        // и выходило — а через мгновение дисплея не оставалось совсем. Замерено
        // 09.09.2026: без паузы между командами приложение оставалось с одним
        // окном, панелью. Спека — e2e/window-reopen-race.spec.js.
        if (isUsableWindow(windows.displayWindow) && displayIndex === windows.displayWindow._displayIndex) {
            windows.displayWindow.focus();
            return;
        }

        // Закрываем старое окно если оно открыто (переключение монитора).
        //
        // Тем же помощником, что и команда «закрыть»: старое окно тоже
        // полноэкранное, и закрытое напрямую оно роняло приложение так же. Новое
        // создаётся ПОСЛЕ того, как старое ушло, — иначе два полноэкранных окна
        // разъезжаются по пространствам macOS.
        if (windows.displayWindow) {
            const closingWindow = windows.displayWindow;
            closeDisplayWindow();
            windows.displayWindow = null;
            if (queueOpenAfterClose('display', closingWindow, () => createDisplayWindow(displayIndex))) {
                return;
            }
        }

        // Индекс монитора, рассылка состояния и досылка настроек — внутри
        // createDisplayWindow (см. комментарий у open-widget).
        createDisplayWindow(displayIndex);
    });

    ipcMain.on('close-display', () => {
        // «Закрыть» отменяет отложенное открытие: если оно было запланировано на
        // конец текущего закрытия, человек только что передумал, и окно, которое
        // он закрывает, не должно возродиться само.
        cancelQueuedOpen('display');
        // Уведомление отправится в обработчике 'closed' события окна.
        closeDisplayWindow();
    });

    // Управление виджетом
    //
    // Здесь жил обработчик 'widget-set-opacity'. Прозрачностью виджета не управляет
    // ничто: ни одного отправителя в проекте нет, контрола в панели нет, и виджет
    // сам её не трогает. Часы читали `opacity` из своих настроек, но записать её
    // тоже было некому — обе половины удалены вместе.
    ipcMain.on('widget-set-position', (_event, payload) => {
        positionWindowClamped(windows.widgetWindow, payload);
    });

    ipcMain.on('widget-resize', (_event, payload) => {
        resizeWindowClamped(windows.widgetWindow, payload);
    });

    ipcMain.on('widget-move', (_event, payload) => {
        moveWindowBy(windows.widgetWindow, payload);
    });
}

module.exports = { registerWindowIpc };
