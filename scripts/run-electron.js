#!/usr/bin/env node
// Cross-platform launcher used by `npm start` / `npm run dev`.
// Clears ELECTRON_RUN_AS_NODE from the child's env so Electron always boots
// with Chromium (the variable leaks in from some parent processes — VS Code,
// Claude Code CLI — and turns electron.exe into a plain Node runtime).

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];

// Режим съёмки работает в СОБСТВЕННОМ профиле, который сносится перед каждым
// запуском.
//
// Зачем: окна сохраняют геометрию и настройки в localStorage, а
// последовательность съёмки многократно меняет размеры (свипы минимума и
// максимума, форматы часов) и переключает стили. Пока профиль был общий с живым
// приложением, кадр зависел от того, чем закончился ПРЕДЫДУЩИЙ прогон и что
// пользователь трогал руками, — кадры расходились по РАЗМЕРУ, а не по
// содержимому (visual-diff печатает при этом `0 px (100.00%)`: это не совпадение
// цветов, а провалившаяся проверка равенства размеров). Тем же профилем
// пользовались e2e, и прогон e2e ломал эталоны.
//
// Чистый профиль каждый раз делает последовательность НЕПОДВИЖНОЙ ТОЧКОЙ: одни
// и те же исходные условия → одни и те же кадры. `npm start` и `npm run dev`
// сюда не попадают — живое приложение обязано сохранять настройки пользователя.
if (process.argv.includes('--screenshot')) {
    const profileDir = path.join(os.tmpdir(), 'timer-widget-visual-profile');
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.mkdirSync(profileDir, { recursive: true });
    args.push(`--user-data-dir=${profileDir}`);
    console.log(`[screenshot] профиль съёмки: ${profileDir}`);
}
const child = spawn(electron, args, { stdio: 'inherit', env });

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});

child.on('error', (err) => {
    console.error('[run-electron] failed to spawn:', err);
    process.exit(1);
});
