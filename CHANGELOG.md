# Changelog

## [2.2.2] - 2026-04-17

### Security / Compliance
- Google Fonts заменены на локальные woff2 (Inter 200/300/400/500/600/700, JetBrains Mono 300/400/500/700, латиница+кириллица) — нет сетевых запросов на запуске, CSP `font-src 'self'` соблюдается
- Таймер-логика выделена в чистый модуль `timer-engine.js` (без Electron API) — 196 строк, 27 новых unit-тестов
- Удалены мёртвые IPC каналы `widget-scale`, `clock-widget-scale` (без handlers)
- `playwright-electron` удалена как неиспользуемая зависимость

### Fixed
- Утечки listeners: cleanup() добавлен в WidgetTimer, ClockWidget, TimerController, DisplayTimer — 14+ handler'ов корректно снимаются при закрытии окна
- `display-script.js`: innerHTML заменён на DOM API (3 места) с кешированием узлов
- `display-script.js`: JSON.parse валидируется на структуру + clamping позиций ±5000px
- `display-script.js`: `_safeSetItem()` с 1MB лимитом + QuotaExceededError guard
- `parseManualTime`: 0 секунд теперь валиден (было `<= 0 → null`)
- Race guard в `handleTimerReset()` (флаг isResetting, 100ms cooldown)
- `reset-and-relaunch`: await Promise.all для clearStorage/clearCache вместо setTimeout(500)
- `loadFile().catch()` во всех 4 окнах
- 7 ESLint warnings устранены (catch без параметра)
- `.gitignore`: `!build/icon.png` исключение, иначе иконка игнорилась
- README badges обновлены v2.1.1 → v2.2.2

### Removed
- `analysis/`, `docs/superpowers/` — stale директории

### Tests
- `tests/timer-engine.test.js` — 27 тестов (tick / overrun / adjust / reset / setPreset / start / pause)
- `tests/display-timer.test.js` — 12 тестов (валидация позиций блоков, safe localStorage)
- Итого: 70 → 109 тестов

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
