'use strict';

/**
 * Память ретрансляторов главного процесса — в файл (relay-store.js).
 *
 * До 29.10.2026 главный процесс помнил настройки окон (`relay.*`,
 * main-state.js) только в памяти. После запуска память была пуста, пока панель
 * не дошлёт настройки таймерами 200/500/600 мс: виджет, открытый раньше,
 * вставал поверх окон вопреки выключенной настройке, а выгрузка CSV брала
 * ставку из пустого объекта.
 *
 * Файл — недоверенный вход: его мог обрезать сбой, отредактировать человек,
 * записать другая версия приложения. Ни один из этих случаев не роняет старт;
 * правило проверки — то же, что у живого канала (relay-payload.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RelayStore = require('../relay-store');
const { createRelayMemory } = require('../main-state');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-store-'));
}

function quietLog() {
    const lines = [];
    const rec = (level) => (...a) => lines.push({ level, text: a.map(String).join(' ') });
    return { lines, info: rec('info'), warn: rec('warn'), error: rec('error') };
}

/** Память, как её оставила панель после обычной работы. */
function filledRelay() {
    const relay = createRelayMemory();
    relay.lastWidgetColors = { timer: '#ff0000', progress: '#00ff00', bg: '#000000' };
    relay.lastClockColors = { timer: '#111111' };
    relay.lastDisplayColors = { bg: '#222222' };
    relay.lastWidgetStyle = { style: 'digits', alwaysOnTop: false, scale: 120 };
    relay.lastDisplaySettings = {
        eventTitle: 'Открытие сезона', overrunPrice: 1000, overrunPeriod: 3,
        bgLocalImage: 'data:image/png;base64,' + 'A'.repeat(4096)
    };
    relay.lastClockSettings = { showDate: true, showTimezone: true };
    relay.uiTheme = 'light';
    relay.uiLocked = true;
    return relay;
}

function persister(dir, log, overrides = {}) {
    return RelayStore.createRelayPersister(Object.assign({
        getUserDataPath: () => dir,
        relay: overrides.relay || createRelayMemory(),
        log
    }, overrides));
}

test('круговой рейс: что сохранили, то и прочли — шесть полей настроек', () => {
    const dir = tempDir();
    const log = quietLog();
    const saved = filledRelay();
    RelayStore.writeRelayState(dir, saved);

    const restored = createRelayMemory();
    RelayStore.loadRelayState(dir, restored, log);

    assert.deepEqual(restored.lastWidgetColors, saved.lastWidgetColors);
    assert.deepEqual(restored.lastClockColors, saved.lastClockColors);
    assert.deepEqual(restored.lastDisplayColors, saved.lastDisplayColors);
    assert.deepEqual(restored.lastWidgetStyle, saved.lastWidgetStyle);
    assert.deepEqual(restored.lastClockSettings, saved.lastClockSettings);
    assert.equal(restored.lastDisplaySettings.overrunPrice, 1000);
    assert.equal(restored.lastDisplaySettings.eventTitle, 'Открытие сезона');
    assert.deepEqual(log.lines.filter((l) => l.level !== 'info'), [], 'чистый файл — без предупреждений');
});

test('картинка фона дисплея в файл НЕ пишется (до ~13 МБ, живёт в localStorage)', () => {
    const dir = tempDir();
    RelayStore.writeRelayState(dir, filledRelay());
    const text = fs.readFileSync(RelayStore.getRelayStatePath(dir), 'utf8');
    assert.ok(!text.includes('bgLocalImage'), 'ключа картинки в файле нет');
    assert.ok(text.length < 4096, `файл без картинки маленький, а он ${text.length} символов`);
});

test('картинка, оказавшаяся в файле (рука, чужая версия), при чтении отбрасывается', () => {
    const dir = tempDir();
    fs.writeFileSync(RelayStore.getRelayStatePath(dir), JSON.stringify({
        version: RelayStore.RELAY_STATE_VERSION,
        relay: { lastDisplaySettings: { overrunPrice: 5, bgLocalImage: 'data:image/png;base64,AAAA' } }
    }));
    const relay = createRelayMemory();
    RelayStore.loadRelayState(dir, relay, quietLog());
    assert.equal(relay.lastDisplaySettings.overrunPrice, 5);
    assert.ok(!Object.prototype.hasOwnProperty.call(relay.lastDisplaySettings, 'bgLocalImage'),
        'без ключа картинки: «ключа нет» у дисплея значит «без изменений», и своя копия окна остаётся');
});

test('файла нет — память пуста, предупреждений нет', () => {
    const dir = tempDir();
    const log = quietLog();
    const relay = createRelayMemory();
    RelayStore.loadRelayState(dir, relay, log);
    assert.deepEqual(relay, createRelayMemory());
    assert.deepEqual(log.lines.filter((l) => l.level !== 'info'), []);
});

test('битый JSON: старт как с пустой памятью, ошибка в журнал, не исключение', () => {
    const dir = tempDir();
    const log = quietLog();
    fs.writeFileSync(RelayStore.getRelayStatePath(dir), '{"version":1,"relay":{"lastWidget');
    const relay = createRelayMemory();
    assert.doesNotThrow(() => RelayStore.loadRelayState(dir, relay, log));
    assert.deepEqual(relay, createRelayMemory());
    assert.ok(log.lines.some((l) => l.level === 'warn' && l.text.includes('relay-state')),
        `в журнале нет записи о битом файле: ${JSON.stringify(log.lines)}`);
});

test('чужой формат: другая версия, массив, строка — игнорируются целиком', () => {
    for (const body of [
        JSON.stringify({ version: 999, relay: { uiTheme: 'light' } }),
        JSON.stringify({ relay: { uiTheme: 'light' } }),
        JSON.stringify([1, 2, 3]),
        JSON.stringify('light'),
        JSON.stringify({ version: RelayStore.RELAY_STATE_VERSION, relay: [] }),
        'null'
    ]) {
        const dir = tempDir();
        const log = quietLog();
        fs.writeFileSync(RelayStore.getRelayStatePath(dir), body);
        const relay = createRelayMemory();
        RelayStore.loadRelayState(dir, relay, log);
        assert.deepEqual(relay, createRelayMemory(), `принято из ${body}`);
        assert.ok(log.lines.some((l) => l.level === 'warn'), `молча проглочено: ${body}`);
    }
});

test('неожиданные поля и значения: лишнее отбрасывается по правилам relay-payload', () => {
    const dir = tempDir();
    // `__proto__` — СТРОКОЙ: литерал объекта превратил бы его в прототип, и
    // JSON.stringify его бы не записал.
    fs.writeFileSync(RelayStore.getRelayStatePath(dir), JSON.stringify({
        version: RelayStore.RELAY_STATE_VERSION,
        relay: {
            // Поле, которого нет в памяти, — не заводится.
            lastSomething: { a: 1 },
            // Окно — не поле памяти: индекс дисплея не хранится.
            lastDisplayIndex: 3,
            // Вложенный объект внутри цветов — не примитив, отброшен по ключу.
            lastWidgetColors: { timer: '#ffffff', nested: { x: 1 }, PROTO: { polluted: true } },
            // Не объект — не принимается вовсе.
            lastWidgetStyle: 'digits',
            // Тема вне списка, замок не булев — не принимаются.
            uiTheme: 'neon',
            uiLocked: 'yes'
        }
    }).replace('"PROTO"', '"__proto__"'));
    const relay = createRelayMemory();
    RelayStore.loadRelayState(dir, relay, quietLog());
    assert.deepEqual(relay.lastWidgetColors, { timer: '#ffffff' });
    assert.equal(relay.lastWidgetStyle, null);
    assert.equal(relay.lastDisplayIndex, 'auto');
    assert.equal(relay.uiTheme, null);
    assert.equal(relay.uiLocked, null);
    assert.equal(({}).polluted, undefined, 'прототип не загрязнён');
});

test('слишком большой файл не читается в память целиком', () => {
    const dir = tempDir();
    const log = quietLog();
    const big = 'x'.repeat(RelayStore.MAX_FILE_BYTES + 10);
    fs.writeFileSync(RelayStore.getRelayStatePath(dir), JSON.stringify({
        version: RelayStore.RELAY_STATE_VERSION, relay: { lastWidgetStyle: { s: big } }
    }));
    const relay = createRelayMemory();
    RelayStore.loadRelayState(dir, relay, log);
    assert.equal(relay.lastWidgetStyle, null);
    assert.ok(log.lines.some((l) => l.level === 'warn'));
});

test('проверка отсутствия проверяет сама себя: тот же разбор ПРИНИМАЕТ верное значение', () => {
    // Без этой пары зелёный «тема neon отвергнута» значил бы и «правило работает»,
    // и «разбор не принимает ничего».
    const accepted = RelayStore.parseRelayState(JSON.stringify({
        version: RelayStore.RELAY_STATE_VERSION,
        relay: { lastWidgetStyle: { alwaysOnTop: false }, lastClockSettings: { showDate: true, showTicks: true } }
    }));
    assert.deepEqual(accepted, {
        lastWidgetStyle: { alwaysOnTop: false }, lastClockSettings: { showDate: true, showTicks: true }
    });
});

test('склейка: десять изменений подряд — одна запись, после задержки', () => {
    const dir = tempDir();
    const relay = createRelayMemory();
    const timers = [];
    let writes = 0;
    const p = persister(dir, quietLog(), {
        relay,
        delayMs: 500,
        setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
        clearTimer: (t) => { if (t) { t.cleared = true; } },
        write: (userDataPath, r) => { writes++; RelayStore.writeRelayState(userDataPath, r); }
    });
    p.loadOnStart();
    for (let i = 0; i < 10; i++) {
        relay.lastWidgetStyle = { style: i % 2 ? 'flip' : 'digits' };
        p.schedule();
    }
    assert.equal(writes, 0, 'на каждое сообщение файл не пишется');
    const live = timers.filter((t) => !t.cleared);
    assert.equal(live.length, 1, 'ждёт ровно одна запись');
    assert.equal(live[0].ms, 500);
    live[0].fn();
    assert.equal(writes, 1);
    assert.equal(JSON.parse(fs.readFileSync(RelayStore.getRelayStatePath(dir), 'utf8')).relay.lastWidgetStyle.style, 'flip');
});

test('flush пишет отложенное сразу (выход), второй flush без изменений — не пишет', () => {
    const dir = tempDir();
    const relay = createRelayMemory();
    let writes = 0;
    const p = persister(dir, quietLog(), {
        relay,
        setTimer: () => ({}), clearTimer: () => {},
        write: (d, r) => { writes++; RelayStore.writeRelayState(d, r); }
    });
    p.loadOnStart();
    relay.lastWidgetStyle = { alwaysOnTop: false };
    p.schedule();
    p.flush();
    assert.equal(writes, 1);
    p.flush();
    assert.equal(writes, 1, 'нечего писать — диск не трогается');
    // То же значение, присланное ещё раз (панель шлёт настройки на старте), —
    // не изменение.
    p.schedule();
    p.flush();
    assert.equal(writes, 1, 'тот же снимок второй раз не пишется');
});

test('discard («Сбросить всё») удаляет файл, и выход его не воскрешает', () => {
    const dir = tempDir();
    const relay = filledRelay();
    const p = persister(dir, quietLog(), { relay, setTimer: () => ({}), clearTimer: () => {} });
    p.loadOnStart();
    relay.lastWidgetStyle = { alwaysOnTop: false };
    p.schedule();
    p.flush();
    assert.ok(fs.existsSync(RelayStore.getRelayStatePath(dir)));
    relay.lastWidgetStyle = { alwaysOnTop: true };
    p.schedule();
    p.discard();
    assert.ok(!fs.existsSync(RelayStore.getRelayStatePath(dir)), 'файл удалён');
    p.flush(); // before-quit после сброса
    assert.ok(!fs.existsSync(RelayStore.getRelayStatePath(dir)), 'выход после сброса файл не пишет');
});

test('ошибка записи — в журнал, не исключение (выход не должен падать)', () => {
    const log = quietLog();
    const relay = createRelayMemory();
    const p = persister('/nonexistent/dir/for/relay', log, {
        relay, setTimer: () => ({}), clearTimer: () => {}
    });
    p.loadOnStart();
    relay.lastWidgetStyle = { alwaysOnTop: false };
    p.schedule();
    assert.doesNotThrow(() => p.flush());
    assert.ok(log.lines.some((l) => l.level === 'warn' && l.text.includes('relay-state')));
    // Путь профиля несёт имя учётной записи (SEC-11) — в журнал не идёт.
    assert.ok(!log.lines.some((l) => l.text.includes('/nonexistent/dir')), 'в журнале полный путь');
});

test('loadOnStart заполняет ту память, что передана, и не заменяет объект', () => {
    const dir = tempDir();
    RelayStore.writeRelayState(dir, filledRelay());
    const relay = createRelayMemory();
    const p = persister(dir, quietLog(), { relay, setTimer: () => ({}), clearTimer: () => {} });
    p.loadOnStart();
    assert.equal(relay.lastWidgetStyle.style, 'digits');
    assert.ok(Object.isSealed(relay), 'тот же запечатанный объект main-state');
});

test('без loadOnStart память в файл НЕ пишется: пустой процесс не стирает чужой файл', () => {
    // Второй экземпляр выходит, не прочитав файл. Пиши он на выходе — файл
    // основного стал бы {"version":1,"relay":{}}.
    const dir = tempDir();
    RelayStore.writeRelayState(dir, filledRelay());
    const before = fs.readFileSync(RelayStore.getRelayStatePath(dir), 'utf8');
    const p = persister(dir, quietLog(), { setTimer: () => ({}), clearTimer: () => {} });
    p.schedule();
    p.flush();
    assert.equal(fs.readFileSync(RelayStore.getRelayStatePath(dir), 'utf8'), before);
});

test('тема и замок в файл не пишутся и из файла не читаются', () => {
    // Окно, открытое до посылки панели, записало бы досланный замок в общий
    // localStorage (ui-lock.js, writeLock). Устаревшее значение файла стало бы
    // настройкой. Окна читают тему и замок сами, из localStorage в <head>;
    // снимок main несёт их только после посылки панели в ЭТОЙ сессии.
    const dir = tempDir();
    RelayStore.writeRelayState(dir, filledRelay());
    const text = fs.readFileSync(RelayStore.getRelayStatePath(dir), 'utf8');
    assert.ok(!text.includes('uiTheme') && !text.includes('uiLocked'), text);

    fs.writeFileSync(RelayStore.getRelayStatePath(dir), JSON.stringify({
        version: RelayStore.RELAY_STATE_VERSION, relay: { uiTheme: 'light', uiLocked: true, lastWidgetStyle: { a: 1 } }
    }));
    const relay = createRelayMemory();
    RelayStore.loadRelayState(dir, relay, quietLog());
    assert.equal(relay.uiTheme, null);
    assert.equal(relay.uiLocked, null);
    assert.deepEqual(relay.lastWidgetStyle, { a: 1 }, 'остальное из того же файла читается');
});

test('настройки часов из файла — только известные ключи: брошенный панелью ключ не живёт вечно', () => {
    // Память часов НАКАПЛИВАЕТСЯ (main-relay-ipc.js, слияние), и с файлом
    // накопление переживает перезапуски: ключ, который панель перестала
    // слать, остался бы навсегда. Известные — таблица clock-settings-schema
    // плюс showTicks, который pushClockSettings шлёт сверх таблицы.
    const dir = tempDir();
    fs.writeFileSync(RelayStore.getRelayStatePath(dir), JSON.stringify({
        version: RelayStore.RELAY_STATE_VERSION,
        relay: { lastClockSettings: { showDate: true, clockDigitsFont: 'mono', showTicks: true, retiredKey: 1, opacity: 0.5 } }
    }));
    const relay = createRelayMemory();
    RelayStore.loadRelayState(dir, relay, quietLog());
    assert.deepEqual(relay.lastClockSettings, { showDate: true, clockDigitsFont: 'mono', showTicks: true });
});
