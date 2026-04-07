<div align="center">

# TimerWidget 2.0

### Прозрачный таймер для презентаций и рабочего стола

![Version](https://img.shields.io/badge/v2.0.0-0a84ff?style=flat-square)
![Electron](https://img.shields.io/badge/Electron_41-47848F?style=flat-square&logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/Windows_|_macOS_|_Linux-333?style=flat-square)
![License](https://img.shields.io/badge/MIT-30d158?style=flat-square)
![Tests](https://img.shields.io/badge/70_tests-passing-30d158?style=flat-square)

<br>

<img src="screenshots/preview.png" alt="TimerWidget" width="800">

<br>

Всегда поверх окон. 4 стиля. Масштабирование жестами.<br>
Работает без интернета. Vanilla JS, без фреймворков.

<br>

[**Скачать последнюю версию**](../../releases/latest)

<br>

</div>

---

## Что умеет

<table>
<tr>
<td width="50%" valign="top">

### Таймер
- 4 стиля отображения — круговой, цифровой LED, перекидные часы, аналоговый
- Overtime с красной пульсацией и настраиваемым лимитом
- 8 пресетов от 5 минут до 1 часа
- Формат H:MM:SS при таймере больше часа
- Счёт ниже нуля с уведомлениями каждые N минут

### Окна
- **Панель управления** — все настройки, 4 вкладки
- **Виджет** — прозрачный, always-on-top, для рабочего стола
- **Часы** — отдельные часы с датой и таймзоной
- **Полноэкранный** — для проектора / второго монитора

</td>
<td width="50%" valign="top">

### Управление
- Горячие клавиши из любого окна
- **Ctrl + слайдер** — масштаб 30–600%
- **Alt + drag** — перемещение блоков на экране
- Все позиции и масштабы сохраняются между сессиями
- Выбор монитора для полноэкранного режима

### Звуки и оформление
- 20 встроенных звуков на Web Audio API
- Загрузка своих звуков (mp3, wav, ogg)
- Apple VisionOS glassmorphism
- Настраиваемые цвета для каждого окна отдельно
- Фон: заливка, градиент, картинка по URL или файлу

</td>
</tr>
</table>

---

## Горячие клавиши

Работают из **любого** окна приложения.

| Клавиша | Действие |
|:--------|:---------|
| `Space` | Старт / Пауза |
| `R` | Сброс |
| `1` `2` `3` `4` `5` `6` `7` `8` | Пресеты: 5, 10, 15, 20, 25, 30, 45, 60 мин |
| `W` | Виджет вкл/выкл |
| `C` | Часы вкл/выкл |
| `D` | Полноэкранный режим вкл/выкл |
| `Esc` | Закрыть текущее окно |
| `Ctrl` (зажать) | Показать слайдер масштабирования |
| `Alt` + перетаскивание | Переместить блок времени (полноэкранный) |
| `F1` | Справка |

---

## Установка

Скачайте из [**Releases**](../../releases/latest):

| | Платформа | Файл |
|:--|:----------|:-----|
| <img src="https://cdn.simpleicons.org/windows/0078D6" width="16"> | Windows | `TimerWidget-Setup-2.0.0.exe` — установщик |
| <img src="https://cdn.simpleicons.org/windows/0078D6" width="16"> | Windows | `TimerWidget-Portable.exe` — без установки |
| <img src="https://cdn.simpleicons.org/apple/999" width="16"> | macOS Apple Silicon | `TimerWidget-2.0.0-arm64.dmg` |
| <img src="https://cdn.simpleicons.org/apple/999" width="16"> | macOS Intel | `TimerWidget-2.0.0-x64.dmg` |
| <img src="https://cdn.simpleicons.org/linux/FCC624" width="16"> | Linux | `TimerWidget-2.0.0-amd64.deb` |
| <img src="https://cdn.simpleicons.org/linux/FCC624" width="16"> | Linux | `TimerWidget-2.0.0-x86_64.AppImage` |

---

## Для разработчиков

```bash
git clone https://github.com/Jkaotlic/timer-widget.git
cd timer-widget
npm install
npm start            # запуск
npm run dev          # запуск с DevTools
npm test             # 70 тестов (node --test)
npm run lint         # ESLint 9
npm run build:win    # сборка Windows
npm run build:mac    # сборка macOS
```

### Архитектура

```
electron-main.js          — главный процесс, единый источник состояния таймера
electron-control.html     — панель управления (~5000 строк, inline CSS/JS)
electron-widget.html      — виджет таймера (transparent, frameless, always-on-top)
electron-clock-widget.html — часы (transparent, frameless, always-on-top)
display.html + display-script.js — полноэкранный режим
constants.js / utils.js / security.js — shared modules
```

4 окна общаются через IPC с whitelist-валидацией каналов. Context isolation + sandbox на всех окнах.

---

<div align="center">

**Electron 41** · **Node.js 22** · **Vanilla JS** · **Web Audio API** · **70 тестов** · **GitHub Actions CI**

<br>

MIT © 2024–2026 [Jkaotlic](https://github.com/Jkaotlic)

<br>

[![GitHub stars](https://img.shields.io/github/stars/Jkaotlic/timer-widget?style=social)](../../stargazers)

</div>
