# Design System v3 — Full Parity (вариант C)

**Дата:** 2026-04-21
**Ветка:** `design-system-v3`
**Предыдущий спек:** [2026-04-20-design-system-v3.md](./2026-04-20-design-system-v3.md)

## Контекст

После первичной миграции на токены (`67d8709`) и аудит-раунда (`ad9a1be`) в ветке `design-system-v3` прошёл визуальный аудит против эталонного набора `Downloads/TimerWidget Design System/ui_kits/*`. Выявлено **10 расхождений** и **1 регрессия темы** (авто-light от OS).

Регрессия темы исправлена превентивно в `design-tokens.css` (удалён блок `@media (prefers-color-scheme: light)` → `:root:not([data-theme])`).

## Цель

Довести визуальное и UX-соответствие приложения с дизайн-китом до ≥95%, **не ломая функциональность**. Все текущие 70 тестов должны продолжать проходить, все IPC-каналы — оставаться работоспособными.

## Не-цель

- Миграция на внешний фреймворк (React/Vue) — остаётся vanilla JS.
- Переработка IPC-архитектуры — канальный whitelist не трогаем.
- Изменение формата сохранённых настроек — обратная совместимость с `localStorage` обязательна.

## Scope — 10 гэпов + 1 опция

### Визуальные (8) — CSS/HTML only

1. **Section labels в панели управления**
   Добавить `<div class="group-title">…</div>` перед 4 группами: пресеты (`БЫСТРЫЙ ВЫБОР`), adjust-строка (`ТОЧНАЯ НАСТРОЙКА`), кнопки окон (`ОКНА`), табы (`НАСТРОЙКИ`).
   CSS: `.group-title { font-size: 11px; font-weight: 600; color: var(--tw-fg-dim); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 10px; }`

2. **Chip-текст «готов»** (короткий вариант) в хиро панели управления. Заменить текст `ГОТОВ К ЗАПУСКУ` → `готов` (только `.hero-status`, остальные сообщения чипа — `Пауза`, `Идёт`, `Завершён` — не трогаем).

3. **Titlebar:** `TIMER WIDGET` → `⏱ ТАЙМЕР`.

4. **Footer keyboard-hints:** добавить в самый низ `.panel`:
   ```html
   <div class="footer-hints">Space — старт/пауза · R — сброс · 1-8 — пресеты</div>
   ```
   Стиль: 11px, `color: var(--tw-fg-dim)`, центрирован, padding 14px.

5. **Разделение «Считать ниже нуля» и кнопок окон**
   Сейчас — единая строка. Новая раскладка:
   - Блок `ОКНА` (section-label + 3 кнопки `Виджет / Часы / Полноэкранный`)
   - Чекбокс `Считать ниже нуля` переносится в настройки таба «Виджет» (ближе к своей семантике).

6. **Chip `is-success` + глиф `▶` на полноэкранном display**
   Когда `timerState.isRunning && !timerState.isPaused`, chip принимает класс `is-success` (зелёный фон/бордер) и префикс `▶ `. Базовое состояние (готов) — neutral без глифа. Overrun — `is-attention` + `!`. Пауза — neutral + `‖`. Завершено — `is-success` + `✓`.

7. **Hint-strip `Ctrl+колесо…` перекрывает chip** на display
   Варианты: (a) opacity 0 после 3 сек без движения мыши, (b) сдвиг в `bottom: 12px`, chip выше. Решение — **оба**: hint всегда снизу (`bottom: 12px`), chip поверх `hero` с `margin-top: 32px`, плюс fade-out через 4 сек бездействия мыши.

8. **Label `ОСТАЛОСЬ` над hero-таймером на display**
   `<div class="hero-label">Осталось</div>` над цифрой. 22px, letter-spacing 4px, uppercase, color `rgba(255,255,255,0.6)`. При overrun — `Сверх времени`, при паузе — `Пауза`, при completed — `Завершено`.

### UX (2) — HTML + CSS + JS адаптер

9. **Segmented style-picker** заменяет `<select id="timerStyleEl">`
   ```html
   <div class="segmented" id="timerStyleEl" data-value="circle" role="tablist">
     <button data-val="circle" class="active">Круг</button>
     <button data-val="digital">LED</button>
     <button data-val="flip">Флип</button>
     <button data-val="analog">Аналог</button>
   </div>
   ```

   **Backward-compat adapter.** Все текущие `timerStyleEl.value` и `timerStyleEl.addEventListener('change', ...)` продолжают работать через `Object.defineProperty`:
   ```js
   Object.defineProperty(timerStyleEl, 'value', {
     get() { return this.dataset.value; },
     set(v) {
       this.dataset.value = v;
       this.querySelectorAll('button').forEach(b =>
         b.classList.toggle('active', b.dataset.val === v));
       this.dispatchEvent(new Event('change'));
     },
     configurable: true
   });
   timerStyleEl.querySelectorAll('button').forEach(b =>
     b.addEventListener('click', () => { timerStyleEl.value = b.dataset.val; }));
   ```
   CSS `.segmented` — копия `.tabs` из `ui_kits/sound-tab/sound-tab.html`.

10. **Pill-табы вместо карточных**
    Сейчас табы — большие двухстрочные кнопки с иконкой+подписью. В ките — тонкие пиллы в одной плашке. Меняется только CSS (`.tab-btn`, `.tabs`). HTML и `data-tab` не трогаем. Иконки убираем.

### Опция (1) — новая настройка

11. **Чекбокс «Показывать деления»** в таб-е «Виджет»
    - Дефолт: `false` (матч с китом).
    - localStorage key: `widgetShowTicks`, `clockShowTicks` (раздельно для widget и clock).
    - IPC: расширить существующие каналы `widget-style-update` и `clock-widget-settings` новым полем `showTicks`.
    - Renderer: `.widget-container.ticks-off .tick-marks { display: none; }` (по умолчанию hidden).
    - Миграция: если ключ не задан — использовать `false` (тики скрыты у всех пользователей после обновления).

    **Важно:** в `syncClockStyle=true` (hidden checkbox) режиме — один чекбокс управляет обоими окнами. Это соответствует существующему паттерну «clock follows widget».

## Архитектура изменений

### Файлы

| Файл | Правки | LOC ориентир |
|---|---|---|
| `electron-control.html` | section-labels, segmented selector, pill-tabs, разделение групп, titlebar, footer-hints, chip «готов», новый чекбокс «Показывать деления» | ~200 CSS + ~50 HTML + ~40 JS |
| `electron-widget.html` | CSS `.ticks-off .tick-marks { display: none; }`, IPC-приём `showTicks` | ~15 |
| `electron-clock-widget.html` | то же | ~15 |
| `display.html` + `display-script.js` | chip классы, label `Осталось`, hint-strip позиция + fade-out | ~30 HTML/CSS + ~25 JS |
| `constants.js` | `STORAGE_KEYS.WIDGET_SHOW_TICKS`, `CLOCK_SHOW_TICKS` | +2 |
| `preload.js` + `channel-validator.js` | — (существующие каналы расширяются payload'ом, новых каналов **не нужно**) | 0 |
| `design-tokens.css` | ✅ уже сделано (удалён auto-light) | — |

### IPC contract

**Не меняем каналы.** Расширяем payload существующих:

- `widget-style-update`:
  было `{ timerStyle, timerScale }`, станет `{ timerStyle, timerScale, showTicks }`.
- `clock-widget-settings`:
  было `{ style, ... }`, добавляется `showTicks` (опционально, renderer делает `?? false`).

Это безопасно — старый код, который не знает про `showTicks`, просто его не читает; новый renderer читает с fallback на `false`.

### Data flow — `showTicks`

```
[control: чекбокс change]
  ├─→ localStorage.widgetShowTicks = bool
  ├─→ electronAPI.send('widget-style-update', { timerStyle, timerScale, showTicks })
  └─→ (если syncClockStyle) electronAPI.send('clock-widget-settings', { ..., showTicks })

[main процесс] → broadcast в соответствующие окна

[widget/clock renderer]
  └─→ document.querySelector('.widget-container').classList.toggle('ticks-off', !showTicks)
```

## План параллелизации

4 независимых воркера. Все работают в ветке `design-system-v3` над разными файлами — merge-конфликтов не будет.

| Worker | Файлы | Блокирует |
|---|---|---|
| **W1 — Control HTML/CSS** | `electron-control.html` (только CSS блок + HTML разметка, **JS не трогает**) | — |
| **W2 — Control JS adapter** | `electron-control.html` (только `<script>` блок: segmented adapter + чекбокс handler) | W1 (HTML должен быть готов) |
| **W3 — Display** | `display.html`, `display-script.js` | — |
| **W4 — Widget + Clock** | `electron-widget.html`, `electron-clock-widget.html`, `constants.js` | — |

W1 и W3, W4 стартуют параллельно. W2 стартует после W1.

После всех — **W5 (verify)**: `npm run ci` + ручной smoke-тест всех 4 стилей + настройки тиков + chip states.

## Error handling / откат

- Все правки атомарны по файлам → `git revert <hash>` откатывает один компонент.
- Если segmented-adapter ломает listener'ы — fallback: вернуть `<select>` с тем же id, сохранить `data-value` как `value`. (В спеке реализована защита через `configurable: true`.)
- Если IPC payload не совпадает — renderer использует `showTicks ?? false`.

## Testing

### Автоматизированные
- `npm run lint` — должен пройти без ошибок (ESLint 9 flat config).
- `node --test` — все 70 текущих тестов зелёные.
- **Новых тестов не добавляем** — изменения чисто визуальные + CSS toggle через bool; текущие тесты покрывают IPC-валидаторы и util-функции.

### Ручные smoke-сценарии (W5)
1. Запустить `npm start` (с пустым `ELECTRON_RUN_AS_NODE`).
2. Панель открывается в тёмной теме даже если Windows в light-mode ✓
3. Section-labels видны над 4 группами ✓
4. Клик по segmented-пиллам Круг/LED/Флип/Аналог — виджет переключается ✓
5. Чекбокс «Показывать деления»: off (default) — тики скрыты; on — видны в circle-стиле ✓
6. Запуск таймера → chip на display зелёный с `▶` ✓
7. Overrun (−00:05) → chip красный с `!` ✓
8. Пауза → chip neutral с `‖` ✓
9. Нажатие `W / C / D` — открывают/закрывают соответствующие окна ✓
10. Space/R/1-8 — работают с любого окна ✓

### Сравнение с китом
После W5 — сделать скриншоты всех 4 окон в реальном Electron через Windows Snipping Tool, разместить рядом с `audit/kit-*.png`, визуально оценить parity.

## Критерии успеха

- [ ] Все 70 тестов + lint зелёные.
- [ ] Ни один из существующих IPC-каналов не сломан (smoke-тест выше).
- [ ] Visual parity ≥95% по субъективной оценке пользователя.
- [ ] Тёмная тема — безусловный default (не реагирует на OS).
- [ ] Тики скрыты по умолчанию после первого запуска.

## Out of scope (явно)

- Механика drag-n-drop блоков на display.
- Система звуков (sound-tab переделана в предыдущем раунде).
- Цветовые темы (picker, HSV) — работают как есть.
- High-contrast mode — уже поддерживается через `[data-theme="hc-dark"]`.
