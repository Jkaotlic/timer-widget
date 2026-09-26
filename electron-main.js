// [perf] Capture process start as early as possible for startup timing.
const __startupT0 = Date.now();

// Guard: ELECTRON_RUN_AS_NODE в окружении превращает electron.exe в голой Node
// без Chromium/main-process API, и require('electron') возвращает строку-путь,
// а не API-модуль. Сообщаем ясно вместо непонятного 'Cannot read app.getVersion'.
if (process.env.ELECTRON_RUN_AS_NODE) {
    console.error(
        '\n[TimerWidget] ELECTRON_RUN_AS_NODE=%s is set in the environment.\n' +
        '  Это переменная Electron для запуска electron.exe как обычной Node.js.\n' +
        '  Приложение не может стартовать в таком режиме. Снимите её:\n' +
        '    PowerShell: $env:ELECTRON_RUN_AS_NODE=""\n' +
        '    cmd.exe:    set ELECTRON_RUN_AS_NODE=\n' +
        '    bash/zsh:   unset ELECTRON_RUN_AS_NODE\n',
        process.env.ELECTRON_RUN_AS_NODE
    );
    process.exit(1);
}

const { app, BrowserWindow, ipcMain: rawIpcMain, screen, Menu, Tray, nativeImage, powerMonitor, shell, dialog, protocol } = require('electron');

// Ключи отладки в СОБРАННОМ приложении — выход до первого окна (SEC-04).
//
// `--remote-debugging-port/-pipe` открывают DevTools-протокол Chromium: через
// него исполняется любой код в любом окне — мимо sandbox, CSP и белого списка
// IPC, и гард `devTools: … && !app.isPackaged` в окнах тут не помогает, потому
// что протокол живёт в самом Chromium, а не в окне. `--inspect*` в сборке уже
// глушит фьюз EnableNodeCliInspectArguments (package.json → electronFuses);
// проверка здесь — второй замок на случай сборки без фьюзов.
//
// Только при isPackaged: Playwright поднимает НЕсобранное приложение именно с
// `--remote-debugging-port`, так он к нему и подключается.
//
// app.exit до `ready` лишь назначает выход, а модуль продолжил бы исполняться —
// зарегистрировал бы IPC и дождался бы whenReady. process.exit гарантирует, что
// после проверки не выполнится ни строки.
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk'];
if (app.isPackaged && DEBUG_SWITCHES.some((name) => app.commandLine.hasSwitch(name))) {
    console.error('[TimerWidget] ключи отладки в собранном приложении запрещены — выход');
    app.exit(1);
    process.exit(1);
}

// Точка входа главного процесса. До 25.09.2026 здесь жил весь главный процесс
// (2363 строки); теперь — только порядок: гарды до всего остального, журнал,
// краш-обработчики, ключи Chromium, общее состояние, обвязка IPC — и сборка
// модулей main-*.js. Карта модулей — в CLAUDE.md и docs/main-process.md.
//
// Правила сборки:
//  • electron и electron-log требует ТОЛЬКО этот файл; модули получают их
//    параметрами. Тест electron-main-load подменяет electron на каждый прогон,
//    и модуль, закэшировавший electron у себя, держал бы чужую подставку.
//  • общее изменяемое состояние (окна, память ретрансляторов, isQuitting)
//    создаётся здесь ОДИН раз (main-state.js) и передаётся модулям;
//  • настоящий ipcMain (rawIpcMain) не покидает этот файл — модули получают
//    только обвязку с проверкой отправителя (SEC-07).
const NavigationGuard = require('./navigation-guard');
const AppScheme = require('./app-scheme');
const { createAppProtocolHandler, registerAppProtocol } = require('./main-app-protocol');
const { migrateStorage, hasStorageDir, markSettledAfterReset } = require('./main-storage-migration');
const IpcSenders = require('./ipc-senders');
const fs = require('fs');
const path = require('path');
const log = require('electron-log/main');
const { safelySendToWindow } = require('./utils');
const CONFIG = require('./constants');
const MainState = require('./main-state');
const { createWindowClosing } = require('./main-window-closing');
const { createWindowGeometry } = require('./main-geometry');
const { createWindowHooks } = require('./main-window-hooks');
const { createWindows } = require('./main-windows');
const { createTimer } = require('./main-timer');
const { createRecoverySnapshot } = require('./main-recovery');
const { createEventOverrun, isAtRest } = require('./main-event-overrun');
const { createTrayController } = require('./main-tray');
const { registerWindowIpc } = require('./main-window-ipc');
const { registerControlIpc } = require('./main-control-ipc');
const { registerRelayIpc } = require('./main-relay-ipc');
const { startApp } = require('./main-lifecycle');

// Logger setup
//
// preload: false — без него electron-log регистрирует ВТОРОЙ preload в каждой
// сессии: он кладёт в окна `window.__electronLog` и открывает канал
// `__ELECTRON_LOG__` мимо белого списка preload.js (SEC-05). Рендерерам он не
// нужен: их консоль попадает в журнал через `console-message`
// (bindRenderConsole в main-window-hooks.js).
log.initialize({ preload: false });
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB per file
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.level = process.argv.includes('--dev') ? 'debug' : 'warn';
log.info(`TimerWidget starting — version ${app.getVersion()}, platform ${process.platform}`);

// Crash handlers
// Снимок — только если есть что восстанавливать: в покое запись снимка
// «восстановила» бы то, что и так на экране, с пометкой о сбое (BUG-07).
// Живой перелимит — туда же, в pending накопителя (BUG-04).
//
// Обработчики ставятся раньше, чем собраны модули, которые они зовут: сбой до
// сборки ловится `try` (модуля ещё нет — нечего и сохранять).
process.on('uncaughtException', (err) => {
    log.error('UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
    try { recoverySnapshot.persistRecoverySnapshot(); } catch { /* best effort */ }
    try { events.persistPendingOverrun(); } catch { /* best effort */ }
});
process.on('unhandledRejection', (reason) => {
    log.error('UNHANDLED REJECTION:', reason);
    try { recoverySnapshot.persistRecoverySnapshot(); } catch { /* best effort */ }
    try { events.persistPendingOverrun(); } catch { /* best effort */ }
});

// Chromium phones home by default: Component Updater → update.googleapis.com /
// redirector.gvt1.com (Widevine, Safe Browsing, CRLSet, …), Variations Service →
// clientservices.googleapis.com, Optimization Hints → optimizationguide-pa.
// Таймер-виджет не использует ни один из этих компонентов, поэтому глушим
// фоновую сеть целиком — иначе отчёты security-аудита фиксируют исходящий
// трафик на Google-инфраструктуру при чисто офлайновом приложении.
// Switches должны быть применены до app ready, поэтому ставим на импорте.
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-features', 'ChromeVariations,OptimizationHints');

// Своя схема окон app://timer-widget/ (SEC-12) — регистрируется ДО `ready`:
// привилегии схемы Chromium читает один раз при старте. Обработчик запросов
// ставит main-lifecycle.js (registerProtocol) в whenReady, раньше первого окна.
protocol.registerSchemesAsPrivileged([AppScheme.PRIVILEGED_SCHEME]);

// Было ли у профиля хранилище ДО этого запуска — снимается сейчас, при
// загрузке: Chromium создаёт каталог `Local Storage`, как только тронута
// defaultSession, и в whenReady он есть уже и у нового профиля. Без каталога
// переносить нечего, и скрытое окно переноса не создаётся вовсе.
const __hadStorageAtStart = hasStorageDir(app.getPath('userData'));

// Test-mode guard — node:test stubs 'electron', we skip runtime side-effects.
const __inTestMode = process.env.NODE_TEST_CONTEXT !== undefined;

// Screenshot mode — scripted capture sequence (see scripts/screenshot-runner.js).
// When active, all windows boot hidden/offscreen so the desktop isn't disturbed.
const __screenshotMode = process.argv.includes('--screenshot');

// Runtime memory monitor (dev only, not in tests)
if (process.argv.includes('--dev') && !__inTestMode) {
    setInterval(() => {
        const mem = process.memoryUsage();
        log.debug(`[perf] heap: ${(mem.heapUsed/1024/1024).toFixed(1)}MB rss: ${(mem.rss/1024/1024).toFixed(1)}MB`);
    }, 60000);
}

// Общее изменяемое состояние — один владелец на весь главный процесс.
const windows = MainState.createWindowRegistry();
const relay = MainState.createRelayMemory();
const flags = MainState.createAppFlags();

// Защита от навигации и открытия новых окон (SEC-06).
//
// Переход разрешён ТОЛЬКО на четыре страницы приложения — сравнение адресов в
// navigation-guard.js. Прежнее правило «всё, что file://» пускало в окно любой
// HTML с диска вместе с preload-мостом: хватало перетащить файл на виджет.
// С SEC-12 свои страницы — адреса схемы app://timer-widget/, file:// чужой весь.
const APP_PAGE_URLS = NavigationGuard.appPageUrls();

function logBlockedNavigation(kind, url) {
    log.warn(`[nav] отклонено ${kind}: ${NavigationGuard.describeUrl(url)}`);
}

// Кто вправе прислать канал (SEC-07). `ipcMain` ниже — обвязка над настоящим:
// каждый `ipcMain.on('канал', …)` главного процесса регистрируется через неё и
// не может миновать проверку отправителя (окно из строки таблицы
// ipc-senders.js, главный кадр, своя страница). Настоящий ipcMain под другим
// именем и только в этом файле, чтобы обработчик нельзя было повесить мимо
// обвязки по привычке: модули получают только обвязку.
const ipcMain = IpcSenders.guardIpcMain(rawIpcMain, IpcSenders.createSenderGate({
    windowOf: (contents) => BrowserWindow.fromWebContents(contents),
    windowsByRole: () => ({
        control: windows.controlWindow,
        widget: windows.widgetWindow,
        clock: windows.clockWidgetWindow,
        display: windows.displayWindow
    }),
    isAppPage: (url) => NavigationGuard.isAppPageUrl(url, APP_PAGE_URLS),
    onReject: IpcSenders.onceLogger((line) => log.warn(line))
}));

// Те же запреты — на КАЖДЫЙ webContents, который когда-либо появится, а не
// только на четыре окна, которые мы знаем по имени: <webview>, окно, созданное
// в обход create-функции, DevTools-фронтенд. hardenWindow в create-функциях
// остаётся — он ставит запреты в том же месте, где окно родилось, и тест
// release-gates считает его вызовы; двойная установка безвредна (отказ
// дважды — всё ещё отказ).
app.on('web-contents-created', (_event, contents) => {
    NavigationGuard.guardWebContents(contents, APP_PAGE_URLS, logBlockedNavigation);
});

// --- Сборка модулей -------------------------------------------------------
//
// Зависимости у модулей встречные (таймер шлёт в трей, трей зовёт таймер;
// панель привязывает трей, трей создаёт панель), поэтому часть их передана
// стрелками, которые читают модуль в момент ВЫЗОВА, а не сборки. До конца
// сборки ни одна из них не зовётся: окон ещё нет, IPC не пришёл.
const getUserDataPath = () => app.getPath('userData');
const getSession = () => require('electron').session;

const closing = createWindowClosing({ windows });
const geometry = createWindowGeometry({ screen, CONFIG, safelySendToWindow });
const hooks = createWindowHooks({
    windows, log, safelySendToWindow,
    appPageUrls: APP_PAGE_URLS, logBlockedNavigation,
    updateTrayMenu: () => tray.updateTrayMenu()
});
const events = createEventOverrun({
    windows, relay, safelySendToWindow, log, getUserDataPath, dialog,
    getTimerState: () => timer.getState()
});
const recoverySnapshot = createRecoverySnapshot({
    getUserDataPath, flags, isAtRest, log, inTestMode: __inTestMode,
    getTimerState: () => timer.getState()
});
const timer = createTimer({
    windows, CONFIG, safelySendToWindow,
    accrueOverrun: (state) => events.accrueOverrun(state),
    persistRecoverySnapshot: () => recoverySnapshot.persistRecoverySnapshot(),
    updateTrayMenu: () => tray.updateTrayMenu()
});
const creators = createWindows({
    BrowserWindow, screen, app, log, CONFIG, safelySendToWindow,
    windows, relay, hooks, geometry, screenshotMode: __screenshotMode,
    getTimerState: () => timer.getState(),
    eventOverrunPayload: () => events.eventOverrunPayload(),
    bindTrayBehavior: (win) => tray.bindTrayBehavior(win)
});
const tray = createTrayController({
    Tray, Menu, nativeImage, app, log, windows, flags,
    getTimerState: () => timer.getState(),
    timer, creators, closing
});

// --- Каналы IPC — все через обвязку `ipcMain` выше --------------------------
timer.registerIpc(ipcMain);
registerControlIpc({
    ipcMain, windows, screen, CONFIG, shell, app, log, getSession,
    clearTimerInterval: () => timer.clearTimerInterval(),
    settleMigration: () => markSettledAfterReset(app.getPath('userData'))
});
registerRelayIpc({
    ipcMain, windows, relay, safelySendToWindow, log,
    applyWidgetMinimumSize: () => creators.applyWidgetMinimumSize(),
    applyWidgetAlwaysOnTop: (on) => creators.applyWidgetAlwaysOnTop(on)
});
registerWindowIpc({ ipcMain, windows, relay, screen, BrowserWindow, closing, creators, geometry });
events.registerIpc(ipcMain);

// --- Схема app:// и перенос настроек (SEC-12) --------------------------------
//
// Обработчик схемы отдаёт только файлы приложения (список — app-scheme.js);
// каталог — __dirname, в сборке это app.asar. Перенос localStorage из file://
// в app:// — один раз, до первого настоящего окна (main-storage-migration.js).
const registerProtocol = () => registerAppProtocol(protocol, createAppProtocolHandler({
    appDir: __dirname,
    readFile: (file) => fs.promises.readFile(file),
    readText: (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8'),
    log
}));
const prepareStorage = () => migrateStorage({
    userDataPath: getUserDataPath(),
    hadStorageAtStart: __hadStorageAtStart,
    appDir: __dirname,
    BrowserWindow,
    flushStorageData: () => getSession().defaultSession.flushStorageData(),
    log
});

// --- Жизненный цикл: единственный экземпляр, старт, выход ------------------
startApp({
    app, BrowserWindow, Menu, powerMonitor, nativeImage, log, safelySendToWindow, getSession,
    registerProtocol, prepareStorage,
    windows, flags, timer, recoverySnapshot, events, creators, tray,
    inTestMode: __inTestMode, screenshotMode: __screenshotMode, startupT0: __startupT0
});
