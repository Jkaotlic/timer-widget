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

// Minimum sizes advertised by BrowserWindow options — used to catch layout
// overflow/clipping when the user resizes to the floor.
const MIN_SIZES = {
    control: { width: 360, height: 640 },
    widget:  { width: 120, height: 140 },
    clock:   { width: 120, height: 120 },
    display: { width: 1280, height: 720 } // display doesn't resize, but keep consistent
};

// Maximum sizes — control has a hard max (drawer + panel); widget/clock are
// scalable via Ctrl+wheel with no ceiling, so we pick a "big screen" size a
// user could realistically drag them to.
const MAX_SIZES = {
    control: { width: 1280, height: 1100 },
    widget:  { width: 800,  height: 800 },
    clock:   { width: 800,  height: 800 },
    display: { width: 1920, height: 1080 }
};

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
    // Transparent windows that were never shown don't allocate a compositor
    // surface -> capturePage returns UnknownVizError. Showing offscreen first
    // forces the surface to exist, but sometimes the first capture still races
    // the surface handshake. Retry up to 3 times with a short back-off.
    if (!win.isVisible()) { win.showInactive(); }
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const img = await win.webContents.capturePage();
            fs.writeFileSync(filePath, img.toPNG());
            log.info(`[screenshot] ${path.basename(filePath)}${attempt > 1 ? ` (retry ${attempt - 1})` : ''}`);
            return;
        } catch (err) {
            if (attempt === maxAttempts) {
                log.error(`[screenshot] ${path.basename(filePath)} failed after ${maxAttempts} attempts: ${err.message}`);
                return;
            }
            await sleep(250 * attempt);
        }
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

        // Min-size sweep — resize each window to its advertised floor and grab
        // one snapshot. Uses the 'running' state so progress ring + status chip
        // are visible (worst case for cramped layouts).
        log.info('[screenshot] minsize sweep');
        try {
            applyTimerState({
                totalSeconds: 300, presetSeconds: 300, remainingSeconds: 183,
                isRunning: true, isPaused: false, finished: false
            });
        } catch (e) {
            log.warn(`[screenshot] minsize state set failed: ${e.message}`);
        }
        await sleep(200);

        const windowsNow = ctx();
        for (const name of WINDOWS) {
            const w = windowsNow[name];
            if (!w || w.isDestroyed()) { continue; }
            const target = MIN_SIZES[name];
            if (!target) { continue; }
            try {
                w.setMinimumSize(target.width, target.height);
                w.setSize(target.width, target.height);
            } catch (e) {
                log.warn(`[screenshot] ${name} resize failed: ${e.message}`);
            }
            await sleep(350); // let responsive CSS settle
            await capture(w, path.join(outDir, `${name}-minsize.png`), log);
        }

        // Max-size sweep — stress-test the ceiling (control hard max, widget/clock
        // big-screen scaling). Same 'running' state for visual parity with minsize.
        log.info('[screenshot] maxsize sweep');
        for (const name of WINDOWS) {
            const w = windowsNow[name];
            if (!w || w.isDestroyed()) { continue; }
            const target = MAX_SIZES[name];
            if (!target) { continue; }
            try {
                // Clear any minimum we just raised so the subsequent resize isn't blocked.
                w.setMinimumSize(1, 1);
                w.setSize(target.width, target.height);
            } catch (e) {
                log.warn(`[screenshot] ${name} resize(max) failed: ${e.message}`);
            }
            await sleep(400);
            await capture(w, path.join(outDir, `${name}-maxsize.png`), log);
        }
    } finally {
        clearTimeout(hardTimeout);
        log.info('[screenshot] done');
        app.quit();
    }
}

module.exports = { run };
