'use strict';

// Dev-only: drives a scripted capture sequence across all 4 windows and
// 4 timer states. Called from electron-main.js when `--screenshot` is passed.
// Writes PNGs to <repo>/screenshots/.

const path = require('node:path');
const fs = require('node:fs');

const STATES = [
    { name: 'idle',     remaining: 300, total: 300, isRunning: false, finished: false },
    { name: 'running',  remaining: 183, total: 300, isRunning: true,  finished: false },
    { name: 'finished', remaining: 0,   total: 300, isRunning: false, finished: true  },
    { name: 'overtime', remaining: -47, total: 300, isRunning: true,  finished: true  }
];

const WINDOWS = ['control', 'widget', 'clock', 'display'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForLoad(win, timeoutMs = 6000) {
    if (!win || win.isDestroyed()) { return; }
    if (!win.webContents.isLoading()) { return; }
    await new Promise((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        win.webContents.once('did-finish-load', () => { clearTimeout(t); resolve(); });
    });
}

async function capture(win, filePath, log) {
    if (!win || win.isDestroyed()) {
        log.warn(`[screenshot] skip ${path.basename(filePath)} — window missing`);
        return;
    }
    try {
        // Transparent windows that were never shown don't allocate a compositor
        // surface -> capturePage returns UnknownVizError. Showing offscreen first
        // forces the surface to exist.
        if (!win.isVisible()) { win.showInactive(); }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(filePath, img.toPNG());
        log.info(`[screenshot] ${path.basename(filePath)}`);
    } catch (err) {
        log.error(`[screenshot] ${path.basename(filePath)} failed: ${err.message}`);
    }
}

async function run({ app, log, ctx, applyTimerState, openWidget, openClock, openDisplay, outDir }) {
    log.info('[screenshot] starting capture sequence');
    fs.mkdirSync(outDir, { recursive: true });

    // Hard exit guard — kill the process if the sequence hangs for any reason.
    const hardTimeout = setTimeout(() => {
        log.error('[screenshot] hard timeout (90s) — forcing exit');
        app.exit(2);
    }, 90_000);
    hardTimeout.unref && hardTimeout.unref();

    try {
        openWidget();
        openClock();
        openDisplay();

        await sleep(300);
        for (const name of WINDOWS) {
            try { await waitForLoad(ctx()[name]); } catch (e) {
                log.warn(`[screenshot] ${name} did-finish-load timeout: ${e.message}`);
            }
        }
        await sleep(1500); // let CSS/fonts/glass blur settle

        // Warm-up capture — first call on a freshly created window can throw
        // UnknownVizError while the compositor surface is being allocated.
        for (const name of WINDOWS) {
            const w = ctx()[name];
            if (!w || w.isDestroyed()) { continue; }
            try {
                if (!w.isVisible()) { w.showInactive(); }
                await w.webContents.capturePage();
            } catch { /* ignore — actual captures are in the state loop below */ }
        }
        await sleep(500);

        for (const state of STATES) {
            try {
                applyTimerState({
                    totalSeconds: state.total,
                    presetSeconds: state.total,
                    remainingSeconds: state.remaining,
                    isRunning: state.isRunning,
                    isPaused: false,
                    finished: state.finished
                });
            } catch (e) {
                log.error(`[screenshot] applyTimerState(${state.name}) failed: ${e.message}`);
            }
            await sleep(500); // let renderers repaint

            const windows = ctx();
            for (const name of WINDOWS) {
                await capture(windows[name], path.join(outDir, `${name}-${state.name}.png`), log);
            }
        }
    } finally {
        clearTimeout(hardTimeout);
        log.info('[screenshot] done');
        app.quit();
    }
}

module.exports = { run };
