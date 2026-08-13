# Уроки: как эти правила появились

Полные разборы ловушек, каждая — с историей, замерами и тем, что именно ввело в
заблуждение. `CLAUDE.md` держит из них только ИМПЕРАТИВ, по одной строке, и
ссылается сюда.

Разделено 11.08.2026. Причина: `CLAUDE.md` вырос до 86 КБ, из них 60 КБ (69%) —
раздел Gotchas, то есть хроника уже починенного и закреплённого тестами.
Хроника ценна, но она нужна В МОМЕНТ работы над конкретной подсистемой, а не в
каждом разговоре с самого первого слова. Действующие правила в ней тонули.

Ничего не выброшено: текст перенесён дословно.

---

<a id="a-green-test-does-not-prove-a-feature-is-reachable-critical"></a>

### A green test does NOT prove a feature is reachable (CRITICAL)

- **A green test does NOT prove a feature is reachable (CRITICAL)**: `e2e/clock-style-sync.spec.js` sets `.checked` from code and dispatches `change`. It passed for a whole pass while `#syncClockStyle` sat inside a `display:none` block — the logic was fixed, the control was never put back in the UI, and no test could tell. Three other clock settings (seconds, 24h, timezone) hid the same way with fully live wiring behind them. When you fix logic, also click the thing: `e2e/reachable-controls.spec.js` only ever clicks VISIBLE elements, so hiding a control again fails it. And `display:none` blocks commented "kept for JS compatibility" are where unreachable features live — treat that comment as a bug report.

---

<a id="search-for-the-identifier-not-the-css-class"></a>

### Search for the identifier, not the CSS class

- **Search for the identifier, not the CSS class**: while auditing the help modal I grepped `faq-question` and concluded no click handler existed — so I added one. The handler was there, 115 lines below, written as `faqQuestions.forEach` (camelCase variable, no hyphen), and `head` truncated the grep output that would have shown it. Two handlers on the same element killed the accordion outright: the first adds `open`, the second reads it as "already open", strips the class from the whole section and never re-adds it. `tests/faq-and-hidden-controls.test.js` now asserts there is exactly ONE handler.

---

<a id="source-level-tests-must-strip-comments-before-asserting-abse"></a>

### Source-level tests must strip comments before asserting absence

- **Source-level tests must strip comments before asserting absence**: four assertions in this repo failed on their own explanatory comments (a comment saying "`max-height: 500px` used to clip answers" trips a check for `max-height: 500px`; the shell script explaining why `chmod 0755` was wrong trips a check for `chmod 0755`). Every "the old broken thing is gone" assertion runs against a comment-stripped copy (`CSS_CODE` / `HTML_CODE` in the tests). Check code, not prose about code.

---

<a id="never-run-perl--pi-over-these-files"></a>

### Never run `perl -pi` over these files

- **Never run `perl -pi` over these files**: they are UTF-8 with Cyrillic text. Perl reads bytes as latin-1, and inserting one wide character re-encodes the WHOLE file, turning every Cyrillic string into mojibake (the corruption is reversible — `s.encode('latin-1').decode('utf-8')` — but only if you notice). Use the Edit tool or a Python script with explicit `encoding='utf-8'`.

---

<a id="window-state-must-be-snapshot-to-each-window-on-load-not-onl"></a>

### Window state must be SNAPSHOT to each window on load, not only broadcast on change (CRITICAL)

- **Window state must be SNAPSHOT to each window on load, not only broadcast on change (CRITICAL)**: every window decides "open or close" for W/C/D — and the control panel for its window buttons — from a LOCAL flag that starts `false` and is only updated by `*-window-state` messages. Those used to be sent solely at the moment a window opened or closed, so a window that loaded *later* never learned about windows already open. Ordinary path to the bug: open the clock, then the widget, press C in the widget — the widget thinks the clock is closed, sends `open-clock-widget`, main just focuses the existing window and the toggle appears dead. Same after `bindRenderCrashHandler` reloads a renderer, and after the panel is recreated from the tray. `bindWindowStateSnapshot()` in the main process pushes all three states on `did-finish-load`; the listener is `on`, NOT `once`, precisely so a reload gets the snapshot again. Covered by `e2e/window-state-sync.spec.js`.

---

<a id="the-finish-flash-must-be-latched"></a>

### The finish flash must be latched

- **The finish flash must be latched**: the fullscreen display's `triggerFinishEffect()` used to be guarded only by `finished && !flashInterval`. `flashInterval` clears itself when the ~3s flash sequence ends while `finished` stays latched in the engine until reset, so ANY later state emit restarted the strobe — pressing Start again at 00:00 (the controller answers with `finish()`), any overrun-config push from the panel, the `get-timer-state` reply to a freshly opened window. `_finishEffectShown` latches it; it is cleared in `updateDisplay()` whenever `finished` is false, *before* the cache early-return.

---

<a id="flip-timers-belong-to-flip-cardjs"></a>

### Flip timers belong to `flip-card.js`

- **Flip timers belong to `flip-card.js`**: the module keeps its own `Set` of pending class-removal timeouts and deletes each on fire; windows call `FlipCard.cancelPending()` in `cleanup()`. Do NOT reintroduce per-window arrays (`_flipTimeouts` / `_timeouts`) — seconds tick every second, so an externally tracked list grew unbounded for the lifetime of the window and then `clearTimeout`ed thousands of dead ids.

---

<a id="showticks-drives-two-dials"></a>

### `showTicks` drives TWO dials

- **`showTicks` drives TWO dials**: both the widget and the clock have a `.tick-marks` SVG group and a `.ticks-on` rule, so the single "Деления на циферблате" checkbox writes `widgetShowTicks` AND `clockShowTicks` and pushes to both windows unconditionally (not only when `syncClockStyle` is on). Each window restores its own key at init — without that, enabled ticks visibly blinked off until the panel's push arrived ~600ms after load. The whole feature was once unreachable: the checkbox was dropped from the markup in 9b70782 while every other layer stayed, and `getElementById` guards hid it. `e2e/dial-ticks.spec.js` keeps the chain measured.

---

<a id="resizing-a-window-must-hold-its-centre-not-its-top-left-corn"></a>

### Resizing a window must hold its CENTRE, not its top-left corner (CRITICAL)

- **Resizing a window must hold its CENTRE, not its top-left corner (CRITICAL)**: `win.setSize()` keeps the top-left fixed and nothing fixes the position afterwards. The widget's and clock's content is centred in the window, so scaling up slid the dial down-right by exactly half the growth and pushed it off the screen — measured: the widget at 400% occupied `x = 3170…4170` against a 3440-wide screen (the *centre* of the dial sat at 3670, i.e. already off-frame), the clock `y = 1060…1940` against 1440. Dragging it back appeared to work in every direction except UP; that half of the diagnosis was WRONG and is corrected in [Верхний край экрана достижим](#the-top-edge-is-reachable-what-clamps-is-constrainframerect). The user reported this as «нет возможности двинуть наверх», so the complaint pointed at dragging while the broken thing was scaling: do not go looking for the bug where the symptom is. The arithmetic lives in the pure `fitScaledBounds()` in `window-geometry.js` (rectangles in, rectangle out, no Electron — so it is unit-tested in Node); `resizeWindowClamped()` applies it with ONE `setBounds()` (two calls give an intermediate frame that is "already big, not yet moved"). Three details are load-bearing: clamp against `screen.getDisplayMatching()`, NOT `getPrimaryDisplay()` — on a second monitor the primary's size is simply the wrong ruler; garbage in the requested size is IGNORED rather than substituted (the old `Number(width) || 220` silently made the window 220px whatever its base size was); and the minimum comes from `win.getMinimumSize()`, not a literal, because the widget's `minHeight` is 140 and a centre computed against a literal 100 misses by 20px. When clamping and centring disagree, clamping wins — the preserved centre would be unreachable anyway.

---

<a id="the-top-edge-is-reachable-what-clamps-is-constrainframerect"></a>

### Верхний край экрана достижим: поджимает `constrainFrameRect`, а не уровень окна (CRITICAL)

- **Верхний край экрана достижим: поджимает `constrainFrameRect`, а не уровень окна (CRITICAL)**: 10.08.2026 здесь был записан замер «macOS не пускает окно выше рабочей области НИ ПРИ КАКОМ уровне» — проверено на `floating`, `screen-saver`, `pop-up-menu`, через `setPosition` и `setBounds`, все дают `y = workArea.y`. Замер повторяется в точности, а **вывод из него неверен**: перебирался уровень окна, но не перебиралось то, что поджимает на самом деле, — `-[NSWindow constrainFrameRect:toScreen:]`. Electron отключает его опцией КОНСТРУКТОРА `enableLargerThanScreen: true`; с ней на том же экране замерено `y = 0` и даже `y = -60`. `movable: false` и `type: 'panel'` не помогают — проверено обоими. Из-за неверного вывода правка масштабирования была построена по принципу «чинить так, чтобы наверх двигать не требовалось», и жалоба «расширяю виджет и не могу переместить вверх» вернулась в неизменном виде. **Перебор вариантов ОДНОГО параметра — это не доказательство, что дело в нём.** Одной опции мало: у верхнего края окно на уровне `floating` (3) невидимо — полоска меню (24) рисуется поверх, замерено съёмкой экрана (верхние 30 px закрыты). Оба окна поднимаются на `status` (25) — первый уровень выше меню; `pop-up-menu` (101) взят не был намеренно, он перекрыл бы раскрытые меню. Третья половина того же правила: областью укладки в `resizeWindowClamped()` и `positionWindowClamped()` служат ГРАНИЦЫ экрана, а не рабочая область, иначе окно, поставленное к краю, съезжает вниз при следующем открытии. Координаты стережёт `e2e/window-top-edge.spec.js`, z-порядок из `getBounds()` не читается — его стережёт `tests/window-top-edge.test.js`.

---

<a id="a-restored-position-must-fit-the-whole-window-not-just-its-c"></a>

### A restored position must fit the WHOLE window, not just its corner (CRITICAL)

- **УСТАРЕЛО 12.08.2026.** Правило поменялось: укладывать окно ЦЕЛИКОМ внутрь экрана нельзя — это отменяет НАМЕРЕННОЕ расположение внахлёст с краем. Действует [видимая полоса захвата](#a-restored-position-keeps-a-grabbable-strip-not-the-whole-window-critical). Разбор ниже сохранён: он объясняет, почему проверка по УГЛУ окна неверна, — эта половина по-прежнему верна.
- **A restored position must fit the WHOLE window, not just its corner (CRITICAL)**: `positionWindowClamped()` used to treat a window as visible when its top-left corner landed inside any display's bounds — the window's size never entered the check. Measured: a stored point of `(3320, 70)` with a 1000px window put **880px past the right edge, leaving 12% of the window on screen**. This is not hypothetical: that is exactly the geometry the pre-2.4.2 scaling wrote to `localStorage` (it grew down-right from the top-left corner), so **poisoned profiles already exist, and fixing the scaling does NOT heal them** — restore runs down a different path. Had the stored point been near the TOP edge, the window would be unrecoverable, which is the original «нельзя двинуть наверх» complaint all over again. The fix adds no new arithmetic: `fitScaledBounds()` preserves the centre of the rect it is given, so passing the current size as both the size and the "requested" size means "place at the point, then clamp fully inside". The display of the stored point is still looked up among *really connected* monitors, falling back to primary — that part of the old contract is deliberately kept.

---

<a id="a-restored-position-keeps-a-grabbable-strip-not-the-whole-window-critical"></a>

### Восстановленная позиция сохраняет ПОЛОСУ ЗАХВАТА, а не всё окно (CRITICAL)

- **Восстановленная позиция сохраняет ПОЛОСУ ЗАХВАТА, а не всё окно (CRITICAL)**: у `positionWindowClamped()` было две редакции, и обе ошибались в разные стороны. Первая считала окно видимым по левому-верхнему УГЛУ — размер в проверке не участвовал, и сохранённая точка `(3320, 70)` при окне 1000 px оставляла на экране 12 % ([разбор](#a-restored-position-must-fit-the-whole-window-not-just-its-c)). Вторая стала укладывать прямоугольник ЦЕЛИКОМ — и вместе с испорченными профилями отменила законное расположение: виджет, поставленный внахлёст с краем экрана, после закрытия возвращался внутрь. Замерено зондом на 3440×1440: сохранено `x = 3470`, восстановлено `x = 3190`. Теперь действует `fitRestoredBounds()`: окно ставится КАК СОХРАНЕНО, если по каждой оси на одном из РЕАЛЬНО подключённых мониторов остаётся `CONFIG.WINDOW_MIN_VISIBLE_PX` (64) — но не больше половины окна, иначе полоса LED высотой 44 px обязана была бы помещаться целиком и свисать не могла бы вовсе. Не осталось — окно потеряно, а не свисает, и поджимается прежним способом. Перекрытие считается с КАЖДЫМ монитором по отдельности: полоса, набранная на двух экранах сразу, видимой не является — между ними может не быть общей границы.

---

<a id="window-geometry-is-owned-by-the-main-process-critical"></a>

### Геометрию окна считает ГЛАВНЫЙ процесс, а не рендерер (CRITICAL)

- **Геометрию окна считает ГЛАВНЫЙ процесс, а не рендерер (CRITICAL)**: виджет и часы писали в `localStorage` то, что видели сами — `Math.round(window.outerWidth / baseSize * 100)` и `window.screenX/screenY`. Владеет этими величинами главный процесс: окно двигают и масштабируют его `setBounds`. Пока масштаб экрана 100 %, обе стороны совпадают посимвольно (замерено на 3440×1440: `outerWidth` 250 при `getBounds().width` 250), поэтому расхождение невозможно было заметить ни одним замером на этой машине. На мониторе с масштабом ≠ 100 % CSS-пиксель рендерера и DIP главного процесса — РАЗНЫЕ единицы, и окно записывает свой размер и свою точку в чужих единицах, а восстановление читает их как свои. Обе жалобы из среды репортёра — «виджет самопроизвольно растёт» и «позиция не сохраняется» — это один корень, а не два дефекта. Теперь главный процесс шлёт настоящие границы каналом `window-geometry` после каждой операции, которая двигает или меняет размер окна, а `createWindowGeometry()` пишет то, что пришло. Показания рендерера остались запасным путём: до первого сообщения других данных нет.

---

<a id="a-move-gesture-must-not-change-the-window-size"></a>

### Жест перемещения не меняет размер окна

- **Жест перемещения не меняет размер окна**: `moveWindowBy()` звал `setPosition`, то есть размер оставлял на усмотрение системы. Система вправе его менять: при переходе на монитор с другим масштабом Windows присылает `WM_DPICHANGED` с новым прямоугольником, и окно, которое просто тащат мышью, растёт само. Теперь размер на каждом шаге ЗАДАЁТСЯ — тот, что был у окна в начале жеста (`win.__dragSize`), а границу жеста помечает рендерер: `bindWindowDrag()` шлёт `first: true` в первом движении, потому что канал несёт только дельты и определить начало больше не из чего. За границами жеста размер по-прежнему свободен — тянуть окно за край рамки можно. Проверяется это `e2e/window-drag-size.spec.js`: второго монитора с другим масштабом на машине разработки нет, поэтому роль системы играет `win.setSize()` посреди жеста — воспроизводится не причина, а её наблюдаемое следствие.

---

<a id="the-led-frame-is-sized-by-its-content-not-by-the-window"></a>

### Рамка LED размером с ЦИФРЫ, а окно под ней — полоса

- **Рамка LED размером с ЦИФРЫ, а окно под ней — полоса**: `.widget-digital-display` занимала окно целиком (`width/height: 100%`, `padding: 10%`), а окно виджета было квадратом при любом стиле с полом высоты 140 px — поэтому на минимуме (120×140) тёмная коробка вокруг строки «00:00» и была основной частью виджета. Замерено: рамка 250×250 при цифрах 169×53, то есть выше цифр в 4.7 раза. Теперь рамка растёт от содержимого, а её поля и скругление — доли КЕГЛЯ (`ledStripMetrics()` в `window-geometry.js`), поэтому она обнимает цифры одинаково на любом масштабе. Высоту окна выводит `ledStripHeight()` из ширины и длины строки; ширину не трогает НИКТО — из неё считается сохраняемый процент масштаба, и окно, расширявшееся под содержимое, наращивало бы этот процент с каждым переходом через час. Поэтому строка `H:MM:SS` делает полосу НИЖЕ, а не шире. Пол высоты для этого стиля свой (`WIDGET_LED_MIN_HEIGHT`), и снять его может только главный процесс — рендереру минимум окна недоступен. Ловушка при правке: размер окна собирался в трёх местах (Ctrl+колесо, ползунок панели, восстановление геометрии), и все три считали окно квадратом — полоса схлопывалась обратно от первого же поворота колеса (замерено: 120×95 вместо 120×43), пока вывод высоты не остался в одном месте.

---

<a id="a-hidden-window-does-not-repaint-so-capturepage-returns-a-stale-frame"></a>

### Скрытое окно не перерисовывается, и `capturePage` отдаёт ПРОШЛЫЙ кадр

- **Скрытое окно не перерисовывается, и `capturePage` отдаёт ПРОШЛЫЙ кадр**: кадр `hours-hmax-digital-widget` расходился на 49.6 % и показывал время предыдущего шага (`1:02:03` вместо `99:59:59`), при этом опрос самого окна в ТОТ ЖЕ момент возвращал правильные `textContent` и `remainingSeconds`. Дело не в медленной отрисовке: в режиме съёмки виджет стоит за краем экрана, его страница отчитывается `document.visibilityState === 'hidden'`, а скрытая страница кадров не производит вовсе — композитор отдаёт последний собранный. Сон это не лечит ни при какой длительности, он лишь меняет ВЕРОЯТНОСТЬ попасть в свежий кадр, потому дефект и выглядел плавающим. Лечится прогревочным `capturePage()`, результат которого выбрасывается: первый вызов заставляет собрать кадр, второй его забирает. Там же заменён сон после смены состояния — окно теперь ОПРАШИВАЕТСЯ до совпадения показанного времени с ожидаемым (`waitForRemaining`), потому что «подождать 450 мс» и «дождаться состояния» — разные вещи.

---

<a id="the-capture-harness-must-drive-the-app-through-its-real-paths"></a>

### Стенд обязан ходить теми же путями, что приложение

- **Стенд обязан ходить теми же путями, что приложение**: съёмка слала стиль виджета прямой посылкой в `webContents`, минуя обработчик `widget-style-update` в главном процессе. Пока на стиле висела одна отрисовка, разницы не было. Как только на нём повис ПОЛ РАЗМЕРА окна (полоса LED), кадр стал показывать состояние, в которое приложение попасть не может: 250×140 вместо 250×90 — полоса, поджатая минимумом, который панель на своём пути снимает, а стенд не снимал. Теперь стенд зовёт настоящий обработчик через `ipcMain.emit`. Там же вскрылось второе: размер окна стенд задавал ДО смены стиля, а стиль с 12.08.2026 сам выбирает форму — заданная заранее геометрия перебивалась переходом ИЗ полосы в квадрат, и кадры `flip` уезжали с 320×260 на 320×320 в зависимости от того, какой стиль снимался перед ними.

---

<a id="the-geometry-write-must-wait-until-the-size-has-settled-crit"></a>

### The geometry write must wait until the size has SETTLED (CRITICAL)

- **The geometry write must wait until the size has SETTLED (CRITICAL)**: the widget and clock persist `{scalePct, x, y}` on the window `resize` event, and the decision "write or not" must NOT be taken inside the handler. `restore()` sets `scalePct` immediately — it has to, otherwise the echo of its own resize writes the position *before* `*-set-position` lands and clobbers the restored one — but the window is still at its OLD size at that moment. So an early `resize` arrived with `pct = 100` against `scalePct = 400`, the "not equal" guard *let the write through*, and the restored geometry was overwritten with the default open position. Measured: run 1 stored `{scalePct:400,x:2440,y:30}`; run 2 restored it correctly (window really was 1000×1000 at 2440,30) while storage now read `{scalePct:100,x:3170,y:30}` — so the NEXT open showed 250px and the scale was gone. The guard designed to suppress the echo was doing the opposite. `saveSettled()` in `window-geometry.js` owns it now: it debounces `SAVE_SETTLE_MS` (300) and reads `getOuterWidth()` **at fire time, not at event time**, so one event is enough and a drag-resize storm collapses into one write. The Ctrl+wheel path is untouched — it calls `save()` explicitly and immediately. `cleanup()` calls `cancelPendingSave()`, same principle as `FlipCard.cancelPending()`.

---

<a id="geometry-is-saved-on-resize-not-only-from-ctrlwheel"></a>

### Geometry is saved on `resize`, not only from Ctrl+wheel

- **Geometry is saved on `resize`, not only from Ctrl+wheel**: the mechanism itself lives in `window-geometry.js` — it was two VERBATIM clones, differing in exactly four values (storage key, base size 250/220, and the resize/position channel pair); the drag block differed in ONE line, the channel name. The fullscreen display is deliberately NOT part of it: its drag has no `preventDefault`, carries a fullscreen heuristic and stores no geometry, so folding it in would change behaviour rather than remove duplication. The guard is load-bearing: `restoreGeometry()` itself triggers a resize at startup, and without it `saveGeometry()` would write the position *before* `*-set-position` lands and clobber the restored one. Without the resize hook, the panel's "Масштаб часов" slider (which only sends `clock-widget-resize`) was lost on reopen, and the panel restores that slider from `clockGeometry` because it has no value of its own in `displayExtSettings`.

---

<a id="a-theme-block-must-sit-below-the-shared-root-and-its-name-mu"></a>

### A theme block must sit BELOW the shared `:root`, and its name must not appear above it (CRITICAL)

- **A theme block must sit BELOW the shared `:root`, and its name must not appear above it (CRITICAL)**: `[data-theme="light"]` and `:root` have the SAME specificity (0,1,0) — one attribute selector against one pseudo-class. At equal specificity the later rule wins, so the shared `:root` block at the end of `design-tokens.css` was re-declaring `--tw-shadow-panel` and all three `--tw-glow-*` back to their dark values, and the light theme's entire "no neon on white" intent was dead — on a white surface the panel still drew a 30px blue glow. The comment sitting next to those declarations («глубина на светлом даётся тенью, а не свечением») described an intention that had never once taken effect. The four declarations now live in the `:root, [data-theme="dark"]` block. Second trap in the same file, and the header already warns about it: `tests/contrast.test.js` slices the file by SUBSTRING SEARCH for the theme selector, so writing `[data-theme="light"]` verbatim inside a comment ABOVE the real block moves the slice onto the wrong theme — two contrast tests went red during this pass for exactly that reason, and they were right.

---

<a id="the-surface-ladder-exists-in-both-themes-and-runs-opposite-w"></a>

### The surface ladder exists in BOTH themes and runs opposite ways

- **The surface ladder exists in BOTH themes and runs opposite ways**: `--tw-level-1/2/3` used to be declared only under `[data-theme="light"]`, which is why every fill in the dark panel was a literal — 33 distinct `rgba(255,255,255,·)` alphas in `control.css` alone. Hierarchy could not be *expressed*, only guessed at, and the result was five sections reading as identical grey stripes. Dark steps are translucent (the panel sits on `.app-shell::before`'s radial gradient and a solid fill would clip it); light steps are solid and get DARKER as they rise. Note what this is not: swapping literals for tokens of the same value changes zero pixels — that is tidiness, not design. The fix is a ladder with NEW values plus a repaint.

---

<a id="a-hit-area-is-grown-with-a-pseudo-element-never-with-the-box"></a>

### A hit area is grown with a pseudo-element, never with the box

- **A hit area is grown with a pseudo-element, never with the box**: the obvious fix for a 12×12 traffic-light button — `width: 24px; padding: 6px; background-clip: content-box` — draws rounded SQUARES, because `border-radius: 50%` is computed against the 24px border box while the paint is clipped to the 12×12 content box. Use `position: relative` + `::after { inset: -6px }`: the artwork does not change at all. The residual is accepted knowingly: centres stay 19px apart, so SC 2.5.8's spacing exception is not met — macOS itself ships 20px, and matching the platform beat matching the spec here.

---

<a id="a-colour-default-has-an-owner-too-and-the-owner-is-css"></a>

### A colour default has an owner too, and the owner is CSS

- **A colour default has an owner too, and the owner is CSS**: the same style looked different per window, and the cause was data, not CSS. The panel held `#667eea`/`#764ba2` — a purple pair absent from the token set entirely; the widget substituted a hardcoded `#0a84ff` inline; the display and the clock substituted nothing. Since inline beats every rule, the widget's substitution killed several *documented* states outright: the promised `--tw-led-green` on LED digits never once applied, flip digits rendered blue instead of `--tw-fg`, and the analog second hand came out blue-green instead of its own red. Three of four styles did not look the way they were written. The substitution is gone; CSS owns the default and the user's colour still overrides it inline, exactly as in the clock. `CONFIG.DEFAULT_TIMER_COLORS` has ONE consumer left — the panel's initial state. Deleted alongside: `CONFIG.DEFAULT_COLORS`, a fifth palette no file ever read, carrying `overtime: '#ff6b35'` — the orange this project banned everywhere else.

---

<a id="the-e2e-profile-is-shared-so-a-test-that-flips-global-state"></a>

### The e2e profile is shared, so a test that flips global state must flip it back

- **The e2e profile is shared, so a test that flips global state must flip it back**: `e2e/launch.js` uses ONE user-data dir for the whole run (crash-recovery needs the snapshot to survive a relaunch). A spec that clicked `#contrastToggle` and closed left the app in the light theme, and `ui-theme.spec.js` then failed with «тема должна стартовать как dark» — in isolation both passed. Same class of fragility: asserting against `.controls-hint`, which fades itself out, compares against a zero-height rect in a long run and against a live one in a short one. Reserve the strip by geometry instead.


---

<a id="an-unreachable-theme-is-an-untested-theme"></a>

### An unreachable theme is an untested theme

- **An unreachable theme is an untested theme**: `design-tokens.css` shipped three `[data-theme]` blocks while nothing ever set the attribute. Two of them were dead, and *because* they were dead their contrast was never tuned — the light theme's labels sat at 2.70:1. Measuring the cost settled it: 72 `rgba(255,255,255,·)` + 32 `rgba(0,0,0,·)` + 25 hex literals in `control.css` alone, plus 8 inline `style=` colours in the markup (inline beats any theme, so those had to move to classes first). The light block was deleted and `hc-dark` was wired up instead; in 2.4.1 light came BACK as the second theme (see the light-theme entry below) and is held at AAA (7:1) by `tests/contrast.test.js` — the cost estimate above turned out overstated: the panel needed ~10 hardcoded text colours re-painted, not ~200, because the rest of the literals are fills that a theme-scoped block can override wholesale. If you add a `[data-theme]` block, add it to `UI_THEMES` in `ui-theme.js` too — `tests/ui-theme.test.js` checks BOTH directions and fails on a block you cannot reach from the UI.

---

<a id="design-tokenscss-holds-tokens-not-recipes"></a>

### `design-tokens.css` holds tokens, not recipes

- **`design-tokens.css` holds tokens, not recipes**: it used to end with ~135 lines of "semantic recipes" (`.tw-timer-hero`, `.tw-led`, `.tw-panel`, `.tw-chip` with `.is-success` / `.is-attention`, `.tw-interactive`, `.tw-spin`, `.tw-error-msg`, `.tw-status-glyph`, `.tw-is-overtime`, `.tw-is-breathing`) that no window ever used — deleting all 24 rules changed ZERO computed values, pseudo-elements included, in all four windows. Two of them were the "second colour system on one element" this file warns about elsewhere, defused only by the fact that `.tw-chip` matched nothing (`display-script.js` still defensively strips those classes). The only rules left are `h1` and `h2`, and they are element selectors that ARE live (the panel's `#faqModalTitle` loses `letter-spacing` and 4.4px of width without them). A recipe nobody applies is worse than no recipe: it is a design decision that was never reviewed by looking at it.

---

<a id="opening-a-window-has-one-owner-the-create-function-critical"></a>

### Opening a window has ONE owner — the create-function (CRITICAL)

- **Opening a window has ONE owner — the create-function (CRITICAL)**: the announcement (`broadcastWindowState(..., isOpen: true)`) and the hydration (`timer-state`, saved settings, per-window colours and style) used to live in the `ipcMain.on('open-*')` handlers. Tray items call `createWidgetWindow()` / `createClockWidgetWindow()` DIRECTLY, so everything in the handler was skipped: the panel's button stayed inactive, W/C thought the window was closed, sent `open-*`, main merely `focus()`ed the live window, and the toggle looked dead until the window was closed again. `announceWindowOpened(win, channel, hydrate)` now does both from inside the create-function, and the handlers are thin (`if (!win) create(); else win.focus();`). The `did-finish-load` listener is `on`, NOT `once`, for the same reason as the state snapshot: a renderer reloaded by `bindRenderCrashHandler` must be re-hydrated. Same root cause fixed alongside: `bindTrayBehavior(controlWindow)` moved out of `whenReady` into `createControlWindow`, because the panel is recreated from the tray, from second-instance and on `activate` — every copy after the first had lost "close = hide to tray". Guarded by `tests/window-open-ownership.test.js`, which cuts function bodies by BRACE BALANCE (`tests/helpers/source-scan.js`), so indentation cannot fool it.

---

<a id="a-payload-default-is-not-a-guard"></a>

### A payload default is not a guard

- **A payload default is not a guard**: `ipcMain.on('timer-command', (_event, payload = {}) => …)` only covers `undefined` — an explicit `null` reached the destructuring and threw. Both handlers now normalise (`isPayloadObject(payload) ? payload : {}`) rather than return early. For `open-display` the difference is load-bearing: the widget and the clock send that channel with NO payload at all (the D key), meaning "reuse the last monitor", so a strict `if (!isPayloadObject) return` would have silently killed the shortcut. Normalise where absence is legal; return early only where it is not.

---

<a id="a-setting-field-needs-an-owner-too-not-just-the-key-critical"></a>

### A setting field needs an owner too, not just the key (CRITICAL)

- **A setting field needs an owner too, not just the key (CRITICAL)**: `timerStyle` / `timerScale` meant DIFFERENT windows depending on where you read them — inside `displayExtSettings` they are the WIDGET's (written by `alsoWrite` in `settings-schema.js` so a version rollback keeps the setting), while in the `display-settings-update` IPC packet the panel sends the DISPLAY's under the same names. `applyDisplaySettings` receives both (IPC from the panel, storage on self-load), so the fullscreen window painted the widget's style on its first frame, and `_lastPushedTimerScale` was seeded with the widget's scale — which made the "first push must not clobber the local scale" guard take the wrong branch and be effectively dead (only the `report-scale` echo hid it). Fixed by NAME, not by a patch at the receiving end: `RendererShared.pickOwnSetting(settings, ownKey, sharedKey)` asks for the window's own name first and keeps the shared one as fallback (rollback + existing e2e still send the bare name). The comparison is against `undefined`, so a stored `0` or `''` does not fall through. `tests/storage-keys.test.js` cannot see this class of bug — it checks TOP-LEVEL keys, not fields inside a JSON bag.

---

<a id="tests-and-screenshots-run-in-their-own-profiles"></a>

### Tests and screenshots run in their OWN profiles

- **Tests and screenshots run in their OWN profiles**: `e2e/launch.js` passes `--user-data-dir=$TMPDIR/timer-widget-e2e-profile` (wiped by `e2e/global-setup.js` before each run), and `scripts/run-electron.js` adds `$TMPDIR/timer-widget-visual-profile` — but ONLY for `--screenshot`; `npm start` and `npm run dev` keep the live profile, because the real app must remember the user's settings. Before this, both wrote into `~/Library/Application Support/timer-widget`: running e2e wiped the user's colours, and `visual:check` inherited whatever was left, so its regression count drifted 44 → 40 → 39 → 14 across identical runs while looking deterministic. The e2e profile is ONE directory for the whole run, not one per launch: `crash-recovery.spec.js` SIGKILLs the app and expects the recovery snapshot to survive the relaunch, so a fresh directory per launch would make it green forever. The old rule "don't count the first `visual:check` after e2e" is retired.

---

<a id="codeonly-is-one-implementation-in-testshelperssource-scanjs"></a>

### `codeOnly()` is ONE implementation, in `tests/helpers/source-scan.js`

- **`codeOnly()` is ONE implementation, in `tests/helpers/source-scan.js`**: it existed in three copies that had already drifted — two stripped `<!-- -->`, the third did not, so an HTML assertion could be satisfied by commented-out markup. The same file also holds `maskNonCode` / `functionBody` / `ipcHandlerBody` / `constructorBlocks`, which cut source by brace balance rather than by indentation. Note the trap found while writing them: `ipcMain.on('open-display', (event, options = {}) => {` — the FIRST `{` after the channel belongs to the parameter default, so a naive "balance from the first brace" slices out an empty object, and every absence assertion against that slice passes vacuously.

---

<a id="the-bridge-exposes-no-invoke"></a>

### The bridge exposes no `invoke`

- **The bridge exposes no `invoke`**: `ipcMain.handle` does not exist anywhere in this project, so the two-way wrapper in `preload.js` could only ever hang. Surface on the sandbox bridge is not free — `tests/ipc-liveness.test.js` now ties the two together in BOTH directions: add a `handle` and the test demands `invoke` back.

---

<a id="release-gates-count-windows-they-dont-count-matches"></a>

### Release gates count windows, they don't count matches

- **Release gates count windows, they don't count matches**: the old DevTools test asserted `devToolsMatches.length === 4`. A fifth window added WITHOUT the guard leaves the count at 4 — it passes. `tests/release-gates.test.js` extracts every `new BrowserWindow({` block BY BRACE BALANCE (the old parser looked for the literal `\n    });`, i.e. a four-space indent, so a fifth window declared inside an `if` merged with its neighbour and INHERITED its guards — proven by mutation) and requires the guard in each, plus whole-file absence checks that use no block boundaries at all; `scripts/verify-packed.js` repeats the check on the real `app.asar` after electron-builder. Verified by mutation, which is how the first version of the `openDevTools` check was caught looking at a nearby `devTools:` line instead of a real guard.

---

<a id="no-sandbox-was-cancelling-the-apps-own-sandbox-true"></a>

### `--no-sandbox` was cancelling the app's own `sandbox: true`

- **`--no-sandbox` was cancelling the app's own `sandbox: true`**: the flag sat in `build.linux.executableArgs`, so it shipped to EVERY Linux target, while `build/linux-after-install.sh` deliberately stripped the SUID bit "to fall back on user namespaces" — the sandbox therefore worked through neither path. `executableArgs` also exists on `CommonLinuxOptions`, so it can be scoped: deb now gets a proper SUID helper (`chmod 4755` + `chown root:root`) and no flag; AppImage keeps the flag because it has no install step and unprivileged user namespaces are not universally available (hardened kernels; AppArmor restricts them since Ubuntu 24.04). Checked on the built packages by the `linux-sandbox` CI job — none of this is verifiable from macOS.

---

<a id="the-rot-is-not-confined-to-storage_keys-the-whole-of-config"></a>

### The rot is not confined to `STORAGE_KEYS` — the WHOLE of `CONFIG` had it (CRITICAL)

- **The rot is not confined to `STORAGE_KEYS` — the WHOLE of `CONFIG` had it (CRITICAL)**: measured 10 Aug 2026, **32 of 53 keys were read by nobody at all**, and five of those had a literal twin in the code that had already drifted: `CONTROL_WINDOW_MIN_HEIGHT` said 300 against a real 660, `MIN/MAX_TIMER_SCALE` said 50/200 against a real 30/300, `SCALE_STEP` said 20 "pixels" against three windows each holding their own literal 10 *percent*, `CLOCK_WIDGET_MIN_SIZE` said 100 against a real 120, `CONTROL_WINDOW_HEIGHT` said 500 against a real 660–740. Worst of all was `WARNING_THRESHOLD`: `getTimerStatus()` carried its own literal `60` and never read the constant, while a test named *«CONFIG.WARNING_THRESHOLD aligns with getTimerStatus»* asserted `=== 60` — the registry compared against itself. Changing the literal broke nothing; changing the constant broke the test while behaviour did not move a second. That test now pins the BEHAVIOURAL boundary (`getTimerStatus(CONFIG.WARNING_THRESHOLD, …) === 'warning'`) so it moves with the constant. Keys with a twin were given a real reader; the 21 with neither reader nor twin were deleted, exactly as the 16 phantom `STORAGE_KEYS` were. `tests/constants.test.js` now fails on any key nothing reads — it walks every `.js`/`.html` in the repo and excludes only `constants.js` and itself, so a key cannot be kept alive by its own registry entry or by the test that checks it.

---

<a id="configstorage_keys-is-a-registry-not-an-access-point"></a>

### `CONFIG.STORAGE_KEYS` is a registry, not an access point

- **`CONFIG.STORAGE_KEYS` is a registry, not an access point**: renderers use string literals (no bundler, no wrapper module), so the map cannot break — it silently rots. It had 16 phantom keys and was missing 10 real ones. `tests/storage-keys.test.js` now checks it in BOTH directions and additionally fails on any key that is write-only (a setting going nowhere) or read-only (always the default) — both had really happened here.

---

<a id="the-display-has-no-browser-mode-fallback"></a>

### The display has no browser-mode fallback

- **The display has no browser-mode fallback**: `display-script.js` used to branch on `window.ipcRenderer` and otherwise sync through a `timerState` localStorage key with 1s polling. Nothing in the project ever wrote that key, so the branch could not work at all; it is gone. `display.html` is only ever loaded by `loadFile()` inside Electron.

---

<a id="ipc-whitelist-is-duplicated"></a>

### IPC whitelist is duplicated

- **IPC whitelist is duplicated**: `preload.js` inlines the whitelist from `channel-validator.js` (sandbox blocks `require()`). Both files MUST stay in sync — the test `channel-validator.test.js` verifies this.

---

<a id="a-whitelisted-channel-is-a-permission-not-a-feature-critical"></a>

### A whitelisted channel is a permission, not a feature (CRITICAL)

- **A whitelisted channel is a permission, not a feature (CRITICAL)**: three channels were listed in both whitelists with only one end wired. `widget-set-opacity` and `close-window` had a handler in main and ZERO senders — widget opacity was unreachable and windows are closed by the addressed channels instead; the clock even read an `opacity` key from `clockWidgetSettings` that nothing ever wrote. `timer-recovery-available` was worse: main sent it after a crash and NO renderer listened, so the user saw a restored time with no explanation of where it came from — and the comment next to the send read "the channel is no longer dead code", which was true only of the send. `tests/ipc-liveness.test.js` now requires both ends for every whitelisted channel, resolving the indirect emitters (events go out through the `onEvent(name)` callback in `timer-controller.js`, the display list through `event.sender.send`, the theme through `bindThemeSync(ipc)`).

---

<a id="adding-new-ipc-channel"></a>

### Adding new IPC channel

- **Adding new IPC channel**: Add to BOTH `send` and `receive` arrays in BOTH `preload.js` and `channel-validator.js`. Missing receive = widget silently ignores messages.

---

<a id="per-window-colors"></a>

### Per-window colors

- **Per-window colors**: there is deliberately NO global colour broadcast — a `colors-update` channel does not exist and must not be added. Use `widget-colors-update`, `clock-colors-update`, `display-colors-update` so colours cannot bleed between windows.

---

<a id="ipc-compatjs"></a>

### `ipc-compat.js`

- **`ipc-compat.js`**: All renderer HTML files use `ipcRenderer.on/send` which is shimmed to `electronAPI` via this compat layer. Don't use `electronAPI` directly in renderers.

---

<a id="global-keyboard-shortcuts"></a>

### Global keyboard shortcuts

- **Global keyboard shortcuts**: Space (start/pause), R (reset), 1-8 (presets 5-60 min), W/C/D (toggle windows) work from ALL windows (widget, clock, display, control). Guarded with `if (e.ctrlKey || e.altKey) return` to avoid conflicts with scale/drag.

---

<a id="window-state-broadcast"></a>

### Window state broadcast

- **Window state broadcast**: `broadcastWindowState()` in main process sends `*-window-state` to ALL windows (not just control). Required for W/C/D toggle shortcuts to know current state.

---

<a id="start-sound-from-remote-windows"></a>

### Start sound from remote windows

- **Start sound from remote windows**: Control panel detects `!wasRunning → isRunning` transition in `timer-state` handler and plays start sound. `_localStartTriggered` flag prevents double-play when start button clicked locally.

---

<a id="monitor-selection-persistence"></a>

### Monitor selection persistence

- **Monitor selection persistence**: Main process stores `lastDisplayIndex`. When `open-display` arrives without `displayIndex` (from widget/clock D key), reuses last selection instead of defaulting to auto.

---

<a id="inline-styles-in-html"></a>

### Inline styles in HTML

- **Inline styles in HTML**: Each HTML file has ~1000+ lines of inline CSS/JS. CSP requires `unsafe-inline`. No external CSS frameworks.

---

<a id="widget-devtools"></a>

### Widget devTools

- **Widget devTools**: Set to `false` in production. Change to `true` in `electron-main.js` for debugging.

---

<a id="a-control-with-no-visual-coverage-has-no-layout-guarantee"></a>

### A control with no visual coverage has no layout guarantee

- **A control with no visual coverage has no layout guarantee**: the settings drawer was closed in every screenshot, so its contents were never compared. The first capture with it open immediately showed the panel's presets rendering UNDER the drawer at max window width — `--control-panel-width` was set to the window's current width while the requested resize was clamped by `maxWidth`. `CONFIG.CONTROL_WINDOW_MAX_WIDTH` is now the single source for both the main process's `maxWidth` and the panel's column arithmetic (`min(current, max - drawer)`), measured by `e2e/drawer-layout.spec.js`. Same lesson as the info blocks: add the capture first, then you can see the bug.

---

<a id="design-previews"></a>

### Design previews

- **Design previews**: Always read real HTML structure first, replicate exact layout, then apply CSS-only improvements. Never generate new layouts from scratch.

---

<a id="sounds"></a>

### Sounds

- **Sounds**: 29 built-in sounds synthesised with oscillators in `sound-bank.js` (`BUILT_IN_PRESETS` + one `switch` branch each). No audio files. `tests/sound-bank.test.js` keeps the list, the `switch` and the `<option>`s in the four sound selects in sync — they cannot drift apart silently.

---

<a id="control-panel-layout"></a>

### Control panel layout

- **Control panel layout**: Titlebar → Timer (52px) → Start/Pause/Reset → Presets 8×1 → Adjust +/- → Manual time input → Overtime+Windows (merged row) → Tabs always visible (Виджет, Часы, Полноэкранный, Звуки). Settings in 2-column grid.

---

<a id="syncclockstyle"></a>

### syncClockStyle

- **syncClockStyle**: Defaults to **`false`** (`this.syncClockStyle = !!ext.syncClockStyle` in `loadSettings`) — the clock keeps its own style unless the user opts in. When true, clock style follows the widget style dropdown, and the `timerStyleEl` change handler must send both `widget-style-update` AND `clock-widget-set-style`. Changing the clock style directly from the Часы tab turns the sync back off. С 13.08.2026 тот же обработчик обязан ещё и переписать `clockStyleEl.value`: переключатель часов зеркалит виджет, а не хранит невидимый собственный выбор — см. [разбор про ряд стиля часов](#clockstylerow-must-be-on-the-real-row).

---

<a id="widgetclock-geometry-persistence"></a>

### Widget/clock geometry persistence

- **Widget/clock geometry persistence**: size (Ctrl+wheel) and position (drag) are stored per window in `localStorage` under `widgetGeometry` / `clockGeometry` as `{ scalePct, x, y }`, restored in `restoreGeometry()` on open. The main process clamps a restored position via `positionWindowClamped()` — a saved point can reference a monitor that is no longer attached.

---

<a id="scale-pushes-must-be-change-detected"></a>

### Scale pushes must be change-detected

- **Scale pushes must be change-detected**: the control panel re-sends its FULL settings object on every unrelated change (colour, background, blocks). Renderers therefore apply `timerScale`/`timeBlocksScale` only when the value actually differs from the previous push (`_lastPushedTimerScale`), otherwise a colour tweak silently resets a scale the user set with Ctrl+wheel. The same pattern guards `timeLayoutPreset`.

---

<a id="escape-is-layered"></a>

### Escape is layered

- **Escape is layered**: the drawer, the modals and the global shortcut handler all listen for Esc on `document`. The global handler must bail out via `_isEscapeConsumedByOverlay()` when a nearer layer is open, or one keypress closes both the dialog and every widget window.

---

<a id="a-fitted-size-must-never-be-measured-against-its-own-output"></a>

### A fitted size must never be measured against its own output (CRITICAL)

- **A fitted size must never be measured against its own output (CRITICAL)**: the display's «Цифры» took its available height from `getBoundingClientRect()` of `#timerDigits`, declared `height: 100%` inside `.display-container` — whose height is `auto`. A percentage against `auto` resolves to `auto`, i.e. to the content height, i.e. to the height of the very digits being sized. The fit fed its own output back in and multiplied the size by **0.744 on every single recalculation**: 89.26 → 66.38 → 49.38 → 36.73 → 27.31 → 20.32 (measured). On a projector the timer shrank on any window resize and on the switch to `H:MM:SS`. The widget and the clock never had it — they take the frame from `this.container.offsetWidth/offsetHeight`, i.e. from the WINDOW. Two things this teaches: the sizing frame must be an element whose box does not depend on the thing being sized (`--timer-box` on `.display-container` is now that frame, shared with the ring so the literal exists once); and **"the size changes with the window" is not the invariant that catches this** — a collapse is also a change. The invariant is **idempotence**: `e2e/digits-style.spec.js` recalculates three times with nothing changed and demands one size, in all three windows, driven by a real `resize` event. Found by LOOKING at a screenshot — the display filled a fifth of the frame where the widget filled four fifths — which is exactly what the "look at the captures" step of a plan is for.

---

<a id="accent-text-on-an-accent-fill-is-a-contrast-trap-not-bad-luc"></a>

### Accent text on an accent fill is a contrast trap, not bad luck with numbers

- **Accent text on an accent fill is a contrast trap, not bad luck with numbers**: the selected font in the «Цифры» list was painted `var(--tw-blue)` over `rgba(10,132,255,0.14)`. Text and fill of the same hue pull luminance the same way, so the ratio collapses systematically — measured on the REAL pixel (element screenshot → canvas → `getImageData`) at 2.46:1 dark / 5.36:1 light against thresholds of 4.5 and 7. The fix is the treatment `.tab-btn.active` and `.segmented button.active` already use: a neutral raised surface plus `--tw-fg`. Note also that the analytic model in `tests/contrast.test.js` and the real pixel disagree by a wide margin (analytic 10.31:1 where the pixel says 7.56:1, because the panel's actual backdrop there is lighter than the simplified chain assumes) — the analytic test is a guard, not a measurement. `.bg-mode-btn.active` still carries the same defect and is pinned by a number in that test rather than silently tolerated.

---

<a id="a-capture-harness-must-wait-for-the-theme-too-not-just-for-f"></a>

### A capture harness must wait for the theme too, not just for fonts

- **A capture harness must wait for the theme too, not just for fonts**: the theme is delivered by ordinary IPC and applied by a handler in the renderer, so `sleep(500)` after broadcasting is a race — `light-control.png` came back 99.72% different (the whole frame in the DARK theme) on the third consecutive run, after two clean ones. `waitForTheme()` polls `data-theme` and then waits **two `requestAnimationFrame`s**: the snapshot comes from the compositor, not the DOM, so a correct attribute with no new frame still yields the previous picture. Same lesson as `document.fonts.ready`. And note the arithmetic when you verify such a fix: at a ~1/3 flake rate, three clean runs happen by chance ~30% of the time — six were run here.

---

<a id="applycolors-must-cover-all-5-styles"></a>

### applyColors must cover all 5 styles

> **УСТАРЕЛО с 11.08.2026.** Механизм, который описывает этот разбор, удалён:
> цвет темы приходит CSS-переменной, состояние задаётся классом, инлайн не
> используется вовсе. Разбор оставлен как история — он объясняет, ПОЧЕМУ так
> нельзя, и это по-прежнему полезно. Действующее правило:
> [Цвет — это переменная, состояние — это класс](#color-belongs-to-the-cascade).

- **applyColors must cover all 5 styles**: In widget/clock/display, `applyColors()` must update circle (SVG gradient), digital (LED text + text-shadow), flip (digits + separators), analog (second hand + center dot) and digits. Not just the circle style.

---

<a id="inline-colours-must-have-a-reset-branch-critical"></a>

### Inline colours MUST have a reset branch (CRITICAL)

> **УСТАРЕЛО с 11.08.2026.** Механизм, который описывает этот разбор, удалён:
> цвет темы приходит CSS-переменной, состояние задаётся классом, инлайн не
> используется вовсе. Разбор оставлен как история — он объясняет, ПОЧЕМУ так
> нельзя, и это по-прежнему полезно. Действующее правило:
> [Цвет — это переменная, состояние — это класс](#color-belongs-to-the-cascade).

- **Inline colours MUST have a reset branch (CRITICAL)**: the `danger` / `warning` / `overtime` bands write **inline** `style.color` (inline always beats the CSS class), so every band ladder needs a final `else` that puts the colour back. Writing that branch as `else if (this._baseTimerColor)` is a **bug**: `_baseTimerColor` is only set once `applyColors()` runs with a valid colour, which never happens until the user picks a theme — so on a fresh profile the red simply never came off, and the timer stayed red even after a new preset was set. Reset with `this._baseTimerColor || ''` (or `_normalColor()` / `_normalGlow()` in `display-script.js`): the empty string **removes** the inline style and hands control back to CSS. The same rule covers the analog hands / clock centre, which are reset from `_baseSecondHandBg` / `_baseCenterBg` / `_baseAnalogDigitalColor` — those are saved on every `applyColors()` call, including during overtime, precisely so there is something to restore to.

---

<a id="centre-the-digits-not-the-whole-inscription"></a>

### Centre the DIGITS, not the whole inscription

- **Centre the DIGITS, not the whole inscription** (minus sign): you cannot have both — the two centres differ by exactly half the sign's width. The project first centred the digits (sign at `width: 0`), then flipped to centring the whole inscription, and both were wrong for the same reason: they picked the wrong reference. The reference is not the text block, it is the **frame the eye compares against** — the panel's central axis (shared with the status chip and the transport buttons) and, in circle/analog styles, the **centre of the ring**. Measured in overrun with the inscription centred, the digits sat +26px off-axis in the panel, +16px in the widget and **+54px on the fullscreen display**: inside a ring that reads as broken, and on a projector it is the first thing you see. The user reported it as "капец как режет глаза" — that is the ground truth this rule now encodes.
  The mechanism avoids arithmetic in `em`: the container shrinks to its content and is centred (`width: fit-content; margin-inline: auto`), so its left edge coincides with the DIGITS' left edge, and the sign is positioned absolutely from that edge (`right: 100%`) taking no layout width. Applies to `.timer-display-main` (panel), `.time-display` (widget), `.time-text` / `.analog-digital-time` (display).
  **Two details are load-bearing, both found by looking at the result:**
  1. the sign must be **vertically centred on the digits** (`top: 50%; transform: translateY(-50%)`), not anchored to `top: 0` — at a reduced size a top-anchored minus renders as a superscript;
  2. the sign is **smaller than the digits** (`font-size: 0.62em`) with a tight gap (`margin-right: 0.1em`). A full-size minus with a 0.2em gap is a separate blob of ink that drags the composition left — geometrically the digits were centred, and the user still said it did not look centred. Shrinking the sign cut the inscription's offset by ~40% (display: −49px → −30px) while keeping the digits exactly on the ring centre, and the minus still sits **inside** the ring (clearance 42.9px widget / 80.9px display, measured).
  `e2e/overtime-centering.spec.js` asserts all of it: digits within 1.5px of the reference, the inscription NOT centred (proving the sign is out of flow), and the sign inside the ring.

---

<a id="the-clocks-superscript-seconds-are-the-opposite-case"></a>

### The clock's superscript seconds are the opposite case

- **The clock's superscript seconds are the opposite case**: they are secondary, so they must NOT take layout width (`width: 0; overflow: visible`, offset via `transform`). Otherwise the whole block centres and the primary `HH:MM` sits 9.5px left of the ring centre — and toggling seconds in settings visibly jumps the time.

---

<a id="both-rules-were-settled-by-measuring-in-e2e-digit-centre-ins"></a>

### Both rules were settled by measuring in `e2e` (digit centre, inscription centre,

- Both rules were settled by measuring in `e2e` (digit centre, inscription centre, gap in `em`), never by eye — eyeballing produced two wrong iterations in a row.

---

<a id="flip-animation-is-shared"></a>

### Flip animation is shared

- **Flip animation is shared** (`flip-card.js`): it once existed only on the display while the widget and clock swapped digits instantly. It fires ONLY when the digit actually changed — driving every card each tick turns the effect into flicker. The class is removed on a timer rather than on `animationend`, because switching styles mid-animation means the event never arrives and the card would keep the class forever. `FLIP_DURATION_MS` must match the CSS animation duration in all three windows; a test asserts it.

---

<a id="a-segmented-controls-value-setter-must-not-fire-change-criti"></a>

### A segmented control's `.value` setter must NOT fire `change` (CRITICAL)

- **A segmented control's `.value` setter must NOT fire `change` (CRITICAL)**: `_attachSegmented()` makes `div.segmented` impersonate a form control, and it must copy native `<input>`/`<select>` semantics exactly — assignment is silent, only a user click dispatches `change`. When the setter also fired the event, the whole «Синхронизировать со стилем виджета» feature was dead: ticking the box ran `clockStyleEl.value = timerStyleEl.value`, the setter fired `change`, and the `clockStyleEl` handler — whose entire job is "the user picked a clock style, so turn sync off" — unticked the box and persisted `syncClockStyle: false`. `loadSettings()` restoring `clockStyleEl.value` destroyed a saved `true` the same way, so the checkbox could never stay on. This is the same invariant CLAUDE.md already states for sliders from the other side ("assigning `slider.value` does not fire `input`, which is what keeps the loop open"). Covered by `e2e/clock-style-sync.spec.js`.

---

<a id="clockstylerow-must-be-on-the-real-row"></a>

### Скрытый ряд — это скрытое состояние: переключатель часов зеркалит виджет

Разбор переписан 13.08.2026: прежнее правило звучало «панель прячет этот ряд
при включённой синхронизации», и именно пряталово оказалось дефектом. Правило
про сам id действует по-прежнему: если двигаете разметку,
`#clockStyleRow` обязан оставаться на элементе, который РЕАЛЬНО оборачивает
`#clockStyle` (e2e проверяет `row.contains(picker)`). Когда-то этот id висел на
пустом сироте-`<div>` внутри блока `display:none` «removed from UI but needed by
JS» — прятать было нечего, и пользователь видел активный выбор стиля часов,
противоречащий только что поставленной галочке.

Само пряталово прожило дольше и стоило дефекта от пользователя: «меняю стиль —
меняются оба окна, а в настройках стиль не тот». Цепочка такая. Ряд скрыт, пока
включена синхронизация. Значит, единственный видимый переключатель стиля — у
виджета, и он двигает ОБА окна, а откуда взялась связь, на экране не написано.
Одновременно панель хранила собственный выбор часов (`clockStyle: digits`),
которого на экране нет (часы рисуют `circle` вслед за виджетом) — и отчитывалась
им в подписи строки. Профиль пользователя это и показал: `syncClockStyle: true`,
`clockStyle: digits`, `widgetTimerStyle: circle`.

**Правило.** Ряд виден ВСЕГДА. При включённой синхронизации переключатель часов
показывает ДЕЙСТВУЮЩИЙ стиль, то есть зеркалит виджет (в UI, в хранилище, в
подписи), а клик по нему означает «хочу свой» и снимает синхронизацию —
обработчик для этого был и раньше. Прятать контрол, чтобы убрать противоречие
между ним и реальностью, — значит убрать вместе с противоречием и ответ на
вопрос «почему это изменилось само».

**Чем закреплено.** Присваивание `clockStyleEl.value = timerStyleEl.value` в
обработчике стиля виджета и в `loadSettings()` (второе лечит профили прежней
версии, где расхождение уже накоплено); сеттер сегментированного контрола
намеренно НЕ порождает `change`, иначе синхронизация гасила бы сама себя.
Замеряется `e2e/clock-style-sync.spec.js` — включая то, что клик по стилю часов
снимает галочку и НЕ трогает виджет.

---

<a id="segmented-controls-are-roleradiogroup-roleradio-aria-checked"></a>

### Segmented controls are `role="radiogroup"` + `role="radio"` + `aria-checked`, not tabs

- **Segmented controls are `role="radiogroup"` + `role="radio"` + `aria-checked`, not tabs**: they used to be `role="tablist"` with plain buttons inside — an invalid structure (a tablist must contain `role="tab"`), and the selection lived only in the `.active` CSS class, so assistive tech saw a group of identical unlabelled-state buttons. `_attachSegmented()` now owns both the class and `aria-checked` in one place; they cannot drift.

---

<a id="overtime-on-the-display-is-painted-by-danger-never-by-overti"></a>

### Overtime on the display is painted by `.danger`, never by `.overtime`

- **Overtime on the display is painted by `.danger`, never by `.overtime`**: JS always adds the two classes together (`classList.add('danger', 'overtime')` in `updateProgress` / `_enforceOvertimeColors` / `updateDigitalDisplay` / …), so the red `.danger` rules govern and the palette matches the other two windows. `display.html` used to carry a parallel `.overtime` layer from a superseded ORANGE design — five rules on the ring, circle digits, LED, flip and analog. Four were invisible because JS writes red INLINE; the fifth leaked, because `.time-text.overtime` had its `color` overridden but its `--text-glow` did not — red digits with an orange halo. Do not reintroduce orange: it disagrees with the widget, the clock and the status pill. `e2e/overtime-palette.spec.js` measures the computed colour AND glow in two windows.

---

<a id="stylescss-and-componentscss-are-gone-and-the-reason-is-not-t"></a>

### `styles.css` and `components.css` are gone, and the reason is not tidiness

- **`styles.css` and `components.css` are gone, and the reason is not tidiness**: they were the first version's stylesheets, loaded BEFORE `control.css`. Measured by disabling each sheet at runtime and diffing computed styles in all four windows, the panel took exactly two things from `styles.css` (the global `margin/padding` reset — 47 elements, mostly UA padding on the transport buttons and UA margins on checkboxes — and `justify-content/align-items` on `.control-window`), and NOTHING at all from `components.css`; the clock took nothing either, because both widgets draw `widget-flip-*` / `widget-digital-*` while `components.css` only knew the unprefixed `.flip-*` / `.digital-*`. Everything else was neutralised by `control.css` at EQUAL specificity — that is, by the order of the `<link>` tags alone. The live danger was in `components.css`: `.digital-time.overtime { color: #ff6600 }` and `.flip-card.overtime .flip-digit` — the banned ORANGE overtime layer, at the same specificity as the display's own red `.danger` rules, losing only because `display.html`'s inline `<style>` is parsed after the `<link>`. Moving one line in `<head>` would have turned the projector orange. What was actually live in the display and had to be carried over: `margin: 0 8px` on `.flip-separator` (measured: the flip row is 16px wider with it) and `transition: all 0.3s ease` on `.digital-time`.

---

<a id="the-overtime-ring-is-intentionally-invisible"></a>

### The overtime ring is intentionally invisible

- **The overtime ring is intentionally invisible**: `calculateProgressValue()` returns a negative ratio past zero and `updateProgress()` clamps it to 0, so `strokeDashoffset === circumference` — a zero-length arc. The widget's circle does the same. Any styling keyed on the ring in overtime (gradients, dash patterns) is therefore unreachable by construction.

---

<a id="the-analog-hour-hand-must-be-driven-explicitly"></a>

### The analog hour hand must be driven explicitly

- **The analog hour hand must be driven explicitly**: `#analogHandHour` exists in `display.html`, is styled by `.hand-hour` and is looked up in `initElements()` — but for a long time nothing ever assigned its `transform`, so it froze pointing at 12. Timers under an hour looked accidentally right (0 hours *is* 12), which is why it survived; at 1:30:00 the minute hand swept while the hour hand still read 12. `updateAnalogDisplay()` now sets `((absSecs / 3600) % 12) * 30` degrees. Measured at four presets by `e2e/analog-hour-hand.spec.js` — the screenshot suite only ever uses 5-minute presets, so pixels cannot catch this.

---

<a id="a-capture-harness-must-be-deterministic-in-four-ways-and-thr"></a>

### A capture harness must be deterministic in FOUR ways, and three of them were found the hard way

- **A capture harness must be deterministic in FOUR ways, and three of them were found the hard way**: frozen animations, real `document.fonts.ready`, **no `:hover`**, and **canonical window sizes**. The last two were added in 2.4.0 after `visual:check` alternated between 0 and 10 regressions on identical code:
  1. the windows are captured in a normal window system, so the real mouse cursor put `:hover` into the frame — a highlighted «+1 ч» button was 2044 px of "regression" in `control-maxsize`, a hovered drawer row 685 px in `control-drawer-clock`, and the run came out clean whenever the cursor happened to rest elsewhere. `FREEZE_ANIMATIONS_CSS` now also sets `pointer-events: none` on everything, which removes hit-testing so `:hover` can never match; programmatic `.click()` in the sequence still works;
  2. the widget and clock **persist their geometry**, and the sequence resizes them repeatedly (min-size sweep, max-size sweep, hour formats, high contrast) — plus the window auto-scales itself on a timer after a style change. So the size a window opened with depended on how the PREVIOUS run ended, and frames differed by SIZE, not content (the diff prints `0 px (100.00%)` — that is the equal-size check failing, not a colour match). Sizes are now set explicitly before the first capture (`CANONICAL_SIZES`) and restored in `finally`, which makes the sequence a fixed point.
  Verify any harness change with **three consecutive** `visual:check` runs at 0 — a single clean run proves nothing here.

---

<a id="captures-must-wait-for-documentfontsready-never-a-fixed-slee"></a>

### Captures must wait for `document.fonts.ready`, never a fixed sleep

- **Captures must wait for `document.fonts.ready`, never a fixed sleep**: every window declares its fonts with `font-display: swap`, so a frame taken before the woff2 lands renders in a fallback face — `display-idle` diffed by 2.43% (22 376 px) and a rerun immediately gave 0. The old blind `sleep(1500)` was not enough under load, which made `visual:check` cry wolf and quietly train you to ignore it. `waitForFonts()` in `scripts/screenshot-runner.js` awaits the real promise per window; three consecutive checks now come back at 0.

---

<a id="any-capture-containing-live-wall-clock-time-must-go-into-ist"></a>

### Any capture containing live wall-clock time MUST go into `isTimeDependent()`

- **Any capture containing live wall-clock time MUST go into `isTimeDependent()`**: otherwise the passing second itself counts as a regression and `visual:check` fails forever. Currently excluded: `clock-*` (the whole clock widget) and `display-blocks-*` (the display's «Текущее время» info block). `tests/visual-diff.test.js` pins the list.

---

<a id="info-blocks-had-zero-visual-coverage-until-2026-07-30"></a>

### Info blocks had zero visual coverage until 2026-07-30

- **Info blocks had zero visual coverage until 2026-07-30**: they are off by default, so none of the 36 screenshots contained them — which is exactly why unreadable label contrast (2.15:1 in all eight themes) could never be caught by comparing pictures. `display-blocks-circle` / `display-blocks-analog` are captured LAST in the sequence on purpose: enabling blocks mutates the display's `_lastPreset` and block positions, so doing it earlier would bleed into every previous frame.

---

<a id="visualcheck-was-not-deterministic-as-of-10-aug-2026-verify-t"></a>

### `visual:check` was NOT deterministic as of 10 Aug 2026 — verify the harness against itself before trusting a verdict

- **`visual:check` was NOT deterministic as of 10 Aug 2026 — verify the harness against itself before trusting a verdict**: the 2.4.0 entry below says three consecutive runs come back at 0. Re-measured on 10 Aug 2026 and that is no longer true. Method: capture a baseline from `main`, then run `visual:check` **on `main` itself** — comparing the code against its own baseline, the only honest control. Result over four runs: **8 → 0 → 5 → 0 regressions**. The unstable frames are the control-window drawer captures, and they print `0 px (100.00%)` — i.e. the equal-SIZE check failing, not a colour match, the same class of drift `CANONICAL_SIZES` was introduced to kill (the control window is resized per tab by `autoResizeWindow()` and is not covered by that fixup). Consequence: a non-zero `visual:check` proves nothing on its own, and neither does a zero. **Before attributing regressions to your change, run the same three checks on `main`** — a feature branch measured at 5 → 4 → 0 against a main-derived baseline sits inside that noise band and is not evidence of anything. Do not "fix" the flake by re-baselining; that only freezes whichever frame the run happened to produce. Also note the local baseline can simply be STALE (it held 50 files against 54 current captures), which reads as regressions that were never there.

---

<a id="visualcheck-has-a-tolerance-so-it-is-not-a-substitute-for-me"></a>

### `visual:check` has a tolerance, so it is not a substitute for measurement

- **`visual:check` has a tolerance, so it is not a substitute for measurement**: a pixel counts as changed only when a channel differs by more than 8/255, and images are considered equal below a 0.1% changed-pixel ratio (`visual-diff.js`). That absorbs font antialiasing and glass compositing — and also absorbs small real changes: rotating the analog hour hand by 2.5° touches ~0.03% of the frame and passes cleanly. Use it to prove a refactor changed *nothing*; use a measured e2e assertion to prove a specific value is *right*.

---

<a id="the-widgets-flip-separator-is-dots-not-a-glyph"></a>

### The widget's flip separator is DOTS, not a glyph

- **The widget's flip separator is DOTS, not a glyph**: in `electron-widget.html` the `:` between digit groups is painted by `::before`/`::after` gradient dots, and the element's own text `:` is suppressed with `font-size: 0`. Anything that sets a font-size on `.widget-flip-separator` brings the glyph back ON TOP of the dots — that is exactly what the `has-hours` adaptive rule did, so every timer ≥ 1 h showed a colon *and* two dots. Scale the dots and the column height for the smaller 44×64 card instead; the font-size must stay 0. The clock and the display use real text separators, so this applies to the widget only. Measured by `e2e/flip-hours-layout.spec.js` (the screenshot suite never covered ≥ 1 h, which is why the defect survived).

---

<a id="colour-bands-live-in-one-place-too"></a>

### Colour bands live in ONE place too

- **Colour bands live in ONE place too**: `RendererShared.timerColorBand(remaining, total)` returns `overtime | danger | warning | normal`. Zero is INSIDE the danger band — the old `percentLeft <= 10 && percentLeft > 0` guard pushed exactly 00:00 into the yellow warning band while the status chip next to it went red. Thresholds come from `CONFIG.DANGER_PERCENTAGE` / `WARNING_PERCENTAGE`; they used to be hardcoded as 10/25 in nine places and only the control panel read the config.

---

<a id="one-element-one-colour-system"></a>

### One element, one colour system

- **One element, one colour system**: the display status pill briefly carried both the semantic classes (`running/paused/finished/overtime`) and a second "tone" layer (`is-success/is-attention`) declared lower in the CSS, so the tone layer won the cascade and painted «ВРЕМЯ ВЫШЛО!» green over a red pulse. Never add a parallel colour system to an element that already has one.

---

<a id="status-palette-is-fixed-across-all-three-windows"></a>

### Status palette is fixed across all three windows

- **Status palette is fixed across all three windows**: running green, paused orange, finished red (static), overtime red (pulsing). The pulse is the ONLY thing distinguishing the two red states — do not add an animation to `finished`.

---

<a id="scale-is-reported-back"></a>

### Scale is reported back

- **Scale is reported back**: windows send `report-scale` when Ctrl+wheel changes their size; main forwards it to the control panel ONLY (broadcasting would echo to the sender and can loop). Assigning `slider.value` does not fire `input`, which is what keeps the loop open.

---

<a id="visual-regression"></a>

### Visual regression

- **Visual regression**: `npm run visual:baseline` promotes `screenshots/` to `tests/visual-baseline/` (gitignored — 8.6 MB of PNGs would grow the history on every visual change; capture them locally once); `npm run visual:check` re-captures and compares per pixel via `visual-diff.js`, exiting 3 on regression. Animations are frozen during capture (`FREEZE_ANIMATIONS_CSS`) — without that, pulses and the finish flash make captures non-deterministic. `clock-*` shots are excluded: they show the real wall clock.

---

<a id="e2e-needs-e2elaunchjs"></a>

### e2e needs `e2e/launch.js`

- **e2e needs `e2e/launch.js`**: it strips the inherited `ELECTRON_RUN_AS_NODE` that otherwise makes `electron.launch()` fail with "bad option: --remote-debugging-port". Playwright also runs with `workers: 1` because the app holds a single-instance lock.

---

<a id="timer-status-priority-lives-in-one-place"></a>

### Timer status priority lives in ONE place

- **Timer status priority lives in ONE place**: `RendererShared.timerLifecycleStatus()` returns `'paused' | 'overtime' | 'finished' | 'running' | 'idle'`. Control, widget and display each map that key to their own wording and CSS class — none of them re-implements the condition. It used to be copy-pasted three times and the copies drifted: the widget painted overtime with the green `running` class, the display checked `finished` first while the other two checked overtime first, and the `isPaused` branch was unreachable whenever `remainingSeconds <= 0` (so pausing during overrun reported "Завершено"). `electron-control.html` must keep its `<script src="renderer-shared.js">` tag or the call throws.

---

<a id="npm-run-screenshot-is-the-visual-smoke-test"></a>

### `npm run screenshot` is the visual smoke test

- **`npm run screenshot` is the visual smoke test**: it boots all four windows offscreen and captures into `screenshots/` (gitignored) across five timer states and all four timer styles. The `recovered` state deliberately follows `overtime` — that ordering is what catches stuck inline colours. Do not reorder `STATES` in `scripts/screenshot-runner.js`. Two capture groups run LAST on purpose and must stay there: the display's info blocks (enabling them mutates `_lastPreset` and block positions) and the settings drawer (opening it resizes the control window through `resize-control-window`). The drawer group resets the window to 400×700 first — the preceding max-size sweep would otherwise make the shot show a stretched layout nobody uses.

---

<a id="applycolors-vs-overtime-colors-critical"></a>

### applyColors vs overtime colors (CRITICAL)

> **УСТАРЕЛО с 11.08.2026.** Механизм, который описывает этот разбор, удалён:
> цвет темы приходит CSS-переменной, состояние задаётся классом, инлайн не
> используется вовсе. Разбор оставлен как история — он объясняет, ПОЧЕМУ так
> нельзя, и это по-прежнему полезно. Действующее правило:
> [Цвет — это переменная, состояние — это класс](#color-belongs-to-the-cascade).

- **applyColors vs overtime colors (CRITICAL)**: `applyColors()` sets inline `style.color` on digital/flip elements. CSS classes (`danger`, `overtime`) CANNOT override inline styles. Solution: each `updateXxxDisplay()` method must set inline `style.color = '#ff4444'` when overtime/danger, and restore base color otherwise. Display uses `_enforceOvertimeColors()` called every tick. Widget stores `_baseTimerColor` in applyColors and overrides in updateDisplay.

---

<a id="time-format-with-hours"></a>

### Time format with hours

- **Time format with hours**: All display styles (digital, flip, analog-digital) must handle hours when `absSecs >= 3600`. Use `H:MM:SS` format. Display flip has hidden `flipHoursUnit`/`flipHoursSep` elements shown dynamically. Widget flip already had hours support.

---

<a id="display-settings-showcurrenttime"></a>

### Display settings `showCurrentTime`

- **Display settings `showCurrentTime`**: Controls visibility of the "Текущее время" block on fullscreen display. Defaults to `true`. Sent via `display-settings-update` channel alongside `showTimeBlocks`.

---

<a id="no-external-shadows-on-transparent-windows"></a>

### No external shadows on transparent windows

- **No external shadows on transparent windows**: Widget and clock windows have `transparent: true` + `hasShadow: false`. Never use `drop-shadow`, `box-shadow` (external), or `filter: shadow` on elements — they create visible dark rectangles. Use only `inset` shadows or `border` for depth.

---

<a id="design-system-v2"></a>

### Design system v2

- **Design system v2**: All windows use VisionOS glassmorphism — `blur(40px) saturate(180%)`, gradient ring `#0a84ff→#30d158`, Inter Light (weight 200) for timer text. Widget/clock: NO external shadows (transparent windows). Digital LED uses JetBrains Mono. **Fonts are LOCAL** — `fonts/*.woff2` declared with `@font-face` in `fonts.css`, linked FIRST by every window (Google Fonts `@import` would be blocked by the CSP `font-src 'self' data:` anyway, and would make the app depend on the network). The 20 declarations used to be four verbatim copies (`control.css` + three inline `<style>` blocks): a weight added to three of the four is invisible to the eye and to every test, and the window that misses it silently renders in a fallback face — the exact failure `visual:check` once reported as a phantom 2.43% regression. `tests/release-gates.test.js` fails the build if a font source stops starting with `fonts/`, if the declaration count collapses (a file-move that leaves the check looking at nothing passes otherwise), or if a window stops linking `fonts.css`. Apple semantic colors: systemBlue `#0a84ff`, systemGreen `#30d158`, systemRed `#ff453a`, systemOrange `#ff9f0a`.

---

<a id="the-second-theme-is-light-and-it-is-not-the-dark-one-inverte"></a>

### The second theme is LIGHT, and it is not the dark one inverted (CRITICAL)

- **The second theme is LIGHT, and it is not the dark one inverted (CRITICAL)**: `hc-dark` was replaced by `light` in 2.4.1. Three things make it work, and all three were found by measuring. (1) **Apple's accents are calculated for a dark background** — `#30d158` on white is 1.9:1, `#ff9f0a` is 2.0:1, so they cannot paint text or small glyphs; the light theme carries its own darkened set (6.6–7.4:1 on white) and `--tw-on-accent: #ffffff` for labels on accent fills. (2) **Half the panel's fills are literals in `control.css`** (`rgba(255,255,255,0.04–0.06)`) plus ~10 hardcoded white TEXT colours in the drawer and sound list — tokens cannot reach them, and on white they vanish; the `[data-theme="light"]` block re-paints them, so the default theme stays byte-identical in the capture suite. (3) **The surface ladder runs the other way**: on white, "higher" means darker (`--tw-level-1..3` = #f7f7f9 / #ebebf1 / #dadae2). Panel white on a grey window backdrop, drawer grey with white cards — the reverse (grey panel, greyer controls) separated by three luminance units and read as mush.

---

<a id="windows-whose-background-the-user-paints-keep-the-dark-palet"></a>

### Windows whose background the USER paints keep the dark palette in both themes (CRITICAL)

- **Windows whose background the USER paints keep the dark palette in both themes (CRITICAL)**: the widget and the fullscreen display take their background from the «Фон» setting of the Полноэкранный tab, applied INLINE — so it beats any theme, and its default is dark (`#0f0c29`). When the light theme flipped their text tokens, the result was near-black digits on dark blue: ugly in the widget, unreadable on a projector. Both windows therefore pin the light-on-dark token set inside their own `<style>` (`[data-theme="light"] { --tw-fg: #ffffff; … }`). **The pin is a LIST, and for a whole release it was an incomplete one**: it named 15 text/surface tokens and not a single accent, so the light theme's deliberately darkened accents (`--tw-green: #12652f`, `--tw-orange: #8c4c00`) landed on the pinned DARK surfaces — measured 2.66–2.94:1 on the status text, the LED digits and the dial. Ten accent tokens are now pinned back to the `:root` values, and `tests/contrast.test.js` measures each window's palette against ITS OWN pinned surfaces, taking the token list by grep from the file itself — so a newly used `var(--tw-…)` that nobody pinned fails the test instead of shipping. The clock widget owns its background, so it DOES follow the theme and turns white. `tests/ui-theme.test.js` asserts both halves — the pin in those two files and its absence in the clock.

---

<a id="two-ui-themes-data-theme-on-html"></a>

### Two UI themes, `data-theme` on `<html>`

- **Two UI themes, `data-theme` on `<html>`**: `dark` (default) and `light`. `ui-theme.js` is the ONLY owner of that attribute — it reads/writes `uiTheme` in localStorage, applies the attribute, and every window calls `initTheme()` from a `<head>` script so the theme lands before the first frame (in `<body>` it would flash dark first). The panel's titlebar button (`#contrastToggle`, `aria-pressed`) switches it and broadcasts `ui-theme-update`; main relays to all four windows. `hc-dark` (high contrast) was the second theme in 2.4.0 and was replaced by `light` in 2.4.1.

---

<a id="display-block-positions"></a>

### Display block positions

- **Display block positions**: Fullscreen info blocks can be Alt+dragged to custom positions. Positions persist in localStorage (`displayBlockPositions`). `applyDisplaySettings` must NOT reapply preset positions unless `timeLayoutPreset` actually changed — otherwise color/date updates clear custom positions.

---

<a id="display-scaling"></a>

### Display scaling

- **Display scaling**: Fullscreen display: Ctrl+wheel scales timer (30-300%) or blocks (50-600%) depending on hover target. Shift+wheel always scales blocks. Both persist to localStorage (`displayTimerScale`, `displayBlockScale`).

---

<a id="manual-time-input"></a>

### Manual time input

- **Manual time input**: Smart parsing in control panel — bare number = seconds, `X:Y` = min:sec, `X:Y:Z` = hr:min:sec. Max 99:59:59. Uses `parseManualTime()` function.

---

<a id="color-picker"></a>

### Color picker

- **Color picker**: HSV color picker (`ColorPicker` class) with Canvas-based SV area + hue slider + hex input. 3 independent instances for Widget/Clock/Display tabs. Toggle via rainbow gradient button appended to themes-grid.

---

<a id="scale-value-edit"></a>

### Scale value edit

- **Scale value edit**: Click percentage text on any scale bar → input mode. Double-click → reset to default (100%). Uses `setupScaleValueEdit()` with 250ms click delay to distinguish from dblclick.

---

<a id="adaptive-window-height"></a>

### Adaptive window height

- **Adaptive window height**: Control window resizes per active tab via `autoResizeWindow()`. Temporarily removes `max-height` from active tab to measure true content, then sends `resize-control-window` IPC. Min 650px, max 1000px.

---

<a id="reset-settings"></a>

### Reset settings

- **Reset settings**: Button in FAQ footer. Clears localStorage via `session.clearStorageData()` in main process, then `app.quit()` (user restarts manually since `app.relaunch()` unreliable with npm start).

---

<a id="color-belongs-to-the-cascade"></a>

### Цвет — это переменная, состояние — это класс; инлайн НЕ используется (CRITICAL)

**Правило.** Пользовательский цвет темы записывается в CSS-переменную на
`documentElement` (`--timer-color`, `--timer-glow`, `--analog-*`). Состояние
таймера (`warning` / `danger` / `overtime`) выражается классом или `data-status`
на элементе, а цвет состояния задаётся правилом CSS. Ни то ни другое НЕ пишется
в `el.style.*`.

**Почему это не стилистика.** Инлайн бьёт любое правило. Как только цвет темы
пишется инлайном, состояние тоже вынуждено писаться инлайном (иначе его не
видно), а значит его надо ещё и вручную СНИМАТЬ при выходе из состояния — в
каждой ветке, для каждого стиля, в каждом окне. Отсюда росло всё остальное:
поля `_base*` («к чему возвращаться»), охранники
`!classList.contains('danger')` внутри `applyColors`, и функция
`_enforceOvertimeColors()`, перекрашивавшая DOM на каждом тике только затем,
чтобы вернуть инлайн, стёртый другим инлайном.

**Цена, замеренная 11.08.2026 перед правкой:** 96 инлайновых записей цвета,
8 полей `_base*`, 51 хардкоженный красный литерал в JS, перекраска каждый тик.
И как минимум четыре отдельных правила в этом файле (три из них помечены выше
как устаревшие) существовали только чтобы обслуживать эту конструкцию.

**Что она стоила пользователю.** Виджет подставлял `#0a84ff` инлайном и этим
убивал ЧЕТЫРЕ описанных состояния: обещанный `--tw-led-green` у LED-цифр не
срабатывал никогда, флип-цифры были синими вместо `--tw-fg`, секундная стрелка
аналога — сине-зелёной вместо красной. Отдельно: на свежем профиле красный
ореол не снимался после выхода из полосы danger и держался до перезапуска
(замерено, `e2e/color-band-reset.spec.js`).

**Что нашлось, когда инлайн убрали.** Четыре правила CSS оказались мёртвыми или
отсутствующими — их никто не видел, потому что инлайн их всё равно перебивал:
`.clock-center.danger` объявлял градиент под 135°, а рисовалось 145°;
`.widget-analog-digital[data-status="danger"]` объявлял непрозрачный `#ff453a`,
а рисовалось `rgba(255,69,58,0.7)`; у `.hand-second` и у разделителей флипа
правил полосы не было вовсе; у стиля «Цифры» их не было ни в одном из двух окон.
Мёртвое правило — это дизайнерское решение, которое никто ни разу не увидел.

**Доказательство, что путь рабочий:** панель управления всегда была сделана так
(`electron-control.html` ставит только классы, `control.css` красит правилами,
светлая тема перекрашивает их одним блоком) и ни одной из этих проблем не имела.

**Чем закреплено.** `e2e/color-ownership.spec.js` — 40 клеток (5 стилей × 4
полосы × 2 окна), сверка ВЫЧИСЛЕННЫХ цвета и тени с эталоном; тест нормализует
запись цвета, потому что один и тот же цвет браузер печатает как
`rgba(255,204,0,0.4)` из литерала и как `color(srgb 1 0.8 0 / 0.4)` из
`color-mix`. Плюс source-level сторожа в `tests/audit-2026-07-fixes.test.js`:
инлайновых записей цвета нет вовсе И правила полос существуют — обе стороны
проверены мутацией.

**Что осталось за границами.** Три параллельных красных (`#ff4444`, `#ff3333`,
`rgba(255,69,58,.7)`) и два жёлтых (`#ffc107`, `#ffcc00`) сведены в токены
(`--tw-band-*`) со ЗНАЧЕНИЯМИ ПЕРЕНЕСЁННЫМИ ДОСЛОВНО. Свести их к одному —
значит поменять пиксели, и это отдельное решение, не рефакторинг.

---

<a id="a-state-indicator-is-colour-too-and-it-has-an-owner"></a>

### Индикатор состояния — тоже цвет, и у него тоже есть владелец

Проход по дефектам UI 11.08.2026 начался с осмотра 64 кадров и нашёл два
цветовых дефекта, которых `tests/contrast.test.js` не видел в упор, хотя тест
существовал, был зелёным и специально написан про контраст.

**Первый.** `control.css` красил пункт выпадающего списка правилом
`select option { background: #1c1c1e; color: var(--tw-fg) }`: фон литералом,
текст токеном. В тёмной теме это 17.01:1, в светлой `--tw-fg` становится
`#1d1d1f` — и текст ложился на почти такой же фон. Замер: **1.01:1**, то есть
содержимого всех восьми `<select>` панели в светлой теме не существовало. На
macOS попап рисует система и дефекта не видно совсем; Chromium на Windows и
Linux применяет правило буквально. Второе такое же место (`optgroup`) нашёл не
грep, а сам тест: проверка ищет литерал по ВСЕМУ файлу.

**Второй.** Точка «окно открыто» была честным токеном `--tw-green`, но лежала
на заливке `--tw-blue`. В светлой теме оба акцента затемнены (акценты Apple на
белом не читаются, поэтому у светлой темы свои) — **1.03:1**. Индикатора
состояния просто не было, притом что оба цвета взяты из системы токенов
правильно.

**Почему тест их пропускал.** Он проверял ТЕКСТОВЫЕ токены и читал ТОЛЬКО
`design-tokens.css`. Цвет, вписанный литералом в компонентный файл, для него не
существовал; токен, положенный на фон из другой темы, проверялся против фона
страницы, а не против того, на чём он окажется.

**Правило.** Контраст считается для ПАРЫ «цвет × фон, на котором он окажется»,
и в ОБЕИХ темах. Нетекстовый индикатор — порог 3:1, и состояние помечается
формой (засечка, точка), а не только цветом: тогда провал контраста портит вид,
а не убивает смысл.

**Чем закреплено.** `tests/contrast.test.js` теперь читает и `control.css` —
литерал `#1c1c1e` в нём роняет проверку, — и считает пару `--tw-green` ×
`--tw-level-2` в обеих темах (8.22:1 и 6.04:1). Плюс `e2e/reachable-controls.spec.js`
меряет, что открытое окно отличимо не только цветом: у активной кнопки
появляется inset-тень, которой не было.

---

<a id="a-frame-from-a-size-the-app-forbids-documents-nothing"></a>

### Кадр, снятый в запрещённом размере, не документирует ничего

Тот же проход, задача про срезанный ряд вкладок. На кадре `control-minsize.png`
от кнопок настроек было видно две трети высоты — дефект очевидный. План поэтому
требовал сначала красный тест и диагностику, и это спасло от починки не того.

Первый же тест — «при 380×660 ряд вкладок внутри окна» — оказался **зелёным**.
Замер объяснил почему: `scripts/screenshot-runner.js` снимал окно управления
при **360×640**, хотя приложение объявляет минимум 380×660
(`CONFIG.CONTROL_WINDOW_MIN_*`, главный процесс держит его через
`minWidth`/`minHeight`). Стенд перед съёмкой сам опускал минимум
(`setMinimumSize(360, 640)`) — и документировал состояние, в которое приложение
попасть не может. Половина дефекта жила в стенде, а не в панели.

Вторая половина была настоящей, но выглядела иначе. Замер на честном минимуме
380×660: `.content-section` секции настроек — 70px при содержимом 94px, ряду
вкладок остаётся 4px запаса, сумма высот детей панели 658 из 660. То есть
раскладка держалась на двух пикселях, а сжималась при этом ИМЕННО секция
настроек — единственная с `flex: 0 1 auto`, то есть вход во все настройки
приложения. Блок отзывчивости, который должен был это разруливать, был заведён
на `@media (max-height: 600px)` — **ниже собственного минимума окна**, и не
срабатывал ни при каком размере.

**И третье, из той же задачи.** Первая версия нового блока
`@media (max-height: 680px)` стояла выше по файлу, чем безусловный блок
«Compact panel», и не действовала ВООБЩЕ: медиа-запрос не добавляет
специфичности, поэтому при равной специфичности побеждает то, что ниже. Увидеть
это можно было только замером — `matchMedia` возвращал `true`, вычисленный
`padding` менялся, а высоты секций не двигались ни на пиксель.

**Правило.** Съёмочный стенд обязан брать размеры из того же реестра, что и
приложение: кадр в запрещённом размере не улика, а выдумка. Порог отзывчивости
обязан быть ВЫШЕ объявленного минимума окна, иначе он мёртв. А медиа-блок с
переопределениями кладётся НИЖЕ безусловных правил, которые он перекрывает.

**Чем закреплено.** `tests/visual-source.test.js` — минимум стенда читается из
`CONFIG.CONTROL_WINDOW_MIN_*` (литерал 360×640 роняет тест), и хотя бы один
порог `max-height` обязан быть выше `CONTROL_WINDOW_MIN_HEIGHT`.
`e2e/min-size-layout.spec.js` меряет КАЖДОГО предка ряда вкладок с прокруткой:
проверка по внешней секции была зелёной при 24 обрезанных пикселях внутри,
потому что урезание забирала на себя вложенная `.content-section`. Замер после
правки: панель 649 из 660, секция 90/90, канонические 400×700 и 400×740 не
изменились.

---

<a id="an-invariant-test-must-be-verified-against-itself"></a>

### Инвариант, который никого не ловит, зелёный по той же причине, что и верный

Редизайн 2026-08-12 снял стекло и свечения во всех окнах. Такое правило ломается
незаметно: один `backdrop-filter` в новом правиле не выдаёт себя ни падением, ни
ошибкой — он просто возвращает блюр в одно место, и окно начинает отличаться от
остальных трёх. Поэтому у правила завёлся владелец, `tests/flat-surfaces.test.js`.

Первая версия искала свечение подстрокой `0\s+0\s+([1-9]\d*)px`. Она нашла
«свечение 2px» в `0 0 0 2px rgba(0,0,0,0.35)` — то есть объявила стеклом **кольцо
фокуса**: регулярка матчилась со второго нуля. Вторая версия разбирала тень по
слоям и падала на `0 0 4px rgba(0,0,0,0.5)` — нейтральной мягкой тени, которую
макет как раз сохраняет.

Итоговое определение: свечение — это слой, у которого **оба смещения нулевые,
размытие ненулевое, а цвет цветной**. Оно отделяет ореол от четырёх вещей,
которые остаются: кольца фокуса (размытие нулевое — это форма), внутренней тени
(`inset`), подъёма ручки тумблера (`0 1px 3px` — смещение по Y ненулевое) и
нейтральной тени (она серая).

Разбор по слоям нашёл **18** объявлений там, где построчный `grep` дал 13:
многослойные тени растянуты на несколько строк, и grep их не видел.

**Правило.** Тест, утверждающий отсутствие, обязан иметь собственную проверку —
что он вообще что-то находит и что не находит лишнего. Без неё зелёный результат
означает ровно две вещи сразу: «всё чисто» и «регулярка не работает», и различить
их нельзя.

**Чем закреплено.** `tests/flat-surfaces.test.js`, пятая проверка: `glowLayers()`
прогоняется по эталонам обоих родов — ореол обязан находиться, кольцо, подъём,
внутренняя и нейтральная тень обязаны НЕ находиться.

---

<a id="a-ratchet-beats-a-ban-when-the-debt-spans-stages"></a>

### Долг, который нельзя закрыть сегодня, закрывается храповиком, а не молчанием

Тот же проход. Этап A снимал стекло и свечения через `box-shadow`. По дороге
нашлась вторая форма того же ореола — `text-shadow` и `filter: drop-shadow`, и её
было **42 слоя**: неоновые стили LED и «Цифры» в трёх окнах. Снять их на этапе
про токены значило бы переписать LED посреди чужой задачи; промолчать — потерять
находку.

Вместо этого потолки были зафиксированы числом: `display.css` 25,
`electron-widget.html` 10, `electron-clock-widget.html` 6. Тест падал и на росте
(«ореол вернули»), и на убыли («долг уменьшился — опустить число здесь»). Второе
важнее первого: без него потолок тихо превращается в разрешение.

Храповик отработал буквально. После правки виджета на этапе D тест упал сам и
потребовал опустить потолок; когда все три дошли до нуля, он был превращён в
запрет — ровно как в нём и было записано условие превращения.

**Правило.** Найденный, но не закрываемый сегодня долг фиксируется числом,
которое может только убывать, и условием превращения в запрет. Комментарий «надо
бы потом» такой гарантии не даёт.

**Чем закреплено.** `tests/flat-surfaces.test.js` — теперь запрет; история
храповика оставлена в комментарии над ним.

---

<a id="the-display-follows-the-theme-but-the-background-owns-the-text"></a>

### Дисплей следует теме, но цвет текста решает ЯРКОСТЬ фона (CRITICAL)

До редизайна виджет и дисплей прибивали палитру «светлое по тёмному» в обеих
темах: окно не владеет своим фоном, и светлая тема давала почти чёрные цифры на
тёмно-синем — на проекторе время нечитаемо вообще. Разбор
[«Windows whose background the USER paints»](#windows-whose-background-the-user-paint)
описывает именно это.

Макет редизайна нарисовал светлый дисплей «для белой аудитории и стрима», то есть
потребовал снять пин. Прямое снятие вернуло бы прежний провал зеркально: тёмная
заливка при светлой теме — чёрные цифры на чёрном.

Решение: **тема выбирает фон по умолчанию, а цвет текста выбирает яркость
фактического фона**. `RendererShared.backgroundTone()` считает относительную
яркость заливки или среднюю по двум точкам градиента и сравнивает с 0.179 —
точкой, где белый и чёрный текст дают равный контраст по WCAG. Картинка не
разбирается принципиально: у фотографии нет одной яркости, и гадать по ней хуже,
чем держать заведомо читаемый светлый текст с затемняющим оверлеем.

В CSS это перестало быть темой: вместо `[data-theme="light"]` палитра объявлена
как `body:not(.on-light-bg)` и `body.on-light-bg`. Оба случая явные, `:not()`
делает светлый текст дефолтом окна — до прихода настроек фон тёмный.

**Правило.** Владелец фона владеет и цветом текста. Тема может владеть фоном —
тогда она владеет и цветом; как только фон задал пользователь, решает измеренная
яркость, а не тема.

**Чем закреплено.** `tests/renderer-shared.test.js` — `backgroundTone` на всех
режимах, включая «тёмная заливка при светлой теме» и нечитаемый цвет.
`tests/contrast.test.js` — обе палитры дисплея считаются отдельно, светлая на
белом фоне (порог AA, худший запас 6.67:1 у `--tw-orange`). Виджет пин сохранил:
он лежит поверх чужого рабочего стола и своего фона не имеет вообще.

---

<a id="a-payload-assembled-in-six-places-is-a-setting-you-will-forget"></a>

### Payload, собранный в шести местах, — это настройка, которую забудут

Чтобы добавить в виджет два тумблера («Подпись состояния», «Поверх всех окон»),
надо было положить два поля в payload канала `widget-style-update`. Он собирался
литералом **шесть раз подряд** — в обработчиках стиля, шрифта, масштаба, делений
и в отложенном пуше.

Копии уже разошлись: **две из шести не клали `timerScale` вообще**. То есть
виджет иногда получал стиль без размера, и никакой тест этого не замечал —
payload валиден, канал жив, окно не падает.

**Правило.** Прежде чем добавлять поле в payload, соберите его в одном месте.
Иначе новое поле уедет в пять мест из шести, и найдётся это тем же способом, что
и `timerScale`, — случайно.

**Чем закреплено.** `PanelStateMixin.widgetStylePayload()` в `panel-state.js` —
единственная сборка; вызывающий передаёт только то, что знает точнее.

---

<a id="an-interface-that-promises-what-it-does-not-do"></a>

### Надпись — это обещание, и его никто не проверяет

В разметке панели с самого начала стояло «Перетащите файл сюда · или нажмите для
выбора». Обработчиков `dragover`/`drop` не было ни одного: работала только вторая
половина фразы.

Ни один тест этого не ловил и не мог. Кнопка на месте, доступное имя есть, клик
открывает диалог выбора файла — все проверки достижимости зелёные. Проверять
надо было не наличие элемента, а истинность его текста.

**Правило.** Если элемент обещает жест, у жеста должен быть обработчик. Проверка
достижимости отвечает на вопрос «можно ли до этого дойти», а не «делает ли оно
то, что написано».

**Чем закреплено.** `CustomSoundsMixin.bindSoundDropZone()`. Валидация формата и
размера НЕ продублирована: событие приводится к форме, которую даёт
`<input type="file">`, и уходит в тот же `handleSoundFileUpload` — вторая копия
разошлась бы с первой на первом же изменении лимита.

---

<a id="a-pause-that-only-offers-pause-reads-as-a-frozen-window"></a>

### Действие, которое ничего не делает, читается как сломанное окно

Панель выводила раскладку из `isRunning || isPaused` — пауза жила ВНУТРИ
состояния «отсчёт». Отсюда в паузе на экране оставалась кнопка «Пауза»:
единственное действие, которое в паузе не делает ровно ничего. Возобновить
таймер мышью было нечем ни в панели, ни в свёрнутой полосе, где стояла та же
кнопка с тем же словом. Работал только пробел — но пользователь, глядя на слово
«Пауза» и нажимая на него без всякого эффекта, делает единственный разумный
вывод: окно перестало слушаться. Именно так дефект и был описан — «пишет пауза и
не даёт управлять».

Замер до правки: `body.className === 'control-window state-running'` при
`isRunning: false, isPaused: true`; в полосе `miniBarPause` видим, `miniBarStart`
скрыт. Подпись состояния при этом красилась зелёным «идёт», а точка рядом с ней
— оранжевым «пауза»: два разных ответа на один вопрос в одной строке.

**Правило.** Пауза — МОДИФИКАТОР состояния, а не его разновидность: раскладка
остаётся от отсчёта (ряд ±, полоса, никаких пресетов), меняется ровно одно —
какое действие предлагает транспорт. Пятого `state-*` заводить не нужно, нужен
класс-модификатор; блок правил обязан стоять НИЖЕ правил состояний — специфичность
у них равная, и решает порядок.

**Чем закреплено.** `body.paused` ставится в `renderPanelState()`
(`panel-state.js`), CSS меняет транспорт в конце `control.css`, слово на кнопке
полосы ставит сам `mini-bar.js` по признаку `resume` в `render()`. Замеряется
кликами: `e2e/panel-states.spec.js` (панель) и `e2e/mini-bar.spec.js` (полоса,
включая то, что кнопка ДЕЙСТВИТЕЛЬНО возобновляет отсчёт).

---

<a id="a-collapsed-window-must-leave-the-modes-it-cannot-show"></a>

### Свернувшись, окно обязано выйти из режимов, которые не может показать

Полоса прячет всё, кроме себя, — но класс `state-input` на `<body>` оставался.
Свёрнутое окно оставалось в режиме ручного ввода: полей нет, набирать негде, а
«Старт» полосы и пробел означали «поставить набранное» и молча не делали ничего.
Замерено: после сворачивания из режима ввода `Space` не запускал таймер вообще.

**Правило.** Смена режима окна закрывает всё, что в новом режиме недостижимо, —
это то же правило, по которому сворачивание уже закрывало ящик настроек. Признак
простой: если состояние показывается элементами, которых в новом режиме нет,
состояние обязано быть снято, а не спрятано.

**Чем закреплено.** `onToggle` в проводке `MiniBar.init()` закрывает ящик И
вызывает `setInputMode(false)`; замеряется `e2e/mini-bar.spec.js`.

---

<a id="a-subtitle-is-a-report-and-it-must-not-wait-for-a-tick"></a>

### Подпись — это отчёт: она обязана обновляться на изменении, а не на тике

Подписи строк окон («показан · флип · 140%») пересобирались только в
`renderPanelState()`, то есть на тике таймера. В покое тиков нет вообще: после
смены стиля часов строка продолжала утверждать «показан · круг» до первого
запуска отсчёта. Второй источник вранья — включённая синхронизация: подпись
читала СОБСТВЕННЫЙ переключатель часов, который синхронизация намеренно не
переписывает, и сообщала «круг» про часы, которые в этот момент аналоговые.
Строка выбора стиля при синхронизации скрыта, так что подпись остаётся
единственным местом, где стиль часов вообще виден.

**Правило.** Отчёт о состоянии окна собирается из ДЕЙСТВУЮЩЕГО значения (при
синхронизации — из стиля виджета) и пересобирается там, где настройки
записываются, а не там, где идёт время. Один вызов на запись, а не по вызову в
каждом обработчике: пятая копия проводки в этом проекте уже теряла поле.

**Чем закреплено.** `renderWindowRows()` вызывается из `saveExtSettings()` и
берёт `timerStyle` при включённом `syncClockStyle`. Замеряется
`e2e/panel-states.spec.js` (без тика) и `e2e/clock-style-sync.spec.js` (под
синхронизацией).
