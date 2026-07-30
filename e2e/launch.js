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
 */

const path = require('path');
const { _electron: electron } = require('playwright');

const MAIN = path.join(__dirname, '..', 'electron-main.js');

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
        args: [MAIN, ...(opts.args || [])],
        env: cleanEnv(opts.env)
    });
    const control = await app.firstWindow();
    await control.waitForLoadState('domcontentloaded');
    // Панель досылает стартовые настройки с задержкой до 600 мс; ждём тишины,
    // иначе тест успевает прочитать промежуточное состояние.
    await control.waitForTimeout(opts.settleMs ?? 900);
    return { app, control };
}

module.exports = { launchApp, cleanEnv, MAIN };
