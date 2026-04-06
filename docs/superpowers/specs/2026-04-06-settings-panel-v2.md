# Settings Panel Redesign v2 — Spacious Layout

## Summary

Widen the control panel from ~320px to 700px, reorganize settings into 2-column grids, merge overtime toggle + window buttons into one row. Target: all 4 tabs fit without scrolling at 760px height.

## Approved Design

Variant **B — Spacious 700×760**. Mockup: `.superpowers/brainstorm/1518-1775466547/content/design-v2.html`

## Visual Design System

- **Font**: Inter (200/400/500/600), system fallback
- **Background**: `linear-gradient(175deg, rgba(28,28,45,0.95), rgba(12,12,22,0.98))`
- **Glass effect**: `backdrop-filter: blur(40px) saturate(180%)`
- **Glass border**: `rgba(255,255,255,0.07)`, hover `rgba(255,255,255,0.12)`
- **Card bg**: `rgba(255,255,255,0.035)`
- **Accent green**: `#30d158` (buttons, active states)
- **Accent blue**: `#0a84ff` (sliders, dropdowns, secondary)
- **Accent orange**: `rgba(255,149,10,0.2)` (pause button)
- **Text**: primary `#f0f0f5`, secondary `#8e8e9a`, muted `#55556a`
- **Border radius**: sm 8px, md 12px, lg 16px
- **Transitions**: 200ms cubic-bezier(0.4, 0, 0.2, 1)

## Layout Structure (700px wide, top to bottom)

1. **Titlebar** — traffic lights + "Timer Widget" + help button (~36px)
2. **Timer display** — 52px weight-200 digits + status label (~76px)
3. **Controls** — pause/play/reset circles (~56px)
4. **Presets** — 8 buttons in 1 row, grid 8-col (~38px)
5. **Adjust** — −1ч −5м −1м | +1м +5м +1ч pills (~32px)
6. **Overtime + Window buttons** — merged in one row (~42px)
   - Left: overtime bar with toggle
   - Right: 3 compact chips (⏱ Виджет, 🕐 Часы, 🖥 Экран)
7. **Tab bar** — 4 tabs in segmented control (~38px)
8. **Settings area** — 2-column grid, varies by tab (~remaining space)

**Total top section**: ~318px. **Available for settings**: ~442px.

## Tab Contents (2-column grid)

### Виджет (~130px)
- Left card: Стиль таймера (dropdown) + Масштаб (slider)
- Right card: Цвета виджета (8 gradient dots)

### Часы (~160px)
- Left card: Стиль (dropdown) + Масштаб (slider)
- Right card: Цвета часов (8 dots) + Показывать дату (toggle)

### Полноэкранный (~200px)
- Left card: Стиль (dropdown) + Масштаб (slider) + Монитор (dropdown) + Блоки времени (toggle)
- Right card: Цвета таймера (8 dots) + Фон дисплея (4 mode tabs + color picker)

### Звуки (~250px)
- Master toggle: Звуковые уведомления (full-width)
- Events card (full-width): 4 events (checkbox + label + dropdown + play button)
- Overrun interval row inside events card
- Upload area (full-width): dashed border, upload button

## Changes Required

### electron-main.js
- Change control window width: 320 → 700
- Change control window minWidth: 320 → 600
- Adjust height to 760, minHeight 700

### electron-control.html
- CSS: body/container width to 100% (fills window)
- Presets: change from 4×2 grid to 8×1 row
- Overtime + window buttons: merge into flex row
- Settings sections: wrap in CSS grid 2-col
- Tab content: each tab uses `display: grid; grid-template-columns: 1fr 1fr; gap: 8px`
- Sounds tab: events use full-width card, upload area below
- Window button style: change from tall cards to compact horizontal chips

### No changes needed
- preload.js, channel-validator.js — no new IPC channels
- Widget/clock/display HTML — unaffected
- All JS logic stays the same — CSS-only changes + minor HTML restructure
