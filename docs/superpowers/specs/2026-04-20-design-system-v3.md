# Design System v3 — интеграция кита TimerWidget

**Дата:** 2026-04-20
**Ветка:** `design-system-v3`
**Источник дизайна:** `C:\Users\User\Downloads\TimerWidget Design System`

## Цель

Интегрировать внешний дизайн-кит (Apple VisionOS glassmorphism, refined) во все 4 окна приложения без регрессий функциональности.

## Что меняется

### 1. Токенизация CSS
Новый общий файл `design-tokens.css` в корне проекта — копия `colors_and_type.css` из кита. Подключается во все 4 HTML через `<link rel="stylesheet" href="design-tokens.css">`. Даёт:

- Темы `[data-theme="dark|light|hc-dark"]`
- `@media (prefers-reduced-motion)`, `@media (prefers-color-scheme: light)`
- `@supports not (backdrop-filter)` fallback
- Переменные `--tw-*`: цвета, радиусы, блюр, easing, типографика
- Утилиты: `.tw-panel`, `.tw-chip` (3 ступени: neutral/success/attention), `.tw-interactive`, `.tw-spin`, `.tw-error-msg`

### 2. Control Panel (`electron-control.html`)

**Структура по киту:**
- Titlebar: 3 macOS-light + `⏱️ ТАЙМЕР` caption
- Hero-секция: label `ОСТАЛОСЬ`, Inter 200 72px время с голубым глоу, chip статуса
- Transport: pause 56px + **start 64px green** + reset 56px
- Presets: 4×2 grid с hover → blue accent
- Adjust row: `−1 ч −5 мин −1 мин | +1 мин +5 мин +1 ч` в едином pill-контейнере с вертикальным разделителем
- Window row: Виджет/Часы/Полноэкранный (active = blue)
- Settings: tabs (2px padding) + settings-card (12px радиус, row divider)
- Apple-toggle (42×26, зелёный в on)
- Segmented style-picker с gradient-fill на active

**Вкладка Звуки — полная переделка по `sound-tab.html`:**
- Группы «Сигнал окончания» / «Последняя минута»
- Play-кнопка (gradient 36×36, переключается на red в playing)
- Селект с custom-chevron
- Waveform 56px с bar'ами (past=dim, future=gradient, playhead=white+glow)
- Volume slider 6px с thumb 18px
- Custom library: `.lib-item` с lucide music-icon, name + size/duration в mono, play/delete actions
- Dropzone 1.5px dashed + drop-icon + hover→blue
- Error banner с круглым `!` badge

### 3. Widget (`electron-widget.html`)
- Circle: SVG ring gradient, Inter 200 44px, glow
- LED: JetBrains Mono 56px, green #30d158 (НЕ #00ff88), inset top-gradient, rounded 14px enclosure
- Flip: 62×90 cards, Inter 600 52px, inset highlight + subtle shadow, colon = gradient dots
- Analog: radial face, ticks, gradient hour hand, red second hand
- Label `Circle / Digital LED / Flip / Analog` в углу (caption 10px uppercase)

### 4. Clock (`electron-clock-widget.html`)
- Inter 200 56px time + superscript seconds (18px, translateY(-16px))
- Date uppercase 12px letter-spacing 1px
- Timezone 10px mono
- Тот же glass recipe (blur 20 saturate 150)

### 5. Display (`display.html`)
- Background: gradient по умолчанию (`#1a1b3a → #0d1117 → #000`) + радиальные голубой+зелёный слои
- Top bar: «Текущее время» label + `14:32` Inter 200 56px | chip статуса `РАБОТАЕТ` green
- Center: huge `04:59` Inter 200 clamp(120px, 22vw, 360px) + SVG ring behind
- Bottom bar: Alt-draggable blocks (сохранён текущий механизм `displayBlockPositions`)

## Что НЕ меняется

- IPC каналы и whitelist в `preload.js` / `channel-validator.js`
- Timer state, updateCounter, presetSeconds
- Event handlers (клавиатура, drag, scale)
- LocalStorage ключи в `constants.js`
- Main process (`electron-main.js`)
- Тесты

## Констрейнты для агентов

1. **Токены** — все новые цвета/радиусы/блюры из `var(--tw-*)`. Hex-литералы только в LED glow и inline SVG gradient stops.
2. **Прозрачные окна** (widget, clock) — `NO outer box-shadow`, только inset + text-shadow glow.
3. **JS/IPC нетронут** — переписываем только CSS блок и HTML разметку внутри `<body>`. Все `document.getElementById`, `addEventListener`, `ipcRenderer.send/on` работают как было.
4. **Data-атрибуты/ID** — сохранить все существующие ID элементов, на которые ссылается JS. Если переносишь разметку — переноси с ID.
5. **Overtime логика** — inline `style.color` в `updateXxxDisplay()` остаётся (CLAUDE.md § «applyColors vs overtime colors»).
6. **`ipc-compat.js` shim** — остаётся.

## Параллелизация

4 агента — каждый на свой файл, без пересечений:

| Агент | Файл | Строк |
|-------|------|-------|
| A | `electron-control.html` (+ sound tab) | 6215 |
| B | `electron-widget.html` | 1898 |
| C | `electron-clock-widget.html` | 1868 |
| D | `display.html` | 1557 |

Пре-шаг (делаем до агентов): `design-tokens.css` в корне.
Пост-шаг: lint + test + quick smoke.

## Критерии приёмки

- `npm run ci` (lint + 70 tests) зелёный
- Все 4 окна визуально соответствуют UI-китам
- Все keyboard shortcuts работают (Space, R, 1-8, W, C, D)
- Все 4 стиля таймера работают в каждом окне
- IPC whitelist тест проходит
- Overtime / danger / warning colors работают
