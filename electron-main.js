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

// Ключи, ослабляющие изоляцию СОБРАННОГО приложения, — выход до первого окна
// (SEC-04, добивка перед повторной сдачей ПСИ, R1 в
// docs/superpowers/specs/2026-09-28-psi-hardening.md). Список разбит на классы
// по тому, ЧТО каждый ключ открывает:
//
//  - отладка: `--remote-debugging-port/-pipe` открывают DevTools-протокол
//    Chromium — через него исполняется любой код в любом окне, мимо sandbox,
//    CSP и белого списка IPC. `--inspect*` в сборке уже глушит фьюз
//    EnableNodeCliInspectArguments (package.json → electronFuses); проверка
//    здесь — второй замок на случай сборки без фьюзов. Гард
//    `devTools: … && !app.isPackaged` в окнах тут не помогает: протокол живёт
//    в самом Chromium, а не в окне;
//  - снятие песочницы Chromium: `--no-sandbox` и соседи выключают ту же
//    защиту, что даёт `sandbox: true` у каждого окна (main-windows.js) — ключ
//    командной строки её просто обходит. `--disable-sandbox` в самом Chromium
//    не существует, но заблокировать его дёшево — вдруг появится;
//  - подмена запуска дочерних процессов: `--renderer-cmd-prefix`,
//    `--gpu-launcher`, `--utility-cmd-prefix`, `--browser-subprocess-path`
//    заставляют Chromium исполнить произвольный бинарник вместо
//    рендерера/GPU/утилитного процесса; `--js-flags` передаёт V8 флаги
//    исполнения (например, разрешающие небезопасный код) в те же процессы;
//  - объединение процессов: `--single-process`/`--in-process-gpu`/`--no-zygote`
//    сводят рендерер и главный процесс в один — рендерер получает те же
//    права, что и он;
//  - снятие изоляции origin/CSP: `--disable-web-security`,
//    `--disable-site-isolation-trials`;
//  - `--allow-file-access-from-files` — file:// читает file://, обходя CSP
//    страницы даже с фьюзом file:// не тронутым;
//  - `--remote-allow-origins` — открывает DevTools-протокол произвольному
//    origin (та же дыра, что `--remote-debugging-port`, с другой стороны).
//
// `--zygote-cmd-prefix` НЕ в списке: Chromium форкает zygote-процесс до
// исполнения этого файла (main-процесс — уже потомок zygote), проверка в JS
// физически не успевает. Это задокументированный, а не забытый пробел —
// закрывается только правами локального пользователя (SECURITY.md).
//
// Только при isPackaged: Playwright поднимает НЕсобранное приложение именно с
// `--remote-debugging-port` (и e2e/CI используют `--no-sandbox` в контейнерах
// без пользовательских неймспейсов) — так к нему и подключаются.
//
// app.exit до `ready` лишь назначает выход, а модуль продолжил бы исполняться —
// зарегистрировал бы IPC и дождался бы whenReady. process.exit гарантирует, что
// после проверки не выполнится ни строки.
const FORBIDDEN_SWITCHES = [
    'remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk',
    'no-sandbox', 'disable-sandbox', 'disable-gpu-sandbox', 'disable-setuid-sandbox',
    'disable-namespace-sandbox', 'disable-seccomp-filter-sandbox',
    'disable-web-security', 'disable-site-isolation-trials',
    'single-process', 'in-process-gpu', 'no-zygote',
    'renderer-cmd-prefix', 'gpu-launcher', 'utility-cmd-prefix', 'browser-subprocess-path', 'js-flags',
    'allow-file-access-from-files', 'remote-allow-origins'
];
const __forbiddenSwitchFound = app.isPackaged
    ? FORBIDDEN_SWITCHES.find((name) => app.commandLine.hasSwitch(name))
    : undefined;
if (__forbiddenSwitchFound) {
    console.error(`[TimerWidget] ключ «--${__forbiddenSwitchFound}» ослабляет изоляцию собранного приложения — выход`);
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

// Сырой признак: исполняемся ли мы под `node --test` вообще. Electron там
// подставной (tests/electron-main-load.test.js), поэтому по нему выключают
// побочные эффекты с РЕАЛЬНЫМИ таймерами — периодическую запись восстановления
// (main-recovery.js) и монитор памяти ниже. Признак НЕ зависит от isPackaged:
// это чистая деталь тестового окружения, а не то, что должен уметь снимать с
// себя собранный бинарник (то ниже, с другим именем).
const __nodeTestContext = process.env.NODE_TEST_CONTEXT !== undefined;

// Test-mode guard, которому main-lifecycle.js и main-windows.js доверяют
// снять single-instance-lock и спрятать окна за экран (--screenshot).
//
// `!app.isPackaged` — R3 (2026-09-28 ПСИ): без него СОБРАННОЕ приложение,
// унаследовавшее NODE_TEST_CONTEXT из окружения (или запущенное с
// `--screenshot`), включило бы тот же бесконтрольный режим — снятый
// single-instance-lock у распространяемого бинарника означает, что вторая
// невидимая копия может запуститься рядом с первой. Признак НАМЕРЕННО другой,
// чем __nodeTestContext выше: тому не нужен isPackaged (он про тестовый
// раннер), этому нужен (он про доверие ключам собранного приложения).
const __inTestMode = !app.isPackaged && __nodeTestContext;

// Screenshot mode — scripted capture sequence (see scripts/screenshot-runner.js).
// When active, all windows boot hidden/offscreen so the desktop isn't disturbed.
// `!app.isPackaged` — та же причина, что у __inTestMode выше (R3).
const __screenshotMode = !app.isPackaged && process.argv.includes('--screenshot');

// Runtime memory monitor (dev only, not in tests). __nodeTestContext, а не
// __inTestMode: под node:test с подставным isPackaged=true (тесты SEC-04/R1)
// монитору всё равно нельзя заводить настоящий setInterval.
if (process.argv.includes('--dev') && !__nodeTestContext) {
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
    // __nodeTestContext, не __inTestMode: периодическая запись на диск — забота
    // тестового раннера, а не барьера R3 (см. комментарий у __nodeTestContext).
    getUserDataPath, flags, isAtRest, log, inTestMode: __nodeTestContext,
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
