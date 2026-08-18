# Session Notes — Apr 5, 2026

## What was done

### Apple Glassmorphism Redesign — COMPLETE
- Full CSS rewrite of control panel, widget, clock, display
- 4 tabs: Виджет, Часы, Полноэкранный, Звуки (always visible, no dropdown)
- Control window auto-resizes to content height
- All widget/clock styles use glassmorphism: `rgba` backgrounds + `backdrop-filter: blur(20px)`

### Critical Bugs Fixed
1. **Widget completely dead** — `const safeJSONParse` re-declaration in inline script conflicted with `function safeJSONParse` from security.js → SyntaxError killed entire script block. Removed the `const`.
2. **Widget style/scale not received** — `widget-style-update` missing from preload.js receive whitelist. Added to both preload.js and channel-validator.js.
3. **Widget colors changing Display** — `saveColors()` sent global `colors-update` broadcast. Removed, kept only per-window channels.
4. **Widget scale from settings broken** — sent bare number, main expects `{ width, height }`. Fixed.
5. **Clock style not switching** — `syncClockStyle` defaults `true`, but widget style change didn't send `clock-widget-set-style`. Fixed.
6. **Clock scale cumulative error** — delta-based `clock-widget-scale` accumulated on drag. Changed to absolute `clock-widget-resize`.
7. **Colors only worked in circle style** — `applyColors()` in widget/clock/display only updated circle SVG. Expanded to all 4 styles (digital LED, flip digits, analog hands).
8. **Shadow artifacts on transparent windows** — `drop-shadow`/`box-shadow` created dark rectangles. Removed, applied glassmorphism.
9. **display-settings-update leaking to widget** — removed widget from broadcast in main.js.

### Per-window Settings — COMPLETE
- Widget: `widget-style-update`, `widget-colors-update`
- Clock: `clock-widget-set-style`, `clock-colors-update`, `clock-widget-resize`
- Display: `display-settings-update`, `display-colors-update`
- `syncClockStyle` (default true) syncs clock style with widget dropdown

### Sound Presets Expanded
- 7 new synthesized sounds (chime, pulse, rising, drop, notification, countdown, complete)
- Total ~20 built-in via Web Audio API

## Known Remaining Items
- `syncClockStyle` checkbox is `display:none` — user can't toggle it from UI (always true)
- Legacy `colors-update` channel still listened for backward compat
- `preview-mockup.html` and `preview-screenshot.png` are untracked (not committed)

## Key Commits
- `4ae3414` — this session's fixes (per-window isolation, color sync, glassmorphism)
- `efa5faa` — widget style fallback + debug cleanup
- `602ba6e` — UI polish (titlebar, buttons, per-window wiring)
- `81ae146` — original glassmorphism redesign
- `5283824` — security audit

## Apr 6, 2026 — Settings Panel Redesign v2

### What was done
- Widened control panel: 320px → 700px (min 600, max 800)
- Presets: 4×2 → 8×1 single row
- Overtime toggle + window buttons merged into one row
- All settings tabs use 2-column grid layout
- Sounds tab stays single-column (full-width events)
- Window height: 760px, all tabs fit without scrolling

### Design
- Variant B "Spacious 700×760" approved
- Mockup: `.superpowers/brainstorm/1518-1775466547/content/design-v2.html`
- Spec: `docs/superpowers/specs/2026-04-06-settings-panel-v2.md`

## Apr 6, 2026 — Design Improvements v2 (Glassmorphism Polish)

### What was done
- All windows: blur(20px) → blur(40px) saturate(180%) (VisionOS standard)
- Timer font: SF Mono Bold → Inter Light (weight 200)
- Digital LED: Courier New → JetBrains Mono
- Progress ring: solid color → gradient #0a84ff → #30d158 (Apple Activity Rings style)
- Widget/Clock: removed all external shadows (transparent window safe)
- Border radius: 8px → 24px on window frames
- Transitions: 0.3s → 0.2s ease-out
- Settings panel: inset shadow instead of external box-shadow
- Apple semantic color palette standardized across all windows
- Google Fonts @import added to widget, clock, display

### Design
- Mockup: `.superpowers/brainstorm/1913-1775470678/content/design-improvements.html`
- Spec: `docs/superpowers/specs/2026-04-06-design-improvements-v2.md`
- Figma: https://www.figma.com/design/ojj21B75qClGUlDgqAUFIU (control panel, Starter limit)

## Apr 6, 2026 — Overtime Visuals + UI Polish

### Overtime red color + pulse across ALL styles
- **Root cause**: `applyColors()` sets inline `style.color` which overrides CSS classes (`danger`, `overtime`)
- **Fix**: Each `updateXxxDisplay()` now sets inline red color when overtime/danger
- Display: added `_enforceOvertimeColors()` called every tick to guarantee red stays
- Pulse animations: added for digital (glow pulse), flip (box-shadow pulse), analog (center + hands pulse)
- Widget + Display: all 4 styles (circle, digital, flip, analog) now show red + pulse in overtime

### Time format with hours
- Analog digital, Digital LED, Flip: all now show `H:MM:SS` when timer >= 1 hour
- Display flip: added hours card group (`flipHoursUnit`, `flipHoursSep`, `flipHr1`, `flipHr2`)
- Display digital: added hours group (`digitalHoursGroup`, `digitalHours`)

### Control panel improvements
- Window height: 760→860 (min 760, max 1000)
- Tab icons + settings-group-title icons: brighter (filter: brightness(1.3), color 0.35→0.5)
- Sound tab: switched from single-column to 2-column grid (left: Основное+События, right: Ваши звуки)
- All tab content: scrollable with `max-height: calc(100vh - 520px)`
- "Текущее время" toggle added to Полноэкранный settings (controls `currentTimeBlock` visibility)
- "Начало"/"Конец" time inputs moved from hidden to visible in Блоки времени section

### Clock widget
- Flip + digital: seconds now enabled by default (was only circle/analog)

### Status color consistency
- `#38ef7d` → `#30d158` in display.html status pills
- `rgba(56, 239, 125` → `rgba(48, 209, 88` across widget/display
- Google Fonts @import added to electron-control.html

## Apr 7, 2026 — Scale Bar Feature + Display Controls

### Scale Bar Feature (Widget + Clock)
- Removed `-webkit-app-region: drag` from widget and clock windows
- Implemented JS-based window dragging via IPC (`widget-move`, `clock-widget-move`)
- Added Ctrl+slider scale bar (30-600%) to both widget and clock windows
- Removed resize handles and border UI from widgets
- Removed Ctrl+wheel zoom (unreliable)

### Fullscreen Display Controls
- Added dual Ctrl+slider: "Таймер" (30-300%) and "Блоки" (50-600%)
- Added Alt+drag for repositioning info blocks freely on screen
- Positions and scale persist to localStorage
- Preset changes from control panel clear custom positions

### Clock Widget Font Scaling
- Circle style: time font increased from 14vw to 20vw for larger display at max scale
- Flip style: reduced base dimensions for higher scale factor
- Date/timezone badges: increased vw/vh percentages

### Shadow Cleanup
- Removed all external box-shadow and drop-shadow from widget and clock windows
- Converted to inset shadows or borders where needed (26 fixes total)

### UI Fixes
- Fixed themes-grid overflow in control panel (repeat(10) → auto-fill)
- Added min-width:0 and overflow:hidden to settings-group
- Fixed display settings resetting block positions on color/date changes

### FAQ Update
- Updated keyboard shortcuts section (removed Ctrl+wheel, added Ctrl slider and Alt+drag)
- Updated window descriptions with new scaling features
- Added persistence tips
- Added one-time hint tooltip on fullscreen display

### Global Keyboard Shortcuts
- Added Space/R/1-8/W/C/D shortcuts to widget, clock, and display windows
- Start sound now plays from any window (control detects remote start via timer-state transition)
- Window state broadcast to ALL windows via `broadcastWindowState()` (not just control)
- Monitor selection remembered in main process (`lastDisplayIndex`) for D key from any window

### Clock Color Bug Fix
- `applyColors()` now updates date-badge and timezone-badge color in all 4 styles

### Project Cleanup
- Added screenshots/, *.png, .superpowers/ to .gitignore

## Apr 8-9, 2026 — v2.1.0/2.1.1 Release + UI Improvements

### Releases
- v2.1.0: Ctrl+wheel scaling, 30 sounds, overtime fixes, reset settings
- v2.1.1: NSIS installer fix (removed useZip), macOS unsigned app instructions

### New Sounds (20→30)
- 10 new: cymbal, deep-gong, air-horn, siren, church-bell, drum-roll, ship-horn, metal-strike, epic-brass + extra

### Reset Settings Button
- Button in FAQ footer with confirmation modal
- `session.clearStorageData()` + `app.quit()` (relaunch unreliable with npm start)
- IPC channel `reset-and-relaunch` added to whitelist

### Control Panel UI Improvements
- **Manual time input**: smart parsing (90=90sec, 5:30=5m30s, 1:30:00=1h30m). Between adjust buttons and overtime toggle
- **HSV Color picker**: Canvas-based SV area + hue slider + hex input. 3 independent instances (Widget/Clock/Display). Toggle via rainbow gradient button
- **Scale bar manual input**: click percentage → input mode, dblclick → reset to default. Applied to all 4 scale bars
- **Adaptive window height**: auto-resizes per active tab via `autoResizeWindow()`. Min 650px, max 1000px

### Scale Bar Removal
- Removed Ctrl+hold visual slider from widget, clock, and display
- Scale bars completely removed (HTML, CSS, JS)
- Ctrl+wheel scaling preserved for all windows
- Display: Ctrl+wheel context-sensitive (hover on info-block → block scale, else → timer scale)
- Shift+wheel for blocks still works

### Bug Fixes
- Overtime minus sign overlapping digits (margin-left approach)
- Clock flip digits clipped (baseFlipWidth underestimated)
- Display scaling resetting on settings change
- Widget flip separator not red during overtime

### Documentation
- READMEs updated (RU + EN): scale bar → Ctrl+wheel, new features
- FAQ updated with new feature hints and tooltips
- Design spec: `docs/superpowers/specs/2026-04-08-control-panel-ui-improvements-design.md`

## Jul 29-30, 2026 — Полный аудит + декомпозиция + визуальный проход

Состояние на конец сессии: **340 юнит-тестов, 28 e2e, визуальная сверка чиста,
линт чист, 0 уязвимостей.** Приложение проверено живьём на Electron 43.
Всё в рабочем дереве, НЕ закоммичено (46 файлов), версия не поднята —
подробности в `CHANGELOG.md` под `## [Unreleased]`.

### Зависимости и безопасность
- 13 уязвимостей (11 high + 2 critical) → **0**. Критические — `undici` (обход
  проверки TLS через SOCKS5, отравление очереди ответов) и `node-tar`
  (протаскивание файлов через PAX). Остаток тянулся из `brace-expansion <=5.0.7`,
  закрыт `overrides` на `^5.0.8`
- Electron 42.3.2 → 43.2.0 + eslint, playwright, electron-builder, electron-log, globals
- Совместимость с 43 сверена по докам: ни один breaking change нас не касается
  (`dialog`, `Notification`, `toBitmap` в проекте не используются)

### Баги логики (найдены по коду, закрыты тестами)
- «— без звука —» всё равно пищал; звук мог залипнуть в OFF навсегда
- Escape закрывал модалку И убивал все окна одновременно
- Ползунок масштаба дисплея умирал после первого Ctrl+колеса
- Виджет и часы забывали размер и позицию между запусками
- Справка F1 врала про пресеты; диапазоны масштабов расходились
- **Цвет времени залипал красным** — ветка восстановления была условной
  (`else if (this._baseTimerColor)` без завершающего `else`)
- Виджет красил «Перерасход» ЗЕЛЁНЫМ; пауза в перерасходе показывалась как
  «Завершено»; на 00:00 время было ЖЁЛТЫМ вместо красного
- Подсветка быстрого выбора врала после ручного ввода и кнопок ±
- Часы: смена стиля молча затирала настройки; панель и часы затирали данные
  друг друга в одном ключе localStorage

### Корень большинства багов — дублирование
Вынесено в общие модули, покрыто настоящими юнит-тестами:
`RendererShared.timerLifecycleStatus()` (был в 3 копиях),
`RendererShared.timerColorBand()` (был в 9 копиях), `flip-card.js` (была в 1 из 3).

### Декомпозиция `electron-control.html`: 7297 → 2703 строки
Девять модулей: `control.css`, `sound-bank.js`, `custom-sounds.js`,
`local-background.js`, `color-picker.js`, `ui-feedback.js`, `modal-manager.js`,
`shortcuts-help.js`, `scale-input.js`. Два последних из звуковых/фоновых —
примеси к прототипу (сохраняют семантику `this`, перенос дословный).
`TimerController` оставлен целиком **осознанно** — разбор рисков и условия
возврата к теме в `CLAUDE.md` и в памяти проекта.

### Инструменты, которых не было
- **Визуальные регрессии**: `npm run visual:baseline` / `npm run visual:check`
  (`visual-diff.js`, попиксельно с допуском). Проверено на реальной регрессии:
  возврат жёлтого статуса даёт выход 3 и имя файла. Анимации на время съёмки
  замораживаются — иначе снимки недетерминированы
- **13 поведенческих e2e** вместо регулярок по исходнику; `e2e/launch.js` снимает
  унаследованную `ELECTRON_RUN_AS_NODE`, из-за которой Playwright вообще не
  запускался; `workers: 1` — у приложения single-instance lock
- `tests/electron-main-load.test.js` — впервые реально загружает main-процесс
  со стабом Electron

### Визуальный проход
- **Минус**: центрируется вся надпись, а не одни цифры. Держать по центру и то,
  и другое математически невозможно; глаз читает надпись целиком. Две неверные
  итерации до этого — обе выявлены замером, не глазом
- **Секунды круглых часов** — обратный случай: они вторичны и НЕ должны занимать
  ширину, иначе главное «HH:MM» стоит на 9.5px левее центра
- Единая палитра статусов во всех окнах: активен зелёный, пауза оранжевая,
  завершён красный, перерасход красный С пульсацией
- Вернули анимацию перекидывания в виджет и часы (осталась только в дисплее)
- Лимит перерасхода вернулся в интерфейс — движок поддерживал его всегда,
  но `getConfig()` жёстко слал 0

### Открытый вопрос на следующую сессию
Коммит и релиз: одним коммитом или разбить по темам, поднимать ли версию.

## 18 авг 2026 — Тон вместо темы, блоки в стиле, и два дефекта раскладки

Спека и план: `docs/superpowers/specs|plans/2026-08-18-style-skins-and-theme.md`.

### Просьба 1: блоки времени повторяют стиль (флип, аналог, цифры)

Оформление по стилям существовало, но было ПОХОЖИМ, а не тем же: у флипа блок
носил свой градиент из тех же чисел, что и карточка (две записи одного
намерения); у «Цифр» значение шло интерфейсным sans, тогда как сам таймер набран
выбранным шрифтом из реестра; у аналога стрелки мини-часов были залиты своим
белым литералом рядом с большим циферблатом на токене.

Теперь блок берёт ТЕ ЖЕ значения: пластина блока — `--style-plate`, та же
переменная, что у `.flip-card-inner`; стрелки мини-часов — `--style-hand`.
Совпадение проверяется РАВЕНСТВОМ вычисленных значений, а не похожестью.

Шрифт «Цифр» приходит переменными `--digits-font-family/-weight`, а не инлайном:
инлайн залипал бы на блоках после переключения стиля. Начертание берётся из
реестра, а не прибивается 700 — у Bebas Neue и Orbitron по одному файлу, и
запрос несуществующего веса даёт СИНТЕТИЧЕСКИЙ жирный.

Створки в блоке не строятся и не анимируются намеренно: блок не тикает, а
«Начало» и «Окончание» не меняются вовсе.

### Просьба 2: тема отражается на виджет и полноэкранный режим

Палитра «светлое по тёмному» существовала ТРЕМЯ копиями: пин `[data-theme=light]`
в `<style>` виджета (40 строк), два блока в `display.css` и светлая тема токенов
у часов. Копии оказались дословными — значения блока дисплея совпали со светлой
темой знак в знак.

Сведено в новый **`surface-tones.css`** — один файл на три окна. Выбирает палитру
ТОН, а не тема: `RendererShared.surfaceTone()` (виджет и часы — по цвету
подложки, при её отсутствии по теме) плюс прежний `backgroundTone()` (дисплей —
по режиму фона). Класс `on-light-bg` ставит единственный владелец
`UITheme.applyTone()`; `bindThemeSync(ipc, onChange)` даёт окну перекраситься на
смену темы.

У настройки «Фон» появился четвёртый режим **«По теме»**, он же умолчание
чистого профиля: раньше умолчанием была тёмная заливка, то есть светлая тема
дисплея существовала, но добраться до неё можно было только руками.

Поверхности стилей переписаны литералов на токены `--style-*` (пластина, сгиб,
блик, кромка, циферблат, деления, стрелки, тени): 24 белых и 25 чёрных `rgba()`
в одном `display.css` — тема до литерала не доезжает по построению.

Две вещи сделаны сознательно вопреки прежним решениям:
- у «Круга» и «Цифр» виджета на СВЕТЛОМ тоне появилась подложка. Правило
  «подложки нет» (12.08.2026) работало, пока чернила были белыми; на светлом
  тоне тёмные цифры на тёмных обоях пропадали целиком — замер на кадре;
- табло флипа в часах светлеет. Там стояло обратное правило («у настоящих
  перекидных часов табло тёмное»), просьба была прямее.

### Дефект 1: «при масштабировании пресеты ставят элементы неровно»

`applyLayout` мерил коробки, пока идёт переход `transform`: `--info-scale` уже
новый, матрица ещё старая. Замер на живом окне — переменная `0.95`, матрица
`matrix(4.95, …)`, ширина 1055 при настоящих 213.

На ПОЗИЦИЮ это не влияло, и потому дожило до жалобы: ошибка гасилась второй,
симметричной — `placeElementAt` доводит коробку тем же устаревшим замером, и по
арифметике обе сокращаются точно. Не гасилось поджатие масштаба к свободной
полосе: «Сводка» приезжала с карточками 62 % рядом с 95 % — ряд из четырёх
плашек двух разных размеров.

Лечится ДВУМЯ вещами сразу: габарит из `offsetWidth/offsetHeight` (трансформацию
не видят вовсе) плюс класс `layout-settling`, снимающий переходы на время
расчёта. Починить одно — сломать другое: позиция уезжает на 426px.

### Дефект 2: аналог — подписи вылезают, название в круге

Правило круга висело на `.info-block`, то есть делало кругом ЛЮБОЙ блок. Замер
(блок 120×120): «Текущее время» 115.6px и «До завершения» 117.6px против ХОРДЫ
окружности ≈96px; «Ежегодная конференция» — 216px в круге 120px.

Круг переехал на сам `.mini-clock` (`:has()`), подпись выведена в поток над ним,
блоки без циферблата идут строкой. Значение осталось внутри круга: оно всегда
время, не длиннее «00:00:00» — 72px против хорды 96px.

Попутно найден дефект того же класса: `.info-value` несёт `white-space: nowrap`
ради ВРЕМЕНИ, а тем же классом набрано название мероприятия. На 3440px название
в 58 знаков в круге и «Цифрах» давало строку 1341px против клиентских 1043
(обрезана), у флипа — 1421px в блоке 1314, за краем ОКНА. Название переносится,
время — нет.

### Состояние

- **786 unit, 177 e2e**, lint чистый. Закоммичено и запушено: `eafe141`,
  одним коммитом СОЗНАТЕЛЬНО — в дереве лежала и работа прошлой сессии
  (раскладки дисплея), и правки обеих идут по одним файлам; разделение дало бы
  промежуточный коммит, не проходящий тесты. Тем же пушем уехали четыре
  коммита флипа от 14.08, лежавшие локально.
- Полный e2e — **177/177, ноль падений**. «Плавающий провал» оказался не
  флейком: `style-tone.spec.js` оставляла дисплей в стиле «Аналог», а
  `ui-pass-2026-08` ждёт ВИДИМОЕ `.timer-ring`, которого в аналоге нет.
- Первый пуш дал красный e2e на CI при зелёном локальном прогоне — три проверки
  молча зависели от машины (разрешение экрана в двух, метрики шрифта в третьей).
  Исправлено коммитом `b612c0e`, разбор — в `docs/lessons.md`.
- **CI полностью зелёный** (`885e36e`): все девять заданий, включая e2e на
  ubuntu, macOS и Windows. Унаследованное с 14.08 падение `drawer-layout`
  тоже закрыто — см. ниже.
- Эталоны `screenshots/` устарели НАМЕРЕННО: умолчание приложения светлое, и
  теперь ему следуют все окна. `visual:check` покажет большой diff.
- В съёмку добавлены все пять блоков и четыре стиля плюс светлый тон: «До
  завершения» и название мероприятия не попадали ни в один кадр — ровно те два,
  на которых дефект аналога и жил.

### Открытые вопросы на следующую сессию

1. Пересобрать эталоны скриншотов (`npm run screenshot && npm run visual:baseline`):
   умолчание стало светлым, и старые эталоны сравнивать не с чем.
2. Блок «Текущее время» в позиции по умолчанию налезает на подпись «Осталось».
   Не про аналог, было и раньше; готовые раскладки этого не допускают.
3. ~~`drawer-layout` на macOS и Windows~~ — закрыто 18.08.2026, см. раздел ниже.
4. `--tw-band-danger` (#ff4444) остаётся ярким в обоих тонах: на светлом это
   3.3:1, хватает только крупному тексту. Сведение трёх красных к одному не
   делалось.

## 18 авг 2026 (продолжение) — прыжок панели при открытии ящика

Жалоба была давняя: «бывает, что прыгает при открытии боковой панели». «Бывает»
здесь ключевое — на широком мониторе не прыгает никогда, и красным был только CI
на macOS и Windows, с прогона 14.08.2026.

**Механизм.** Ящик открывается двумя несинхронными событиями: окно растёт
МГНОВЕННО (главный процесс), колонка под ящик резервируется переходом 240 мс.
Пока колонка не встала, панель центруется по тому, что есть, — поэтому колонка
прибивается заранее. Пин исходил из «окно вырастет ровно на ширину ящика», а
главный процесс режет ширину ещё и по экрану (`screenWidth - 50`). Замер на
раннере (экран 1024): окно просило 1096, получило 974 — пин на 122px шире правды,
траектория левого края 20 → 60 → 0.

**Правка.** Новый `panel-drawer.js` повторяет арифметику главного процесса
целиком, включая обрезку по экрану (`window.screen.availWidth`). Комментарий на
том месте прямо утверждал, что предсказать эффективный потолок из рендерера
нельзя, — можно. Промах предсказания безобиден: `syncColumn` на `resize` всё
равно ставит колонку по факту.

**Зеркальная половина.** Та же правка обнажила закрытие: там стояло «зеркало
пина» — возврат колонки к ширине окна ДО открытия, — повторявшее ту же ошибку.
Колонку при закрытии трогать не надо вовсе.

**Цена по храповику уплачена, а не отложена.** Потолок размера
`electron-control.html` НЕ поднимался: долг возвращён выносом ОБЕИХ формул в
модуль (`drawerColumnWidth` + `columnFromWindow`) и сокращением комментариев,
пересказывавших разбор. Строк в inline-скрипте столько же, сколько было до
правки.

**Проверка.** 793 unit (7 новых — числами, потому что ветку узкого экрана на
широком мониторе не воспроизвести в принципе), 177 e2e, CI зелёный целиком.

## 18 авг 2026 (продолжение) — дата и пояс в «Цифрах» часов

Жалоба: «в часах в стиле цифры при включении даты и часового пояса неправильно
позиционируются они и всё смешивается».

**Замер важнее описания.** На окне 220×220: время `left: -84` (за левым краем),
дата 122..220 (прижата к правому), пояс 220..304 — ЦЕЛИКОМ за окном. Наложения
НЕТ: элементы не смешивались, они выстроились в строку и выдавили друг друга
наружу. По слову «смешивается» искать `z-index` было бы бесполезно.

**Причина.** `.clock-digits` — `display: flex` без `flex-direction: column`, а
дата и пояс лежат в нём прямыми детьми. У трёх остальных стилей часов у
шильдиков своя колонка (`.center-badges`, `.widget-flip-info`,
`.widget-analog-info`); у «Цифр» обёртки нет вовсе. Стиль пришёл из слитого LED,
где в контейнере лежало ровно одно дитя.

**Правка — две половины.** Колонка вместо строки; и подгонка кегля вычитает
высоту видимых шильдиков из доступной. Одной колонки мало: цифры заняли бы всю
высоту окна, а дата с поясом выдавились бы за нижний край — тот же дефект по
другой оси. Замером собственного выхода это не является: кегль шильдиков задан
`clamp()` от размера ОКНА.

**Проверка.** 793 unit, 178 e2e. Новый тест проверяет сам себя: сначала требует,
чтобы оба шильдика ПОКАЗАЛИСЬ, иначе зеленел бы на выключенных тумблерах.
