# Timer Widget - Техническая документация

> Версия: 1.2.2
> Дата обновления: 2026-01-20

## Оглавление

1. [Обзор проекта](#обзор-проекта)
2. [Архитектура](#архитектура)
3. [Структура файлов](#структура-файлов)
4. [Main Process](#main-process)
5. [Renderer Processes](#renderer-processes)
6. [IPC Communication](#ipc-communication)
7. [Функциональность](#функциональность)
8. [Сборка и развертывание](#сборка-и-развертывание)
9. [Настройки и кастомизация](#настройки-и-кастомизация)

---

## Обзор проекта

**Timer Widget** - кроссплатформенное Electron-приложение для отслеживания времени с расширенными возможностями кастомизации и множественными режимами отображения.

### Ключевые характеристики

- **Платформа:** Electron v33.2.0
- **Язык:** Vanilla JavaScript (без фреймворков)
- **Поддерживаемые ОС:** Windows, macOS
- **Архитектура:** Multi-window Electron app с IPC синхронизацией

### Основные технологии

```
Electron 33.2.0          - Core framework
Electron Builder 25.1.8  - Build and packaging
HTML5/CSS3              - UI rendering
Node.js                 - Main process runtime
```

---

## Архитектура

### Общая схема

```
┌─────────────────────────────────────────────────┐
│           MAIN PROCESS (electron-main.js)       │
│                                                 │
│  - Global Timer State Management               │
│  - Window Management (4 windows)               │
│  - IPC Event Hub                               │
│  - Display/Monitor Management                  │
└───────────┬─────────────────────────────────────┘
            │ IPC Events
            │
    ┌───────┴───────┬────────────┬────────────┐
    │               │            │            │
┌───▼────┐   ┌─────▼─────┐  ┌──▼───┐   ┌────▼─────┐
│Control │   │  Widget   │  │Clock │   │ Display  │
│Window  │   │  Window   │  │Widget│   │ Window   │
└────────┘   └───────────┘  └──────┘   └──────────┘
RENDERER     RENDERER       RENDERER    RENDERER
PROCESSES    PROCESSES      PROCESSES   PROCESSES
```

### Процессы

#### Main Process (Node.js)
- Управление жизненным циклом приложения
- Синхронизация состояния между окнами
- Управление таймером (глобальное состояние)
- Создание и управление окнами

#### Renderer Processes (Chromium)
- Независимые HTML/JS/CSS окна
- UI рендеринг и взаимодействие с пользователем
- LocalStorage для локальных настроек
- IPC для связи с main process

---

## Структура файлов

### Дерево проекта

```
timer-widget/
├── electron-main.js              # Main process (514 строк)
│
├── RENDERER PROCESSES:
├── electron-control.html         # Панель управления (3395 строк)
├── electron-widget.html          # Мини-виджет таймера (1745 строк)
├── electron-clock-widget.html    # Виджет часов (1900 строк)
├── display.html                  # Полноэкранный режим (1428 строк)
├── display-script.js             # Логика дисплея (793 строки)
│
├── styles.css                    # Глобальные стили (326 строк)
├── package.json                  # Конфигурация проекта
├── README.md                     # Документация пользователя
│
├── build/
│   └── icon.png                  # Иконка приложения (512x512)
│
├── sounds/                       # Звуковые уведомления
│   ├── bell.mp3
│   ├── gong.mp3
│   └── ... (12 встроенных звуков)
│
├── .github/
│   └── workflows/
│       └── build.yml            # CI/CD для GitHub Actions
│
└── dist/                        # Собранные приложения (не в git)
```

### Размеры компонентов

| Файл | Размер | Строк | Назначение |
|------|--------|-------|-----------|
| electron-control.html | 143 KB | 3395 | Главное окно управления |
| electron-widget.html | 68 KB | 1745 | Мини-виджет таймера |
| electron-clock-widget.html | 75 KB | 1900 | Виджет часов |
| display.html | 55 KB | 1428 | Полноэкранное отображение |
| display-script.js | 32 KB | 793 | Логика полноэкранного режима |
| electron-main.js | 16 KB | 514 | Основной процесс |
| styles.css | 6 KB | 326 | Глобальные стили |

---

## Main Process

### Файл: [electron-main.js](electron-main.js)

#### Глобальное состояние

```javascript
// Состояние таймера
const timerState = {
  totalSeconds: 0,        // Установленное время (общее)
  remainingSeconds: 0,    // Оставшееся время
  isRunning: false,       // Таймер запущен
  isPaused: false,        // На паузе
  finished: false,        // Завершен
  timestamp: Date.now()   // Временная метка последнего обновления
};

// Конфигурация таймера
const timerConfig = {
  allowNegative: false,      // Разрешить отрицательное время
  overrunLimitSeconds: 0     // Лимит переработки (секунды)
};
```

#### Управление окнами

**1. Control Window** - Панель управления
```javascript
// Размер: 420x500px (минимум 350x300px)
// Ресайз: включен
// Роль: центральное управление таймером
```

**2. Widget Window** - Мини-виджет таймера
```javascript
// Размер: 250x280px (минимум 120x140px)
// Transparent: true
// AlwaysOnTop: true
// Frame: false (без рамки)
// Позиция: правый верхний угол экрана
```

**3. Display Window** - Полноэкранный режим
```javascript
// Fullscreen: true
// Поддержка множественных мониторов
// Выбор монитора через display ID
```

**4. Clock Widget Window** - Виджет часов
```javascript
// Размер: 220x220px
// Transparent: true
// AlwaysOnTop: true
// Frame: false
```

#### Ключевые функции

##### Управление таймером
```javascript
// Запуск таймера
function startTimer()

// Пауза
function pauseTimer()

// Сброс
function resetTimer()

// Установка времени
function setTimer(totalSeconds)

// Корректировка времени
function adjustTimer(secondsToAdd)
```

##### Трансляция состояния
```javascript
// Отправка состояния всем окнам
function broadcastTimerState()

// Отправка обновления цветов
function broadcastColors(colors)

// Отправка настроек дисплея
function broadcastDisplaySettings(settings)
```

#### IPC Handlers (Main → Renderer)

```javascript
// Команды таймера
ipcMain.on('timer-command', (event, { type, value })
ipcMain.on('timer-control', (event, { action })

// Управление окнами
ipcMain.on('open-widget')
ipcMain.on('close-widget')
ipcMain.on('open-display')
ipcMain.on('close-display')
ipcMain.on('open-clock-widget')
ipcMain.on('close-clock-widget')

// Настройки виджетов
ipcMain.on('widget-set-position', (event, { x, y })
ipcMain.on('widget-set-opacity', (event, { opacity })
ipcMain.on('widget-resize', (event, { width, height })

// Обновления настроек
ipcMain.on('colors-update', (event, colors)
ipcMain.on('display-settings-update', (event, settings)
```

---

## Renderer Processes

### 1. Control Window - [electron-control.html](electron-control.html)

#### Назначение
Главное окно для управления таймером и настройками.

#### Основные секции

**Tabs (Вкладки):**
1. **Timer** - Управление таймером
   - Установка времени (часы, минуты, секунды)
   - Кнопки: Start, Pause, Reset
   - Быстрые пресеты: 5m, 10m, 15m, 30m, 45m, 60m

2. **Display** - Настройки полноэкранного режима
   - Выбор стиля (circle, digital, flip, analog)
   - Информационные блоки
   - Выбор монитора
   - Управление open/close

3. **Widgets** - Настройка виджетов
   - Timer Widget (мини-таймер)
   - Clock Widget (часы)
   - Управление позицией, размером, прозрачностью

4. **Style** - Кастомизация внешнего вида
   - Готовые темы (6 штук)
   - Пользовательские цвета
   - Градиенты
   - Фоновые изображения (URL или локальные)

5. **Sound** - Звуковые уведомления
   - 12 встроенных звуков
   - Загрузка своих (MP3, WAV, OGG до 5MB)
   - Звук при завершении
   - Звук каждую минуту

6. **Advanced** - Расширенные настройки
   - Режим переработки (overrun)
   - Лимит переработки
   - Сохранение/загрузка настроек

#### Состояния UI

```javascript
// Цветовые индикаторы
States:
  normal     → белый/серый
  warning    → желтый (< 60 секунд)
  danger     → красный (время вышло)
  overtime   → оранжевый (переработка)
```

#### LocalStorage Keys

```javascript
localStorage:
  'timerColors'           - цветовая схема
  'displaySettings'       - настройки дисплея
  'timerSound'           - звук завершения
  'minuteSound'          - звук каждую минуту
  'timerSoundEnabled'    - включить звук
  'minuteSoundEnabled'   - включить звук минуты
  'backgroundImage'      - фоновое изображение
  'customBackgroundFile' - локальный файл фона
```

---

### 2. Widget Window - [electron-widget.html](electron-widget.html)

#### Назначение
Компактный прозрачный виджет с таймером, всегда поверх других окон.

#### Функции

**Отображение:**
- Крупные цифры времени в формате HH:MM:SS
- Прогресс-бар (если установлено время)
- Быстрые кнопки управления (Start/Pause, Reset)
- Кнопка закрытия

**Интеракция:**
- Перетаскивание (drag & drop)
- Изменение размера (resize за углы)
- Масштабирование (Ctrl + колесо мыши)
- Настройка прозрачности

**Стили:**
- Полупрозрачный фон с backdrop-filter: blur()
- Градиентный border
- Скругленные углы (border-radius: 20px)
- Тени (box-shadow)

#### Синхронизация

```javascript
// Получение состояния
ipcRenderer.on('timer-state', updateTimerDisplay)

// Отправка команд
ipcRenderer.send('timer-control', { action: 'start' })
ipcRenderer.send('timer-control', { action: 'pause' })
ipcRenderer.send('timer-control', { action: 'reset' })
```

---

### 3. Display Window - [display.html](display.html) + [display-script.js](display-script.js)

#### Назначение
Полноэкранное отображение таймера для презентаций и публичных выступлений.

#### Класс DisplayTimer

```javascript
class DisplayTimer {
  constructor(containerId, style = 'circle')

  // Методы
  update(state)           // Обновить состояние
  render()                // Перерисовать UI
  createCircleTimer()     // Круговой таймер
  createDigitalTimer()    // Цифровой таймер
  createFlipTimer()       // Flip-карточки
  createAnalogTimer()     // Аналоговые часы

  // Утилиты
  formatTime(seconds)     // HH:MM:SS
  padZero(num, size)      // Padding нулями
}
```

#### 4 Стиля отображения

**1. Circle (Круговой)**
```
┌─────────────────┐
│   ┌─────────┐   │
│  ╱           ╲  │
│ │   05:30    │ │ ← Прогресс-бар по кругу
│  ╲           ╱  │
│   └─────────┘   │
└─────────────────┘
```

**2. Digital (Цифровой)**
```
┌─────────────────┐
│                 │
│    05:30:45     │ ← Крупные цифры
│                 │
└─────────────────┘
```

**3. Flip (Flip-карточки)**
```
┌─────────────────┐
│  ┌──┐ ┌──┐ ┌──┐ │
│  │05│ │30│ │45│ │ ← Анимированные карточки
│  └──┘ └──┘ └──┘ │
└─────────────────┘
```

**4. Analog (Аналоговые часы)**
```
┌─────────────────┐
│      12         │
│   9  │  3       │ ← Стрелочные часы
│      6          │
└─────────────────┘
```

#### Информационные блоки

```javascript
// 3 блока информации (опциональные)
InfoBlocks:
  1. Current Time    - текущее время (HH:MM:SS)
  2. Event Time      - время события (HH:MM:SS)
  3. End Time        - время окончания (HH:MM:SS)

// Каждый блок имеет:
  - Мини аналоговые часы (v1.1.0)
  - Заголовок
  - Время в цифрах
```

#### Управление

```javascript
// Горячие клавиши
Esc          → Закрыть полноэкранный режим
Space        → Start/Pause
R            → Reset

// IPC события
ipcRenderer.on('timer-state', update)
ipcRenderer.on('display-settings-update', applySettings)
ipcRenderer.on('colors-update', applyColors)
```

---

### 4. Clock Widget Window - [electron-clock-widget.html](electron-clock-widget.html)

#### Назначение
Независимый виджет с текущим временем и часами.

#### Функции

**Отображение:**
- Аналоговые часы (стрелочные)
- Цифровые часы
- Дата
- Часовой пояс

**Настройки:**
```javascript
ClockSettings:
  - format24h: boolean           // 24-часовой формат
  - showSeconds: boolean         // Показывать секунды
  - showDate: boolean            // Показывать дату
  - timezone: string             // Часовой пояс
  - style: 'analog' | 'digital'  // Стиль отображения
```

**Интеракция:**
- Перетаскивание
- Изменение размера
- Кнопка закрытия

---

## IPC Communication

### Схема событий

```
CONTROL WINDOW                  MAIN PROCESS
    │                                │
    ├─── timer-command ─────────────►│
    ├─── colors-update ─────────────►│
    ├─── display-settings-update ───►│
    │                                │
    │◄──── timer-state ───────────────┤
    │◄──── displays-list ─────────────┤
    │                                │

WIDGET WINDOW                   MAIN PROCESS
    │                                │
    ├─── timer-control ─────────────►│
    ├─── widget-resize ─────────────►│
    │                                │
    │◄──── timer-state ───────────────┤
    │◄──── colors-update ─────────────┤
    │                                │

DISPLAY WINDOW                  MAIN PROCESS
    │                                │
    │◄──── timer-state ───────────────┤
    │◄──── colors-update ─────────────┤
    │◄──── display-settings-update ───┤
    │                                │

CLOCK WIDGET                    MAIN PROCESS
    │                                │
    ├─── clock-widget-settings ─────►│
    │                                │
```

### События от Renderer → Main

#### Управление таймером
```javascript
// Установка/корректировка времени
ipcRenderer.send('timer-command', {
  type: 'set' | 'adjust',
  value: number  // секунды
})

// Управление (старт/пауза/сброс)
ipcRenderer.send('timer-control', {
  action: 'start' | 'pause' | 'reset'
})
```

#### Управление окнами
```javascript
// Виджет таймера
ipcRenderer.send('open-widget')
ipcRenderer.send('close-widget')

// Полноэкранный режим
ipcRenderer.send('open-display', {
  displayId: number  // ID монитора
})
ipcRenderer.send('close-display')

// Виджет часов
ipcRenderer.send('open-clock-widget')
ipcRenderer.send('close-clock-widget')
```

#### Настройки виджетов
```javascript
// Позиция
ipcRenderer.send('widget-set-position', { x, y })

// Прозрачность
ipcRenderer.send('widget-set-opacity', { opacity })

// Размер
ipcRenderer.send('widget-resize', { width, height })

// Масштабирование
ipcRenderer.send('widget-scale', { delta })

// Перемещение
ipcRenderer.send('widget-move', { deltaX, deltaY })
```

#### Обновление настроек
```javascript
// Цвета
ipcRenderer.send('colors-update', {
  primary: string,
  secondary: string,
  warning: string,
  danger: string,
  overtime: string
})

// Настройки дисплея
ipcRenderer.send('display-settings-update', {
  style: 'circle' | 'digital' | 'flip' | 'analog',
  showInfo1: boolean,
  showInfo2: boolean,
  showInfo3: boolean,
  info1Label: string,
  info2Label: string,
  info3Label: string
})

// Настройки часов
ipcRenderer.send('clock-widget-settings', {
  format24h: boolean,
  showSeconds: boolean,
  showDate: boolean,
  timezone: string
})
```

### События от Main → Renderer

#### Состояние таймера
```javascript
// Постоянное обновление состояния (каждую секунду)
ipcRenderer.on('timer-state', (event, state) => {
  // state = { totalSeconds, remainingSeconds, isRunning, ... }
})
```

#### Специальные события
```javascript
// Осталась 1 минута (для звука)
ipcRenderer.on('timer-minute', () => {
  // Проиграть звук минуты
})
```

#### Обновления настроек
```javascript
// Цвета
ipcRenderer.on('colors-update', (event, colors) => {
  // Применить цветовую схему
})

// Настройки дисплея
ipcRenderer.on('display-settings-update', (event, settings) => {
  // Обновить отображение
})

// Список мониторов
ipcRenderer.on('displays-list', (event, displays) => {
  // displays = [{ id, label, bounds, workArea, ... }]
})
```

---

## Функциональность

### Управление таймером

#### Установка времени
```javascript
// Способы установки:
1. Ручной ввод (часы, минуты, секунды)
2. Быстрые пресеты (5m, 10m, 15m, 30m, 45m, 60m)
3. Корректировка (±N секунд)
```

#### Состояния таймера
```
[IDLE] ───set──→ [READY] ───start──→ [RUNNING]
                    ▲                    │
                    │                    │ pause
                    │                    ▼
                    └────── reset ── [PAUSED]
                                         │
                                         │ time=0
                                         ▼
                                    [FINISHED]
                                         │
                                         │ allowNegative
                                         ▼
                                    [OVERTIME]
```

#### Режим переработки (Overrun)
```javascript
// Если allowNegative = true
// Таймер продолжает работать с отрицательным временем

if (remainingSeconds < 0) {
  if (Math.abs(remainingSeconds) > overrunLimitSeconds) {
    // Достигнут лимит переработки
    stopTimer()
  }
}
```

### Цветовые индикаторы

```javascript
// Автоматическая смена цвета в зависимости от состояния
const state = {
  normal: {
    condition: remainingSeconds > 60,
    color: 'primary'
  },
  warning: {
    condition: remainingSeconds <= 60 && remainingSeconds > 0,
    color: 'warning'  // желтый
  },
  danger: {
    condition: remainingSeconds === 0,
    color: 'danger'   // красный
  },
  overtime: {
    condition: remainingSeconds < 0,
    color: 'overtime' // оранжевый
  }
}
```

### Звуковые уведомления

#### Встроенные звуки (12 штук)
```
1. bell.mp3           - Колокольчик
2. gong.mp3           - Гонг
3. chime.mp3          - Куранты
4. beep.mp3           - Сигнал
5. alarm.mp3          - Будильник
6. ding.mp3           - Динь
7. buzz.mp3           - Жужжание
8. tone.mp3           - Тон
9. ping.mp3           - Пинг
10. ring.mp3          - Звонок
11. alert.mp3         - Сигнал тревоги
12. notification.mp3  - Уведомление
```

#### Загрузка своих звуков
```javascript
// Ограничения:
- Форматы: MP3, WAV, OGG
- Максимальный размер: 5 MB
- Хранение: в LocalStorage (base64)
```

#### События звуков
```javascript
// Завершение таймера
if (timerState.finished && timerSoundEnabled) {
  playSound(timerSound)
}

// Каждая минута
ipcRenderer.on('timer-minute', () => {
  if (minuteSoundEnabled) {
    playSound(minuteSound)
  }
})
```

---

## Сборка и развертывание

### Команды сборки

```bash
# Development
npm start              # Запуск в dev-режиме
npm run dev            # Запуск с флагом --dev

# Building
npm run build          # Сборка для текущей платформы
npm run build:win      # Сборка Windows (.exe)
npm run build:mac      # Сборка macOS (.dmg, .zip)
npm run build:all      # Сборка Windows + macOS
npm run pack           # Упаковка без создания инсталлятора
```

### Конфигурация Electron Builder

```javascript
// package.json → build
{
  "appId": "com.timer.widget",
  "productName": "TimerWidget",
  "directories": {
    "output": "dist",
    "buildResources": "build"
  },
  "files": [
    "electron-main.js",
    "electron-widget.html",
    "electron-control.html",
    "electron-clock-widget.html",
    "styles.css",
    "display.html",
    "display-script.js",
    "sounds/**/*"
  ]
}
```

### Платформы

#### Windows
```javascript
{
  "target": ["nsis", "portable"],
  "icon": "build/icon.png",
  "signAndEditExecutable": false,  // Отключена подпись
  "artifactName": "${productName}-Setup-${version}.${ext}"
}

// Выходные файлы:
- TimerWidget-Setup-1.2.2.exe     (NSIS installer)
- TimerWidget-Portable-1.2.2.exe  (Portable)
```

#### macOS
```javascript
{
  "target": ["dmg", "zip"],
  "icon": "build/icon.png",
  "category": "public.app-category.utilities"
}

// Выходные файлы:
- TimerWidget-1.2.2.dmg           (DMG package)
- TimerWidget-1.2.2-mac.zip       (ZIP archive)
```

### CI/CD

#### GitHub Actions - [.github/workflows/build.yml](.github/workflows/build.yml)

```yaml
# Триггеры:
- push to main branch
- manual workflow dispatch

# Jobs:
- build-windows (windows-latest)
- build-macos (macos-latest)

# Артефакты:
- Windows: .exe, .exe.blockmap
- macOS: .dmg, .dmg.blockmap, .zip
```

#### Процесс сборки
```
1. Checkout repository
2. Setup Node.js 18.x
3. npm install
4. npm run build:win | build:mac
5. Upload artifacts to GitHub
```

---

## Настройки и кастомизация

### Темы оформления

#### Готовые темы (6 штук)

```javascript
const themes = {
  default: {
    primary: '#4a90e2',
    secondary: '#7cb3e9',
    warning: '#f5a623',
    danger: '#d0021b',
    overtime: '#ff6b35'
  },
  ocean: {
    primary: '#006994',
    secondary: '#0099cc',
    warning: '#ffa500',
    danger: '#ff4500',
    overtime: '#ff6347'
  },
  sunset: {
    primary: '#ff6b6b',
    secondary: '#ffd93d',
    warning: '#ffaa00',
    danger: '#ff0000',
    overtime: '#ff4500'
  },
  forest: {
    primary: '#27ae60',
    secondary: '#2ecc71',
    warning: '#f39c12',
    danger: '#c0392b',
    overtime: '#e67e22'
  },
  lavender: {
    primary: '#9b59b6',
    secondary: '#bb8fce',
    warning: '#f4d03f',
    danger: '#e74c3c',
    overtime: '#ff7f50'
  },
  midnight: {
    primary: '#2c3e50',
    secondary: '#34495e',
    warning: '#f1c40f',
    danger: '#e74c3c',
    overtime: '#d35400'
  }
}
```

### Пользовательские цвета

```javascript
// Настройка каждого цвета отдельно
CustomColors:
  - primary     (основной цвет)
  - secondary   (вторичный цвет)
  - warning     (предупреждение, < 60 сек)
  - danger      (опасность, время вышло)
  - overtime    (переработка, отрицательное время)

// Использование:
- Solid color (один цвет)
- Gradient (градиент из 2 цветов)
```

### Фоновые изображения

#### Способы установки
```javascript
// 1. URL из интернета
backgroundImage: {
  type: 'url',
  value: 'https://example.com/image.jpg'
}

// 2. Локальный файл
backgroundImage: {
  type: 'file',
  value: 'data:image/png;base64,...'  // base64 encoded
}
```

#### Параметры фона
```javascript
BackgroundSettings:
  - backgroundSize: 'cover' | 'contain' | 'auto'
  - backgroundRepeat: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y'
  - backgroundPosition: 'center' | 'top' | 'bottom' | 'left' | 'right'
  - overlay: 0.0 - 1.0 (затемнение)
```

### LocalStorage структура

```javascript
// Control Window
localStorage:
  'timerColors': JSON         // Цветовая схема
  'displaySettings': JSON     // Настройки дисплея
  'timerSound': string        // ID или base64 звука
  'minuteSound': string       // ID или base64 звука минуты
  'timerSoundEnabled': bool   // Включить звук
  'minuteSoundEnabled': bool  // Включить звук минуты
  'backgroundImage': JSON     // Фоновое изображение
  'customBackgroundFile': string  // Локальный файл (base64)

// Widget Window
localStorage:
  'widgetPosition': JSON      // { x, y }
  'widgetSize': JSON          // { width, height }
  'widgetOpacity': number     // 0.0 - 1.0

// Clock Widget
localStorage:
  'clockSettings': JSON       // Настройки часов
  'clockPosition': JSON       // { x, y }
  'clockSize': JSON           // { width, height }

// Display Window
localStorage:
  'displayStyle': string      // 'circle' | 'digital' | 'flip' | 'analog'
```

---

## Технические детали

### Безопасность Electron

```javascript
// webPreferences
{
  nodeIntegration: false,       // Отключена интеграция Node.js
  contextIsolation: true,       // Включена изоляция контекста
  preload: path.join(__dirname, 'preload.js'),
  sandbox: true
}

// Примечание:
// Это безопасная конфигурация для локального desktop-приложения.
// Inline-скрипты допускаются CSP (см. ограничение ниже).
```

### Оптимизация производительности

#### Debounce функции
```javascript
// Для частых событий (resize, move)
const debounce = (func, delay = 120) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

// Применение:
window.addEventListener('resize', debounce(handleResize, 120));
```

#### Throttle обновлений
```javascript
// Обновление UI только при изменении состояния
let lastState = null;
ipcRenderer.on('timer-state', (event, state) => {
  if (JSON.stringify(state) !== JSON.stringify(lastState)) {
    updateUI(state);
    lastState = state;
  }
});
```

### Управление памятью

```javascript
// Очистка при закрытии окна
window.addEventListener('beforeunload', () => {
  // Отписка от IPC событий
  ipcRenderer.removeAllListeners('timer-state');

  // Очистка таймеров
  clearInterval(updateInterval);

  // Очистка audio элементов
  audio = null;
});
```

---

## Дорожная карта

### Текущая версия: 1.2.2

**Добавлено:**
- Безопасная конфигурация окон (contextIsolation + sandbox)
- CSP во всех HTML окнах
- Унифицированный IPC allowlist

### История версий

**v1.0.0** - Первый релиз
- Базовый функционал таймера
- 3 режима отображения (circle, digital, flip)
- Мини-виджет таймера
- Панель управления

**v1.1.0** - UI improvements
- Добавлен 4-й стиль (analog)
- Мини-аналоговые часы
- Виджет часов (clock widget)
- Улучшения дизайна

**v1.2.2** - Security & stability
- Безопасная конфигурация окон (contextIsolation + sandbox)
- CSP во всех HTML окнах
- Унифицированный IPC allowlist

---

## Поддержка и разработка

### Требования для разработки

```bash
Node.js >= 16.x
npm >= 8.x
```

### Установка зависимостей

```bash
npm install
```

### Структура кода

```javascript
// Соглашения:
- camelCase для переменных и функций
- PascalCase для классов
- UPPER_CASE для констант
- Отступы: 2 пробела
- Кавычки: одинарные ('...')
```

### Отладка

```javascript
// Dev режим
if (process.argv.includes('--dev')) {
  // Открыть DevTools автоматически
  mainWindow.webContents.openDevTools();
}
```

### Логирование

```javascript
// Main process
console.log('[MAIN]', message);

// Renderer process
console.log('[RENDERER]', message);
```

---

## Известные ограничения

1. **Безопасность:** CSP использует `unsafe-inline` из-за inline-скриптов
2. **LocalStorage:** Ограничение размера ~10MB (для звуков и фонов)
3. **Производительность:** Flip-анимации могут быть тяжелыми на слабых системах
4. **Платформы:** Только Windows и macOS (Linux не поддерживается официально)

---

## Полезные ссылки

- [Electron Documentation](https://www.electronjs.org/docs)
- [Electron Builder](https://www.electron.build/)
- [GitHub Repository](https://github.com/username/timer-widget)
- [Issue Tracker](https://github.com/username/timer-widget/issues)

---

**Документация создана:** 2025-12-09
**Автор:** Claude Code
**Версия документации:** 1.0
