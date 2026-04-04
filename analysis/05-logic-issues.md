# Анализ логики и архитектуры Timer Widget v1.2.9

## Средние

### LOGIC-01: Дублирование isSafeColor в 4 файлах
- **Файлы**: `electron-widget.html`, `electron-clock-widget.html`, `display-script.js`, `electron-control.html`
- **Проблема**: Одинаковый regex `/^#[0-9a-fA-F]{3,8}$|^rgba?\([\d,.\s%]+\)$/` определён локально в каждом файле. Изменение нужно делать в 4 местах.
- **Решение**: Вынести `isSafeColor` в `security.js` и использовать через `window.SecurityUtils.isSafeColor`.
- **Статус**: [ ] Не исправлено

### LOGIC-02: CLAUDE.md документирует timer-control как объект, код отправляет строку
- **Файл**: `CLAUDE.md` (строка "timer-control")
- **Проблема**: CLAUDE.md описывает `{ action: 'start'/'pause'/'reset' }`, но `display-script.js:83` и `electron-main.js:692` работают с plain string.
- **Решение**: Исправить документацию.
- **Статус**: [ ] Не исправлено

## Низкие

### LOGIC-03: Несколько IPC каналов в constants.js IPC_CHANNELS отсутствуют
- **Файл**: `constants.js:193-225`
- **Проблема**: `IPC_CHANNELS` не включает все каналы: отсутствуют `timer-reached-zero`, `timer-overrun-minute`, `resize-control-window`, `minimize-window`, `close-window`, `quit-app`, `clock-widget-resize`, `clock-widget-scale`, `clock-widget-set-style`, `clock-widget-settings`, `widget-window-state`, `clock-window-state`, `display-window-state`.
- **Решение**: Дополнить `IPC_CHANNELS` или удалить неполный объект (каноничный список — в `channel-validator.js`/`preload.js`).
- **Статус**: [ ] Не исправлено

## Позитивные аспекты архитектуры

- Чёткое разделение main/renderer процессов
- Единый источник истины для состояния таймера (main process)
- Монотонный updateCounter для надёжной синхронизации
- `safelySendToWindow()` предотвращает "Object has been destroyed" crash
- Хорошая модульность: constants.js, utils.js, security.js
- Все 67 тестов проходят, ESLint чистый
