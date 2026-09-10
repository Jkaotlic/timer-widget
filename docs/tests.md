# Тесты: что чем закрыто

Реестр вынесен из `CLAUDE.md` по той же причине, что и таблица каналов в
[ipc.md](ipc.md): он нужен, когда работаешь с конкретной подсистемой, а
контекст занимал в КАЖДОМ разговоре. Правила про тесты остались в `CLAUDE.md`,
здесь — справочник.

Запуск: `node --test` (unit), `npx playwright test` (e2e, `workers: 1`).
Количество тестов не записано ни здесь, ни в `CLAUDE.md`, ни в CI — его
получают прогоном.

## Две разновидности unit-тестов

- **Поведенческие** — чистые модули (`utils`, `security`, `timer-engine`,
  `timer-controller`, `recovery`, `renderer-shared`, `renderer-storage`,
  `color-utils`) импортируются и исполняются.
- **По исходнику** — логика внутри инлайновых `<script>` в HTML-окнах не
  импортируется, поэтому такие тесты читают файл и утверждают о его тексте.
  Утверждать надо И присутствие верного поведения, И отсутствие прежнего
  сломанного, иначе регресс возвращается молча.

## Unit (`tests/`)

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
| `event-report.test.js` | Отчёт CSV: шапка, строки, экранирование по RFC 4180, BOM и CRLF; итог из накопителя, а не сумма строк; стоимость от СЕКУНД; уложившиеся — строки с нулём, фильтр их скрывает и называет себя |
| `money-meter.test.js` | Деньги за перелимит: ступень периода, сложение секунд ДО цены, сводка мероприятия |
| `floor-47.test.js` | Скрытый режим: каналы в оба конца, реестр, секция панели, заморозка итога, одна сборка payload |
| `display-proportions.test.js` | Размеры карточек ведутся от полосы содержимого, потолка у кегля нет, мера — в `:root` |
| `scale-range.test.js` | Диапазон масштаба: пол окна = размер при `MIN_SCALE_PCT`, минимум квадратный, базы окон = реестру, умолчание блоков одно, пределы блоков без копий |
| `escape-keeps-windows.test.js` | Esc не гасит ни одно из четырёх окон; зонд проверяет себя буквами W/C/D |
| `hero-modes.test.js` | Реестр режимов, границы суток, прошедшая отметка, конец раньше начала, потолок подписи, часы против длительности |
| `hero-modes-wiring.test.js` | Герой и его форматтер — из ОДНОГО места, проверка по ВЫЗОВАМ; полоса вне ворот на тотале; сброс режима; зонды проверяют себя |

## e2e (`e2e/`)

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
| `event-export.spec.js` | Выгрузка ПО КЛИКУ доходит до файла на диске: диалог подменён в главном процессе, содержимое читается с диска; уложившийся доклад в отчёте, тумблер фильтра его скрывает; зонд проверяет себя |
| `floor-47.spec.js` | Скрытый режим ПО КЛИКУ: разблокировка тройным кликом, деньги, ЗАМОРОЗКА итога числом, отчёт, справка |
| `display-proportions.spec.js` | Карточка занимает ОДНУ долю полосы на 16:9 и 4:3; снимается при разбросе полос меньше ×1.6 |
| `scale-range.spec.js` | Пол масштаба ДОСТИЖИМ, окно квадратно на всей лестнице, каждая ступень меняет размер; растянутое за край доезжает до ползунка |
| `windows-load-clean.spec.js` | Четыре окна грузятся без ошибок консоли (ловит столкновение имён верхнего уровня); зонд проверяет себя |
| `display-timer-width.spec.js` | Размер цифр — ФУНКЦИЯ процента, а не порядка посылок; потолок в чернила; рама не крадёт клик |
| `hero-modes.spec.js` | Четыре режима ПО КЛИКУ: число из ЧАСОВ ОКНА, плашка гаснет, «до конца» красный, стрелка по %12 |
