# TimerWidget

<div align="center">

![Version](https://img.shields.io/badge/Version-2.0.0-0a84ff?style=for-the-badge)
![Electron](https://img.shields.io/badge/Electron-41-47848F?style=for-the-badge&logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D6?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-30d158?style=for-the-badge)

**Прозрачный таймер-виджет для рабочего стола**

<img src="screenshots/preview.png" alt="TimerWidget preview" width="720">

</div>

---

## Features

- :art: **4 стиля** — круговой, цифровой LED, перекидные часы, аналоговый
- :sparkles: **Apple VisionOS glassmorphism** — blur, gradient ring `#0a84ff` → `#30d158`, Inter Light
- :window: **4 окна** — панель управления, виджет (always-on-top), часы, полноэкранный режим
- :mag: **Ctrl + слайдер** масштабирование 30–600%
- :point_up_2: **Alt + перетаскивание** блоков в полноэкранном режиме
- :keyboard: **Горячие клавиши** из любого окна — Space, R, 1-8, W/C/D
- :speaker: **20 встроенных звуков** через Web Audio API (без аудиофайлов, синтез на осцилляторах)
- :desktop_computer: **Мультимонитор** — выбор экрана для полноэкранного режима
- :red_circle: **Overtime режим** с красной пульсацией и настраиваемым лимитом
- :zap: **Electron 41, vanilla JS** — без фреймворков, без бандлера

---

## Install

Скачайте нужную версию из [**Releases**](../../releases/latest):

| Платформа | Файл | Тип |
|-----------|-------|-----|
| Windows | `TimerWidget-Setup-2.0.0.exe` | Установщик (NSIS) |
| Windows | `TimerWidget-Portable.exe` | Портативная версия |
| macOS Intel | `TimerWidget-2.0.0-x64.dmg` | DMG |
| macOS ARM | `TimerWidget-2.0.0-arm64.dmg` | DMG |
| Linux | `TimerWidget-2.0.0-amd64.deb` | DEB |
| Linux | `TimerWidget-2.0.0-x86_64.AppImage` | AppImage |

---

## Development

```bash
git clone https://github.com/Jkaotlic/timer-widget.git
cd timer-widget
npm install

npm start          # Запуск приложения
npm run dev        # Запуск с DevTools
npm test           # Запуск тестов (70 тестов, node --test)
npm run lint       # ESLint
npm run ci         # lint + test
npm run build      # Сборка для текущей платформы
npm run build:win  # Сборка для Windows
npm run build:mac  # Сборка для macOS
```

---

## Keyboard Shortcuts

| Клавиша | Действие |
|:-------:|----------|
| `Space` | Старт / Пауза |
| `R` | Сброс таймера |
| `1` – `8` | Быстрые пресеты |
| `W` | Открыть/закрыть виджет |
| `C` | Открыть/закрыть часы |
| `D` | Открыть/закрыть полноэкранный режим |
| `Esc` | Закрыть полноэкранный режим |
| `Ctrl` + колесо | Масштабирование виджета |
| `Alt` + перетаскивание | Перемещение блоков на дисплее |

---

## Tech Stack

| | |
|---|---|
| Runtime | Electron 41, Node.js 22 |
| Language | Vanilla JavaScript (ES2022) |
| Audio | Web Audio API — 20 синтезированных звуков |
| UI | Inline HTML/CSS/JS, Apple VisionOS glassmorphism |
| Tests | Node.js built-in test runner, 70 тестов |
| CI | GitHub Actions — Node 22, ubuntu-latest |
| Lint | ESLint 9 (flat config) |

---

## License

MIT © 2024–2026 [Jkaotlic](https://github.com/Jkaotlic)

---

<div align="center">

:star: **Поставьте звезду, если проект полезен!** :star:

[![GitHub stars](https://img.shields.io/github/stars/Jkaotlic/timer-widget?style=social)](../../stargazers)

</div>
