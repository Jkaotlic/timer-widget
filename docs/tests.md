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
- **По исходнику** — код страниц окон (`*-app.js`, до 25.09.2026 —
  инлайновые `<script>`) рассчитан на браузер и не импортируется, поэтому такие
  тесты читают исходник и утверждают о его тексте. Окно читается через
  `tests/helpers/window-source.js` — разметка вместе с собственными файлами
  окна на их местах, как было до выноса инлайна.
  Утверждать надо И присутствие верного поведения, И отсутствие прежнего
  сломанного, иначе регресс возвращается молча.

## Unit (`tests/`)

| File | Covers |
|------|--------|
| `time-utils.test.js` | `formatTime`, `formatTimeShort`, `parseManualTime` (строгий формат) |
| `security.test.js` | `isValidDataURL`, `validateImageSource`, `safeJSONParse`, `isSafeColor`, `escapeHTML` |
| `security-extended.test.js` | `safeSetBackgroundImage` |
| `status-progress.test.js` | `getTimerStatus`, `calculateProgress` |
| `validation-utils.test.js` | `isValidNumber`, `clamp` |
| `display-bg-image.test.js` | BUG-10: картинка фона в payload только при смене (`attachChangedBgImage`), дисплей держит копию и не декодирует её заново |
| `display-select.test.js` | BUG-18: список мониторов строится без CSS-селектора из данных хранилища (`fillDisplaySelect`) |
| `custom-sounds.test.js` | BUG-21: испорченное хранилище звуков, только `data:audio/` в `Audio`, нечитаемый файл, замена по базовому имени — с тостом |
| `debounce-send.test.js` | `debounce`, `safelySendToWindow` |
| `channel-validator.test.js` | `isValidChannel`, `ALLOWED_CHANNELS` — вид на `ipc-senders.js`, без своего списка |
| `ipc-liveness.test.js` | Every whitelisted channel has BOTH ends. The whitelist is a permission, not proof of life |
| `edge-cases.test.js` | Edge cases for all utils |
| `constants.test.js` | CONFIG immutability and structure, plus the orphan check — every key needs a reader outside `constants.js` and this test |
| `timer-engine.test.js` | `tick`/`adjust`/`reset`/`setPreset` arithmetic + boundary events |
| `timer-controller.test.js` | State machine with a fake clock (start/pause/reset/reconcile) |
| `recovery.test.js` | Crash-recovery persist/load/validate |
| `event-overrun-store.test.js` | Накопитель перелимита на диске: битый/чужой файл — чистое состояние, журнал ≤ 500 с перенумерацией, `pending` сворачивается ровно один раз (BUG-04) |
| `electron-main-load.test.js` | НАСТОЯЩИЙ главный процесс (`electron-main.js` + `main-*.js`) на заглушке `electron`: загрузка, IPC-обработчики поведением — геометрия, переоткрытие окон, журнал докладов и выгрузка, SEC-04/05/07/10/11, BUG-01/04/07/10/15/17 |
| `control-decomposition.test.js` | Вынесенные из панели модули подключены, в `build.files` и не тянут внутренности панели |
| `flip-card.test.js` | Перекидыш запускается при смене значения и НЕ запускается на том же |
| `sound-bank.test.js` | Каждый встроенный звук строит узлы на подставном `AudioContext` и планирует остановку осцилляторов |
| `mini-bar.test.js` | Режим полосы на поддельном документе: класс `collapsed`, `render()` отдаёт значения |
| `panel-compact.test.js` | Компактный режим панели по ЗАМЕРУ с гистерезисом — без мигания |
| `panel-drawer.test.js` | Ширина колонки при открытии ящика — предсказание по той же обрезке, что у main |
| `preset-keys.test.js` | Клавиши пресетов во всех четырёх окнах ограничены длиной реестра — «6» не сбрасывает время |
| `wheel-axis.test.js` | Колесо с нулевым `deltaY` (Shift на macOS) — не «уменьшить» |
| `silent-exits.test.js` | Ранние выходы инициализации окон оставляют след в журнале |
| `fullscreen-close.test.js` | Полноэкранное окно закрывают ПОСЛЕ выхода из полноэкранного режима (краш macOS 28.08.2026) |
| `visual-diff.test.js` | Арифметика визуальной сверки на синтетических RGBA-буферах |
| `ui-pass-2026-08.test.js` | Регрессии UI-прохода 07.08.2026 по исходникам (`codeOnly`) |
| `e2e-budget.test.js` | `test.setTimeout` в e2e только ПОДНИМАЕТ бюджет из `playwright.config.js` |
| `sound-hotkey.test.js` | Клавиша `Z` и мастер-звук: у звука ОДИН владелец (`#soundMasterEnabled`), тумблер строки и посылки окон идут через `toggleSoundMaster` |
| `atomic-write.test.js` | Атомарная запись (tmp + fsync + rename): сорвавшаяся запись оставляет старый файл — накопитель и снимок восстановления (BUG-09) |
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
| `main-modules.test.js` | Модули `main-*.js`: нет сирот, electron только в точке входа (регулярка + загрузка с ловушкой), `rawIpcMain` не покидает точку входа, гард SEC-04 раньше первого `require` — [docs/main-process.md](main-process.md) |
| `visual-source.test.js` | Layout/centering invariants, release-doc freshness |
| `audit-2026-07-fixes.test.js` | Regressions from the July 2026 audit (sound, Esc, scales, geometry) |
| `audit-2026-07-30-fixes.test.js` | Regressions from the 30 Jul 2026 pass (flip, finish flash, geometry, modifiers, F1) |
| `storage-keys.test.js` | `CONFIG.STORAGE_KEYS` matches the keys the code uses — both directions; no key is write- or read-only |
| `contrast.test.js` | WCAG contrast WITH alpha compositing, BOTH themes (dark ≥ AA, light ≥ AAA), light surface ladder, accents on accent fills |
| `ui-lock.test.js` | Замок: логика на поддельном хранилище, модуль в 4 окнах, канал в оба конца, вопрос к замку в КАЖДОМ жесте |
| `presets.test.js` | Пресеты вида: состав снимка (включая записанное ОТСУТСТВИЕ), сравнение по подмножеству, рейс, квота |
| `ui-theme.test.js` | Theme logic + wiring: module → four windows' `<head>` → channel in the panel's send and every window's receive bridge → main's relay → panel button |
| `faq-and-hidden-controls.test.js` | Clock settings reachable (no `display:none`), ONE accordion handler, help matches UI, footer version == package.json, dead CSS deleted |
| `release-notes.test.js` | Заметки к релизу — из CHANGELOG, таблица загрузок совпадает с `build.target`, обещания в шапке не протухли |
| `e2e-window-sizes.test.js` | Выбор размеров окна для e2e: помещающиеся, вывод из рабочей области, пол; ошибка делает спеку ХОЛОСТОЙ |
| `window-geometry.test.js` | Drag + geometry on fake storage/DOM: restore, save, scale bounds, quota, modifier guard, drag target |
| `window-top-edge.test.js` | Три условия верхнего края: `enableLargerThanScreen`, уровень `status`, поджатие по границам экрана |
| `clock-settings-schema.test.js` | Clock settings table: collect/apply roundtrip, defaults, stored `false` vs missing |
| `window-open-ownership.test.js` | Every create-function announces and hydrates its own window; tray binding in `createControlWindow` |
| `settings-key-ownership.test.js` | `pickOwnSetting` + wiring: display/widget read their OWN key, ticks have one owner |
| `color-validation-single-owner.test.js` | One colour validator (`SecurityUtils.isSafeColor`); weaker copies stay gone |
| `release-gates.test.js` | DevTools guarded on EVERY window, isolation, no external URLs, local fonts, no auto-update, CSP per window, Linux: deb only, AppArmor `userns` + SUID as fallback, `--no-sandbox` in no target; navigation guard wired; `build.electronFuses` config |
| `security-gate.test.js` | Ворота уязвимостей (`scripts/security-gate.js`, [docs/ci.md](ci.md)): high/critical и находка без оценки блокируют, неполный отчёт OSV — провал; `sbom.json` = lockfile; пустой SBOM артефакта — провал; версия Electron из бинаря, последний патч линии |
| `verify-packed.test.js` (фьюзы) | SEC-03: читалка фьюзов из `scripts/verify-packed.js` — индексы из `@electron/fuses`, удалённый/отсутствующий фьюз — провал, живой неперевёрнутый бинарь Electron отвергается; поиск исполняемого файла по раскладке mac/win/linux |
| `csp-guard.test.js` | SEC-08: CSP окон `script-src 'self'; style-src 'self'` — в разметке нет `<script>` без src, `<style>`, `style=`, `on*=`, `javascript:`; в скриптах окон — `style=`/`on*=` в HTML-строках, `setAttribute('style')`, `createElement('style')`, `eval`; meta = `POLICY`. Сканеры проверены на себе: каждый вид в нескольких написаниях + подсадка в настоящее окно, и чистые соседи (CSSOM, `data-style`, комментарии) не срабатывают |
| `window-source.test.js` | Помощник `helpers/window-source.js` (окно = разметка + его `*-app.js`/`.css` на местах): список собственных файлов сверен с разметкой в обе стороны, развёртка на своих местах; порядок таблиц виджета и часов (fonts первой, своя последней) |
| `navigation-guard.test.js` | SEC-06: навигация окна — только на четыре свои страницы (хеш/query не мешают, `%2e%2e` не обходит); `window.open` и `<webview>` — отказ на каждом событии |
| `ipc-senders.test.js` | SEC-07: таблица «канал → окна-отправители» покрывает каждый канал main/preload/validator, необратимое — только панель, каждое окно допущено ко всему, что шлёт сегодня (сканер проверен на себе); отказ субфрейму, чужой странице, чужому webContents |
| `preload-channels.test.js` | Мост по окнам: таблица в `preload.js` свежая (генератор), строки окна РОВНО равны тому, что окно шлёт и слушает (сканер `helpers/ipc-scan.js` проверен на себе), мост на подставке пропускает своё и режет чужое, без роли / с двумя ролями закрыт |
| `relay-payload.test.js` | SEC-10: payload ретрансляторов (цвета, стиль, настройки дисплея и часов) — плоский объект примитивов, `__proto__` не прототип, потолок размера пропускает фон 10 МБ и отвергает больше, название ≤ 60 |
| `drop-guard.test.js` | SEC-06: сброшенный файл не открывается вместо виджета, часов и дисплея; у панели свой гаситель |
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
| `display-select.spec.js` | BUG-18: список мониторов строится в живой панели и при кавычке в `selectedDisplay` |
| `custom-sounds.spec.js` | BUG-21: испорченное хранилище звуков не роняет список; одноимённый файл заменяет звук с тостом |
| `display-local-background.spec.js` | Локальный фон по настоящему пути: картинка едет один раз (BUG-10), затемнение 0 % (BUG-16), досылка переоткрытому дисплею, удаление |
| `flip-animation.spec.js` | Перекидывание ВИДНО в трёх окнах: створки меряются покадрово, не по классу |
| `flip-hours-layout.spec.js` | Flip separator stays dots (never a glyph) in H:MM:SS, measured |
| `window-state-sync.spec.js` | A window loaded second knows which windows are already open |
| `window-reopen-race.spec.js` | Закрыть и сразу открыть — у всех трёх окон окно остаётся, и оно одно |
| `mini-bar.spec.js` | Режим полосы сжимает НАСТОЯЩЕЕ окно и возвращает прежние размер и позицию |
| `panel-shell.spec.js` | У панели ОДНА оболочка при любой ширине окна |
| `min-size-layout.spec.js` | На минимуме окна ряд вкладок настроек виден целиком |
| `drawer-focus.spec.js` | Фокус переходит в открытый ящик настроек и возвращается |
| `segmented-label.spec.js` | Подпись контрола выбора стиля не ломается в две строки |
| `toast-placement.spec.js` | Тост не закрывает герой-время |
| `sound-controls.spec.js` | Вкладка «Звуки»: один вид контрола на смысл, мишень не меньше нормы |
| `reset-defaults.spec.js` | «Сбросить всё» возвращает заводской вид — сверка с чистым профилем |
| `clock-badges-layout.spec.js` | Шильдики даты и пояса в круговых часах не налезают при любом размере |
| `clock-style-hardening.spec.js` | Испорченное значение стиля не оставляет часы пустым окном |
| `clock-style-sync.spec.js` | Ряд стиля часов зеркалит виджет при синхронизации, клик снимает её |
| `display-ring-proportion.spec.js` | Дуга прогресса занимает долю высоты окна, а не пиксели |
| `flip-separator.spec.js` | Разделитель флипа — точки во всех трёх окнах |
| `overtime-centering.spec.js` | В перерасходе по центру стоят ЦИФРЫ, а не вся надпись |
| `overtime-minus.spec.js` | Минус перерасхода в виджете — часть табло: мигает в одной фазе с цифрами, зазор у «Цифр» не шире нормы |
| `ui-pass-2026-08.spec.js` | Замеры UI-прохода 07.08.2026, которые картинкой не поймать |
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
| `windows-load-clean.spec.js` | Четыре окна грузятся без ошибок консоли (ловит столкновение имён верхнего уровня); код страницы каждого окна (`*-app.js`, `theme-init*.js`) исполнился; внедрённый инлайновый скрипт не исполняется; зонды проверяют себя |
| `csp-strict.spec.js` | Ноль событий `securitypolicyviolation` и сообщений CSP в консоли во всех четырёх окнах при проходе по ящику, вкладкам и всем стилям (слушатель до загрузки окна, зонд `style=` через innerHTML ловится обоими каналами); углы делений всех циферблатов по вычисленной матрице; часовая группа флипа скрыта/видна без инлайнового «скрыто» |
| `display-timer-width.spec.js` | Размер цифр — ФУНКЦИЯ процента, а не порядка посылок; потолок в чернила; рама не крадёт клик |
| `hero-modes.spec.js` | Четыре режима ПО КЛИКУ: число из ЧАСОВ ОКНА, плашка гаснет, «до конца» красный, стрелка по %12 |
