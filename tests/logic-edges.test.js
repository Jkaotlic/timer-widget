'use strict';

/**
 * logic-edges.test.js
 *
 * Границы, которые нашёл Stryker (02.11.2026): эти условия можно было сломать, и
 * ни один тест не краснел, — например, снять якоря у регулярки цвета, которая
 * закрывает CSS-инъекцию. Код был верен; тесты держат его таким.
 *
 * Перепроверить (в копии проекта, в git его нет):
 *   npx -p @stryker-mutator/core stryker run
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isSafeColor, isValidDataURL, validateImageSource, safeJSONParse } = require('../security');
const recovery = require('../recovery');
const engine = require('../timer-engine');
const { createTimerController } = require('../timer-controller');
const Money = require('../money-meter');
const Report = require('../event-report.js');
const { calculateProgress, safelySendToWindow, formatTime } = require('../utils');

// --- Цвет: всё, что не целиком цвет, — попытка дописать CSS ---

test('isSafeColor: мусор вокруг цвета отвергается с обеих сторон', () => {
    for (const bad of [
        'x #fff', '#fff;background:url(x)', 'url(x)#fff',
        'url(x) rgb(1,2,3)', 'rgb(1,2,3);color:red', 'rgba(1,2,3,0.5) url(x)'
    ]) {
        assert.equal(isSafeColor(bad), false, bad);
    }
});

test('isSafeColor: каждая компонента и альфа проверяются отдельно', () => {
    for (const bad of ['rgb(256,0,0)', 'rgb(0,256,0)', 'rgb(0,0,256)', 'rgba(0,0,0,1.01)', 'rgba(0,0,0,101%)', 'rgba(0,0,0,.)']) {
        assert.equal(isSafeColor(bad), false, bad);
    }
    for (const good of ['rgb(255, 255, 255)', 'rgb(0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,1)', 'rgba(0, 0, 0, 50%)', 'rgba(0,0,0,100%)', '#abc', '#AABBCCDD']) {
        assert.equal(isSafeColor(good), true, good);
    }
});

test('isSafeColor и isValidDataURL: не строка — отказ, а не исключение', () => {
    for (const bad of [null, undefined, '', 0, 42, {}, [], true]) {
        assert.equal(isSafeColor(bad), false);
        assert.equal(isValidDataURL(bad), false);
    }
});

test('isValidDataURL: только изображение целиком, SVG нет', () => {
    assert.equal(isValidDataURL('data:image/png;base64,AAAA=='), true);
    for (const bad of [
        'x data:image/png;base64,AAAA', 'data:image/png;base64,AAAA"><script>',
        'data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA'
    ]) {
        assert.equal(isValidDataURL(bad), false, bad);
    }
});

test('validateImageSource: отказ пуст и назван, успех отдаёт ровно вход', () => {
    const good = 'data:image/webp;base64,AAAA';
    assert.deepEqual(validateImageSource(good), { valid: true, sanitized: good, error: null });
    for (const bad of ['', null, 7, 'https://example.com/a.png', 'data:image/svg+xml;base64,AAAA', 'file:///etc/passwd']) {
        const out = validateImageSource(bad);
        assert.equal(out.valid, false);
        assert.equal(out.sanitized, '');
        assert.ok(out.error.length > 0);
    }
});

test('safeJSONParse: не строка — запасное значение', () => {
    const fallback = { a: 1 };
    for (const bad of [null, undefined, '', 5, {}]) {
        assert.equal(safeJSONParse(bad, fallback), fallback);
    }
});

// --- Снимок восстановления ---

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tw-edges-'));
}

test('снимок: нет файла — null; старый — null и файл удалён; свежий — читается', () => {
    const dir = tmpDir();
    const file = recovery.getRecoveryStatePath(dir);
    try {
        assert.equal(recovery.loadSavedTimerState(dir), null);

        fs.writeFileSync(file, JSON.stringify({ presetSeconds: 5, savedAt: Date.now() - recovery.MAX_AGE_MS - 5000 }));
        assert.equal(recovery.loadSavedTimerState(dir), null);
        assert.equal(fs.existsSync(file), false, 'протухший снимок обязан быть удалён');

        fs.writeFileSync(file, JSON.stringify({ presetSeconds: 5, savedAt: Date.now() }));
        assert.equal(recovery.loadSavedTimerState(dir).presetSeconds, 5);
        assert.equal(fs.existsSync(file), true, 'свежий снимок не удаляется чтением');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('снимок: битый файл — null и запись в журнал, а не исключение', () => {
    const dir = tmpDir();
    const warned = [];
    try {
        fs.writeFileSync(recovery.getRecoveryStatePath(dir), '{обрезан');
        assert.equal(recovery.loadSavedTimerState(dir, { warn: (...a) => warned.push(a) }), null);
        assert.equal(warned.length, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('снимок: сбой записи уходит в журнал', () => {
    const errors = [];
    recovery.saveTimerStateToFileSync(path.join(os.tmpdir(), 'tw-нет', 'такого', 'каталога'), {}, { error: (...a) => errors.push(a) });
    assert.equal(errors.length, 1);
});

test('clearSavedTimerState: удаляет файл, без файла молчит', () => {
    const dir = tmpDir();
    const file = recovery.getRecoveryStatePath(dir);
    try {
        fs.writeFileSync(file, '{}');
        recovery.clearSavedTimerState(dir);
        assert.equal(fs.existsSync(file), false);
        assert.doesNotThrow(() => recovery.clearSavedTimerState(dir));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('isRecoveryValid: границы возраста и мусор на входе', () => {
    const now = 1_700_000_000_000;
    const at = (savedAt) => ({ savedAt, presetSeconds: 1 });
    assert.equal(recovery.isRecoveryValid(at(now), now), true);
    assert.equal(recovery.isRecoveryValid(at(now - recovery.MAX_AGE_MS), now), true);
    assert.equal(recovery.isRecoveryValid(at(now - recovery.MAX_AGE_MS - 1), now), false);
    assert.equal(recovery.isRecoveryValid(at(now + 1), now), false);
    for (const bad of [null, undefined, 'x', 5, at('1'), at(NaN), at(Infinity), {}]) {
        assert.equal(recovery.isRecoveryValid(bad, now), false);
    }
});

// --- Движок ---

const base = (over = {}) => ({ totalSeconds: 100, remainingSeconds: 100, presetSeconds: 100, isRunning: true, isPaused: false, finished: false, ...over });

test('tick: «осталась минута» — только при пересечении сверху и не ниже нуля', () => {
    const events = (remaining, step) => engine.tick(base({ remainingSeconds: remaining }), { allowNegative: true }, step).events;
    assert.ok(events(61, 1).includes('timer-minute'));
    assert.ok(!events(60, 1).includes('timer-minute'), 'уже в последней минуте');
    assert.ok(!events(62, 1).includes('timer-minute'), 'ещё не дошёл');
    assert.ok(!events(50, 1).includes('timer-minute'));
    assert.ok(events(61, 61).includes('timer-minute'), 'шаг ровно до нуля');
    assert.ok(!events(61, 62).includes('timer-minute'), 'шаг сразу в минус');
});

test('tick: напоминание о перелимите — только в минусе и только при allowNegative', () => {
    const cfg = { allowNegative: true, overrunIntervalMinutes: 1 };
    assert.ok(!engine.tick(base({ remainingSeconds: 1 }), cfg, 1).events.includes('timer-overrun-minute'), 'ноль ещё не минус');
    assert.ok(engine.tick(base({ remainingSeconds: -59 }), cfg, 1).events.includes('timer-overrun-minute'));
    assert.ok(!engine.tick(base({ remainingSeconds: 200 }), { allowNegative: false }, 1).events.includes('timer-overrun-minute'));
    assert.ok(!engine.tick(base({ remainingSeconds: 200 }), cfg, 1).events.includes('timer-overrun-minute'));
});

test('tick: без лимита и в плюсе таймер идёт дальше и не закончен', () => {
    const out = engine.tick(base({ remainingSeconds: 100 }), { allowNegative: true, overrunLimitSeconds: 0 }, 1);
    assert.equal(out.finished, false);
    assert.equal(out.state.finished, false);
    assert.equal(out.state.isRunning, true);
    const limited = engine.tick(base({ remainingSeconds: 100 }), { allowNegative: true, overrunLimitSeconds: 50 }, 1);
    assert.equal(limited.finished, false, 'лимит сравнивается с минусом, а не с плюсом');
    assert.equal(limited.state.remainingSeconds, 99);
});

test('tick: финиш снимает и ход, и паузу', () => {
    const out = engine.tick(base({ remainingSeconds: 1, isPaused: true }), { allowNegative: false }, 1);
    assert.equal(out.state.isRunning, false);
    assert.equal(out.state.isPaused, false);
    assert.equal(out.state.finished, true);
});

test('adjust: по умолчанию минус запрещён; setPreset: мусор даёт 0, значение — значение', () => {
    assert.equal(engine.adjust(base({ remainingSeconds: 10 }), -20).remainingSeconds, 0);
    assert.equal(engine.setPreset(base(), 'x').remainingSeconds, 0);
    assert.equal(engine.setPreset(base(), 90).remainingSeconds, 90);
    assert.equal(engine.toWholeSeconds(NaN), null);
    assert.equal(engine.toWholeSeconds('5'), null);
    assert.equal(engine.toWholeSeconds(Infinity), null);
});

// --- Контроллер ---

function harness() {
    const w = { wall: 1_000_000, mono: 0, states: [] };
    w.c = createTimerController({ engine, now: () => w.wall, monotonic: () => w.mono, onState: (s) => w.states.push(s) });
    return w;
}

test('контроллер: стартовое состояние и настройки по умолчанию', () => {
    const { c } = harness();
    const s = c.getState();
    assert.equal(s.isRunning, false);
    assert.equal(s.isPaused, false);
    assert.equal(s.finished, false);
    assert.deepEqual(c.getConfig(), { allowNegative: false, overrunLimitSeconds: 0, overrunIntervalMinutes: 1 });
});

test('setConfig: чужая посылка не меняет конфиг; true — только при настоящей смене', () => {
    const { c } = harness();
    assert.equal(c.setConfig(null), false);
    assert.equal(c.setConfig('x'), false);
    assert.equal(c.setConfig({ overrunLimitSeconds: NaN }), false);
    assert.equal(c.setConfig({ overrunLimitSeconds: '30' }), false);
    assert.equal(c.setConfig({ overrunIntervalMinutes: Infinity }), false);
    assert.equal(c.getConfig().overrunLimitSeconds, 0);
    assert.equal(c.setConfig({ overrunLimitSeconds: 30 }), true);
    assert.equal(c.setConfig({ overrunLimitSeconds: 30 }), false);
    assert.equal(c.setConfig({ overrunIntervalMinutes: 3 }), true);
    assert.equal(c.setConfig({ overrunIntervalMinutes: 3 }), false);
});

test('пауза на секунде, где таймер уже кончился: это финиш, а не пауза', () => {
    const w = harness();
    w.c.setPreset(5);
    w.c.start();
    w.mono += 6000;
    assert.equal(w.c.pause(), false);
    const s = w.c.getState();
    assert.equal(s.finished, true);
    assert.equal(s.isPaused, false);
});

test('поправка у стоящего таймера не ставит якорь: следующий старт считает от новой точки', () => {
    const w = harness();
    w.c.setPreset(100);
    w.c.adjust(10);
    w.mono += 5000;
    w.c.start();
    w.c.reconcile();
    assert.equal(w.c.getState().remainingSeconds, 110);
});

test('resume: сон без suspend и сон у стоящего таймера не засчитываются', () => {
    const w = harness();
    w.c.setPreset(100);
    w.c.start();
    w.wall += 50_000;
    w.c.resume();
    w.c.reconcile();
    assert.equal(w.c.getState().remainingSeconds, 100, 'suspend не было');

    w.c.pause();
    w.c.suspend();
    w.wall += 50_000;
    w.c.resume();
    w.c.start();
    w.c.reconcile();
    assert.equal(w.c.getState().remainingSeconds, 100, 'спал, пока стоял');
});

test('finish без аргумента: без минуса не ниже нуля', () => {
    const w = harness();
    w.c.setConfig({ allowNegative: true });
    w.c.adjust(-30);
    w.c.setConfig({ allowNegative: false });
    w.c.finish();
    assert.equal(w.c.getState().remainingSeconds, 0);
});

test('restoreState: мусор игнорируется, отсутствующий пресет не затирает', () => {
    const { c } = harness();
    c.setPreset(50);
    c.restoreState(null);
    c.restoreState('x');
    c.restoreState({ remainingSeconds: 7 });
    assert.equal(c.getState().presetSeconds, 50);
    assert.equal(c.getState().remainingSeconds, 7);
    c.restoreState({ remainingSeconds: NaN, totalSeconds: Infinity });
    assert.equal(c.getState().remainingSeconds, 7);
    assert.equal(c.getState().totalSeconds, 50);
});

// --- Деньги ---

test('деньги: ставка строкой с пробелами, ноль секунд, ставки и периода', () => {
    assert.equal(Money.overrunCost(120, ' 1000 ', '60'), 2000);
    assert.equal(Money.overrunCost(0, 1000, 60), 0);
    assert.equal(Money.overrunCost(120, 0, 60), 0);
    assert.equal(Money.overrunCost(120, -5, 60), 0);
    assert.equal(Money.overrunCost(120, 1000, 0), 0);
    assert.equal(Money.overrunCost(-120, 1000, 60), 0);
});

// --- Время и окна ---

test('calculateProgress: минус — ноль, а не отрицательная полоса', () => {
    assert.equal(calculateProgress(-5, 100), 0);
    assert.equal(calculateProgress(0, 100), 0);
    assert.equal(calculateProgress(50, 100), 0.5);
    assert.equal(calculateProgress(200, 100), 1);
    assert.equal(calculateProgress(5, 0), 0);
});

test('formatTime: всегда ЧЧ:ММ:СС, ноль без знака, минус со знаком', () => {
    assert.equal(formatTime(0), '00:00:00');
    assert.equal(formatTime(3599), '00:59:59');
    assert.equal(formatTime(3600), '01:00:00');
    assert.equal(formatTime(-61), '-00:01:01');
});

test('safelySendToWindow: нет окна и уничтоженное окно — false, отправки нет', () => {
    let sent = 0;
    const webContents = { isDestroyed: () => false, send: () => { sent++; } };
    assert.equal(safelySendToWindow(null, 'c'), false);
    assert.equal(safelySendToWindow({ isDestroyed: () => true, webContents }, 'c'), false);
    assert.equal(sent, 0);
    assert.equal(safelySendToWindow({ isDestroyed: () => false, webContents }, 'c', 1), true);
    assert.equal(sent, 1);
});

// --- Отчёт: файл читает бухгалтер, поэтому проверяется ТЕКСТ целиком ---

const localIso = (h, m, s) => new Date(2026, 8, 9, h, m, s).toISOString();

test('отчёт с деньгами: файл целиком, байт в байт', () => {
    const { csv } = Report.buildReportCSV({
        title: '  Совет  ',
        finished: true,
        overrunSeconds: 125,
        price: 1000,
        period: 60,
        talks: [
            { n: 1, endedAt: localIso(9, 5, 7), overrunSeconds: 60 },
            { n: 2, endedAt: localIso(10, 0, 0), overrunSeconds: 65 }
        ],
        now: new Date(2026, 0, 1)
    });
    const money = (v) => Money.formatMoney(v);
    assert.deepEqual(csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l), [
        'Мероприятие;Совет',
        'Дата;09.09.2026',
        'Состояние;Завершено',
        '',
        '№;Окончание;Перелимит;Стоимость',
        `1;09:05:07;00:01:00;${money(1000)}`,
        `2;10:00:00;00:01:05;${money(1000)}`,
        '',
        `Итого;;00:02:05;${money(2000)}`
    ]);
});

test('отчёт без прейскуранта: колонки денег нет, незавершённое не названо завершённым', () => {
    const { csv } = Report.buildReportCSV({
        overrunSeconds: 60,
        talks: [{ n: 1, endedAt: localIso(9, 0, 0), overrunSeconds: 60 }],
        now: new Date(2026, 0, 1)
    });
    assert.ok(csv.includes('№;Окончание;Перелимит\r\n') || csv.includes('№;Окончание;Перелимит\n'));
    assert.ok(!csv.includes('Стоимость'));
    assert.ok(!csv.includes('Завершено'));
    assert.ok(!csv.includes('Мероприятие'));
    assert.ok(/Итого;;00:01:00\s*$/.test(csv));
    assert.ok(!csv.includes('Примечание'));
});

test('отчёт: расхождение с итогом называется', () => {
    const { csv, partial } = Report.buildReportCSV({ overrunSeconds: 60, talks: [], now: new Date(2026, 0, 1) });
    assert.equal(partial, true);
    assert.ok(csv.includes('Примечание;разбивка неполна: часть докладов закрыта до того, как журнал начал вестись, либо журнал обрезан по длине. Итог верен.'));
});

test('отчёт: мусор из файла журнала не печатается', () => {
    const good = { n: 1, endedAt: localIso(9, 0, 0), overrunSeconds: 0 };
    const { rows } = Report.buildReportCSV({
        talks: [
            null, 0, 'x',
            { n: 2, endedAt: localIso(9, 0, 0), overrunSeconds: -1 },
            { n: 3, endedAt: localIso(9, 0, 0), overrunSeconds: 'abc' },
            { n: 4, endedAt: localIso(9, 0, 0), overrunSeconds: Infinity },
            { n: 5, endedAt: 12345, overrunSeconds: 1 },
            { n: 6, endedAt: 'вчера', overrunSeconds: 1 },
            good
        ],
        now: new Date(2026, 0, 1)
    });
    assert.equal(rows, 1);
});

test('отчёт: идущий доклад с мусором не печатается, с нулём — печатается «идёт»', () => {
    const talks = [];
    for (const current of [null, 'x', { overrunSeconds: -1 }, { overrunSeconds: 'abc' }, { overrunSeconds: Infinity }]) {
        assert.ok(!Report.buildReportCSV({ talks, current, now: new Date(2026, 0, 1) }).csv.includes('идёт'));
    }
    assert.ok(Report.buildReportCSV({ talks, current: { overrunSeconds: 0 }, now: new Date(2026, 0, 1) }).csv.includes('идёт'));
});

test('отчёт: минус в итоге и мусор в итоге дают ноль; дата без журнала — из now', () => {
    for (const overrunSeconds of [-5, NaN, 'x', undefined]) {
        const { totalSeconds } = Report.buildReportCSV({ overrunSeconds, talks: [], now: new Date(2026, 0, 1) });
        assert.equal(totalSeconds, 0);
    }
    assert.ok(Report.buildReportCSV({ talks: [], now: new Date(2026, 0, 1) }).csv.includes('Дата;01.01.2026'));
});

test('csvCell: пусто вместо null; формула только в начале; число — не формула', () => {
    assert.equal(Report.csvCell(null), '');
    assert.equal(Report.csvCell(undefined), '');
    assert.equal(Report.csvCell('a=b'), 'a=b');
    assert.equal(Report.csvCell('=1+1'), '"\'=1+1"');
    assert.equal(Report.csvCell(-5), '-5');
    assert.equal(Report.csvCell(NaN), 'NaN');
    assert.equal(Report.csvCell('-5'), '"\'-5"');
});
