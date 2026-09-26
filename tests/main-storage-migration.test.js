'use strict';

/**
 * main-storage-migration.js — разовый перенос localStorage из file:// в
 * app://timer-widget (SEC-12).
 *
 * Подставка окна исполняет РОВНО тот код, который модуль отдаёт в
 * executeJavaScript, — на хранилище своего origin. Так проверяется не «модуль
 * позвал что-то», а что именно этот код делает с настоящими ключами. Что
 * хранилища origin'ов в Chromium ведут себя так же — e2e/storage-migration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const M = require('../main-storage-migration');

// --- Подставки ----------------------------------------------------------------

// localStorage одного origin: порядок ключей, квота по символам, как в Chromium
// (ключ + значение), и QuotaExceededError сверх неё.
function fakeStorage(initial = {}, quotaChars = Infinity) {
    const map = new Map(Object.entries(initial));
    const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
    return {
        map,
        get length() { return map.size; },
        key(i) { return [...map.keys()][i] ?? null; },
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) {
            const next = used() - (map.has(k) ? k.length + map.get(k).length : 0) + k.length + String(v).length;
            if (next > quotaChars) {
                const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err;
            }
            map.set(k, String(v));
        }
    };
}

function makeEnv({ file = {}, app = {}, appQuota = Infinity, hasLocalStorageDir = true, marker = null,
    hang = null, flushFails = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-migration-'));
    if (hasLocalStorageDir) { fs.mkdirSync(path.join(dir, 'Local Storage')); }
    if (marker) { fs.writeFileSync(path.join(dir, M.MARKER_FILE), JSON.stringify(marker)); }
    const origins = { file: fakeStorage(file), app: fakeStorage(app, appQuota) };
    const events = [];
    const created = [];

    class FakeWindow {
        constructor(opts) {
            this.opts = opts;
            this.destroyed = false;
            this.origin = null;
            created.push(this);
            const self = this;
            this.webContents = {
                executeJavaScript(code) {
                    events.push(`exec:${self.origin}`);
                    if (hang === `exec:${self.origin}`) { return new Promise(() => {}); }
                     
                    const run = new Function('localStorage', `return ${code};`);
                    return Promise.resolve(run(origins[self.origin]));
                }
            };
        }
        loadFile(file) {
            events.push(`loadFile:${path.basename(file)}`);
            this.origin = 'file';
            this.loadedFile = file;
            return hang === 'loadFile' ? new Promise(() => {}) : Promise.resolve();
        }
        loadURL(url) {
            events.push(`loadURL:${url}`);
            this.origin = 'app';
            return Promise.resolve();
        }
        isDestroyed() { return this.destroyed; }
        destroy() { events.push('destroy'); this.destroyed = true; }
    }

    const logged = [];
    const deps = {
        userDataPath: dir,
        hadStorageAtStart: M.hasStorageDir(dir),
        appDir: '/app/dir',
        BrowserWindow: FakeWindow,
        flushStorageData: async () => {
            events.push('flush');
            if (flushFails) { throw new Error('flush failed'); }
        },
        log: {
            info: (...a) => logged.push(['info', a.join(' ')]),
            warn: (...a) => logged.push(['warn', a.join(' ')])
        },
        timeoutMs: 200
    };
    const readMarker = () => {
        const f = path.join(dir, M.MARKER_FILE);
        return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    };
    return { dir, deps, origins, events, created, logged, readMarker };
}

// --- Тесты --------------------------------------------------------------------

test('свежий профиль (хранилища ещё нет): окно не создаётся, метка ставится сразу', async () => {
    const env = makeEnv({ hasLocalStorageDir: false });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(env.created.length, 0, 'на свежем профиле читать нечего — окно лишнее');
    assert.equal(res.outcome, 'fresh');
    assert.equal(env.readMarker().status, 'done');
});

test('«свежий» решает снимок НА СТАРТЕ, а не каталог сейчас: сессия создаёт его сама', async () => {
    // Chromium заводит `Local Storage`, как только тронута defaultSession, —
    // к моменту переноса он есть и в новом профиле.
    const env = makeEnv({ hasLocalStorageDir: false });
    fs.mkdirSync(path.join(env.dir, 'Local Storage'));
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'fresh');
    assert.equal(env.created.length, 0);
    assert.equal(M.hasStorageDir(env.dir), true);
});

test('метка есть — второй запуск ничего не делает', async () => {
    const env = makeEnv({ file: { a: '1' }, marker: { version: 1, status: 'done' } });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'already-done');
    assert.equal(env.created.length, 0);
    assert.equal(env.origins.app.length, 0);
});

test('перенос: каждый ключ доходит байт в байт, существующий в app:// не перезаписывается', async () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(200000);
    const env = makeEnv({
        file: { widgetColors: '{"bg":"#123456"}', localBgImage: big, eventTitle: 'Доклад №1 — «тест»', shared: 'old' },
        app: { shared: 'new' }
    });
    const res = await M.migrateStorage(env.deps);
    assert.equal(res.outcome, 'done');
    assert.equal(env.origins.app.getItem('widgetColors'), '{"bg":"#123456"}');
    assert.equal(env.origins.app.getItem('localBgImage'), big);
    assert.equal(env.origins.app.getItem('eventTitle'), 'Доклад №1 — «тест»');
    assert.equal(env.origins.app.getItem('shared'), 'new', 'ключ нового origin перезаписан старым');
    assert.deepEqual(
        { keys: res.keys, written: res.written, skipped: res.skipped, failed: res.failed },
        { keys: 4, written: 3, skipped: 1, failed: 0 }
    );
    const marker = env.readMarker();
    assert.equal(marker.status, 'done');
    assert.equal(marker.keys, 4);
    // Старое хранилище не трогается: откат на прошлую версию его найдёт.
    assert.equal(env.origins.file.length, 4);
    res.dispose();
});

test('порядок: file:// читается, app:// пишется, диск сброшен — и только потом метка', async () => {
    const env = makeEnv({ file: { a: '1' } });
    let markerAtFlush = 'unset';
    env.deps.flushStorageData = async () => {
        env.events.push('flush');
        markerAtFlush = env.readMarker();
    };
    const res = await M.migrateStorage(env.deps);
    assert.deepEqual(env.events, [
        `loadFile:${M.MIGRATION_PAGE}`, 'exec:file',
        `loadURL:app://timer-widget/${M.MIGRATION_PAGE}`, 'exec:app', 'flush'
    ]);
    assert.equal(markerAtFlush, null, 'метка записана раньше, чем данные ушли на диск');
    assert.equal(env.created[0].loadedFile, path.join('/app/dir', M.MIGRATION_PAGE));
    res.dispose();
});

test('окно миграции: скрытое, в песочнице, без моста и без DevTools', async () => {
    const env = makeEnv({ file: { a: '1' } });
    const res = await M.migrateStorage(env.deps);
    const wp = env.created[0].opts.webPreferences;
    assert.equal(env.created[0].opts.show, false);
    assert.equal(wp.sandbox, true);
    assert.equal(wp.contextIsolation, true);
    assert.equal(wp.nodeIntegration, false);
    assert.equal(wp.devTools, false);
    assert.equal(wp.preload, undefined, 'у окна миграции нет preload — нет и IPC');
    res.dispose();
});

test('окно не закрывается само: его гасит dispose() ПОСЛЕ первого настоящего окна', async () => {
    // Закрыть единственное окно до панели — это window-all-closed, а на
    // Windows и Linux обработчик на нём выходит из приложения.
    const env = makeEnv({ file: { a: '1' } });
    const res = await M.migrateStorage(env.deps);
    assert.equal(env.created[0].destroyed, false);
    res.dispose();
    assert.equal(env.created[0].destroyed, true);
    res.dispose(); // повторный — безвреден
    assert.equal(env.events.filter((e) => e === 'destroy').length, 1);
});

test('пустой file:// — метка ставится, app:// не открывается', async () => {
    const env = makeEnv({ file: {} });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'done');
    assert.equal(res.keys, 0);
    assert.ok(!env.events.some((e) => e.startsWith('loadURL')));
    assert.equal(env.readMarker().status, 'done');
});

test('частичная запись (квота) — метки нет, следующий запуск дописывает недостающее', async () => {
    const env = makeEnv({ file: { a: 'x'.repeat(10), b: 'y'.repeat(50) }, appQuota: 30 });
    const first = await M.migrateStorage(env.deps);
    first.dispose();
    assert.equal(first.outcome, 'retry');
    assert.equal(first.failed, 1);
    assert.equal(env.readMarker().status, 'pending');
    assert.equal(env.readMarker().attempts, 1);
    assert.equal(env.origins.app.getItem('a'), 'x'.repeat(10));

    // Место освободилось: второй запуск пишет только недостающее.
    env.origins.app = fakeStorage(Object.fromEntries(env.origins.app.map));
    const second = await M.migrateStorage(env.deps);
    second.dispose();
    assert.equal(second.outcome, 'done');
    assert.deepEqual({ written: second.written, skipped: second.skipped }, { written: 1, skipped: 1 });
    assert.equal(env.origins.app.getItem('b'), 'y'.repeat(50));
    assert.equal(env.readMarker().status, 'done');
});

test('после MAX_ATTEMPTS неудач — сдаёмся с меткой, а не ищем ключи на каждом старте вечно', async () => {
    const env = makeEnv({ file: { a: 'x'.repeat(100) }, appQuota: 10 });
    for (let i = 1; i <= M.MAX_ATTEMPTS; i++) {
        const r = await M.migrateStorage(env.deps);
        r.dispose();
        assert.equal(r.outcome, i < M.MAX_ATTEMPTS ? 'retry' : 'gave-up', `попытка ${i}`);
    }
    assert.equal(env.readMarker().status, 'gave-up');
    const after = await M.migrateStorage(env.deps);
    after.dispose();
    assert.equal(after.outcome, 'already-done');
    assert.ok(env.logged.some(([lvl, t]) => lvl === 'warn' && /сдаюсь|не перенесено/.test(t)));
});

test('зависшая загрузка или скрипт — не вешают старт: таймаут, попытка засчитана, окно гасится', async () => {
    for (const hang of ['loadFile', 'exec:file', 'exec:app']) {
        const env = makeEnv({ file: { a: '1' }, hang });
        const t0 = Date.now();
        const res = await M.migrateStorage(env.deps);
        assert.ok(Date.now() - t0 < 2000, `${hang}: старт ждал дольше таймаута`);
        assert.equal(res.outcome, 'retry', hang);
        assert.equal(env.readMarker().status, 'pending', hang);
        res.dispose();
        assert.equal(env.created[0].destroyed, true, hang);
    }
});

test('сбой сброса на диск — метки нет', async () => {
    const env = makeEnv({ file: { a: '1' }, flushFails: true });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'retry');
    assert.equal(env.readMarker().status, 'pending');
});

test('битая метка читается как «нет метки», а не роняет старт', async () => {
    const env = makeEnv({ file: { a: '1' } });
    fs.writeFileSync(path.join(env.dir, M.MARKER_FILE), '{не json');
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'done');
});

test('журнал: число ключей и объём — да; ключи и значения — нет', async () => {
    const env = makeEnv({ file: { secretKeyName: 'secret-value-123', other: 'v' } });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    const text = env.logged.map(([, t]) => t).join('\n');
    assert.match(text, /ключей 2/);
    assert.match(text, /КБ|МБ/);
    assert.doesNotMatch(text, /secretKeyName|secret-value-123|other/);
});

test('ответ страницы проверяется: не объект строк — это сбой, а не «ноль ключей»', () => {
    assert.throws(() => M.parseEntries('[1,2]'));
    assert.throws(() => M.parseEntries('{"a":1}'));
    assert.throws(() => M.parseEntries('не json'));
    assert.throws(() => M.parseEntries(42));
    // Ключ `__proto__` — обычный ключ хранилища, а не прототип.
    const odd = M.parseEntries('{"a":"1","__proto__":"x"}');
    assert.equal(odd.a, '1');
    assert.equal(Object.getOwnPropertyDescriptor(odd, '__proto__').value, 'x');
});

test('код, уходящий в окно, самодостаточен: без замыканий на модуль', () => {
    // Он исполняется В СТРАНИЦЕ: ссылка на что-то из модуля там — ReferenceError.
    for (const fn of [M.readAllEntries, M.writeMissingEntries]) {
         
        const isolated = new Function(`return (${fn.toString()});`)();
        assert.equal(typeof isolated, 'function');
    }
    const st = fakeStorage({ k: 'v' });
    assert.equal(M.readAllEntries(st), '{"k":"v"}');
    assert.deepEqual(M.writeMissingEntries(fakeStorage({ k: 'v' }), { k: 'z', n: '1' }),
        { written: 1, skipped: 1, failed: 0 });
});

// --- Сверка после переноса ----------------------------------------------------
// flushStorageData() в Chromium нельзя дождаться: сбой в миллисекунды после
// метки мог оставить app:// пустым при метке «done» — и перенос больше не
// повторялся, хотя старое хранилище цело. Второй запуск один раз сверяет.

test('сверка: метка «done», а app:// пуст — перенос повторяется', async () => {
    const env = makeEnv({
        file: { a: '1', b: '2' },
        marker: { version: 1, status: 'done', keys: 2, written: 2, skipped: 0 }
    });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'done');
    assert.equal(env.origins.app.getItem('a'), '1');
    assert.equal(env.origins.app.getItem('b'), '2');
});

test('сверка: app:// на месте — метка помечается сверенной, переноса нет', async () => {
    const env = makeEnv({
        file: { a: '1' }, app: { a: '1' },
        marker: { version: 1, status: 'done', keys: 1, written: 1, skipped: 0 }
    });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'already-done');
    assert.equal(env.readMarker().verified, true);
    assert.ok(!env.events.some((e) => e.startsWith('loadFile')), 'сверка не читает старое хранилище');
});

test('сверка один раз: сверенная метка окна не открывает', async () => {
    const env = makeEnv({
        file: { a: '1' },
        marker: { version: 1, status: 'done', keys: 1, verified: true }
    });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'already-done');
    assert.equal(env.created.length, 0);
});

test('сверка зависла — старт не ждёт её вечно, метка остаётся несверенной', async () => {
    const env = makeEnv({
        file: { a: '1' }, app: { a: '1' }, hang: 'exec:app',
        marker: { version: 1, status: 'done', keys: 1 }
    });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'already-done');
    assert.notEqual(env.readMarker().verified, true);
    assert.ok(env.created.every((w) => w.destroyed), 'окно сверки не погашено');
});

// --- Повтор после провала: старое хранилище побеждает ------------------------
// Провалившаяся попытка не держит старт: окна открываются на пустом app:// и
// сами пишут туда умолчания (геометрия, флаг подсказки). Правило «существующее
// не трогаем» превращало их в «уже есть», и старые значения этих ключей не
// переезжали никогда. При повторе (метка pending) app:// целиком моложе
// провала, поэтому значение из file:// побеждает; ключи, которых в file:// нет,
// остаются.
test('повтор после провала: старое значение побеждает записанное приложением после сбоя', async () => {
    const env = makeEnv({ file: { widgetGeometry: '{"x":500}', theme: 'light' }, hang: 'loadFile' });
    const first = await M.migrateStorage(env.deps);
    first.dispose();
    assert.equal(first.outcome, 'retry');

    // Сессия после провала: приложение записало свои умолчания.
    env.origins.app.setItem('widgetGeometry', '{"x":0}');
    env.origins.app.setItem('onboardingShown', 'true');

    // Второй запуск — на том же профиле: app:// с умолчаниями и метка pending.
    const again = makeEnv({
        file: { widgetGeometry: '{"x":500}', theme: 'light' },
        app: Object.fromEntries(env.origins.app.map),
        marker: env.readMarker()
    });
    const second = await M.migrateStorage(again.deps);
    second.dispose();
    assert.equal(second.outcome, 'done');
    assert.equal(again.origins.app.getItem('widgetGeometry'), '{"x":500}', 'умолчание после провала заслонило старое значение');
    assert.equal(again.origins.app.getItem('theme'), 'light');
    assert.equal(again.origins.app.getItem('onboardingShown'), 'true', 'ключ, которого нет в file://, пропал');
});

test('первая попытка: существующее в app:// по-прежнему не перезаписывается', async () => {
    const env = makeEnv({ file: { shared: 'old' }, app: { shared: 'new' } });
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(env.origins.app.getItem('shared'), 'new');
});

// --- Сброс ---------------------------------------------------------------------
test('сброс помечает перенос завершённым и сверенным: сверка не вернёт старое', async () => {
    const env = makeEnv({
        file: { a: '1' },
        marker: { version: 1, status: 'done', keys: 1 }
    });
    M.markSettledAfterReset(env.dir);
    const marker = env.readMarker();
    assert.equal(marker.status, 'done');
    assert.equal(marker.verified, true);
    const res = await M.migrateStorage(env.deps);
    res.dispose();
    assert.equal(res.outcome, 'already-done');
    assert.equal(env.created.length, 0);
    assert.equal(env.origins.app.length, 0, 'сброс отменён старыми настройками');
});
