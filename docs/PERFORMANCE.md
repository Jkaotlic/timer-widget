# Performance

## Benchmarks

Запуск:

```bash
node --test tests/perf.test.js
```

Либо `node --expose-gc --test tests/perf.test.js` для точного замера heap-delta.

### Baseline (2026-04-20, Windows 11, Node 22)

| Операция | Итераций | Время | На вызов |
|---|---|---|---|
| `tick()` | 1 000 000 | 25.58 ms | 25.6 ns |
| `tick()` с overrun | 500 000 | 15.93 ms | 31.9 ns |
| `adjust()` | 100 000 | 2.96 ms | 29.6 ns |
| `reset()` | 100 000 | 2.51 ms | 25.1 ns |
| `setPreset + start + pause` | 100 000 | 5.29 ms | 52.9 ns |
| `formatTime()` | 1 000 000 | 66.10 ms | 66.1 ns |
| `debounce()` dispatch | 100 000 | 43.04 ms | 430 ns |
| `emitTimerState` object-build | 100 000 | 7.20 ms | 72 ns |
| **1M ticks — heap delta** | — | — | **+0.01 MB** |

**Вывод:** `timer-engine.js` даёт ≈40 млн тиков/сек. Реальная нагрузка (1 tick/сек × 4 окна) занимает <1 µs CPU каждую секунду. Бутылочное горлышко — не арифметика.

## Startup instrumentation

В `electron-main.js` логируется время готовности каждого окна:

```
[perf] control window ready in 350ms
[perf] widget window ready in 120ms
[perf] clock window ready in 115ms
[perf] display window ready in 280ms
[perf] app ready in 450ms (main+control)
```

Цифры выводятся в консоль, и — при включённом `electron-log` — в `logs/main.log`.

## Runtime memory monitor

В `--dev` режиме каждые 60 секунд:

```
[perf] heap: 24.3MB rss: 128.7MB
```

Позволяет отследить утечки памяти во время живой работы.

## Метрики для мониторинга

| Метрика | Норма | Как замерить |
|---|---|---|
| Startup time (cold) | < 1000 ms | `[perf] app ready` в логе |
| Heap main process | < 80 MB stable | DevTools Memory (временно включить `devTools: true`) |
| Heap growth (1 час идл) | ≤ +5 MB | `process.memoryUsage()` в петле |
| CPU (idle, все 4 окна) | < 0.5% | Task Manager / `ps -o pcpu` |
| FPS анимаций (флип/аналог) | 60 FPS | DevTools Performance tab |

## Потенциальные оптимизации (НЕ применены, ждут подтверждения)

1. **Debounce broadcast** — сейчас `timer-state` шлётся 4 окнам каждую секунду безусловно. Можно шлать только при изменении `remainingSeconds` (но тогда `updateCounter` должен быть не-монотонным — рисковано). Экономия: до 3 IPC/сек в idle.
2. **Lazy-load окон** — widget/clock/display создаются по требованию, но сразу `loadFile`. Можно отложить до `show()` через `BrowserWindow({ show: false })` + `loadFile` только перед показом. Экономия: ~200 ms startup.
3. **Icon preload** — `build/icon.png` 1.6 MB (1024×1024). Для Tray достаточно 32×32. Создать 3 размера (16, 32, 256) и грузить нужный.
4. **CSS `@font-face` preload hints** — добавить `<link rel="preload" as="font">` в HTML для критичных весов (400 + 200).
5. **IPC batching** — если в будущем добавим частые IPC (color-picker drag), batch в rAF.

## Известные проблемы производительности

- **Нет**. На бенчмарках `tick()` укладывается в наносекунды, heap стабилен.

## Как замерить самому

**Холодный старт:**
```bash
# Windows PowerShell
Measure-Command { Start-Process .\TimerWidget.exe -Wait }
```

**Heap через 1 час:**
1. Запусти `npm run dev`
2. Смотри на `[perf] heap:` выводы
3. Сравни первую и последнюю цифры — должно быть < +5 MB

**Профилирование:**
1. Временно `devTools: true` в `electron-main.js`
2. В control окне: Ctrl+Shift+I → Performance → Record 10 сек
3. Смотри flame chart: `setInterval` в main не должен быть на топе
