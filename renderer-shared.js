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
// NOTE: a generic drag helper and a status→color helper were prototyped here
// too, but each renderer's drag (preventDefault / window-blur differences) and
// color-band logic (percent- vs status-based thresholds) diverge enough that
// unifying them would change behavior, so they stayed per-renderer and were
// dropped from this module to avoid dead exports.

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
// Exports — dual pattern identical to utils.js
// ---------------------------------------------------------------------------
const RendererShared = {
    breakdown,
    flipCells,
    clampScale
};

// Node.js (tests / main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RendererShared;
}

// Browser (renderer process)
if (typeof window !== 'undefined') {
    window.RendererShared = RendererShared;
}
