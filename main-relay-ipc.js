'use strict';

/**
 * main-relay-ipc.js — каналы-ретрансляторы: панель (или окно) присылает, главный
 * процесс проверяет, при нужде ЗАПОМИНАЕТ и пересылает адресату.
 *
 * Цвета и стиль виджета, настройки дисплея и часов, тема и замок, отчёт о
 * масштабе, крестик блока, раскладка, пресет, мастер-звук. Что запомнено, то
 * досылается окну при открытии (main-windows.js) из ОБЩЕЙ памяти
 * (main-state.js → relay).
 *
 * `ipcMain` сюда приходит уже обвязанным проверкой отправителя (SEC-07).
 */

const IpcSenders = require('./ipc-senders');
const { sanitizeRelayPayload, mergeDisplaySettings, withoutBgImage, isPayloadObject } = require('./relay-payload');

// Блок дисплея закрыт крестиком прямо в окне. Список — из таблицы настроек: он
// же используется в панели для проводки и сборки payload. Своя копия здесь
// означала бы, что новый блок надо не забыть в двух процессах. Подписи
// (`DISPLAY_LABEL_KEYS`) тоже здесь: у них такой же крестик, как у блоков.
const DISPLAY_SCHEMA = require('./settings-schema');
const DISPLAY_BLOCK_TOGGLES = new Set(
    DISPLAY_SCHEMA.DISPLAY_BLOCK_KEYS.concat(DISPLAY_SCHEMA.DISPLAY_LABEL_KEYS)
);

// Готовая раскладка дисплея. Имя проверяется по тому же реестру, что и в
// рендерерах: пришедшее из окна значение уходит в `classList` и в разбор
// раскладки, и принимать здесь произвольную строку незачем.
const DISPLAY_LAYOUT_IDS = new Set(require('./display-layouts').LAYOUT_IDS);

// Обратный канал масштаба: окно → панель управления.
//
// Раньше поток был односторонним — панель диктовала масштаб, а Ctrl+колесо на
// самом виджете/дисплее меняло его молча. Ползунок в панели после этого показывал
// старое значение, то есть два источника правды расходились, и следующая посылка
// настроек могла вернуть масштаб назад. Теперь окно сообщает о своём новом
// масштабе, панель подтягивает ползунок — и расхождению неоткуда взяться.
//
// Пересылается ТОЛЬКО в панель: широковещание вернуло бы значение отправителю и
// могло закольцеваться.
const SCALE_REPORT_SOURCES = new Set(['widget', 'clock', 'display', 'display-blocks']);

// Тема интерфейса. Переключается только из панели, но применяется во ВСЕХ окнах,
// поэтому здесь именно рассылка, а не адресная отправка (в отличие от цветов,
// которые у каждого окна свои и разослать их всем нельзя).
const UI_THEME_VALUES = new Set(['dark', 'light']);

/**
 * @param {object} deps
 * @param {object} deps.ipcMain — обвязка ipc-senders.guardIpcMain
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.relay — память ретрансляторов (main-state.js)
 * @param {Function} deps.safelySendToWindow
 * @param {object} deps.log
 * @param {() => void} deps.applyWidgetMinimumSize — main-windows.js
 * @param {(on: boolean) => void} deps.applyWidgetAlwaysOnTop — main-windows.js
 */
function registerRelayIpc({ ipcMain, windows, relay, safelySendToWindow, log, applyWidgetMinimumSize, applyWidgetAlwaysOnTop }) {
    // Проверенная копия payload канала-ретранслятора или null — «не принимать»
    // (SEC-10). Правило одно на все ретрансляторы и живёт в relay-payload.js:
    // то, что главный процесс запоминает в last* и досылает окнам при открытии,
    // обязано быть плоским объектом разумного размера. Отказ — одна запись в
    // журнал на канал: payload в журнал не идёт.
    const logRelayRejected = IpcSenders.onceLogger((line) => log.warn(line));
    function acceptRelay(channel, payload) {
        const clean = sanitizeRelayPayload(channel, payload);
        if (clean === null) { logRelayRejected(channel, 'payload не прошёл проверку'); }
        return clean;
    }

    // Per-window color updates (independent themes)
    ipcMain.on('widget-colors-update', (_event, payload) => {
        const colors = acceptRelay('widget-colors-update', payload);
        if (colors === null) { return; }
        relay.lastWidgetColors = colors;
        safelySendToWindow(windows.widgetWindow, 'widget-colors-update', colors);
        safelySendToWindow(windows.controlWindow, 'widget-colors-update', colors);
    });

    ipcMain.on('clock-colors-update', (_event, payload) => {
        const colors = acceptRelay('clock-colors-update', payload);
        if (colors === null) { return; }
        relay.lastClockColors = colors;
        safelySendToWindow(windows.clockWidgetWindow, 'clock-colors-update', colors);
    });

    ipcMain.on('display-colors-update', (_event, payload) => {
        const colors = acceptRelay('display-colors-update', payload);
        if (colors === null) { return; }
        relay.lastDisplayColors = colors;
        safelySendToWindow(windows.displayWindow, 'display-colors-update', colors);
    });

    // Widget style update (independent from display style)
    ipcMain.on('widget-style-update', (_event, payload) => {
        const settings = acceptRelay('widget-style-update', payload);
        if (settings === null) { return; }
        relay.lastWidgetStyle = settings;
        // Пол размера окна одинаков для всех стилей: полоса была только у LED, а
        // он слит с «Цифрами». Вызов оставлен здесь, потому что окно могло быть
        // создано раньше — пол ставится ровно один раз и в одном месте.
        applyWidgetMinimumSize();
        // «Поверх всех окон» едет этим же каналом — почему, см. applyWidgetAlwaysOnTop.
        applyWidgetAlwaysOnTop(settings.alwaysOnTop);
        safelySendToWindow(windows.widgetWindow, 'widget-style-update', settings);
    });

    // Рассылка настроек отображения fullscreen и widget (clockStyle/background)
    ipcMain.on('display-settings-update', (event, payload) => {
        const settings = acceptRelay('display-settings-update', payload);
        if (settings === null) { return; }
        // Сохраняем настройки для синхронизации при открытии новых окон. Картинка
        // фона едет только при смене (BUG-10): без ключа запомненная остаётся.
        relay.lastDisplaySettings = mergeDisplaySettings(relay.lastDisplaySettings, settings);

        // Открытым окнам — ровно пришедшее: дисплей держит свою копию картинки,
        // и 13 МБ на каждое нажатие клавиши не едут и отсюда. Часам фон не нужен.
        safelySendToWindow(windows.displayWindow, 'display-settings-update', settings);
        safelySendToWindow(windows.clockWidgetWindow, 'display-settings-update', withoutBgImage(settings));
    });

    ipcMain.on('clock-widget-set-style', (event, payload) => {
        const style = acceptRelay('clock-widget-set-style', payload);
        if (style === null) { return; }
        safelySendToWindow(windows.clockWidgetWindow, 'set-clock-style', style);
    });

    // Настройки виджета часов (дата, часовой пояс и т.д.)
    ipcMain.on('clock-widget-settings', (event, payload) => {
        const settings = acceptRelay('clock-widget-settings', payload);
        if (settings === null) { return; }
        // Снимок НАКАПЛИВАЕТСЯ: панель шлёт и частичные наборы (например только
        // три тумблера из девяти), а окну, открытому позже, нужна вся картина.
        // Простое присваивание отдало бы ему последнее сообщение и стёрло всё
        // остальное. Накопленное проверяется ещё раз: потолки ключей и размера
        // относятся к тому, что запомнено, а не к одному сообщению.
        const merged = sanitizeRelayPayload('clock-widget-settings',
            Object.assign({}, relay.lastClockSettings, settings));
        if (merged !== null) { relay.lastClockSettings = merged; }
        safelySendToWindow(windows.clockWidgetWindow, 'clock-settings', settings);
    });

    ipcMain.on('report-scale', (_event, payload) => {
        if (!isPayloadObject(payload)) { return; }
        const { source, scalePct } = payload;
        if (!SCALE_REPORT_SOURCES.has(source)) { return; }
        if (!Number.isFinite(scalePct)) { return; }
        safelySendToWindow(windows.controlWindow, 'scale-report', { source, scalePct });
    });

    // Блок дисплея закрыт крестиком прямо в окне. Пересылается ТОЛЬКО в панель — она
    // владелец настроек: снимет тумблер и разошлёт настройки обратно. Имя блока
    // проверяется по списку, как источник у report-scale: значение идёт из рендерера
    // и попадает в поиск элемента по id.
    ipcMain.on('display-block-hidden', (_event, payload) => {
        if (!isPayloadObject(payload)) { return; }
        const { block } = payload;
        if (typeof block !== 'string' || !DISPLAY_BLOCK_TOGGLES.has(block)) { return; }
        safelySendToWindow(windows.controlWindow, 'block-hidden', { block });
    });

    // Пресет вида, нажатый Ctrl+1…4 в окне, где профиля нет. Применяет его ПАНЕЛЬ:
    // она единственная раскладывает ключи по контролам и рассылает их окнам, и
    // вторая дорога до окон разошлась бы с первой на первой же новой настройке.
    ipcMain.on('preset-apply', (_event, payload) => {
        if (!isPayloadObject(payload)) { return; }
        const slot = Number(payload.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 4) { return; }
        safelySendToWindow(windows.controlWindow, 'preset-apply', { slot });
    });

    // Мастер-звук по клавише Z из окна, где звука нет: играет и хранит его панель.
    // Payload нет — это просьба «переключи», а не передача значения; знать, во что
    // переключить, окну неоткуда, и присланное им значение спорило бы с панелью.
    ipcMain.on('sound-toggle', () => {
        safelySendToWindow(windows.controlWindow, 'sound-toggle');
    });

    // Перечитать места и масштабы карточек. Payload нет: профиль общий для всех
    // окон приложения, и всё, что нужно окну, уже лежит в нём — это сигнал
    // «перечитай», а не передача данных.
    ipcMain.on('display-restore-state', () => {
        safelySendToWindow(windows.displayWindow, 'display-restore-state');
    });

    // Ответ НЕ запоминается в lastDisplaySettings намеренно — это действие, а не
    // состояние: досланное при открытии окна, оно затирало бы перетаскивания.
    ipcMain.on('display-layout', (_event, payload) => {
        if (!isPayloadObject(payload)) { return; }
        const { layout } = payload;
        if (typeof layout !== 'string' || !DISPLAY_LAYOUT_IDS.has(layout)) { return; }
        safelySendToWindow(windows.displayWindow, 'display-layout', { layout });
    });

    // Отправителя не исключаем: применение темы ничего обратно не посылает, цикла
    // быть не может, а повторное применение того же значения идемпотентно.
    ipcMain.on('ui-theme-update', (_event, payload) => {
        if (!isPayloadObject(payload)) { return; }
        const theme = payload.theme;
        if (typeof theme !== 'string' || !UI_THEME_VALUES.has(theme)) { return; }
        for (const win of [windows.controlWindow, windows.widgetWindow, windows.displayWindow, windows.clockWidgetWindow]) {
            safelySendToWindow(win, 'ui-theme-update', { theme });
        }
    });

    // Замок «Закрепить положение». Та же природа, что у темы: величина одна на всё
    // приложение, ставится панелью, применяется ВЕЗДЕ — значит рассылка, а не
    // адресная отправка. Отправителя не исключаем: применение замка ничего обратно
    // не шлёт, а повторное применение того же значения идемпотентно.
    ipcMain.on('ui-lock-update', (_event, payload) => {
        if (!isPayloadObject(payload)) { return; }
        const locked = payload.locked;
        if (typeof locked !== 'boolean') { return; }
        for (const win of [windows.controlWindow, windows.widgetWindow, windows.displayWindow, windows.clockWidgetWindow]) {
            safelySendToWindow(win, 'ui-lock-update', { locked });
        }
    });
}

module.exports = { registerRelayIpc, SCALE_REPORT_SOURCES };
