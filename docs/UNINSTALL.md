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
   rm -rf ~/Library/Logs/timer-widget
   rm -rf ~/Library/Saved\ Application\ State/com.timer.widget.savedState
   ```

## Linux (.deb)

### Обычное удаление (сохраняет настройки)

```bash
sudo apt remove timer-widget
```

Уже при обычном удалении пакет выгружает и удаляет свой профиль AppArmor
(`/etc/apparmor.d/`, ставился на Ubuntu 24.04+ ради user namespaces песочницы)
и ссылку в `/usr/bin`. Настройки пользователей остаются.

### Полная очистка (удаляет настройки всех пользователей)

```bash
sudo apt purge timer-widget
```

При `purge` запускается скрипт [`build/linux-post-remove.sh`](../build/linux-post-remove.sh), который удаляет `~/.config/timer-widget` и `~/.cache/timer-widget` у всех пользователей системы.

AppImage больше не выпускается. Если он остался от прежних версий — удалите
файл `TimerWidget-*.AppImage`, а настройки — командой
`rm -rf ~/.config/timer-widget ~/.cache/timer-widget`.

## Что именно хранится

| Путь | Что |
|---|---|
| `*/timer-widget/Local Storage/` | Настройки цветов, стилей, масштабов; загруженные фоны и звуки (base64) |
| `*/timer-widget/Session Storage/` | Временные данные сессии |
| `*/timer-widget/Cache/` | Кеш Chromium (безопасно удалять всегда) |
| `*/timer-widget/logs/` (macOS: `~/Library/Logs/timer-widget/`) | Журнал приложения `main.log` (до 10 MB) и прежний `main.old.log` после ротации |
| `*/timer-widget/last-state.json` | Сохранённое состояние таймера для crash recovery (старше 5 минут не используется, при штатном выходе стирается) |
| `*/timer-widget/event-overrun.json` | Итог перелимита мероприятия и журнал докладов скрытого раздела «47-й этаж» |

Приложение **не хранит** личных данных, аккаунтов, паролей.
