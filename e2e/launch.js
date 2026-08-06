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
 * @param {{args?: string[], env?: Record<string,string>, settleMs?: number}} [opts]
 */
async function launchApp(opts = {}) {
    const app = await electron.launch({
        // --user-data-dir читает сам Chromium из командной строки, до app.ready,
        // поэтому app.getPath('userData') указывает уже сюда — подменять пути
        // изнутри electron-main.js не нужно.
        args: [MAIN, `--user-data-dir=${USER_DATA_DIR}`, ...(opts.args || [])],
        env: cleanEnv(opts.env)
    });
    const control = await app.firstWindow();
    await control.waitForLoadState('domcontentloaded');
    // Панель досылает стартовые настройки с задержкой до 600 мс; ждём тишины,
    // иначе тест успевает прочитать промежуточное состояние.
    await control.waitForTimeout(opts.settleMs ?? 900);
    return { app, control };
}

module.exports = { launchApp, cleanEnv, MAIN, USER_DATA_DIR };
