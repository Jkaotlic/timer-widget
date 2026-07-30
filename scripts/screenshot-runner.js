'use strict';

// Dev-only: drives a scripted capture sequence across all 4 windows and
// 4 timer states. Called from electron-main.js when `--screenshot` is passed.
// Writes PNGs to <repo>/screenshots/.

const path = require('node:path');
const fs = require('node:fs');
const { diffBitmaps, isRegression, isTimeDependent } = require('../visual-diff');

const STATES = [
    { name: 'idle',     remaining: 300, total: 300, isRunning: false, finished: false },
    { name: 'running',  remaining: 183, total: 300, isRunning: true,  finished: false },
    { name: 'finished', remaining: 0,   total: 300, isRunning: false, finished: true  },
    { name: 'overtime', remaining: -47, total: 300, isRunning: true,  finished: true  },
    // ВАЖНО: идёт СРАЗУ после overtime и ловит «залипшие» цвета. Ветки danger и
    // overtime выставляют инлайновые красные стили, которые побеждают CSS-классы;
    // если ветка нормального времени их не снимает, время остаётся красным даже
    // после установки нового пресета. Именно так выглядел баг, который нашёл
    // пользователь. Порядок состояний тут — часть проверки, не переставлять.
    { name: 'recovered', remaining: 300, total: 300, isRunning: false, finished: false }
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

// Заморозка анимаций на время съёмки.
//
// Без неё снимки недетерминированы: пульсация статуса (overtime-pulse,
// badge-pulse, pulse-dot) и вспышка завершения (body.flash-mode, brightness 1.5,
// переключается по интервалу из JS) попадают в кадр в случайной фазе. Первый же
// прогон сверки с эталоном показал 100% расхождения на display-overtime именно
// из-за вспышки. Цвета и раскладка при заморозке остаются настоящими — застывает
// только фаза анимации, поэтому регрессии всё так же видны.
const FREEZE_ANIMATIONS_CSS = `
    *, *::before, *::after {
        animation: none !important;
        transition: none !important;
    }
    body.flash-mode { filter: none !important; }
`;

async function freezeAnimations(ctx, log) {
    for (const name of WINDOWS) {
        const w = ctx()[name];
        if (!w || w.isDestroyed()) { continue; }
        try {
            await w.webContents.insertCSS(FREEZE_ANIMATIONS_CSS);
        } catch (e) {
            log.warn(`[screenshot] не смог заморозить анимации в ${name}: ${e.message}`);
        }
    }
}

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

// Сверяет снятые PNG с эталонами из tests/visual-baseline/.
// Декодирование делает Electron (nativeImage), арифметику — чистый visual-diff.js.
// Возвращает список регрессий; пустой список = всё совпало.
function compareWithBaseline({ nativeImage, outDir, baselineDir, log }) {
    if (!fs.existsSync(baselineDir)) {
        log.info('[visual] эталонов нет — пропускаю сверку (npm run visual:baseline)');
        return null;
    }
    const regressions = [];
    let compared = 0;
    let skipped = 0;

    for (const name of fs.readdirSync(outDir).filter(f => f.endsWith('.png')).sort()) {
        if (isTimeDependent(name)) { skipped++; continue; }
        const basePath = path.join(baselineDir, name);
        if (!fs.existsSync(basePath)) {
            log.warn(`[visual] нет эталона для ${name} — новый снимок`);
            continue;
        }
        try {
            const actual = nativeImage.createFromPath(path.join(outDir, name)).toBitmap();
            const expected = nativeImage.createFromPath(basePath).toBitmap();
            const result = diffBitmaps(actual, expected);
            compared++;
            if (isRegression(result)) {
                const pct = (result.ratio * 100).toFixed(2);
                regressions.push({ name, ...result });
                log.error(`[visual] РАСХОЖДЕНИЕ ${name}: ${result.diffPixels} px (${pct}%)`);
            }
        } catch (e) {
            log.warn(`[visual] не смог сравнить ${name}: ${e.message}`);
        }
    }

    log.info(`[visual] сверено ${compared}, пропущено по времени ${skipped}, расхождений ${regressions.length}`);
    return regressions;
}

async function run({ app, log, ctx, applyTimerState, openWidget, openClock, openDisplay, outDir, nativeImage }) {
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

        // Заморозку ставим ДО первого снимка, иначе фаза пульсации попадает в кадр.
        await freezeAnimations(ctx, log);
        await sleep(200);

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

        // Stuck-colour sweep across all 4 timer styles.
        //
        // The danger/overtime bands write INLINE colours (inline beats the CSS
        // class), so every style needs a branch that clears them again. When one
        // is missing the timer just stays red forever — including after a fresh
        // preset is set. Circle is the default style and therefore the only one
        // the state loop above exercises, so drive the other three explicitly:
        // poison with overtime, then recover, then look.
        log.info('[screenshot] style sweep (stuck-colour check)');
        const STYLES = ['circle', 'digital', 'flip', 'analog'];
        const poison = { totalSeconds: 300, presetSeconds: 300, remainingSeconds: -47,
            isRunning: true, isPaused: false, finished: false };
        const recover = { totalSeconds: 300, presetSeconds: 300, remainingSeconds: 300,
            isRunning: false, isPaused: false, finished: false };

        for (const style of STYLES) {
            const w = ctx();
            try {
                if (w.display && !w.display.isDestroyed()) {
                    w.display.webContents.send('display-settings-update', { timerStyle: style });
                }
                if (w.widget && !w.widget.isDestroyed()) {
                    w.widget.webContents.send('widget-style-update', { timerStyle: style });
                }
            } catch (e) {
                log.warn(`[screenshot] style ${style} switch failed: ${e.message}`);
            }
            await sleep(400);

            try { applyTimerState(poison); } catch { /* best effort */ }
            await sleep(450);
            try { applyTimerState(recover); } catch { /* best effort */ }
            await sleep(450);

            const now = ctx();
            await capture(now.display, path.join(outDir, `style-${style}-display-recovered.png`), log);
            await capture(now.widget, path.join(outDir, `style-${style}-widget-recovered.png`), log);
        }

        // Overtime-limit row: it only renders when «Считать ниже нуля» is on, so
        // flip the toggle from the outside and grab the control panel once.
        log.info('[screenshot] overtime limit row');
        try {
            const c = ctx().control;
            if (c && !c.isDestroyed()) {
                await c.webContents.executeJavaScript(`
                    (() => {
                        const t = document.getElementById('allowNegative');
                        if (t) { t.checked = true; t.dispatchEvent(new Event('change')); }
                        const l = document.getElementById('overrunLimit');
                        if (l) { l.value = '05:00'; l.dispatchEvent(new Event('input')); }
                    })();
                `);
                await sleep(350);
                await capture(c, path.join(outDir, 'control-overtime-limit.png'), log);
                await c.webContents.executeJavaScript(`
                    (() => {
                        const t = document.getElementById('allowNegative');
                        if (t) { t.checked = false; t.dispatchEvent(new Event('change')); }
                    })();
                `);
                await sleep(200);
            }
        } catch (e) {
            log.warn('[screenshot] overtime limit row failed: ' + e.message);
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
        // Сверка с эталонами — только по запросу (--visual-check), чтобы обычный
        // прогон скриншотов оставался быстрым и не падал.
        if (process.argv.includes('--visual-check') && nativeImage) {
            const regressions = compareWithBaseline({
                nativeImage,
                outDir,
                baselineDir: path.join(__dirname, '..', 'tests', 'visual-baseline'),
                log
            });
            if (regressions && regressions.length > 0) {
                log.error(`[visual] регрессий: ${regressions.length}`);
                clearTimeout(hardTimeout);
                app.exit(3);
                return;
            }
        }
    } finally {
        clearTimeout(hardTimeout);
        log.info('[screenshot] done');
        app.quit();
    }
}

module.exports = { run };
