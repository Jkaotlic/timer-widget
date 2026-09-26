'use strict';

/**
 * main-control-ipc.js — каналы окна панели и приложения: размер панели,
 * потолок ширины под ящик, режим «полоса», страница релизов, выход и сброс
 * профиля.
 *
 * Все эти каналы шлёт только панель (ipc-senders.js), а `ipcMain` сюда
 * приходит уже обвязанным проверкой отправителя (SEC-07).
 */

// Страница релизов. Адрес — КОНСТАНТА в main-процессе, и это единственно
// безопасная форма: shell.openExternal с адресом, пришедшим из рендерера, —
// это выполнение произвольного URL руками ОС (file://, а на Windows и куда
// хуже). Поэтому канал не принимает payload вообще: рендерер может лишь
// сказать «открой», но не «открой ЧТО».
//
// Автообновления по-прежнему нет и не будет — релизный гейт это стережёт.
// Приложение не ходит в сеть само: страница открывается в браузере
// пользователя и только по явному клику.
const RELEASES_URL = 'https://github.com/Jkaotlic/timer-widget/releases';

/**
 * @param {object} deps
 * @param {object} deps.ipcMain — обвязка ipc-senders.guardIpcMain
 * @param {object} deps.windows — реестр окон (main-state.js)
 * @param {object} deps.screen
 * @param {object} deps.CONFIG
 * @param {object} deps.shell — electron.shell
 * @param {object} deps.app
 * @param {object} deps.log
 * @param {() => object} deps.getSession — electron.session, берётся в момент вызова
 * @param {() => void} deps.clearTimerInterval — main-timer.js
 */
function registerControlIpc({ ipcMain, windows, screen, CONFIG, shell, app, log, getSession, clearTimerInterval, settleMigration }) {
    // Изменение размера окна управления
    // size.width / size.height опциональны: если поле не передано (или не Finite),
    // соответствующее измерение не меняется. Это нужно, чтобы drawer open/close
    // менял ТОЛЬКО ширину — иначе перезапись height=window.innerHeight округляется
    // при каждом setSize (HiDPI) и сбивает ручную высоту, которую выставил юзер.
    ipcMain.on('resize-control-window', (event, size) => {
        if (!windows.controlWindow || !size || typeof size !== 'object') { return; }
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
        const [curW, curH] = windows.controlWindow.getSize();
        const w = Number.isFinite(size.width) ? size.width : curW;
        const h = Number.isFinite(size.height) ? size.height : curH;
        // Нижний clamp = BrowserWindow min (см. createControlWindow). Верхний —
        // ДЕЙСТВУЮЩИЙ потолок окна, а не константа: он двухуровневый и зависит от
        // того, открыт ли ящик (канал control-drawer). Без этого слагаемого запрос
        // «дай 3000» проходил бы мимо потолка в setSize и обрезался уже Electron'ом,
        // а вычисленный тут targetWidth расходился бы с фактическим размером.
        const [ceilingW, ceilingH] = windows.controlWindow.getMaximumSize();
        const maxW = ceilingW > 0 ? ceilingW : CONFIG.CONTROL_WINDOW_MAX_WIDTH_WITH_DRAWER;
        const maxH = ceilingH > 0 ? ceilingH : CONFIG.CONTROL_WINDOW_MAX_HEIGHT_WITH_DRAWER;
        const targetWidth = Math.max(
            CONFIG.CONTROL_WINDOW_MIN_WIDTH,
            Math.min(w, screenWidth - 50, maxW)
        );
        const targetHeight = Math.max(
            CONFIG.CONTROL_WINDOW_MIN_HEIGHT,
            Math.min(h, screenHeight - 50, maxH)
        );

        // No-op если ничего не меняется — избегаем лишнего setSize (WM на Windows
        // иногда округляет outer на 1px при каждом вызове, что даёт дрейф).
        if (targetWidth === curW && targetHeight === curH) { return; }

        const [x, y] = windows.controlWindow.getPosition();
        windows.controlWindow.setSize(targetWidth, targetHeight);

        if (y + targetHeight > screenHeight) {
            windows.controlWindow.setPosition(x, Math.max(0, screenHeight - targetHeight - 20));
        }
    });

    // Ящик настроек — ВТОРОЙ уровень потолка ширины окна управления.
    //
    // Потолок задан при создании окна и из рендерера не снимается — та же причина,
    // по которой отдельным каналом живёт режим «полоса». Уровней два: без ящика
    // окно не шире колонки контента с полями (CONTROL_WINDOW_MAX_WIDTH), с ящиком —
    // плюс его 336px. Иначе окно растягивалось до 1200 при колонке 720, панель
    // тонула в поле, и ради оправдания этого поля в CSS жила вторая оболочка.
    //
    // Уровень НЕ выводится из ширины в запросе resize-control-window: тогда потолок
    // поднимал бы любой запрос, то есть потолка не было бы вовсе. Сообщает о нём
    // та единственная сторона, которая про ящик знает, — панель.
    ipcMain.on('control-drawer', (_event, payload) => {
        if (!windows.controlWindow || windows.controlWindow.isDestroyed() || !payload || typeof payload !== 'object') { return; }
        const open = payload.open === true;
        const ceilingW = open
            ? CONFIG.CONTROL_WINDOW_MAX_WIDTH_WITH_DRAWER
            : CONFIG.CONTROL_WINDOW_MAX_WIDTH;
        const ceilingH = open
            ? CONFIG.CONTROL_WINDOW_MAX_HEIGHT_WITH_DRAWER
            : CONFIG.CONTROL_WINDOW_MAX_HEIGHT;
        const [curMaxW] = windows.controlWindow.getMaximumSize();
        if (curMaxW === ceilingW) { return; }

        windows.controlWindow.setMaximumSize(ceilingW, ceilingH);

        // setMaximumSize НЕ сжимает уже растянутое окно — оно останется больше
        // нового потолка до первого ручного ресайза. Подтягиваем сами, иначе после
        // закрытия ящика окно осталось бы 1096px шириной при панели 720px, то есть
        // ровно в том состоянии, ради устранения которого потолок и опускается.
        const [curW, curH] = windows.controlWindow.getSize();
        if (curW > ceilingW || curH > ceilingH) {
            const [x, y] = windows.controlWindow.getPosition();
            windows.controlWindow.setSize(Math.min(curW, ceilingW), Math.min(curH, ceilingH));
            windows.controlWindow.setPosition(x, y);
        }
    });

    // Свёрнутое состояние окна управления — режим «полоса».
    //
    // Пол минимального размера (minHeight: 660) задан при создании окна, и снять
    // его из рендерера нельзя — поэтому режим живёт здесь. Порядок важен: сначала
    // снять пол, потом сжимать, иначе setSize молча обрежется до 660 и получится
    // худшее из двух состояний — окно панелью, разметка полосой.
    //
    // Верхний край держится намеренно: полоса встаёт туда, где был титлбар, и
    // шеврон не убегает из-под курсора, который по нему кликнул. Правило проекта
    // «держать ЦЕНТР при изменении размера» относится к Ctrl+колесу в виджете и
    // часах, где содержимое растёт вокруг себя и курсор ни к чему не привязан;
    // здесь источник — клик по конкретной кнопке вверху окна.
    let controlBoundsBeforeCollapse = null;

    ipcMain.on('control-collapse', (_event, payload) => {
        if (!windows.controlWindow || windows.controlWindow.isDestroyed() || !payload || typeof payload !== 'object') { return; }
        const collapsed = payload.collapsed === true;
        const [curW] = windows.controlWindow.getSize();

        if (collapsed) {
            // Высота приходит из рендерера (её знает CSS), но доверять ей нельзя:
            // это тот же непроверенный payload, что и во всех остальных
            // обработчиках размеров.
            const raw = Number.isFinite(payload.height) ? payload.height : 52;
            const barHeight = Math.max(36, Math.min(120, Math.round(raw)));

            controlBoundsBeforeCollapse = windows.controlWindow.getBounds();
            const { x, y } = controlBoundsBeforeCollapse;
            windows.controlWindow.setMinimumSize(CONFIG.CONTROL_WINDOW_MIN_WIDTH, 1);
            // Ширину задаёт СОДЕРЖИМОЕ полосы: в ней время, четыре ячейки вида,
            // замок и управление отсчётом, и на 400px этот набор не помещается.
            // Пол, а не размер: окно шире пола сворачивается со своей шириной, а
            // разворот всё равно вернёт прежние границы целиком.
            const barWidth = Math.max(curW, CONFIG.CONTROL_BAR_MIN_WIDTH);
            windows.controlWindow.setSize(barWidth, barHeight);
            windows.controlWindow.setPosition(x, y);   // держим ВЕРХНИЙ край
            windows.controlWindow.setAlwaysOnTop(true);
            return;
        }

        // Разворот: пол возвращается ДО восстановления границ, иначе окно можно
        // оставить панелью высотой 52 — это обрезанная раскладка, которую чинила
        // задача про минимальную высоту.
        windows.controlWindow.setMinimumSize(CONFIG.CONTROL_WINDOW_MIN_WIDTH, CONFIG.CONTROL_WINDOW_MIN_HEIGHT);
        windows.controlWindow.setAlwaysOnTop(false);
        const prev = controlBoundsBeforeCollapse;
        if (prev) {
            windows.controlWindow.setBounds(prev);
            controlBoundsBeforeCollapse = null;
        } else {
            windows.controlWindow.setSize(curW, CONFIG.CONTROL_WINDOW_MIN_HEIGHT);
        }
    });

    // Управление окном панели управления
    ipcMain.on('open-releases-page', () => {
        shell.openExternal(RELEASES_URL).catch((err) => {
            log.warn('не удалось открыть страницу релизов:', err && err.message);
        });
    });

    ipcMain.on('quit-app', () => {
        clearTimerInterval();
        app.quit();
    });

    ipcMain.on('reset-and-relaunch', async () => {
        clearTimerInterval();
        const session = getSession();
        try {
            await Promise.all([
                session.defaultSession.clearStorageData(),
                session.defaultSession.clearCache()
            ]);
        } catch (err) {
            log.error('Storage clear failed:', err);
        }
        // Сброс сильнее переноса: без метки сверка следующего запуска увидела
        // бы пустой app:// и вернула старые настройки из file://.
        try {
            if (settleMigration) { settleMigration(); }
        } catch (err) {
            log.warn('метка переноса после сброса не записана:', err && err.message);
        }
        app.quit();
    });
}

module.exports = { registerControlIpc, RELEASES_URL };
