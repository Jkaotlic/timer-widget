# Control Panel Redesign — Apple Glassmorphism + Per-Window Settings

## Summary

Complete redesign of the control panel (electron-control.html):
- Apple dark glassmorphism visual style
- 4 tabs: Виджет, Часы, Полноэкранный, Звуки
- Independent colors and styles per window
- "Считать ниже нуля" on main screen
- Rename "Дисплей" → "Полноэкранный" everywhere

## Visual Design

Reference mockup: `.superpowers/brainstorm/2051-1775289425/content/apple-style-v1.html`

Key visual changes:
- Dark background with backdrop-blur glassmorphism panels
- Inter / system font, thin weight timer display (200)
- macOS-style traffic light buttons (close/minimize/maximize)
- Apple system green (#30d158) for start, blue (#0a84ff) for accents
- Apple-style toggles (green when on)
- Circular theme dots with border, not square
- Monochrome + single accent color palette

## Layout Structure (top to bottom)

1. **Titlebar** — traffic lights + "Timer Widget"
2. **Timer display** — large thin "05:00" + status label
3. **Controls** — pause / start / reset circles
4. **Presets** — 4x2 grid pills (5, 10, 15, 20, 25, 30, 45, 60 min)
5. **Adjust** — symmetric bar: −1ч −5м −1м | +1м +5м +1ч
6. **Overtime toggle** — "Считать ниже нуля" inline pill with toggle
7. **Window buttons** — 3 buttons: Виджет, Часы, Полноэкранный (NO sound)
8. **Settings toggle** — "Настройки ▾"
9. **4 Tabs** — Виджет | Часы | Полноэкранный | Звуки

## Tab Contents

### Виджет
- Стиль виджета: style dropdown + scale slider
- Цвета виджета: 10 gradient dots
- (affects: widget window + control window header)

### Часы
- Стиль часов: style dropdown + analog numbers toggle
- Цвета часов: 10 gradient dots
- Отображение: show date toggle

### Полноэкранный
- Стиль таймера: style dropdown + scale slider
- Цвета таймера: 10 gradient dots
- Монитор: display selector
- Блоки времени: show toggle + layout + scale
- Фон: solid/gradient/URL/file + overlay

### Звуки
- Основное: master toggle
- События: 4 sound events with presets + overrun interval
- Ваши звуки: custom upload

## Architecture Changes

### New IPC Channels (send: renderer→main)
- `widget-colors-update` — `{ timer: '#hex', progress: '#hex' }`
- `clock-colors-update` — `{ timer: '#hex', progress: '#hex' }`
- `display-colors-update` — `{ timer: '#hex', progress: '#hex' }`
- `widget-style-update` — `{ timerStyle: 'circle'|'digital'|'flip'|'analog' }`

### New IPC Channels (receive: main→renderer)
- `widget-colors-update` — forwarded to widget only
- `clock-colors-update` — forwarded to clock only
- `display-colors-update` — forwarded to display only

### Deprecated
- `colors-update` (global) — replaced by per-window channels

### Storage Keys (new)
- `widgetColors` — `{ timer, progress }`
- `clockColors` — `{ timer, progress }`
- `displayColors` — `{ timer, progress }`
- `widgetStyle` — string
- (clockStyle, displayStyle already exist or inferred from displaySettings)

### Main Process Changes (electron-main.js)
- Store `lastWidgetColors`, `lastClockColors`, `lastDisplayColors`
- On `widget-colors-update`: save + forward to widgetWindow + controlWindow
- On `clock-colors-update`: save + forward to clockWidgetWindow
- On `display-colors-update`: save + forward to displayWindow
- On window open: send saved per-window colors
- Keep backward compat: old `colors-update` maps to all three

### Renderer Changes
- `electron-widget.html`: listen to `widget-colors-update` (+ `colors-update` fallback)
- `electron-clock-widget.html`: listen to `clock-colors-update`
- `display-script.js`: listen to `display-colors-update` (+ `colors-update` fallback)

## Files Changed

| File | Change |
|------|--------|
| `electron-control.html` | Complete UI rewrite (CSS + HTML + JS tab logic) |
| `electron-main.js` | Per-window color/style IPC handlers |
| `preload.js` | Add new channels to whitelist |
| `channel-validator.js` | Add new channels |
| `constants.js` | New STORAGE_KEYS + IPC_CHANNELS |
| `electron-widget.html` | Listen to `widget-colors-update` |
| `electron-clock-widget.html` | Listen to `clock-colors-update` |
| `display-script.js` | Listen to `display-colors-update` |
| `tests/channel-validator.test.js` | Updated channel count |
| `CLAUDE.md` | Update IPC docs |
