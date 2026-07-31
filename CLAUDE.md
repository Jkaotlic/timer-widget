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
| `control.css` | All panel styles (~3000 lines, moved out of inline `<style>`). Must load AFTER `design-tokens.css`/`components.css` — it overrides them, the cascade order is load-bearing |
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
| `widget-resize` / `widget-move` / `widget-set-position` / `widget-set-opacity` | Widget geometry/opacity |
| `clock-widget-resize` / `clock-widget-set-style` / `clock-widget-settings` | Clock widget controls |
| `clock-widget-move` | `{ deltaX, deltaY }` — move clock widget window |
| `clock-widget-set-position` | `{ x, y }` — restore saved clock position (clamped to a live display) |
| `display-move` | `{ deltaX, deltaY }` — move display window in windowed mode |
| `ui-theme-update` | `{ theme: 'dark' \| 'hc-dark' }` — sent by the panel only; main validates against a whitelist and relays to ALL windows (the one channel that IS broadcast, because the theme is app-wide) |
| `toggle-fullscreen` | Toggle fullscreen on the sender's window |
| `reset-and-relaunch` | Clear all storage and quit |
| `minimize-window` / `close-window` / `quit-app` | Window management |

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
| `audit-2026-07-30-fixes.test.js` | Regressions from the 30 Jul 2026 pass (flip separator, finish flash, geometry persistence, modifier guard, flip timers, sound deletion, F1 overlay, scale input, display clock, clock style source, window-state snapshot) |
| `storage-keys.test.js` | `CONFIG.STORAGE_KEYS` matches the keys the code actually uses — both directions — and no key is write-only or read-only |
| `contrast.test.js` | WCAG contrast of text tokens WITH alpha compositing, for BOTH themes (dark ≥ AA, hc-dark ≥ AAA), plus display info-block labels |
| `ui-theme.test.js` | Theme logic + the whole wiring: module → all four windows' `<head>` → channel in both whitelists → main's relay → panel button |
| `faq-and-hidden-controls.test.js` | Clock settings are reachable (no `display:none`), exactly ONE accordion handler, help text matches the real UI, footer version == package.json, every checkbox has an accessible name, dead CSS stays deleted |
| `release-notes.test.js` | Release notes are generated from CHANGELOG (not hardcoded in the workflow), the download table matches `build.target`, and the promises in summary/footer are not stale |
| `release-gates.test.js` | Release gates: DevTools guarded on EVERY window, isolation on every window, no external URLs in shipped files, local fonts, no auto-update, CSP per window, Linux sandbox scoped to AppImage only |

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
| `ui-theme.spec.js` | High contrast reaches all four windows (measured via computed token values), survives a reload, toggles back |
| `drawer-layout.spec.js` | Settings drawer never overlaps the panel — measured rectangles at normal AND max window width |
| `sound-events.spec.js` | Every sound event fires EXACTLY once: minute warning, zero (with and without overrun), overrun interval, and the start sound from both a local click and another window. Counts real `playSound` calls over real time — the engine's unit tests know nothing about double-play |
| `crash-recovery.spec.js` | SIGKILL → relaunch restores the in-progress time and does NOT auto-start; a CLEAN quit leaves nothing to restore. Runs >10s on purpose: the snapshot interval lives in the main process and faking it would test the fake |
| `settings-roundtrip.spec.js` | 34 settings across all four storages survive a window reload, plus two separate tests: clock-style sync (incompatible with the main plan — enabling it overwrites the chosen clock style) and per-window theme colours (three windows get three DIFFERENT themes, so colour bleeding between windows fails it too). The key registry proves a key is read and written; only this proves the VALUE arrives |
| `reachable-controls.spec.js` | Help accordion by mouse AND keyboard; the returned clock toggles actually change the clock window; style-sync hides the style row. Everything by CLICK on visible elements only |

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

- **A green test does NOT prove a feature is reachable (CRITICAL)**: `e2e/clock-style-sync.spec.js` sets `.checked` from code and dispatches `change`. It passed for a whole pass while `#syncClockStyle` sat inside a `display:none` block — the logic was fixed, the control was never put back in the UI, and no test could tell. Three other clock settings (seconds, 24h, timezone) hid the same way with fully live wiring behind them. When you fix logic, also click the thing: `e2e/reachable-controls.spec.js` only ever clicks VISIBLE elements, so hiding a control again fails it. And `display:none` blocks commented "kept for JS compatibility" are where unreachable features live — treat that comment as a bug report.
- **Search for the identifier, not the CSS class**: while auditing the help modal I grepped `faq-question` and concluded no click handler existed — so I added one. The handler was there, 115 lines below, written as `faqQuestions.forEach` (camelCase variable, no hyphen), and `head` truncated the grep output that would have shown it. Two handlers on the same element killed the accordion outright: the first adds `open`, the second reads it as "already open", strips the class from the whole section and never re-adds it. `tests/faq-and-hidden-controls.test.js` now asserts there is exactly ONE handler.
- **Source-level tests must strip comments before asserting absence**: four assertions in this repo failed on their own explanatory comments (a comment saying "`max-height: 500px` used to clip answers" trips a check for `max-height: 500px`; the shell script explaining why `chmod 0755` was wrong trips a check for `chmod 0755`). Every "the old broken thing is gone" assertion runs against a comment-stripped copy (`CSS_CODE` / `HTML_CODE` in the tests). Check code, not prose about code.
- **Never run `perl -pi` over these files**: they are UTF-8 with Cyrillic text. Perl reads bytes as latin-1, and inserting one wide character re-encodes the WHOLE file, turning every Cyrillic string into mojibake (the corruption is reversible — `s.encode('latin-1').decode('utf-8')` — but only if you notice). Use the Edit tool or a Python script with explicit `encoding='utf-8'`.
- **Window state must be SNAPSHOT to each window on load, not only broadcast on change (CRITICAL)**: every window decides "open or close" for W/C/D — and the control panel for its window buttons — from a LOCAL flag that starts `false` and is only updated by `*-window-state` messages. Those used to be sent solely at the moment a window opened or closed, so a window that loaded *later* never learned about windows already open. Ordinary path to the bug: open the clock, then the widget, press C in the widget — the widget thinks the clock is closed, sends `open-clock-widget`, main just focuses the existing window and the toggle appears dead. Same after `bindRenderCrashHandler` reloads a renderer, and after the panel is recreated from the tray. `bindWindowStateSnapshot()` in the main process pushes all three states on `did-finish-load`; the listener is `on`, NOT `once`, precisely so a reload gets the snapshot again. Covered by `e2e/window-state-sync.spec.js`.
- **The finish flash must be latched**: the fullscreen display's `triggerFinishEffect()` used to be guarded only by `finished && !flashInterval`. `flashInterval` clears itself when the ~3s flash sequence ends while `finished` stays latched in the engine until reset, so ANY later state emit restarted the strobe — pressing Start again at 00:00 (the controller answers with `finish()`), any overrun-config push from the panel, the `get-timer-state` reply to a freshly opened window. `_finishEffectShown` latches it; it is cleared in `updateDisplay()` whenever `finished` is false, *before* the cache early-return.
- **Flip timers belong to `flip-card.js`**: the module keeps its own `Set` of pending class-removal timeouts and deletes each on fire; windows call `FlipCard.cancelPending()` in `cleanup()`. Do NOT reintroduce per-window arrays (`_flipTimeouts` / `_timeouts`) — seconds tick every second, so an externally tracked list grew unbounded for the lifetime of the window and then `clearTimeout`ed thousands of dead ids.
- **`showTicks` drives TWO dials**: both the widget and the clock have a `.tick-marks` SVG group and a `.ticks-on` rule, so the single "Деления на циферблате" checkbox writes `widgetShowTicks` AND `clockShowTicks` and pushes to both windows unconditionally (not only when `syncClockStyle` is on). Each window restores its own key at init — without that, enabled ticks visibly blinked off until the panel's push arrived ~600ms after load. The whole feature was once unreachable: the checkbox was dropped from the markup in 9b70782 while every other layer stayed, and `getElementById` guards hid it. `e2e/dial-ticks.spec.js` keeps the chain measured.
- **Geometry is saved on `resize`, not only from Ctrl+wheel**: the widget and clock persist `{scalePct, x, y}` on the window `resize` event, guarded by `pct !== this._{widget,clock}ScalePct`. The guard is load-bearing: `restoreGeometry()` itself triggers a resize at startup, and without it `saveGeometry()` would write the position *before* `*-set-position` lands and clobber the restored one. Without the resize hook, the panel's "Масштаб часов" slider (which only sends `clock-widget-resize`) was lost on reopen, and the panel restores that slider from `clockGeometry` because it has no value of its own in `displayExtSettings`.
- **An unreachable theme is an untested theme**: `design-tokens.css` shipped three `[data-theme]` blocks while nothing ever set the attribute. Two of them were dead, and *because* they were dead their contrast was never tuned — the light theme's labels sat at 2.70:1. Measuring the cost settled it: 72 `rgba(255,255,255,·)` + 32 `rgba(0,0,0,·)` + 25 hex literals in `control.css` alone, plus 8 inline `style=` colours in the markup (inline beats any theme, so those had to move to classes first). The light block was deleted; `hc-dark` was wired up and is now held at AAA (7:1) by `tests/contrast.test.js`. If you add a `[data-theme]` block, add it to `UI_THEMES` in `ui-theme.js` too — `tests/ui-theme.test.js` checks BOTH directions and fails on a block you cannot reach from the UI.
- **Release gates count windows, they don't count matches**: the old DevTools test asserted `devToolsMatches.length === 4`. A fifth window added WITHOUT the guard leaves the count at 4 — it passes. `tests/release-gates.test.js` extracts every `new BrowserWindow({` block and requires the guard in each; `scripts/verify-packed.js` repeats the check on the real `app.asar` after electron-builder. Verified by mutation, which is how the first version of the `openDevTools` check was caught looking at a nearby `devTools:` line instead of a real guard.
- **`--no-sandbox` was cancelling the app's own `sandbox: true`**: the flag sat in `build.linux.executableArgs`, so it shipped to EVERY Linux target, while `build/linux-after-install.sh` deliberately stripped the SUID bit "to fall back on user namespaces" — the sandbox therefore worked through neither path. `executableArgs` also exists on `CommonLinuxOptions`, so it can be scoped: deb now gets a proper SUID helper (`chmod 4755` + `chown root:root`) and no flag; AppImage keeps the flag because it has no install step and unprivileged user namespaces are not universally available (hardened kernels; AppArmor restricts them since Ubuntu 24.04). Checked on the built packages by the `linux-sandbox` CI job — none of this is verifiable from macOS.
- **`CONFIG.STORAGE_KEYS` is a registry, not an access point**: renderers use string literals (no bundler, no wrapper module), so the map cannot break — it silently rots. It had 16 phantom keys and was missing 10 real ones. `tests/storage-keys.test.js` now checks it in BOTH directions and additionally fails on any key that is write-only (a setting going nowhere) or read-only (always the default) — both had really happened here.
- **The display has no browser-mode fallback**: `display-script.js` used to branch on `window.ipcRenderer` and otherwise sync through a `timerState` localStorage key with 1s polling. Nothing in the project ever wrote that key, so the branch could not work at all; it is gone. `display.html` is only ever loaded by `loadFile()` inside Electron.
- **IPC whitelist is duplicated**: `preload.js` inlines the whitelist from `channel-validator.js` (sandbox blocks `require()`). Both files MUST stay in sync — the test `channel-validator.test.js` verifies this.
- **Adding new IPC channel**: Add to BOTH `send` and `receive` arrays in BOTH `preload.js` and `channel-validator.js`. Missing receive = widget silently ignores messages.
- **Per-window colors**: there is deliberately NO global colour broadcast — a `colors-update` channel does not exist and must not be added. Use `widget-colors-update`, `clock-colors-update`, `display-colors-update` so colours cannot bleed between windows.
- **`ipc-compat.js`**: All renderer HTML files use `ipcRenderer.on/send` which is shimmed to `electronAPI` via this compat layer. Don't use `electronAPI` directly in renderers.
- **Global keyboard shortcuts**: Space (start/pause), R (reset), 1-8 (presets 5-60 min), W/C/D (toggle windows) work from ALL windows (widget, clock, display, control). Guarded with `if (e.ctrlKey || e.altKey) return` to avoid conflicts with scale/drag.
- **Window state broadcast**: `broadcastWindowState()` in main process sends `*-window-state` to ALL windows (not just control). Required for W/C/D toggle shortcuts to know current state.
- **Start sound from remote windows**: Control panel detects `!wasRunning → isRunning` transition in `timer-state` handler and plays start sound. `_localStartTriggered` flag prevents double-play when start button clicked locally.
- **Monitor selection persistence**: Main process stores `lastDisplayIndex`. When `open-display` arrives without `displayIndex` (from widget/clock D key), reuses last selection instead of defaulting to auto.
- **Inline styles in HTML**: Each HTML file has ~1000+ lines of inline CSS/JS. CSP requires `unsafe-inline`. No external CSS frameworks.
- **Widget devTools**: Set to `false` in production. Change to `true` in `electron-main.js` for debugging.
- **A control with no visual coverage has no layout guarantee**: the settings drawer was closed in every screenshot, so its contents were never compared. The first capture with it open immediately showed the panel's presets rendering UNDER the drawer at max window width — `--control-panel-width` was set to the window's current width while the requested resize was clamped by `maxWidth`. `CONFIG.CONTROL_WINDOW_MAX_WIDTH` is now the single source for both the main process's `maxWidth` and the panel's column arithmetic (`min(current, max - drawer)`), measured by `e2e/drawer-layout.spec.js`. Same lesson as the info blocks: add the capture first, then you can see the bug.
- **Design previews**: Always read real HTML structure first, replicate exact layout, then apply CSS-only improvements. Never generate new layouts from scratch.
- **Sounds**: 29 built-in sounds synthesised with oscillators in `sound-bank.js` (`BUILT_IN_PRESETS` + one `switch` branch each). No audio files. `tests/sound-bank.test.js` keeps the list, the `switch` and the `<option>`s in the four sound selects in sync — they cannot drift apart silently.
- **Control panel layout**: Titlebar → Timer (52px) → Start/Pause/Reset → Presets 8×1 → Adjust +/- → Manual time input → Overtime+Windows (merged row) → Tabs always visible (Виджет, Часы, Полноэкранный, Звуки). Settings in 2-column grid.
- **syncClockStyle**: Defaults to **`false`** (`this.syncClockStyle = !!ext.syncClockStyle` in `loadSettings`) — the clock keeps its own style unless the user opts in. When true, clock style follows the widget style dropdown, and the `timerStyleEl` change handler must send both `widget-style-update` AND `clock-widget-set-style`. Changing the clock style directly from the Часы tab turns the sync back off.
- **Widget/clock geometry persistence**: size (Ctrl+wheel) and position (drag) are stored per window in `localStorage` under `widgetGeometry` / `clockGeometry` as `{ scalePct, x, y }`, restored in `restoreGeometry()` on open. The main process clamps a restored position via `positionWindowClamped()` — a saved point can reference a monitor that is no longer attached.
- **Scale pushes must be change-detected**: the control panel re-sends its FULL settings object on every unrelated change (colour, background, blocks). Renderers therefore apply `timerScale`/`timeBlocksScale` only when the value actually differs from the previous push (`_lastPushedTimerScale`), otherwise a colour tweak silently resets a scale the user set with Ctrl+wheel. The same pattern guards `timeLayoutPreset`.
- **Escape is layered**: the drawer, the modals and the global shortcut handler all listen for Esc on `document`. The global handler must bail out via `_isEscapeConsumedByOverlay()` when a nearer layer is open, or one keypress closes both the dialog and every widget window.
- **applyColors must cover all 4 styles**: In widget/clock/display, `applyColors()` must update circle (SVG gradient), digital (LED text + text-shadow), flip (digits + separators), and analog (second hand + center dot). Not just the circle style.
- **Inline colours MUST have a reset branch (CRITICAL)**: the `danger` / `warning` / `overtime` bands write **inline** `style.color` (inline always beats the CSS class), so every band ladder needs a final `else` that puts the colour back. Writing that branch as `else if (this._baseTimerColor)` is a **bug**: `_baseTimerColor` is only set once `applyColors()` runs with a valid colour, which never happens until the user picks a theme — so on a fresh profile the red simply never came off, and the timer stayed red even after a new preset was set. Reset with `this._baseTimerColor || ''` (or `_normalColor()` / `_normalGlow()` in `display-script.js`): the empty string **removes** the inline style and hands control back to CSS. The same rule covers the analog hands / clock centre, which are reset from `_baseSecondHandBg` / `_baseCenterBg` / `_baseAnalogDigitalColor` — those are saved on every `applyColors()` call, including during overtime, precisely so there is something to restore to.
- **Centre the DIGITS, not the whole inscription** (minus sign): you cannot have both — the two centres differ by exactly half the sign's width. The project first centred the digits (sign at `width: 0`), then flipped to centring the whole inscription, and both were wrong for the same reason: they picked the wrong reference. The reference is not the text block, it is the **frame the eye compares against** — the panel's central axis (shared with the status chip and the transport buttons) and, in circle/analog styles, the **centre of the ring**. Measured in overrun with the inscription centred, the digits sat +26px off-axis in the panel, +16px in the widget and **+54px on the fullscreen display**: inside a ring that reads as broken, and on a projector it is the first thing you see. The user reported it as "капец как режет глаза" — that is the ground truth this rule now encodes.
  The mechanism avoids arithmetic in `em`: the container shrinks to its content and is centred (`width: fit-content; margin-inline: auto`), so its left edge coincides with the DIGITS' left edge, and the sign is positioned absolutely from that edge (`right: 100%`) taking no layout width. Applies to `.timer-display-main` (panel), `.time-display` (widget), `.time-text` / `.analog-digital-time` (display).
  **Two details are load-bearing, both found by looking at the result:**
  1. the sign must be **vertically centred on the digits** (`top: 50%; transform: translateY(-50%)`), not anchored to `top: 0` — at a reduced size a top-anchored minus renders as a superscript;
  2. the sign is **smaller than the digits** (`font-size: 0.62em`) with a tight gap (`margin-right: 0.1em`). A full-size minus with a 0.2em gap is a separate blob of ink that drags the composition left — geometrically the digits were centred, and the user still said it did not look centred. Shrinking the sign cut the inscription's offset by ~40% (display: −49px → −30px) while keeping the digits exactly on the ring centre, and the minus still sits **inside** the ring (clearance 42.9px widget / 80.9px display, measured).
  `e2e/overtime-centering.spec.js` asserts all of it: digits within 1.5px of the reference, the inscription NOT centred (proving the sign is out of flow), and the sign inside the ring.
- **The clock's superscript seconds are the opposite case**: they are secondary, so they must NOT take layout width (`width: 0; overflow: visible`, offset via `transform`). Otherwise the whole block centres and the primary `HH:MM` sits 9.5px left of the ring centre — and toggling seconds in settings visibly jumps the time.
- Both rules were settled by measuring in `e2e` (digit centre, inscription centre, gap in `em`), never by eye — eyeballing produced two wrong iterations in a row.
- **Flip animation is shared** (`flip-card.js`): it once existed only on the display while the widget and clock swapped digits instantly. It fires ONLY when the digit actually changed — driving every card each tick turns the effect into flicker. The class is removed on a timer rather than on `animationend`, because switching styles mid-animation means the event never arrives and the card would keep the class forever. `FLIP_DURATION_MS` must match the CSS animation duration in all three windows; a test asserts it.
- **A segmented control's `.value` setter must NOT fire `change` (CRITICAL)**: `_attachSegmented()` makes `div.segmented` impersonate a form control, and it must copy native `<input>`/`<select>` semantics exactly — assignment is silent, only a user click dispatches `change`. When the setter also fired the event, the whole «Синхронизировать со стилем виджета» feature was dead: ticking the box ran `clockStyleEl.value = timerStyleEl.value`, the setter fired `change`, and the `clockStyleEl` handler — whose entire job is "the user picked a clock style, so turn sync off" — unticked the box and persisted `syncClockStyle: false`. `loadSettings()` restoring `clockStyleEl.value` destroyed a saved `true` the same way, so the checkbox could never stay on. This is the same invariant CLAUDE.md already states for sliders from the other side ("assigning `slider.value` does not fire `input`, which is what keeps the loop open"). Covered by `e2e/clock-style-sync.spec.js`.
- **`#clockStyleRow` must be on the real row**: the panel hides that row when style sync is on. The id used to sit on an empty orphan `<div>` inside a `display:none` "removed from UI but needed by JS" block, so nothing was ever hidden and the user saw an active clock-style picker that contradicted the checkbox they had just ticked. If you move the markup, keep the id on the element that actually wraps `#clockStyle`; the e2e test asserts `row.contains(picker)`.
- **Segmented controls are `role="radiogroup"` + `role="radio"` + `aria-checked`, not tabs**: they used to be `role="tablist"` with plain buttons inside — an invalid structure (a tablist must contain `role="tab"`), and the selection lived only in the `.active` CSS class, so assistive tech saw a group of identical unlabelled-state buttons. `_attachSegmented()` now owns both the class and `aria-checked` in one place; they cannot drift.
- **Overtime on the display is painted by `.danger`, never by `.overtime`**: JS always adds the two classes together (`classList.add('danger', 'overtime')` in `updateProgress` / `_enforceOvertimeColors` / `updateDigitalDisplay` / …), so the red `.danger` rules govern and the palette matches the other two windows. `display.html` used to carry a parallel `.overtime` layer from a superseded ORANGE design — five rules on the ring, circle digits, LED, flip and analog. Four were invisible because JS writes red INLINE; the fifth leaked, because `.time-text.overtime` had its `color` overridden but its `--text-glow` did not — red digits with an orange halo. Do not reintroduce orange: it disagrees with the widget, the clock and the status pill. `e2e/overtime-palette.spec.js` measures the computed colour AND glow in two windows.
- **The overtime ring is intentionally invisible**: `calculateProgressValue()` returns a negative ratio past zero and `updateProgress()` clamps it to 0, so `strokeDashoffset === circumference` — a zero-length arc. The widget's circle does the same. Any styling keyed on the ring in overtime (gradients, dash patterns) is therefore unreachable by construction.
- **The analog hour hand must be driven explicitly**: `#analogHandHour` exists in `display.html`, is styled by `.hand-hour` and is looked up in `initElements()` — but for a long time nothing ever assigned its `transform`, so it froze pointing at 12. Timers under an hour looked accidentally right (0 hours *is* 12), which is why it survived; at 1:30:00 the minute hand swept while the hour hand still read 12. `updateAnalogDisplay()` now sets `((absSecs / 3600) % 12) * 30` degrees. Measured at four presets by `e2e/analog-hour-hand.spec.js` — the screenshot suite only ever uses 5-minute presets, so pixels cannot catch this.
- **A capture harness must be deterministic in FOUR ways, and three of them were found the hard way**: frozen animations, real `document.fonts.ready`, **no `:hover`**, and **canonical window sizes**. The last two were added in 2.4.0 after `visual:check` alternated between 0 and 10 regressions on identical code:
  1. the windows are captured in a normal window system, so the real mouse cursor put `:hover` into the frame — a highlighted «+1 ч» button was 2044 px of "regression" in `control-maxsize`, a hovered drawer row 685 px in `control-drawer-clock`, and the run came out clean whenever the cursor happened to rest elsewhere. `FREEZE_ANIMATIONS_CSS` now also sets `pointer-events: none` on everything, which removes hit-testing so `:hover` can never match; programmatic `.click()` in the sequence still works;
  2. the widget and clock **persist their geometry**, and the sequence resizes them repeatedly (min-size sweep, max-size sweep, hour formats, high contrast) — plus the window auto-scales itself on a timer after a style change. So the size a window opened with depended on how the PREVIOUS run ended, and frames differed by SIZE, not content (the diff prints `0 px (100.00%)` — that is the equal-size check failing, not a colour match). Sizes are now set explicitly before the first capture (`CANONICAL_SIZES`) and restored in `finally`, which makes the sequence a fixed point.
  Verify any harness change with **three consecutive** `visual:check` runs at 0 — a single clean run proves nothing here.
- **Captures must wait for `document.fonts.ready`, never a fixed sleep**: every window declares its fonts with `font-display: swap`, so a frame taken before the woff2 lands renders in a fallback face — `display-idle` diffed by 2.43% (22 376 px) and a rerun immediately gave 0. The old blind `sleep(1500)` was not enough under load, which made `visual:check` cry wolf and quietly train you to ignore it. `waitForFonts()` in `scripts/screenshot-runner.js` awaits the real promise per window; three consecutive checks now come back at 0.
- **Any capture containing live wall-clock time MUST go into `isTimeDependent()`**: otherwise the passing second itself counts as a regression and `visual:check` fails forever. Currently excluded: `clock-*` (the whole clock widget) and `display-blocks-*` (the display's «Текущее время» info block). `tests/visual-diff.test.js` pins the list.
- **Info blocks had zero visual coverage until 2026-07-30**: they are off by default, so none of the 36 screenshots contained them — which is exactly why unreadable label contrast (2.15:1 in all eight themes) could never be caught by comparing pictures. `display-blocks-circle` / `display-blocks-analog` are captured LAST in the sequence on purpose: enabling blocks mutates the display's `_lastPreset` and block positions, so doing it earlier would bleed into every previous frame.
- **`visual:check` has a tolerance, so it is not a substitute for measurement**: a pixel counts as changed only when a channel differs by more than 8/255, and images are considered equal below a 0.1% changed-pixel ratio (`visual-diff.js`). That absorbs font antialiasing and glass compositing — and also absorbs small real changes: rotating the analog hour hand by 2.5° touches ~0.03% of the frame and passes cleanly. Use it to prove a refactor changed *nothing*; use a measured e2e assertion to prove a specific value is *right*.
- **The widget's flip separator is DOTS, not a glyph**: in `electron-widget.html` the `:` between digit groups is painted by `::before`/`::after` gradient dots, and the element's own text `:` is suppressed with `font-size: 0`. Anything that sets a font-size on `.widget-flip-separator` brings the glyph back ON TOP of the dots — that is exactly what the `has-hours` adaptive rule did, so every timer ≥ 1 h showed a colon *and* two dots. Scale the dots and the column height for the smaller 44×64 card instead; the font-size must stay 0. The clock and the display use real text separators, so this applies to the widget only. Measured by `e2e/flip-hours-layout.spec.js` (the screenshot suite never covered ≥ 1 h, which is why the defect survived).
- **Colour bands live in ONE place too**: `RendererShared.timerColorBand(remaining, total)` returns `overtime | danger | warning | normal`. Zero is INSIDE the danger band — the old `percentLeft <= 10 && percentLeft > 0` guard pushed exactly 00:00 into the yellow warning band while the status chip next to it went red. Thresholds come from `CONFIG.DANGER_PERCENTAGE` / `WARNING_PERCENTAGE`; they used to be hardcoded as 10/25 in nine places and only the control panel read the config.
- **One element, one colour system**: the display status pill briefly carried both the semantic classes (`running/paused/finished/overtime`) and a second "tone" layer (`is-success/is-attention`) declared lower in the CSS, so the tone layer won the cascade and painted «ВРЕМЯ ВЫШЛО!» green over a red pulse. Never add a parallel colour system to an element that already has one.
- **Status palette is fixed across all three windows**: running green, paused orange, finished red (static), overtime red (pulsing). The pulse is the ONLY thing distinguishing the two red states — do not add an animation to `finished`.
- **Scale is reported back**: windows send `report-scale` when Ctrl+wheel changes their size; main forwards it to the control panel ONLY (broadcasting would echo to the sender and can loop). Assigning `slider.value` does not fire `input`, which is what keeps the loop open.
- **Visual regression**: `npm run visual:baseline` promotes `screenshots/` to `tests/visual-baseline/` (gitignored — 8.6 MB of PNGs would grow the history on every visual change; capture them locally once); `npm run visual:check` re-captures and compares per pixel via `visual-diff.js`, exiting 3 on regression. Animations are frozen during capture (`FREEZE_ANIMATIONS_CSS`) — without that, pulses and the finish flash make captures non-deterministic. `clock-*` shots are excluded: they show the real wall clock.
- **e2e needs `e2e/launch.js`**: it strips the inherited `ELECTRON_RUN_AS_NODE` that otherwise makes `electron.launch()` fail with "bad option: --remote-debugging-port". Playwright also runs with `workers: 1` because the app holds a single-instance lock.
- **Timer status priority lives in ONE place**: `RendererShared.timerLifecycleStatus()` returns `'paused' | 'overtime' | 'finished' | 'running' | 'idle'`. Control, widget and display each map that key to their own wording and CSS class — none of them re-implements the condition. It used to be copy-pasted three times and the copies drifted: the widget painted overtime with the green `running` class, the display checked `finished` first while the other two checked overtime first, and the `isPaused` branch was unreachable whenever `remainingSeconds <= 0` (so pausing during overrun reported "Завершено"). `electron-control.html` must keep its `<script src="renderer-shared.js">` tag or the call throws.
- **`npm run screenshot` is the visual smoke test**: it boots all four windows offscreen and captures into `screenshots/` (gitignored) across five timer states and all four timer styles. The `recovered` state deliberately follows `overtime` — that ordering is what catches stuck inline colours. Do not reorder `STATES` in `scripts/screenshot-runner.js`. Two capture groups run LAST on purpose and must stay there: the display's info blocks (enabling them mutates `_lastPreset` and block positions) and the settings drawer (opening it resizes the control window through `resize-control-window`). The drawer group resets the window to 400×700 first — the preceding max-size sweep would otherwise make the shot show a stretched layout nobody uses.
- **applyColors vs overtime colors (CRITICAL)**: `applyColors()` sets inline `style.color` on digital/flip elements. CSS classes (`danger`, `overtime`) CANNOT override inline styles. Solution: each `updateXxxDisplay()` method must set inline `style.color = '#ff4444'` when overtime/danger, and restore base color otherwise. Display uses `_enforceOvertimeColors()` called every tick. Widget stores `_baseTimerColor` in applyColors and overrides in updateDisplay.
- **Time format with hours**: All display styles (digital, flip, analog-digital) must handle hours when `absSecs >= 3600`. Use `H:MM:SS` format. Display flip has hidden `flipHoursUnit`/`flipHoursSep` elements shown dynamically. Widget flip already had hours support.
- **Display settings `showCurrentTime`**: Controls visibility of the "Текущее время" block on fullscreen display. Defaults to `true`. Sent via `display-settings-update` channel alongside `showTimeBlocks`.
- **No external shadows on transparent windows**: Widget and clock windows have `transparent: true` + `hasShadow: false`. Never use `drop-shadow`, `box-shadow` (external), or `filter: shadow` on elements — they create visible dark rectangles. Use only `inset` shadows or `border` for depth.
- **Design system v2**: All windows use VisionOS glassmorphism — `blur(40px) saturate(180%)`, gradient ring `#0a84ff→#30d158`, Inter Light (weight 200) for timer text. Widget/clock: NO external shadows (transparent windows). Digital LED uses JetBrains Mono. **Fonts are LOCAL** — `fonts/*.woff2` declared with `@font-face` in every window (Google Fonts `@import` would be blocked by the CSP `font-src 'self' data:` anyway, and would make the app depend on the network). `tests/release-gates.test.js` fails the build if a font source stops starting with `fonts/`. Apple semantic colors: systemBlue `#0a84ff`, systemGreen `#30d158`, systemRed `#ff453a`, systemOrange `#ff9f0a`.
- **Two UI themes, `data-theme` on `<html>`**: `dark` (default) and `hc-dark` (high contrast). `ui-theme.js` is the ONLY owner of that attribute — it reads/writes `uiTheme` in localStorage, applies the attribute, and every window calls `initTheme()` from a `<head>` script so the theme lands before the first frame (in `<body>` it would flash dark first). The panel's titlebar button (`#contrastToggle`, `aria-pressed`) switches it and broadcasts `ui-theme-update`; main relays to all four windows. A third theme (`light`) used to exist and was unreachable — see Gotchas.
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
