// renderer-shared.js — Shared PURE renderer logic for the Timer Widget app.
//
// This module de-duplicates logic that is copy-pasted across the renderer
// windows (electron-widget.html, electron-clock-widget.html, display.html /
// display-script.js). It contains ONLY pure functions.
//
// Dual export, identical to utils.js:
//   - Node (tests / main process): `module.exports = { ... }`
//   - Browser (renderer process):  `window.RendererShared = { ... }`
//
// IMPORTANT: every function here mirrors the EXACT behavior already present in
// the renderers — they adopt these as drop-in replacements, no new behavior is
// invented.
//
// NOTE: a status→color helper was prototyped here too, but the color-band logic
// (percent- vs status-based thresholds) diverged enough between renderers that
// unifying it would change behavior; it was dropped to avoid a dead export.
// The window drag DID turn out to be unifiable — for the widget and the clock,
// whose blocks were verbatim clones differing in one line — and lives in
// window-geometry.js. The display keeps its own: no preventDefault, a fullscreen
// heuristic, no geometry. "Diverges enough" is a claim that has to be re-measured,
// not inherited.

// ---------------------------------------------------------------------------
// breakdown(totalAbsSeconds) → { hours, minutes, seconds, hasHours }
// ---------------------------------------------------------------------------
/**
 * Decomposes a duration (in seconds) into hours/minutes/seconds using the SAME
 * integer math as every renderer:
 *   hours   = floor(abs / 3600)
 *   minutes = floor((abs % 3600) / 60)
 *   seconds = abs % 60
 *
 * The value is treated as an ABSOLUTE magnitude — the sign (overrun / negative)
 * is the caller's concern, exactly like `const absSecs = Math.abs(secs)` in the
 * renderers. Passing a negative number yields the same breakdown as its
 * absolute value.
 *
 * `hasHours` reflects the digital/analog "show hours" rule, which is purely
 * time-based: hours are shown when `hours > 0` (i.e. the duration is >= 3600s).
 * NOTE: the FLIP style additionally shows hours when the timer's PRESET total
 * is >= 3600 (`hours > 0 || totalSeconds >= 3600`). That extra condition
 * depends on renderer state (`totalSeconds`) that is NOT derivable from the
 * seconds alone, so the renderer must OR it in itself — see flipCells().
 *
 * Non-finite input (NaN / Infinity) is defensively coerced to 0.
 *
 * @param {number} totalAbsSeconds - duration in seconds (sign ignored)
 * @returns {{hours:number, minutes:number, seconds:number, hasHours:boolean}}
 */
function breakdown(totalAbsSeconds) {
    let abs = Math.abs(Math.floor(Number(totalAbsSeconds)));
    if (!Number.isFinite(abs)) { abs = 0; }

    const hours = Math.floor(abs / 3600);
    const minutes = Math.floor((abs % 3600) / 60);
    const seconds = abs % 60;

    return { hours, minutes, seconds, hasHours: hours > 0 };
}

// ---------------------------------------------------------------------------
// flipCells(absSeconds[, presetTotalSeconds]) → individual digit characters
// ---------------------------------------------------------------------------
/**
 * Splits a duration into the individual digit characters used by the split-flap
 * (flip) style, mirroring the renderers exactly:
 *   hr1 = floor(hours / 10) % 10   hr2 = hours % 10
 *   m1  = floor(mins / 10) % 10    m2  = mins % 10
 *   s1  = floor(secs / 10)         s2  = secs % 10
 * All values are returned as single-character strings (e.g. '0'..'9').
 *
 * The flip style's "show hours" rule is `hours > 0 || totalSeconds >= 3600`
 * (see electron-widget.html / display-script.js). Because `totalSeconds` is the
 * timer's preset and cannot be derived from the elapsed seconds, the renderer
 * passes it as the optional second argument. When omitted, `hasHours` falls
 * back to the time-only rule (`hours > 0`), matching breakdown().
 *
 * Non-finite input is defensively coerced to 0.
 *
 * @param {number} absSeconds - duration in seconds (sign ignored)
 * @param {number} [presetTotalSeconds] - timer preset; if >= 3600 forces hours
 * @returns {{h1:string,h2:string,m1:string,m2:string,s1:string,s2:string,hasHours:boolean}}
 */
function flipCells(absSeconds, presetTotalSeconds) {
    const { hours, minutes, seconds } = breakdown(absSeconds);

    let preset = Number(presetTotalSeconds);
    if (!Number.isFinite(preset)) { preset = 0; }

    const hasHours = hours > 0 || preset >= 3600;

    return {
        h1: String(Math.floor(hours / 10) % 10),
        h2: String(hours % 10),
        m1: String(Math.floor(minutes / 10) % 10),
        m2: String(minutes % 10),
        s1: String(Math.floor(seconds / 10)),
        s2: String(seconds % 10),
        hasHours
    };
}

// ---------------------------------------------------------------------------
// clampScale(value, min, max) → numeric clamp
// ---------------------------------------------------------------------------
/**
 * Clamps a numeric scale value into [min, max], matching the renderers'
 *   Math.max(MIN, Math.min(MAX, value))
 * used by every Ctrl/Shift+wheel scaling handler.
 *
 * Per-renderer bounds (the renderer supplies them; this fn just clamps):
 *   - Widget Ctrl+wheel:  30..600
 *   - Clock  Ctrl+wheel:  30..600
 *   - Display timer:      30..300
 *   - Display blocks:     50..600
 *
 * Defensive: a NaN `value` returns `min` (the safe lower bound); ±Infinity is
 * left to clamp naturally to the corresponding bound, exactly as the renderers'
 * `Math.max/Math.min` would. If `min > max` the bounds are swapped so the
 * result is always within the intended range.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampScale(value, min, max) {
    let lo = Number(min);
    let hi = Number(max);
    if (Number.isNaN(lo)) { lo = -Infinity; }
    if (Number.isNaN(hi)) { hi = Infinity; }
    if (lo > hi) { const t = lo; lo = hi; hi = t; }

    const v = Number(value);
    // Only NaN is unrecoverable through Math.max/min — guard it to the lower
    // bound. ±Infinity clamps naturally below.
    if (Number.isNaN(v)) { return lo; }

    return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// timerLifecycleStatus(state) → 'paused' | 'overtime' | 'finished' | 'running' | 'idle'
// ---------------------------------------------------------------------------
/**
 * Решает, в каком состоянии ЖИЗНЕННОГО ЦИКЛА находится таймер, чтобы окно могло
 * подписать статус-плашку. Три окна (панель управления, виджет, полноэкранный
 * режим) раньше содержали три копии этого условия, и копии разошлись:
 *
 *   - виджет красил «Перерасход» классом `running`, то есть ЗЕЛЁНЫМ, при красных цифрах;
 *   - полноэкранный режим проверял `finished` ПЕРВЫМ, а панель и виджет — перерасход,
 *     из-за чего одно состояние подписывалось в разных окнах по-разному;
 *   - ветка `isPaused` во всех трёх была недостижима при remainingSeconds <= 0,
 *     поэтому пауза в перерасходе показывалась как «Завершено» / «Время вышло!».
 *
 * Порядок приоритетов здесь единственный на всё приложение:
 *
 *   1. paused   — пауза важнее всего: если пользователь остановил таймер, это пауза,
 *                 даже в перерасходе (сам перерасход уже виден по красным цифрам);
 *   2. overtime — ушли ниже нуля;
 *   3. finished — досчитали до нуля (или флаг залатчен движком);
 *   4. running  — идёт отсчёт;
 *   5. idle     — всё остальное.
 *
 * Возвращается только КЛЮЧ. Подписи и CSS-классы остаются за каждым окном:
 * тексты у них разные («Завершён» / «Завершено» / «Время вышло!»), и сводить их
 * к одному — уже продуктовое решение, а не починка рассинхрона.
 *
 * @param {{remainingSeconds:number, totalSeconds:number, isRunning:boolean,
 *          isPaused:boolean, finished:boolean}} state
 * @returns {'paused'|'overtime'|'finished'|'running'|'idle'}
 */
function timerLifecycleStatus(state) {
    const raw = Math.floor(Number((state && state.remainingSeconds) || 0));
    const secs = Number.isFinite(raw) ? raw : 0;
    const totalRaw = Number((state && state.totalSeconds) || 0);
    const total = Number.isFinite(totalRaw) ? totalRaw : 0;
    const isRunning = !!(state && state.isRunning);
    const isPaused = !!(state && state.isPaused);
    const finished = !!(state && state.finished);

    if (isPaused) { return 'paused'; }
    if (secs < 0) { return 'overtime'; }
    if (finished || (secs <= 0 && total > 0 && !isRunning)) { return 'finished'; }
    if (isRunning) { return 'running'; }
    return 'idle';
}

// ---------------------------------------------------------------------------
// timerColorBand(remainingSeconds, totalSeconds[, thresholds]) → цветовая полоса
// ---------------------------------------------------------------------------
/**
 * Решает, каким ЦВЕТОМ показывать время: 'overtime' | 'danger' | 'warning' | 'normal'.
 *
 * Это НЕ то же самое, что timerLifecycleStatus(): та отвечает на вопрос «что с
 * таймером» (для подписи статуса), а эта — «насколько всё срочно» (для окраски
 * цифр, стрелок и кольца прогресса).
 *
 * Раньше эта лесенка была скопирована девять раз по трём окнам, и копии
 * содержали два дефекта:
 *
 *   1. Условие danger было записано как `percentLeft <= 10 && percentLeft > 0`.
 *      Ровно на 00:00 процент равен нулю, `> 0` не проходит, и значение
 *      проваливалось в `<= 25` → время на нуле показывалось ЖЁЛТЫМ (warning),
 *      хотя это самая срочная точка отсчёта. При этом utils.getTimerStatus()
 *      всегда считал ноль за 'danger' — то есть общая утилита и рендереры
 *      противоречили друг другу.
 *   2. Пороги в CONFIG (DANGER_PERCENTAGE / WARNING_PERCENTAGE) читала только
 *      панель управления, остальные окна держали 10 и 25 захардкоженными.
 *      Правка конфига разъехала бы окна между собой.
 *
 * Пороги берутся из аргумента, иначе из window.CONFIG, иначе 10 / 25.
 *
 * @param {number} remainingSeconds
 * @param {number} totalSeconds
 * @param {{danger?:number, warning?:number}} [thresholds]
 * @returns {'overtime'|'danger'|'warning'|'normal'}
 */
function timerColorBand(remainingSeconds, totalSeconds, thresholds) {
    const rawSecs = Number(remainingSeconds);
    const secs = Number.isFinite(rawSecs) ? rawSecs : 0;
    if (secs < 0) { return 'overtime'; }

    const rawTotal = Number(totalSeconds);
    const total = Number.isFinite(rawTotal) ? rawTotal : 0;
    if (total <= 0) { return 'normal'; }

    const cfg = (typeof window !== 'undefined' && window.CONFIG) ? window.CONFIG : null;
    const t = thresholds || {};
    const dangerPct = Number.isFinite(Number(t.danger))
        ? Number(t.danger)
        : (cfg && Number.isFinite(Number(cfg.DANGER_PERCENTAGE)) ? Number(cfg.DANGER_PERCENTAGE) : 10);
    const warningPct = Number.isFinite(Number(t.warning))
        ? Number(t.warning)
        : (cfg && Number.isFinite(Number(cfg.WARNING_PERCENTAGE)) ? Number(cfg.WARNING_PERCENTAGE) : 25);

    const percentLeft = (secs / total) * 100;
    // Ноль ВХОДИТ в danger — это конец отсчёта, а не «предупреждение».
    if (percentLeft <= dangerPct) { return 'danger'; }
    if (percentLeft <= warningPct) { return 'warning'; }
    return 'normal';
}

// ---------------------------------------------------------------------------
// pickOwnSetting(settings, ownKey, sharedKey) → значение или undefined
// ---------------------------------------------------------------------------
/**
 * Выбирает значение настройки, у которой ДВА имени: собственное (принадлежит
 * конкретному окну) и общее (осталось от версий, где окно было одно).
 *
 * Зачем это отдельная функция, а не `a || b` на месте вызова: общее имя в этом
 * проекте ДВУСМЫСЛЕННО. В `displayExtSettings` поле `timerStyle` — стиль
 * ВИДЖЕТА (settings-schema.js пишет его туда через `alsoWrite`, чтобы откат на
 * предыдущую версию приложения не потерял настройку), а в IPC-пакете
 * `display-settings-update` под тем же именем панель шлёт стиль ДИСПЛЕЯ. Оба
 * набора приходят в одну и ту же функцию окна, поэтому окно обязано спрашивать
 * СВОЁ имя первым, а общее держать запасным.
 *
 * Сравнение именно с undefined: `0` и пустая строка — это присланные значения,
 * а не молчание, и проваливаться в запасное имя они не должны.
 *
 * @param {unknown} settings
 * @param {string} ownKey — имя, принадлежащее этому окну
 * @param {string} sharedKey — общее имя прежних версий
 * @returns {unknown|undefined}
 */
function pickOwnSetting(settings, ownKey, sharedKey) {
    if (!settings || typeof settings !== 'object') { return undefined; }
    return settings[ownKey] !== undefined ? settings[ownKey] : settings[sharedKey];
}

/**
 * Час и минута, когда таймер дойдёт до нуля: «закончится в 14:50».
 *
 * Считается ОТ переданного момента, а не от new Date() внутри, — иначе
 * функцию нельзя проверить, а её единственная интересная точка это переход
 * через полночь.
 *
 * Отрицательный остаток — это перерасход: время окончания уже в прошлом, и
 * подпись над ним меняется на «должно было закончиться в». Арифметика та же,
 * поэтому знак здесь не особый случай.
 *
 * @param {number} remainingSeconds остаток, может быть отрицательным
 * @param {Date}   now              момент отсчёта
 * @returns {string|null} 'ЧЧ:ММ' либо null, если аргументы бессмысленны
 */
function endsAt(remainingSeconds, now) {
    if (!Number.isFinite(remainingSeconds)) { return null; }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) { return null; }

    const end = new Date(now.getTime() + Math.round(remainingSeconds) * 1000);
    if (Number.isNaN(end.getTime())) { return null; }

    const hh = String(end.getHours()).padStart(2, '0');
    const mm = String(end.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Exports — dual pattern identical to utils.js
// ---------------------------------------------------------------------------
const RendererShared = {
    breakdown,
    flipCells,
    clampScale,
    timerLifecycleStatus,
    timerColorBand,
    pickOwnSetting,
    endsAt
};

// Node.js (tests / main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RendererShared;
}

// Browser (renderer process)
if (typeof window !== 'undefined') {
    window.RendererShared = RendererShared;
}
