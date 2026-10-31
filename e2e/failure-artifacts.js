'use strict';

/**
 * Следы упавшего e2e-теста: снимок и состояние КАЖДОГО окна в момент сбоя.
 *
 * Было так: упавший тест не оставлял ничего. `trace: 'on-first-retry'` при
 * `retries: 0` не писался ни разу (и к `_electron` он не применяется вовсе —
 * см. playwright.config.js), а большинство спек закрывает приложение в
 * `finally` — тот выполняется РАНЬШЕ любого хука и любой фикстуры, так что к
 * моменту, когда раннер узнаёт о сбое, окон уже нет. 30.10.2026 спека упала с
 * «element is not visible» после 30 с ожидания, и причину так и не нашли:
 * смотреть было не на что.
 *
 * Как устроено:
 *   - `track(app)` (его зовёт launchApp и спеки, запускающие Electron сами)
 *     регистрирует приложение и оборачивает `app.close` так, что ПЕРЕД
 *     закрытием снимается лёгкий снимок: JSON каждого окна, PNG каждого окна,
 *     JSON главного процесса. Снимок держится в памяти процесса тестов (на
 *     диск — только при сбое), а настоящее закрытие не откладывается и не
 *     меняется: спеки перезапуска закрывают и сразу поднимают заново;
 *   - авто-фикстура (e2e/fixtures.js) после теста, если он упал, кладёт в
 *     `test-results/<папка теста>/` последний снимок до закрытия и, если
 *     приложение ещё живо (тест повис или упал до `finally`), — живой.
 *
 * Снятие следов НИКОГДА не валит тест и не маскирует исходную ошибку: всё в
 * try/catch и под таймаутом, окно, умершее посреди снимка, пропускается с
 * пометкой в его JSON.
 */

const fs = require('fs');

/** Сколько ждать одно окно: скрытое окно может не отдать кадр вовсе. */
const STEP_TIMEOUT_MS = 3000;

/**
 * Живые приложения, которые зарегистрировал launchApp / track, → номер теста,
 * в котором они запущены. Между тестами список НЕ очищается: приложение из
 * `beforeAll` живёт через всю группу, и при сбое его снимок нужен. Но
 * приложение, запущенное ДО текущего теста, помечается в имени вложения
 * (`live-earlier`), чтобы чужое окно не выдавалось за окно упавшего теста, а
 * умершее без события `close` (SIGKILL, сбой) выбрасывается в начале теста.
 */
const live = new Map();
/** Номер текущего теста в воркере (beginTest). */
let generation = 0;
/** Последний снимок до закрытия в ТЕКУЩЕМ тесте (перезапуск его перезаписывает). */
let lastClose = null;

function withTimeout(promise, ms, what) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${what}: нет ответа за ${ms} мс`)), ms);
        })
    ]).finally(() => clearTimeout(timer));
}

/** Короткое имя окна по адресу: control / widget / clock / display / прочее. */
function windowName(url) {
    const file = String(url || '').split(/[?#]/)[0].split('/').pop() || 'blank';
    const known = {
        'electron-control.html': 'control',
        'electron-widget.html': 'widget',
        'electron-clock-widget.html': 'clock',
        'display.html': 'display'
    };
    return known[file] || file.replace(/\.html?$/, '').replace(/[^\w.-]+/g, '_') || 'window';
}

/** Состояние окна, как его видит рендерер. */
function pageState() {
    return {
        url: location.href,
        bodyClass: document.body ? document.body.className : null,
        htmlClass: document.documentElement ? document.documentElement.className : null,
        inner: [window.innerWidth, window.innerHeight],
        focused: document.hasFocus(),
        readyState: document.readyState
    };
}

/** Окна глазами главного процесса — выполняется В main. */
function mainState({ BrowserWindow }) {
    return BrowserWindow.getAllWindows().map((w) => {
        if (w.isDestroyed()) { return { id: w.id, destroyed: true }; }
        return {
            id: w.id,
            title: w.getTitle(),
            url: w.webContents && !w.webContents.isDestroyed() ? w.webContents.getURL() : null,
            bounds: w.getBounds(),
            visible: w.isVisible(),
            focused: w.isFocused(),
            fullScreen: w.isFullScreen(),
            minimized: w.isMinimized()
        };
    });
}

/**
 * Снять состояние всех окон приложения. Не бросает: любая ошибка ложится
 * пометкой в результат.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {{png?: boolean}} [opts]
 * @returns {Promise<{at: string, windows: Array<{name: string, state: object, png: Buffer|null}>, main: object}>}
 */
async function capture(app, opts = {}) {
    const png = opts.png !== false;
    const out = { at: new Date().toISOString(), windows: [], main: null };
    let pages = [];
    try { pages = app.windows(); } catch (e) { out.error = `app.windows(): ${e && e.message}`; }
    const seen = new Map();
    for (const page of pages) {
        let url = '';
        try { url = page.url(); } catch { /* окно ушло */ }
        const base = windowName(url);
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        const entry = { name: n > 1 ? `${base}-${n}` : base, state: null, png: null };
        try {
            if (page.isClosed()) { throw new Error('окно закрыто'); }
            entry.state = await withTimeout(page.evaluate(pageState), STEP_TIMEOUT_MS, 'состояние окна');
        } catch (e) {
            entry.state = { url, skipped: `состояние не снято: ${e && e.message}` };
        }
        if (png) {
            try {
                if (page.isClosed()) { throw new Error('окно закрыто'); }
                entry.png = await withTimeout(
                    page.screenshot({ timeout: STEP_TIMEOUT_MS, animations: 'allow' }),
                    STEP_TIMEOUT_MS + 500, 'снимок окна');
            } catch (e) {
                entry.state.pngSkipped = `снимок не снят: ${e && e.message}`;
            }
        }
        out.windows.push(entry);
    }
    try {
        out.main = await withTimeout(app.evaluate(mainState), STEP_TIMEOUT_MS, 'главный процесс');
    } catch (e) {
        out.main = { skipped: `главный процесс не ответил: ${e && e.message}` };
    }
    return out;
}

/**
 * Зарегистрировать приложение: снимок перед каждым `app.close()`.
 * Вызывать ПОСЛЕ остальных обёрток `app.close` (сторож профиля): снимок
 * должен видеть окна такими, какими их оставил тест, — до того, как сторож
 * закроет дисплей и вернёт профиль.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @returns {import('@playwright/test').ElectronApplication} то же приложение
 */
function track(app) {
    live.set(app, generation);
    try { app.once('close', () => live.delete(app)); } catch { /* не EventEmitter — не беда */ }
    const close = app.close.bind(app);
    app.close = async () => {
        if (live.has(app)) {
            try { lastClose = await capture(app); } catch { /* следы не важнее закрытия */ }
        }
        live.delete(app);
        return close();
    };
    return app;
}

/** Процесс приложения уже завершён (событие `close` могло не прийти). */
function exited(app) {
    try {
        const proc = typeof app.process === 'function' ? app.process() : null;
        return !!proc && (proc.exitCode !== null || proc.signalCode !== null);
    } catch {
        return false;
    }
}

/** Начало теста: снимки прошлого теста к этому отношения не имеют. */
function beginTest() {
    lastClose = null;
    generation += 1;
    for (const app of [...live.keys()]) {
        if (exited(app)) { live.delete(app); }
    }
}

/**
 * Какие живые приложения снимать при сбое и под каким именем. Чистая —
 * проверяется в tests/e2e-fixtures.test.js на подставных приложениях.
 *
 * @param {Map<object, number>} apps — приложение → номер теста запуска
 * @param {number} current — номер текущего теста
 * @returns {{app: object, phase: string}[]}
 */
function livePlan(apps, current) {
    const own = [];
    const earlier = [];
    for (const [app, born] of apps) {
        if (exited(app)) { continue; }
        (born === current ? own : earlier).push(app);
    }
    const name = (base, list, i) => (list.length > 1 ? `${base}${i + 1}` : base);
    return [
        ...own.map((app, i) => ({ app, phase: name('live', own, i) })),
        ...earlier.map((app, i) => ({ app, phase: name('live-earlier', earlier, i) }))
    ];
}

/**
 * Файл — в папку теста под понятным именем (`before-close-widget.png`), и он
 * же прикладывается по `path`. Вложение с `body` в test-results/ не попадает
 * вовсе (его хранит только html-отчёт; проверено провокацией 30.10.2026), а
 * артефакт CI — это test-results/. Цена: Playwright кладёт копию в
 * attachments/ с хэшем в имени — десятки КБ на упавший тест.
 */
function writeAttachment(testInfo, name, body, contentType) {
    const file = testInfo.outputPath(name);
    fs.writeFileSync(file, body);
    return testInfo.attach(name, { path: file, contentType });
}

async function attachCapture(testInfo, phase, snap) {
    for (const w of snap.windows) {
        await writeAttachment(testInfo, `${phase}-${w.name}.json`,
            JSON.stringify(w.state, null, 2), 'application/json');
        if (w.png) {
            await writeAttachment(testInfo, `${phase}-${w.name}.png`, w.png, 'image/png');
        }
    }
    const main = { at: snap.at, error: snap.error, windows: snap.main };
    await writeAttachment(testInfo, `${phase}-main.json`, JSON.stringify(main, null, 2), 'application/json');
}

/**
 * Тест упал: приложить снимок до закрытия и живой снимок ещё открытых
 * приложений. Не бросает.
 */
async function attachOnFailure(testInfo) {
    try {
        if (lastClose) { await attachCapture(testInfo, 'before-close', lastClose); }
    } catch (e) {
        console.warn(`[failure-artifacts] снимок до закрытия не приложен: ${e && e.message}`);
    }
    for (const { app, phase } of livePlan(live, generation)) {
        try {
            const snap = await capture(app);
            await attachCapture(testInfo, phase, snap);
        } catch (e) {
            console.warn(`[failure-artifacts] живой снимок не приложен: ${e && e.message}`);
        }
    }
}

module.exports = { track, capture, beginTest, attachOnFailure, livePlan, windowName, STEP_TIMEOUT_MS };
