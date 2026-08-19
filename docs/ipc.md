# Каналы IPC

Полный реестр каналов: что шлёт рендерер, что рассылает главный процесс и с
какой полезной нагрузкой. Вынесен из `CLAUDE.md` 19.08.2026: таблица нужна В
МОМЕНТ работы с IPC, а не в каждом разговоре с первого слова, — та же причина,
по которой туда же уехали разборы ловушек (`docs/lessons.md`).

Правила, которые остаются в `CLAUDE.md`: канал объявляется в ОБА списка
(`channel-validator.js` + `preload.js`), у него обязаны быть оба конца
(`tests/ipc-liveness.test.js`), а разрешение — это не функция.


Channel whitelist defined in `channel-validator.js`, used by `preload.js`.

### Send (renderer → main)

| Channel | Purpose |
|---------|---------|
| `timer-command` | Start/pause/reset/set timer with payload `{ type, seconds, deltaSeconds, allowNegative, overrunLimitSeconds, overrunIntervalMinutes }` |
| `timer-control` | Keyboard shortcuts from display: `'start'` / `'pause'` / `'reset'` (plain string) |
| `widget-colors-update` | `{ timer: '#hex', progress: '#hex' }` — widget only |
| `clock-colors-update` | `{ timer: '#hex', progress: '#hex' }` — clock only |
| `display-colors-update` | `{ timer: '#hex', progress: '#hex' }` — display only |
| `widget-style-update` | `{ timerStyle, timerScale }` — widget style/scale |
| `display-settings-update` | Display style, background, clock settings. `bgMode` — четыре значения: `theme` (умолчание чистого профиля: холст по теме окна), `solid`, `gradient`, `local` |
| `get-timer-state` | Request current timer state |
| `get-displays` | Request list of available displays |
| `open-releases-page` | Без payload: main открывает страницу релизов через `shell.openExternal`, адрес — КОНСТАНТА в main. URL из рендерера означал бы выполнение произвольного адреса руками ОС |
| `open-widget` / `close-widget` | Toggle widget window |
| `open-display` / `close-display` | Toggle display window |
| `open-clock-widget` / `close-clock-widget` | Toggle clock widget |
| `resize-control-window` | `{ width, height }` — validated with `Number.isFinite` + min bounds |
| `control-drawer` | `{ open }` — ящик настроек. Отдельный канал: потолок окна двухуровневый (760×740 по содержимому, 1096×1100 с ящиком), и из ширины запроса уровень не выводится |
| `control-collapse` | `{ collapsed, height }` — свернуть панель в полосу. Отдельный канал: `resize-control-window` зажимает высоту минимумом окна (660). Снимает и возвращает пол `minHeight`, держит ВЕРХНИЙ край, `height` в 36…120 |
| `widget-resize` / `widget-move` / `widget-set-position` | Геометрия виджета. `widget-move` несёт `{deltaX, deltaY, first}`: `first` помечает начало жеста, и main держит размер окна до конца перетаскивания |
| `clock-widget-resize` / `clock-widget-set-style` / `clock-widget-settings` | Clock widget controls |
| `clock-widget-move` | `{ deltaX, deltaY }` — move clock widget window |
| `clock-widget-set-position` | `{ x, y }` — restore saved clock position (clamped to a live display) |
| `display-move` | `{ deltaX, deltaY }` — move display window in windowed mode |
| `display-layout` | `{ layout }` — применить раскладку (имя проверяется по реестру `display-layouts.js`). Отдельный канал: раскладка — действие, а не состояние; шлётся ПОСЛЕ тумблеров |
| `ui-theme-update` | `{ theme: 'dark' \| 'light' }` — sent by the panel only; main validates against a whitelist and relays to ALL windows (the one channel that IS broadcast, because the theme is app-wide) |
| `toggle-fullscreen` | Toggle fullscreen on the sender's window |
| `reset-and-relaunch` | Clear all storage and quit |
| `minimize-window` / `quit-app` | Window management |

### Receive (main → renderer)

| Channel | Payload |
|---------|---------|
| `timer-state` | Full `timerState` object (see below) — broadcast every second |
| `widget-colors-update` | `{ timer, progress }` — per-window |
| `clock-colors-update` | `{ timer, progress }` — per-window |
| `display-colors-update` | `{ timer, progress }` — per-window |
| `widget-style-update` | `{ timerStyle, timerScale }` |
| `timer-minute` | Fired when 1 minute remains |
| `timer-reached-zero` | Fired at 00:00 |
| `timer-overrun-minute` | Fired every N minutes in overrun mode |
| `display-settings-update` | Display settings object |
| `display-layout` | `{ layout }` — дисплею: разложить элементы по готовой раскладке |
| `displays-list` | Array of available displays |
| `set-clock-style` / `clock-settings` | Clock widget settings |
| `display-window-state` / `widget-window-state` / `clock-window-state` | `{ isOpen }` |
| `ui-theme-update` | `{ theme }` — applied by `UITheme.bindThemeSync()` in every window |
| `window-geometry` | `{x, y, width, height}` — НАСТОЯЩИЕ границы окна от главного процесса. Виджет и часы пишут в `localStorage` их, а не свои `outerWidth`/`screenX`: на мониторе с масштабом ≠ 100 % это разные единицы |
| `timer-recovery-available` | The crash snapshot (`{ presetSeconds, totalSeconds, remainingSeconds, savedAt }`), sent to the control window once on `did-finish-load`. Main restores the time itself; this only tells the panel to say so (a toast) |

