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

1. **Control Window** (`electron-control.html`) — main management panel with 4 settings tabs (Виджет, Часы, Полноэкранный, Звуки). ~6000 lines, all inline HTML/CSS/JS. Settings in 2-column grid layout, 700×860px (min 650h, max 1000h). All tabs use 2-column grid including Звуки. Tab content is scrollable (`max-height: calc(100vh - 500px)`). Window auto-resizes per active tab via `autoResizeWindow()`.
2. **Widget Window** (`electron-widget.html`) — transparent, frameless, always-on-top mini-timer. 4 styles: circle, digital, flip, analog. Glassmorphism design.
3. **Display Window** (`display.html` + `display-script.js`) — fullscreen timer for presentations. 4 styles: circle, digital, flip, analog. Has a `DisplayTimer` class.
4. **Clock Widget** (`electron-clock-widget.html`) — independent clock widget. 4 styles: circle, digital, flip, analog. Glassmorphism design.

### IPC Communication

- `preload.js` exposes `window.electronAPI` with a channel whitelist (`ALLOWED_CHANNELS`). Context isolation and sandbox are enabled on all windows.
- `ipc-compat.js` provides backward compatibility mapping old `ipcRenderer` calls to the new `electronAPI`.
- Control window sends commands (`timer-command`, `widget-colors-update`, `display-settings-update`); main process broadcasts state (`timer-state`) to all windows every second.
- Per-window color channels: `widget-colors-update`, `clock-colors-update`, `display-colors-update` — each window gets only its own colors (no global broadcast).
- Timer state uses a monotonic `updateCounter` (not timestamps) for reliable sync.

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

70 tests using Node.js built-in test runner (`node --test`). Test files in `tests/`:

| File | Covers |
|------|--------|
| `time-utils.test.js` | `formatTime`, `formatTimeShort`, `parseTime` |
| `security.test.js` | `isValidDataURL`, `isValidURL`, `validateImageSource`, `safeJSONParse`, `escapeHTML` |
| `security-extended.test.js` | `safeSetBackgroundImage` |
| `status-progress.test.js` | `getTimerStatus`, `calculateProgress` |
| `validation-utils.test.js` | `isValidNumber`, `clamp` |
| `debounce-send.test.js` | `debounce`, `safelySendToWindow` |
| `channel-validator.test.js` | `isValidChannel`, `ALLOWED_CHANNELS` |
| `edge-cases.test.js` | Edge cases for all utils |
| `constants.test.js` | CONFIG immutability and structure |

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
- **syncClockStyle**: Defaults to `true` (hidden checkbox). When true, clock style follows widget style dropdown. The widget `timerStyleEl` change handler must send both `widget-style-update` AND `clock-widget-set-style`.
- **applyColors must cover all 4 styles**: In widget/clock/display, `applyColors()` must update circle (SVG gradient), digital (LED text + text-shadow), flip (digits + separators), and analog (second hand + center dot). Not just the circle style.
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
