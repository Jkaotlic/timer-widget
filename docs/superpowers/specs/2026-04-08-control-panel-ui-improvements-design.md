# Control Panel UI Improvements — Design Spec

**Date**: 2026-04-08
**Scope**: 4 independent features in `electron-control.html` + `electron-main.js`

---

## 1. Adaptive Window Height per Tab

**Problem**: Tabs "Виджет" and "Часы" have excess whitespace below settings. "Полноэкранный" and "Звуки" fill the space properly.

**Solution**: Window resizes when switching tabs to match content height.

**Implementation**:
- Each tab calculates its content height after becoming active.
- Send `resize-control-window` IPC with `{ width: 700, height: calculatedHeight }`.
- `calculatedHeight` = fixed top section (~520px: titlebar + timer + buttons + presets + adjust + time input + toggle row + tabs) + tab content height + padding.
- Smooth transition: use `setBounds()` with `animate: true` on macOS, instant on Windows/Linux (animation not supported).
- Min height: 650px (prevents collapsing too small). Max height: 1000px (existing constraint).
- Trigger: tab click handler, after content is rendered.
- Also trigger on window load (initial tab).

**Affected files**: `electron-control.html` (tab switch logic), `electron-main.js` (resize handler already exists).

---

## 2. Color Picker with Preset Swatches

**Problem**: Only preset color circles, no way to pick arbitrary colors.

**Solution**: Each tab (Виджет, Часы, Полноэкранный) gets its own independent color picker instance.

**UI Layout**:
```
[preset circles ● ● ● ● ● ● ● ● ●]  [🎨]   ← gradient button to toggle picker
[                                           ]
[  ┌─────────────────────┐  Hue ═══════╗  ]   ← picker panel (collapsible)
[  │  SV square (canvas)  │  ║ hex: #ff0 ║  ]
[  │  180×120px           │  ╚══════════╝  ]
[  └─────────────────────┘                  ]
```

**Components per picker instance**:
- **SV canvas** (180×120px): saturation (X) × value/brightness (Y). Drawn via Canvas 2D.
- **Hue slider** (horizontal, below or right of SV canvas): 0-360 degrees.
- **Hex input** field: shows current color, editable, validates on Enter/blur.
- **State**: `{ h, s, v, hex }` — independent per tab.

**Behavior**:
- Clicking gradient button toggles picker visibility (slide down/up).
- Mouse drag on SV canvas and hue slider updates color in real-time.
- Color applies immediately via existing `applyWidgetColor()` / `applyClockColor()` / `applyDisplayColor()` functions.
- Picking a color via the picker does NOT highlight any preset circle (it's a custom color).
- Clicking a preset circle still works — it closes the picker and applies the preset.
- Color persists in localStorage alongside existing color settings.

**Implementation**: Pure Canvas + CSS, no external libraries. HSV↔RGB↔Hex conversion functions (small utility, ~30 lines).

**Three independent instances**:
- Widget tab: `widgetColorPicker` → sends `widget-colors-update`
- Clock tab: `clockColorPicker` → sends `clock-colors-update`
- Display tab: `displayColorPicker` → sends `display-colors-update`

Each tracks which color is being edited (timer color vs progress color). The picker opens for the "timer color" by default.

**Affected files**: `electron-control.html` (HTML + CSS + JS for picker).

---

## 3. Scale Bar Manual Input + Double-Click Reset

**Problem**: Scale percentage (e.g., "100%") is read-only. No way to type exact value or quickly reset.

**Current UI**: `[slider ═══════] 100%`

**New behavior**:
- **Single click** on "100%" text → transforms into `<input type="number">` with current value. Enter/blur applies. Escape cancels. Validates within min-max range (30-600% depending on context).
- **Double click** on "100%" text → immediately resets to 100% (no input mode). Applies the reset.
- After applying, input transforms back to text span.

**Applies to all scale bars**:
- Widget tab: widget scale (30-600%)
- Clock tab: clock scale (30-600%)
- Display tab: timer scale (30-300%), block scale (50-600%)

**Implementation**: Wrap the percentage text in a `<span>` with click/dblclick handlers. On click, replace with `<input>`. On dblclick, reset to 100 and send IPC.

**Affected files**: `electron-control.html` (all scale bar sections).

---

## 4. Manual Timer Time Input

**Problem**: No way to type arbitrary timer duration. Only presets (5-60 min) and adjust buttons.

**UI placement**: Between adjust buttons row (-1ч..+1ч) and "Считать ниже нуля" toggle. Single input field with placeholder `0:00` and a "✓" button.

**Layout**:
```
[-1ч] [-5м] [-1м]  [+1м] [+5м] [+1ч]
         [ 0:00         ✓ ]            ← new input
◷ Считать ниже нуля [toggle]  ...
```

**Smart parsing**:
| Input | Parsed as | Seconds |
|-------|-----------|---------|
| `90` | 90 seconds | 90 |
| `5:30` | 5 min 30 sec | 330 |
| `1:30:00` | 1h 30m 0s | 5400 |
| `1:30` | 1 min 30 sec | 90 |
| `90:00` | 90 min 0 sec | 5400 |

**Rules**: 
- Bare number → seconds.
- `X:Y` → minutes:seconds.
- `X:Y:Z` → hours:minutes:seconds.
- Enter or click "✓" → apply via `timer-command` IPC with `{ type: 'set', seconds: N }`.
- Field clears after applying (placeholder returns).
- Validation: reject non-numeric, reject negative, max 99:59:59 (359999 seconds).

**Affected files**: `electron-control.html` (HTML for input + JS for parsing and sending).

---

## Non-Goals

- No color picker for the "Фон" section of display tab (that already has its own controls).
- No animated window height transitions on Windows/Linux (not supported by Electron).
- No gradient colors (multi-stop) for timer/progress — just solid arbitrary colors via picker.
- No auto-resize within a tab when sections expand/collapse.

## Testing

- Existing 70 unit tests remain passing.
- `parseTime` in `utils.js` already handles `HH:MM:SS` / `MM:SS` / `SS` — reuse for smart input parsing.
- Color conversion (HSV↔RGB↔Hex) — add unit tests for edge cases.
