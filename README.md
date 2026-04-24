<div align="center">

<img src="build/icon.png" width="128" alt="TimerWidget">

# TimerWidget

**Прозрачный таймер-виджет для презентаций и рабочего стола**

[![Version](https://img.shields.io/badge/v2.3.1-0a84ff?style=flat-square)](../../releases/latest)
[![Electron](https://img.shields.io/badge/Electron_41-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/Jkaotlic/timer-widget/nodejs.yml?style=flat-square&label=CI)](https://github.com/Jkaotlic/timer-widget/actions)
[![Tests](https://img.shields.io/badge/tests-126%20passing-30d158?style=flat-square)](tests/)
[![Platform](https://img.shields.io/badge/Windows_|_macOS_|_Linux-333?style=flat-square)]()
[![License](https://img.shields.io/badge/MIT-30d158?style=flat-square)](LICENSE)

[**English**](README.en.md) ·
[**Скачать**](../../releases/latest) ·
[**Changelog**](CHANGELOG.md)

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

---

## Возможности

<details open>
<summary><b>Таймер</b></summary>

<br>

- 4 стиля отображения — круговой, цифровой LED, перекидные часы, аналоговый
- Overtime с красной пульсацией, настраиваемый лимит и интервал уведомлений
- 8 пресетов от 5 до 60 минут + ручной ввод (`sec`, `min:sec`, `hr:min:sec`)
- Формат `H:MM:SS` автоматически при таймере от 1 часа
- Счёт ниже нуля с уведомлениями каждые N минут
- 30 встроенных звуков (Web Audio API) + загрузка своих `.mp3` / `.wav` / `.ogg` / `.flac` / `.webm` / `.aac`

</details>

<details>
<summary><b>4 окна</b></summary>

<br>

| Окно | Описание |
|:-----|:---------|
| **Панель управления** | Компактная 380×720 с выдвижным drawer'ом настроек (macOS-style detail pane). 4 вкладки: Виджет, Часы, Полноэкранный, Звуки |
| **Виджет** | Прозрачный, always-on-top мини-таймер для рабочего стола |
| **Часы** | Независимые часы с датой и таймзоной, 4 стиля оформления |
| **Полноэкранный** | Для проектора или второго монитора. Выбор дисплея, Alt-drag информационных блоков, кнопка «оконный режим» |

</details>

<details>
<summary><b>Оформление</b></summary>

<br>

- Apple VisionOS glassmorphism — `blur(40px) saturate(180%)`, Inter Light для таймера, JetBrains Mono для LED
- **HSV color picker** для каждого окна — полный контроль цвета, а не только пресеты
- Градиентное кольцо прогресса (systemBlue `#0a84ff` → systemGreen `#30d158`)
- Apple semantic palette: `#0a84ff` / `#30d158` / `#ff453a` / `#ff9f0a`
- Фон полноэкранного — заливка, градиент или локальный файл (`.png`, `.jpg`, `.webp` с проверкой magic bytes)

</details>

<details>
<summary><b>Управление</b></summary>

<br>

- Горячие клавиши из **любого** окна (Space, R, 1–8, W, C, D)
- **Ctrl + колесо** — масштабирование виджета / часов / дисплея (30–600%)
- **Shift + колесо** — отдельное масштабирование инфо-блоков на полноэкранном
- **Alt + перетаскивание** — свободное перемещение блоков на полноэкранном дисплее
- **Клик по проценту масштаба** — точный ввод значения, двойной клик — сброс к 100%
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
| `Ctrl` + колесо | Масштабирование виджета / часов / полноэкранного |
| `Shift` + колесо | Масштабирование инфо-блоков на полноэкранном |
| `Alt` + перетаскивание | Переместить блок на полноэкранном |

---

## Установка

Скачайте из [**Releases**](../../releases/latest):

| | Платформа | Файл |
|:--|:----------|:-----|
| <img src="https://cdn.simpleicons.org/windows/0078D6" width="16"> | Windows | `TimerWidget-Setup-*.exe` — установщик (NSIS) |
| <img src="https://cdn.simpleicons.org/windows/0078D6" width="16"> | Windows | `TimerWidget-Portable.exe` — без установки |
| <img src="https://cdn.simpleicons.org/apple/999" width="16"> | macOS Apple Silicon | `TimerWidget-*-arm64.dmg` |
| <img src="https://cdn.simpleicons.org/apple/999" width="16"> | macOS Intel | `TimerWidget-*-x64.dmg` |

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
| <img src="https://cdn.simpleicons.org/linux/FCC624" width="16"> | DEB | `TimerWidget-*-amd64.deb` |
| <img src="https://cdn.simpleicons.org/linux/FCC624" width="16"> | AppImage | `TimerWidget-*.AppImage` |

`chrome-sandbox` ставится без SUID-бита (0755), приложение запускается с `--no-sandbox` — система user namespaces не требуется.

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
| `npm test` | 126 тестов (`node --test`) |
| `npm run lint` | ESLint 9 (flat config) |
| `npm run ci` | Lint + тесты |
| `npm run screenshot` | 24 PNG-скриншота для headless визуального ревью |
| `npm run build:win` | Сборка Windows (NSIS + Portable) |
| `npm run build:mac` | Сборка macOS (DMG + ZIP, arm64 + x64) |
| `npm run build` | Сборка под текущую платформу |

### Структура проекта

```
timer-widget/
├── electron-main.js            # Main process — состояние таймера, IPC, окна
├── electron-control.html       # Панель управления (4 вкладки + drawer)
├── electron-widget.html        # Виджет (transparent, frameless, always-on-top)
├── electron-clock-widget.html  # Часы (transparent, frameless, always-on-top)
├── display.html                # Полноэкранный режим (HTML)
├── display-script.js           # Полноэкранный режим (логика DisplayTimer)
├── timer-engine.js             # Чистая логика таймера (testable)
├── recovery.js                 # Восстановление состояния после crash'а
├── preload.js                  # IPC bridge с whitelist каналов
├── ipc-compat.js               # Совместимость ipcRenderer → electronAPI
├── channel-validator.js        # Whitelist IPC каналов
├── constants.js                # Константы, IPC каналы, ключи storage
├── utils.js                    # formatTime, parseTime, debounce, safelySendToWindow
├── security.js                 # Валидация: data URL, изображения, escapeHTML
├── design-tokens.css           # CSS custom properties (палитра, тени, блюры, тайминги)
├── components.css              # Shared компонентные стили
├── build/
│   ├── icon.png                # Иконка приложения (1024×1024)
│   ├── after-pack.js           # electron-builder hook
│   └── linux-after-install.sh  # chmod 0755 chrome-sandbox без SUID
├── scripts/
│   ├── run-electron.js         # Wrapper: сбрасывает ELECTRON_RUN_AS_NODE
│   └── screenshot-runner.js    # Headless harness для визуального ревью
└── tests/                      # 126 тестов (10+ файлов)
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
│  (transparent)   │          │     preload.js           │
├─────────────────┤          │  - Channel whitelist     │
│  Display         │◄────────►│  - Direction validation  │
│  (fullscreen)    │          └──────────────────────────┘
└─────────────────┘
```

**Ключевые принципы:**

- **Main process — единственный источник правды.** Таймер тикает только в main, все окна получают состояние через `timer-state` каждую секунду
- **Per-window IPC-каналы.** Цвета, стили и настройки отправляются в конкретное окно (`widget-colors-update`, `clock-colors-update`, `display-colors-update`), а не глобально — чтобы избежать «перетекания» цветов между окнами
- **Монотонная синхронизация.** `updateCounter` гарантирует порядок обновлений без зависимости от системных часов
- **Context isolation + sandbox** на всех окнах. Рендереры не имеют доступа к Node.js API
- **DevTools отключены** во всех production-окнах (`devTools: false`)

---

## Безопасность

<details>
<summary>Подробнее о мерах безопасности</summary>

<br>

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` на всех окнах
- `devTools: false` — консоль разработчика недоступна в production
- IPC whitelist с валидацией направления (send / receive) в `preload.js` и `channel-validator.js`
- `hardenWindow()` блокирует навигацию на не-file:// URL и запрещает `window.open`
- **Никакой загрузки по HTTP/HTTPS.** Фоновые изображения принимаются только как локальные `data:` URL
- Числовые IPC-инпуты: проверка на `NaN`, `Infinity`, min/max bounds
- Изображения: валидация MIME + magic bytes (WebP проверяет RIFF+WEBP сигнатуру, ≤10 MB)
- Аудио: MIME + magic bytes для MP3 / WAV / OGG / FLAC / WebM / AAC, ≤5 MB
- SVG заблокирован в data URL (вектор XSS)
- CSS injection: цвета валидируются regex, URL проверяются через `URL()` конструктор
- Chromium Component Updater выключен (`disable-component-update` + `disable-features=ChromeVariations,OptimizationHints`) — приложение не ходит в сеть
- electron-builder `afterPack` очищает `LICENSES.chromium.html` от внешнего политического контента в зависимостях
- На Linux `chrome-sandbox` устанавливается без SUID-бита (0755)

</details>

---

## FAQ

<details>
<summary><b>Как изменить масштаб виджета?</b></summary>

`Ctrl + колесо` мыши — быстрое масштабирование (30–600%). Клик по цифре процента — ввод точного значения. Двойной клик — сброс к 100%. Работает на виджете, часах и полноэкранном.

</details>

<details>
<summary><b>Как вывести таймер на второй монитор?</b></summary>

Нажмите `D` или откройте вкладку «Полноэкранный» → выберите нужный монитор из списка. Выбор запоминается — следующее открытие пойдёт на тот же монитор.

</details>

<details>
<summary><b>Таймер показывает отрицательное время?</b></summary>

Это режим Overtime — таймер продолжает считать после нуля. Настраивается в панели: лимит переработки и интервал уведомлений. `R` — сброс.

</details>

<details>
<summary><b>Можно добавить свой звук?</b></summary>

Да. Вкладка «Звуки» → загрузите `.mp3`, `.wav`, `.ogg`, `.flac`, `.webm` или `.aac` файл до 5 МБ. Назначьте его на любое событие (старт, минута, финиш, overtime).

</details>

<details>
<summary><b>Работает ли без интернета?</b></summary>

Да, полностью оффлайн. Все шрифты локальные (`fonts/`), звуки синтезируются через Web Audio API, Component Updater Chromium выключен — приложение ни при каких обстоятельствах не обращается к сети.

</details>

<details>
<summary><b>Как переместить блоки на полноэкранном дисплее?</b></summary>

Зажмите `Alt` и перетащите любой информационный блок (время, статус, текущее время) в нужную позицию. Позиции сохраняются в localStorage между сессиями.

</details>

<details>
<summary><b>Почему панель управления такая узкая?</b></summary>

В v2.3 панель стала компактной (380 px), настройки переехали в **drawer** — выдвижную боковую панель. Клик по иконке шестерёнки или по нужной вкладке раскрывает drawer рядом с панелью, как detail pane в macOS Finder. При закрытии drawer'а панель возвращается к компактному размеру.

</details>

---

## Contributing

1. Fork репозитория
2. Создайте ветку (`git checkout -b feature/my-feature`)
3. Убедитесь, что `npm run ci` проходит (lint + 126 тестов)
4. Создайте Pull Request

Баги и предложения — в [Issues](../../issues). Полная история изменений — в [CHANGELOG.md](CHANGELOG.md).

---

<div align="center">

**Electron 41** · **Node.js 22** · **Vanilla JS** · **Web Audio API** · **126 тестов** · **GitHub Actions CI**

MIT © 2024–2026 [Jkaotlic](https://github.com/Jkaotlic)

[![GitHub stars](https://img.shields.io/github/stars/Jkaotlic/timer-widget?style=social)](../../stargazers)
</div>
