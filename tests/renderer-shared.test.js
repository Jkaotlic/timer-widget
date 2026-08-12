const test = require('node:test');
const assert = require('node:assert/strict');
const {
    breakdown,
    flipCells,
    clampScale,
    timerLifecycleStatus,
    timerColorBand,
    endsAt
} = require('../renderer-shared');

// ---------------------------------------------------------------------------
// breakdown
// ---------------------------------------------------------------------------
test('breakdown: sub-hour value (mm:ss range)', () => {
    // 245s = 4m 5s
    assert.deepEqual(breakdown(245), { hours: 0, minutes: 4, seconds: 5, hasHours: false });
});

test('breakdown: value >= 3600 exposes hours', () => {
    // 3661s = 1h 1m 1s
    assert.deepEqual(breakdown(3661), { hours: 1, minutes: 1, seconds: 1, hasHours: true });
});

test('breakdown: exact 3600 boundary is the hours threshold', () => {
    assert.deepEqual(breakdown(3600), { hours: 1, minutes: 0, seconds: 0, hasHours: true });
    // 3599 must NOT show hours
    assert.deepEqual(breakdown(3599), { hours: 0, minutes: 59, seconds: 59, hasHours: false });
});

test('breakdown: negative (overrun) handled by absolute magnitude', () => {
    assert.deepEqual(breakdown(-65), { hours: 0, minutes: 1, seconds: 5, hasHours: false });
    assert.deepEqual(breakdown(-3600), { hours: 1, minutes: 0, seconds: 0, hasHours: true });
});

test('breakdown: zero', () => {
    assert.deepEqual(breakdown(0), { hours: 0, minutes: 0, seconds: 0, hasHours: false });
});

test('breakdown: floors fractional seconds before decomposing', () => {
    assert.deepEqual(breakdown(65.9), { hours: 0, minutes: 1, seconds: 5, hasHours: false });
});

test('breakdown: non-finite input coerces to zero', () => {
    assert.deepEqual(breakdown(NaN), { hours: 0, minutes: 0, seconds: 0, hasHours: false });
    assert.deepEqual(breakdown(Infinity), { hours: 0, minutes: 0, seconds: 0, hasHours: false });
    assert.deepEqual(breakdown(undefined), { hours: 0, minutes: 0, seconds: 0, hasHours: false });
});

test('breakdown: large multi-hour value', () => {
    // 2h 3m 4s = 7384
    assert.deepEqual(breakdown(7384), { hours: 2, minutes: 3, seconds: 4, hasHours: true });
});

// ---------------------------------------------------------------------------
// flipCells
// ---------------------------------------------------------------------------
test('flipCells: digit characters for a sub-hour value', () => {
    // 754s = 12m 34s
    const c = flipCells(754);
    assert.equal(c.m1, '1');
    assert.equal(c.m2, '2');
    assert.equal(c.s1, '3');
    assert.equal(c.s2, '4');
    assert.equal(c.hasHours, false);
    // All cells are single-character strings
    Object.keys(c).forEach((k) => {
        if (k !== 'hasHours') { assert.equal(typeof c[k], 'string'); }
    });
});

test('flipCells: hours shown when hours > 0', () => {
    // 1h 23m 45s = 5025
    const c = flipCells(5025);
    assert.equal(c.h1, '0');
    assert.equal(c.h2, '1');
    assert.equal(c.m1, '2');
    assert.equal(c.m2, '3');
    assert.equal(c.s1, '4');
    assert.equal(c.s2, '5');
    assert.equal(c.hasHours, true);
});

test('flipCells: hours hidden for sub-hour with no preset', () => {
    const c = flipCells(125); // 2m 5s
    assert.equal(c.hasHours, false);
});

test('flipCells: preset >= 3600 forces hours even for sub-hour value', () => {
    // remaining only 2m 5s but the timer preset is 1h → flip must show hours
    const c = flipCells(125, 3600);
    assert.equal(c.hasHours, true);
});

test('flipCells: preset < 3600 does not force hours', () => {
    const c = flipCells(125, 1800);
    assert.equal(c.hasHours, false);
});

test('flipCells: two-digit hours split correctly', () => {
    // 12h 0m 0s = 43200
    const c = flipCells(43200);
    assert.equal(c.h1, '1');
    assert.equal(c.h2, '2');
    assert.equal(c.hasHours, true);
});

test('flipCells: negative (overrun) uses absolute magnitude', () => {
    const c = flipCells(-125);
    assert.equal(c.m1, '0');
    assert.equal(c.m2, '2');
    assert.equal(c.s1, '0');
    assert.equal(c.s2, '5');
});

test('flipCells: zero', () => {
    const c = flipCells(0);
    assert.equal(c.m1, '0');
    assert.equal(c.m2, '0');
    assert.equal(c.s1, '0');
    assert.equal(c.s2, '0');
    assert.equal(c.hasHours, false);
});

// ---------------------------------------------------------------------------
// clampScale
// ---------------------------------------------------------------------------
test('clampScale: value within range is unchanged', () => {
    assert.equal(clampScale(150, 30, 600), 150);
});

test('clampScale: below min clamps to min', () => {
    assert.equal(clampScale(10, 30, 600), 30);
});

test('clampScale: above max clamps to max', () => {
    assert.equal(clampScale(900, 30, 600), 600);
});

test('clampScale: respects display timer bounds 30..300', () => {
    assert.equal(clampScale(500, 30, 300), 300);
    assert.equal(clampScale(20, 30, 300), 30);
});

test('clampScale: respects display block bounds 50..600', () => {
    assert.equal(clampScale(40, 50, 600), 50);
    assert.equal(clampScale(700, 50, 600), 600);
});

test('clampScale: equal bounds collapse to that value', () => {
    assert.equal(clampScale(123, 100, 100), 100);
    assert.equal(clampScale(50, 100, 100), 100);
});

test('clampScale: value exactly at the bounds is returned as-is', () => {
    assert.equal(clampScale(30, 30, 600), 30);
    assert.equal(clampScale(600, 30, 600), 600);
});

test('clampScale: non-finite value returns min', () => {
    assert.equal(clampScale(NaN, 30, 600), 30);
    assert.equal(clampScale(Infinity, 30, 600), 600); // Infinity > max → clamps to max
    assert.equal(clampScale(-Infinity, 30, 600), 30);
});

test('clampScale: swapped bounds are normalized', () => {
    assert.equal(clampScale(150, 600, 30), 150);
    assert.equal(clampScale(900, 600, 30), 600);
    assert.equal(clampScale(10, 600, 30), 30);
});

// ---------------------------------------------------------------------------
// timerLifecycleStatus — единый порядок приоритетов статуса для трёх окон.
// Раньше это условие было скопировано в панель управления, виджет и
// полноэкранный режим, и копии разошлись (см. аудит 2026-07-29).
// ---------------------------------------------------------------------------

const st = (o) => timerLifecycleStatus(o);

test('timerLifecycleStatus: свежий таймер без пресета — idle', () => {
    assert.equal(st({ remainingSeconds: 0, totalSeconds: 0, isRunning: false, isPaused: false, finished: false }), 'idle');
});

test('timerLifecycleStatus: выставлен пресет, но не запущен — idle', () => {
    assert.equal(st({ remainingSeconds: 300, totalSeconds: 300, isRunning: false, isPaused: false, finished: false }), 'idle');
});

test('timerLifecycleStatus: идёт отсчёт — running', () => {
    assert.equal(st({ remainingSeconds: 183, totalSeconds: 300, isRunning: true, isPaused: false, finished: false }), 'running');
});

test('timerLifecycleStatus: досчитали до нуля — finished', () => {
    assert.equal(st({ remainingSeconds: 0, totalSeconds: 300, isRunning: false, isPaused: false, finished: true }), 'finished');
    // Даже без залатченного флага: ноль + пресет + не идёт = завершено.
    assert.equal(st({ remainingSeconds: 0, totalSeconds: 300, isRunning: false, isPaused: false, finished: false }), 'finished');
});

test('timerLifecycleStatus: ушли ниже нуля — overtime', () => {
    assert.equal(st({ remainingSeconds: -47, totalSeconds: 300, isRunning: true, isPaused: false, finished: false }), 'overtime');
});

test('timerLifecycleStatus: перерасход важнее залатченного finished', () => {
    // Регрессия: полноэкранный режим проверял finished ПЕРВЫМ и показывал
    // зелёное «Время вышло!» поверх красного минуса на таймере.
    assert.equal(st({ remainingSeconds: -47, totalSeconds: 300, isRunning: true, isPaused: false, finished: true }), 'overtime');
});

test('timerLifecycleStatus: пауза в перерасходе — это пауза, а не «завершено»', () => {
    // Регрессия: ветка isPaused была недостижима при remainingSeconds <= 0, и
    // докладчик, выбившийся из времени и нажавший паузу, видел «Время вышло!».
    assert.equal(st({ remainingSeconds: -47, totalSeconds: 300, isRunning: false, isPaused: true, finished: false }), 'paused');
});

test('timerLifecycleStatus: пауза ровно на нуле — тоже пауза', () => {
    assert.equal(st({ remainingSeconds: 0, totalSeconds: 300, isRunning: false, isPaused: true, finished: false }), 'paused');
});

test('timerLifecycleStatus: обычная пауза', () => {
    assert.equal(st({ remainingSeconds: 120, totalSeconds: 300, isRunning: false, isPaused: true, finished: false }), 'paused');
});

test('timerLifecycleStatus: мусорный и отсутствующий ввод не роняет', () => {
    assert.equal(st(undefined), 'idle');
    assert.equal(st({}), 'idle');
    assert.equal(st({ remainingSeconds: NaN, totalSeconds: NaN }), 'idle');
    assert.equal(st({ remainingSeconds: '-5', totalSeconds: '300' }), 'overtime');
});


// ---------------------------------------------------------------------------
// timerColorBand — единая цветовая полоса для трёх окон.
// Раньше лесенка была скопирована девять раз (см. аудит 2026-07-29).
// ---------------------------------------------------------------------------

const band = (r, t, th) => timerColorBand(r, t, th);

test('timerColorBand: много времени — normal', () => {
    assert.equal(band(300, 300), 'normal');
    assert.equal(band(100, 300), 'normal');
});

test('timerColorBand: 25% и меньше — warning', () => {
    assert.equal(band(75, 300), 'warning');
    assert.equal(band(40, 300), 'warning');
});

test('timerColorBand: 10% и меньше — danger', () => {
    assert.equal(band(30, 300), 'danger');
    assert.equal(band(1, 300), 'danger');
});

test('timerColorBand: РОВНО ноль — danger, а не warning', () => {
    // Регрессия: условие было `percentLeft <= 10 && percentLeft > 0`, поэтому 0%
    // проваливался в warning и время на 00:00 показывалось ЖЁЛТЫМ, хотя рядом
    // горел красный статус «Завершено», а utils.getTimerStatus() считал ноль за danger.
    assert.equal(band(0, 300), 'danger');
});

test('timerColorBand: ниже нуля — overtime', () => {
    assert.equal(band(-1, 300), 'overtime');
    assert.equal(band(-47, 300), 'overtime');
});

test('timerColorBand: без пресета полос нет', () => {
    assert.equal(band(0, 0), 'normal');
    assert.equal(band(120, 0), 'normal');
});

test('timerColorBand: пороги настраиваются, а не захардкожены', () => {
    // Раньше 10 и 25 были вбиты в девяти местах, и CONFIG читала только панель
    // управления — правка конфига разъехала бы окна между собой.
    assert.equal(band(150, 300, { danger: 60, warning: 80 }), 'danger');
    assert.equal(band(210, 300, { danger: 60, warning: 80 }), 'warning');
    assert.equal(band(290, 300, { danger: 60, warning: 80 }), 'normal');
});

test('timerColorBand: мусорный ввод не роняет', () => {
    assert.equal(band(NaN, 300), 'danger');
    assert.equal(band(100, NaN), 'normal');
    assert.equal(band(undefined, undefined), 'normal');
});

// ---------------------------------------------------------------------------
// endsAt — подпись «закончится в 14:50» под цифрами панели (редизайн 2026-08-12)
// ---------------------------------------------------------------------------

test('endsAt: прибавляет остаток к переданному моменту', () => {
    const now = new Date(2026, 7, 12, 14, 32, 0);
    assert.equal(endsAt(18 * 60 + 24, now), '14:50');
});

test('endsAt: перерасход даёт время в ПРОШЛОМ, а не ошибку', () => {
    // Отрицательный остаток — это «должно было закончиться в». Отдельной ветки
    // для знака нет и быть не должно: арифметика та же.
    const now = new Date(2026, 7, 12, 14, 52, 0);
    assert.equal(endsAt(-(2 * 60 + 14), now), '14:49');
});

test('endsAt: переход через полночь не ломает час', () => {
    const now = new Date(2026, 7, 12, 23, 50, 0);
    assert.equal(endsAt(20 * 60, now), '00:10');
});

test('endsAt: часы и минуты всегда двузначные', () => {
    const now = new Date(2026, 7, 12, 8, 5, 0);
    assert.equal(endsAt(0, now), '08:05');
});

test('endsAt: мусор даёт null, а не NaN в подписи', () => {
    const now = new Date(2026, 7, 12, 10, 0, 0);
    for (const junk of [NaN, Infinity, -Infinity, undefined, null, '10', {}]) {
        assert.equal(endsAt(junk, now), null, `остаток ${String(junk)}`);
    }
    for (const badNow of [null, undefined, 0, 'сейчас', new Date('нет')]) {
        assert.equal(endsAt(60, badNow), null, `момент ${String(badNow)}`);
    }
});

// ---------------------------------------------------------------------------
// windowRowSubtitle — подпись строки окна (panel-state.js, редизайн 2026-08-12)
// ---------------------------------------------------------------------------

const { windowRowSubtitle } = require('../panel-state');

test('windowRowSubtitle: закрытое окно описывает себя', () => {
    assert.equal(
        windowRowSubtitle({ open: false, idle: 'маленький таймер поверх окон', style: 'круг', scale: 140 }),
        'маленький таймер поверх окон'
    );
});

test('windowRowSubtitle: открытое окно говорит состояние', () => {
    assert.equal(
        windowRowSubtitle({ open: true, idle: 'неважно', style: 'круг', scale: 140 }),
        'показан · круг · 140%'
    );
});

test('windowRowSubtitle: масштаб 100% не пишется — он ничего не сообщает', () => {
    assert.equal(windowRowSubtitle({ open: true, idle: 'x', style: 'круг', scale: 100 }), 'показан · круг');
});

test('windowRowSubtitle: у дисплея вместо стиля монитор', () => {
    assert.equal(windowRowSubtitle({ open: true, idle: 'x', where: 'Монитор 2' }), 'показан · Монитор 2');
});

test('windowRowSubtitle: без данных остаётся просто «показан», а не «показан · undefined»', () => {
    assert.equal(windowRowSubtitle({ open: true, idle: 'x' }), 'показан');
    assert.equal(windowRowSubtitle({ open: true, idle: 'x', scale: NaN, style: undefined }), 'показан');
});

test('windowRowSubtitle: мусор вместо объекта не роняет панель', () => {
    assert.equal(windowRowSubtitle(null), '');
    assert.equal(windowRowSubtitle(undefined), '');
});
