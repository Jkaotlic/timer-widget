# Settings Panel Redesign v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen control panel from 320→700px, reorganize into 2-column grid layout, merge overtime+window buttons row. All 4 tabs fit without scrolling at 760px.

**Architecture:** CSS-only changes + minor HTML restructure in electron-control.html. Window size update in electron-main.js. No new IPC channels, no JS logic changes.

**Tech Stack:** Vanilla CSS (inline in HTML), Electron BrowserWindow config

**Spec:** `docs/superpowers/specs/2026-04-06-settings-panel-v2.md`
**Mockup:** `.superpowers/brainstorm/1518-1775466547/content/design-v2.html`

---

### Task 1: Update window size constraints in electron-main.js

**Files:**
- Modify: `electron-main.js:211-220` (window size calc + BrowserWindow options)
- Modify: `electron-main.js:484-487` (resize handler defaults/constraints)

- [ ] **Step 1: Update dynamic size calculation (line 211-212)**

Replace:
```js
const windowWidth = Math.min(440, Math.max(360, screenWidth - 100));
const windowHeight = Math.min(720, Math.max(560, screenHeight - 100));
```
With:
```js
const windowWidth = Math.min(700, Math.max(600, screenWidth - 100));
const windowHeight = Math.min(760, Math.max(700, screenHeight - 100));
```

- [ ] **Step 2: Update BrowserWindow min/max constraints (lines 217-220)**

Replace:
```js
minWidth: 360,  // Wider for better layout
minHeight: 560, // Increased to fit all content
maxWidth: 520,  // Prevent too wide on large screens
maxHeight: 920, // Increased for larger screens
```
With:
```js
minWidth: 600,
minHeight: 700,
maxWidth: 800,
maxHeight: 920,
```

- [ ] **Step 3: Update resize handler defaults and constraints (lines 484-487)**

Replace:
```js
const w = Number.isFinite(size.width) ? size.width : 420;
const h = Number.isFinite(size.height) ? size.height : 400;
const targetWidth = Math.max(360, Math.min(w, screenWidth - 50));
const targetHeight = Math.max(300, Math.min(h, screenHeight - 50));
```
With:
```js
const w = Number.isFinite(size.width) ? size.width : 700;
const h = Number.isFinite(size.height) ? size.height : 760;
const targetWidth = Math.max(600, Math.min(w, screenWidth - 50));
const targetHeight = Math.max(700, Math.min(h, screenHeight - 50));
```

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS (no new lint errors)

- [ ] **Step 5: Commit**

```bash
git add electron-main.js
git commit -m "feat: widen control window to 700x760 with updated constraints"
```

---

### Task 2: Presets — change from flex-wrap 4-per-row to 8-column grid

**Files:**
- Modify: `electron-control.html:1227-1232` (`.quick-presets` CSS)
- Modify: `electron-control.html:1380-1384` (`.quick-preset` flex override)

- [ ] **Step 1: Replace `.quick-presets` flex layout with 8-col grid (line 1227-1232)**

Replace:
```css
.quick-presets {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
}
```
With:
```css
.quick-presets {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 6px;
}
```

- [ ] **Step 2: Remove the flex override on `.quick-preset` (lines 1380-1384)**

Replace:
```css
/* Presets: equal-width 4-per-row grid */
.quick-preset {
    flex: 1 1 calc(25% - 6px);
    min-width: 0;
}
```
With:
```css
/* Presets: full-width single row */
.quick-preset {
    min-width: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add electron-control.html
git commit -m "feat: presets to single-row 8-column grid"
```

---

### Task 3: Merge overtime toggle + window buttons into one row

**Files:**
- Modify: `electron-control.html:2220-2238` (HTML structure)
- Modify: `electron-control.html:1322-1378` (CSS for `.quick-windows`, `.quick-window-btn`)

- [ ] **Step 1: Replace the overtime + window buttons HTML (lines 2220-2238)**

Replace:
```html
<!-- Считать ниже нуля — глобальная настройка -->
<div class="compact-section">
    <div class="overtime-toggle-row">
        <span class="toggle-label">⏱ Считать ниже нуля</span>
        <label class="toggle-switch" title="Таймер продолжит отсчёт в минус после окончания">
            <input type="checkbox" id="allowNegative">
            <span class="toggle-slider"></span>
        </label>
    </div>
</div>

<!-- Открыть окна -->
<div class="compact-section">
    <div class="quick-windows">
        <button class="quick-window-btn widget" id="openWidgetBtn" title="Компактный таймер поверх окон (W)"><span class="qw-icon">⏱</span><span class="qw-label">Виджет</span></button>
        <button class="quick-window-btn clock" id="openClockBtn" title="Часы в реальном времени (C)"><span class="qw-icon">🕐</span><span class="qw-label">Часы</span></button>
        <button class="quick-window-btn display" id="openDisplayBtn" title="Полноэкранный режим для презентаций (D)"><span class="qw-icon">🖥</span><span class="qw-label">Полноэкранный</span></button>
    </div>
</div>
```
With:
```html
<!-- Overtime + Window buttons — merged row -->
<div class="compact-section">
    <div class="overtime-windows-row">
        <div class="overtime-toggle-row">
            <span class="toggle-label">⏱ Считать ниже нуля</span>
            <label class="toggle-switch" title="Таймер продолжит отсчёт в минус после окончания">
                <input type="checkbox" id="allowNegative">
                <span class="toggle-slider"></span>
            </label>
        </div>
        <div class="quick-windows">
            <button class="quick-window-btn widget" id="openWidgetBtn" title="Компактный таймер поверх окон (W)"><span class="qw-icon">⏱</span><span class="qw-label">Виджет</span></button>
            <button class="quick-window-btn clock" id="openClockBtn" title="Часы в реальном времени (C)"><span class="qw-icon">🕐</span><span class="qw-label">Часы</span></button>
            <button class="quick-window-btn display" id="openDisplayBtn" title="Полноэкранный режим для презентаций (D)"><span class="qw-icon">🖥</span><span class="qw-label">Полноэкранный</span></button>
        </div>
    </div>
</div>
```

- [ ] **Step 2: Add CSS for the merged row and update window button styles**

Add after `.overtime-toggle-row .toggle-label` block (after line ~1320):
```css
.overtime-windows-row {
    display: flex;
    gap: 8px;
    align-items: center;
}

.overtime-windows-row .overtime-toggle-row {
    flex: 1;
}
```

Replace `.quick-windows` CSS (lines 1322-1326):
```css
.quick-windows {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
}
```
With:
```css
.quick-windows {
    display: flex;
    gap: 6px;
}
```

Replace `.quick-window-btn` CSS (lines 1328-1343):
```css
.quick-window-btn {
    padding: 12px 4px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
    white-space: nowrap;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
}
```
With:
```css
.quick-window-btn {
    padding: 7px 12px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 5px;
    transition: all 0.2s;
    white-space: nowrap;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.6);
}
```

Replace `.quick-window-btn .qw-icon` (lines 1346-1349):
```css
.quick-window-btn .qw-icon {
    font-size: 20px;
    line-height: 1;
}
```
With:
```css
.quick-window-btn .qw-icon {
    font-size: 14px;
    line-height: 1;
}
```

- [ ] **Step 3: Commit**

```bash
git add electron-control.html
git commit -m "feat: merge overtime + window buttons into single row"
```

---

### Task 4: Settings tabs — 2-column grid layout for all tab contents

**Files:**
- Modify: `electron-control.html` — CSS for `.tab-content` and `.settings-group`
- Modify: `electron-control.html` — HTML for tab-timer, tab-clock, tab-display (wrap settings-groups in grid)

- [ ] **Step 1: Add 2-column grid CSS for tab content**

Find the `.tab-content` CSS (around line 387-396) and add after it:
```css
.tab-content.active {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.tab-content .settings-group {
    margin: 0;
}

/* Sound tab uses single column (full-width items) */
#tab-sound.active {
    display: block;
}
```

- [ ] **Step 2: Verify tab-timer already has exactly 2 settings-groups (lines 2265-2296)**

`tab-timer` already has 2 `.settings-group` children (style + colors). They will auto-flow into the 2-col grid. No HTML change needed.

- [ ] **Step 3: Verify tab-clock has the right structure (lines 2448-2506)**

`tab-clock` has multiple `.settings-group` children. Wrap the style+scale group and the color+date group so they flow into 2 columns. If there are 3 groups, the third will span a new row — acceptable for the Часы tab with "Отображение" section.

- [ ] **Step 4: Verify tab-display structure (lines 2509-2627)**

`tab-display` has multiple `.settings-group` children. The left column should contain style/scale/monitor/blocks and the right column should contain colors/background. If the HTML already has exactly 2 groups, it works. If it has more, wrap related groups in container divs:

Add wrapper divs inside `#tab-display`:
```html
<div class="settings-column">
    <!-- settings-group for style, scale, monitor, time blocks -->
</div>
<div class="settings-column">
    <!-- settings-group for colors and background -->
</div>
```

Add CSS:
```css
.settings-column {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
```

- [ ] **Step 5: Run the app and visually verify all 4 tabs**

Run: `npm start`
Check: All 4 tabs display correctly in 2-column layout. Sounds tab stays single-column. No overflow or scrolling needed.

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add electron-control.html
git commit -m "feat: 2-column grid layout for all settings tabs"
```

---

### Task 5: Visual polish and final verification

**Files:**
- Modify: `electron-control.html` — minor CSS adjustments

- [ ] **Step 1: Remove the responsive media query that forces 3-col presets (around line 1212)**

Find and remove or update:
```css
@media (max-width: 500px) {
    ...
    .themes-grid {
        grid-template-columns: repeat(7, 1fr);
    }
}
```
Since minWidth is now 600px, `max-width: 500px` will never trigger. Remove or change to `max-width: 650px` for safety.

- [ ] **Step 2: Launch app and verify all tabs visually**

Run: `npm run dev`
Check each tab:
- [ ] Виджет: style+scale left, colors right
- [ ] Часы: style+scale left, colors+date right
- [ ] Полноэкранный: style+monitor left, colors+bg right
- [ ] Звуки: full-width master toggle, events, upload

Check no scrollbar appears on any tab.

- [ ] **Step 3: Run full CI**

Run: `npm run ci`
Expected: Lint + 70 tests PASS

- [ ] **Step 4: Commit**

```bash
git add electron-control.html
git commit -m "fix: visual polish and remove dead responsive breakpoints"
```

---

### Task 6: Update CLAUDE.md and SESSION.md

**Files:**
- Modify: `CLAUDE.md` — update control window description
- Modify: `SESSION.md` — add session notes

- [ ] **Step 1: Update CLAUDE.md control window description**

Find the line about Control Window width (~4800 lines) and update to reflect new width:
```
1. **Control Window** (`electron-control.html`) — main management panel with 4 settings tabs (Виджет, Часы, Полноэкранный, Звуки). ~4800 lines, all inline HTML/CSS/JS. Settings in 2-column grid layout, 700px wide.
```

Also update the control panel layout gotcha:
```
- **Control panel layout**: Titlebar → Timer (52px) → Start/Pause/Reset → Presets 8×1 → Adjust +/- → Overtime+Windows (merged row) → Tabs always visible (Виджет, Часы, Полноэкранный, Звуки). Settings in 2-column grid.
```

- [ ] **Step 2: Add session notes to SESSION.md**

Append:
```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md SESSION.md
git commit -m "docs: update CLAUDE.md and SESSION.md for settings panel v2"
```
