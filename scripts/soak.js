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

/**
 * Вердикт по снятым замерам — чистая функция, её проверяет tests/soak-verdict.test.js.
 *
 * Сравниваются медианы первой (после прогрева) и последней четверти: одиночный
 * всплеск сборки мусора не должен ни провалить прогон, ни скрыть утечку.
 *
 * @param {{samples: {rssMb: number, driftSeconds: number}[], errors: string[], gone: string[]}} run
 * @returns {string[]} причины провала, пусто — прошёл
 */
function soakVerdict({ samples, errors, gone }) {
    const problems = [...errors.map((e) => `ошибка в окне: ${e}`), ...gone.map((g) => `упал процесс: ${g}`)];
    if (samples.length < 8) {
        problems.push(`мало замеров для вывода: ${samples.length}`);
        return problems;
    }
    const worst = Math.max(...samples.map((s) => Math.abs(s.driftSeconds)));
    if (worst > MAX_DRIFT_SECONDS) { problems.push(`табло разошлось на ${worst} с`); }
    const quarter = Math.floor(samples.length / 4);
    const early = median(samples.slice(quarter, quarter * 2).map((s) => s.rssMb));
    const late = median(samples.slice(-quarter).map((s) => s.rssMb));
    if (late > early * (1 + MAX_GROWTH)) { problems.push(`память выросла: ${early} → ${late} МБ`); }
    return problems;
}

async function main() {
    const minutes = Number(arg('minutes', '120'));
    const out = arg('out', path.join(os.tmpdir(), `timer-widget-soak-${Date.now()}.json`));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-soak-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    const run = { samples: [], errors: [], gone: [] };
    const app = await electron.launch({ args: [path.join(ROOT, 'electron-main.js'), `--user-data-dir=${dir}`], env });
    const watch = (page) => {
        const name = () => page.url().split('/').pop();
        page.on('pageerror', (e) => run.errors.push(`${name()}: ${e.message}`));
        page.on('crash', () => run.gone.push(name()));
        page.on('console', (m) => { if (m.type() === 'error') { run.errors.push(`${name()}: ${m.text()}`); } });
    };
    app.windows().forEach(watch);
    app.on('window', watch);

    try {
        const control = await waitForPage(app, 'electron-control');
        await control.waitForFunction(() => window.__startupPushed === true);
        const send = (channel, payload) => control.evaluate(([c, p]) => window.ipcRenderer.send(c, p), [channel, payload]);

        await send('open-widget');
        await waitForPage(app, 'electron-widget');
        await send('open-clock-widget');
        await waitForPage(app, 'electron-clock-widget');
        await send('open-display', { displayIndex: 'auto' });
        await waitForPage(app, 'display.html');

        // Половина прогона в плюсе, половина в минусе: оба режима рисуют по-разному.
        const seconds = Math.round(minutes * 30);
        await send('timer-command', { allowNegative: true });
        await send('timer-command', { type: 'set', seconds });
        await send('timer-command', { type: 'start' });
        await control.waitForFunction(() => window.timerController.isRunning === true);
        const startedAt = performance.now();

        const end = startedAt + minutes * 60000;
        for (let i = 1; performance.now() < end; i++) {
            await sleep(SAMPLE_MS);
            const remaining = await control.evaluate(() => window.timerController.remainingSeconds);
            const expected = seconds - Math.floor((performance.now() - startedAt) / 1000);
            const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => m.memory.workingSetSize));
            const rssMb = Math.round(metrics.reduce((sum, kb) => sum + kb, 0) / 1024);
            const sample = { minute: Math.round((i * SAMPLE_MS) / 6000) / 10, remaining, driftSeconds: remaining - expected, rssMb, processes: metrics.length };
            run.samples.push(sample);
            console.log(JSON.stringify(sample));
            if (i % STYLE_EVERY_SAMPLES === 0) {
                const style = STYLES[(i / STYLE_EVERY_SAMPLES) % STYLES.length];
                await send('widget-style-update', { timerStyle: style });
                await send('clock-widget-set-style', style);
            }
        }
    } finally {
        await app.close().catch(() => {});
        fs.rmSync(dir, { recursive: true, force: true });
    }

    const problems = soakVerdict(run);
    fs.writeFileSync(out, JSON.stringify({ minutes, problems, ...run }, null, 1));
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

module.exports = { soakVerdict };
