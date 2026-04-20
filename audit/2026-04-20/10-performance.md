# 10 — performance

**Date:** 2026-04-20
**Status:** completed
**Tool used:** grep + manual review

## Summary

- Total findings: 6
- critical: 0, high: 1, medium: 4, low: 1

## Findings

### F-001: [HIGH] fs.writeFileSync в hot path event loop main process

- **Location:** `electron-main.js:478-480` (saveTimerStateToFile inside setInterval(10000))
- **Category:** performance
- **Tool:** manual review
- **Context:**
  ```javascript
  setInterval(() => {
      if (timerState.isRunning) { saveTimerStateToFile(); }
  }, 10000);

  function saveTimerStateToFile() {
      ...
      fs.writeFileSync(statePath, data);  // SYNC I/O
  }
  ```
- **Details:** `fs.writeFileSync` блокирует event loop main process на 5-50ms (зависит от диска). При нагрузке на диск или антивирусе — может фризить IPC dispatch, что отражается на tick таймера и обновлении tray. JSON ~200 байт — но fsync медленный.
- **Proposed fix:** Заменить на `fs.promises.writeFile` или `fs.writeFile` с callback (async). State recovery всё равно best-effort, асинхронность приемлема.
- **Size estimate:** small
- **Auto-fixable:** yes

---

### F-002: [MEDIUM] Tray menu rebuild каждую секунду через Menu.buildFromTemplate

- **Location:** `electron-main.js:519-552` (updateTrayMenu)
- **Category:** performance
- **Tool:** manual review
- **Context:** `emitTimerState` вызывает `updateTrayMenu()` каждую секунду. `updateTrayMenu` создаёт массив template items и вызывает `Menu.buildFromTemplate(...)` — это allocation 10+ объектов и нативный mutex с ОС.
- **Details:** На macOS — относительно дёшево (~0.5ms), но на Windows и Linux могут быть видимые лаги. Также — flicker меню при открытии в момент tick.
- **Proposed fix:** Кешировать Menu объект, обновлять только label первого элемента (`tray.setTitle()` или менять template-objects in-place). Альтернативно — обновлять menu только при открытии (event 'right-click' / 'show').
- **Size estimate:** small
- **Auto-fixable:** yes

---

### F-003: [MEDIUM] querySelectorAll в applyColors каждый раз

- **Location:** `display-script.js:687-695`
- **Category:** performance
- **Tool:** manual review
- **Context:** При смене цвета — 2 `querySelectorAll` обхода DOM (для flip-digit, flip-separator).
- **Details:** Не hot-path (срабатывает только при color change), но flip элементы можно закешировать в конструкторе.
- **Proposed fix:** Кеширование `this._flipDigits = container.querySelectorAll('.flip-digit')` в конструкторе DisplayTimer.
- **Size estimate:** small
- **Auto-fixable:** yes

---

### F-004: [MEDIUM] Незакрытые таймеры в DisplayTimer cleanup

- **Location:** `display-script.js:1356, 1490, 1541, 1719`
- **Category:** performance / resource leak
- **Tool:** grep
- **Context:** `flashInterval` и 3 `setTimeout` не отслеживаются в массиве `this._timers`, поэтому в cleanup() не очищаются.
- **Details:** При закрытии display window — таймеры могут продолжать тикать ещё несколько секунд, удерживая ссылки на DOM (хотя DOM уже unloaded). Не фатально (Electron убьёт процесс), но best-practice violation.
- **Proposed fix:** Добавить `this._timers.push(timeoutId)` для каждого setTimeout/setInterval в DisplayTimer и очищать в cleanup().
- **Size estimate:** small
- **Auto-fixable:** yes

---

### F-005: [MEDIUM] Mini-clock hand updates без батчинга

- **Location:** `display-script.js` (analog hand rotation calls)
- **Category:** performance
- **Tool:** manual review
- **Context:** 3 querySelector вызова на стрелки часов каждый tick.
- **Details:** Аналогично F-003. Кеширование решает.
- **Proposed fix:** Кешировать `this._hourHand`, `this._minuteHand`, `this._secondHand` в конструкторе.
- **Size estimate:** small
- **Auto-fixable:** yes

---

### F-006: [LOW] Tray icon создаётся каждый раз nativeImage.createFromPath + resize

- **Location:** `electron-main.js:498-500` (createTray)
- **Category:** performance
- **Tool:** manual review
- **Context:** Иконка PNG 1.6MB декодируется в memory и resize до 16×16 один раз при старте.
- **Details:** Экономия — preload иконки 32×32 / 16×16 как отдельные файлы в build/. ~50ms на startup.
- **Proposed fix:** Создать `build/icon-16.png`, `build/icon-32.png`, использовать сразу нужный размер.
- **Size estimate:** small
- **Auto-fixable:** no (требует генерацию PNG)

---

## Хорошее состояние

- timer-engine.js — 25ns/tick (см. tests/perf.test.js)
- Heap delta после 1M ticks: +0.01 MB
- Нет N+1 паттернов, нет forEach-await антипаттернов
- IPC broadcast только raz/sek (timer-state)
