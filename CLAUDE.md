# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm start              # Run app (Electron)
npm run dev            # Run with DevTools auto-open (--dev flag)
npm test               # Run tests (Node.js built-in test runner)
npm run lint           # ESLint
npm run ci             # lint + test
npm run build          # Build for current platform (electron-builder)
npm run build:mac      # Build macOS (DMG + ZIP)
npm run build:win      # Build Windows (NSIS + Portable)
```

Tests use `node --test` (no framework). Test files live in `tests/`. Run a single test with `node --test tests/time-utils.test.js`.

## Architecture

Multi-window Electron desktop timer app. Vanilla JavaScript — no UI frameworks, no bundler.

### Process Model

**Main process** (`electron-main.js`) is the single source of truth for timer state. It manages 4 renderer windows and synchronizes them via IPC:

1. **Control Window** (`electron-control.html`) — main management panel, ~2700 lines (was 7300). Settings tabs (Виджет, Часы, Полноэкранный, Звуки) live in a slide-out drawer, not in the panel body. Default 400px wide (`CONFIG.CONTROL_WINDOW_WIDTH`), min 380; the drawer adds ~336px. Window auto-resizes per active tab via `autoResizeWindow()`. What remains inline is the `TimerController` class (window/timer/settings wiring, tightly bound to DOM ids) plus bootstrap — everything self-contained has been extracted, see **Control panel modules** below.
2. **Widget Window** (`electron-widget.html`) — transparent, frameless, always-on-top mini-timer. 4 styles: circle, digital, flip, analog. Glassmorphism design.
3. **Display Window** (`display.html` + `display-script.js`) — fullscreen timer for presentations. 4 styles: circle, digital, flip, analog. Has a `DisplayTimer` class.
4. **Clock Widget** (`electron-clock-widget.html`) — independent clock widget. 4 styles: circle, digital, flip, analog. Glassmorphism design.

### IPC Communication

- `preload.js` exposes `window.electronAPI` with a channel whitelist (`ALLOWED_CHANNELS`). Context isolation and sandbox are enabled on all windows.
- `ipc-compat.js` provides backward compatibility mapping old `ipcRenderer` calls to the new `electronAPI`.
- Control window sends commands (`timer-command`, `widget-colors-update`, `display-settings-update`); main process broadcasts state (`timer-state`) to all windows every second.
- Per-window color channels: `widget-colors-update`, `clock-colors-update`, `display-colors-update` — each window gets only its own colors (no global broadcast).
- Timer state uses a monotonic `updateCounter` (not timestamps) for reliable sync.

### Control panel modules

`electron-control.html` used to be a 7300-line god-file (CSS + markup + all logic in one inline script). It was the project's main source of duplicated-logic bugs — you cannot see a duplicate in a file that size. It is now split:

| File | Owns |
|------|------|
| `control.css` | All panel styles (3388 lines, moved out of inline `<style>`). Must load AFTER `design-tokens.css`/`components.css` — it overrides them, the cascade order is load-bearing |
| `sound-bank.js` | 29 built-in sounds synthesised with oscillators. No DOM, no storage |
| `custom-sounds.js` | User-uploaded sounds: file validation, list, playback, deletion. **Prototype mixin** |
| `local-background.js` | Fullscreen background image: upload, MIME + magic-byte validation, preview, fit/overlay. **Prototype mixin** |
| `color-picker.js` | HSV picker (`ColorPicker`) + `addPickerToggle()` |
| `ui-feedback.js` | `Toast` and `LoadingIndicator` |
| `modal-manager.js` | `openModal`/`closeModal` with focus trap and focus return |
| `shortcuts-help.js` | The F1 shortcuts overlay |
| `scale-input.js` | Click-to-edit / double-click-to-reset on scale percentages |

Rules when working here:

- **No bundler.** Every file is a classic `<script>`, so cross-module references go through `window.X` (`window.ColorUtils`, `window.Toast`, `window.SoundBank`). A bare name resolves only by accident via the global scope and breaks lint.
- **Two of them are prototype mixins** (`Object.assign(TimerController.prototype, window.XMixin)`), not free functions. Their methods call each other and the controller's `this.beep()` / `this.pushDisplaySettings()`, and DOM handlers close over `this` — the mixin preserves `this` semantics exactly, which made the move verbatim and behaviour-preserving. If the `Object.assign` line is lost, nothing fails at load; it fails at the first click.
- **Every new module must go into `package.json` `build.files`** or it silently vanishes from the packaged app (that is exactly how `design-tokens.css` was lost in 2.3.2). `tests/packaging.test.js` and `tests/control-decomposition.test.js` both guard this.
- **When you touch a self-contained block still living inline, move it out** instead of editing it in place.

### Shared Modules

- `constants.js` — all magic numbers, IPC channel names, storage keys, theme definitions, dimension limits
- `utils.js` — `formatTime()`, `formatTimeShort()`, `parseTime()`, `debounce()`, `getTimerStatus()`, `calculateProgress()`, `safelySendToWindow()`
- `security.js` — input validation (`isValidDataURL`, `isValidURL`, `validateImageSource`), `escapeHTML()`, `safeJSONParse()`

### Key Patterns

- Window references are global (`controlWindow`, `widgetWindow`, `displayWindow`, `clockWidgetWindow`). Always use `safelySendToWindow()` to avoid "Object has been destroyed" crashes.
- Renderer windows persist settings in `localStorage`. Storage keys are defined in `constants.js` (`STORAGE_KEYS`).
- Each HTML file is self-contained with inline `<script>` and `<style>` blocks (CSP allows `unsafe-inline`).
- JS-based window drag: Widget and clock windows use JavaScript mousedown/mousemove + IPC (`widget-move`, `clock-widget-move`) instead of `-webkit-app-region: drag`. This is because on Windows, transparent frameless windows with `drag` on parent elements intercept ALL mouse events before `no-drag` children.
- Scaling: Widget and clock use Ctrl+wheel for scaling (30-600%). Display uses Ctrl+wheel context-sensitive (hover on info-block → block scale, else → timer scale) + Shift+wheel for blocks. No visual slider — all via keyboard+mouse.

## Code Style

- 2-space indentation, single quotes, camelCase for variables/functions, UPPER_CASE for constants
- ESLint 9 with flat config (`eslint.config.js`) enforces `eqeqeq: always` and `curly: always`
- Unused variables prefixed with `_` are allowed (`argsIgnorePattern: '^_'`)

## Security

- All BrowserWindows: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- `hardenWindow()` applied to all windows: blocks `will-navigate` to non-file:// URLs, denies `window.open`
- IPC channel whitelist in `preload.js` with direction validation (send vs receive)
- All IPC resize/move/opacity handlers validate numeric inputs (bounds, NaN, Infinity)
- Image validation: size + MIME + magic bytes (WebP checks RIFF+WEBP signature)
- SVG excluded from data URL whitelist (XSS vector)
- Audio upload rejects empty `file.type`
- CSS injection prevented: color values validated with regex, URLs validated with `URL()` constructor
- Timer state: `presetSeconds` tracks original preset for correct reset after on-the-fly adjustments

## IPC Channels Reference

Channel whitelist defined in `channel-validator.js`, used by `preload.js`.

### Send (renderer → main)

| Channel | Purpose |
|---------|---------|
| `timer-command` | Start/pause/reset/set timer with payload `{ type, seconds, deltaSeconds, allowNegative, overrunLimitSeconds, overrunIntervalMinutes }` |
| `timer-control` | Keyboard shortcuts from display: `'start'` / `'pause'` / `'reset'` (plain string) |
| `widget-colors-update` | `{ timer: '#hex', progress: '#hex' }` — widget only |
| `clock-colors-update` | `{ timer: '#hex', progress: '#hex' }` — clock only |
| `display-colors-update` | `{ timer: '#hex', progress: '#hex' }` — display only |
| `widget-style-update` | `{ timerStyle, timerScale }` — widget style/scale |
| `display-settings-update` | Display style, background, clock settings |
| `get-timer-state` | Request current timer state |
| `get-displays` | Request list of available displays |
| `open-widget` / `close-widget` | Toggle widget window |
| `open-display` / `close-display` | Toggle display window |
| `open-clock-widget` / `close-clock-widget` | Toggle clock widget |
| `resize-control-window` | `{ width, height }` — validated with `Number.isFinite` + min bounds |
| `widget-resize` / `widget-scale` / `widget-move` / `widget-set-position` / `widget-set-opacity` | Widget geometry/opacity |
| `clock-widget-resize` / `clock-widget-scale` / `clock-widget-set-style` / `clock-widget-settings` | Clock widget controls |
| `clock-widget-move` | `{ deltaX, deltaY }` — move clock widget window |
| `clock-widget-set-position` | `{ x, y }` — restore saved clock position (clamped to a live display) |
| `display-move` | `{ deltaX, deltaY }` — move display window in windowed mode |
| `toggle-fullscreen` | Toggle fullscreen on the sender's window |
| `reset-and-relaunch` | Clear all storage and quit |
| `minimize-window` / `close-window` / `quit-app` | Window management |

### Receive (main → renderer)

| Channel | Payload |
|---------|---------|
| `timer-state` | Full `timerState` object (see below) — broadcast every second |
| `colors-update` | `{ timer, progress }` (legacy, unused) |
| `widget-colors-update` | `{ timer, progress }` — per-window |
| `clock-colors-update` | `{ timer, progress }` — per-window |
| `display-colors-update` | `{ timer, progress }` — per-window |
| `widget-style-update` | `{ timerStyle, timerScale }` |
| `timer-minute` | Fired when 1 minute remains |
| `timer-reached-zero` | Fired at 00:00 |
| `timer-overrun-minute` | Fired every N minutes in overrun mode |
| `display-settings-update` | Display settings object |
| `displays-list` | Array of available displays |
| `set-clock-style` / `clock-settings` | Clock widget settings |
| `display-window-state` / `widget-window-state` / `clock-window-state` | `{ isOpen }` |

## Timer State Structure

Broadcast via `timer-state` channel every second:

```js
{
    totalSeconds: 300,        // Original preset duration
    remainingSeconds: 245,    // Current remaining (negative = overrun)
    presetSeconds: 300,       // Preset for reset (survives on-the-fly adjustments)
    isRunning: true,          // Timer is actively counting
    isPaused: false,          // Timer is paused
    finished: false,          // Timer reached zero (latched until reset)
    updateCounter: 42         // Monotonic counter for reliable sync
}
```

## Testing

256 tests using Node.js built-in test runner (`node --test`). Test files in `tests/`.
Do NOT hardcode the count anywhere in code or CI — run `node --test` to get it.

Two flavours of test live here:

- **Behavioural** — pure modules (`utils`, `security`, `timer-engine`, `timer-controller`,
  `recovery`, `renderer-shared`, `renderer-storage`, `color-utils`) are imported and exercised.
- **Source-level** — logic that lives inside inline `<script>` blocks in the HTML windows
  cannot be imported, so those tests read the file and assert on its source. Keep asserting
  BOTH the presence of the correct behaviour and the absence of the old broken one, otherwise
  a regression slips back silently.

| File | Covers |
|------|--------|
| `time-utils.test.js` | `formatTime`, `formatTimeShort`, `parseTime`, `parseManualTime` |
| `security.test.js` | `isValidDataURL`, `isValidURL`, `validateImageSource`, `safeJSONParse`, `escapeHTML` |
| `security-extended.test.js` | `safeSetBackgroundImage` |
| `status-progress.test.js` | `getTimerStatus`, `calculateProgress` |
| `validation-utils.test.js` | `isValidNumber`, `clamp` |
| `debounce-send.test.js` | `debounce`, `safelySendToWindow` |
| `channel-validator.test.js` | `isValidChannel`, `ALLOWED_CHANNELS`, preload/validator sync |
| `edge-cases.test.js` | Edge cases for all utils |
| `constants.test.js` | CONFIG immutability and structure |
| `timer-engine.test.js` | `tick`/`adjust`/`reset`/`setPreset` arithmetic + boundary events |
| `timer-controller.test.js` | State machine with a fake clock (start/pause/reset/reconcile) |
| `recovery.test.js` | Crash-recovery persist/load/validate |
| `renderer-shared.test.js` | `breakdown`, `flipCells`, `clampScale` |
| `renderer-storage.test.js` | Quota-safe localStorage helpers |
| `color-utils.test.js` | HSV↔RGB↔HEX conversion |
| `display-timer.test.js` | `validateBlockPositions`, `canSafelyStore` |
| `perf.test.js` | Hot-path performance budgets |
| `packaging.test.js` | Every runtime asset is listed in `build.files` |
| `electron-main-source.test.js` | IPC payload hardening, DevTools gating, icon path |
| `visual-source.test.js` | Layout/centering invariants, release-doc freshness |
| `audit-2026-07-fixes.test.js` | Regressions from the July 2026 audit (sound, Esc, scales, geometry) |

## CI

GitHub Actions (`.github/workflows/nodejs.yml`): Node 22, ubuntu-latest — runs `npm run ci` (lint + test).
Release workflow builds on macOS (Intel + ARM) and Windows with Node 22.

## Gotchas

- **IPC whitelist is duplicated**: `preload.js` inlines the whitelist from `channel-validator.js` (sandbox blocks `require()`). Both files MUST stay in sync — the test `channel-validator.test.js` verifies this.
- **Adding new IPC channel**: Add to BOTH `send` and `receive` arrays in BOTH `preload.js` and `channel-validator.js`. Missing receive = widget silently ignores messages.
- **Per-window colors**: Never use global `colors-update` broadcast. Use `widget-colors-update`, `clock-colors-update`, `display-colors-update` to avoid color bleeding between windows.
- **`ipc-compat.js`**: All renderer HTML files use `ipcRenderer.on/send` which is shimmed to `electronAPI` via this compat layer. Don't use `electronAPI` directly in renderers.
- **Global keyboard shortcuts**: Space (start/pause), R (reset), 1-8 (presets 5-60 min), W/C/D (toggle windows) work from ALL windows (widget, clock, display, control). Guarded with `if (e.ctrlKey || e.altKey) return` to avoid conflicts with scale/drag.
- **Window state broadcast**: `broadcastWindowState()` in main process sends `*-window-state` to ALL windows (not just control). Required for W/C/D toggle shortcuts to know current state.
- **Start sound from remote windows**: Control panel detects `!wasRunning → isRunning` transition in `timer-state` handler and plays start sound. `_localStartTriggered` flag prevents double-play when start button clicked locally.
- **Monitor selection persistence**: Main process stores `lastDisplayIndex`. When `open-display` arrives without `displayIndex` (from widget/clock D key), reuses last selection instead of defaulting to auto.
- **Inline styles in HTML**: Each HTML file has ~1000+ lines of inline CSS/JS. CSP requires `unsafe-inline`. No external CSS frameworks.
- **Widget devTools**: Set to `false` in production. Change to `true` in `electron-main.js` for debugging.
- **Design previews**: Always read real HTML structure first, replicate exact layout, then apply CSS-only improvements. Never generate new layouts from scratch.
- **Sounds**: 30 built-in sounds synthesized via Web Audio API in `electron-control.html` `generateSound()`. No audio files — all oscillator-based.
- **Control panel layout**: Titlebar → Timer (52px) → Start/Pause/Reset → Presets 8×1 → Adjust +/- → Manual time input → Overtime+Windows (merged row) → Tabs always visible (Виджет, Часы, Полноэкранный, Звуки). Settings in 2-column grid.
- **syncClockStyle**: Defaults to **`false`** (`this.syncClockStyle = !!ext.syncClockStyle` in `loadSettings`) — the clock keeps its own style unless the user opts in. When true, clock style follows the widget style dropdown, and the `timerStyleEl` change handler must send both `widget-style-update` AND `clock-widget-set-style`. Changing the clock style directly from the Часы tab turns the sync back off.
- **Widget/clock geometry persistence**: size (Ctrl+wheel) and position (drag) are stored per window in `localStorage` under `widgetGeometry` / `clockGeometry` as `{ scalePct, x, y }`, restored in `restoreGeometry()` on open. The main process clamps a restored position via `positionWindowClamped()` — a saved point can reference a monitor that is no longer attached.
- **Scale pushes must be change-detected**: the control panel re-sends its FULL settings object on every unrelated change (colour, background, blocks). Renderers therefore apply `timerScale`/`timeBlocksScale` only when the value actually differs from the previous push (`_lastPushedTimerScale`), otherwise a colour tweak silently resets a scale the user set with Ctrl+wheel. The same pattern guards `timeLayoutPreset`.
- **Escape is layered**: the drawer, the modals and the global shortcut handler all listen for Esc on `document`. The global handler must bail out via `_isEscapeConsumedByOverlay()` when a nearer layer is open, or one keypress closes both the dialog and every widget window.
- **applyColors must cover all 4 styles**: In widget/clock/display, `applyColors()` must update circle (SVG gradient), digital (LED text + text-shadow), flip (digits + separators), and analog (second hand + center dot). Not just the circle style.
- **Inline colours MUST have a reset branch (CRITICAL)**: the `danger` / `warning` / `overtime` bands write **inline** `style.color` (inline always beats the CSS class), so every band ladder needs a final `else` that puts the colour back. Writing that branch as `else if (this._baseTimerColor)` is a **bug**: `_baseTimerColor` is only set once `applyColors()` runs with a valid colour, which never happens until the user picks a theme — so on a fresh profile the red simply never came off, and the timer stayed red even after a new preset was set. Reset with `this._baseTimerColor || ''` (or `_normalColor()` / `_normalGlow()` in `display-script.js`): the empty string **removes** the inline style and hands control back to CSS. The same rule covers the analog hands / clock centre, which are reset from `_baseSecondHandBg` / `_baseCenterBg` / `_baseAnalogDigitalColor` — those are saved on every `applyColors()` call, including during overtime, precisely so there is something to restore to.
- **Centre the whole inscription, not the digits** (minus sign): you cannot have both. The inscription is `[minus][digits]`; centring the digits necessarily puts the inscription off-centre by half the sign, and vice versa. Measured both ways — with the sign at `width: 0` the digits sat at dx 0 but the inscription drifted 16–26px left (45px on the fullscreen display) and the minus read as detached. The sign therefore participates in layout normally (`display: inline-block`, `margin-right: 0.2em` when present) and the inscription centres. The digits do shift when the sign appears, and that is fine: the eye sees a centred block both before and after zero, and the appearance of the minus masks the shift.
- **The clock's superscript seconds are the opposite case**: they are secondary, so they must NOT take layout width (`width: 0; overflow: visible`, offset via `transform`). Otherwise the whole block centres and the primary `HH:MM` sits 9.5px left of the ring centre — and toggling seconds in settings visibly jumps the time.
- Both rules were settled by measuring in `e2e` (digit centre, inscription centre, gap in `em`), never by eye — eyeballing produced two wrong iterations in a row.
- **Flip animation is shared** (`flip-card.js`): it once existed only on the display while the widget and clock swapped digits instantly. It fires ONLY when the digit actually changed — driving every card each tick turns the effect into flicker. The class is removed on a timer rather than on `animationend`, because switching styles mid-animation means the event never arrives and the card would keep the class forever. `FLIP_DURATION_MS` must match the CSS animation duration in all three windows; a test asserts it.
- **Colour bands live in ONE place too**: `RendererShared.timerColorBand(remaining, total)` returns `overtime | danger | warning | normal`. Zero is INSIDE the danger band — the old `percentLeft <= 10 && percentLeft > 0` guard pushed exactly 00:00 into the yellow warning band while the status chip next to it went red. Thresholds come from `CONFIG.DANGER_PERCENTAGE` / `WARNING_PERCENTAGE`; they used to be hardcoded as 10/25 in nine places and only the control panel read the config.
- **One element, one colour system**: the display status pill briefly carried both the semantic classes (`running/paused/finished/overtime`) and a second "tone" layer (`is-success/is-attention`) declared lower in the CSS, so the tone layer won the cascade and painted «ВРЕМЯ ВЫШЛО!» green over a red pulse. Never add a parallel colour system to an element that already has one.
- **Status palette is fixed across all three windows**: running green, paused orange, finished red (static), overtime red (pulsing). The pulse is the ONLY thing distinguishing the two red states — do not add an animation to `finished`.
- **Scale is reported back**: windows send `report-scale` when Ctrl+wheel changes their size; main forwards it to the control panel ONLY (broadcasting would echo to the sender and can loop). Assigning `slider.value` does not fire `input`, which is what keeps the loop open.
- **Visual regression**: `npm run visual:baseline` promotes `screenshots/` to `tests/visual-baseline/` (gitignored — 8.6 MB of PNGs would grow the history on every visual change; capture them locally once); `npm run visual:check` re-captures and compares per pixel via `visual-diff.js`, exiting 3 on regression. Animations are frozen during capture (`FREEZE_ANIMATIONS_CSS`) — without that, pulses and the finish flash make captures non-deterministic. `clock-*` shots are excluded: they show the real wall clock.
- **e2e needs `e2e/launch.js`**: it strips the inherited `ELECTRON_RUN_AS_NODE` that otherwise makes `electron.launch()` fail with "bad option: --remote-debugging-port". Playwright also runs with `workers: 1` because the app holds a single-instance lock.
- **Timer status priority lives in ONE place**: `RendererShared.timerLifecycleStatus()` returns `'paused' | 'overtime' | 'finished' | 'running' | 'idle'`. Control, widget and display each map that key to their own wording and CSS class — none of them re-implements the condition. It used to be copy-pasted three times and the copies drifted: the widget painted overtime with the green `running` class, the display checked `finished` first while the other two checked overtime first, and the `isPaused` branch was unreachable whenever `remainingSeconds <= 0` (so pausing during overrun reported "Завершено"). `electron-control.html` must keep its `<script src="renderer-shared.js">` tag or the call throws.
- **`npm run screenshot` is the visual smoke test**: it boots all four windows offscreen and captures 36 PNGs into `screenshots/` (gitignored) across five timer states and all four timer styles. The `recovered` state deliberately follows `overtime` — that ordering is what catches stuck inline colours. Do not reorder `STATES` in `scripts/screenshot-runner.js`.
- **applyColors vs overtime colors (CRITICAL)**: `applyColors()` sets inline `style.color` on digital/flip elements. CSS classes (`danger`, `overtime`) CANNOT override inline styles. Solution: each `updateXxxDisplay()` method must set inline `style.color = '#ff4444'` when overtime/danger, and restore base color otherwise. Display uses `_enforceOvertimeColors()` called every tick. Widget stores `_baseTimerColor` in applyColors and overrides in updateDisplay.
- **Time format with hours**: All display styles (digital, flip, analog-digital) must handle hours when `absSecs >= 3600`. Use `H:MM:SS` format. Display flip has hidden `flipHoursUnit`/`flipHoursSep` elements shown dynamically. Widget flip already had hours support.
- **Display settings `showCurrentTime`**: Controls visibility of the "Текущее время" block on fullscreen display. Defaults to `true`. Sent via `display-settings-update` channel alongside `showTimeBlocks`.
- **No external shadows on transparent windows**: Widget and clock windows have `transparent: true` + `hasShadow: false`. Never use `drop-shadow`, `box-shadow` (external), or `filter: shadow` on elements — they create visible dark rectangles. Use only `inset` shadows or `border` for depth.
- **Design system v2**: All windows use VisionOS glassmorphism — `blur(40px) saturate(180%)`, gradient ring `#0a84ff→#30d158`, Inter Light (weight 200) for timer text. Widget/clock: NO external shadows (transparent windows). Digital LED uses JetBrains Mono. Fonts loaded via Google Fonts @import in each HTML file. Apple semantic colors: systemBlue `#0a84ff`, systemGreen `#30d158`, systemRed `#ff453a`, systemOrange `#ff9f0a`.
- **Display block positions**: Fullscreen info blocks can be Alt+dragged to custom positions. Positions persist in localStorage (`displayBlockPositions`). `applyDisplaySettings` must NOT reapply preset positions unless `timeLayoutPreset` actually changed — otherwise color/date updates clear custom positions.
- **Display scaling**: Fullscreen display: Ctrl+wheel scales timer (30-300%) or blocks (50-600%) depending on hover target. Shift+wheel always scales blocks. Both persist to localStorage (`displayTimerScale`, `displayBlockScale`).
- **Manual time input**: Smart parsing in control panel — bare number = seconds, `X:Y` = min:sec, `X:Y:Z` = hr:min:sec. Max 99:59:59. Uses `parseManualTime()` function.
- **Color picker**: HSV color picker (`ColorPicker` class) with Canvas-based SV area + hue slider + hex input. 3 independent instances for Widget/Clock/Display tabs. Toggle via rainbow gradient button appended to themes-grid.
- **Scale value edit**: Click percentage text on any scale bar → input mode. Double-click → reset to default (100%). Uses `setupScaleValueEdit()` with 250ms click delay to distinguish from dblclick.
- **Adaptive window height**: Control window resizes per active tab via `autoResizeWindow()`. Temporarily removes `max-height` from active tab to measure true content, then sends `resize-control-window` IPC. Min 650px, max 1000px.
- **Reset settings**: Button in FAQ footer. Clears localStorage via `session.clearStorageData()` in main process, then `app.quit()` (user restarts manually since `app.relaunch()` unreliable with npm start).

## Automation

- **Hooks** (`.claude/settings.json`): Auto-lint on Edit/Write, block `.env` file edits
- **Subagent** (`.claude/agents/code-reviewer.md`): IPC consistency checker for post-change review
- **Skills**: `ui-ux-pro-max` installed in `.claude/skills/` for design system generation
