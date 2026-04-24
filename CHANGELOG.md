# Changelog

## [2.3.2] - 2026-04-24

### Fixed
- **Критично: в packaged-релизе вся панель рендерилась как светлая тема.** В `package.json build.files` отсутствовал `design-tokens.css` → electron-builder не паковал его в `app.asar` → при запуске релиза все CSS custom properties (`--tw-bg-void`, `--tw-fg`, `--tw-bg-surface` и т.д.) были undefined → дефолтный белый BrowserWindow просвечивал через полупрозрачный `.control-panel` (`rgba(28,28,30,0.72)`). В dev (`npm start`) проблема не проявлялась — Electron читает файлы напрямую из рабочей папки, минуя `app.asar`. Затронуто v2.3.0 и v2.3.1
- Защита-в-глубину: `backgroundColor: '#000000'` на control BrowserWindow + `html, body { background: #000 }` в `electron-control.html` — даже если какой-то токен не загрузится, белого фона больше не будет

### Added
- `tests/packaging.test.js` — guard-тест на CI: парсит все `<link href>` / `<script src>` в HTML-файлах и все `require('./...')` в main-process JS, проверяет что каждый referenced asset присутствует в `package.json build.files`. Падает до релиза, если файл забыли добавить

### Tests
- 126 → 128 (добавлены 2 packaging-проверки)

## [2.3.1] - 2026-04-24

### Changed
- **Новая иконка приложения** — неоновые песочные часы вместо предыдущего праздничного оформления. Применяется ко всем платформам (macOS `.icns`, Windows `.ico`, Linux PNG) через `build/icon.png` 1024×1024
- **README**: полная актуализация под v2.3 — версия 2.3.1, 126 тестов вместо 70, drawer UI, HSV picker, новые горячие клавиши, расширенный раздел безопасности, обновлённая структура проекта
- **README.en.md**: синхронизирован с русской версией

## [2.3.0] - 2026-04-24

### Added
- **Design System v3** — VisionOS glassmorphism полностью переосмыслен через `design-tokens.css`: единые CSS custom properties для палитры, блюров, теней, таймингов и радиусов. Все окна (control, widget, clock, display) переведены на токены
- **HSV color picker** — полноценный выбор цвета (hue slider + SV-область + hex input) вместо только пресетов. Независимые инстансы для вкладок Виджет / Часы / Полноэкранный
- **Slide-out drawer** — панель управления стала компактной (380 px), настройки переехали в выдвижной drawer (macOS detail-pane pattern). Адаптивная высота окна под активную вкладку
- **Ручной ввод времени** — поле в панели управления принимает `sec`, `min:sec` или `hr:min:sec` (до 99:59:59)
- **Клик по проценту масштаба** — точный ввод значения, двойной клик — сброс к 100%
- **Shift + колесо** на полноэкранном — отдельное масштабирование информационных блоков
- **Альтернативная раскладка блоков** — третьи-точки (`top-left-third`, `bottom-right-third` и др.) для более тонкой компоновки на широких мониторах
- **Dev harness**: `npm run screenshot` — 24 PNG для headless визуального ревью; `bindRenderConsole` пробрасывает логи рендереров в `electron-log`
- `scripts/run-electron.js` — wrapper, сбрасывающий `ELECTRON_RUN_AS_NODE` перед запуском, чтобы не было крашей при наследовании переменной

### Changed
- **Тесты**: 128 → 126 (перетряхнули тест-сьют под новую архитектуру, убрали устаревшие кейсы)
- **Контрольная панель**: 420×720 → 380×720 по умолчанию, минимум 340×640
- **Shared CSS**: `components.css` + `design-tokens.css` подключаются во все HTML — больше не нужны инлайн-копии токенов
- Виджет flip: отдельные статусы (warning/danger/overtime) применяются к точкам-разделителям через `data-status` (`::before/::after` игнорируют `.color`)
- Часы digital: секунды наследуют цвет таймера с 0.55 opacity вместо жёстко заданного `--tw-fg-muted` — пользовательские темы теперь применяются к секундам

### Fixed
- **Windows 11 DWM белая обводка на полноэкранном** — корневая причина: `frame:false` оставляет `WS_THICKFRAME`, и DWM рисует 1px светлую кайму поверх рендерера. Фикс: `thickFrame:false` + `hasShadow:false` на display-окне
- Display `backgroundColor:'#000'` + `html { background:#000 }` — защита от белых полос на фракционной DPI и при переключении `--bg`
- Info-блоки на полноэкранном: `display:none` для скрытых (раньше `opacity:0` оставлял «призраки» в углах из-за специфичности селекторов), 20 px clamping от краёв экрана при Alt-drag — карточки не прилегают вплотную к границе
- Overtime status корректно отображается во всех 3 окнах (widget/clock/display) — ветка `overtime` теперь вычисляется **до** `finished`
- Кэш `updateStatus` в DisplayTimer инвалидируется при изменении `isRunning` / `isPaused` / `finished`, а не только `remainingSeconds`
- Полноэкранный hint исчезает через 5 с без возврата на `mousemove` / `keydown`
- `CSP frame-ancestors` удалён из `<meta>` (директива работает только в HTTP-заголовке)
- Drawer-open + flex overflow: `min-height:0` на scrollable child, иначе содержимое вкладки «Звуки» обрезалось без скроллбара
- Drawer close flicker: `.drawer-open` снимается только после фактического `resize`-события, не синхронно с IPC-вызовом
- `resize-control-window` IPC: `width`/`height` теперь опциональны по отдельности — drawer не перезаписывает ручную высоту, субпиксельного дрейфа на HiDPI больше нет

### Security
- **`disable-component-update`** + **`disable-features=ChromeVariations,OptimizationHints`** — Chromium Component Updater полностью отключён (никаких обращений к `redirector.gvt1.com` / `clientservices.googleapis.com` / `optimizationguide-pa.googleapis.com`)
- **HTTP(S) загрузка фоновых изображений удалена** — `isValidURL` вырезан, `validateImageSource` принимает только `data:` URL, CSP `img-src 'self' data:`, вкладка «Фон по URL» убрана из панели управления
- `devTools:false` на всех 4 BrowserWindow — консоль разработчика недоступна в production
- `build/after-pack.js` очищает `LICENSES.chromium.html` от внешнего политического контента в зависимостях (баннер Support Ukraine из acornjs), переписывает ссылку `github.com/acornjs/acorn` → `npmjs.com/package/acorn`
- SVG окончательно исключён из whitelist data URL
- Аудио upload: пустой `file.type` отклоняется, magic-bytes проверка для MP3/WAV/OGG/FLAC/WebM/AAC (≤5 MB)

### Audit
Сведённые рекомендации внешнего security-свипа v2.2.0 по 4 платформам (macOS ARM/x64, Ubuntu, Windows) — закрыто 7 из 7 actionable пунктов. Нерешённым остаётся обновление Electron 41 → 42+ (требует отдельного тестирования) и ужесточение AppArmor-профиля (только Ubuntu-отчёт).

## [2.2.4] - 2026-04-20

### Audit round 3 — 17 closed findings (full project-audit)

Полный аудит по 15 категориям (audit/2026-04-20/), 39 findings, 17 закрыто, 4 deferred, 18 LARGE отложены.

#### Performance (high+medium)
- **F-021** [HIGH]: `fs.writeFileSync` → `fs.promises.writeFile` в `saveTimerStateToFile` — event loop main process больше не блокируется каждые 10s
- **F-022**: tray menu split на `rebuildTrayMenu` / `updateTrayTime` / `updateTrayMenu` — полный rebuild только при смене isRunning/widget/clock open. Per-tick — только `tray.setToolTip`
- **F-023**: кеш `_cachedFlipDigits` / `_cachedFlipSeparators` в `applyColors` (DisplayTimer)
- **F-024**: tracking `_timeouts[]` / `_intervals[]` в DisplayTimer — flashInterval + setTimeout очищаются в cleanup()
- **F-025**: `WeakMap _miniClockHandsCache` для аналоговых стрелок mini-clock

#### Observability + Architecture (high+low)
- **F-027** [HIGH]: `bindRenderCrashHandler` теперь привязан к widget/display/clock окнам (не только control)
- **F-010**: extract `recovery.js` модуль — чистые функции (`isRecoveryValid`, `saveTimerStateToFile`, `loadSavedTimerState`, `clearSavedTimerState`); удалён test-export anti-pattern в electron-main.js; tests/recovery.test.js упрощён (без Module._resolveFilename stub)
- **F-005**: реализован broadcast `timer-recovery-available` в control window после did-finish-load (если есть валидный recovery snapshot)

#### Accessibility (high+medium)
- **F-001**: `innerHTML` → DOM API в `showKeyboardShortcuts` overlay
- **F-030** [HIGH]: aria-label на ~30 иконочных кнопках (✕, ⚙, 🔄, 🎵, 📁, …) во всех 4 окнах
- **F-031** [HIGH]: modals (exit/faq/reset/shortcuts) — `role="dialog" aria-modal="true"` + focus trap + Escape close
- **F-033**: контраст `rgba(255,255,255,0.4-0.5)` → `0.7` (WCAG AA)
- **F-034**: `prefers-reduced-motion` media query во всех HTML
- **F-035**: aria-label на ~17 input + 10 select
- **F-036/F-037/F-038**: modal initial focus, FAQ Escape, `:focus-visible` outline
- **F-039**: WONTFIX (manual time input `type="text"` — нужен умный парсинг)

#### Dependencies
- **F-003**: eslint 9.39.4 → 10.2.1 + добавлен явный `@eslint/js` (breaking change в ESLint 10)
- **F-004**: globals 17.4.0 → 17.5.0

### Deferred (require координации с другим раундом)
- F-002: `window.SecurityUtils` → contextBridge (требует HTML + preload sync)
- F-026: tray icon resize/preload (low impact)
- F-028: renderer console → electron-log bridge (требует новый IPC канал)

### LARGE — отложены на отдельный раунд
- F-006: split `electron-control.html` god-file (6119 строк inline JS)
- F-007: split `display-script.js` DisplayTimer на стратегии
- F-008: split `electron-main.js` (1016 строк) на window-factory/tray/recovery/ipc-handlers
- F-014: тесты для DisplayTimer (1779 строк, ~99% не покрыто)
- F-015: тесты IPC handlers
- F-032: color picker keyboard/screen-reader fallback

### Tests + audit artifacts
- `audit/2026-04-20/` — 16 markdown файлов: 15 категорий + executive README
- 128/128 тестов pass после каждого merge (Policy C re-verify)
- 0 lint warnings

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

### Security (аудит безопасности)
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
