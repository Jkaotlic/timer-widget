# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm start              # Run app (Electron)
npm run dev            # Run with DevTools auto-open (--dev flag)
npm test               # Run tests (Node.js built-in test runner)
npm run lint           # ESLint
npm run ci             # lint + test
npm run build          # Build for current platform (electron-builder)
npm run build:mac      # Build macOS (DMG + ZIP)
npm run build:win      # Build Windows (NSIS + Portable)
```

Tests use `node --test` (no framework). Test files live in `tests/`. Run a single test with `node --test tests/time-utils.test.js`.

## Architecture

Multi-window Electron desktop timer app. Vanilla JavaScript — no UI frameworks, no bundler.

### Process Model

**Main process** (`electron-main.js`) is the single source of truth for timer state. It manages 4 renderer windows and synchronizes them via IPC:

1. **Control Window** (`electron-control.html`) — main management panel. Settings live in a slide-out drawer. Default 400px wide (`CONFIG.CONTROL_WINDOW_WIDTH`), min 380; the drawer adds ~336px. Inline there remains only `TimerController` plus bootstrap — see **Control panel modules**.
2. **Widget Window** (`electron-widget.html`) — transparent, frameless, always-on-top mini-timer. 4 styles: circle, flip, analog, digits (LED слит с «Цифрами» 13.08.2026). Glassmorphism design.
3. **Display Window** (`display.html` + `display-script.js`) — fullscreen timer for presentations. 4 styles: circle, flip, analog, digits. Has a `DisplayTimer` class.
4. **Clock Widget** (`electron-clock-widget.html`) — independent clock widget. 4 styles: circle, flip, analog, digits. Glassmorphism design.

### IPC Communication

- `preload.js` exposes `window.electronAPI` with a channel whitelist (`ALLOWED_CHANNELS`). Context isolation and sandbox are enabled on all windows.
- `ipc-compat.js` provides backward compatibility mapping old `ipcRenderer` calls to the new `electronAPI`.
- Control window sends commands (`timer-command`, `widget-colors-update`, `display-settings-update`); main process broadcasts state (`timer-state`) to all windows every second.
- Per-window color channels: `widget-colors-update`, `clock-colors-update`, `display-colors-update` — each window gets only its own colors (no global broadcast).
- Timer state uses a monotonic `updateCounter` (not timestamps) for reliable sync.

### Control panel modules

`electron-control.html` used to be a 7300-line god-file (CSS + markup + all logic in one inline script). It was the project's main source of duplicated-logic bugs — you cannot see a duplicate in a file that size. It is now split:

| File | Owns |
|------|------|
| `display.css` | Все стили полноэкранного окна. Подключается ПОСЛЕДНИМ: в нём пин палитры поверх `design-tokens.css`; порядок закреплён тестом |
| `control.css` | Все стили панели. Подключается ПОСЛЕДНИМ из трёх таблиц (порядок несущий, закреплён тестом), здесь же сброс и `box-sizing` |
| `flip-card.css` | Механика перекидыша (split-flap), одна копия на три окна. Слои строит `flip-card.js` из КЛОНОВ цифры |
| `fonts.css` | 20 локальных `@font-face`, одна копия на четыре окна. Подключается ПЕРВЫМ |
| `settings-schema.js` | Таблица настроек (ключ → контрол → умолчание), `applyStoredSettings` / `collectSettings` / `resetKeys` |
| `sound-bank.js` | 33 звука на осцилляторах: мастер-каскад с лимитером, ЗАМЕРЕННАЯ нормализация `PRESET_GAIN` |
| `sound-presets.js` | Реестр звуков панели: id → подпись → каким событиям предлагать. Списки строит сам |
| `custom-sounds.js` | Звуки пользователя: файл, список, проигрывание, удаление. **Примесь** |
| `local-background.js` | Картинка фона дисплея: загрузка, MIME + сигнатура, превью, вписывание. **Примесь** |
| `color-picker.js` | HSV picker (`ColorPicker`) + `addPickerToggle()` |
| `ui-feedback.js` | `Toast` and `LoadingIndicator` |
| `modal-manager.js` | `openModal`/`closeModal` with focus trap and focus return |
| `shortcuts-help.js` | The F1 shortcuts overlay |
| `onboarding.js` | Подсказка про F1 при первом запуске (флаг `onboardingShown` ставится ДО показа) и кнопка обновлений |
| `mini-bar.js` | Режим «полоса»: класс `collapsed` на `<body>`, панель отдаёт ЗНАЧЕНИЯ через `render()`, размер меняет main |
| `panel-colors.js` | Цвета окон — **примесь**: ОДНА сборка объекта цветов (`updateColors(target, patch)`, `null` = сброс поля) и ряд «Фон» (разметку строит сам) |
| `panel-titlebar.js` | Кнопки темы и замка: обе величины ОБЩИЕ для четырёх окон; у замка две кнопки при одной привязке |
| `panel-presets.js` | Ячейки вида: клик применяет, Shift+клик пишет, Ctrl+1…4 то же; применение — ТЕМ ЖЕ путём, что запуск панели |
| `panel-drawer.js` | Ширина колонки при открытом ящике: предсказание финальной (повторяет обрезку main) |
| `panel-display.js` | Настройки дисплея — **примесь**: ОДНА сборка payload `display-settings-update`, тумблеры, раскладки, крестик |
| `display-layouts.js` | Реестр элементов дисплея (id → тумблер → вид → подпись), масштабы, пять раскладок; координаты — доли для ЦЕНТРА |
| `panel-state.js` | Четыре состояния панели — **примесь**: класс `state-*`, ОДНА сборка payload `widget-style-update`, ввод, мастер-звук |
| `scale-input.js` | Click-to-edit / double-click-to-reset on scale % |
| `font-select.js` | Список шрифтов «Цифр»: `div.font-select` притворяется форм-контролем с `.value` (три в документе) |

Rules when working here:

- **No bundler.** Every file is a classic `<script>`, so cross-module references go through `window.X`. A bare name resolves only by accident via the global scope and breaks lint.
- **Several are prototype mixins** (`Object.assign(TimerController.prototype, window.XMixin)`), not free functions: their methods call each other and the controller's `this.beep()`, and DOM handlers close over `this`. If the `Object.assign` line is lost, nothing fails at load; it fails at the first click.
- **Every new module must go into `package.json` `build.files`** or it silently vanishes from the packaged app; two tests guard this.
- **When you touch a self-contained block still living inline, move it out** instead of editing it in place.
- **A setting's key, control and default belong in `settings-schema.js` — in ONE row.** `loadSettings()` keeps only what the table cannot express: the two keys with their own format (`MANUAL_KEYS`) and the side effects. `tests/settings-schema.test.js` fails if a second copy of a default reappears

### Shared Modules

- `constants.js` — all magic numbers, IPC channel names, storage keys, theme definitions, dimension limits
- `utils.js` — `formatTime()`, `formatTimeShort()`, `parseTime()`, `debounce()`, `getTimerStatus()`, `calculateProgress()`, `safelySendToWindow()`
- `security.js` — input validation (`isValidDataURL`, `isValidURL`, `validateImageSource`), `escapeHTML()`, `safeJSONParse()`
- `renderer-shared.js` — чистая логика, которую иначе копировало бы каждое окно: `breakdown`, `flipCells`, `clampScale`, `fitBlockScale`, `timerLifecycleStatus`, `timerColorBand`, `pickOwnSetting`, `endsAt`, тона, `surfacePaint`, `topBandReserve`
- `surface-tones.css` — ОДНА палитра на виджет, часы и дисплей: два блока тона, поверхности `--style-*`, полосы состояния. Класс тона ставит `UITheme.applyTone()` по яркости фона
- `window-geometry.js` — перетаскивание, размер и позиция виджета и часов плюс `fitRestoredBounds`. Проверяется в Node на поддельных хранилище и DOM
- `clock-settings-schema.js` — the clock's settings table (key → control → default) plus `collectClockSettings` / `applyClockSettings`
- `digits-style.js` — стиль «Цифры»: реестр шрифтов, `resolveFont()`, подгонка. Кегль — ЗАМЕР строки `88:88` на пробе 100px, а не константа на символ
- `ui-lock.js` — замок «Закрепить положение»: ключ `uiLocked`, класс `ui-locked` на `<html>`. Запрещает ЖЕСТЫ, но не настройки
- `presets.js` — четыре ячейки вида: снимок ЗНАЧЕНИЙ ключей профиля (`PRESET_KEYS`). Без картинки фона и геометрии окон — почему, в модуле
- `ui-theme.js` — the only owner of `data-theme` and of the tone class `on-light-bg` (`applyTone` / `initTone` / `bindThemeSync`). The pure part is unit-tested; the DOM/storage part loads in all four windows from `<head>`

### Key Patterns

- Window references are global (`controlWindow`, `widgetWindow`, `displayWindow`, `clockWidgetWindow`). Always use `safelySendToWindow()` to avoid "Object has been destroyed" crashes.
- Renderer windows persist settings in `localStorage`. Storage keys are defined in `constants.js` (`STORAGE_KEYS`).
- Each HTML file is self-contained with inline `<script>` and `<style>` blocks (CSP allows `unsafe-inline`).
- JS-based window drag: Widget and clock windows use JavaScript mousedown/mousemove + IPC (`widget-move`, `clock-widget-move`) instead of `-webkit-app-region: drag`. This is because on Windows, transparent frameless windows with `drag` on parent elements intercept ALL mouse events before `no-drag` children.
- Scaling: Widget and clock — Ctrl+wheel (30–600 %, пол окна = размер при 30 %). Display — Ctrl+wheel context-sensitive (hover on info-block → block scale, else → timer) + Shift+wheel for blocks.

## Code Style

- 2-space indentation, single quotes, camelCase for variables/functions, UPPER_CASE for constants
- ESLint 9 with flat config (`eslint.config.js`) enforces `eqeqeq: always` and `curly: always`
- Unused variables prefixed with `_` are allowed (`argsIgnorePattern: '^_'`)

## Security

- All BrowserWindows: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- `hardenWindow()` applied to all windows: blocks `will-navigate` to non-file:// URLs, denies `window.open`
- IPC channel whitelist in `preload.js` with direction validation (send vs receive)
- All IPC resize/move/opacity handlers validate numeric inputs (bounds, NaN, Infinity)
- Image validation: size + MIME + magic bytes (WebP checks RIFF+WEBP signature)
- SVG excluded from data URL whitelist (XSS vector)
- Audio upload rejects empty `file.type`
- CSS injection prevented: color values validated with regex, URLs validated with `URL()` constructor
- Timer state: `presetSeconds` tracks original preset for correct reset after on-the-fly adjustments

## IPC

Каналы, их направление и payload — в [docs/ipc.md](docs/ipc.md). Правило: новый
канал объявляется в `channel-validator.js` И `preload.js`, у него обязаны быть
ОБА конца (`tests/ipc-liveness.test.js` проверяет), а сама таблица живёт в
`docs/ipc.md`, чтобы не занимать контекст каждого разговора.

## Timer State Structure

Broadcast via `timer-state` channel every second:

```js
{
    totalSeconds: 300,        // Original preset duration
    remainingSeconds: 245,    // Current remaining (negative = overrun)
    presetSeconds: 300,       // Preset for reset (survives on-the-fly adjustments)
    isRunning: true,          // Timer is actively counting
    isPaused: false,          // Timer is paused
    finished: false,          // Timer reached zero (latched until reset)
    updateCounter: 42         // Monotonic counter for reliable sync
}
```

## Testing

Tests use the Node.js built-in test runner (`node --test`). Test files in `tests/`.
Do NOT hardcode the count anywhere — in code, in CI, or in this file. Run `node --test` to get it.

Two flavours of test live here:

- **Behavioural** — pure modules (`utils`, `security`, `timer-engine`, `timer-controller`,
  `recovery`, `renderer-shared`, `renderer-storage`, `color-utils`) are imported and exercised.
- **Source-level** — logic that lives inside inline `<script>` blocks in the HTML windows
  cannot be imported, so those tests read the file and assert on its source. Keep asserting
  BOTH the presence of the correct behaviour and the absence of the old broken one, otherwise
  a regression slips back silently.

| File | Covers |
|------|--------|
| `time-utils.test.js` | `formatTime`, `formatTimeShort`, `parseTime`, `parseManualTime` |
| `security.test.js` | `isValidDataURL`, `isValidURL`, `validateImageSource`, `safeJSONParse`, `escapeHTML` |
| `security-extended.test.js` | `safeSetBackgroundImage` |
| `status-progress.test.js` | `getTimerStatus`, `calculateProgress` |
| `validation-utils.test.js` | `isValidNumber`, `clamp` |
| `debounce-send.test.js` | `debounce`, `safelySendToWindow` |
| `channel-validator.test.js` | `isValidChannel`, `ALLOWED_CHANNELS`, preload/validator sync |
| `ipc-liveness.test.js` | Every whitelisted channel has BOTH ends. The whitelist is a permission, not proof of life |
| `edge-cases.test.js` | Edge cases for all utils |
| `constants.test.js` | CONFIG immutability and structure, plus the orphan check — every key needs a reader outside `constants.js` and this test |
| `timer-engine.test.js` | `tick`/`adjust`/`reset`/`setPreset` arithmetic + boundary events |
| `timer-controller.test.js` | State machine with a fake clock (start/pause/reset/reconcile) |
| `recovery.test.js` | Crash-recovery persist/load/validate |
| `renderer-shared.test.js` | `breakdown`, `flipCells`, `clampScale`, `surfacePaint`, `fitBlockScale`, `topBandReserve`, `heroFrameShrink` |
| `renderer-storage.test.js` | Quota-safe localStorage helpers |
| `display-layouts.test.js` | Реестр ↔ тумблеры в оба конца, масштабы, доли в пиксели, непересечение раскладок |
| `panel-colors.test.js` | Сборка объекта цветов (патч дополняет, `null` удаляет), проводка и подложка в обоих окнах у пяти стилей |
| `color-utils.test.js` | HSV↔RGB↔HEX conversion |
| `settings-schema.test.js` | The settings table: defaults, legacy-key fallbacks, collect/apply roundtrip, on a fake document |
| `display-timer.test.js` | `validateBlockPositions`, `canSafelyStore` |
| `perf.test.js` | Hot-path performance budgets |
| `packaging.test.js` | Каждый ресурс перечислен в `build.files` |
| `electron-main-source.test.js` | IPC payload hardening, DevTools gating, icon path |
| `visual-source.test.js` | Layout/centering invariants, release-doc freshness |
| `audit-2026-07-fixes.test.js` | Regressions from the July 2026 audit (sound, Esc, scales, geometry) |
| `audit-2026-07-30-fixes.test.js` | Regressions from the 30 Jul 2026 pass (flip, finish flash, geometry, modifiers, F1) |
| `storage-keys.test.js` | `CONFIG.STORAGE_KEYS` matches the keys the code uses — both directions; no key is write- or read-only |
| `contrast.test.js` | WCAG contrast WITH alpha compositing, BOTH themes (dark ≥ AA, light ≥ AAA), light surface ladder, accents on accent fills |
| `ui-lock.test.js` | Замок: логика на поддельном хранилище, модуль в 4 окнах, канал в оба конца, вопрос к замку в КАЖДОМ жесте |
| `presets.test.js` | Пресеты вида: состав снимка (включая записанное ОТСУТСТВИЕ), сравнение по подмножеству, рейс, квота |
| `ui-theme.test.js` | Theme logic + wiring: module → four windows' `<head>` → channel in both whitelists → main's relay → panel button |
| `faq-and-hidden-controls.test.js` | Clock settings reachable (no `display:none`), ONE accordion handler, help matches UI, footer version == package.json, dead CSS deleted |
| `release-notes.test.js` | Заметки к релизу — из CHANGELOG, таблица загрузок совпадает с `build.target`, обещания в шапке не протухли |
| `e2e-window-sizes.test.js` | Выбор размеров окна для e2e: помещающиеся, вывод из рабочей области, пол; ошибка делает спеку ХОЛОСТОЙ |
| `window-geometry.test.js` | Drag + geometry on fake storage/DOM: restore, save, scale bounds, quota, modifier guard, drag target |
| `window-top-edge.test.js` | Три условия верхнего края: `enableLargerThanScreen`, уровень `status`, поджатие по границам экрана |
| `clock-settings-schema.test.js` | Clock settings table: collect/apply roundtrip, defaults, stored `false` vs missing |
| `window-open-ownership.test.js` | Every create-function announces and hydrates its own window; tray binding in `createControlWindow` |
| `settings-key-ownership.test.js` | `pickOwnSetting` + wiring: display/widget read their OWN key, ticks have one owner |
| `color-validation-single-owner.test.js` | One colour validator (`SecurityUtils.isSafeColor`); weaker copies stay gone |
| `release-gates.test.js` | DevTools guarded on EVERY window, isolation, no external URLs, local fonts, no auto-update, CSP per window, Linux sandbox scoped to AppImage |
| `docs-integrity.test.js` | Связность `CLAUDE.md` ↔ `docs/lessons.md`: ссылка ведёт в разбор, разбор достижим; плюс потолок размера |
| `onboarding.test.js` | Подсказка первого запуска: один раз, флаг ДО показа, сломанное хранилище не роняет; канал релизов БЕЗ payload |
| `flat-surfaces.test.js` | Инвариант «плоско»: ни блюра, ни прозрачных тёмных поверхностей, ни свечений; пятая проверка — САМ разбор |
| `digits-style.test.js` | Реестр «Цифр» в ТРИ стороны: файлы шрифта, объявление в `fonts.css`, отсутствие сирот; плюс `resolveFont` и подгонка |
| `block-labels.test.js` | Свои подписи плашек: реестр ↔ разметка, разбор ввода, строка таблицы, одна сборка payload |
| `money-meter.test.js` | Деньги за перелимит: ступень периода, сложение секунд ДО цены, сводка мероприятия |
| `floor-47.test.js` | Скрытый режим: каналы в оба конца, реестр, секция панели, заморозка итога, одна сборка payload |
| `display-proportions.test.js` | Размеры карточек ведутся от полосы содержимого, потолка у кегля нет, мера — в `:root` |
| `scale-range.test.js` | Диапазон масштаба: пол окна = размер при `MIN_SCALE_PCT`, минимум квадратный, базы окон = реестру, умолчание блоков одно, пределы блоков без копий |
| `escape-keeps-windows.test.js` | Esc не гасит ни одно из четырёх окон; зонд проверяет себя буквами W/C/D |

e2e specs (`npx playwright test`, `workers: 1`):

| File | Covers |
|------|--------|
| `app.spec.js` | Boot, presets, start/pause/reset round trip |
| `status-and-colors.spec.js` | Colour bands, status priority, Esc layering, overrun limit, module wiring |
| `flip-animation.spec.js` | Перекидывание ВИДНО в трёх окнах: створки меряются покадрово, не по классу |
| `flip-hours-layout.spec.js` | Flip separator stays dots (never a glyph) in H:MM:SS, measured |
| `window-state-sync.spec.js` | A window loaded second knows which windows are already open |
| `dial-ticks.spec.js` | Dial tick marks toggle reaches widget + clock and survives reopen |
| `overtime-palette.spec.js` | Overtime is red in display + widget — digits, glow and status chip |
| `analog-hour-hand.spec.js` | Display's analog hour hand angle at 5 min / 1 h / 1:30 / 6 h |
| `ui-lock.spec.js` | Замок ПО КЛИКУ: карточка и окно виджета не двигаются, колесо не масштабирует, панель управляет, замок снимается |
| `presets.spec.js` | Пресеты ПО КЛИКУ и с клавиатуры: записали вид, перенастроили, вернули; горит ровно одна ячейка |
| `ui-theme.spec.js` | Светлая тема доезжает до четырёх окон (ВЫЧИСЛЕННЫЕ токены), переживает перезагрузку, красит контролы |
| `drawer-layout.spec.js` | Settings drawer never overlaps the panel — measured rectangles at normal AND max window width |
| `sound-events.spec.js` | Каждое событие звучит РОВНО раз: минута, ноль (± перерасход), интервал, старт из клика и окна |
| `sound-levels.spec.js` | Громкость КАЖДОГО звука числом: `OfflineAudioContext`, пик −9…−0.1 dBFS, RMS; замер проверяет себя тишиной |
| `sound-tab-layout.spec.js` | Вкладка «Звуки» ЧИСЛОМ: подписи влезают, списки в одной вертикали, строки без рамок (зонд проверяет себя) |
| `crash-recovery.spec.js` | SIGKILL → перезапуск возвращает время и НЕ стартует сам; чистый выход без следов |
| `settings-roundtrip.spec.js` | Настройки четырёх хранилищ переживают перезагрузку; отдельно стиль часов и тема |
| `window-drag-geometry.spec.js` | Перетаскивание двигает НАСТОЯЩЕЕ окно на точную дельту и пишет `{scalePct,x,y}` |
| `reachable-controls.spec.js` | Help accordion by mouse AND keyboard; clock toggles really change the clock window |
| `digits-style.spec.js` | «Цифры» доезжают до трёх окон ПО КЛИКУ: кегль подогнан, шрифт в СВОЁМ окне, подгонка идемпотентна |
| `window-drag-size.spec.js` | Жест перемещения не наследует размер, изменённый посреди него (за WM_DPICHANGED — `win.setSize()`) |
| `window-scale-fit.spec.js` | После масштабирования виджет и часы целиком в рабочей области СВОЕГО экрана; потерянное возвращается |
| `window-top-edge.spec.js` | Виджет и часы доезжают до САМОГО верха экрана (y = 0, а не y рабочей области) и остаются там после переоткрытия |
| `color-ownership.spec.js` | Окраска: 5 стилей × 4 полосы × 2 окна, ВЫЧИСЛЕННЫЕ цвет и тень на тёмном тоне |
| `onboarding-reachable.spec.js` | Кнопка «Проверить обновления» ВИДИМА и не схлопнута; не кликается — открылся бы браузер |
| `color-band-reset.spec.js` | Выход из полосы снимает ВСЁ, что она нарисовала: на чистом профиле и с выбранным цветом |
| `panel-states.spec.js` | Четыре состояния панели ПО КЛИКУ: какая кнопка и каким словом названа, есть ли пресеты и ряд ± |
| `window-surface-color.spec.js` | Фон виджета и часов ПО КЛИКУ: подложка стиля, прозрачность 0, сброс, тема не стирает фон, окна независимы |
| `display-blocks.spec.js` | Блоки дисплея: тумблер гасит СВОЙ блок, крестик снимает СВОЙ тумблер, подпись тащится |
| `display-timer-scale.spec.js` | Масштаб таймера дисплея во всех стилях: настройки, Ctrl+колесо, восстановление |
| `style-tone.spec.js` | Тон ПО КЛИКУ: светлая тема — светлые виджет и дисплей, тёмная заливка держит текст светлым |
| `display-layouts.spec.js` | Масштаб элементов порознь, пять раскладок ПО КЛИКУ, независимость от прошлого масштаба |
| `display-top-band.spec.js` | Карточка сверху не ложится на подпись «Осталось»: размеры окна ЧИСЛОМ × 4 стиля |
| `display-block-frames.spec.js` | Задней рамки у блоков нет: 4 стиля × 2 темы, замер заливки, тени, размытия |
| `display-block-plate.spec.js` | На ЦВЕТНОМ градиенте у блоков и плашки плиты нет, а у карточки таймера есть |
| `display-timer-drag.spec.js` | Таймер тащится Alt'ом на точную дельту, тянет подпись, переживает переоткрытие, слушается замка |
| `sound-hotkey.spec.js` | `Z` переключает звук из панели и из виджета; тумблер строки и чекбокс согласны |
| `block-labels.spec.js` | Своё название плашки доезжает до окна ПО КЛИКУ, стирается в стандартное, переживает перезапуск |
| `floor-47.spec.js` | Скрытый режим ПО КЛИКУ: разблокировка тройным кликом, деньги, ЗАМОРОЗКА итога числом, отчёт, справка |
| `display-proportions.spec.js` | Карточка занимает ОДНУ долю полосы на 16:9 и 4:3; снимается при разбросе полос меньше ×1.6 |
| `scale-range.spec.js` | Пол масштаба ДОСТИЖИМ, окно квадратно на всей лестнице, каждая ступень меняет размер; растянутое за край доезжает до ползунка |
| `windows-load-clean.spec.js` | Четыре окна грузятся без ошибок консоли (ловит столкновение имён верхнего уровня); зонд проверяет себя |
| `display-timer-width.spec.js` | Размер цифр — ФУНКЦИЯ процента, а не порядка посылок; потолок в чернила; рама не крадёт клик |

## CI

GitHub Actions (`.github/workflows/nodejs.yml`), Node 22, three jobs:

| Job | Where | What |
|-----|-------|------|
| `build` | ubuntu-latest | `npm run ci`, затем неблокирующие `visual:check` под xvfb и `coverage`. Визуальному шагу нужен `chmod 4755` + root на `chrome-sandbox`, иначе Chromium падает с кодом 133 |
| `e2e` | ubuntu + windows + macos | `npx playwright test` — the ONLY thing exercising the real Electron runtime. Linux under `xvfb-run`; `fail-fast: false`; report uploaded per-OS on failure |
| `pack` | ubuntu + windows | `electron-builder --dir`, then `node scripts/verify-packed.js` (assets + release gates on the real `app.asar`) |
| `linux-sandbox` | ubuntu-latest | builds deb + AppImage, then `node scripts/verify-linux-sandbox.js`: deb's postinst sets SUID + root owner and its `.desktop` has NO `--no-sandbox`; the AppImage's `.desktop` DOES. This cannot be checked from macOS at all |

Release workflow builds on macOS (Intel + ARM) and Windows with Node 22.

- **`pack` catches what `tests/packaging.test.js` cannot**: the unit test checks
  the *list* in `package.json`, `verify-packed.js` opens the real `app.asar`
  (that is how `design-tokens.css` went missing in 2.3.2). It parses the asar
  header by hand, and `tests/verify-packed.test.js` validates that parser
  against the **real** `default_app.asar`, not only a synthetic fixture.

## Gotchas
Каждый пункт — правило, которое можно нарушить и не заметить. Полный разбор
каждого (история, замеры, что именно ввело в заблуждение) — в
[docs/lessons.md](docs/lessons.md). Перед работой над подсистемой прочитайте её
разбор: правило говорит ЧТО делать, разбор — почему все предыдущие попытки
сделали иначе.

- **Диапазон масштаба обязан быть ДОСТИЖИМ: пол окна = его размер при `MIN_SCALE_PCT`, ОДИНАКОВЫЙ по осям (иначе окно не квадрат) (CRITICAL)** — [разбор](docs/lessons.md#a-promised-range-must-be-reachable-at-both-ends)
- **Счётчик масштаба не обновляют из `outerWidth`, прочитанного В событии `resize`: там окно ещё прежнего размера — владелец величины один, модуль геометрии** — [разбор](docs/lessons.md#a-scale-counter-must-not-be-refreshed-from-a-stale-outerwidth)
- **`window-geometry` шлётся и по СВОИМ событиям окна (`resize`/`move`): размер меняют не только через IPC** — [разбор](docs/lessons.md#the-main-process-must-report-geometry-on-its-own-events-too)
- **Без сборщика ОБЪЯВЛЕНИЕ верхнего уровня общее: второй `const X` роняет весь inline-скрипт окна** — [разбор](docs/lessons.md#without-a-bundler-a-top-level-name-is-shared-by-the-whole-document)
- **Замок запрещает ЖЕСТЫ, а не настройки: спрашивать его обязан КАЖДЫЙ жест — перетаскивание, колесо, крестик** — [разбор](docs/lessons.md#a-lock-forbids-gestures-not-settings)
- **Пресет вида хранит ЗНАЧЕНИЯ ключей профиля и применяется тем же путём, что запуск панели** — [разбор](docs/lessons.md#a-preset-is-the-profile-not-a-second-description-of-it)
- **«Применён» — СРАВНЕНИЕ по ПОДМНОЖЕСТВУ полей снимка; отсутствие ключа снимок ЗАПИСЫВАЕТ (`null` = «убери»)** — [разбор](docs/lessons.md#applied-is-a-comparison-not-a-memory)
- **Стиль меняет ГАБАРИТ карточек, а место — доля ЦЕНТРА: после стиля, шрифта и масштаба пересчитать места** — [разбор](docs/lessons.md#a-style-switch-changes-the-size-and-the-position-is-a-centre)
- **Цвет окна ставится И СНИМАЕТСЯ: односторонняя запись = несбрасываемая настройка; подложка — `var(--surface-paint, …)` (CRITICAL)** — [разбор](docs/lessons.md#the-window-background-is-a-setting-not-a-hit-test-hack)
- **Палитра окон без своего фона — ОДНА (`surface-tones.css`), выбирает её ТОН, а не тема; поверхности стилей — токены `--style-*` (CRITICAL)** — [разбор](docs/lessons.md#one-palette-chosen-by-tone-not-three-pins)
- **Плита принадлежит ТАЙМЕРУ: на цветном фоне белеет вместе с тоном; блок повторяет стиль шрифтом и циферблатом** — [разбор](docs/lessons.md#a-plate-belongs-to-the-timer-not-to-the-block)
- **Шрифт стиля приходит блокам ПЕРЕМЕННОЙ: инлайн залипает после смены стиля** — [разбор](docs/lessons.md#a-block-repeats-the-style-with-the-same-tokens)
- **Таймер — восьмой подвижный элемент, но НЕ в реестре `display-layouts.js`; тащат за ЯКОРЬ — то, за что взялись** — [разбор](docs/lessons.md#the-timer-is-the-eighth-movable-element)
- **Подпись плашки: стандартное слово — в реестре, пустое поле = «верни стандартное»** — [разбор](docs/lessons.md#a-caption-is-a-setting-with-one-owner)
- **Поле payload, которому присваивают и которое не читают, — невыполненное обещание; формулу знает ОДНО место** — [разбор](docs/lessons.md#a-field-you-assign-and-never-read-is-a-broken-promise)
- **Две одинаковые кнопки рядом обещают равнозначность: необратимой нужны подпись, свой вид, гашение; `#id` классом не перебить** — [разбор](docs/lessons.md#two-identical-buttons-promise-two-equal-actions)
- **Место элемента — доля окна, значит и РАЗМЕР доля: потолок в `clamp()` делает одну раскладку двумя; мера окна — у `:root` (CRITICAL)** — [разбор](docs/lessons.md#a-position-is-a-fraction-so-the-size-must-be-one-too)
- **Полноэкранный переход ждут СОБЫТИЕМ: `setBounds` посреди него роняет Electron — а выглядит как срыв СЛЕДУЮЩЕГО теста** — [разбор](docs/lessons.md#a-fullscreen-transition-is-a-condition-not-a-duration)
- **Escape окон НЕ гасит: закрытие — за буквами W / C / D, Esc — за слоями интерфейса** — [разбор](docs/lessons.md#escape-does-not-close-windows)
- **Мастер-звук: владелец — чекбокс `#soundMasterEnabled`, тумблер строки — его ВИД, входы через `toggleSoundMaster`** — [разбор](docs/lessons.md#escape-does-not-close-windows)
- **Раскладка знает ВСЮ колонку героя и меряет её НЕСДВИНУТОЙ: величину, которую сама пересчитывает, обнуляй до замера** — [разбор](docs/lessons.md#a-layout-must-know-the-whole-hero-and-measure-it-unshifted)
- **Плита блока — ТРИ свойства (заливка, тень, `backdrop-filter`), снимается ОДИН раз в базе; сняв, пересчитай контраст** — [разбор](docs/lessons.md#a-plate-is-three-properties-and-removing-it-moves-the-backdrop)
- **Карточка сверху и центрированная колонка — два способа сказать «где»: колонка уступает полосу (отступ — на ПОЛОВИНУ себя), мало — рама (CRITICAL)** — [разбор](docs/lessons.md#a-fixed-card-and-a-centred-column-are-two-ways-to-say-where)
- **Полоса состояния следует ТОНУ яркостью: пишется ССЫЛКОЙ на акцент палитры — своего значения у неё нет** — [разбор](docs/lessons.md#a-state-band-follows-the-tone-too)
- **Раскладка меряет ОСЕВШИЙ `transform`: габарит из `offsetWidth`, переходы снимает `layout-settling` (CRITICAL)** — [разбор](docs/lessons.md#a-layout-must-measure-a-settled-transform)
- **Форму даёт содержимое: круг у `.mini-clock`, а не у блока; название переносится, время — нет** — [разбор](docs/lessons.md#the-circle-belongs-to-the-dial-not-to-the-block)
- **Контейнер стиля — это раскладка: `flex` по умолчанию СТРОКА** — [разбор](docs/lessons.md#a-style-container-is-also-a-layout-and-flex-defaults-to-a-row)
- **`top` + вертикаль `transform-origin` = половина padding-бокса; порог в экранных пикселях меряет окно** — [разбор](docs/lessons.md#two-ways-to-say-the-middle-and-a-threshold-that-measures-the-window)
- **Число в e2e берётся из окна, а не с твоего монитора; спека возвращает глобальное состояние** — [разбор](docs/lessons.md#a-test-that-passes-only-on-your-monitor)
- **Окно в e2e ждут УСЛОВИЕМ (`e2e/window-ready.js`), а не паузой: пауза — ставка на скорость машины** — [разбор](docs/lessons.md#a-window-is-waited-for-by-condition-not-by-pause)
- **Запрошенный размер окна ≠ выданный: считать по ФАКТИЧЕСКОМУ, пороги из `CONFIG`, расхождение печатать** — [разбор](docs/lessons.md#a-second-monitor-is-a-hidden-parameter-too)
- **«За краем экрана» — утверждение о СОЮЗЕ мониторов: точка «потеряно» — у внешнего края самого правого дисплея** — [разбор](docs/lessons.md#a-second-monitor-is-a-hidden-parameter-too)
- **Пин — это предсказание: считать его арифметикой подтверждающей стороны (CRITICAL)** — [разбор](docs/lessons.md#a-pin-is-a-prediction-and-predictions-must-copy-the-arithmetic)
- **У окна РОВНО ОДНА оболочка, а размер окна задаёт содержимое (CRITICAL)** — [разбор](docs/lessons.md#a-window-has-exactly-one-shell)
- **Тест, утверждающий ОТСУТСТВИЕ, обязан проверять сам себя — иначе зелёный значит и «чисто», и «регулярка не работает» (CRITICAL)** — [разбор](docs/lessons.md#an-invariant-test-must-be-verified-against-itself)
- **Долг, не закрываемый сегодня, фиксируется храповиком: число только убывает, и в нём записано условие запрета** — [разбор](docs/lessons.md#a-ratchet-beats-a-ban-when-the-debt-spans-stages)
- **Дисплей следует теме, но цвет текста решает ЯРКОСТЬ фона; класс палитры — на `<html>` (CRITICAL)** — [разбор](docs/lessons.md#the-display-follows-the-theme-but-the-background-owns-the-text)
- **Перед добавлением поля в payload соберите payload в одном месте** — [разбор](docs/lessons.md#a-payload-assembled-in-six-places-is-a-setting-you-will-forget)
- **Надпись — это обещание: если элемент обещает жест, у жеста должен быть обработчик** — [разбор](docs/lessons.md#an-interface-that-promises-what-it-does-not-do)
- **Пауза — модификатор состояния, а не его разновидность: действие, которое ничего не делает, читается как сломанное окно** — [разбор](docs/lessons.md#a-pause-that-only-offers-pause-reads-as-a-frozen-window)
- **Свернувшись в полосу, окно выходит из режимов, которые не может показать** — [разбор](docs/lessons.md#a-collapsed-window-must-leave-the-modes-it-cannot-show)
- **Подпись строки — отчёт: собирается из ДЕЙСТВУЮЩЕГО значения, обновляется на записи настроек, а не на тике** — [разбор](docs/lessons.md#a-subtitle-is-a-report-and-it-must-not-wait-for-a-tick)
- **A green test does NOT prove a feature is reachable (CRITICAL)** — [разбор](docs/lessons.md#a-green-test-does-not-prove-a-feature-is-reachable-critical)
- **Search for the identifier, not the CSS class** — [разбор](docs/lessons.md#search-for-the-identifier-not-the-css-class)
- **Source-level tests must strip comments before asserting absence** — [разбор](docs/lessons.md#source-level-tests-must-strip-comments-before-asserting-abse)
- **Window state must be SNAPSHOT to each window on load, not only broadcast on change (CRITICAL)** — [разбор](docs/lessons.md#window-state-must-be-snapshot-to-each-window-on-load-not-onl)
- **Resizing a window must hold its CENTRE, not its top-left corner (CRITICAL)** — [разбор](docs/lessons.md#resizing-a-window-must-hold-its-centre-not-its-top-left-corn)
- **Верхний край экрана достижим: поджимает `constrainFrameRect`, а не уровень окна (CRITICAL)** — [разбор](docs/lessons.md#the-top-edge-is-reachable-what-clamps-is-constrainframerect)
- **Восстановленная позиция сохраняет ПОЛОСУ ЗАХВАТА, а не всё окно; свисать за край можно (CRITICAL)** — [разбор](docs/lessons.md#a-restored-position-keeps-a-grabbable-strip-not-the-whole-window-critical)
- **Геометрию считает ГЛАВНЫЙ процесс и шлёт каналом `window-geometry`; `outerWidth`/`screenX` — запасной путь (CRITICAL)** — [разбор](docs/lessons.md#window-geometry-is-owned-by-the-main-process-critical)
- **Жест перемещения не меняет размер: размер ЗАДАЁТСЯ на каждом шаге, начало жеста помечает рендерер** — [разбор](docs/lessons.md#a-move-gesture-must-not-change-the-window-size)
- **Стиль LED слит с «Цифрами»: рамка стала фоном, окно квадратное, сохранённое `digital` переводит `migrateTimerStyle`** — [разбор](docs/lessons.md#the-led-style-was-merged-into-digits)
- **Перекидыш — ДВЕ створки, а не наклон карточки: `rotateX` без `perspective` даёт 2 % высоты, то есть ничего** — [разбор](docs/lessons.md#a-flip-is-two-leaves-not-a-tilted-card)
- **Скрытое окно не перерисовывается: `capturePage` отдаёт прошлый кадр, лечит прогревочный снимок, а не сон** — [разбор](docs/lessons.md#a-hidden-window-does-not-repaint-so-capturepage-returns-a-stale-frame)
- **Стенд ходит теми же путями, что приложение: стиль — через главный процесс, размер — ПОСЛЕ смены стиля** — [разбор](docs/lessons.md#the-capture-harness-must-drive-the-app-through-its-real-paths)
- **The geometry write must wait until the size has SETTLED (CRITICAL)** — [разбор](docs/lessons.md#the-geometry-write-must-wait-until-the-size-has-settled-crit)
- **Geometry is saved on `resize`, not only from Ctrl+wheel** — [разбор](docs/lessons.md#geometry-is-saved-on-resize-not-only-from-ctrlwheel)
- **A theme block must sit BELOW the shared `:root`, and its name must not appear above it (CRITICAL)** — [разбор](docs/lessons.md#a-theme-block-must-sit-below-the-shared-root-and-its-name-mu)
- **The surface ladder exists in BOTH themes and runs opposite ways** — [разбор](docs/lessons.md#the-surface-ladder-exists-in-both-themes-and-runs-opposite-w)
- **A hit area is grown with a pseudo-element, never with the box** — [разбор](docs/lessons.md#a-hit-area-is-grown-with-a-pseudo-element-never-with-the-box)
- **A colour default has an owner too, and the owner is CSS** — [разбор](docs/lessons.md#a-colour-default-has-an-owner-too-and-the-owner-is-css)
- **The e2e profile is shared, so a test that flips global state must flip it back** — [разбор](docs/lessons.md#the-e2e-profile-is-shared-so-a-test-that-flips-global-state)
- **An unreachable theme is an untested theme** — [разбор](docs/lessons.md#an-unreachable-theme-is-an-untested-theme)
- **`design-tokens.css` holds tokens, not recipes** — [разбор](docs/lessons.md#design-tokenscss-holds-tokens-not-recipes)
- **Opening a window has ONE owner — the create-function (CRITICAL)** — [разбор](docs/lessons.md#opening-a-window-has-one-owner-the-create-function-critical)
- **A setting field needs an owner too, not just the key (CRITICAL)** — [разбор](docs/lessons.md#a-setting-field-needs-an-owner-too-not-just-the-key-critical)
- **Tests and screenshots run in their OWN profiles** — [разбор](docs/lessons.md#tests-and-screenshots-run-in-their-own-profiles)
- **`codeOnly()` is ONE implementation, in `tests/helpers/source-scan.js`** — [разбор](docs/lessons.md#codeonly-is-one-implementation-in-testshelperssource-scanjs)
- **Release gates count windows, they don't count matches** — [разбор](docs/lessons.md#release-gates-count-windows-they-dont-count-matches)
- **`--no-sandbox` was cancelling the app's own `sandbox: true`** — [разбор](docs/lessons.md#no-sandbox-was-cancelling-the-apps-own-sandbox-true)
- **The rot is not confined to `STORAGE_KEYS` — the WHOLE of `CONFIG` had it (CRITICAL)** — [разбор](docs/lessons.md#the-rot-is-not-confined-to-storage_keys-the-whole-of-config)
- **`CONFIG.STORAGE_KEYS` is a registry, not an access point** — [разбор](docs/lessons.md#configstorage_keys-is-a-registry-not-an-access-point)
- **A whitelisted channel is a permission, not a feature (CRITICAL)** — [разбор](docs/lessons.md#a-whitelisted-channel-is-a-permission-not-a-feature-critical)
- **A control with no visual coverage has no layout guarantee** — [разбор](docs/lessons.md#a-control-with-no-visual-coverage-has-no-layout-guarantee)
- **Подгонка не меряет собственный выход: рама из РАСКЛАДКИ (`offset*`) — `getBoundingClientRect()` видит и `transform` (CRITICAL)** — [разбор](docs/lessons.md#a-fitted-size-must-never-be-measured-against-its-own-output)
- **Потолок масштаба упирается в ЧЕРНИЛА, а не в раму: у «Цифр» рама — квадрат `--timer-box`, и в полосу упирался воздух** — [разбор](docs/lessons.md#a-ceiling-is-measured-on-the-ink-not-on-the-frame)
- **Accent text on an accent fill is a contrast trap, not bad luck with numbers** — [разбор](docs/lessons.md#accent-text-on-an-accent-fill-is-a-contrast-trap-not-bad-luc)
- **A capture harness must wait for the theme too, not just for fonts** — [разбор](docs/lessons.md#a-capture-harness-must-wait-for-the-theme-too-not-just-for-f)
- **Centre the DIGITS, not the whole inscription** — [разбор](docs/lessons.md#centre-the-digits-not-the-whole-inscription)
- **The clock's superscript seconds are the opposite case** — [разбор](docs/lessons.md#the-clocks-superscript-seconds-are-the-opposite-case)
- **Both rules were settled by measuring in `e2e` (digit centre, inscription centre,** — [разбор](docs/lessons.md#both-rules-were-settled-by-measuring-in-e2e-digit-centre-ins)
- **A segmented control's `.value` setter must NOT fire `change` (CRITICAL)** — [разбор](docs/lessons.md#a-segmented-controls-value-setter-must-not-fire-change-criti)
- **Ряд выбора стиля часов не прячется: при синхронизации он зеркалит виджет, а клик по нему снимает синхронизацию** — [разбор](docs/lessons.md#clockstylerow-must-be-on-the-real-row)
- **Segmented controls are `role="radiogroup"` + `role="radio"` + `aria-checked`, not tabs** — [разбор](docs/lessons.md#segmented-controls-are-roleradiogroup-roleradio-aria-checked)
- **`shell.openExternal` получает КОНСТАНТУ из main, а не адрес из рендерера** — канал `open-releases-page` payload не принимает вовсе
- **Цвет — это переменная, состояние — это класс; инлайн НЕ используется (CRITICAL)** — [разбор](docs/lessons.md#color-belongs-to-the-cascade)
- **Контраст считается для ПАРЫ «цвет × фон, где он окажется», в обеих темах; индикатор помечает ФОРМА (CRITICAL)** — [разбор](docs/lessons.md#a-state-indicator-is-colour-too-and-it-has-an-owner)
- **Стенд берёт размеры из реестра, порог `max-height` — выше минимума окна, медиа-блок НИЖЕ перекрываемых правил** — [разбор](docs/lessons.md#a-frame-from-a-size-the-app-forbids-documents-nothing)
- **Overtime on the display is painted by `.danger`, never by `.overtime`** — [разбор](docs/lessons.md#overtime-on-the-display-is-painted-by-danger-never-by-overti)
- **`styles.css` and `components.css` are gone, and the reason is not tidiness** — [разбор](docs/lessons.md#stylescss-and-componentscss-are-gone-and-the-reason-is-not-t)
- **The overtime ring is intentionally invisible** — [разбор](docs/lessons.md#the-overtime-ring-is-intentionally-invisible)
- **The analog hour hand must be driven explicitly** — [разбор](docs/lessons.md#the-analog-hour-hand-must-be-driven-explicitly)
- **A capture harness must be deterministic in FOUR ways, and three of them were found the hard way** — [разбор](docs/lessons.md#a-capture-harness-must-be-deterministic-in-four-ways-and-thr)
- **Captures must wait for `document.fonts.ready`, never a fixed sleep** — [разбор](docs/lessons.md#captures-must-wait-for-documentfontsready-never-a-fixed-slee)
- **Any capture containing live wall-clock time MUST go into `isTimeDependent()`** — [разбор](docs/lessons.md#any-capture-containing-live-wall-clock-time-must-go-into-ist)
- **Info blocks had zero visual coverage until 2026-07-30** — [разбор](docs/lessons.md#info-blocks-had-zero-visual-coverage-until-2026-07-30)
- **`visual:check` was NOT deterministic as of 10 Aug 2026 — verify the harness against itself before trusting a verdict** — [разбор](docs/lessons.md#visualcheck-was-not-deterministic-as-of-10-aug-2026-verify-t)
- **`visual:check` has a tolerance, so it is not a substitute for measurement** — [разбор](docs/lessons.md#visualcheck-has-a-tolerance-so-it-is-not-a-substitute-for-me)
- **The widget's flip separator is DOTS, not a glyph** — [разбор](docs/lessons.md#the-widgets-flip-separator-is-dots-not-a-glyph)
- **Status palette is fixed across all three windows** — [разбор](docs/lessons.md#status-palette-is-fixed-across-all-three-windows)
- **`npm run screenshot` is the visual smoke test** — [разбор](docs/lessons.md#npm-run-screenshot-is-the-visual-smoke-test)
- **No external shadows on transparent windows** — [разбор](docs/lessons.md#no-external-shadows-on-transparent-windows)
- **The second theme is LIGHT, and it is not the dark one inverted (CRITICAL)** — [разбор](docs/lessons.md#the-second-theme-is-light-and-it-is-not-the-dark-one-inverte)
- **Windows whose background the USER paints keep the dark palette in both themes (CRITICAL)** — [разбор](docs/lessons.md#windows-whose-background-the-user-paints-keep-the-dark-palet)
- **У каждого элемента дисплея СВОЙ масштаб; ползунок — команда «поставить всем», а не зеркало; первая посылка не применяется** — [разбор](docs/lessons.md#every-element-scales-on-its-own-and-the-slider-is-a-command)
- **Раскладка дисплея — ДЕЙСТВИЕ, а не настройка: свой канал, ничего не сохраняет, шлётся ПОСЛЕ тумблеров (CRITICAL)** — [разбор](docs/lessons.md#a-layout-is-an-action-not-a-setting)
- **«Чтобы всё вмещалось» — утверждение о прямоугольниках: координаты в долях, масштаб ужимается по свободной полосе** — [разбор](docs/lessons.md#fits-on-screen-is-a-statement-about-rectangles)
- **Позиция элемента дисплея — ДОЛЯ окна, а не пиксель; доли не пересобираются из нового положения (CRITICAL)** — [разбор](docs/lessons.md#a-position-is-a-fraction-of-the-window-not-a-pixel)

Правила-оглавления: тема сама себе напоминание, разбор раскрывает — [Never run `perl -pi` over these files](docs/lessons.md#never-run-perl--pi-over-these-files), [The finish flash must be latched](docs/lessons.md#the-finish-flash-must-be-latched), [Flip timers belong to `flip-card.js`](docs/lessons.md#flip-timers-belong-to-flip-cardjs), [`showTicks` drives TWO dials](docs/lessons.md#showticks-drives-two-dials), [A payload default is not a guard](docs/lessons.md#a-payload-default-is-not-a-guard), [The bridge exposes no `invoke`](docs/lessons.md#the-bridge-exposes-no-invoke), [The display has no browser-mode fallback](docs/lessons.md#the-display-has-no-browser-mode-fallback), [IPC whitelist is duplicated](docs/lessons.md#ipc-whitelist-is-duplicated), [Adding new IPC channel](docs/lessons.md#adding-new-ipc-channel), [Per-window colors](docs/lessons.md#per-window-colors), [`ipc-compat.js`](docs/lessons.md#ipc-compatjs), [Global keyboard shortcuts](docs/lessons.md#global-keyboard-shortcuts), [Window state broadcast](docs/lessons.md#window-state-broadcast), [Start sound from remote windows](docs/lessons.md#start-sound-from-remote-windows), [Monitor selection persistence](docs/lessons.md#monitor-selection-persistence), [Inline styles in HTML](docs/lessons.md#inline-styles-in-html), [Widget devTools](docs/lessons.md#widget-devtools), [Design previews](docs/lessons.md#design-previews), [Sounds](docs/lessons.md#sounds), [Control panel layout](docs/lessons.md#control-panel-layout), [syncClockStyle](docs/lessons.md#syncclockstyle), [Widget/clock geometry persistence](docs/lessons.md#widgetclock-geometry-persistence), [Scale pushes must be change-detected](docs/lessons.md#scale-pushes-must-be-change-detected), [Escape is layered](docs/lessons.md#escape-is-layered), [Flip animation is shared](docs/lessons.md#flip-animation-is-shared), [Colour bands live in ONE place too](docs/lessons.md#colour-bands-live-in-one-place-too), [One element, one colour system](docs/lessons.md#one-element-one-colour-system), [Scale is reported back](docs/lessons.md#scale-is-reported-back), [Visual regression](docs/lessons.md#visual-regression), [e2e needs `e2e/launch.js`](docs/lessons.md#e2e-needs-e2elaunchjs), [Timer status priority lives in ONE place](docs/lessons.md#timer-status-priority-lives-in-one-place), [Time format with hours](docs/lessons.md#time-format-with-hours), [Display settings `showCurrentTime`](docs/lessons.md#display-settings-showcurrenttime), [Design system v2](docs/lessons.md#design-system-v2), [Two UI themes, `data-theme` on `<html>`](docs/lessons.md#two-ui-themes-data-theme-on-html), [Display block positions](docs/lessons.md#display-block-positions), [Display scaling](docs/lessons.md#display-scaling), [Manual time input](docs/lessons.md#manual-time-input), [Color picker](docs/lessons.md#color-picker), [Scale value edit](docs/lessons.md#scale-value-edit), [Adaptive window height](docs/lessons.md#adaptive-window-height), [Reset settings](docs/lessons.md#reset-settings).

## Работа с контекстом

Разговор в этом проекте длинный по своей природе: правка → замер → e2e → CI →
следующая жалоба. Когда контекст подходит к концу, **скажи об этом вслух** и
предложи сохранить память и продолжить в новом чате — не жди молчаливого
сжатия. После сжатия теряются именно замеры («было 140px при хорде 135»), а
без них следующий шаг делается на глаз.

Перед переходом в новый чат: обнови файлы памяти проекта (что сделано, что
запушено, что осталось), допиши `SESSION.md` и убедись, что незакоммиченного не
осталось.

## Automation

- **Hooks** (`.claude/settings.json`): Auto-lint on Edit/Write, block `.env` file edits
- **Subagent** (`.claude/agents/code-reviewer.md`): IPC consistency checker for post-change review
- **Skills**: `ui-ux-pro-max` installed in `.claude/skills/` for design system generation
