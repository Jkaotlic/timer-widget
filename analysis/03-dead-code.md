# Анализ мёртвого кода Timer Widget v1.2.9

## Средние

### DEAD-01: channel-validator.js дублируется в preload.js
- **Файл**: `channel-validator.js` + `preload.js:13-61`
- **Проблема**: `channel-validator.js` экспортирует `ALLOWED_CHANNELS` и `isValidChannel`, но preload.js не может его require (sandbox:true ограничивает require). Поэтому код полностью продублирован inline. Файл `channel-validator.js` используется ТОЛЬКО в тестах.
- **Риск**: Средний — рассинхронизация списков каналов при изменении. Нужно менять в двух местах.
- **Решение**: Оставить как есть (ограничение sandbox), но добавить тест проверяющий идентичность.
- **Статус**: [ ] Не исправлено

### DEAD-02: Неиспользуемые свойства в DisplayTimer
- **Файл**: `display-script.js:36-38`
- **Проблема**: `showCurrentTime`, `showEventTime`, `showEndTime` инициализируются, но никогда не читаются. Видимость управляется CSS классами через `applyDisplaySettings()`.
- **Риск**: Низкий
- **Решение**: Удалить свойства.
- **Статус**: [ ] Не исправлено

## Низкие

### DEAD-03: ~~`components.css` и `styles.css` не включены в HTML-файлы~~
- **Статус**: [x] Проверено — файлы используются: `display.html`, `electron-control.html`, `electron-clock-widget.html` подключают их через `<link>`.
