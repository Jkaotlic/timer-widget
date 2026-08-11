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
2. **Widget Window** (`electron-widget.html`) — transparent, frameless, always-on-top mini-timer. 5 styles: circle, digital, flip, analog, digits. Glassmorphism design.
3. **Display Window** (`display.html` + `display-script.js`) — fullscreen timer for presentations. 5 styles: circle, digital, flip, analog, digits. Has a `DisplayTimer` class.
4. **Clock Widget** (`electron-clock-widget.html`) — independent clock widget. 5 styles: circle, digital, flip, analog, digits. Glassmorphism design.

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
| `display.css` | Все стили полноэкранного окна (~1400 строк, вынесены из inline-`<style>` в `display.html`, которое ужалось 1707 → 342 строки). Подключается ПОСЛЕДНИМ из трёх таблиц окна: в нём живёт пин палитры, обязанный переопределять `design-tokens.css`. Порядок закреплён `tests/control-decomposition.test.js` |
| `control.css` | All panel styles (~3000 lines, moved out of inline `<style>`). Loads LAST of the panel's three sheets — it overrides token values and carries the `[data-theme="light"]` re-paints, so the order `fonts.css → design-tokens.css → control.css` is load-bearing and pinned by `tests/control-decomposition.test.js`. It also owns the global `* { margin: 0; padding: 0; box-sizing: border-box }` reset, inherited from the deleted `styles.css` |
| `fonts.css` | The 20 local `@font-face` declarations, one copy for all four windows (they used to be duplicated verbatim in `control.css` + three inline `<style>` blocks). Linked FIRST in every window |
| `settings-schema.js` | The table of panel settings (key → control → default) plus `applyStoredSettings()` / `collectSettings()`. Knows nothing about `timerController` or localStorage; DOM access is only `getElementById`, so it is unit-tested against a fake document |
| `sound-bank.js` | 29 built-in sounds synthesised with oscillators. No DOM, no storage |
| `custom-sounds.js` | User-uploaded sounds: file validation, list, playback, deletion. **Prototype mixin** |
| `local-background.js` | Fullscreen background image: upload, MIME + magic-byte validation, preview, fit/overlay. **Prototype mixin** |
| `color-picker.js` | HSV picker (`ColorPicker`) + `addPickerToggle()` |
| `ui-feedback.js` | `Toast` and `LoadingIndicator` |
| `modal-manager.js` | `openModal`/`closeModal` with focus trap and focus return |
| `shortcuts-help.js` | The F1 shortcuts overlay |
| `scale-input.js` | Click-to-edit / double-click-to-reset on scale percentages |
| `font-select.js` | The font list of the «Цифры» style: `div.font-select` impersonates a form control with `.value`. Three independent instances (widget/clock/display) in one document, so an option's `id` carries its container's id. A native `<select>` cannot be used: on macOS the popup is drawn by the system and `font-family` on `<option>` is ignored — the preview, which is the whole point, would not render |

Rules when working here:

- **No bundler.** Every file is a classic `<script>`, so cross-module references go through `window.X` (`window.ColorUtils`, `window.Toast`, `window.SoundBank`). A bare name resolves only by accident via the global scope and breaks lint.
- **Two of them are prototype mixins** (`Object.assign(TimerController.prototype, window.XMixin)`), not free functions. Their methods call each other and the controller's `this.beep()` / `this.pushDisplaySettings()`, and DOM handlers close over `this` — the mixin preserves `this` semantics exactly, which made the move verbatim and behaviour-preserving. If the `Object.assign` line is lost, nothing fails at load; it fails at the first click.
- **Every new module must go into `package.json` `build.files`** or it silently vanishes from the packaged app (that is exactly how `design-tokens.css` was lost in 2.3.2). `tests/packaging.test.js` and `tests/control-decomposition.test.js` both guard this.
- **When you touch a self-contained block still living inline, move it out** instead of editing it in place.
- **A setting's key, control and default belong in `settings-schema.js` — in ONE row.** They used to be written twice: a ladder of `ext.foo !== false` / `ext.bar || 100` in `loadSettings()` and a mirror-image object literal in `saveExtSettings()`. Adding a key to one copy and not the other, or fixing a default in one, makes the setting silently revert after a restart — nothing but a roundtrip test can see that. `loadSettings()` keeps only what the table cannot express: the two keys with their own format (`overrunLimitSeconds` stores seconds behind an `MM:SS` field, `bgMode` is three buttons, both listed in `MANUAL_KEYS`) and the side effects (row visibility, IPC pushes, controller fields). `tests/settings-schema.test.js` fails if a ladder for a table-described key reappears in the panel.

### Shared Modules

- `constants.js` — all magic numbers, IPC channel names, storage keys, theme definitions, dimension limits
- `utils.js` — `formatTime()`, `formatTimeShort()`, `parseTime()`, `debounce()`, `getTimerStatus()`, `calculateProgress()`, `safelySendToWindow()`
- `security.js` — input validation (`isValidDataURL`, `isValidURL`, `validateImageSource`), `escapeHTML()`, `safeJSONParse()`
- `renderer-shared.js` — pure logic every window would otherwise copy: `breakdown`, `flipCells`, `clampScale`, `timerLifecycleStatus`, `timerColorBand`, `pickOwnSetting`
- `window-geometry.js` — window drag + size/position persistence for the widget and the clock (dual export, unit-tested in Node with injected storage/DOM)
- `clock-settings-schema.js` — the clock's settings table (key → control → default) plus `collectClockSettings` / `applyClockSettings`
- `digits-style.js` — the «Цифры» style: the six-font registry, the `resolveFont()` whitelist, and the fit arithmetic (`fitScale` / `fitFontSize` / `measureDigits` with a probe cache / `applyFont`). The size is derived by **measuring a reference string** (`88:88` / `8:88:88`) at a 100px probe, not from a per-character width constant: the old `charCount * 0.6` assumes a monospace face and is wrong by 0.42–0.78 em across these six fonts
- `ui-theme.js` — the only owner of `data-theme`. Pure part (`normalizeTheme`, `nextTheme`, `themeLabel`) is unit-tested; the DOM/storage part (`initTheme`, `applyTheme`, `storeTheme`, `bindThemeSync`) is loaded by all four windows from `<head>`

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
| `widget-resize` / `widget-move` / `widget-set-position` | Widget geometry |
| `clock-widget-resize` / `clock-widget-set-style` / `clock-widget-settings` | Clock widget controls |
| `clock-widget-move` | `{ deltaX, deltaY }` — move clock widget window |
| `clock-widget-set-position` | `{ x, y }` — restore saved clock position (clamped to a live display) |
| `display-move` | `{ deltaX, deltaY }` — move display window in windowed mode |
| `ui-theme-update` | `{ theme: 'dark' \| 'light' }` — sent by the panel only; main validates against a whitelist and relays to ALL windows (the one channel that IS broadcast, because the theme is app-wide) |
| `toggle-fullscreen` | Toggle fullscreen on the sender's window |
| `reset-and-relaunch` | Clear all storage and quit |
| `minimize-window` / `quit-app` | Window management |

### Receive (main → renderer)

| Channel | Payload |
|---------|---------|
| `timer-state` | Full `timerState` object (see below) — broadcast every second |
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
| `ui-theme-update` | `{ theme }` — applied by `UITheme.bindThemeSync()` in every window |
| `timer-recovery-available` | The crash snapshot (`{ presetSeconds, totalSeconds, remainingSeconds, savedAt }`), sent to the control window once on `did-finish-load`. Main restores the time itself; this only tells the panel to say so (a toast) |

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

Tests use the Node.js built-in test runner (`node --test`). Test files in `tests/`.
Do NOT hardcode the count anywhere — in code, in CI, or in this file. Run `node --test` to get it.

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
| `ipc-liveness.test.js` | Every whitelisted channel has BOTH ends — a sender and a receiver. The whitelist is a permission, not proof of life |
| `edge-cases.test.js` | Edge cases for all utils |
| `constants.test.js` | CONFIG immutability and structure, plus the orphan check — every key must have a reader outside `constants.js` and outside this test, and `WARNING_THRESHOLD` is pinned by the behavioural boundary of `getTimerStatus`, not by comparing the registry to itself |
| `timer-engine.test.js` | `tick`/`adjust`/`reset`/`setPreset` arithmetic + boundary events |
| `timer-controller.test.js` | State machine with a fake clock (start/pause/reset/reconcile) |
| `recovery.test.js` | Crash-recovery persist/load/validate |
| `renderer-shared.test.js` | `breakdown`, `flipCells`, `clampScale` |
| `renderer-storage.test.js` | Quota-safe localStorage helpers |
| `color-utils.test.js` | HSV↔RGB↔HEX conversion |
| `settings-schema.test.js` | The settings table: defaults, legacy-key fallbacks, collect/apply roundtrip, on a fake document |
| `display-timer.test.js` | `validateBlockPositions`, `canSafelyStore` |
| `perf.test.js` | Hot-path performance budgets |
| `packaging.test.js` | Every runtime asset is listed in `build.files` |
| `electron-main-source.test.js` | IPC payload hardening, DevTools gating, icon path |
| `visual-source.test.js` | Layout/centering invariants, release-doc freshness |
| `audit-2026-07-fixes.test.js` | Regressions from the July 2026 audit (sound, Esc, scales, geometry) |
| `audit-2026-07-30-fixes.test.js` | Regressions from the 30 Jul 2026 pass (flip separator, finish flash, geometry persistence, modifier guard, flip timers, sound deletion, F1 overlay, scale input, display clock, clock style source, window-state snapshot) |
| `storage-keys.test.js` | `CONFIG.STORAGE_KEYS` matches the keys the code actually uses — both directions — and no key is write-only or read-only |
| `contrast.test.js` | WCAG contrast of text tokens WITH alpha compositing, for BOTH themes (dark ≥ AA, light ≥ AAA), plus the light surface ladder, its accents and the label on accent fills |
| `ui-theme.test.js` | Theme logic + the whole wiring: module → all four windows' `<head>` → channel in both whitelists → main's relay → panel button |
| `faq-and-hidden-controls.test.js` | Clock settings are reachable (no `display:none`), exactly ONE accordion handler, help text matches the real UI, footer version == package.json, every checkbox has an accessible name, dead CSS stays deleted |
| `release-notes.test.js` | Release notes are generated from CHANGELOG (not hardcoded in the workflow), the download table matches `build.target`, and the promises in summary/footer are not stale |
| `window-geometry.test.js` | Drag + geometry BEHAVIOUR on fake storage/DOM: restore, save, scale bounds, quota, modifier guard, drag-target selector |
| `clock-settings-schema.test.js` | The clock settings table: collect/apply roundtrip, defaults, stored `false` vs missing |
| `window-open-ownership.test.js` | Every create-function announces its own window and hydrates it; tray binding lives in `createControlWindow`; renderer payloads are normalised |
| `settings-key-ownership.test.js` | `pickOwnSetting` behaviour + the wiring: display/widget read their OWN key, ticks have one owner in storage |
| `color-validation-single-owner.test.js` | One colour validator (`SecurityUtils.isSafeColor`); the weaker copies stay gone |
| `release-gates.test.js` | Release gates: DevTools guarded on EVERY window, isolation on every window, no external URLs in shipped files, local fonts, no auto-update, CSP per window, Linux sandbox scoped to AppImage only |
| `docs-integrity.test.js` | Связность `CLAUDE.md` ↔ `docs/lessons.md`: каждая ссылка ведёт в существующий разбор, каждый разбор либо достижим, либо ЯВНО помечен устаревшим и указывает на замену; плюс потолок размера самого `CLAUDE.md` — он попадает в контекст каждого разговора целиком |
| `digits-style.test.js` | The «Цифры» registry checked in THREE directions — every registry font has files on disk, every file is declared in `fonts.css`, and no `fonts/` file is orphaned — plus the `resolveFont` whitelist and the fit arithmetic (garbage in gives 0, never NaN/Infinity: either one collapses the digits to nothing) |

e2e specs (`npx playwright test`, `workers: 1`):

| File | Covers |
|------|--------|
| `app.spec.js` | Boot, presets, start/pause/reset round trip |
| `status-and-colors.spec.js` | Colour bands, status priority, Esc layering, overrun limit, module wiring |
| `flip-animation.spec.js` | Flip animation fires in all three windows |
| `flip-hours-layout.spec.js` | Flip separator stays dots (never a glyph) in H:MM:SS, measured |
| `window-state-sync.spec.js` | A window loaded second knows which windows are already open |
| `dial-ticks.spec.js` | Dial tick marks toggle reaches widget + clock and survives reopen |
| `overtime-palette.spec.js` | Overtime is red in display + widget — digits, glow and status chip |
| `analog-hour-hand.spec.js` | Display's analog hour hand angle at 5 min / 1 h / 1:30 / 6 h |
| `ui-theme.spec.js` | The light theme reaches all four windows (measured via computed token values), survives a reload, toggles back; and it repaints REAL controls — the label on the active preset is measured against BOTH gradient stops, because `backgroundColor` on a gradient fill is transparent and the first version of that check compared against nothing and passed |
| `drawer-layout.spec.js` | Settings drawer never overlaps the panel — measured rectangles at normal AND max window width |
| `sound-events.spec.js` | Every sound event fires EXACTLY once: minute warning, zero (with and without overrun), overrun interval, and the start sound from both a local click and another window. Counts real `playSound` calls over real time — the engine's unit tests know nothing about double-play |
| `crash-recovery.spec.js` | SIGKILL → relaunch restores the in-progress time and does NOT auto-start; a CLEAN quit leaves nothing to restore. Runs >10s on purpose: the snapshot interval lives in the main process and faking it would test the fake |
| `settings-roundtrip.spec.js` | 34 settings across all four storages survive a window reload, plus two separate tests: clock-style sync (incompatible with the main plan — enabling it overwrites the chosen clock style) and per-window theme colours (three windows get three DIFFERENT themes, so colour bleeding between windows fails it too). The key registry proves a key is read and written; only this proves the VALUE arrives |
| `window-drag-geometry.spec.js` | Characterization: synthetic drag moves the REAL BrowserWindow by the exact delta and persists `{scalePct,x,y}`; modifiers and button targets do not move it. Written BEFORE the drag/geometry extraction and passed unchanged after it |
| `reachable-controls.spec.js` | Help accordion by mouse AND keyboard; the returned clock toggles actually change the clock window; style-sync hides the style row. Everything by CLICK on visible elements only |
| `digits-style.spec.js` | The «Цифры» style reaches all three windows BY CLICK; the size is really fitted (not the CSS fallback); the font choice lands in its OWN window and touches neither of the other two; the font row shows only for this style; the `.value` setter is silent while a click fires `change`; and the fit is **idempotent** — three recalculations in a row must return one size |
| `window-scale-fit.spec.js` | After scaling, the widget's and clock's window rect lies ENTIRELY inside the work area of its own display (measured on the real `BrowserWindow`, parked at the top-right corner first so the check cannot pass by accident on a roomier screen); a poisoned stored point near the screen edge no longer restores the window off-frame (it used to leave 12% of it visible); and the scale plus position survive a close/reopen — that last scenario is what caught the geometry-clobbering bug |
| `color-ownership.spec.js` | Характеризация окраски: 5 стилей × 4 полосы × 2 окна, сверка ВЫЧИСЛЕННЫХ цвета и тени с эталоном. Написан ДО перевода цвета на каскад и прошёл неизменённым после. Нормализует запись цвета: один и тот же цвет браузер печатает как `rgba(255,204,0,0.4)` из литерала и как `color(srgb 1 0.8 0 / 0.4)` из `color-mix`, и без нормализации корректный рефакторинг выглядел бы регрессией |
| `color-band-reset.spec.js` | Выход из полосы снимает ВСЁ, что полоса нарисовала — на чистом профиле (там залипал красный ореол) и с выбранным цветом (там полоса обязана этот цвет перебивать) |
| `display-timer-scale.spec.js` | Characterization of the display's timer scale across every style block — settings push, Ctrl+wheel, and restore on window load. Written BEFORE folding three copies into `applyTimerScale()` |

## CI

GitHub Actions (`.github/workflows/nodejs.yml`), Node 22, three jobs:

| Job | Where | What |
|-----|-------|------|
| `build` | ubuntu-latest | `npm run ci` (lint + unit), then non-blocking `visual:check` under xvfb and `coverage`. **The visual step needs `chmod 4755` + root owner on `node_modules/electron/dist/chrome-sandbox` first** — npm cannot set SUID at install time, so Chromium finds the helper, refuses to start and aborts with exit 133. Until 2.4.0 that is exactly what happened on every run: the step took ZERO screenshots and `continue-on-error` hid it. A non-blocking step that fails silently is worth less than no step at all — check its log, not its colour |
| `e2e` | ubuntu + windows + macos | `npx playwright test` — the ONLY thing that exercises the real Electron runtime. Linux runs under `xvfb-run`; `fail-fast: false` so one platform failing doesn't hide the others; the Playwright report is uploaded per-OS on failure |
| `pack` | ubuntu + windows | `electron-builder --dir`, then `node scripts/verify-packed.js` (assets + release gates on the real `app.asar`) |
| `linux-sandbox` | ubuntu-latest | builds deb + AppImage, then `node scripts/verify-linux-sandbox.js`: deb's postinst sets SUID + root owner and its `.desktop` has NO `--no-sandbox`; the AppImage's `.desktop` DOES. This cannot be checked from macOS at all |

Release workflow builds on macOS (Intel + ARM) and Windows with Node 22.

- **The e2e matrix is what closes the cross-platform gap.** It used to not run in CI at
  all — 35 runtime tests executed only by hand on macOS, while the entire JS window-drag
  architecture exists *because of* Windows quirks with transparent frameless windows. The
  untested platform was precisely the one the workaround was written for.
- **`pack` catches what `tests/packaging.test.js` cannot.** The unit test only checks the
  *list* in `package.json`; `verify-packed.js` opens the real `app.asar` produced by real
  electron-builder and diffs its contents against `build.files`. That is how
  `design-tokens.css` went missing in 2.3.2 — it was in the list.
- **`verify-packed.js` parses the asar header by hand** (no dependency): four `uint32`
  fields precede the JSON tree — outer pickle size, header buffer size, header payload
  size, then the JSON string length at offset 12, with the JSON itself at offset 16.
  `tests/verify-packed.test.js` validates this against the **real** `default_app.asar`
  shipped inside `node_modules/electron`, not only against a synthetic archive: the first
  version of that test built its fixture with the same wrong offsets as the parser and
  passed green while CI failed on the real file. A hand-rolled fixture can only ever
  confirm your own understanding of a format.

## Gotchas
Каждый пункт — правило, которое можно нарушить и не заметить. Полный разбор
каждого (история, замеры, что именно ввело в заблуждение) — в
[docs/lessons.md](docs/lessons.md). Перед работой над подсистемой прочитайте её
разбор: правило говорит ЧТО делать, разбор — почему все предыдущие попытки
сделали иначе.

- **A green test does NOT prove a feature is reachable (CRITICAL)** — [разбор](docs/lessons.md#a-green-test-does-not-prove-a-feature-is-reachable-critical)
- **Search for the identifier, not the CSS class** — [разбор](docs/lessons.md#search-for-the-identifier-not-the-css-class)
- **Source-level tests must strip comments before asserting absence** — [разбор](docs/lessons.md#source-level-tests-must-strip-comments-before-asserting-abse)
- **Never run `perl -pi` over these files** — [разбор](docs/lessons.md#never-run-perl--pi-over-these-files)
- **Window state must be SNAPSHOT to each window on load, not only broadcast on change (CRITICAL)** — [разбор](docs/lessons.md#window-state-must-be-snapshot-to-each-window-on-load-not-onl)
- **The finish flash must be latched** — [разбор](docs/lessons.md#the-finish-flash-must-be-latched)
- **Flip timers belong to `flip-card.js`** — [разбор](docs/lessons.md#flip-timers-belong-to-flip-cardjs)
- **`showTicks` drives TWO dials** — [разбор](docs/lessons.md#showticks-drives-two-dials)
- **Resizing a window must hold its CENTRE, not its top-left corner (CRITICAL)** — [разбор](docs/lessons.md#resizing-a-window-must-hold-its-centre-not-its-top-left-corn)
- **A restored position must fit the WHOLE window, not just its corner (CRITICAL)** — [разбор](docs/lessons.md#a-restored-position-must-fit-the-whole-window-not-just-its-c)
- **The geometry write must wait until the size has SETTLED (CRITICAL)** — [разбор](docs/lessons.md#the-geometry-write-must-wait-until-the-size-has-settled-crit)
- **Geometry is saved on `resize`, not only from Ctrl+wheel** — [разбор](docs/lessons.md#geometry-is-saved-on-resize-not-only-from-ctrlwheel)
- **A theme block must sit BELOW the shared `:root`, and its name must not appear above it (CRITICAL)** — [разбор](docs/lessons.md#a-theme-block-must-sit-below-the-shared-root-and-its-name-mu)
- **The surface ladder exists in BOTH themes and runs opposite ways** — [разбор](docs/lessons.md#the-surface-ladder-exists-in-both-themes-and-runs-opposite-w)
- **A hit area is grown with a pseudo-element, never with the box** — [разбор](docs/lessons.md#a-hit-area-is-grown-with-a-pseudo-element-never-with-the-box)
- **A colour default has an owner too, and the owner is CSS** — [разбор](docs/lessons.md#a-colour-default-has-an-owner-too-and-the-owner-is-css)
- **The e2e profile is shared, so a test that flips global state must flip it back** — [разбор](docs/lessons.md#the-e2e-profile-is-shared-so-a-test-that-flips-global-state)
- **An unreachable theme is an untested theme** — [разбор](docs/lessons.md#an-unreachable-theme-is-an-untested-theme)
- **`design-tokens.css` holds tokens, not recipes** — [разбор](docs/lessons.md#design-tokenscss-holds-tokens-not-recipes)
- **Opening a window has ONE owner — the create-function (CRITICAL)** — [разбор](docs/lessons.md#opening-a-window-has-one-owner-the-create-function-critical)
- **A payload default is not a guard** — [разбор](docs/lessons.md#a-payload-default-is-not-a-guard)
- **A setting field needs an owner too, not just the key (CRITICAL)** — [разбор](docs/lessons.md#a-setting-field-needs-an-owner-too-not-just-the-key-critical)
- **Tests and screenshots run in their OWN profiles** — [разбор](docs/lessons.md#tests-and-screenshots-run-in-their-own-profiles)
- **`codeOnly()` is ONE implementation, in `tests/helpers/source-scan.js`** — [разбор](docs/lessons.md#codeonly-is-one-implementation-in-testshelperssource-scanjs)
- **The bridge exposes no `invoke`** — [разбор](docs/lessons.md#the-bridge-exposes-no-invoke)
- **Release gates count windows, they don't count matches** — [разбор](docs/lessons.md#release-gates-count-windows-they-dont-count-matches)
- **`--no-sandbox` was cancelling the app's own `sandbox: true`** — [разбор](docs/lessons.md#no-sandbox-was-cancelling-the-apps-own-sandbox-true)
- **The rot is not confined to `STORAGE_KEYS` — the WHOLE of `CONFIG` had it (CRITICAL)** — [разбор](docs/lessons.md#the-rot-is-not-confined-to-storage_keys-the-whole-of-config)
- **`CONFIG.STORAGE_KEYS` is a registry, not an access point** — [разбор](docs/lessons.md#configstorage_keys-is-a-registry-not-an-access-point)
- **The display has no browser-mode fallback** — [разбор](docs/lessons.md#the-display-has-no-browser-mode-fallback)
- **IPC whitelist is duplicated** — [разбор](docs/lessons.md#ipc-whitelist-is-duplicated)
- **A whitelisted channel is a permission, not a feature (CRITICAL)** — [разбор](docs/lessons.md#a-whitelisted-channel-is-a-permission-not-a-feature-critical)
- **Adding new IPC channel** — [разбор](docs/lessons.md#adding-new-ipc-channel)
- **Per-window colors** — [разбор](docs/lessons.md#per-window-colors)
- **`ipc-compat.js`** — [разбор](docs/lessons.md#ipc-compatjs)
- **Global keyboard shortcuts** — [разбор](docs/lessons.md#global-keyboard-shortcuts)
- **Window state broadcast** — [разбор](docs/lessons.md#window-state-broadcast)
- **Start sound from remote windows** — [разбор](docs/lessons.md#start-sound-from-remote-windows)
- **Monitor selection persistence** — [разбор](docs/lessons.md#monitor-selection-persistence)
- **Inline styles in HTML** — [разбор](docs/lessons.md#inline-styles-in-html)
- **Widget devTools** — [разбор](docs/lessons.md#widget-devtools)
- **A control with no visual coverage has no layout guarantee** — [разбор](docs/lessons.md#a-control-with-no-visual-coverage-has-no-layout-guarantee)
- **Design previews** — [разбор](docs/lessons.md#design-previews)
- **Sounds** — [разбор](docs/lessons.md#sounds)
- **Control panel layout** — [разбор](docs/lessons.md#control-panel-layout)
- **syncClockStyle** — [разбор](docs/lessons.md#syncclockstyle)
- **Widget/clock geometry persistence** — [разбор](docs/lessons.md#widgetclock-geometry-persistence)
- **Scale pushes must be change-detected** — [разбор](docs/lessons.md#scale-pushes-must-be-change-detected)
- **Escape is layered** — [разбор](docs/lessons.md#escape-is-layered)
- **A fitted size must never be measured against its own output (CRITICAL)** — [разбор](docs/lessons.md#a-fitted-size-must-never-be-measured-against-its-own-output)
- **Accent text on an accent fill is a contrast trap, not bad luck with numbers** — [разбор](docs/lessons.md#accent-text-on-an-accent-fill-is-a-contrast-trap-not-bad-luc)
- **A capture harness must wait for the theme too, not just for fonts** — [разбор](docs/lessons.md#a-capture-harness-must-wait-for-the-theme-too-not-just-for-f)
- **Centre the DIGITS, not the whole inscription** — [разбор](docs/lessons.md#centre-the-digits-not-the-whole-inscription)
- **The clock's superscript seconds are the opposite case** — [разбор](docs/lessons.md#the-clocks-superscript-seconds-are-the-opposite-case)
- **Both rules were settled by measuring in `e2e` (digit centre, inscription centre,** — [разбор](docs/lessons.md#both-rules-were-settled-by-measuring-in-e2e-digit-centre-ins)
- **Flip animation is shared** — [разбор](docs/lessons.md#flip-animation-is-shared)
- **A segmented control's `.value` setter must NOT fire `change` (CRITICAL)** — [разбор](docs/lessons.md#a-segmented-controls-value-setter-must-not-fire-change-criti)
- **`#clockStyleRow` must be on the real row** — [разбор](docs/lessons.md#clockstylerow-must-be-on-the-real-row)
- **Segmented controls are `role="radiogroup"` + `role="radio"` + `aria-checked`, not tabs** — [разбор](docs/lessons.md#segmented-controls-are-roleradiogroup-roleradio-aria-checked)
- **Цвет — это переменная, состояние — это класс; инлайн НЕ используется (CRITICAL)** — [разбор](docs/lessons.md#color-belongs-to-the-cascade)
- **Overtime on the display is painted by `.danger`, never by `.overtime`** — [разбор](docs/lessons.md#overtime-on-the-display-is-painted-by-danger-never-by-overti)
- **`styles.css` and `components.css` are gone, and the reason is not tidiness** — [разбор](docs/lessons.md#stylescss-and-componentscss-are-gone-and-the-reason-is-not-t)
- **The overtime ring is intentionally invisible** — [разбор](docs/lessons.md#the-overtime-ring-is-intentionally-invisible)
- **The analog hour hand must be driven explicitly** — [разбор](docs/lessons.md#the-analog-hour-hand-must-be-driven-explicitly)
- **A capture harness must be deterministic in FOUR ways, and three of them were found the hard way** — [разбор](docs/lessons.md#a-capture-harness-must-be-deterministic-in-four-ways-and-thr)
- **Captures must wait for `document.fonts.ready`, never a fixed sleep** — [разбор](docs/lessons.md#captures-must-wait-for-documentfontsready-never-a-fixed-slee)
- **Any capture containing live wall-clock time MUST go into `isTimeDependent()`** — [разбор](docs/lessons.md#any-capture-containing-live-wall-clock-time-must-go-into-ist)
- **Info blocks had zero visual coverage until 2026-07-30** — [разбор](docs/lessons.md#info-blocks-had-zero-visual-coverage-until-2026-07-30)
- **`visual:check` was NOT deterministic as of 10 Aug 2026 — verify the harness against itself before trusting a verdict** — [разбор](docs/lessons.md#visualcheck-was-not-deterministic-as-of-10-aug-2026-verify-t)
- **`visual:check` has a tolerance, so it is not a substitute for measurement** — [разбор](docs/lessons.md#visualcheck-has-a-tolerance-so-it-is-not-a-substitute-for-me)
- **The widget's flip separator is DOTS, not a glyph** — [разбор](docs/lessons.md#the-widgets-flip-separator-is-dots-not-a-glyph)
- **Colour bands live in ONE place too** — [разбор](docs/lessons.md#colour-bands-live-in-one-place-too)
- **One element, one colour system** — [разбор](docs/lessons.md#one-element-one-colour-system)
- **Status palette is fixed across all three windows** — [разбор](docs/lessons.md#status-palette-is-fixed-across-all-three-windows)
- **Scale is reported back** — [разбор](docs/lessons.md#scale-is-reported-back)
- **Visual regression** — [разбор](docs/lessons.md#visual-regression)
- **e2e needs `e2e/launch.js`** — [разбор](docs/lessons.md#e2e-needs-e2elaunchjs)
- **Timer status priority lives in ONE place** — [разбор](docs/lessons.md#timer-status-priority-lives-in-one-place)
- **`npm run screenshot` is the visual smoke test** — [разбор](docs/lessons.md#npm-run-screenshot-is-the-visual-smoke-test)
- **Time format with hours** — [разбор](docs/lessons.md#time-format-with-hours)
- **Display settings `showCurrentTime`** — [разбор](docs/lessons.md#display-settings-showcurrenttime)
- **No external shadows on transparent windows** — [разбор](docs/lessons.md#no-external-shadows-on-transparent-windows)
- **Design system v2** — [разбор](docs/lessons.md#design-system-v2)
- **The second theme is LIGHT, and it is not the dark one inverted (CRITICAL)** — [разбор](docs/lessons.md#the-second-theme-is-light-and-it-is-not-the-dark-one-inverte)
- **Windows whose background the USER paints keep the dark palette in both themes (CRITICAL)** — [разбор](docs/lessons.md#windows-whose-background-the-user-paints-keep-the-dark-palet)
- **Two UI themes, `data-theme` on `<html>`** — [разбор](docs/lessons.md#two-ui-themes-data-theme-on-html)
- **Display block positions** — [разбор](docs/lessons.md#display-block-positions)
- **Display scaling** — [разбор](docs/lessons.md#display-scaling)
- **Manual time input** — [разбор](docs/lessons.md#manual-time-input)
- **Color picker** — [разбор](docs/lessons.md#color-picker)
- **Scale value edit** — [разбор](docs/lessons.md#scale-value-edit)
- **Adaptive window height** — [разбор](docs/lessons.md#adaptive-window-height)
- **Reset settings** — [разбор](docs/lessons.md#reset-settings)

## Automation

- **Hooks** (`.claude/settings.json`): Auto-lint on Edit/Write, block `.env` file edits
- **Subagent** (`.claude/agents/code-reviewer.md`): IPC consistency checker for post-change review
- **Skills**: `ui-ux-pro-max` installed in `.claude/skills/` for design system generation
