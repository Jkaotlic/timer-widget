# План исправлений Timer Widget v1.2.9

## Phase 1: Quick wins (зависимости + документация)

- [x] DEP-01: `npm audit fix` для lodash CVE — 0 vulnerabilities
- [x] DEP-02: `npm update` для минорных обновлений
- [x] LOGIC-02/BUG-05: Исправить CLAUDE.md — timer-control отправляет строку, не объект
- [x] LOGIC-03: Дополнить IPC_CHANNELS в constants.js всеми каналами (+13 каналов)

## Phase 2: Код (безопасность + баги)

- [x] SEC-01: display-script.js:576 — заменить ручную санитизацию URL на SecurityUtils.validateImageSource()
- [x] SEC-02: electron-control.html — обернуть localStorage.setItem в try-catch для QuotaExceededError
- [x] SEC-03/LOGIC-01: Вынести isSafeColor в security.js с числовой валидацией rgba (r/g/b <= 255, alpha <= 1)
- [x] BUG-01: e2e/app.spec.js — убрать hardcoded macOS executablePath
- [x] BUG-04/DEAD-02: Удалить неиспользуемые свойства showCurrentTime/showEventTime/showEndTime из display-script.js

## Phase 3: Тесты

- [x] DEAD-01: Тест проверки синхронизации channel lists (preload.js vs channel-validator.js)
- [x] SEC-03: Тесты для isSafeColor (valid hex/rgba + rejection of dangerous values)

## Verification

- [x] npm run lint проходит
- [x] npm test проходит (70 тестов, +3 новых)
- [x] Все plan items отмечены [x]
