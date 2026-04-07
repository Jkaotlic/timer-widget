# README Redesign Spec

## Overview

Full rewrite of README.md. Russian primary (`README.md`) + English version (`README.en.md`). Style: navigable document with ToC, `<details>` blocks, ASCII architecture diagram. Screenshots captured via Playwright.

## Languages

- `README.md` — Russian (primary)
- `README.en.md` — English translation
- Cross-links at top of each file

## Structure (Variant B — Navigable Document)

### 1. Hero

- `build/icon.png` (128px) centered
- `<h1>TimerWidget</h1>`
- One-line description
- Badges: version (from package.json), Electron 41, platforms (Win/macOS/Linux), MIT license, CI status (dynamic GitHub Actions badge)
- Language switcher: `[RU | EN]`
- Hero screenshot: composite of all 4 windows (captured via Playwright)
- CTA: "Download latest" → releases/latest

### 2. Table of Contents

Anchor links to all sections, single column, compact.

### 3. Features

4 `<details>` blocks (first open by default):
- Timer: 4 styles, overtime + pulse, 8 presets, H:MM:SS, negative count with notifications
- Windows: control panel (4 tabs), widget (transparent/always-on-top), clock (date+timezone), fullscreen (projector/second monitor). Screenshots per window.
- Customization: VisionOS glassmorphism, per-window colors, background (solid/gradient/image), 20 Web Audio sounds + custom upload
- Controls: global shortcuts, Ctrl+slider scale 30-600%, Alt+drag blocks, persistence

### 4. Keyboard Shortcuts

Table with columns: Key | Action. Grouped logically. Header note: "Work from any window."

### 5. Installation

Platform table with icons (Windows/macOS/Linux) + file names. Link to Releases. Linux in `<details>` for deb/AppImage.

### 6. For Developers

- Clone + install + start commands
- Commands table: start, dev, test, lint, ci, build:win, build:mac
- Project file tree with one-line comments

### 7. Architecture

ASCII diagram: 4 renderer windows ↔ electron-main (timer state) + preload.js (channel guard). Key principles below:
- Main process = single source of truth
- Per-window IPC channels (no global broadcast)
- Monotonic updateCounter for sync
- Context isolation + sandbox on all windows

### 8. Security

`<details>` block:
- nodeIntegration:false, contextIsolation:true, sandbox:true
- IPC whitelist with direction validation
- Numeric input validation (NaN, Infinity, bounds)
- Image validation: MIME + magic bytes, SVG blocked
- CSS injection prevention: regex colors, URL() constructor

### 9. FAQ

5-6 `<details>` Q&A blocks:
- Scale widget → Ctrl+hold
- Second monitor → D key or settings
- Reset after overtime → R
- Custom sounds → mp3/wav/ogg via Sounds tab
- Offline → yes, fully offline

### 10. Contributing

Fork → Branch → PR. `npm run ci` before commit. Issues for bugs/suggestions.

### 11. Changelog

v2.0.0 inline summary (glassmorphism, 4 styles, scaling, global shortcuts, 20 sounds). Link to Releases for full history.

### 12. Footer

Centered: tech stack line + copyright + stars badge.

## Screenshots

Captured via Playwright Electron testing:
1. `screenshots/hero.png` — composite or control panel overview
2. `screenshots/widget.png` — widget window (circle style)
3. `screenshots/clock.png` — clock widget
4. `screenshots/display.png` — fullscreen display
5. `screenshots/control.png` — control panel with settings

Screenshots committed to `screenshots/` directory (.gitignore entry for `*.png` must be adjusted to allow `screenshots/`).

## Implementation Notes

- Remove `screenshots/` and `*.png` from .gitignore (or add `!screenshots/` exception)
- Replace static test badge with dynamic GitHub Actions CI badge
- All `<details>` use consistent formatting with blank line after `<summary>`
- English version is a direct translation, same structure
