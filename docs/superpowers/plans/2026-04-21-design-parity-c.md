# Design Parity (вариант C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести визуальное соответствие `timer-widget` с эталоном `TimerWidget Design System/ui_kits/` до ≥95% без регрессий.

**Architecture:** Vanilla JS / Electron. Правки в 5 HTML, `constants.js`, `design-tokens.css`. IPC-контракт расширяется payload'ом — новых каналов не добавляем. Сохранение settings через `localStorage`, дефолты — безопасные.

**Tech Stack:** Electron, vanilla JS, ESLint 9, Node test runner (`node --test`), no bundler.

**Spec:** [docs/superpowers/specs/2026-04-21-design-parity-c.md](../specs/2026-04-21-design-parity-c.md)

---

## Parallelization map

4 worker-scopes могут работать одновременно:

| Worker | Tasks | Files |
|---|---|---|
| **W1 — Control HTML/CSS** | 1, 2, 3, 4 | `electron-control.html` (CSS + HTML блоки) |
| **W2 — Control JS** | 5, 6 | `electron-control.html` (`<script>`), `constants.js` |
| **W3 — Display** | 7 | `display.html`, `display-script.js` |
| **W4 — Widget + Clock** | 8 | `electron-widget.html`, `electron-clock-widget.html` |
| **W5 — Verify** | 9 | — (runs last after W1-W4 merged) |

W2 depends on W1 (его HTML-элементы), остальные — независимы.

---

## File structure

Все файлы существующие, создавать новые не нужно. Изменения локализованы в перечисленных строках/блоках.

| File | Responsibility | Modified sections |
|---|---|---|
| `electron-control.html` | Панель управления — вся UI-логика | CSS-блок (`.tab-btn`, `.group-title`, `.segmented`, `.footer-hints`); HTML разметка табов, title, footer, presets; JS adapter для `timerStyleEl` + handler для `showTicks` |
| `electron-widget.html` | Виджет таймера | CSS `.widget-container.ticks-off`; IPC receiver `showTicks` |
| `electron-clock-widget.html` | Виджет часов | CSS `.clock-container.ticks-off`; IPC receiver `showTicks` |
| `display.html` | Полноэкранный режим | CSS hero-label + chip states; HTML label block; hint-strip position |
| `display-script.js` | Логика display | Chip state transitions; hero-label text per state; hint-strip fade |
| `constants.js` | Magic strings & storage keys | `STORAGE_KEYS.WIDGET_SHOW_TICKS`, `CLOCK_SHOW_TICKS` |

---

## Task 1 — Control CSS: group labels + pill tabs + segmented + footer hints

**Worker:** W1 · **Files:** `electron-control.html`

- [ ] **Step 1.1: Найти CSS-блок `.tab-btn` (~строка 383)**

Текущий `.tab-btn` — большие карточки с иконкой. Заменить на pill-табы.

- [ ] **Step 1.2: Заменить CSS `.tabs` + `.tab-btn`**

Найти:

```css
.tab-btn {
    /* текущий стиль */
}
```

Заменить весь блок `.tab-btn`, `.tab-btn:hover`, `.tab-btn.active`, `.tab-btn:focus-visible`, `.tab-btn span.icon` на:

```css
.tabs-row {
    display: flex;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 12px;
    padding: 3px;
    gap: 2px;
    margin-bottom: 16px;
}
.tab-btn {
    flex: 1;
    padding: 9px 4px;
    border-radius: 9px;
    text-align: center;
    font-size: var(--tw-t-label);
    font-weight: 500;
    color: var(--tw-fg-muted);
    cursor: pointer;
    background: transparent;
    border: none;
    font-family: inherit;
    transition: color 150ms var(--tw-ease), background 150ms var(--tw-ease);
}
.tab-btn:hover { color: var(--tw-fg); }
.tab-btn.active {
    color: var(--tw-fg);
    background: rgba(255,255,255,0.1);
    box-shadow: 0 2px 10px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.07);
}
.tab-btn:focus-visible { outline: none; box-shadow: var(--tw-focus-ring); }
.tab-btn .icon { display: none; }
```

- [ ] **Step 1.3: Добавить CSS `.group-title` (перед `.tab-btn`)**

```css
.group-title {
    font-size: var(--tw-t-tiny);
    font-weight: 600;
    color: var(--tw-fg-dim);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-bottom: 10px;
    margin-top: 4px;
}
```

- [ ] **Step 1.4: Добавить CSS `.segmented` (перед `.tab-btn`)**

```css
.segmented {
    display: inline-flex;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    padding: 3px;
    gap: 2px;
}
.segmented button {
    padding: 6px 14px;
    border-radius: 7px;
    background: transparent;
    border: none;
    color: var(--tw-fg-muted);
    font-family: inherit;
    font-size: var(--tw-t-label);
    font-weight: 500;
    cursor: pointer;
    transition: color 150ms var(--tw-ease), background 150ms var(--tw-ease);
}
.segmented button:hover { color: var(--tw-fg); }
.segmented button.active {
    color: var(--tw-fg);
    background: rgba(255,255,255,0.1);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.07);
}
.segmented button:focus-visible { outline: none; box-shadow: var(--tw-focus-ring); }
```

- [ ] **Step 1.5: Добавить CSS `.footer-hints`**

```css
.footer-hints {
    text-align: center;
    padding: 12px 16px 4px;
    font-size: var(--tw-t-tiny);
    color: var(--tw-fg-dim);
    letter-spacing: 0.2px;
    border-top: 1px solid var(--tw-divider);
    margin-top: 8px;
}
```

- [ ] **Step 1.6: Lint + визуальный чек**

```bash
npm run lint
```
Ожидаемо: 0 ошибок.

Запустить приложение (`unset ELECTRON_RUN_AS_NODE && npm start`), убедиться что панель открывается без ошибок в DevTools (`npm run dev`). На этом этапе табы могут выглядеть «сломанно» — это ok, правим HTML в Task 3-4.

- [ ] **Step 1.7: Commit**

```bash
git add electron-control.html
git commit -m "design(v3): pill tabs + segmented + group-title CSS"
```

---

## Task 2 — Control HTML: titlebar, chip «готов», footer, разделение групп

**Worker:** W1 · **Files:** `electron-control.html`

- [ ] **Step 2.1: Titlebar: `TIMER WIDGET` → `⏱ ТАЙМЕР`**

Найти в HTML (вероятно в `.titlebar`):

```html
TIMER WIDGET
```
Заменить на:
```html
⏱ ТАЙМЕР
```

- [ ] **Step 2.2: Chip `ГОТОВ К ЗАПУСКУ` → `готов`**

Найти в HTML hero-секции `.hero-status` (или id `statusText` — проверить `grep -n "ГОТОВ К ЗАПУСКУ" electron-control.html`):

```html
<span id="statusText">ГОТОВ К ЗАПУСКУ</span>
```
Заменить только стартовый текст на:
```html
<span id="statusText">готов</span>
```
**Важно:** JS-строки вроде `'ГОТОВ К ЗАПУСКУ'` в обработчиках тоже поменять на `'готов'` (найти через `grep -n "ГОТОВ К ЗАПУСКУ"`).

- [ ] **Step 2.3: Добавить section-label'ы**

Найти 4 группы (пресеты, adjust-row, кнопки окон, табы) и перед каждой добавить заголовок:

```html
<div class="group-title">БЫСТРЫЙ ВЫБОР</div>
<!-- существующий блок пресетов -->
```
```html
<div class="group-title">ТОЧНАЯ НАСТРОЙКА</div>
<!-- существующий блок ±1м/±5м/±1ч -->
```
```html
<div class="group-title">ОКНА</div>
<!-- существующий блок кнопок Виджет/Часы/Полноэкранный -->
```
```html
<div class="group-title">НАСТРОЙКИ</div>
<!-- существующий блок табов -->
```

- [ ] **Step 2.4: Разделить «Считать ниже нуля» и кнопки окон**

Найти ряд, где `⏱ Считать ниже нуля` соседствует с кнопками `Виджет / Часы / Полноэкранный`. Вынести тумблер «Считать ниже нуля» в таб-контент `data-tab="timer"` (панель «Виджет»), в начале её содержимого. Кнопки окон оставить отдельной группой с `<div class="group-title">ОКНА</div>` сверху.

Если таб-контент «Виджет» имеет структуру `.settings-row` / `.toggle-row` — использовать тот же паттерн:

```html
<div class="toggle-row">
    <label class="toggle-label">⏱ Считать ниже нуля</label>
    <!-- перенесённый input/switch -->
</div>
```

**Не меняй** id, data-attr и event-listener'ы — только перемещение DOM-узла.

- [ ] **Step 2.5: Добавить footer-hints в конец `.panel`**

Перед закрывающим `</div>` панели (последний корневой блок перед `<script>`):

```html
<div class="footer-hints">Space — старт/пауза · R — сброс · 1-8 — пресеты</div>
```

- [ ] **Step 2.6: Обернуть `.tab-btn`-кнопки в `.tabs-row`**

Найти контейнер с 4 `<button class="tab-btn" data-tab="...">`. Обернуть в:

```html
<div class="tabs-row">
    <button class="tab-btn active" data-tab="timer">Виджет</button>
    <button class="tab-btn" data-tab="clock">Часы</button>
    <button class="tab-btn" data-tab="display">Полноэкр.</button>
    <button class="tab-btn" data-tab="sound">Звуки</button>
</div>
```

Иконки (`<span class="icon">`) убрать из кнопок, текст сократить «Полноэкранный» → «Полноэкр.».

- [ ] **Step 2.7: Lint + смоук**

```bash
npm run lint
```

Запустить приложение, открыть панель — убедиться:
- title показывает `⏱ ТАЙМЕР`
- chip = `готов`
- 4 section-label'а видны
- «Считать ниже нуля» внутри таба «Виджет»
- Табы работают (клик → переключение контента)
- Footer-hints виден внизу

- [ ] **Step 2.8: Commit**

```bash
git add electron-control.html
git commit -m "design(v3): control panel — titlebar, chip, section labels, footer hints"
```

---

## Task 3 — (merged into Task 2, kept for numbering alignment)

**No-op.** Разделение «Считать ниже нуля» + группа ОКНА сделано в Task 2.4. Переходи к Task 4.

---

## Task 4 — (merged into Task 2)

**No-op.** Pill-табы + оборачивание в `.tabs-row` сделано в Task 2.6.

---

## Task 5 — Control JS: segmented style-picker adapter

**Worker:** W2 (depends on W1 Task 2 complete) · **Files:** `electron-control.html` (JS-блок)

- [ ] **Step 5.1: Заменить `<select id="timerStyle">` на `<div class="segmented">`**

Найти (~строка 2705):

```html
<select id="timerStyle" aria-label="Стиль виджета" style="...">
    <option value="circle">...</option>
    <option value="digital">...</option>
    <option value="flip">...</option>
    <option value="analog">...</option>
</select>
```

Заменить на:

```html
<div class="segmented" id="timerStyle" role="tablist" aria-label="Стиль виджета" data-value="circle">
    <button type="button" data-val="circle" class="active">Круг</button>
    <button type="button" data-val="digital">LED</button>
    <button type="button" data-val="flip">Флип</button>
    <button type="button" data-val="analog">Аналог</button>
</div>
```

- [ ] **Step 5.2: Добавить `.value` adapter + click handlers в конструктор**

Найти `this.timerStyleEl = document.getElementById('timerStyle');` (~строка 3676). Сразу после него вставить:

```js
// Backward-compat: .value геттер/сеттер для segmented
if (!Object.getOwnPropertyDescriptor(this.timerStyleEl, 'value')) {
    Object.defineProperty(this.timerStyleEl, 'value', {
        get() { return this.dataset.value || 'circle'; },
        set(v) {
            this.dataset.value = v;
            this.querySelectorAll('button').forEach(b =>
                b.classList.toggle('active', b.dataset.val === v));
            this.dispatchEvent(new Event('change'));
        },
        configurable: true
    });
}
this.timerStyleEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { this.timerStyleEl.value = btn.dataset.val; });
});
```

- [ ] **Step 5.3: Проверить все точки чтения `timerStyleEl.value`**

```bash
grep -n "timerStyleEl\.value" electron-control.html
```

Ожидается список мест (set при загрузке настроек, get при broadcast). Все — через геттер/сеттер должны работать без изменений. **Ничего не правим здесь.**

- [ ] **Step 5.4: Смоук-тест**

```bash
unset ELECTRON_RUN_AS_NODE && npm start
```

Открыть панель → таб «Виджет» → кликнуть по каждой из 4 пилл (Круг/LED/Флип/Аналог). Проверить:
- Активная пилла подсвечивается
- Виджет (если открыт) переключает стиль сразу
- В DevTools `document.getElementById('timerStyle').value` возвращает правильное значение

- [ ] **Step 5.5: Commit**

```bash
git add electron-control.html
git commit -m "design(v3): segmented style-picker with value adapter"
```

---

## Task 6 — Новая настройка «Показывать деления»

**Worker:** W2 · **Files:** `constants.js`, `electron-control.html`

- [ ] **Step 6.1: Добавить storage keys в `constants.js`**

Найти блок `STORAGE_KEYS` (строка 103). В объект добавить:

```js
WIDGET_SHOW_TICKS: 'widgetShowTicks',
CLOCK_SHOW_TICKS: 'clockShowTicks',
```

Вставить после строки `CLOCK_WIDGET_SETTINGS: 'clockWidgetSettings',`.

- [ ] **Step 6.2: Добавить чекбокс в таб «Виджет»**

В таб-контент `data-tab="timer"` (рядом с «Считать ниже нуля» из Task 2.4) добавить:

```html
<div class="toggle-row">
    <label class="toggle-label" for="widgetShowTicks">Показывать деления</label>
    <input type="checkbox" id="widgetShowTicks" class="toggle-input">
</div>
```

Используй существующий тумблер-стиль того же таба.

- [ ] **Step 6.3: Wire load + save + IPC**

Найти конструктор класса (где инициализируется `this.timerStyleEl`). Добавить:

```js
this.widgetShowTicksEl = document.getElementById('widgetShowTicks');
// Load (default false)
this.widgetShowTicksEl.checked = localStorage.getItem('widgetShowTicks') === 'true';
// Save + broadcast
this.widgetShowTicksEl.addEventListener('change', () => {
    const val = this.widgetShowTicksEl.checked;
    localStorage.setItem('widgetShowTicks', val);
    ipcRenderer.send('widget-style-update', {
        timerStyle: this.timerStyleEl.value,
        timerScale: parseInt(this.timerScaleEl.value),
        showTicks: val
    });
    if (this.syncClockStyle) {
        ipcRenderer.send('clock-widget-settings', { showTicks: val });
    }
});
```

- [ ] **Step 6.4: Подмешать `showTicks` в остальные существующие `widget-style-update`-send'ы**

```bash
grep -n "ipcRenderer.send('widget-style-update'" electron-control.html
```

В каждом payload добавить `showTicks: this.widgetShowTicksEl?.checked ?? false` (optional chaining — на случай что элемент ещё не инициализирован). Пример:

```js
// Было:
ipcRenderer.send('widget-style-update', { timerStyle: this.timerStyleEl.value });
// Стало:
ipcRenderer.send('widget-style-update', {
    timerStyle: this.timerStyleEl.value,
    showTicks: this.widgetShowTicksEl?.checked ?? false
});
```

- [ ] **Step 6.5: Lint + тест**

```bash
npm run ci
```

Ожидаемо: все 70 тестов проходят, lint 0 ошибок.

- [ ] **Step 6.6: Commit**

```bash
git add constants.js electron-control.html
git commit -m "design(v3): show-ticks setting (default off) + IPC payload"
```

---

## Task 7 — Display: label «Осталось» + chip states + hint fade

**Worker:** W3 · **Files:** `display.html`, `display-script.js`

- [ ] **Step 7.1: Добавить hero-label в HTML (перед таймером)**

Найти в `display.html` блок с hero-таймером. Перед элементом таймера добавить:

```html
<div class="hero-label" id="heroLabel">Осталось</div>
```

- [ ] **Step 7.2: CSS для hero-label и chip states**

В `<style>` блок display.html добавить:

```css
.hero-label {
    font-size: 22px;
    font-weight: 600;
    color: rgba(255,255,255,0.6);
    text-transform: uppercase;
    letter-spacing: 4px;
    margin-bottom: 24px;
    text-align: center;
}
.status-chip.is-success {
    background: rgba(48,209,88,0.22);
    color: var(--tw-green);
    border-color: rgba(48,209,88,0.4);
}
.status-chip.is-attention {
    background: rgba(255,69,58,0.22);
    color: var(--tw-red);
    border-color: rgba(255,69,58,0.4);
}
.status-glyph {
    display: inline-block;
    margin-right: 8px;
    font-family: var(--tw-font-mono);
}
```

- [ ] **Step 7.3: Hint-strip в самый низ + fade-out**

Найти в CSS `.controls-hint` (строка 1114). Изменить/добавить:

```css
.controls-hint {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    /* ...остальные поля оставить... */
    opacity: 1;
    transition: opacity 400ms var(--tw-ease);
    pointer-events: none;
}
.controls-hint.faded { opacity: 0; }
```

- [ ] **Step 7.4: JS — chip states (`display-script.js`)**

Найти место, где обновляется `statusText` (grep `statusText` в display-script.js). Добавить логику chip state:

```js
function updateChipState(state) {
    const chip = document.querySelector('.status-chip'); // use actual class/id
    const text = document.getElementById('statusText');
    const label = document.getElementById('heroLabel');
    if (!chip || !text || !label) return;

    chip.classList.remove('is-success', 'is-attention');
    let glyph = '';
    let chipText = 'готов';
    let labelText = 'Осталось';

    if (state.finished) {
        chip.classList.add('is-success');
        glyph = '✓ ';
        chipText = 'Завершено';
        labelText = 'Завершено';
    } else if (state.remainingSeconds < 0) {
        chip.classList.add('is-attention');
        glyph = '! ';
        chipText = 'Сверх времени';
        labelText = 'Сверх времени';
    } else if (state.isRunning && !state.isPaused) {
        chip.classList.add('is-success');
        glyph = '▶ ';
        chipText = 'Работает';
    } else if (state.isPaused) {
        glyph = '‖ ';
        chipText = 'Пауза';
        labelText = 'Пауза';
    }

    text.innerHTML = `<span class="status-glyph">${glyph}</span>${chipText}`;
    label.textContent = labelText;
}
```

Вызвать `updateChipState(timerState)` в основном обработчике `timer-state` (ищи `ipcRenderer.on('timer-state'...)`).

- [ ] **Step 7.5: JS — hint fade-out после 4 сек**

В display-script.js в `DOMContentLoaded` или init:

```js
(function hintFade() {
    const hint = document.getElementById('controlsHint');
    if (!hint) return;
    let timer;
    const reset = () => {
        hint.classList.remove('faded');
        clearTimeout(timer);
        timer = setTimeout(() => hint.classList.add('faded'), 4000);
    };
    document.addEventListener('mousemove', reset, { passive: true });
    document.addEventListener('keydown', reset);
    reset();
})();
```

- [ ] **Step 7.6: Lint + смоук**

```bash
npm run lint
```

Запустить, открыть display (кнопка «Полноэкранный»):
- Над таймером «ОСТАЛОСЬ»
- Chip нейтральный «готов»
- Запустить таймер → chip становится зелёный «▶ Работает»
- Дойти до 00:00 → chip «✓ Завершено»
- Пауза → «‖ Пауза»
- Через 4 сек без движения мыши — hint скрывается

- [ ] **Step 7.7: Commit**

```bash
git add display.html display-script.js
git commit -m "design(v3): display — hero label, chip states, hint fade"
```

---

## Task 8 — Widget + Clock: tick-marks as opt-in

**Worker:** W4 · **Files:** `electron-widget.html`, `electron-clock-widget.html`

- [ ] **Step 8.1: Widget — CSS default hide**

В `electron-widget.html` CSS-блоке, рядом с `.tick-marks` (строка ~168):

```css
.tick-marks { display: none; }
.ticks-on .tick-marks { display: inline; }
```

- [ ] **Step 8.2: Widget — applyTicks helper**

В `<script>` добавить (около других apply-функций):

```js
function applyShowTicks(showTicks) {
    const el = document.querySelector('.widget-container') || document.body;
    el.classList.toggle('ticks-on', !!showTicks);
}
```

- [ ] **Step 8.3: Widget — подписаться на IPC**

Найти существующий обработчик `widget-style-update` (или IPC init секцию). Добавить:

```js
ipcRenderer.on('widget-style-update', (event, payload) => {
    // существующий код style/scale...
    applyShowTicks(payload?.showTicks ?? false);
});
```

Если уже есть handler — добавить последней строкой вызов `applyShowTicks(payload?.showTicks ?? false)`.

- [ ] **Step 8.4: Widget — дефолт при старте (persist через IPC request)**

В init-блоке (DOMContentLoaded или после connection) вызвать `applyShowTicks(false)` явно для чистой загрузки.

- [ ] **Step 8.5: Clock — повторить 8.1-8.4**

В `electron-clock-widget.html`:

CSS:
```css
.widget-clock-tick { display: none; }
.ticks-on .widget-clock-tick { display: block; }
```

(Прим.: в clock виджете классы называются `.widget-clock-tick` а не `.tick-marks`, см. [electron-widget.html:562](electron-widget.html#L562)).

JS: аналогичный `applyShowTicks` + подписка на `clock-widget-settings` IPC:
```js
ipcRenderer.on('clock-widget-settings', (event, payload) => {
    // существующий код...
    if (payload && 'showTicks' in payload) applyShowTicks(payload.showTicks);
});
```

- [ ] **Step 8.6: Смоук**

```bash
npm run lint && unset ELECTRON_RUN_AS_NODE && npm start
```

- Открыть виджет и clock-widget — **тики скрыты** по умолчанию
- В панели → таб «Виджет» → включить «Показывать деления» → тики появились в обоих окнах
- Выключить — снова скрыты
- Перезапустить приложение → тики снова скрыты (persistence через localStorage работает, см. Task 6)

- [ ] **Step 8.7: Commit**

```bash
git add electron-widget.html electron-clock-widget.html
git commit -m "design(v3): tick-marks opt-in in widget and clock"
```

---

## Task 9 — W5 Verify: полный прогон

**Worker:** W5 (runs after W1-W4) · **Files:** — (только тесты/смоук)

- [ ] **Step 9.1: CI-прогон**

```bash
npm run ci
```

Ожидаемо: lint 0 ошибок, 70/70 tests pass.

Если падают тесты — **остановиться и починить**. Не коммитить.

- [ ] **Step 9.2: Smoke-сценарии**

Запустить `unset ELECTRON_RUN_AS_NODE && npm start`. Пройти весь чек-лист из spec (Task 9 в спеке):

- [x] панель открывается тёмная независимо от OS-темы
- [x] section-labels видны (4 штуки)
- [x] titlebar `⏱ ТАЙМЕР`, chip `готов`, footer-hints
- [x] segmented: клик по Круг/LED/Флип/Аналог → виджет переключается
- [x] чекбокс «Показывать деления» off → тики скрыты; on → видны; persistence после рестарта
- [x] display: chip `▶ Работает` при старте, `! Сверх времени` при overrun, `‖ Пауза` на паузе, `✓ Завершено` в конце
- [x] display: «ОСТАЛОСЬ» над таймером; hint скрывается через 4 сек
- [x] Space / R / 1-8 / W / C / D — все keyboard-shortcuts работают
- [x] pill-табы в панели переключают контент

- [ ] **Step 9.3: Визуальное сравнение с китом**

Через Windows Snipping Tool сделать скриншоты 4 окон. Разместить рядом с `audit/kit-*.png`. Субъективно оценить parity (≥95%).

- [ ] **Step 9.4: (Опционально) Закоммитить все вместе**

Если работа шла пачками по подзадачам — каждая уже имеет свой коммит. Финальный коммит не нужен. Если осталось что-то несдублированное — добавить:

```bash
git log design-system-v3 ^origin/design-system-v3 --oneline
```

Показывает список коммитов готовых к push.

- [ ] **Step 9.5: Уведомить пользователя**

Сообщить:
> Реализация готова. Коммиты на `design-system-v3`. `npm run ci` зелёный. Смоук пройден. Мёрж в `main` — по твоей команде.

---

## Self-Review (executed)

**Spec coverage:**
- Gap 1 (section-labels) → Task 2.3 ✓
- Gap 2 (chip «готов») → Task 2.2 ✓
- Gap 3 (titlebar) → Task 2.1 ✓
- Gap 4 (footer-hints) → Task 2.5 + CSS Task 1.5 ✓
- Gap 5 (разделение «Считать ниже нуля») → Task 2.4 ✓
- Gap 6 (chip is-success + ▶ на display) → Task 7.2 + 7.4 ✓
- Gap 7 (hint-strip позиция + fade) → Task 7.3 + 7.5 ✓
- Gap 8 (label «Осталось») → Task 7.1 + 7.4 ✓
- Gap 9 (segmented style-picker) → Task 5 ✓
- Gap 10 (pill-табы) → Task 1.2 + 2.6 ✓
- Option 11 (показывать деления) → Task 6 + 8 ✓

**Placeholder scan:** Task 3 и Task 4 помечены как merged-into-2 с указанием где содержимое — это intentional, не плейсхолдер. Нет «TODO», «implement later», пустых steps.

**Type consistency:** `widgetShowTicksEl`, `applyShowTicks`, ключ `showTicks` в payload — используются консистентно в Task 6 → Task 8. CSS-класс `ticks-on` (не `ticks-off` как в спеке — инвертирован, т.к. default hidden — так проще). Спека говорила `.ticks-off`, план говорит `.ticks-on` — **консистентно между Task 8.1 и Task 8.5**, поправка от спеки намеренная (default-hidden делает "включено" явным классом).

**Storage keys:** `WIDGET_SHOW_TICKS`, `CLOCK_SHOW_TICKS` в constants.js consistent с Task 6.

Все требования спеки → покрыты задачами. Плейсхолдеров нет. Готов к исполнению.
