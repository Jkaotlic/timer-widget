# Uninstall / Полное удаление

## Windows (NSIS installer)

При удалении через "Панель управления → Программы" или через `Uninstall TimerWidget.exe` инсталлятор спросит:

> Удалить также настройки пользователя (таймеры, цвета, звуки)?

- **Да** — удалит `%APPDATA%\timer-widget` и `%LOCALAPPDATA%\timer-widget`
- **Нет** (по умолчанию) — оставит настройки для будущей переустановки

### Ручная очистка

Если выбрали "Нет", но позже захотели полностью очистить:

```cmd
rmdir /s /q "%APPDATA%\timer-widget"
rmdir /s /q "%LOCALAPPDATA%\timer-widget"
```

## macOS

macOS DMG не поддерживает кастомную логику удаления. Шаги:

1. Перетащите `TimerWidget.app` в Корзину
2. Для полной очистки удалите:
   ```bash
   rm -rf ~/Library/Application\ Support/timer-widget
   rm -rf ~/Library/Preferences/com.timer.widget.plist
   rm -rf ~/Library/Caches/com.timer.widget
   rm -rf ~/Library/Logs/TimerWidget
   rm -rf ~/Library/Saved\ Application\ State/com.timer.widget.savedState
   ```

## Linux (.deb)

### Обычное удаление (сохраняет настройки)

```bash
sudo apt remove timer-widget
```

### Полная очистка (удаляет настройки всех пользователей)

```bash
sudo apt purge timer-widget
```

При `purge` запускается скрипт [`build/linux-post-remove.sh`](../build/linux-post-remove.sh), который удаляет `~/.config/timer-widget` и `~/.cache/timer-widget` у всех пользователей системы.

## Linux (AppImage)

1. Удалите файл `TimerWidget-*.AppImage`
2. Настройки в `~/.config/timer-widget` и `~/.cache/timer-widget` удалите вручную:
   ```bash
   rm -rf ~/.config/timer-widget ~/.cache/timer-widget
   ```

## Что именно хранится

| Путь | Что |
|---|---|
| `*/timer-widget/Local Storage/` | Настройки цветов, стилей, масштабов; загруженные фоны и звуки (base64) |
| `*/timer-widget/Session Storage/` | Временные данные сессии |
| `*/timer-widget/Cache/` | Кеш Chromium (безопасно удалять всегда) |
| `*/TimerWidget/logs/` | Лог-файлы приложения (до 30 MB, ротируются) |
| `*/timer-widget/last-state.json` | Сохранённое состояние таймера для crash recovery |

Приложение **не хранит** личных данных, аккаунтов, паролей.
