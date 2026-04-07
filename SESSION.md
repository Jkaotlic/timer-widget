# Session Notes — Apr 5, 2026

## What was done

### Apple Glassmorphism Redesign — COMPLETE
- Full CSS rewrite of control panel, widget, clock, display
- 4 tabs: Виджет, Часы, Полноэкранный, Звуки (always visible, no dropdown)
- Control window auto-resizes to content height
- All widget/clock styles use glassmorphism: `rgba` backgrounds + `backdrop-filter: blur(20px)`

### Critical Bugs Fixed
1. **Widget completely dead** — `const safeJSONParse` re-declaration in inline script conflicted with `function safeJSONParse` from security.js → SyntaxError killed entire script block. Removed the `const`.
2. **Widget style/scale not received** — `widget-style-update` missing from preload.js receive whitelist. Added to both preload.js and channel-validator.js.
3. **Widget colors changing Display** — `saveColors()` sent global `colors-update` broadcast. Removed, kept only per-window channels.
4. **Widget scale from settings broken** — sent bare number, main expects `{ width, height }`. Fixed.
5. **Clock style not switching** — `syncClockStyle` defaults `true`, but widget style change didn't send `clock-widget-set-style`. Fixed.
6. **Clock scale cumulative error** — delta-based `clock-widget-scale` accumulated on drag. Changed to absolute `clock-widget-resize`.
7. **Colors only worked in circle style** — `applyColors()` in widget/clock/display only updated circle SVG. Expanded to all 4 styles (digital LED, flip digits, analog hands).
8. **Shadow artifacts on transparent windows** — `drop-shadow`/`box-shadow` created dark rectangles. Removed, applied glassmorphism.
9. **display-settings-update leaking to widget** — removed widget from broadcast in main.js.

### Per-window Settings — COMPLETE
- Widget: `widget-style-update`, `widget-colors-update`
- Clock: `clock-widget-set-style`, `clock-colors-update`, `clock-widget-resize`
- Display: `display-settings-update`, `display-colors-update`
- `syncClockStyle` (default true) syncs clock style with widget dropdown

### Sound Presets Expanded
- 7 new synthesized sounds (chime, pulse, rising, drop, notification, countdown, complete)
- Total ~20 built-in via Web Audio API

## Known Remaining Items
- `syncClockStyle` checkbox is `display:none` — user can't toggle it from UI (always true)
- Legacy `colors-update` channel still listened for backward compat
- `preview-mockup.html` and `preview-screenshot.png` are untracked (not committed)

## Key Commits
- `4ae3414` — this session's fixes (per-window isolation, color sync, glassmorphism)
- `efa5faa` — widget style fallback + debug cleanup
- `602ba6e` — UI polish (titlebar, buttons, per-window wiring)
- `81ae146` — original glassmorphism redesign
- `5283824` — security audit

## Apr 6, 2026 — Settings Panel Redesign v2

### What was done
- Widened control panel: 320px → 700px (min 600, max 800)
- Presets: 4×2 → 8×1 single row
- Overtime toggle + window buttons merged into one row
- All settings tabs use 2-column grid layout
- Sounds tab stays single-column (full-width events)
- Window height: 760px, all tabs fit without scrolling

### Design
- Variant B "Spacious 700×760" approved
- Mockup: `.superpowers/brainstorm/1518-1775466547/content/design-v2.html`
- Spec: `docs/superpowers/specs/2026-04-06-settings-panel-v2.md`

## Apr 6, 2026 — Design Improvements v2 (Glassmorphism Polish)

### What was done
- All windows: blur(20px) → blur(40px) saturate(180%) (VisionOS standard)
- Timer font: SF Mono Bold → Inter Light (weight 200)
- Digital LED: Courier New → JetBrains Mono
- Progress ring: solid color → gradient #0a84ff → #30d158 (Apple Activity Rings style)
- Widget/Clock: removed all external shadows (transparent window safe)
- Border radius: 8px → 24px on window frames
- Transitions: 0.3s → 0.2s ease-out
- Settings panel: inset shadow instead of external box-shadow
- Apple semantic color palette standardized across all windows
- Google Fonts @import added to widget, clock, display

### Design
- Mockup: `.superpowers/brainstorm/1913-1775470678/content/design-improvements.html`
- Spec: `docs/superpowers/specs/2026-04-06-design-improvements-v2.md`
- Figma: https://www.figma.com/design/ojj21B75qClGUlDgqAUFIU (control panel, Starter limit)

## Apr 6, 2026 — Overtime Visuals + UI Polish

### Overtime red color + pulse across ALL styles
- **Root cause**: `applyColors()` sets inline `style.color` which overrides CSS classes (`danger`, `overtime`)
- **Fix**: Each `updateXxxDisplay()` now sets inline red color when overtime/danger
- Display: added `_enforceOvertimeColors()` called every tick to guarantee red stays
- Pulse animations: added for digital (glow pulse), flip (box-shadow pulse), analog (center + hands pulse)
- Widget + Display: all 4 styles (circle, digital, flip, analog) now show red + pulse in overtime

### Time format with hours
- Analog digital, Digital LED, Flip: all now show `H:MM:SS` when timer >= 1 hour
- Display flip: added hours card group (`flipHoursUnit`, `flipHoursSep`, `flipHr1`, `flipHr2`)
- Display digital: added hours group (`digitalHoursGroup`, `digitalHours`)

### Control panel improvements
- Window height: 760→860 (min 760, max 1000)
- Tab icons + settings-group-title icons: brighter (filter: brightness(1.3), color 0.35→0.5)
- Sound tab: switched from single-column to 2-column grid (left: Основное+События, right: Ваши звуки)
- All tab content: scrollable with `max-height: calc(100vh - 520px)`
- "Текущее время" toggle added to Полноэкранный settings (controls `currentTimeBlock` visibility)
- "Начало"/"Конец" time inputs moved from hidden to visible in Блоки времени section

### Clock widget
- Flip + digital: seconds now enabled by default (was only circle/analog)

### Status color consistency
- `#38ef7d` → `#30d158` in display.html status pills
- `rgba(56, 239, 125` → `rgba(48, 209, 88` across widget/display
- Google Fonts @import added to electron-control.html

## Apr 7, 2026 — Scale Bar Feature + Display Controls

### Scale Bar Feature (Widget + Clock)
- Removed `-webkit-app-region: drag` from widget and clock windows
- Implemented JS-based window dragging via IPC (`widget-move`, `clock-widget-move`)
- Added Ctrl+slider scale bar (30-600%) to both widget and clock windows
- Removed resize handles and border UI from widgets
- Removed Ctrl+wheel zoom (unreliable)

### Fullscreen Display Controls
- Added dual Ctrl+slider: "Таймер" (30-300%) and "Блоки" (50-600%)
- Added Alt+drag for repositioning info blocks freely on screen
- Positions and scale persist to localStorage
- Preset changes from control panel clear custom positions

### Clock Widget Font Scaling
- Circle style: time font increased from 14vw to 20vw for larger display at max scale
- Flip style: reduced base dimensions for higher scale factor
- Date/timezone badges: increased vw/vh percentages

### Shadow Cleanup
- Removed all external box-shadow and drop-shadow from widget and clock windows
- Converted to inset shadows or borders where needed (26 fixes total)

### UI Fixes
- Fixed themes-grid overflow in control panel (repeat(10) → auto-fill)
- Added min-width:0 and overflow:hidden to settings-group
- Fixed display settings resetting block positions on color/date changes

### FAQ Update
- Updated keyboard shortcuts section (removed Ctrl+wheel, added Ctrl slider and Alt+drag)
- Updated window descriptions with new scaling features
- Added persistence tips
- Added one-time hint tooltip on fullscreen display

### Global Keyboard Shortcuts
- Added Space/R/1-8/W/C/D shortcuts to widget, clock, and display windows
- Start sound now plays from any window (control detects remote start via timer-state transition)
- Window state broadcast to ALL windows via `broadcastWindowState()` (not just control)
- Monitor selection remembered in main process (`lastDisplayIndex`) for D key from any window

### Clock Color Bug Fix
- `applyColors()` now updates date-badge and timezone-badge color in all 4 styles

### Project Cleanup
- Added screenshots/, *.png, .superpowers/ to .gitignore
