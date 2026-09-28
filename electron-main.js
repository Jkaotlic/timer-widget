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
//  - объединение процессов: `--single-process` сводит рендерер и главный
//    процесс в один (рендерер получает те же права, что и он);
//    `--in-process-gpu` сводит в главный процесс GPU-процесс (не рендерер);
//    `--no-zygote` НЕ сводит процессы — отключает промежуточный
//    zygote-процесс (см. ниже), из-за чего рендереры порождаются главным
//    процессом напрямую, минуя уже настроенный сэндбоксированный шаблон;
//  - снятие изоляции origin/CSP: `--disable-web-security`,
//    `--disable-site-isolation-trials`;
//  - `--allow-file-access-from-files` — file:// читает file://, обходя CSP
//    страницы даже с фьюзом file:// не тронутым;
//  - `--remote-allow-origins` — открывает DevTools-протокол произвольному
//    origin (та же дыра, что `--remote-debugging-port`, с другой стороны);
//  - режим разработчика (2.12.1, требование ПСИ «выключен везде, жёстко»):
//    свой ключ приложения `--dev` (в сборке включал подробный лог и монитор
//    памяти; DevTools он не открывал и не открывает) и отладочные ключи
//    Chromium — `--enable-logging`, `--v`, `--vmodule` (подробный журнал
//    Chromium), `--auto-open-devtools-for-tabs`. Опасности в них меньше, чем в
//    остальных, но собранная версия не должна иметь ни одного входа в режим
//    разработчика — отказ проще доказать, чем «включается, но безвредно».
//
// `--zygote-cmd-prefix` НЕ в списке: САМ браузерный (главный) процесс форкает
// zygote-процесс на старте, ДО того как управление доходит до JS этого
// файла, — не наоборот, main-процесс тут родитель, а не потомок zygote. К
// моменту, когда этот файл начинает исполняться, zygote уже поднят с тем
// префиксом, что был передан: проверить и отказать здесь физически поздно.
// Это задокументированный, а не забытый пробел — закрывается только правами
// локального пользователя (SECURITY.md).
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
    'allow-file-access-from-files', 'remote-allow-origins',
    'dev', 'enable-logging', 'v', 'vmodule', 'auto-open-devtools-for-tabs',
    'trace-startup', 'trace-startup-file'
];

// Те же входы в режим разработчика БЕЗ ключа — переменными окружения
// Electron (ревью 2.12.1): ELECTRON_ENABLE_LOGGING по документации Electron —
// «то же, что --enable-logging», ELECTRON_LOG_FILE — куда писать этот журнал,
// ELECTRON_LOG_ASAR_READS и ELECTRON_ENABLE_STACK_DUMPING — отладочные журнал
// чтений asar и дамп стека. Фьюзы их не закрывают (фьюзы — про RunAsNode,
// NODE_OPTIONS и inspect). Запрещены самим НАЛИЧИЕМ, даже пустые: гард не
// гадает, какое значение Electron сочтёт включением.
const FORBIDDEN_ENV = [
    'ELECTRON_ENABLE_LOGGING', 'ELECTRON_LOG_FILE', 'ELECTRON_LOG_ASAR_READS', 'ELECTRON_ENABLE_STACK_DUMPING'
];

// Смотрим на process.argv, а НЕ на app.commandLine.hasSwitch() (fix-round-2,
// 28.09.2026): деб-запуск в CI (прогон 36398413388, все шесть ячеек «deb
// install + launch») поймал собранный пакет, падающий на КАЖДОМ старте со
// строкой про ключ «--allow-file-access-from-files» — хотя
// НИКТО такой ключ не передавал. Причина: сборка держит фьюз
// GrantFileProtocolExtraPrivileges (package.json → electronFuses, нужен
// localStorage на file:// при переносе настроек), и Electron САМ дописывает
// `--allow-file-access-from-files` в ИТОГОВУЮ командную строку Chromium ради
// этого фьюза. `app.commandLine.hasSwitch()` читает ИТОГОВУЮ строку — она
// видит и то, что дописал сам Electron, а не только то, что передал
// пользователь. `process.argv` — то, с чем реально запустили процесс.
//
// Совпадение — ТОЧНОЕ имя, не префикс: `--no-sandbox-foo` не обязан совпасть
// с `no-sandbox`, а `--inspect` — с `inspect-brk` (и наоборот). Принимаются
// обе формы, которые понимает Chromium везде: `--name`/`--name=значение` и
// однодефисная `-name`/`-name=значение`.
//
// `platform` — параметр, а не молчаливое чтение `process.platform` внутри
// (fix-round-3, 28.09.2026, найдено повторным ревью): у Chromium на Windows
// РАЗБОР ключей командной строки отличается от POSIX в двух местах
// (base/command_line.cc, kSwitchPrefixes):
//  - третий допустимый префикс — одиночный `/` (`/no-sandbox` — настоящий
//    ключ на Windows). На POSIX `/` НЕ префикс ключа ни в коем случае: так
//    начинается абсолютный путь (argv[0] деб-пакета — `/opt/TimerWidget/…`),
//    и трактовать его как ключ значило бы отказывать в запуске по имени
//    каталога;
//  - имя ключа приводится к нижнему регистру ДО сравнения — `--No-Sandbox` и
//    `--NO-SANDBOX` там работают как `no-sandbox`. На POSIX регистр значащий.
// Старый гард на app.commandLine.hasSwitch() (fix-round-2) закрывал оба
// случая бесплатно — Chromium сам нормализовал ключ до того, как гард его
// увидел. Прямое чтение process.argv эту нормализацию потеряло: тест на
// argv-регресс (round 2) проверял только POSIX-форму, и `/no-sandbox`/
// `--No-Sandbox` на собранном Windows (NSIS и portable, оба в build.files)
// проходили бы мимо гарда необнаруженными.
function findForbiddenArgv(argv, names, platform = process.platform) {
    const isWin = platform === 'win32';
    const SWITCH_RE = isWin ? /^(?:--?|\/)([^=]+)(?:=.*)?$/ : /^--?([^=]+)(?:=.*)?$/;
    for (const raw of argv) {
        if (typeof raw !== 'string') { continue; }
        const m = SWITCH_RE.exec(raw);
        if (!m) { continue; }
        const name = isWin ? m[1].toLowerCase() : m[1];
        if (names.includes(name)) { return name; }
    }
    return undefined;
}

const __forbiddenSwitchFound = app.isPackaged
    ? findForbiddenArgv(process.argv, FORBIDDEN_SWITCHES)
    : undefined;
const __forbiddenEnvFound = app.isPackaged
    ? FORBIDDEN_ENV.find((name) => process.env[name] !== undefined)
    : undefined;
// Формулировка нейтральна: в списке и ключи, снимающие изоляцию, и ключи
// режима разработчика — «ослабляет изоляцию» про `--dev` было бы неправдой в
// строке, которую читают проверяющие. scripts/linux-launch-check.sh ищет её.
if (__forbiddenSwitchFound || __forbiddenEnvFound) {
    console.error(__forbiddenSwitchFound
        ? `[TimerWidget] ключ «--${__forbiddenSwitchFound}» запрещён в собранном приложении — выход`
        : `[TimerWidget] переменная окружения ${__forbiddenEnvFound} запрещена в собранном приложении — выход`);
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
// Второй замок режима разработчика: собранное приложение с --dev уже вышло
// выше (FORBIDDEN_SWITCHES), но и без того подробный лог в сборке не включится.
log.transports.console.level = (process.argv.includes('--dev') && !app.isPackaged) ? 'debug' : 'warn';
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

// Test-mode guard, которому main-lifecycle.js и main-windows.js доверяют
// снять single-instance-lock и спрятать окна за экран (--screenshot), а
// main-recovery.js — не заводить периодическую запись восстановления.
//
// `!app.isPackaged` — R3 (2026-09-28 ПСИ, поправлено ревью fix-round-1): без
// него СОБРАННОЕ приложение, унаследовавшее NODE_TEST_CONTEXT из окружения
// (или запущенное с `--screenshot`), включило бы тот же бесконтрольный
// режим — снятый single-instance-lock у распространяемого бинарника означает,
// что вторая невидимая копия может запуститься рядом с первой, а невыключенная
// периодическая запись, наоборот, ДОЛЖНА идти у любого собранного приложения
// независимо от того, что унаследовано в env. Флаг — ЕДИНСТВЕННЫЙ: раньше
// здесь был второй, «сырой», не зависящий от isPackaged — он решал ту же
// задачу неверно (main-recovery.js пропускал бы периодическую запись у
// СОБРАННОГО приложения с чужой NODE_TEST_CONTEXT в env, что и было находкой
// ревью). Правильное решение — не второй флаг, а `.unref()` у самого
// интервала (main-recovery.js): под node:test с подставным isPackaged=true
// (SEC-04/R1, R3) он всё равно заводится по-настоящему, но не держит процесс.
const __inTestMode = !app.isPackaged && process.env.NODE_TEST_CONTEXT !== undefined;

// Screenshot mode — scripted capture sequence (see scripts/screenshot-runner.js).
// When active, all windows boot hidden/offscreen so the desktop isn't disturbed.
// `!app.isPackaged` — та же причина, что у __inTestMode выше (R3).
const __screenshotMode = !app.isPackaged && process.argv.includes('--screenshot');

// Runtime memory monitor (dev only, not in tests, never in the packaged app).
if (process.argv.includes('--dev') && !app.isPackaged && !__inTestMode) {
    const memoryMonitorInterval = setInterval(() => {
        const mem = process.memoryUsage();
        log.debug(`[perf] heap: ${(mem.heapUsed/1024/1024).toFixed(1)}MB rss: ${(mem.rss/1024/1024).toFixed(1)}MB`);
    }, 60000);
    // unref() — та же причина, что у recoverySaveInterval в main-recovery.js:
    // монитор — диагностика, а не то, что обязано держать процесс живым, и
    // под node:test с подставным isPackaged=true+--dev он был бы висящим
    // таймером без унрефа.
    if (typeof memoryMonitorInterval.unref === 'function') { memoryMonitorInterval.unref(); }
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
    windows, log, safelySendToWindow, CONFIG,
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
