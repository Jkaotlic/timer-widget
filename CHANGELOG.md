# Changelog

## [2.2.3] - 2026-04-20

### Added
- **System Tray** — иконка в трее Windows/Linux/macOS menu bar с контекстным меню (Старт/Пауза/Сбросить, показать панель, toggle виджет/часы, выход). При закрытии control окна — сворачивается в трей, а не quit.
- **Autostart** — IPC `set-autostart` / `get-autostart` для "запускать при старте ОС" (Windows реестр / macOS Login Items / Linux `.desktop`).
- **Logger** (`electron-log`) — логи в `%APPDATA%/TimerWidget/logs/main.log`, ротация 10MB, уровни `info` (prod) / `debug` (`--dev`). Все `console.*` в main заменены.
- **Crash Recovery** — `uncaughtException` / `unhandledRejection` сохраняют state в `last-state.json`, при следующем запуске восстанавливается если < 5 мин. `render-process-gone` автоматически перезагружает окно.
- **Export Logs** — IPC `export-logs` показывает диалог сохранения и копирует main.log в выбранное место (для bug reports).
- **Performance benchmarks** — `tests/perf.test.js` (9 тестов): `tick` 25ns, heap стабилен на 1M итераций. Startup instrumentation логирует `[perf] … window ready in Xms`.
- **SBOM** (CycloneDX 1.5, 863 KB) — генерация через `npm run sbom`. Pошёл в app.asar.
- **NOTICE** (49.9 KB) — атрибуция 365 пакетов через `npm run notice`. Pошёл в app.asar.
- **Uninstall cleanness**:
  - Windows NSIS: спрашивает при удалении "Удалить также настройки?"
  - Linux .deb: `postrm` скрипт чистит `~/.config/timer-widget` при `apt purge`
  - Документация `docs/UNINSTALL.md` — ручная чистка для macOS
- **Документация**: `docs/PERFORMANCE.md`, `docs/SUPPLY_CHAIN.md`, `docs/UNINSTALL.md`
- **Тесты recovery** — `tests/recovery.test.js` (10 тестов) через stub Electron/electron-log
- **IPC invoke support** — в preload.js добавлен `electronAPI.invoke()` для two-way запросов

### Changed
- **package.json** — первая прод-зависимость: `electron-log` (MIT, ~550k weekly)
- **CSP**: `font-src 'self' data:` — работает без Google Fonts
- **Итого тестов**: 109 → 128

### Security
- Все IPC каналы синхронизированы в `channel-validator.js` ↔ `preload.js`
- Новые каналы: `set-autostart`, `get-autostart`, `export-logs`, `timer-recovery-available`

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
