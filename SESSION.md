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
