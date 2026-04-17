# Changelog

## [2.2.1] - 2026-04-17

### Security (аудит SberTech)
- Удалён политизированный баннер StandWithUkraine из `LICENSES.chromium.html` через `afterPack` hook — ссылка на acornjs репо заменена на нейтральный npmjs URL
- Linux: `afterInstall` скрипт снимает SUID бит с `chrome-sandbox` (0755 без SUID)
- Linux: `executableArgs: ["--no-sandbox"]` — fallback для систем без user namespaces
- Electron обновлён до 41.2.1 (патчи безопасности Chromium)

## [1.2.9] - 2026-03-28

### Fixed
- Full security audit: 13 issues fixed (input validation, IPC hardening, image magic bytes)
- Dependency update: Electron 41.1.0, ESLint 9.39
- Guard against destroyed window in zoom/input handlers

## [1.2.8] - 2026-03-27

### Fixed
- Play finish sound at 00:00 in overrun mode
- Widget stays transparent — background images only on fullscreen display

### Added
- Exit confirmation dialog on control window close

## [1.2.7] - 2026-03-26

### Fixed
- Crash "Object has been destroyed" on window toggle
- formatTimeShort dead reference in control panel and widget
- Deep audit: memory leak, dead code, lint errors

## [1.2.5] - 2026-03-25

### Added
- Toggle hotkeys W/C/D for widget/clock/display
- Clock style sync
- Playwright UI tests (54 tests)

### Fixed
- ESLint config + lint errors
- CI: replace deprecated macos-13 runner

## [1.2.4] - 2026-03-24

### Changed
- Full project polish: 50/51 audit issues fixed
- CSS variables, dead code removal
- Updated documentation
