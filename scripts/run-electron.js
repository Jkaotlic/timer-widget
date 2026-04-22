#!/usr/bin/env node
// Cross-platform launcher used by `npm start` / `npm run dev`.
// Clears ELECTRON_RUN_AS_NODE from the child's env so Electron always boots
// with Chromium (the variable leaks in from some parent processes — VS Code,
// Claude Code CLI — and turns electron.exe into a plain Node runtime).

'use strict';

const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
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
