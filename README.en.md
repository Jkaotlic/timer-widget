<div align="center">

<img src="build/icon.png" width="128" alt="TimerWidget">

# TimerWidget

**Transparent timer widget for presentations and desktop**

[![Version](https://img.shields.io/badge/v2.3.2-0a84ff?style=flat-square)](../../releases/latest)
[![Electron](https://img.shields.io/badge/Electron_41-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/Jkaotlic/timer-widget/nodejs.yml?style=flat-square&label=CI)](https://github.com/Jkaotlic/timer-widget/actions)
[![Tests](https://img.shields.io/badge/tests-128%20passing-30d158?style=flat-square)](tests/)
[![Platform](https://img.shields.io/badge/Windows_|_macOS_|_Linux-333?style=flat-square)]()
[![License](https://img.shields.io/badge/MIT-30d158?style=flat-square)](LICENSE)

[**Русский**](README.md) ·
[**Download**](../../releases/latest) ·
[**Changelog**](CHANGELOG.md)

</div>

---

## Table of Contents

- [Features](#features)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Installation](#installation)
- [For Developers](#for-developers)
- [Architecture](#architecture)
- [Security](#security)
- [FAQ](#faq)
- [Contributing](#contributing)

---

## Features

<details open>
<summary><b>Timer</b></summary>

<br>

- 4 display styles — circle, digital LED, flip clock, analog
- Overtime with red pulsation, configurable limit and notification interval
- 8 presets from 5 to 60 minutes + manual input (`sec`, `min:sec`, `hr:min:sec`)
- `H:MM:SS` format automatically when timer exceeds one hour
- Negative count with notifications every N minutes
- 30 built-in sounds (Web Audio API) + custom `.mp3` / `.wav` / `.ogg` / `.flac` / `.webm` / `.aac` upload

</details>

<details>
<summary><b>4 windows</b></summary>

<br>

| Window | Description |
|:-------|:------------|
| **Control Panel** | Compact 380×720 with a slide-out settings drawer (macOS-style detail pane). 4 tabs: Widget, Clock, Fullscreen, Sounds |
| **Widget** | Transparent, always-on-top mini timer for desktop |
| **Clock** | Independent clock with date and timezone, 4 style variants |
| **Fullscreen** | For projectors or secondary monitors. Display picker, Alt-drag info blocks, windowed-mode toggle |

</details>

<details>
<summary><b>Design</b></summary>

<br>

- Apple VisionOS glassmorphism — `blur(40px) saturate(180%)`, Inter Light for timer text, JetBrains Mono for LED
- **HSV color picker** per window — full color control, not just presets
- Gradient progress ring (systemBlue `#0a84ff` → systemGreen `#30d158`)
- Apple semantic palette: `#0a84ff` / `#30d158` / `#ff453a` / `#ff9f0a`
- Fullscreen background — solid fill, gradient, or local file (`.png`, `.jpg`, `.webp` with magic-bytes validation)

</details>

<details>
<summary><b>Controls</b></summary>

<br>

- Keyboard shortcuts work from **any** window (Space, R, 1–8, W, C, D)
- **Ctrl + wheel** — scale widget / clock / display (30–600%)
- **Shift + wheel** — separate scaling for info blocks on fullscreen
- **Alt + drag** — freely move blocks on the fullscreen display
- **Click the scale percentage** — exact input, double-click resets to 100%
- All positions, scales and settings persist between sessions
- Monitor picker for fullscreen mode

</details>

---

## Keyboard Shortcuts

Work from **any** window.

| Key | Action |
|:----|:-------|
| `Space` | Start / Pause |
| `R` | Reset |
| `1` `2` `3` `4` `5` `6` `7` `8` | Presets: 5, 10, 15, 20, 25, 30, 45, 60 min |
| `W` | Toggle widget |
| `C` | Toggle clock |
| `D` | Toggle fullscreen |
| `Esc` | Close current window |
| `Ctrl` + wheel | Scale widget / clock / fullscreen |
| `Shift` + wheel | Scale info blocks on fullscreen |
| `Alt` + drag | Move info block on fullscreen |

---

## Installation

Download from [**Releases**](../../releases/latest):

| | Platform | File |
|:--|:---------|:-----|
| <img src="https://cdn.simpleicons.org/windows/0078D6" width="16"> | Windows | `TimerWidget-Setup-*.exe` — installer (NSIS) |
| <img src="https://cdn.simpleicons.org/windows/0078D6" width="16"> | Windows | `TimerWidget-Portable.exe` — no install needed |
| <img src="https://cdn.simpleicons.org/apple/999" width="16"> | macOS Apple Silicon | `TimerWidget-*-arm64.dmg` |
| <img src="https://cdn.simpleicons.org/apple/999" width="16"> | macOS Intel | `TimerWidget-*-x64.dmg` |

> **macOS**: the app is not signed with an Apple Developer certificate. On first launch:
> 1. Open the DMG and drag the app into Applications
> 2. **Right-click** TimerWidget → **Open** → confirm
>
> Or from terminal: `xattr -cr /Applications/TimerWidget.app`

<details>
<summary>Linux</summary>

<br>

| | Format | File |
|:--|:-------|:-----|
| <img src="https://cdn.simpleicons.org/linux/FCC624" width="16"> | DEB | `TimerWidget-*-amd64.deb` |
| <img src="https://cdn.simpleicons.org/linux/FCC624" width="16"> | AppImage | `TimerWidget-*.AppImage` |

`chrome-sandbox` is installed without the SUID bit (0755); the app runs with `--no-sandbox`, so user namespaces are not required.

</details>

---

## For Developers

```bash
git clone https://github.com/Jkaotlic/timer-widget.git
cd timer-widget
npm install
npm start
```

| Command | Description |
|:--------|:------------|
| `npm start` | Run the app |
| `npm run dev` | Run with DevTools |
| `npm test` | 126 tests (`node --test`) |
| `npm run lint` | ESLint 9 (flat config) |
| `npm run ci` | Lint + tests |
| `npm run screenshot` | 24 PNG screenshots for headless visual review |
| `npm run build:win` | Build Windows (NSIS + Portable) |
| `npm run build:mac` | Build macOS (DMG + ZIP, arm64 + x64) |
| `npm run build` | Build for current platform |

### Project Structure

```
timer-widget/
├── electron-main.js            # Main process — timer state, IPC, windows
├── electron-control.html       # Control panel (4 tabs + drawer)
├── electron-widget.html        # Widget (transparent, frameless, always-on-top)
├── electron-clock-widget.html  # Clock (transparent, frameless, always-on-top)
├── display.html                # Fullscreen mode (HTML)
├── display-script.js           # Fullscreen mode (DisplayTimer logic)
├── timer-engine.js             # Pure timer logic (testable)
├── recovery.js                 # State recovery after crash
├── preload.js                  # IPC bridge with channel whitelist
├── ipc-compat.js               # ipcRenderer → electronAPI shim
├── channel-validator.js        # IPC channel whitelist
├── constants.js                # Constants, IPC channels, storage keys
├── utils.js                    # formatTime, parseTime, debounce, safelySendToWindow
├── security.js                 # Validation: data URL, images, escapeHTML
├── design-tokens.css           # CSS custom properties (palette, shadows, blurs, timings)
├── components.css              # Shared component styles
├── build/
│   ├── icon.png                # App icon (1024×1024)
│   ├── after-pack.js           # electron-builder hook
│   └── linux-after-install.sh  # chmod 0755 chrome-sandbox without SUID
├── scripts/
│   ├── run-electron.js         # Wrapper: clears ELECTRON_RUN_AS_NODE
│   └── screenshot-runner.js    # Headless harness for visual review
└── tests/                      # 126 tests (10+ files)
```

---

## Architecture

```
┌─────────────────┐          ┌──────────────────────────┐
│  Control Panel   │◄────────►│                          │
│  (settings, UI)  │   IPC    │     electron-main.js     │
├─────────────────┤          │                          │
│  Widget          │◄────────►│  - Timer state (truth)   │
│  (transparent)   │          │  - Window management     │
├─────────────────┤          │  - IPC routing            │
│  Clock           │◄────────►│                          │
│  (transparent)   │          │     preload.js           │
├─────────────────┤          │  - Channel whitelist     │
│  Display         │◄────────►│  - Direction validation  │
│  (fullscreen)    │          └──────────────────────────┘
└─────────────────┘
```

**Key principles:**

- **Main process is the single source of truth.** The timer ticks only in main; all windows receive state via `timer-state` every second
- **Per-window IPC channels.** Colors, styles and settings are sent to specific windows (`widget-colors-update`, `clock-colors-update`, `display-colors-update`) instead of globally — prevents "color bleeding" between windows
- **Monotonic synchronization.** `updateCounter` guarantees ordered updates without depending on system clocks
- **Context isolation + sandbox** on all windows. Renderers have no access to Node.js APIs
- **DevTools disabled** in all production windows (`devTools: false`)

---

## Security

<details>
<summary>Security measures in detail</summary>

<br>

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` on all windows
- `devTools: false` — developer console unavailable in production
- IPC whitelist with direction validation (send / receive) in `preload.js` and `channel-validator.js`
- `hardenWindow()` blocks navigation to non-file:// URLs and denies `window.open`
- **No HTTP/HTTPS loading.** Background images are accepted only as local `data:` URLs
- Numeric IPC inputs: checks for `NaN`, `Infinity`, min/max bounds
- Images: MIME + magic-bytes validation (WebP checks RIFF+WEBP signature, ≤10 MB)
- Audio: MIME + magic bytes for MP3 / WAV / OGG / FLAC / WebM / AAC, ≤5 MB
- SVG blocked in data URLs (XSS vector)
- CSS injection: colors validated via regex, URLs parsed via `URL()` constructor
- Chromium Component Updater disabled (`disable-component-update` + `disable-features=ChromeVariations,OptimizationHints`) — the app never calls home
- electron-builder `afterPack` strips external political content from `LICENSES.chromium.html`
- On Linux, `chrome-sandbox` is installed without the SUID bit (0755)

</details>

---

## FAQ

<details>
<summary><b>How do I change widget scale?</b></summary>

`Ctrl + mouse wheel` — quick scaling (30–600%). Click the percentage number — type an exact value. Double-click — reset to 100%. Works on widget, clock and fullscreen.

</details>

<details>
<summary><b>How do I send the timer to a second monitor?</b></summary>

Press `D` or open the Fullscreen tab → pick the monitor from the list. The choice persists — next time fullscreen opens on the same display.

</details>

<details>
<summary><b>Why is the timer showing negative time?</b></summary>

That's Overtime mode — the timer keeps counting past zero. Configurable in the control panel: overtime limit and notification interval. `R` to reset.

</details>

<details>
<summary><b>Can I add my own sound?</b></summary>

Yes. Sounds tab → upload `.mp3`, `.wav`, `.ogg`, `.flac`, `.webm` or `.aac` up to 5 MB. Assign it to any event (start, minute tick, finish, overtime).

</details>

<details>
<summary><b>Does it work offline?</b></summary>

Yes, fully offline. All fonts are bundled locally (`fonts/`), sounds are synthesized via Web Audio API, and Chromium's Component Updater is disabled — the app never touches the network.

</details>

<details>
<summary><b>How do I move blocks on fullscreen?</b></summary>

Hold `Alt` and drag any info block (time, status, current time) to the desired position. Positions persist in localStorage between sessions.

</details>

<details>
<summary><b>Why is the control panel so narrow?</b></summary>

In v2.3 the panel became compact (380 px); settings moved into a **drawer** — a slide-out side panel. Clicking the gear icon or any tab expands the drawer next to the panel, like a macOS Finder detail pane. Closing the drawer returns the panel to its compact size.

</details>

---

## Contributing

1. Fork the repository
2. Create a branch (`git checkout -b feature/my-feature`)
3. Make sure `npm run ci` passes (lint + 126 tests)
4. Open a Pull Request

Bugs and feature requests — in [Issues](../../issues). Full change history — in [CHANGELOG.md](CHANGELOG.md).

---

<div align="center">

**Electron 41** · **Node.js 22** · **Vanilla JS** · **Web Audio API** · **126 tests** · **GitHub Actions CI**

MIT © 2024–2026 [Jkaotlic](https://github.com/Jkaotlic)

[![GitHub stars](https://img.shields.io/github/stars/Jkaotlic/timer-widget?style=social)](../../stargazers)
</div>
