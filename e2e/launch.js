'use strict';

/**
 * Общий запуск приложения для Playwright-тестов.
 *
 * Зачем отдельный модуль: переменная ELECTRON_RUN_AS_NODE протекает из
 * родительских процессов (терминал внутри VS Code, Claude Code CLI) и превращает
 * electron в обычную Node — та не понимает `--remote-debugging-port`, который
 * Playwright добавляет сам, и запуск падает с «bad option». Для `npm start` это
 * уже решено в scripts/run-electron.js, но electron.launch() из Playwright идёт
 * мимо того враппера, поэтому окружение чистим здесь.
 *
 * Здесь же задаётся ОТДЕЛЬНЫЙ каталог профиля. Без него e2e работали в реальном
 * профиле пользователя: localStorage всех четырёх окон, геометрия виджета и
 * часов, снимок восстановления — всё это тесты перезаписывали и стирали у живого
 * приложения, а следующий за прогоном `npm run visual:check` сравнивал эталоны с
 * тем, что после себя оставили e2e. Побочно чинится и столкновение с запущенным
 * приложением: single-instance lock живёт В профиле, поэтому изолированный
 * каталог даёт тестам свой замок.
 */

const path = require('path');
const os = require('os');
const { _electron: electron } = require('playwright');
const profileGuard = require('./profile-guard');
const { track } = require('./failure-artifacts');

const MAIN = path.join(__dirname, '..', 'electron-main.js');

/**
 * Каталог профиля — ОДИН на весь прогон и намеренно ВНЕ репозитория.
 *
 * Имя фиксированное, а не уникальное на каждый launch: e2e/crash-recovery.spec.js
 * убивает приложение SIGKILL и поднимает заново, ожидая, что снимок
 * восстановления (он лежит в userData) переживёт перезапуск. Каталог на запуск
 * сделал бы этот тест бессмысленно зелёным-наоборот — восстанавливать всегда
 * было бы нечего. Чистит каталог globalSetup, ровно один раз перед прогоном.
 */
const USER_DATA_DIR = path.join(os.tmpdir(), 'timer-widget-e2e-profile');

function cleanEnv(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}

/**
 * Поднимает приложение и возвращает { app, control } с уже загруженным
 * окном управления.
 *
 * @param {{args?: string[], env?: Record<string,string>, awaitStartup?: boolean, keepProfile?: boolean}} [opts]
 */
async function launchApp(opts = {}) {
    const app = await electron.launch({
        // --user-data-dir читает сам Chromium из командной строки, до app.ready,
        // поэтому app.getPath('userData') указывает уже сюда — подменять пути
        // изнутри electron-main.js не нужно.
        args: [MAIN, `--user-data-dir=${USER_DATA_DIR}`, ...(opts.args || [])],
        env: cleanEnv(opts.env)
    });
    // Журнал полноэкранных входов (ревью CI-правки, R1): на macOS флаг
    // `isFullScreen()` поднимается в НАЧАЛЕ анимированного перехода, и по нему
    // «вход окончен» не отличить от «вход идёт». Событие `enter-full-screen`
    // приходит в конце — его копим по id окна с момента СОЗДАНИЯ, чтобы оно
    // не терялось, если вход кончился раньше вопроса. Читает
    // settleFullScreenEntry (window-ready.js). Ставится до любого окна
    // дисплея: дисплей открывает только тест.
    await app.evaluate(({ app: electronApp }) => {
        globalThis.__e2eEnteredDisplays = new Set();
        electronApp.on('browser-window-created', (_e, win) => {
            const id = win.webContents.id;
            win.on('enter-full-screen', () => globalThis.__e2eEnteredDisplays.add(id));
        });
    });
    const control = await waitForControlWindow(app);
    await control.waitForLoadState('domcontentloaded');
    // Панель досылает стартовые настройки таймерами конструктора (подгонка
    // 100 мс, настройки 200 мс, стиль окнам 600 мс — control-app.js); тест,
    // начавший раньше, читает промежуточное состояние. Ждём ЗОНД, который
    // ставит последний из них сразу после своей посылки, — а не паузу 900 мс:
    // пауза — ставка на скорость машины. Посылка ушла в main ДО того, как
    // опрос увидел зонд, поэтому следующая команда теста приходит в main
    // после неё. `awaitStartup: false` — тесту, которому нужно успеть ДО
    // рассылки (display-timer-scale).
    if (opts.awaitStartup !== false) { await waitForStartupPush(control); }
    // Сторож общего профиля (e2e/profile-guard.js): «было» — здесь, на
    // app.close() — сверка и возврат. `keepProfile` — для первого запуска
    // теста с перезапуском, которому настройка нужна во втором.
    await profileGuard.watch(app, { keepProfile: !!opts.keepProfile });
    // Следы упавшего теста (e2e/failure-artifacts.js): снимок окон перед
    // закрытием. ПОСЛЕ сторожа — обёртка, поставленная последней, выполняется
    // первой, и снимок видит окна такими, какими их оставил тест, а не после
    // того, как сторож закрыл дисплей и вернул профиль.
    track(app);
    return { app, control };
}

/**
 * Дождаться, что стартовая рассылка панели ушла: зонд `window.__startupPushed`
 * (control-app.js, таймер 600 мс конструктора). Таймаут — с запасом на
 * загруженную машину; не дождались — ошибка с названием условия, а не тест,
 * читающий полузапущенную панель.
 *
 * И что ДОШЁЛ ответ на стартовый `get-displays` (setupIPC шлёт его при каждой
 * загрузке страницы): `panelRoundTrip` (window-ready.js) ждёт «следующий
 * `displays-list`», а ответы неотличимы — стартовый, ещё бывший в пути,
 * закрыл бы первый круг теста раньше его команд (ревью B5, M1). Признак —
 * ИТОГ ответа, а не срок: `fillDisplaySelect` (panel-display.js) добавляет в
 * `#displaySelect` мониторы, в разметке там только «Авто». После этого
 * других `get-displays` в пути нет, пока их не пошлёт сам тест.
 *
 * @param {import('@playwright/test').Page} control
 * @param {number} [timeout]
 */
async function waitForStartupPush(control, timeout = 15000) {
    await control.waitForFunction(() => window.__startupPushed === true, null, { timeout })
        .catch((e) => {
            throw new Error(`стартовая рассылка панели не ушла за ${timeout} мс (зонд __startupPushed): ${e.message}`);
        });
    await control.waitForFunction(() => !!document.querySelector('#displaySelect option[value="0"]'), null, { timeout })
        .catch((e) => {
            throw new Error(`ответ на стартовый get-displays не дошёл за ${timeout} мс (в #displaySelect нет мониторов): ${e.message}`);
        });
}

/**
 * Окно панели — по АДРЕСУ, а не «первое окно».
 *
 * Первым окном бывает не панель: на профиле со старым хранилищем file:// до
 * панели живёт скрытое окно переноса настроек (main-storage-migration.js), и
 * `firstWindow()` вернул бы его — закрываемое сразу после появления панели.
 * Опрос, а не событие: окно могло появиться раньше подписки.
 */
async function waitForControlWindow(app, timeout = 20000) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const control = app.windows().find((w) => w.url().includes('electron-control.html'));
        if (control) { return control; }
        if (Date.now() > deadline) {
            throw new Error(`окно панели не появилось за ${timeout} мс; окна: `
                + (app.windows().map((w) => w.url()).join(', ') || 'нет'));
        }
        await new Promise((r) => setTimeout(r, 50));
    }
}

module.exports = { launchApp, waitForControlWindow, waitForStartupPush, cleanEnv, MAIN, USER_DATA_DIR };
