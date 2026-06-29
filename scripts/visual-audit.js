'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const repoRoot = path.join(__dirname, '..');
const outRoot = process.argv[2] || path.join(repoRoot, 'artifacts', 'visual-full-audit', 'latest');
const styles = ['circle', 'digital', 'flip', 'analog'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function stampName(name) {
    return name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

async function setWindowSize(electronApp, page, width, height) {
    const win = await electronApp.browserWindow(page);
    await win.evaluate((browserWindow, bounds) => {
        browserWindow.setMinimumSize(1, 1);
        browserWindow.setSize(bounds.width, bounds.height);
    }, { width, height });
    await sleep(250);
}

async function capture(page, name) {
    const file = path.join(outRoot, `${stampName(name)}.png`);
    await page.screenshot({ path: file });
    return file;
}

async function readMetrics(page, name) {
    return page.evaluate((scenarioName) => {
        const round = (value) => Math.round(value * 100) / 100;
        const rectOf = (el) => {
            if (!el) { return null; }
            const r = el.getBoundingClientRect();
            return {
                left: round(r.left),
                top: round(r.top),
                right: round(r.right),
                bottom: round(r.bottom),
                width: round(r.width),
                height: round(r.height),
                cx: round(r.left + r.width / 2),
                cy: round(r.top + r.height / 2)
            };
        };
        const isInsideHiddenSurface = (el) => Boolean(el.closest(
            '.exit-modal:not(.show), .faq-modal:not(.show), .reset-modal:not(.show), ' +
            '.settings-drawer:not(.open), .tab-content:not(.active)'
        ));
        const isVisible = (el) => {
            if (isInsideHiddenSurface(el)) { return false; }
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0.5 &&
                r.height > 0.5 &&
                s.display !== 'none' &&
                s.visibility !== 'hidden' &&
                Number(s.opacity || 1) > 0.01;
        };
        const isIntentionallyScrollable = (el) => {
            const s = getComputedStyle(el);
            return /auto|scroll/.test(`${s.overflow} ${s.overflowX} ${s.overflowY}`) ||
                el.classList.contains('drawer-body') ||
                el.classList.contains('faq-body');
        };
        const describe = (el) => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            className: String(el.className || '').slice(0, 120),
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
            rect: rectOf(el)
        });

        const elements = Array.from(document.querySelectorAll('body *')).filter(isVisible);
        const outsideViewport = elements
            .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.left < -2 || r.top < -2 ||
                    r.right > window.innerWidth + 2 ||
                    r.bottom > window.innerHeight + 2;
            })
            .slice(0, 20)
            .map(describe);
        const clipped = elements
            .filter((el) => !isIntentionallyScrollable(el))
            .filter((el) => el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)
            .slice(0, 20)
            .map((el) => ({
                ...describe(el),
                client: { width: el.clientWidth, height: el.clientHeight },
                scroll: { width: el.scrollWidth, height: el.scrollHeight }
            }));

        const rect = (selector) => rectOf(document.querySelector(selector));
        const delta = (a, b) => {
            if (!a || !b) { return null; }
            return { dx: round(a.cx - b.cx), dy: round(a.cy - b.cy) };
        };

        const centers = {
            timerRing: rect('.circular-widget.active .bg-circle, .timer-ring.active .ring-bg'),
            timerTime: rect('.circular-widget.active #timeDisplayDigits, .circular-widget.active #timeDisplay, .timer-ring.active #timeDisplay'),
            clockRing: rect('.circular-widget.active .bg-circle'),
            clockTime: rect('.circular-widget.active #timeDisplay'),
            analogFace: rect('.widget-analog.active .widget-analog-clock, .timer-analog.active .analog-clock'),
            analogCenter: rect('.widget-analog.active .widget-analog-center, .timer-analog.active .analog-center')
        };

        return {
            scenario: scenarioName,
            title: document.title,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            document: {
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight,
                bodyScrollWidth: document.body.scrollWidth,
                bodyScrollHeight: document.body.scrollHeight
            },
            bodyClasses: Array.from(document.body.classList),
            outsideViewport,
            clipped,
            centers,
            centerDeltas: {
                timerTimeFromRing: delta(centers.timerTime, centers.timerRing),
                clockTimeFromRing: delta(centers.clockTime, centers.clockRing),
                analogCenterFromFace: delta(centers.analogCenter, centers.analogFace)
            }
        };
    }, name);
}

async function record(metrics, page, name) {
    await capture(page, name);
    metrics.push(await readMetrics(page, name));
}

async function clickIfVisible(page, selector) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.click();
        await sleep(500);
        return true;
    }
    return false;
}

async function findWindow(electronApp, fileName) {
    for (let attempt = 0; attempt < 20; attempt++) {
        for (const page of electronApp.windows()) {
            const url = page.url();
            if (url.includes(fileName)) {
                await page.waitForLoadState('domcontentloaded').catch(() => {});
                return page;
            }
        }
        await sleep(250);
    }
    const seen = [];
    for (const page of electronApp.windows()) {
        seen.push({ title: await page.title().catch(() => ''), url: page.url() });
    }
    throw new Error(`Window not found: ${fileName}; seen ${JSON.stringify(seen)}`);
}

async function setRendererStyle(page, kind, style) {
    await page.evaluate(({ kind: rendererKind, nextStyle }) => {
        if (rendererKind === 'widget') {
            const active = {
                circle: '.circular-widget',
                digital: '#widgetDigital',
                flip: '#widgetFlip',
                analog: '#widgetAnalog'
            };
            document.body.classList.remove('style-circle', 'style-digital', 'style-flip', 'style-analog');
            document.body.classList.add(`style-${nextStyle}`);
            Object.values(active).forEach((selector) => document.querySelector(selector)?.classList.remove('active'));
            document.querySelector(active[nextStyle])?.classList.add('active');
        } else if (rendererKind === 'clock') {
            const active = {
                circle: '.circular-widget',
                digital: '#widgetDigital',
                flip: '#widgetFlip',
                analog: '#widgetAnalog'
            };
            document.body.classList.remove('style-circle', 'style-digital', 'style-flip', 'style-analog');
            document.body.classList.add(`style-${nextStyle}`);
            Object.values(active).forEach((selector) => document.querySelector(selector)?.classList.remove('active'));
            document.querySelector(active[nextStyle])?.classList.add('active');
        } else if (rendererKind === 'display') {
            const active = {
                circle: '#timerRing',
                digital: '#timerDigital',
                flip: '#timerFlip',
                analog: '#timerAnalog'
            };
            document.body.classList.remove('style-circle', 'style-digital', 'style-flip', 'style-analog');
            document.body.classList.add(`style-${nextStyle}`);
            Object.values(active).forEach((selector) => document.querySelector(selector)?.classList.remove('active'));
            document.querySelector(active[nextStyle])?.classList.add('active');
        }
    }, { kind, nextStyle: style });
    await sleep(250);
}

async function run() {
    ensureDir(outRoot);
    const metrics = [];
    const appArgs = [path.join(repoRoot, 'electron-main.js')];
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    const electronApp = await electron.launch({ args: appArgs, env });
    try {
        const control = await electronApp.firstWindow();
        await control.waitForLoadState('domcontentloaded');
        await sleep(1200);
        await setWindowSize(electronApp, control, 400, 712);
        await record(metrics, control, 'control-default');

        for (const tab of ['timer', 'clock', 'display', 'sound']) {
            await clickIfVisible(control, `.tab-btn[data-tab="${tab}"]`);
            await setWindowSize(electronApp, control, 736, 712);
            await record(metrics, control, `control-drawer-${tab}`);
        }

        await clickIfVisible(control, '#drawerClose');
        await setWindowSize(electronApp, control, 380, 660);
        await record(metrics, control, 'control-min');
        await setWindowSize(electronApp, control, 740, 740);
        await record(metrics, control, 'control-wide');

        for (const modal of [
            { trigger: '#helpBtn', name: 'faq' },
            { trigger: '#resetBtn', name: 'reset' },
            { trigger: '#exitBtn', name: 'exit' }
        ]) {
            if (await clickIfVisible(control, modal.trigger)) {
                await record(metrics, control, `control-modal-${modal.name}`);
                await control.keyboard.press('Escape').catch(() => {});
                await sleep(250);
            }
        }

        await clickIfVisible(control, '#openWidgetBtn');
        await clickIfVisible(control, '#openClockBtn');
        const widget = await findWindow(electronApp, 'electron-widget.html');
        const clock = await findWindow(electronApp, 'electron-clock-widget.html');

        for (const [kind, page, sizes] of [
            ['widget', widget, [{ name: 'min', width: 120, height: 140 }, { name: 'default', width: 250, height: 250 }, { name: 'max', width: 800, height: 800 }]],
            ['clock', clock, [{ name: 'min', width: 120, height: 120 }, { name: 'default', width: 250, height: 250 }, { name: 'max', width: 800, height: 800 }]]
        ]) {
            for (const style of styles) {
                await setRendererStyle(page, kind, style);
                for (const size of sizes) {
                    await setWindowSize(electronApp, page, size.width, size.height);
                    await record(metrics, page, `${kind}-${style}-${size.name}`);
                }
            }
        }

        await clickIfVisible(control, '#openDisplayBtn');
        const display = await findWindow(electronApp, 'display.html');
        for (const style of styles) {
            await setRendererStyle(display, 'display', style);
            for (const size of [{ name: '720p', width: 1280, height: 720 }, { name: '1080p', width: 1920, height: 1080 }]) {
                await setWindowSize(electronApp, display, size.width, size.height);
                await record(metrics, display, `display-${style}-${size.name}`);
            }
        }
    } finally {
        fs.writeFileSync(path.join(outRoot, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
        await electronApp.close().catch(() => {});
    }

    const failures = metrics.filter((m) =>
        m.outsideViewport.length ||
        Object.values(m.centerDeltas).some((d) => d && (Math.abs(d.dx) > 3 || Math.abs(d.dy) > 3))
    );
    const clipWarnings = metrics.filter((m) => m.clipped.length);
    console.log(JSON.stringify({
        outDir: outRoot,
        scenarios: metrics.length,
        clipWarnings: clipWarnings.map((m) => ({ scenario: m.scenario, clipped: m.clipped.length })),
        failures: failures.map((m) => ({
            scenario: m.scenario,
            outsideViewport: m.outsideViewport.length,
            clipped: m.clipped.length,
            centerDeltas: m.centerDeltas
        }))
    }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
