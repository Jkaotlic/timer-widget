# Анализ безопасности Timer Widget v1.2.9

## Критические

_Нет критических уязвимостей._

## Средние

### SEC-01: CSS URL injection в display-script.js
- **Файл**: `display-script.js:576`
- **Проблема**: `applyBackground()` при mode=image делает `replace(/'/g, '')` и вставляет URL в `url('...')`. Хотя `_isSafeUrl()` проверяет протокол через `new URL()`, правильнее использовать уже существующий `SecurityUtils.validateImageSource()` для единообразия и двойной защиты.
- **Риск**: Средний — `_isSafeUrl` блокирует опасные протоколы, но подход отличается от остального кода.
- **Решение**: Заменить ручную санитизацию на `SecurityUtils.validateImageSource()`.
- **Статус**: [ ] Не исправлено

### SEC-02: localStorage QuotaExceededError не обрабатывается
- **Файл**: `electron-control.html` (функция загрузки фона, FileReader.onload)
- **Проблема**: При загрузке большого изображения base64 строка может превысить лимит localStorage (5-10MB). `QuotaExceededError` не перехватывается.
- **Риск**: Средний — приложение не упадёт, но пользователь не увидит ошибку, фон не сохранится.
- **Решение**: Обернуть `localStorage.setItem` в try-catch с уведомлением пользователя.
- **Статус**: [ ] Не исправлено

### SEC-03: Цвет rgba() не валидирует диапазоны числовых значений
- **Файл**: `electron-widget.html`, `electron-clock-widget.html`, `display-script.js` (функция `isSafeColor`/`_isSafeColor`)
- **Проблема**: Regex `/^rgba?\([\d,.\s%]+\)$/` допускает значения за пределами 0-255 для RGB и 0-1 для alpha. Практический риск минимален (CSS игнорирует невалидные значения), но противоречит принципу строгой валидации.
- **Риск**: Низкий — CSS сам отвергает невалидные цвета, XSS через CSS custom properties невозможен.
- **Решение**: Усилить regex или добавить числовую валидацию.
- **Статус**: [ ] Не исправлено

## Низкие

### SEC-04: Нет схемной валидации объектов из localStorage
- **Файл**: `electron-control.html`, `display-script.js` (множественные `safeJSONParse` вызовы)
- **Проблема**: `safeJSONParse()` защищает от невалидного JSON, но не проверяет структуру распарсенного объекта. Теоретически, вредоносный скрипт мог бы записать в localStorage неожиданную структуру.
- **Риск**: Низкий — Electron приложение, доступ к localStorage только изнутри.
- **Решение**: Для критичных настроек (bgSettings) добавить базовую проверку полей.
- **Статус**: [ ] Не исправлено

## Позитивные аспекты безопасности

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` на всех окнах
- `hardenWindow()` блокирует навигацию на не-file:// URL и запрещает `window.open`
- IPC whitelist в preload.js с разделением send/receive
- SVG исключён из допустимых data URL (XSS вектор)
- `escapeHTML()` экранирует все опасные символы
- Все числовые IPC параметры проверяются через `Number.isFinite()`
- `safeSetBackgroundImage()` использует `validateImageSource()` с полной проверкой
