# 05 — code-quality

**Date:** 2026-04-20
**Status:** completed
**Tool used:** wc -l + grep + manual review

## Summary

- Total findings: 4
- critical: 0, high: 0, medium: 4, low: 0

## Findings

### F-001: [MEDIUM] electron-control.html — god-file (6119 строк inline JS)

- **Location:** `electron-control.html`
- **Category:** code-quality
- **Tool:** wc -l
- **Context:** Один HTML файл содержит весь UI и логику control window: ~6000 строк inline `<script>` + большой `<style>` блок.
- **Details:** Известный архитектурный долг (упоминается в CLAUDE.md). Затрудняет навигацию, ревью, тестирование. Класс TimerController + ColorPicker inline.
- **Proposed fix:** Вынести JS в отдельные файлы (control-script.js, color-picker.js), CSS в отдельные .css файлы. Большая задача — потребует обновления package.json files и CSP.
- **Size estimate:** large
- **Auto-fixable:** no

---

### F-002: [MEDIUM] display-script.js — высокая сложность (1779 строк, ~246 условных операторов)

- **Location:** `display-script.js`
- **Category:** code-quality
- **Tool:** wc -l + grep `if|else|switch|case`
- **Context:** Класс DisplayTimer имеет 23 метода, 246 условных операторов на ~1500 строк executable. Cyclomatic complexity высокая.
- **Details:** DisplayTimer обрабатывает 4 стиля отображения (circle/digital/flip/analog) в одном классе. Много branching logic.
- **Proposed fix:** Декомпозировать DisplayTimer на стратегии: CircleRenderer, DigitalRenderer, FlipRenderer, AnalogRenderer. Главный класс — координатор.
- **Size estimate:** large
- **Auto-fixable:** no

---

### F-003: [MEDIUM] electron-main.js — приближается к god-module (1016 строк, 24 функции)

- **Location:** `electron-main.js`
- **Category:** code-quality
- **Tool:** wc -l + grep `function`
- **Context:** Не превышает 1000-строчный порог критичности, но близко. После добавления tray + logger + crash recovery.
- **Details:** Содержит: window factories (4), timer logic delegation, IPC handlers (~30), tray menu, recovery, autostart. Логически разделимо.
- **Proposed fix:** Извлечь модули — `window-factory.js` (createControl/Widget/Display/Clock), `tray.js`, `recovery.js`, `ipc-handlers.js`. electron-main.js становится bootstrap (~200 строк).
- **Size estimate:** large
- **Auto-fixable:** no

---

### F-004: [MEDIUM] Дубликаты IPC whitelist между preload.js и channel-validator.js

- **Location:** `preload.js:13-75` и `channel-validator.js`
- **Category:** code-quality / DRY
- **Tool:** manual diff
- **Context:** ALLOWED_CHANNELS дублируется (44 канала send + 16 receive). Намеренно из-за `sandbox: true` (preload не может require local файлы).
- **Details:** Документировано в CLAUDE.md. Тест `channel-validator.test.js` проверяет синхронизацию. Архитектурно — необходимое зло.
- **Proposed fix:** Build-step: автогенерация preload.js из channel-validator.js (sed/template) перед сборкой. Опционально, текущий тест синхронизации — приемлемая защита.
- **Size estimate:** small (с автогенерацией)
- **Auto-fixable:** no

---

## Хорошее качество

- timer-engine.js — 196 строк, pure функции, отлично декомпозирован
- utils.js, security.js, constants.js — модульные, тестируемые
- Тесты — 138 (после добавления perf + recovery), 0 lint warnings
