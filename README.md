<div align="center">

<img src="build/icon.png" width="128" alt="TimerWidget">

# TimerWidget

**Прозрачный таймер для презентаций и рабочего стола**

[![Version](https://img.shields.io/badge/v2.2.2-0a84ff?style=flat-square)](../../releases/latest)
[![Electron](https://img.shields.io/badge/Electron_41-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/Jkaotlic/timer-widget/nodejs.yml?style=flat-square&label=CI)](https://github.com/Jkaotlic/timer-widget/actions)
[![Platform](https://img.shields.io/badge/Windows_|_macOS_|_Linux-333?style=flat-square)]()
[![License](https://img.shields.io/badge/MIT-30d158?style=flat-square)](LICENSE)

[**English**](README.en.md) ·
[**Скачать**](../../releases/latest)

</div>

---

## Содержание

- [Возможности](#возможности)
- [Горячие клавиши](#горячие-клавиши)
- [Установка](#установка)
- [Для разработчиков](#для-разработчиков)
- [Архитектура](#архитектура)
- [Безопасность](#безопасность)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Changelog](#changelog)

---

## Возможности

<details open>
<summary><b>Таймер</b></summary>

<br>

- 4 стиля отображения — круговой, цифровой LED, перекидные часы, аналоговый
- Overtime с красной пульсацией и настраиваемым лимитом
- 8 пресетов от 5 до 60 минут
- Формат `H:MM:SS` при таймере больше часа
- Счёт ниже нуля с уведомлениями каждые N минут
- 30 встроенных звуков (Web Audio API) + загрузка своих mp3/wav/ogg

</details>

<details>
<summary><b>4 окна</b></summary>

<br>

| Окно | Описание |
|:-----|:---------|
| **Панель управления** | Все настройки в 4 вкладках: Виджет, Часы, Полноэкранный, Звуки |
| **Виджет** | Прозрачный, always-on-top мини-таймер для рабочего стола |
| **Часы** | Независимые часы с датой и таймзоной |
| **Полноэкранный** | Для проектора или второго монитора с выбором дисплея |

</details>

<details>
<summary><b>Оформление</b></summary>

<br>

- Apple VisionOS glassmorphism — `blur(40px) saturate(180%)`
- Настраиваемые цвета для каждого окна отдельно
- Градиентное кольцо прогресса (#0a84ff → #30d158)
- Фон полноэкранного: заливка, градиент, картинка по URL или файлу
- Шрифты: Inter Light для таймера, JetBrains Mono для LED

</details>

<details>
<summary><b>Управление</b></summary>

<br>

- Горячие клавиши из **любого** окна (Space, R, 1-8, W, C, D)
- Слайдер масштабирования 30–600% (виджет, часы, полноэкранный), **Ctrl+колесо** для быстрого масштаба
- **Alt + перетаскивание** — свободное перемещение блоков на полноэкранном дисплее
- Все позиции, масштабы и настройки сохраняются между сессиями
- Выбор монитора для полноэкранного режима

</details>

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
| `Ctrl` + колесо | Масштабирование виджета/часов/дисплея |
| `Alt` + перетаскивание | Переместить блок (полноэкранный режим) |

---

## Установка

Скачайте из [**Releases**](../../releases/latest):

| | Платформа | Файл |
|:--|:----------|:-----|
| <img src="https://cdn.simpleicons.org/windows/0078D6" width="16"> | Windows | `TimerWidget-Setup.exe` — установщик |
| <img src="https://cdn.simpleicons.org/windows/0078D6" width="16"> | Windows | `TimerWidget-Portable.exe` — без установки |
| <img src="https://cdn.simpleicons.org/apple/999" width="16"> | macOS Apple Silicon | `TimerWidget-arm64.dmg` |
| <img src="https://cdn.simpleicons.org/apple/999" width="16"> | macOS Intel | `TimerWidget-x64.dmg` |

> **macOS**: приложение не подписано Apple Developer сертификатом. При первом запуске:
> 1. Откройте DMG и перетащите приложение в Applications
> 2. **Правый клик** на TimerWidget → **Открыть** → подтвердите запуск
>
> Или в терминале: `xattr -cr /Applications/TimerWidget.app`

<details>
<summary>Linux</summary>

<br>

| | Формат | Файл |
|:--|:-------|:-----|
| <img src="https://cdn.simpleicons.org/linux/FCC624" width="16"> | DEB | `TimerWidget-amd64.deb` |
| <img src="https://cdn.simpleicons.org/linux/FCC624" width="16"> | AppImage | `TimerWidget-x86_64.AppImage` |

</details>

---

## Для разработчиков

```bash
git clone https://github.com/Jkaotlic/timer-widget.git
cd timer-widget
npm install
npm start
```

| Команда | Описание |
|:--------|:---------|
| `npm start` | Запуск приложения |
| `npm run dev` | Запуск с DevTools |
| `npm test` | 70 тестов (node --test) |
| `npm run lint` | ESLint 9 |
| `npm run ci` | Lint + тесты |
| `npm run build:win` | Сборка Windows (NSIS + Portable) |
| `npm run build:mac` | Сборка macOS (DMG + ZIP) |

### Структура проекта

```
timer-widget/
├── electron-main.js            # Main process — состояние таймера, IPC
├── electron-control.html       # Панель управления (4 вкладки, ~5000 строк)
├── electron-widget.html        # Виджет (transparent, frameless, always-on-top)
├── electron-clock-widget.html  # Часы (transparent, frameless, always-on-top)
├── display.html                # Полноэкранный режим (HTML)
├── display-script.js           # Полноэкранный режим (логика DisplayTimer)
├── preload.js                  # IPC bridge с whitelist каналов
├── ipc-compat.js               # Совместимость ipcRenderer → electronAPI
├── constants.js                # Константы, IPC каналы, ключи хранилища
├── utils.js                    # formatTime, parseTime, debounce, safelySendToWindow
├── security.js                 # Валидация: URL, DataURL, изображения, escapeHTML
├── channel-validator.js        # Whitelist IPC каналов (дублируется в preload.js)
└── tests/                      # 70 тестов (9 файлов)
```

---

## Архитектура

```
┌─────────────────┐          ┌──────────────────────────┐
│  Control Panel   │◄────────►│                          │
│  (settings, UI)  │   IPC    │     electron-main.js     │
├─────────────────┤          │                          │
│  Widget          │◄────────►│  - Timer state (truth)   │
│  (transparent)   │          │  - Window management     │
├─────────────────┤          │  - IPC routing            │
│  Clock           │◄────────►│                          │
│  (transparent)   │          │     preload.js            │
├─────────────────┤          │  - Channel whitelist      │
│  Display         │◄────────►│  - Direction validation   │
│  (fullscreen)    │          └──────────────────────────┘
└─────────────────┘
```

**Ключевые принципы:**

- **Main process — единственный источник правды.** Таймер тикает только в main, все окна получают состояние через `timer-state` каждую секунду
- **Per-window IPC каналы.** Цвета, стили и настройки отправляются в конкретное окно (`widget-colors-update`, `clock-colors-update`, `display-colors-update`), а не глобально
- **Монотонная синхронизация.** `updateCounter` гарантирует порядок обновлений без зависимости от системных часов
- **Context isolation + sandbox** на всех окнах. Рендереры не имеют доступа к Node.js API

---

## Безопасность

<details>
<summary>Подробнее о мерах безопасности</summary>

<br>

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` на всех окнах
- IPC whitelist с валидацией направления (send / receive) в `preload.js` и `channel-validator.js`
- `hardenWindow()` блокирует навигацию на не-file:// URL и запрещает `window.open`
- Числовые инпуты: проверка на `NaN`, `Infinity`, min/max bounds
- Изображения: валидация MIME-типа + magic bytes (WebP проверяет RIFF+WEBP сигнатуру)
- SVG заблокирован в data URL (вектор XSS)
- CSS injection: цвета валидируются regex, URL проверяются через `URL()` конструктор
- Аудио: пустой `file.type` отклоняется

</details>

---

## FAQ

<details>
<summary><b>Как изменить масштаб виджета?</b></summary>

Используйте слайдер внизу окна (30–600%) или `Ctrl+колесо мыши`. Двойной клик на слайдере — сброс к 100%. Работает на виджете, часах и полноэкранном дисплее.

</details>

<details>
<summary><b>Как вывести таймер на второй монитор?</b></summary>

Нажмите `D` или используйте настройки во вкладке «Полноэкранный» → выберите нужный монитор из списка.

</details>

<details>
<summary><b>Таймер показывает отрицательное время?</b></summary>

Это режим Overtime — таймер продолжает считать после нуля. Настраивается в панели управления: лимит переработки и интервал уведомлений. Нажмите `R` для сброса.

</details>

<details>
<summary><b>Можно добавить свой звук?</b></summary>

Да. Вкладка «Звуки» → загрузите mp3, wav или ogg файл. Назначьте его на любое событие (старт, минута, финиш, overtime).

</details>

<details>
<summary><b>Работает ли без интернета?</b></summary>

Да, полностью оффлайн. Все звуки синтезируются через Web Audio API, шрифты кешируются после первой загрузки.

</details>

<details>
<summary><b>Как переместить блоки на полноэкранном дисплее?</b></summary>

Зажмите `Alt` и перетащите любой информационный блок (время, статус, текущее время) в нужную позицию. Позиции сохраняются между сессиями.

</details>

---

## Contributing

1. Fork репозитория
2. Создайте ветку (`git checkout -b feature/my-feature`)
3. Убедитесь что тесты и линтер проходят: `npm run ci`
4. Создайте Pull Request

Баги и предложения — в [Issues](../../issues).

---

## Changelog

### v2.0.0

- Apple VisionOS glassmorphism — полный редизайн всех окон
- 4 стиля таймера во всех окнах (круговой, LED, flip, аналоговый)
- Слайдер масштабирования 30–600% + Ctrl+колесо
- Alt+drag перемещение блоков на полноэкранном дисплее
- Глобальные горячие клавиши из любого окна
- 20 встроенных звуков на Web Audio API
- Per-window настройки цветов и стилей
- Overtime с пульсацией и H:MM:SS формат

[Все релизы →](../../releases)

---

<div align="center">

**Electron 41** · **Node.js 22** · **Vanilla JS** · **Web Audio API** · **70 тестов** · **GitHub Actions CI**

MIT © 2024–2026 [Jkaotlic](https://github.com/Jkaotlic)

[![GitHub stars](https://img.shields.io/github/stars/Jkaotlic/timer-widget?style=social)](../../stargazers)
</div>
