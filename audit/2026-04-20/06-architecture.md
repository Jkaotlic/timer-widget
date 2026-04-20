# 06 — architecture

**Date:** 2026-04-20
**Status:** completed
**Tool used:** grep require + manual review

## Summary

- Total findings: 4
- critical: 0, high: 0, medium: 3, low: 1

## Граф зависимостей (main process)

- `electron-main.js` → `electron, fs, path, electron-log/main, ./utils, ./constants, ./timer-engine`
- `timer-engine.js` → **(pure: ничего не require)**
- `utils.js`, `security.js`, `constants.js` → **(UMD, dual Node/browser, без external requires)**
- `preload.js` → `electron`
- `channel-validator.js` → **(no requires)**
- `ipc-compat.js` → **(browser-only, no requires)**

**Циркулярные импорты:** не обнаружены. Граф ацикличный.

## Findings

### F-001: [LOW] Test export anti-pattern в electron-main.js

- **Location:** `electron-main.js:467` (`exports.isRecoveryValid`)
- **Category:** architecture
- **Tool:** manual review
- **Context:** Функция экспортируется ТОЛЬКО для того, чтобы tests/recovery.test.js могла её протестировать.
- **Details:** Code smell — продакшн код знает о тестах. Лучше вынести `isRecoveryValid` в отдельный модуль (`recovery.js`), который и main, и тесты могут require чисто.
- **Proposed fix:** Создать `recovery.js` с `isRecoveryValid`, `saveTimerStateToFile`, `loadSavedTimerState`. electron-main.js делает `require('./recovery')`. Тесты делают то же самое без stubs.
- **Size estimate:** small
- **Auto-fixable:** no

---

### F-002: [MEDIUM] Large main process (1016 строк) — близко к god-module

- **Location:** `electron-main.js`
- **Category:** architecture
- **Tool:** wc -l
- **Context:** Файл содержит 24 функции — close to threshold (~500 lines, ~20 functions).
- **Details:** Дублируется с finding F-003 в 05-code-quality. Архитектурно разделимо: window factories, tray, recovery, IPC, lifecycle.
- **Proposed fix:** См. 05-code-quality F-003.
- **Size estimate:** large
- **Auto-fixable:** no

---

### F-003: [MEDIUM] Дубликаты IPC channel whitelist (preload.js inline + channel-validator.js)

- **Location:** `preload.js:13-75` и `channel-validator.js`
- **Category:** architecture / DRY
- **Tool:** diff
- **Context:** Намеренное дублирование из-за sandbox restriction (preload не может require local).
- **Details:** Дублируется с F-004 в 05-code-quality. Тест синхронизации защищает.
- **Proposed fix:** Build-step автогенерация preload.js из channel-validator.js.
- **Size estimate:** small
- **Auto-fixable:** no

---

### F-004: [MEDIUM] UMD pattern verbose в utils/security/constants

- **Location:** `utils.js:158+`, `security.js:174+`, `constants.js:130+`
- **Category:** architecture
- **Tool:** manual review
- **Context:** Каждый из 3 файлов имеет conditional exports для Node и для browser:
  ```javascript
  if (typeof module !== 'undefined' && module.exports) { module.exports = {...}; }
  if (typeof window !== 'undefined') { window.X = {...}; }
  ```
- **Details:** Работает, но verbose. Пакетный вариант (например, через Vite/esbuild bundle) был бы чище.
- **Proposed fix:** Опционально — добавить bundler. Усложнит build pipeline. Оставить как есть приемлемо.
- **Size estimate:** large
- **Auto-fixable:** no

---

## Соответствие слоёв

- ✓ timer-engine.js — полностью pure, не знает про Electron/IPC
- ✓ utils/security/constants — pure, могут использоваться и в main, и в renderer
- ✓ Renderer (display-script.js, HTML inline JS) — использует только electronAPI / ipc-compat
- ✓ Main process — единственное место, где require('electron') {app, BrowserWindow, ipcMain, etc.}
- ✓ preload.js — изолированный bridge
