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

// ---------------------------------------------------------------------------
// secondsUntilClock — блок «До завершения» (17.08.2026)
// ---------------------------------------------------------------------------
const { secondsUntilClock } = require('../renderer-shared');

test('secondsUntilClock: считает от текущего момента до времени «Конец»', () => {
    // 12:55:39 → 15:00 = 2 ч 4 мин 21 с (числа с фотографии пользователя).
    assert.equal(secondsUntilClock(12 * 3600 + 55 * 60 + 39, '15:00'), 2 * 3600 + 4 * 60 + 21);
});

test('secondsUntilClock: время уже прошло — ноль, а не сутки до завтра', () => {
    // Перенос на следующие сутки дал бы в 15:01 бодрое «23:59:00» сразу после
    // окончания мероприятия. Ноль читается как «закончилось».
    assert.equal(secondsUntilClock(15 * 3600 + 60, '15:00'), 0);
});

test('secondsUntilClock: ровно в момент окончания — ноль', () => {
    assert.equal(secondsUntilClock(15 * 3600, '15:00'), 0);
});

test('secondsUntilClock: мусор даёт 0, а не NaN', () => {
    for (const bad of [undefined, null, '', 'abc', '25:00', '12:99', '12', 12]) {
        assert.equal(secondsUntilClock(3600, bad), 0, `вход ${JSON.stringify(bad)}`);
    }
    assert.equal(secondsUntilClock(NaN, '15:00'), 0);
});

// ---------------------------------------------------------------------------
// migrateDisplayBlocks — общий тумблер блоков стал личным у каждого (17.08.2026)
// ---------------------------------------------------------------------------
// Было: один `showTimeBlocks` на все три блока плюс `showCurrentTime` вторым
// уровнем поверх него. Стало: свой тумблер у каждого блока. Без перевода
// профиль, где блоки были ВКЛЮЧЕНЫ, открылся бы пустым дисплеем — новые ключи
// в нём отсутствуют, а их значение по умолчанию «выключено».
const { migrateDisplayBlocks } = require('../renderer-shared');

test('migrateDisplayBlocks: включённые блоки старого профиля остаются включёнными', () => {
    const out = migrateDisplayBlocks({ showTimeBlocks: true, showCurrentTime: true });
    assert.equal(out.showCurrentTime, true);
    assert.equal(out.showEventTime, true);
    assert.equal(out.showEndTime, true);
});

test('migrateDisplayBlocks: выключенные блоки остаются выключенными — все три', () => {
    // Прежний общий тумблер гасил и «Текущее время», что бы ни стояло в его
    // собственной галочке: она была ВТОРЫМ уровнем поверх общего.
    const out = migrateDisplayBlocks({ showTimeBlocks: false, showCurrentTime: true });
    assert.equal(out.showCurrentTime, false);
    assert.equal(out.showEventTime, false);
    assert.equal(out.showEndTime, false);
});

test('migrateDisplayBlocks: «Текущее время» могло быть выключено при включённых блоках', () => {
    const out = migrateDisplayBlocks({ showTimeBlocks: true, showCurrentTime: false });
    assert.equal(out.showCurrentTime, false);
    assert.equal(out.showEventTime, true);
    assert.equal(out.showEndTime, true);
});

test('migrateDisplayBlocks: новый профиль НЕ трогается — иначе перевод сработал бы дважды', () => {
    // Пользователь выключил «Начало» уже в новой версии; старый ключ при этом
    // остался в профиле от прошлой. Перевод обязан уступить новым ключам.
    const out = migrateDisplayBlocks({
        showTimeBlocks: true, showCurrentTime: true, showEventTime: false, showEndTime: true
    });
    assert.equal(out.showEventTime, false);
    assert.equal(out.showEndTime, true);
});

test('migrateDisplayBlocks: чистый профиль остаётся чистым', () => {
    assert.deepEqual(migrateDisplayBlocks({}), {});
    assert.deepEqual(migrateDisplayBlocks(null), {});
});

// ---------------------------------------------------------------------------
// fitBlockScale — потолок масштаба таймера дисплея (17.08.2026)
// ---------------------------------------------------------------------------
// Блок таймера увеличивается `transform: scale`, а трансформация раскладку не
// двигает: подпись «Осталось» сверху и плашка статуса снизу остаются на месте,
// и круг просто наезжает на них, а потом уходит за край окна. Замер до правки
// на окне 3440×1320: при 150 % круг перекрывал подпись на 148px и плашку на
// 22px, при 200 % выходил за окно на 66px сверху и снизу, при 300 % — на 429px.
const { fitBlockScale } = require('../renderer-shared');

// Блок 100×100 с центром в (100, 100); свободно 50px в каждую сторону.
const BOX = { width: 100, height: 100, centerX: 100, centerY: 100 };
const FREE = { left: 50, right: 150, top: 50, bottom: 150 };

test('fitBlockScale: запрошенный масштаб проходит, если помещается', () => {
    assert.equal(fitBlockScale({ ...BOX, free: FREE, requested: 100 }), 100);
});

test('fitBlockScale: не помещается — обрезается до влезающего', () => {
    // Свободно 50px от центра вверх, полублок 50px → потолок ровно 100 %.
    assert.equal(fitBlockScale({ ...BOX, free: FREE, requested: 300 }), 100);
});

test('fitBlockScale: потолок берётся по САМОЙ ТЕСНОЙ стороне', () => {
    // По горизонтали влезает 150 %, по вертикали 120 % — ответ 120.
    // Сторона, а не среднее: наезжает именно тесная.
    const free = { left: 25, right: 175, top: 40, bottom: 160 };
    assert.equal(fitBlockScale({ ...BOX, free, requested: 300 }), 120);
});

test('fitBlockScale: ниже 100 % потолок не опускается — это дело раскладки', () => {
    // Тесная сторона дала бы 40 %, но уменьшать блок, которого никто не
    // увеличивал, здесь не наше дело: место под 100 % отводит раскладка.
    assert.equal(fitBlockScale({ ...BOX, free: { ...FREE, top: 80 }, requested: 300 }), 100);
});

test('fitBlockScale: уменьшение НИКОГДА не ограничивается', () => {
    assert.equal(fitBlockScale({ ...BOX, free: { left: 99, right: 101, top: 99, bottom: 101 }, requested: 30 }), 30);
});

test('fitBlockScale: мусор возвращает запрошенное, а не 0 и не NaN', () => {
    // Замер мог не состояться (окно не разложено) — тогда лучше показать
    // масштаб как есть, чем схлопнуть таймер в точку.
    for (const bad of [
        { width: 0, height: 100, centerX: 100, centerY: 100, free: FREE, requested: 250 },
        { width: 100, height: NaN, centerX: 100, centerY: 100, free: FREE, requested: 250 },
        { ...BOX, free: null, requested: 250 },
        { ...BOX, free: FREE, requested: NaN }
    ]) {
        const out = fitBlockScale(bad);
        assert.ok(Number.isFinite(out), `ожидалось число, получено ${out}`);
    }
    assert.equal(fitBlockScale({ width: 0, height: 100, centerX: 100, centerY: 100, free: FREE, requested: 250 }), 250);
});

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

// ---------------------------------------------------------------------------
// Страж яркости дисплея (редизайн 2026-08-12)
// ---------------------------------------------------------------------------

const { relativeLuminance, backgroundTone } = require('../renderer-shared');

test('relativeLuminance: крайние точки и краткая запись', () => {
    assert.equal(relativeLuminance('#ffffff'), 1);
    assert.equal(relativeLuminance('#000000'), 0);
    assert.equal(relativeLuminance('#fff'), 1, 'краткая запись обязана разбираться');
});

test('relativeLuminance: мусор даёт null, а не NaN', () => {
    for (const junk of ['', '#xyz', 'red', null, undefined, 42, {}, '#12345']) {
        assert.equal(relativeLuminance(junk), null, `цвет ${String(junk)}`);
    }
});

test('backgroundTone: заливка решает сама, вопреки теме', () => {
    // Ровно тот случай, ради которого страж и написан: тёмная заливка при
    // СВЕТЛОЙ теме обязана дать тёмный фон, иначе цифры станут чёрными на чёрном.
    assert.equal(backgroundTone({ mode: 'solid', solid: '#0b0b0d', theme: 'light' }), 'dark');
    assert.equal(backgroundTone({ mode: 'solid', solid: '#ffffff', theme: 'dark' }), 'light');
});

test('backgroundTone: у градиента считается среднее по обеим точкам', () => {
    assert.equal(backgroundTone({ mode: 'gradient', grad1: '#0f0c29', grad2: '#302b63' }), 'dark');
    assert.equal(backgroundTone({ mode: 'gradient', grad1: '#ffffff', grad2: '#f2f2f7' }), 'light');
});

test('backgroundTone: картинка не разбирается — остаётся светлый текст', () => {
    // У фотографии нет одной яркости. Гадать хуже, чем держать заведомо
    // читаемый светлый текст с затемняющим оверлеем.
    assert.equal(backgroundTone({ mode: 'local', theme: 'light' }), 'dark');
});

test('backgroundTone: без своего фона решает тема', () => {
    assert.equal(backgroundTone({ theme: 'light' }), 'light');
    assert.equal(backgroundTone({ theme: 'dark' }), 'dark');
    assert.equal(backgroundTone({}), 'dark', 'без темы — прежнее поведение');
    assert.equal(backgroundTone(), 'dark', 'без аргумента тоже');
});

test('backgroundTone: нечитаемый цвет откатывается к теме, а не роняет окно', () => {
    assert.equal(backgroundTone({ mode: 'solid', solid: 'чепуха', theme: 'light' }), 'light');
    assert.equal(backgroundTone({ mode: 'gradient', grad1: 'нет', grad2: 'тоже нет', theme: 'dark' }), 'dark');
});

// ---------------------------------------------------------------------------
// surfacePaint — цвет подложки виджета и часов (вариант A: одна пара
// «цвет + прозрачность» на окно, красит подложку ТЕКУЩЕГО стиля)
// ---------------------------------------------------------------------------
const { surfacePaint } = require('../renderer-shared');

test('surfacePaint: без цвета подложки нет — владельцем дефолта остаётся CSS', () => {
    // null означает «сними переменную», а не «покрась прозрачным»: подложка
    // стиля описана в CSS, и вернуть её можно только удалением переменной.
    assert.equal(surfacePaint(null), null);
    assert.equal(surfacePaint(undefined), null);
    assert.equal(surfacePaint({}), null);
    assert.equal(surfacePaint({ alpha: 0.5 }), null, 'одна прозрачность без цвета ничего не красит');
});

test('surfacePaint: мусор вместо цвета не доезжает до CSS', () => {
    for (const junk of ['red', 'rgb(1,2,3)', '#12345', '#xyzxyz', 'url(x)', '#fff;color:red', 42, {}, '']) {
        assert.equal(surfacePaint({ color: junk }), null, `цвет ${String(junk)}`);
    }
});

test('surfacePaint: цвет без прозрачности красит непрозрачно', () => {
    assert.equal(surfacePaint({ color: '#1a2b3c' }), 'color-mix(in srgb, #1a2b3c 100%, transparent)');
    assert.equal(surfacePaint({ color: '#FFF' }), 'color-mix(in srgb, #fff 100%, transparent)');
});

test('surfacePaint: прозрачность 0 гасит подложку ЛЮБОГО стиля', () => {
    // Ровно то, ради чего задача и начата: у LED, флипа и аналога своя
    // непрозрачная подложка, и добиться полной прозрачности иначе нельзя.
    assert.equal(surfacePaint({ color: '#000000', alpha: 0 }), 'color-mix(in srgb, #000000 0%, transparent)');
});

test('surfacePaint: прозрачность зажимается в 0…1, мусор читается как 1', () => {
    assert.equal(surfacePaint({ color: '#ffffff', alpha: 5 }), 'color-mix(in srgb, #ffffff 100%, transparent)');
    assert.equal(surfacePaint({ color: '#ffffff', alpha: -3 }), 'color-mix(in srgb, #ffffff 0%, transparent)');
    for (const junk of [NaN, Infinity, 'много', null]) {
        assert.equal(
            surfacePaint({ color: '#ffffff', alpha: junk }),
            'color-mix(in srgb, #ffffff 100%, transparent)',
            `прозрачность ${String(junk)}`
        );
    }
});

test('surfacePaint: доля пишется с одним знаком, без хвоста double', () => {
    assert.equal(surfacePaint({ color: '#ffffff', alpha: 0.07 }), 'color-mix(in srgb, #ffffff 7%, transparent)');
    assert.equal(surfacePaint({ color: '#ffffff', alpha: 1 / 3 }), 'color-mix(in srgb, #ffffff 33.3%, transparent)');
});

// ---------------------------------------------------------------------------
// surfaceSolid — тот же цвет БЕЗ прозрачности, для перекидыша
// ---------------------------------------------------------------------------
const { surfaceSolid } = require('../renderer-shared');

test('surfaceSolid: отдаёт цвет и ИГНОРИРУЕТ прозрачность — в этом весь смысл', () => {
    // Карточка перекидыша — пластина, с которой створки берут свой фон.
    // Полупрозрачная означала бы, что сквозь падающую створку видно цифру под
    // ней. Поэтому прозрачность здесь не приглушается, а не учитывается вовсе.
    assert.equal(surfaceSolid({ color: '#1a2b3c' }), '#1a2b3c');
    for (const alpha of [0, 0.5, 1, null, undefined, NaN, 'чепуха']) {
        assert.equal(
            surfaceSolid({ color: '#1a2b3c', alpha }),
            '#1a2b3c',
            `прозрачность ${String(alpha)} обязана быть проигнорирована`
        );
    }
});

test('surfaceSolid: цвета нет — null, то есть подложка стиля остаётся за CSS', () => {
    assert.equal(surfaceSolid(undefined), null);
    assert.equal(surfaceSolid({}), null);
    assert.equal(surfaceSolid({ color: '' }), null);
    assert.equal(surfaceSolid({ color: 'red' }), null);
    // Та же строгая проверка, что в surfacePaint: значение уходит в CSS-объявление.
    assert.equal(surfaceSolid({ color: '#fff; background: url(x)' }), null);
    assert.equal(surfaceSolid({ color: 123 }), null);
});

test('surfaceSolid: регистр и пробелы нормализуются, как в surfacePaint', () => {
    assert.equal(surfaceSolid({ color: '  #AABBCC  ' }), '#aabbcc');
    assert.equal(surfaceSolid({ color: '#ABC' }), '#abc');
});

// ---------------------------------------------------------------------------
// surfaceAlpha — прозрачность БЕЗ выбранного цвета
// ---------------------------------------------------------------------------
const { surfaceAlpha } = require('../renderer-shared');

test('surfaceAlpha: не задана — null, чтобы CSS оставил подложку стиля как есть', () => {
    assert.equal(surfaceAlpha(undefined), null);
    assert.equal(surfaceAlpha(null), null);
    assert.equal(surfaceAlpha(''), null);
    assert.equal(surfaceAlpha('чепуха'), null);
    assert.equal(surfaceAlpha(NaN), null);
});

test('surfaceAlpha: 0 — законное значение, а не «не задана»', () => {
    // Number(null) === 0, поэтому эти два случая обязаны различаться явно:
    // иначе «фон не настроен» читалось бы как «фон погашен».
    assert.equal(surfaceAlpha(0), 0);
    assert.equal(surfaceAlpha('0'), 0);
});

test('surfaceAlpha: зажимается в 0…1', () => {
    assert.equal(surfaceAlpha(0.42), 0.42);
    assert.equal(surfaceAlpha(5), 1);
    assert.equal(surfaceAlpha(-2), 0);
});

// ---------------------------------------------------------------------------
// migrateTimerStyle — стиль LED слит с «Цифрами»
// ---------------------------------------------------------------------------
const { migrateTimerStyle } = require('../renderer-shared');

test('migrateTimerStyle: сохранённый LED читается как «Цифры»', () => {
    // Стиля digital больше нет ни в одном окне. Профиль, где он выбран, обязан
    // открыться работающим, а не пустым окном без единого активного стиля.
    assert.equal(migrateTimerStyle('digital'), 'digits');
});

test('migrateTimerStyle: остальные стили не трогает', () => {
    for (const style of ['circle', 'flip', 'analog', 'digits']) {
        assert.equal(migrateTimerStyle(style), style);
    }
});

test('migrateTimerStyle: мусор возвращается как есть — решает вызывающий', () => {
    // Подставлять здесь 'circle' значило бы прятать чужую ошибку: окно, которое
    // получило неизвестный стиль, должно вести себя одинаково и до, и после
    // слияния стилей.
    assert.equal(migrateTimerStyle('чепуха'), 'чепуха');
    assert.equal(migrateTimerStyle(''), '');
    assert.equal(migrateTimerStyle(null), null);
    assert.equal(migrateTimerStyle(undefined), undefined);
});

// ---------------------------------------------------------------------------
// surfaceTone — тон окна, чей фон задан ПОДЛОЖКОЙ, а не режимом фона
// ---------------------------------------------------------------------------
// Виджет и часы фона окна не имеют: они лежат поверх чужого рабочего стола, и
// единственное, что там красится, — подложка стиля (пара «цвет + прозрачность»
// из panel-colors.js). Отсюда та же развилка, что у дисплея, но с другим
// входом: решает ЯРКОСТЬ подложки, а тема выбирает её по умолчанию.
const { surfaceTone } = require('../renderer-shared');

test('surfaceTone: без подложки решает тема', () => {
    assert.equal(surfaceTone({ theme: 'light' }), 'light');
    assert.equal(surfaceTone({ theme: 'dark' }), 'dark');
    assert.equal(surfaceTone({}), 'dark', 'без темы — прежнее поведение окна');
    assert.equal(surfaceTone(), 'dark', 'без аргумента тоже');
});

test('surfaceTone: непрозрачная подложка решает сама, вопреки теме', () => {
    assert.equal(surfaceTone({ color: '#ffffff', theme: 'dark' }), 'light');
    assert.equal(surfaceTone({ color: '#0b0b0d', theme: 'light' }), 'dark');
});

test('surfaceTone: сквозь полупрозрачную подложку виден чужой стол — решает тема', () => {
    // Ровно тот случай, где «померить подложку» было бы враньём: при alpha 0.2
    // цвет под цифрами задаёт не подложка, а обои пользователя. Гадать по ним
    // нельзя, поэтому возвращаемся к теме — так же, как дисплей поступает с
    // картинкой на фоне.
    assert.equal(surfaceTone({ color: '#ffffff', alpha: 0.2, theme: 'dark' }), 'dark');
    assert.equal(surfaceTone({ color: '#000000', alpha: 0.2, theme: 'light' }), 'light');
    assert.equal(surfaceTone({ color: '#ffffff', alpha: 0, theme: 'dark' }), 'dark',
        'полностью погашенная подложка не красит ничего');
});

test('surfaceTone: плотная подложка решает сама', () => {
    // Порог — половина: при 0.5 цвет подложки и цвет стола вносят поровну, и
    // дальше уже подложка перевешивает.
    assert.equal(surfaceTone({ color: '#ffffff', alpha: 0.9, theme: 'dark' }), 'light');
    assert.equal(surfaceTone({ color: '#0b0b0d', alpha: 0.5, theme: 'light' }), 'dark');
});

test('surfaceTone: нечитаемый цвет откатывается к теме, а не роняет окно', () => {
    for (const junk of ['чепуха', '', 'rgb(1,2,3)', null, undefined, 42]) {
        assert.equal(surfaceTone({ color: junk, theme: 'light' }), 'light', `цвет ${String(junk)}`);
    }
});
