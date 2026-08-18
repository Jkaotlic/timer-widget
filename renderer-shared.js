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
// fitBlockScale({width, height, centerX, centerY, free, requested}) → проценты
// ---------------------------------------------------------------------------
/**
 * Потолок масштаба блока, растущего `transform: scale` вокруг своего центра.
 *
 * Зачем. Трансформация НЕ участвует в раскладке: соседи о новом размере не
 * знают и с места не двигаются. Поэтому увеличенный блок сначала наезжает на
 * них, а потом уходит за край окна — замер на дисплее 3440×1320: при 150 %
 * круг перекрывал подпись «Осталось» на 148px и плашку статуса на 22px, при
 * 300 % выходил за окно на 429px сверху и снизу. Раскладку это не чинит (у
 * подписи сверху и плашки снизу своих запасов нет), поэтому ограничивается
 * масштаб — и ограничивается по САМОЙ ТЕСНОЙ стороне: наезжает ведь она.
 *
 * Блок растёт от ЦЕНТРА, поэтому по каждой стороне помещается вдвое больше,
 * чем расстояние от центра до границы: половина блока приходится на эту
 * сторону.
 *
 * Уменьшение не ограничивается никогда: оно ни на что не наезжает.
 *
 * Мусор на входе возвращает ЗАПРОШЕННОЕ значение, а не 0: замер мог не
 * состояться (окно ещё не разложено), и схлопнуть таймер в точку — худший из
 * возможных ответов.
 *
 * @param {{width: number, height: number, centerX: number, centerY: number,
 *          free: {left: number, right: number, top: number, bottom: number},
 *          requested: number}} p
 * @returns {number} проценты
 */
function fitBlockScale(p) {
    const opts = p || {};
    const requested = Number(opts.requested);
    if (!Number.isFinite(requested)) { return 100; }
    if (requested <= 100) { return requested; }

    const width = Number(opts.width);
    const height = Number(opts.height);
    const free = opts.free;
    if (!(width > 0) || !(height > 0) || !free) { return requested; }

    const sides = [
        (Number(opts.centerX) - Number(free.left)) / (width / 2),
        (Number(free.right) - Number(opts.centerX)) / (width / 2),
        (Number(opts.centerY) - Number(free.top)) / (height / 2),
        (Number(free.bottom) - Number(opts.centerY)) / (height / 2)
    ];
    if (!sides.every(Number.isFinite)) { return requested; }

    const ceiling = Math.min(...sides) * 100;
    if (!Number.isFinite(ceiling)) { return requested; }
    // Ниже 100 % потолок не опускаем: место под НЕувеличенный блок отводит
    // раскладка, и спорить с ней здесь не о чем.
    return Math.max(100, Math.min(requested, Math.floor(ceiling)));
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


/**
 * Относительная яркость цвета по WCAG. Принимает #rgb и #rrggbb.
 * @param {string} color
 * @returns {number|null} 0..1, либо null если цвет не разобран
 */
function relativeLuminance(color) {
    if (typeof color !== 'string') { return null; }
    let hex = color.trim().replace(/^#/, '');
    if (hex.length === 3) { hex = hex.split('').map((c) => c + c).join(''); }
    if (!/^[0-9a-f]{6}$/i.test(hex)) { return null; }

    const channel = (v) => {
        const c = parseInt(v, 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const r = channel(hex.slice(0, 2));
    const g = channel(hex.slice(2, 4));
    const b = channel(hex.slice(4, 6));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Страж яркости дисплея: светлый под ним фон или тёмный.
 *
 * Дисплей следует теме, но фон под цифрами задаёт ПОЛЬЗОВАТЕЛЬ — заливкой,
 * градиентом или картинкой. Решать цвет текста по теме означало бы вернуть
 * задокументированный провал: тёмная заливка при светлой теме даёт чёрные
 * цифры на чёрном, и на проекторе время не видно вообще.
 *
 * Поэтому решает не тема, а ЯРКОСТЬ фактического фона. Тема лишь выбирает
 * фон по умолчанию, когда пользователь своего не задал.
 *
 * Порог 0.179 — точка, где белый и чёрный текст дают равный контраст по WCAG.
 *
 * Картинка не разбирается принципиально: у фотографии нет одной яркости, и
 * гадать по ней хуже, чем держать заведомо читаемый светлый текст с затемняющим
 * оверлеем — так это и работало до редизайна.
 *
 * @param {{mode?: string, solid?: string, grad1?: string, grad2?: string, theme?: string}} bg
 * @returns {'light'|'dark'} какой ФОН получился, а не какой текст нужен
 */
function backgroundTone(bg) {
    const LIGHT_THRESHOLD = 0.179;
    const settings = bg || {};
    const mode = settings.mode;

    if (mode === 'local') { return 'dark'; }

    let lum = null;
    if (mode === 'solid') {
        lum = relativeLuminance(settings.solid);
    } else if (mode === 'gradient') {
        const a = relativeLuminance(settings.grad1);
        const b = relativeLuminance(settings.grad2);
        const stops = [a, b].filter((v) => v !== null);
        lum = stops.length ? stops.reduce((x, y) => x + y, 0) / stops.length : null;
    }

    // Своего фона нет — его выбирает тема. Светлая даёт белый холст.
    if (lum === null) { return settings.theme === 'light' ? 'light' : 'dark'; }
    return lum > LIGHT_THRESHOLD ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// surfaceTone({ color, alpha, theme }) → 'light' | 'dark'
// ---------------------------------------------------------------------------
/**
 * Тот же страж, что backgroundTone, но для окна, у которого ФОНА НЕТ ВОВСЕ.
 *
 * Виджет и часы лежат поверх чужого рабочего стола. Единственное, что там
 * красится, — подложка стиля: пара «цвет + прозрачность» из панели. Значит и
 * вход другой, а развилка та же — решает ЯРКОСТЬ того, что реально под
 * цифрами, а тема выбирает фон по умолчанию.
 *
 * Прозрачность здесь не украшение, а условие применимости замера: сквозь
 * подложку с alpha 0.2 видно обои пользователя, и «померить подложку» означало
 * бы измерить не тот слой. У фотографии обоев одной яркости нет — гадать по
 * ней хуже, чем вернуться к теме, ровно как backgroundTone поступает с
 * картинкой на фоне дисплея. Порог 0.5: при нём подложка и стол вносят
 * поровну, выше — подложка перевешивает.
 *
 * @param {{color?: string, alpha?: number, theme?: string}} surface
 * @returns {'light'|'dark'} какой ФОН получился под цифрами
 */
function surfaceTone(surface) {
    const s = surface || {};
    const byTheme = s.theme === 'light' ? 'light' : 'dark';

    const alpha = surfaceAlpha(s.alpha);
    if (alpha !== null && alpha < 0.5) { return byTheme; }

    const lum = relativeLuminance(typeof s.color === 'string' ? s.color : null);
    if (lum === null) { return byTheme; }
    return lum > 0.179 ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// surfacePaint({ color, alpha }) → строка для CSS или null
// ---------------------------------------------------------------------------
/**
 * Цвет ПОДЛОЖКИ виджета и часов. Пара «цвет + прозрачность» одна на окно и
 * красит подложку того стиля, который сейчас на экране: у круга и «Цифр» своей
 * подложки нет вовсе, у LED, флипа и аналога она своя и непрозрачная.
 *
 * Возвращается строка, которую окно кладёт в переменную `--surface-paint` на
 * documentElement, а КАЖДАЯ подложка в CSS записана как
 * `var(--surface-paint, <своё прежнее значение>)`. Отсюда два следствия:
 *
 *   - `null` означает «удали переменную», а не «покрась прозрачным»: владельцем
 *     значения по умолчанию остаётся CSS, и вернуть подложку стиля можно только
 *     удалением. Красить прозрачным — не то же самое: у флипа под подложкой
 *     лежит ещё и разделительная линия, у LED — блик ::before;
 *   - прозрачность 0 — законное значение и единственный способ добиться полной
 *     прозрачности у стилей, чья подложка описана в CSS непрозрачной.
 *
 * Цвет проверяется СТРОГОЙ шестнадцатеричной записью, а не общим isSafeColor:
 * значение уходит в CSS-объявление, и единственный источник этого значения —
 * пипетка панели, которая всегда отдаёт `#rrggbb`. Всё остальное — либо мусор
 * из чужого профиля, либо попытка дописать объявление.
 *
 * @param {{color?: string, alpha?: number}} surface
 * @returns {string|null}
 */
function surfacePaint(surface) {
    const s = surface || {};
    const color = typeof s.color === 'string' ? s.color.trim().toLowerCase() : '';
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(color)) { return null; }

    const alpha = surfaceAlpha(s.alpha);
    // Один знак после запятой: 1/3 иначе уехала бы в CSS хвостом double.
    const percent = Math.round((alpha === null ? 1 : alpha) * 1000) / 10;

    return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

// ---------------------------------------------------------------------------
// surfaceSolid(surface) → '#rrggbb' или null
// ---------------------------------------------------------------------------
/**
 * Тот же выбранный цвет, но БЕЗ прозрачности — для стилей, которым прозрачная
 * подложка запрещена.
 *
 * Такой стиль ровно один: перекидыш. Его карточка — это ПЛАСТИНА, поверх
 * которой ходят створки, и створки берут её фон себе (см. цепочку `inherit` в
 * flip-card.css). Стоит подложке стать полупрозрачной, и сквозь падающую
 * створку видно и цифру под ней, и рабочий стол — стиль читается как поломка.
 * Решение пользователя 14.08.2026: у флипа прозрачности фона нет вовсе.
 *
 * Отдельная переменная, а не «убрать альфу из --surface-paint» в CSS: из
 * готового `color-mix` прозрачность обратно не вынимается. Проверка цвета — та
 * же строгая шестнадцатеричная, по той же причине, что в surfacePaint.
 *
 * @param {{color?: string}} surface
 * @returns {string|null}
 */
function surfaceSolid(surface) {
    const s = surface || {};
    const color = typeof s.color === 'string' ? s.color.trim().toLowerCase() : '';
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(color) ? color : null;
}

// ---------------------------------------------------------------------------
// surfaceAlpha(value) → 0…1 или null
// ---------------------------------------------------------------------------
/**
 * Прозрачность подложки как ОТДЕЛЬНОЕ значение — она работает и без выбранного
 * цвета. Окно кладёт её в `--surface-alpha`, а подложка каждого стиля вплетает
 * переменную в СВОЮ альфу (`rgba(…, calc(0.85 * var(--surface-alpha, 1)))` или
 * `color-mix` для токена). Поэтому ползунок гасит и родную подложку стиля, а не
 * только заливку, выбранную пользователем.
 *
 * `null` означает «не задана» и снимает переменную: множитель по умолчанию
 * живёт в CSS. Отличать это от нуля обязательно — `Number(null) === 0`, и без
 * явной проверки ненастроенный фон читался бы как погашенный.
 *
 * @param {number|string|null|undefined} value
 * @returns {number|null}
 */
function surfaceAlpha(value) {
    if (value === null || value === undefined || value === '') { return null; }
    const alpha = Number(value);
    if (!Number.isFinite(alpha)) { return null; }
    return Math.min(1, Math.max(0, alpha));
}

// ---------------------------------------------------------------------------
// migrateTimerStyle(style) → актуальное имя стиля
// ---------------------------------------------------------------------------
/**
 * Стиль LED (`digital`) слит с «Цифрами» (`digits`) 13.08.2026.
 *
 * Оба показывали одно и то же — время крупными цифрами; отличались рамкой,
 * которую теперь даёт настраиваемый фон, и выбором шрифта, который у «Цифр»
 * был всегда. Держать два стиля ради одной рамки значило держать вдвое больше
 * разметки, CSS и веток в трёх окнах.
 *
 * Функция нужна ПОТОМУ, что имя стиля лежит в профиле пользователя: в
 * `displayExtSettings`, в настройках часов и в снимке последнего стиля, который
 * главный процесс досылает окнам. Без перевода такой профиль открылся бы окном
 * без единого активного стиля — то есть пустым.
 *
 * Неизвестное значение возвращается КАК ЕСТЬ: подстановка 'circle' прятала бы
 * чужую ошибку и меняла поведение окна на непонятном входе.
 *
 * @param {string} style
 * @returns {string}
 */
function migrateTimerStyle(style) {
    return style === 'digital' ? 'digits' : style;
}

// ---------------------------------------------------------------------------
// secondsUntilClock(nowSeconds, 'HH:MM') → секунды до этого времени сегодня
// ---------------------------------------------------------------------------
/**
 * Сколько осталось до времени окончания мероприятия — для блока «До
 * завершения» на дисплее.
 *
 * Величина НЕ связана с таймером доклада: тот отсчитывает заданную
 * длительность, а эта — расстояние от системных часов до момента «Конец».
 * На кадре у пользователя обе величины стоят рядом и расходятся между собой,
 * поэтому считать одну из другой нельзя.
 *
 * Уже прошедшее время даёт НОЛЬ, а не перенос на следующие сутки: в 15:01
 * после мероприятия, кончившегося в 15:00, «до завершения 23:59:00» — не
 * ответ. Плата за это — мероприятие через полночь, у которого блок замрёт на
 * нуле; для докладов и совещаний это редкий случай, а неверная подпись в
 * обычном — ежедневный.
 *
 * @param {number} nowSeconds — секунды с начала суток
 * @param {string} clock — 'HH:MM'
 * @returns {number} секунды, не меньше нуля
 */
function secondsUntilClock(nowSeconds, clock) {
    const now = Number(nowSeconds);
    if (!Number.isFinite(now)) { return 0; }
    if (typeof clock !== 'string') { return 0; }

    const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
    if (!match) { return 0; }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) { return 0; }

    const target = hours * 3600 + minutes * 60;
    return Math.max(0, target - now);
}

// ---------------------------------------------------------------------------
// migrateDisplayBlocks(settings) → настройки с личными тумблерами блоков
// ---------------------------------------------------------------------------
/**
 * Общий тумблер блоков дисплея (`showTimeBlocks`) заменён личным у каждого
 * блока (17.08.2026).
 *
 * Почему заменён: с личными тумблерами общий даёт ДВА уровня состояния, где
 * выключенный верхний делает вид, что нижние не работают. Ровно это уже было
 * внутри самих блоков — «Текущее время» имело свою галочку, но гасилось общим
 * тумблером, и её выключение при выключенных блоках ничего не меняло.
 *
 * Почему нужна функция: значения лежат в профиле пользователя
 * (`displayExtSettings`). Без перевода профиль, где блоки были ВКЛЮЧЕНЫ,
 * открылся бы пустым дисплеем: новых ключей в нём нет, а их умолчание —
 * «выключено».
 *
 * Уже переведённый профиль не трогается: новый ключ, если он есть, главнее
 * старого. Иначе выключенный уже в новой версии блок возвращался бы к жизни при
 * каждом чтении, пока в профиле лежит старый `showTimeBlocks: true`.
 *
 * @param {object} settings
 * @returns {object} копия с проставленными новыми ключами
 */
function migrateDisplayBlocks(settings) {
    const out = Object.assign({}, settings || {});
    if (out.showTimeBlocks === undefined) { return out; }

    const blocksOn = out.showTimeBlocks === true;
    // `showCurrentTime` — единственный ключ, чьё ИМЯ перевод пережило, а смысл
    // сменило: был вторым уровнем поверх общего тумблера, стал личным тумблером
    // блока. Поэтому он пересчитывается произведением, а не берётся как есть.
    out.showCurrentTime = blocksOn && out.showCurrentTime !== false;
    // У этих двух в старом профиле своего ключа не было вовсе. Если он есть —
    // его записала новая версия, и она главнее старого общего тумблера.
    if (out.showEventTime === undefined) { out.showEventTime = blocksOn; }
    if (out.showEndTime === undefined) { out.showEndTime = blocksOn; }
    return out;
}

// ---------------------------------------------------------------------------
// Exports — dual pattern identical to utils.js
// ---------------------------------------------------------------------------
const RendererShared = {
    breakdown,
    flipCells,
    clampScale,
    fitBlockScale,
    secondsUntilClock,
    migrateDisplayBlocks,
    timerLifecycleStatus,
    timerColorBand,
    pickOwnSetting,
    endsAt,
    relativeLuminance,
    backgroundTone,
    surfaceTone,
    surfacePaint,
    surfaceSolid,
    surfaceAlpha,
    migrateTimerStyle
};

// Node.js (tests / main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RendererShared;
}

// Browser (renderer process)
if (typeof window !== 'undefined') {
    window.RendererShared = RendererShared;
}
