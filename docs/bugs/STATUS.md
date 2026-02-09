# Статус исправления багов

> **Последнее обновление:** 2026-02-09 (Аудит #2)
> **Аудит:** Полная проверка по коду + повторный глубокий аудит всех файлов

---

## Общий прогресс

| Приоритет    | Исправлено | Всего | Статус |
|--------------|------------|-------|--------|
| 🔴 CRITICAL  | 3          | 3     | ✅ 100% |
| 🟠 HIGH      | 9          | 9     | ✅ 100% |
| 🟡 MEDIUM    | 13         | 13    | ✅ 100% |
| 🟢 LOW       | 3          | 3     | ✅ 100% |
| 🔵 PRIORITY  | 3          | 3     | ✅ 100% |
| 🆕 AUDIT #2  | 12         | 12    | ✅ 100% |
| **Итого**    | **43**     | **43**| ✅ 100% |

---

## 🔵 Priority Bugs (BUG-A/B/C)

| # | Баг | Статус | Верификация |
|---|-----|--------|-------------|
| BUG-A | Горячие клавиши не работают | ✅ | `window.timerController` назначен (L3958), методы `.pause()`, `.start()`, `.reset()`, `.setTime()` вызываются корректно |
| BUG-B | Пробел не работает в фулскрине | ✅ | `setupKeyboardShortcuts()` добавлен в DisplayTimer (display-script.js:68-99) |
| BUG-C | Статус меняется при выставлении звука | ✅ | `cache.lastRunning` отслеживается, статус проверяется вне cache guard (display-script.js:641-645) |

---

## 🔴 CRITICAL (BUG-001 — BUG-003)

| # | Баг | Статус | Верификация |
|---|-----|--------|-------------|
| BUG-001 | Memory Leak — IPC listeners | ✅ | `cleanup()` с `removeListener()` для всех хендлеров + `beforeunload` |
| BUG-002 | Memory Leak — setInterval | ✅ | `this.intervals[]` хранит ID, `cleanup()` вызывает `clearInterval()` |
| BUG-003 | Race Condition — startTimer | ✅ | `timerLock` + `try/finally` (electron-main.js:114-160) |

---

## 🟠 HIGH (BUG-004 — BUG-012)

| # | Баг | Статус | Верификация |
|---|-----|--------|-------------|
| BUG-004 | XSS через innerHTML | ✅ | `escapeHTML()` применён к user input в electron-control.html |
| BUG-005 | nodeIntegration: true | ✅ | Все 4 окна: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` |
| BUG-006 | Overtime limit `<=` vs `<` | ✅ | Корректный оператор `<` (electron-main.js:140) |
| BUG-007 | Избыточные re-renders | ✅ | Cache объект с 8 полями в display-script.js |
| BUG-008 | Magic Numbers | ✅ | constants.js (325 строк) |
| BUG-009 | DRY — formatTime | ✅ | Делегирует в `formatTimeShort()` из utils.js |
| BUG-010 | CSS дублирование | ✅ | components.css создан и подключён |
| BUG-011 | Нет валидации ввода | ✅ | security.js (325 строк) — полный набор валидации |
| BUG-012 | Timestamp синхронизация | ✅ | Монотонный `timerUpdateCounter` |

---

## 🟡 MEDIUM (BUG-013 — BUG-025)

| # | Баг | Статус | Верификация |
|---|-----|--------|-------------|
| BUG-013 | IPC без error handling | ✅ | `safelySendToWindow()` с `isDestroyed()` check + try-catch |
| BUG-014 | JSON.parse без try-catch | ✅ | Все вызовы обёрнуты в safeJSONParse |
| BUG-015 | DOM undefined — stops[1] | ✅ | Guard `stops.length >= 2` |
| BUG-016 | Progress при overtime | ✅ | Negative ratio в `calculateProgressValue()` |
| BUG-017 | Config не синхронизируется | ✅ | `emitTimerState({})` при configChanged |
| BUG-018 | classList add/remove | ✅ | `dataset.status` вместо classList |
| BUG-019 | Resize без debounce | ✅ | Debounce 300мс |
| BUG-020 | Dead code checkColorChanges | ✅ | Удалён, IPC `colors-update` |
| BUG-021 | localStorage polling 100мс | ✅ | `storage` event + fallback 1с |
| BUG-022 | lastFlipValues не используется | ✅ | Skip-if-same оптимизация |
| BUG-023 | Неоптимальный цикл themes | ✅ | `activeThemeButton` tracking |
| BUG-024 | localStorage в setInterval | ✅ | Widget использует IPC |
| BUG-025 | Загрузка файлов без валидации | ✅ | Size + MIME check для image и sound |

---

## 🟢 LOW (BUG-026 — BUG-028)

| # | Баг | Статус | Верификация |
|---|-----|--------|-------------|
| BUG-026 | Плохие имена переменных | ✅ | `let t` → `let timeoutId` |
| BUG-027 | Нет CSP | ✅ | CSP meta-тег во всех 4 HTML |
| BUG-028 | Нет unit тестов | ✅ | 3 файла в tests/, 7 тестов, 100% pass |

---

## Тесты

```
✔ getTimerStatus returns correct status
✔ calculateProgress clamps 0..1 and handles edge cases
✔ formatTime formats HH:MM:SS with sign
✔ formatTimeShort outputs MM:SS or H:MM:SS
✔ parseTime parses HH:MM:SS, MM:SS, SS with sign
✔ isValidNumber accepts finite numbers only
✔ clamp restricts values to range

7 тестов, 0 ошибок
```

---

## 🆕 Аудит #2 — Новые баги (найдены при повторном глубоком аудите)

| # | Баг | Файл | Severity | Статус | Описание |
|---|-----|------|----------|--------|----------|
| NEW-01 | Hardcoded `clockStyle: 'circle'` | electron-control.html | HIGH | ✅ | `pushDisplaySettings()` всегда отправлял `clockStyle: 'circle'`, игнорируя выбор пользователя. Заменено на `this.syncClockStyle ? this.timerStyleEl.value : this.clockStyleEl.value` |
| NEW-02 | AudioContext leak | electron-control.html | HIGH | ✅ | Каждый вызов `playPreset()` создавал `new AudioContext()`, не закрывая старый. Браузеры ограничивают ~6 контекстов. Теперь используется shared `this._audioCtx` |
| NEW-03 | Escape не закрывает clock widget | electron-control.html | MEDIUM | ✅ | Обработчик Escape отправлял `close-widget` и `close-display`, но не `close-clock-widget`. Добавлен IPC вызов |
| NEW-04 | Control panel использует `timestamp` вместо `updateCounter` | electron-control.html | MEDIUM | ✅ | Рендерер сравнивал `state.timestamp` (wall-clock) вместо монотонного `updateCounter`. Fix: переключено на `updateCounter` |
| NEW-05 | Widget использует `timestamp` вместо `updateCounter` | electron-widget.html | MEDIUM | ✅ | Аналогичная проблема в WidgetTimer. Fix: `lastUpdateCounter` + dedup по `updateCounter` |
| NEW-06 | Sound master toggle: только opacity, не блокирует | electron-control.html | MEDIUM | ✅ | При выключении мастер-звука только менялась прозрачность. Добавлен `pointer-events: none` + initial state на загрузке |
| NEW-07 | `loadCustomSounds()` теряет текущий выбор | electron-control.html | MEDIUM | ✅ | Перестроение `<optgroup>` сбрасывало `<select>` value. Теперь сохраняется/восстанавливается текущий выбор |
| NEW-08 | `showInputError()` ломает flex-layout | electron-control.html | MEDIUM | ✅ | Error div вставлялся внутрь `.time-input-group`, разрывая расположение. Теперь вставляется после контейнера |
| NEW-09 | FAQ: неправильные значения пресетов 1-5 | electron-control.html | MEDIUM | ✅ | FAQ указывал «5, 10, 15, 30, 45 мин», код содержит [1, 5, 10, 15, 30]. Текст обновлён |
| NEW-10 | Sound file size: 10MB в коде vs 5MB в UI | electron-control.html | LOW | ✅ | `MAX_SOUND_SIZE` было 10MB, UI текст указывал 5MB. Код приведён к 5MB |
| NEW-11 | F1 overlay стакается | electron-control.html | LOW | ✅ | Повторное нажатие F1 создавало новый overlay поверх старого. Добавлена проверка по `id` |
| NEW-12 | Dead `.preset-btn` listeners | electron-control.html | LOW | ✅ | `attachEvents()` навешивал обработчики на `.preset-btn`, но таких элементов нет (есть `.quick-preset`). Мёртвый код удалён |

### Дополнительные мелкие фиксы:
- **ClockWidget (`electron-clock-widget.html`)**: `setInterval` в `startClock()` теперь сохраняется в `this.clockInterval` для cleanup при `beforeunload`
- **ClockWidget `loadSettings()`**: добавлен fallback `|| {}` для `JSON.parse` null result
