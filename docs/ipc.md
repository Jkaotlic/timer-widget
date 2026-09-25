# Каналы IPC

Полный реестр каналов: что шлёт рендерер, что рассылает главный процесс и с
какой полезной нагрузкой. Вынесен из `CLAUDE.md` 19.08.2026: таблица нужна В
МОМЕНТ работы с IPC, а не в каждом разговоре с первого слова, — та же причина,
по которой туда же уехали разборы ловушек (`docs/lessons.md`).

Правила, которые остаются в `CLAUDE.md`: канал — строка в `ipc-senders.js`
(`SENDERS` — кто шлёт, `RECEIVERS` — кто слушает), у него обязаны быть оба конца
(`tests/ipc-liveness.test.js`), а разрешение — это не функция.

## Мост по окнам

С 25.09.2026 мост (`preload.js`) каждого окна открывает ТОЛЬКО каналы этого
окна: виджет не может послать `reset-and-relaunch`, панель не подписывается на
`window-geometry`. Это второй слой; первый — проверка отправителя в главном
процессе (SEC-07, ниже), и он остаётся.

- **Источник один** — `SENDERS` и `RECEIVERS` в `ipc-senders.js`;
  `channelsFor(role)` даёт строку окна. `channel-validator.js` — лишь их
  объединение по направлениям, своего списка у него нет.
- **Таблица в preload.js сгенерирована** (`npm run preload:channels -- --write`,
  `scripts/preload-channels.js`): песочница (`sandbox: true`) разрешает мосту
  `require` только модуля `electron`, прочитать `ipc-senders.js` он не может.
- **Роль окна** — аргумент рендерера `--tw-window=<роль>`
  (`webPreferences.additionalArguments` в `main-windows.js`), мост читает его из
  `process.argv`. Задаётся главным процессом до запуска страницы. Нет роли,
  неизвестная или их две — мост закрыт целиком (и пишет почему в консоль).
- Один preload с таблицей всех окон, а не четыре файла: то же разделение без
  трёх лишних файлов в сборке и четырёх копий кода моста.
- Отказ моста — `console.error` «Blocked attempt … (окно <роль>)», его видно в
  журнале главного процесса как `[renderer:<окно>]`.

Проверки: `tests/preload-channels.test.js` — таблица свежая; мост на подставке
пропускает своё и режет чужое для каждого окна; строки ТОЧНО равны тому, что
окно шлёт и слушает по исходникам (`tests/helpers/ipc-scan.js`, обе стороны).
`tests/electron-main-load.test.js` — каждое окно получает свою роль; главный
процесс шлёт окну только открытое в его мосте (храповик на шесть старых
широковещаний без слушателя). `tests/release-gates.test.js`,
`scripts/verify-packed.js` — то же на исходнике и на `app.asar`;
`e2e/windows-load-clean.spec.js` — в настоящем Electron у каждого окна своя роль.

### Send (renderer → main)

Столбец «Кто шлёт» — копия таблицы `ipc-senders.js` (SEC-07): главный процесс
принимает канал ТОЛЬКО от этих окон, из главного кадра и со своей страницы;
остальное отбрасывается с одной записью в журнал на канал. Новый канал без
строки там не зарегистрируется — главный процесс упадёт при загрузке.

| Channel | Кто шлёт (ipc-senders.js) | Purpose |
|---------|------|---------|
| `timer-command` | панель, виджет, часы, дисплей | Start/pause/reset/set timer with payload `{ type, seconds, deltaSeconds, allowNegative, overrunLimitSeconds, overrunIntervalMinutes }` |
| `timer-control` | виджет, часы, дисплей | Keyboard shortcuts from display: `'start'` / `'pause'` / `'reset'` (plain string) |
| `widget-colors-update` | панель | `{ timer: '#hex', progress: '#hex' }` — widget only |
| `clock-colors-update` | панель | `{ timer: '#hex', progress: '#hex' }` — clock only |
| `display-colors-update` | панель | `{ timer: '#hex', progress: '#hex' }` — display only |
| `widget-style-update` | панель | `{ timerStyle, timerScale }` — widget style/scale |
| `display-settings-update` | панель | Display style, background, clock settings. `bgMode` — четыре значения: `theme` (умолчание чистого профиля: холст по теме окна), `solid`, `gradient`, `local`. `bgLocalImage` есть в payload только при СМЕНЕ картинки (BUG-10): ключа нет — «без изменений», `''` — «картинки нет»; main помнит последнюю и досылает её дисплею при открытии, виджету и часам — никогда |
| `get-timer-state` | панель, виджет, часы, дисплей | Request current timer state |
| `get-displays` | панель | Request list of available displays |
| `open-releases-page` | панель | Без payload: main открывает страницу релизов через `shell.openExternal`, адрес — КОНСТАНТА в main. URL из рендерера означал бы выполнение произвольного адреса руками ОС |
| `open-widget` / `close-widget` | open-widget: панель, часы, дисплей; close-widget: панель, виджет, часы, дисплей | Toggle widget window |
| `open-display` / `close-display` | open-display: панель, виджет, часы; close-display: панель, виджет, часы, дисплей | Toggle display window |
| `open-clock-widget` / `close-clock-widget` | open-clock-widget: панель, виджет, дисплей; close-clock-widget: панель, виджет, часы, дисплей | Toggle clock widget |
| `resize-control-window` | панель | `{ width, height }` — validated with `Number.isFinite` + min bounds |
| `control-drawer` | панель | `{ open }` — ящик настроек. Отдельный канал: потолок окна двухуровневый (760×740 по содержимому, 1096×1100 с ящиком), и из ширины запроса уровень не выводится |
| `control-collapse` | панель | `{ collapsed, height }` — свернуть панель в полосу. Отдельный канал: `resize-control-window` зажимает высоту минимумом окна (660). Снимает и возвращает пол `minHeight`, держит ВЕРХНИЙ край, `height` в 36…120 |
| `widget-resize` / `widget-move` / `widget-set-position` | виджет | Геометрия виджета. `widget-move` несёт `{deltaX, deltaY, first}`: `first` помечает начало жеста, и main держит размер окна до конца перетаскивания |
| `clock-widget-resize` / `clock-widget-set-style` / `clock-widget-settings` | clock-widget-resize: панель, часы; clock-widget-set-style: панель; clock-widget-settings: панель | Clock widget controls |
| `clock-widget-move` | часы | `{ deltaX, deltaY }` — move clock widget window |
| `clock-widget-set-position` | часы | `{ x, y }` — restore saved clock position (clamped to a live display) |
| `display-move` | дисплей | `{ deltaX, deltaY }` — move display window in windowed mode |
| `display-layout` | панель | `{ layout }` — применить раскладку (имя проверяется по реестру `display-layouts.js`). Отдельный канал: раскладка — действие, а не состояние; шлётся ПОСЛЕ тумблеров |
| `sound-toggle` | виджет, часы, дисплей | Без payload: окно просит панель переключить мастер-звук (клавиша `Z`). Значение принадлежит панели — она же и играет; присланное окном значение спорило бы с ней. Тот же приём, что у `preset-apply` |
| `event-finish` | панель | Скрытый режим «47-й этаж»: завершить мероприятие — закрыть текущий перелимит и заморозить итог. Полезной нагрузки нет: величину знает главный процесс |
| `event-reset` | панель | Скрытый режим «47-й этаж»: новое мероприятие — обнулить накопитель. Полезной нагрузки нет |
| `event-export` | панель | Скрытый режим «47-й этаж»: выгрузить отчёт о перелимите в CSV. Полезной нагрузки нет: журнал и итог живут в главном процессе, ставка и название мероприятия приходят туда же с `display-settings-update` |
| `ui-theme-update` | панель | `{ theme: 'dark' \| 'light' }` — sent by the panel only; main validates against a whitelist and relays to ALL windows (the one channel that IS broadcast, because the theme is app-wide) |
| `ui-lock-update` | панель | `{ locked }` — замок «Закрепить положение»; main рассылает всем окнам (как тему) |
| `display-restore-state` | панель | Без payload: пресет вернул в профиль места и масштабы карточек — дисплей перечитывает их |
| `report-scale` | виджет, часы, дисплей | `{ source, scalePct }` — окно сообщает свой масштаб панели |
| `display-block-hidden` | дисплей | `{ block }` — блок закрыт крестиком в окне, панель снимает его тумблер |
| `toggle-fullscreen` | дисплей | Toggle fullscreen on the sender's window |
| `reset-and-relaunch` | панель | Clear all storage and quit |
| `minimize-window` / `quit-app` | minimize-window: панель, дисплей; quit-app: панель | Window management |

### Receive (main → renderer)

Кто слушает каждый канал — `RECEIVERS` в `ipc-senders.js` (из неё собраны мосты
окон); здесь только смысл и payload.

| Channel | Payload |
|---------|---------|
| `timer-state` | Full `timerState` object (see below) — broadcast every second to all four windows (clock: Space needs `isRunning`) + snapshot on load |
| `widget-colors-update` | `{ timer, progress }` — per-window |
| `clock-colors-update` | `{ timer, progress }` — per-window |
| `display-colors-update` | `{ timer, progress }` — per-window |
| `widget-style-update` | `{ timerStyle, timerScale }` |
| `timer-minute` | Fired when 1 minute remains |
| `timer-reached-zero` | Fired at 00:00 |
| `timer-overrun-minute` | Fired every N minutes in overrun mode |
| `display-settings-update` | Display settings object |
| `display-layout` | `{ layout }` — дисплею: разложить элементы по готовой раскладке |
| `sound-toggle` | Без payload: панели — переключить мастер-звук (см. одноимённый канал в send) |
| `event-overrun-state` | Дисплею И панели: `{ overrunSeconds, finished, excludedLiveSeconds }` — накопитель перелимита мероприятия. СЕКУНДЫ, а не рубли: ставку знает окно, и поправленная посреди мероприятия она обязана пересчитать накопленное. Дисплей рисует деньги залу, панель отчитывается оператору строкой «Идёт / Завершено»; итог оба собирают ОДНОЙ `MoneyMeter.eventSummary`. Payload собран в одном месте (`eventOverrunPayload()`) — рассылка и гидратация окна расходились полем `excludedLiveSeconds` |
| `event-export-done` | Результат выгрузки: `{ ok, canceled, path, rows, error }`. Ответ обязателен в любом исходе, кроме отмены — кнопка без ответа читается как сломанная |
| `displays-list` | Array of available displays |
| `set-clock-style` / `clock-settings` | Clock widget settings |
| `display-window-state` / `widget-window-state` / `clock-window-state` | `{ isOpen }` |
| `ui-theme-update` | `{ theme }` — applied by `UITheme.bindThemeSync()` in every window |
| `window-geometry` | `{x, y, width, height}` — НАСТОЯЩИЕ границы окна от главного процесса. Виджет и часы пишут в `localStorage` их, а не свои `outerWidth`/`screenX`: на мониторе с масштабом ≠ 100 % это разные единицы |
| `timer-recovery-available` | The crash snapshot (`{ presetSeconds, totalSeconds, remainingSeconds, savedAt }`), sent to the control window once on `did-finish-load`. Main restores the time itself; this only tells the panel to say so (a toast) |


## Timer state

`timer-state` payload (перенесено из `CLAUDE.md`; собирает `patch()` в
`timer-controller.js`):

```js
{
    totalSeconds: 300,        // Original preset duration
    remainingSeconds: 245,    // Current remaining (negative = overrun)
    presetSeconds: 300,       // Preset for reset (survives on-the-fly adjustments)
    isRunning: true,          // Timer is actively counting
    isPaused: false,          // Timer is paused
    finished: false,          // Timer reached zero (latched until reset)
    overrunLimitSeconds: 0,   // Config stamped on every patch
    allowNegative: false,     // Config stamped on every patch
    timestamp: 1790000000000, // Wall clock of the patch — NOT used for ordering
    updateCounter: 42         // Monotonic counter for reliable sync
}
```

Отсчёт внутри — по монотонным часам (`performance.now`), сон машины
засчитывается через `powerMonitor` suspend/resume; `timestamp` только штамп.
