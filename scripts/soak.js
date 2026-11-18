'use strict';

/**
 * Долгий прогон: приложение живёт часами, как на мероприятии, а обычный e2e —
 * секунды. Такой тест не ловит ни утечку памяти, ни уплывший отсчёт.
 *
 *   npm run soak -- --minutes=120 [--out=report.json]
 *
 * Открыты все четыре окна, таймер идёт через ноль в минус, стили окон меняются по
 * кругу. Каждые 30 с снимается память всех процессов и расхождение табло с
 * монотонными часами самого скрипта. Профиль свой, удаляется в конце.
 *
 * Провал (код 1): ошибка в окне, упавший процесс, табло разошлось больше чем на
 * 2 с, память к концу выросла больше чем на MAX_GROWTH от уровня после прогрева.
 * В CI не входит: время прогона — сам смысл проверки.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAX_DRIFT_SECONDS = 2;
const MAX_GROWTH = 0.3;
const SAMPLE_MS = 30000;
const STYLE_EVERY_SAMPLES = 10;
const STYLES = ['circle', 'flip', 'analog', 'digits'];

function arg(name, fallback) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function waitForPage(app, part) {
    for (let i = 0; i < 200; i++) {
        const page = app.windows().find((w) => w.url().includes(part));
        if (page) {
            await page.waitForLoadState('load');
            return page;
        }
        await sleep(100);
    }
    throw new Error(`окно ${part} не появилось`);
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Runs inside the renderer, reading the digits actually displayed by its active style.
function readTimerWindow(role) {
    const widget = role === 'widget';
    const timer = widget ? window.timerWidget : window.displayTimer;
    const style = timer.timerStyle;
    const byId = (id) => document.getElementById(id);
    let text;
    if (style === 'flip') {
        const prefix = widget ? 'wFlip' : 'flip';
        const cells = (part) => [1, 2].map((n) => {
            const card = byId(prefix + part + n);
            if (!card.checkVisibility()) { throw new Error(`hidden flip digit: ${card.id}`); }
            return card.querySelector(widget ? '.widget-flip-digit' : '.flip-digit').textContent;
        }).join('');
        const hasHours = byId(widget ? 'widgetFlip' : 'timerFlip').classList.contains('has-hours');
        const sign = byId(prefix + 'Minus').classList.contains('visible') ? '-' : '';
        text = sign + (hasHours ? cells('Hr') + ':' : '') + cells('Min') + ':' + cells('Sec');
    } else {
        const ids = {
            circle: 'timeDisplay',
            analog: widget ? 'widgetAnalogDigital' : 'analogDigitalTime',
            digits: widget ? 'widgetDigitsTime' : 'digitsTime'
        };
        const element = byId(ids[style]);
        if (!element?.checkVisibility()) { throw new Error(`hidden timer: ${role} ${style}`); }
        text = element.innerText.replace(/\s/g, '').replace('−', '-');
    }
    if (!/^-?\d+(?::\d{2}){1,2}$/.test(text)) { throw new Error(`invalid timer: ${role} ${text}`); }
    const absolute = text.replace('-', '').split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
    return { remaining: timer.remainingSeconds, visible: text.startsWith('-') ? -absolute : absolute, style };
}

/**
 * Вердикт по снятым замерам — чистая функция, её проверяет tests/soak-verdict.test.js.
 *
 * Сравниваются медианы первой (после прогрева) и последней четверти: одиночный
 * всплеск сборки мусора не должен ни провалить прогон, ни скрыть утечку.
 *
 * @param {{samples: {rssMb: number, driftSeconds: Record<string, number>}[], errors: string[], gone: string[], fatal?: string}} run
 * @returns {string[]} причины провала, пусто — прошёл
 */
function soakVerdict({ samples, errors, gone, fatal }) {
    const problems = [...errors.map((e) => `ошибка в окне: ${e}`), ...gone.map((g) => `упал процесс: ${g}`)];
    if (fatal) { problems.push(fatal); }
    if (samples.length < 8) {
        problems.push(`мало замеров для вывода: ${samples.length}`);
        return problems;
    }
    for (const name of ['control', 'widget', 'widgetVisible', 'display', 'displayVisible']) {
        const values = samples.map((sample) => sample.driftSeconds[name]);
        if (!values.every(Number.isFinite)) {
            problems.push(`${name}: нет измерения`);
            continue;
        }
        const worst = Math.max(...values.map(Math.abs));
        if (worst > MAX_DRIFT_SECONDS) { problems.push(`${name}: табло разошлось на ${worst} с`); }
    }
    const quarter = Math.floor(samples.length / 4);
    const early = median(samples.slice(quarter, quarter * 2).map((s) => s.rssMb));
    const late = median(samples.slice(-quarter).map((s) => s.rssMb));
    if (late > early * (1 + MAX_GROWTH)) { problems.push(`память выросла: ${early} → ${late} МБ`); }
    return problems;
}

async function measure(minutes, run) {
    let dir;
    let app;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    const watch = (page) => {
        const name = () => page.url().split('/').pop();
        page.on('pageerror', (e) => run.errors.push(`${name()}: ${e.message}`));
        page.on('crash', () => run.gone.push(name()));
        page.on('console', (m) => { if (m.type() === 'error') { run.errors.push(`${name()}: ${m.text()}`); } });
    };
    try {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-soak-'));
        app = await electron.launch({ args: [path.join(ROOT, 'electron-main.js'), `--user-data-dir=${dir}`], env });
        app.windows().forEach(watch);
        app.on('window', watch);
        const control = await waitForPage(app, 'electron-control');
        await control.waitForFunction(() => window.__startupPushed === true);
        const send = (channel, payload) => control.evaluate(([c, p]) => window.ipcRenderer.send(c, p), [channel, payload]);

        await send('open-widget');
        const widget = await waitForPage(app, 'electron-widget');
        await send('open-clock-widget');
        const clock = await waitForPage(app, 'electron-clock-widget');
        await send('open-display', { displayIndex: 'auto' });
        const display = await waitForPage(app, 'display.html');

        // Половина прогона в плюсе, половина в минусе: оба режима рисуют по-разному.
        const seconds = Math.round(minutes * 30);
        await send('timer-command', { allowNegative: true });
        await send('timer-command', { type: 'set', seconds });
        await send('timer-command', { type: 'start' });
        await control.waitForFunction(() => window.timerController.isRunning === true);
        const startedAt = performance.now();

        const end = startedAt + minutes * 60000;
        let styleIndex = 0;
        for (let i = 1; performance.now() < end; i++) {
            if (i <= STYLES.length || i % STYLE_EVERY_SAMPLES === 0) {
                const style = STYLES[styleIndex++ % STYLES.length];
                await send('widget-style-update', { timerStyle: style });
                await send('clock-widget-set-style', style);
                await send('display-settings-update', { displayTimerStyle: style });
                await Promise.all([
                    widget.waitForFunction((s) => window.timerWidget?.timerStyle === s, style),
                    clock.waitForFunction((s) => window.clockWidget?.clockStyle === s, style),
                    display.waitForFunction((s) => window.displayTimer?.timerStyle === s, style)
                ]);
            }
            await sleep(SAMPLE_MS);
            const [remaining, widgetTime, displayTime] = await Promise.all([
                control.evaluate(() => window.timerController.remainingSeconds),
                widget.evaluate(readTimerWindow, 'widget'),
                display.evaluate(readTimerWindow, 'display')
            ]);
            const expected = seconds - Math.floor((performance.now() - startedAt) / 1000);
            const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => m.memory.workingSetSize));
            const rssMb = Math.round(metrics.reduce((sum, kb) => sum + kb, 0) / 1024);
            const driftSeconds = {
                control: remaining - expected, widget: widgetTime.remaining - expected,
                widgetVisible: widgetTime.visible - expected, display: displayTime.remaining - expected,
                displayVisible: displayTime.visible - expected
            };
            const sample = { minute: Math.round((i * SAMPLE_MS) / 6000) / 10, remaining, widgetTime, displayTime, driftSeconds, rssMb, processes: metrics.length };
            run.samples.push(sample);
            console.log(JSON.stringify(sample));
        }
    } finally {
        if (app) { await app.close().catch((error) => run.errors.push(String(error))); }
        if (dir) {
            try { fs.rmSync(dir, { recursive: true, force: true }); }
            catch (error) { run.errors.push(String(error)); }
        }
    }
}

async function writeSoakReport(out, minutes, collect) {
    const run = { samples: [], errors: [], gone: [] };
    let problems;
    try {
        await collect(minutes, run);
    } catch (error) {
        run.fatal = String(error.stack || error);
    } finally {
        problems = soakVerdict(run);
        fs.writeFileSync(out, JSON.stringify({ minutes, problems, ...run }, null, 1));
    }
    return problems;
}

async function main() {
    const minutes = Number(arg('minutes', '120'));
    const out = arg('out', path.join(os.tmpdir(), `timer-widget-soak-${Date.now()}.json`));
    const problems = await writeSoakReport(out, minutes, measure);
    console.log(`[soak] отчёт: ${out}`);
    if (problems.length) {
        problems.forEach((p) => console.error(`[soak] ПРОВАЛ: ${p}`));
        process.exitCode = 1;
    } else {
        console.log('[soak] OK');
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

module.exports = { soakVerdict, writeSoakReport };
