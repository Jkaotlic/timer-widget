'use strict';

/**
 * main-storage-migration.js — разовый перенос настроек из file:// в
 * app://timer-widget (SEC-12).
 *
 * Все настройки пользователя (цвета, геометрия, пресеты, свои звуки, картинка
 * фона до ~10 МБ, название мероприятия …) живут в localStorage. localStorage
 * привязан к origin: пока окна грузились с file://, это было хранилище
 * `file://`; на схеме app:// у окон НОВЫЙ origin, и он пуст. Без переноса
 * обновление выглядело бы как сброс всех настроек.
 *
 * Как (до первого настоящего окна):
 *   1. метка `storage-migration.json` в userData есть → ничего не делаем;
 *   2. каталога `Local Storage` не было НА СТАРТЕ процесса → профиль свежий,
 *      переносить нечего: метка. Смотреть надо до первого обращения к сессии:
 *      Chromium создаёт этот каталог сам, как только инициализирует
 *      defaultSession (замерено: `ready` — нет, после первого вызова сессии — есть),
 *      поэтому точка входа снимает признак при загрузке (`hadStorageAtStart`);
 *   3. скрытое окно без моста грузит пустую страницу с file:// и отдаёт все
 *      ключи (executeJavaScript — ни нового IPC-канала, ни preload);
 *   4. то же окно грузит ту же страницу с app:// и пишет ключи, КОТОРЫХ ТАМ
 *      ЕЩЁ НЕТ (существующее в новом origin не перезаписывается);
 *   5. `flushStorageData()` — данные на диске; только после этого метка.
 * Сбой, таймаут, квота на любом шаге → метки нет, следующий старт повторит
 * (записанное уже есть в app:// и будет пропущено). После MAX_ATTEMPTS неудач
 * метка ставится со статусом gave-up: миграция не должна тормозить каждый
 * старт вечно.
 *
 * Шаг 3 требует фьюза `grantFileProtocolExtraPrivileges`: без него у file://
 * непрозрачный origin, и localStorage бросает «Access is denied». Поэтому фьюз
 * выключается НЕ в этом релизе, а в следующем, когда миграция уже прошла у
 * пользователей (docs/lessons.md, SECURITY.md; храповик — release-gates).
 * Другого пути прочитать старое хранилище нет: разбор leveldb Chromium из
 * главного процесса без нативных зависимостей (snappy, журнал, сжатие
 * уровней) хрупок, а ошибка в нём — это тихо потерянные настройки.
 *
 * Старое хранилище НЕ стирается: откат на прошлую версию найдёт его целым.
 *
 * Модуль не требует electron: BrowserWindow и flushStorageData передаёт
 * точка входа. Проверка — tests/main-storage-migration.test.js (подставка
 * исполняет тот самый код, что уходит в окно) и e2e/storage-migration.spec.js.
 */

const fs = require('fs');
const path = require('path');
const AppScheme = require('./app-scheme');
const { writeFileAtomicSync } = require('./atomic-write');

const MARKER_FILE = 'storage-migration.json';
const MARKER_VERSION = 1;
const MAX_ATTEMPTS = 3;
// На шаг (загрузка, чтение, запись). Чтение и запись 10 МБ — десятки
// миллисекунд; таймаут — страховка от зависания, а не ожидаемое время.
const STEP_TIMEOUT_MS = 15000;
const { MIGRATION_PAGE } = AppScheme;

/**
 * Есть ли в профиле хранилище Chromium. Звать ДО первого обращения к сессии —
 * см. шаг 2 в шапке: после него каталог есть всегда.
 */
function hasStorageDir(userDataPath) {
    return fs.existsSync(path.join(userDataPath, 'Local Storage'));
}

// --- Код, который исполняется В СТРАНИЦЕ --------------------------------------
//
// Функции уходят в окно текстом (`fn.toString()`), поэтому самодостаточны: ни
// одной ссылки на модуль. Тест исполняет тот же текст на подставке.

function readAllEntries(storage) {
    const out = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key === null) { continue; }
        const value = storage.getItem(key);
        if (value !== null) { out[key] = value; }
    }
    return JSON.stringify(out);
}

function writeMissingEntries(storage, entries, overwrite) {
    const result = { written: 0, skipped: 0, failed: 0 };
    for (const key of Object.keys(entries)) {
        const current = storage.getItem(key);
        if (current === entries[key] || (current !== null && !overwrite)) { result.skipped++; continue; }
        try {
            storage.setItem(key, entries[key]);
            if (storage.getItem(key) === entries[key]) { result.written++; } else { result.failed++; }
        } catch {
            // QuotaExceededError: ключ не записан, остальные — пробуем.
            result.failed++;
        }
    }
    return result;
}

// --- Чистые части -------------------------------------------------------------

/** Ответ страницы → объект «ключ → строка» или исключение. */
function parseEntries(raw) {
    if (typeof raw !== 'string') { throw new Error('ответ страницы — не строка'); }
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('ответ страницы — не объект');
    }
    const out = Object.create(null);
    for (const key of Object.keys(parsed)) {
        if (typeof parsed[key] !== 'string') { throw new Error('значение хранилища — не строка'); }
        Object.defineProperty(out, key, { value: parsed[key], enumerable: true, writable: true, configurable: true });
    }
    return out;
}

function readMarker(file) {
    try {
        const m = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (m && typeof m === 'object') { return m; }
    } catch { /* нет или битая — как «нет метки» */ }
    return null;
}

function writeMarker(file, marker) {
    writeFileAtomicSync(file, JSON.stringify({ version: MARKER_VERSION, ...marker, at: new Date().toISOString() }));
}

// Объём как считает Chromium: ключ + значение, UTF-16.
function describeSize(entries) {
    let chars = 0;
    for (const key of Object.keys(entries)) { chars += key.length + entries[key].length; }
    const bytes = chars * 2;
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.ceil(bytes / 1024)} КБ`;
}

function withTimeout(promise, ms, step) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`таймаут шага «${step}»`)), ms);
        })
    ]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} deps
 * @param {string} deps.userDataPath
 * @param {boolean} deps.hadStorageAtStart — hasStorageDir() при загрузке точки входа
 * @param {string} deps.appDir — каталог страниц (в сборке — app.asar)
 * @param {Function} deps.BrowserWindow
 * @param {() => Promise<void>} deps.flushStorageData — session.defaultSession.flushStorageData
 * @param {{info: Function, warn: Function}} deps.log
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{outcome: string, keys?: number, written?: number, skipped?: number,
 *          failed?: number, dispose: () => void}>}
 *   outcome: 'already-done' | 'fresh' | 'done' | 'retry' | 'gave-up'.
 *   dispose() гасит скрытое окно — звать ПОСЛЕ создания первого настоящего:
 *   закрытое последнее окно — это window-all-closed, а на нём Windows и Linux
 *   выходят из приложения.
 */
/**
 * «Сбросить всё» ставит метку «перенесено и сверено». Иначе сверка второго
 * запуска увидела бы пустой app:// и вернула старые настройки из file:// —
 * если сброс не дочистил тот origin, он отменил бы сам себя.
 */
function markSettledAfterReset(userDataPath) {
    writeMarker(path.join(userDataPath, MARKER_FILE), { status: 'done', reason: 'reset', keys: 0, verified: true });
}

// Метка «перенесено» с ключами, ещё не сверенная со вторым запуском.
function needsVerification(marker) {
    return Number(marker.keys) > 0 && marker.verified !== true;
}

async function migrateStorage(deps) {
    const { userDataPath, appDir, BrowserWindow, flushStorageData, log } = deps;
    const timeoutMs = deps.timeoutMs || STEP_TIMEOUT_MS;
    const markerFile = path.join(userDataPath, MARKER_FILE);
    let win = null;
    const dispose = () => {
        if (win && !win.isDestroyed()) { win.destroy(); }
        win = null;
    };
    const createHiddenWindow = () => new BrowserWindow({
        show: false,
        width: 200,
        height: 100,
        skipTaskbar: true,
        // Без preload: у окна нет моста, значит, и IPC. Код в него
        // приносит только главный процесс — executeJavaScript.
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            devTools: false,
            spellcheck: false
        }
    });

    const marker = readMarker(markerFile);
    if (marker && marker.status === 'done' && needsVerification(marker)) {
        // flushStorageData() в Chromium нельзя дождаться: сбой в миллисекунды
        // после метки мог оставить app:// пустым при метке «done», и перенос
        // больше не повторялся бы, хотя старое хранилище цело. Второй запуск
        // ОДИН раз сверяет: пусто — переносим заново, есть ключи — метка
        // «сверено». Сбой самой сверки старт не держит: повторим в следующий раз.
        const count = await countAppKeys();
        if (count === 0) {
            log.warn('[migration] метка «перенесено», а app:// пуст — переношу заново');
        } else {
            if (count > 0) { writeMarker(markerFile, { ...marker, verified: true }); }
            return { outcome: 'already-done', dispose };
        }
    } else if (marker && (marker.status === 'done' || marker.status === 'gave-up')) {
        return { outcome: 'already-done', dispose };
    }
    const attempts = (marker && Number.isInteger(marker.attempts) ? marker.attempts : 0) + 1;
    // Повтор после провала: окна прошлой сессии открылись на пустом app:// и
    // сами записали туда умолчания (геометрия, флаг подсказки). «Существующее не
    // трогаем» сделало бы их вечными, а старые значения этих ключей — потерянными.
    // Всё в app:// моложе провала, поэтому значение из file:// побеждает; цена —
    // правка, сделанная пользователем в той же неудачной сессии, уступит старой.
    const overwrite = !!(marker && marker.status === 'pending');

    if (!deps.hadStorageAtStart) {
        writeMarker(markerFile, { status: 'done', reason: 'fresh', keys: 0 });
        return { outcome: 'fresh', keys: 0, dispose };
    }

    let entries = null;
    try {
        if (!win || win.isDestroyed()) { win = createHiddenWindow(); }
        await withTimeout(win.loadFile(path.join(appDir, MIGRATION_PAGE)), timeoutMs, 'загрузка file://');
        entries = parseEntries(await withTimeout(
            win.webContents.executeJavaScript(`(${readAllEntries.toString()})(localStorage)`),
            timeoutMs, 'чтение file://'
        ));
        const keys = Object.keys(entries).length;
        if (keys === 0) {
            writeMarker(markerFile, { status: 'done', keys: 0 });
            log.info('[migration] file:// → app://: переносить нечего (ключей 0)');
            return { outcome: 'done', keys: 0, written: 0, skipped: 0, failed: 0, dispose };
        }

        await withTimeout(win.loadURL(AppScheme.pageUrl(MIGRATION_PAGE)), timeoutMs, 'загрузка app://');
        // Ключи — строкой JSON и JSON.parse в странице, а не литералом объекта:
        // в литерале ключ "__proto__" стал бы прототипом, а не ключом.
        const payload = JSON.stringify(JSON.stringify(entries));
        const result = await withTimeout(
            win.webContents.executeJavaScript(
                `(${writeMissingEntries.toString()})(localStorage, JSON.parse(${payload}), ${overwrite})`
            ),
            timeoutMs, 'запись app://'
        );
        const written = Number(result && result.written) || 0;
        const skipped = Number(result && result.skipped) || 0;
        const failed = Number(result && result.failed) || 0;
        const summary = `ключей ${keys}, ${describeSize(entries)}; записано ${written}, уже были ${skipped}`;

        if (failed > 0 || written + skipped !== keys) {
            const lost = failed || keys - written - skipped;
            return finishFailed(`${summary}, не перенесено ${lost}`, { keys, written, skipped, failed: lost });
        }
        // Данные — на диск ДО метки: метка без данных — это настройки,
        // потерянные при сбое в первые секунды после миграции.
        await withTimeout(Promise.resolve(flushStorageData()), timeoutMs, 'сброс на диск');
        writeMarker(markerFile, { status: 'done', keys, written, skipped });
        log.info(`[migration] file:// → app://: ${summary}`);
        return { outcome: 'done', keys, written, skipped, failed: 0, dispose };
    } catch (err) {
        const keys = entries ? Object.keys(entries).length : 0;
        return finishFailed(`сбой: ${err && err.message ? err.message : err}`, { keys, written: 0, skipped: 0, failed: keys });
    }

    // Сколько ключей в app:// — через скрытое окно; null — сверить не вышло.
    async function countAppKeys() {
        try {
            win = createHiddenWindow();
            await withTimeout(win.loadURL(AppScheme.pageUrl(MIGRATION_PAGE)), timeoutMs, 'сверка app://');
            const n = await withTimeout(win.webContents.executeJavaScript('localStorage.length'), timeoutMs, 'сверка app://');
            return Number.isInteger(n) ? n : null;
        } catch (err) {
            log.warn(`[migration] сверка не удалась: ${err && err.message ? err.message : err}`);
            dispose();
            return null;
        }
    }

    function finishFailed(why, counts) {
        const gaveUp = attempts >= MAX_ATTEMPTS;
        try {
            writeMarker(markerFile, { status: gaveUp ? 'gave-up' : 'pending', attempts });
        } catch (err) {
            log.warn('[migration] метку не записать:', err && err.message);
        }
        log.warn(`[migration] file:// → app://, попытка ${attempts}/${MAX_ATTEMPTS}: ${why}`
            + (gaveUp ? ' — сдаюсь, больше не повторяю' : ' — повторю при следующем запуске'));
        return { outcome: gaveUp ? 'gave-up' : 'retry', ...counts, dispose };
    }
}

module.exports = {
    MARKER_FILE, MAX_ATTEMPTS, MIGRATION_PAGE,
    hasStorageDir, markSettledAfterReset, migrateStorage, parseEntries, readAllEntries, writeMissingEntries
};
