# Design Improvements v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply VisionOS glassmorphism polish (blur 40px, gradient ring, Inter/JetBrains Mono fonts, shadow cleanup) to all 3 renderer windows.

**Architecture:** CSS-only changes + SVG gradient updates. No JS logic changes. Each window gets the same design token updates. Widget and clock are transparent windows — no external shadows allowed.

**Tech Stack:** Inline CSS in HTML files, SVG gradients, Google Fonts (Inter, JetBrains Mono loaded via JS in each file).

**Spec:** `docs/superpowers/specs/2026-04-06-design-improvements-v2.md`

---

### Task 1: Widget — Glassmorphism + Typography

**Files:**
- Modify: `electron-widget.html`

- [ ] **Step 1: Update SVG gradient from purple to blue→green**

Find (around line 940):
```xml
<linearGradient id="widgetGradient" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#667eea" />
    <stop offset="100%" stop-color="#764ba2" />
</linearGradient>
```

Replace with:
```xml
<linearGradient id="widgetGradient" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#0a84ff" />
    <stop offset="100%" stop-color="#30d158" />
</linearGradient>
```

- [ ] **Step 2: Update timer font from SF Mono Bold to Inter Light**

Find CSS (around line 292):
```css
font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
font-weight: 700;
```

Replace with:
```css
font-family: 'Inter', -apple-system, 'SF Pro Display', system-ui, sans-serif;
font-weight: 200;
```

- [ ] **Step 3: Update widget border from 2px/8px to 1px/24px**

Find CSS `.widget-border` (around line 30):
```css
border: 2px solid transparent;
border-radius: 8px;
```

Replace with:
```css
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 24px;
```

- [ ] **Step 4: Update settings panel backdrop-filter from blur(20px) to blur(40px) saturate(180%)**

Find CSS `.settings-panel` (around line 413):
```css
backdrop-filter: blur(20px);
```

Replace with:
```css
backdrop-filter: blur(40px) saturate(180%);
```

- [ ] **Step 5: Remove external drop-shadows on progress bar (transparent window)**

Find CSS `.progress-bar` (around line 250):
```css
filter: drop-shadow(0 0 8px rgba(102, 126, 234, 0.5));
```

Replace with:
```css
filter: none;
```

Also find `.progress-bar[data-status="warning"]` (around line 256):
```css
filter: drop-shadow(0 0 8px rgba(255, 193, 7, 0.5));
```

Replace with:
```css
filter: none;
```

Also find `.progress-bar[data-status="danger"]` and `.progress-bar[data-status="overtime"]` (around line 262):
```css
filter: drop-shadow(0 0 8px rgba(255, 68, 68, 0.6));
```

Replace with:
```css
filter: none;
```

- [ ] **Step 6: Remove external box-shadow on settings panel**

Find CSS `.settings-panel` (around line 425):
```css
box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
```

Replace with:
```css
box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
```

- [ ] **Step 7: Update transition timings from 0.3s to 0.2s**

Find in `.widget-border` (around line 41):
```css
transition: border-color 0.3s ease;
```

Replace with:
```css
transition: border-color 0.2s ease-out;
```

Find in `.time-display` (around line 303):
```css
transition: color 0.3s, text-shadow 0.3s;
```

Replace with:
```css
transition: color 0.2s ease-out, text-shadow 0.2s ease-out;
```

Find in `.status-badge` (around line 333):
```css
transition: all 0.3s;
```

Replace with:
```css
transition: all 0.2s ease-out;
```

- [ ] **Step 8: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add electron-widget.html
git commit -m "feat: widget glassmorphism v2 — blur(40px), Inter Light, gradient ring, no shadows"
```

---

### Task 2: Clock Widget — Same Glassmorphism Treatment

**Files:**
- Modify: `electron-clock-widget.html`

- [ ] **Step 1: Update SVG gradient from green→teal to blue→green**

Find (around line 1033):
```xml
<linearGradient id="clockGradient" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#38ef7d" />
    <stop offset="100%" stop-color="#11998e" />
</linearGradient>
```

Replace with:
```xml
<linearGradient id="clockGradient" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#0a84ff" />
    <stop offset="100%" stop-color="#30d158" />
</linearGradient>
```

- [ ] **Step 2: Update clock time font from SF Mono Bold to Inter Light**

Find CSS `.time-display` (around line 243):
```css
font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
font-weight: 700;
```

Replace with:
```css
font-family: 'Inter', -apple-system, 'SF Pro Display', system-ui, sans-serif;
font-weight: 200;
```

- [ ] **Step 3: Update digital LED font to JetBrains Mono**

Find CSS for digital mode time (around line 271-278, where `font-family: 'Courier New', 'Consolas', monospace`):

Replace with:
```css
font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
```

- [ ] **Step 4: Update widget border from 2px/8px to 1px/24px**

Find CSS `.widget-border` (around line 31):
```css
border: 2px solid transparent;
border-radius: 8px;
```

Replace with:
```css
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 24px;
```

- [ ] **Step 5: Update settings panel backdrop-filter**

Find CSS `.settings-panel` (around line 385):
```css
backdrop-filter: blur(20px);
```

Replace with:
```css
backdrop-filter: blur(40px) saturate(180%);
```

- [ ] **Step 6: Remove external drop-shadow on seconds bar (transparent window)**

Find CSS `.seconds-bar` (around line 219):
```css
filter: drop-shadow(0 0 8px rgba(56, 239, 125, 0.5));
```

Replace with:
```css
filter: none;
```

- [ ] **Step 7: Remove external box-shadow on settings panel**

Find CSS `.settings-panel` (around line 397):
```css
box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
```

Replace with:
```css
box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
```

- [ ] **Step 8: Update transition timings**

Find in `.widget-border` (around line 41):
```css
transition: border-color 0.3s ease;
```
Replace with:
```css
transition: border-color 0.2s ease-out;
```

Find in `.time-display` (around line 254):
```css
transition: color 0.3s, text-shadow 0.3s;
```
Replace with:
```css
transition: color 0.2s ease-out, text-shadow 0.2s ease-out;
```

- [ ] **Step 9: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add electron-clock-widget.html
git commit -m "feat: clock widget glassmorphism v2 — blur(40px), Inter Light, JetBrains Mono LED, gradient ring"
```

---

### Task 3: Display — Gradient Ring + Typography

**Files:**
- Modify: `display.html`

- [ ] **Step 1: Update SVG gradient from purple to blue→green**

Find (around line 1219):
```xml
<linearGradient id="mainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#667eea" class="grad-stop-1" />
    <stop offset="100%" stop-color="#764ba2" class="grad-stop-2" />
</linearGradient>
```

Replace with:
```xml
<linearGradient id="mainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#0a84ff" class="grad-stop-1" />
    <stop offset="100%" stop-color="#30d158" class="grad-stop-2" />
</linearGradient>
```

- [ ] **Step 2: Update timer font from SF Mono Bold to Inter Light**

Find CSS `.time-text` (around line 414):
```css
font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
font-weight: 700;
```

Replace with:
```css
font-family: 'Inter', -apple-system, 'SF Pro Display', system-ui, sans-serif;
font-weight: 200;
```

- [ ] **Step 3: Update ring stroke width from 12 to 8**

Find CSS for ring track and progress bar (around lines 363-371). The stroke-width values of `12` should change to `8` for both track and progress elements. Search for `stroke-width` in the ring-related CSS.

- [ ] **Step 4: Update info block border-radius from 16px to 12px**

Find CSS `.info-block` (around line 72):
```css
border-radius: 16px;
```

Replace with:
```css
border-radius: 12px;
```

- [ ] **Step 5: Update transition timing**

Find CSS `.time-text` (around line 425):
```css
transition: color 0.4s, text-shadow 0.4s, font-size 0.3s;
```

Replace with:
```css
transition: color 0.2s ease-out, text-shadow 0.2s ease-out, font-size 0.2s ease-out;
```

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add display.html
git commit -m "feat: display glassmorphism v2 — gradient ring, Inter Light, refined stroke"
```

---

### Task 4: Display Script — Update JS gradient references

**Files:**
- Modify: `display-script.js`

- [ ] **Step 1: Check for hardcoded gradient colors in JS**

Search `display-script.js` for `#667eea`, `#764ba2`, `667eea`, `764ba2`. If the JS dynamically updates gradient stop-colors (e.g., via `applyColors()`), those values need to change to `#0a84ff` / `#30d158`.

Also search for `glow-color` CSS variable assignments that reference the old purple color.

Replace all instances of:
- `#667eea` → `#0a84ff`
- `#764ba2` → `#30d158`
- `rgba(102, 126, 234` → `rgba(10, 132, 255` (the glow color)

- [ ] **Step 2: Check widget JS for hardcoded gradient colors**

In `electron-widget.html`, search the `<script>` section for `#667eea`, `#764ba2`, `667eea`, `764ba2`, and `rgba(102, 126, 234`. These may be used in `applyColors()` to dynamically set gradient stops.

Replace all instances to match the new blue→green gradient.

- [ ] **Step 3: Check clock JS for hardcoded gradient colors**

In `electron-clock-widget.html`, search the `<script>` section for `#38ef7d`, `#11998e`, `38ef7d`, `11998e`, and `rgba(56, 239, 125`. These may be dynamically set in `applyColors()`.

Replace default fallback values to match the new blue→green gradient.

- [ ] **Step 4: Run lint + tests**

Run: `npm run ci`
Expected: PASS (lint + 70 tests)

- [ ] **Step 5: Commit**

```bash
git add display-script.js electron-widget.html electron-clock-widget.html
git commit -m "feat: update JS gradient references to blue→green across all windows"
```

---

### Task 5: Font Loading — Add Inter + JetBrains Mono

**Files:**
- Modify: `electron-widget.html`
- Modify: `electron-clock-widget.html`
- Modify: `display.html`

- [ ] **Step 1: Add font-face declarations to widget**

In `electron-widget.html`, find the opening `<style>` tag and add after it:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;700&display=swap');
```

NOTE: If the app runs offline, we cannot use Google Fonts CDN. Check if the Electron app has internet access in renderer windows. If not, use system font fallbacks only:
- `'Inter', -apple-system, 'SF Pro Display', system-ui, sans-serif` (Inter ships with many modern OS)
- `'JetBrains Mono', 'SF Mono', 'Consolas', 'Monaco', monospace`

The fallback stack ensures the app works offline — Inter and JetBrains Mono are used if installed locally, otherwise system fonts kick in.

- [ ] **Step 2: Add same font import to clock widget**

Add the same `@import` to `electron-clock-widget.html` `<style>` block.

- [ ] **Step 3: Add same font import to display**

Add the same `@import` to `display.html` `<style>` block.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron-widget.html electron-clock-widget.html display.html
git commit -m "feat: add Inter + JetBrains Mono font imports to all renderer windows"
```

---

### Task 6: Visual Verification + Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `SESSION.md`

- [ ] **Step 1: Run full CI**

Run: `npm run ci`
Expected: PASS (lint + 70 tests)

- [ ] **Step 2: Start app and visually verify**

Run: `npm start`

Verify each window:
- Widget (all 4 styles): transparent background, no dark rectangles from shadows, gradient ring visible, Inter font for time
- Clock (all 4 styles): same as widget, JetBrains Mono for digital LED
- Display: gradient ring blue→green, Inter Light for time, info blocks with 12px radius
- Control panel: all existing functionality works

- [ ] **Step 3: Update CLAUDE.md**

Add to the Gotchas section or update existing entry about widget design:
```
- **Design system v2**: All windows use VisionOS glassmorphism — `blur(40px) saturate(180%)`, gradient ring `#0a84ff→#30d158`, Inter Light for timer text. Widget/clock: NO external shadows (transparent windows). Digital LED uses JetBrains Mono.
```

- [ ] **Step 4: Update SESSION.md**

Append entry about design improvements v2 implementation.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md SESSION.md
git commit -m "docs: update CLAUDE.md and SESSION.md for design v2"
```
