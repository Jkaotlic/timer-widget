// Карта «канал → payload» ключевых каналов IPC — ОДНО объявление на оба
// проекта (tsconfig.main.json и tsconfig.renderer.json).
//
// Зачем. Мост окна (globals.d.ts: IpcRendererShim/ElectronBridge) и
// safelySendToWindow (utils.js) берут тип payload ОТСЮДА по имени канала:
// колбэк, написанный прямо в `ipcRenderer.on('timer-state', (e, state) => …)`,
// получает тип `state` сам, без аннотации на месте, а сборка payload сверяется
// с тем же типом при `send`. Опечатка в имени поля становится ошибкой tsc и
// там, где payload СОБИРАЮТ, и там, где его ЧИТАЮТ.
//
// Правило поля. Поля описаны по ФАКТИЧЕСКОМУ месту сборки (оно указано у
// каждого типа), а не по docs/ipc.md: документ — справка, истина в коде.
// Обязательное поле — то, что сборка кладёт ВСЕГДА; необязательное — то, что
// бывает пропущено (контрола нет, снимок до первой правки, «без изменений»).
//
// Каналов вне карты это не касается: у моста `IpcArgs<C>` для них — условный
// тип, дающий `any[]`, и все прежние вызовы работают как работали.
//
// Файл — глобальный скрипт (ни одного import/export верхнего уровня): имена
// ниже видны обоим проектам без импорта.

/**
 * `timer-state`. Сборка — timer-controller.js: начальное состояние
 * (`let timerState = {…}`) и `patch()`, который штампует конфиг, `timestamp` и
 * `updateCounter`. Рассылка — main-timer.js (onState), снимок окну при
 * открытии — main-windows.js, ответ на `get-timer-state` — main-timer.js.
 */
interface TimerState {
    totalSeconds: number;
    remainingSeconds: number;
    presetSeconds: number;
    isRunning: boolean;
    isPaused: boolean;
    finished: boolean;
    /** Стенные часы патча — штамп, НЕ порядок (порядок — updateCounter). */
    timestamp: number;
    updateCounter: number;
    /** Штампует patch(); в начальном состоянии (до первого патча) поля нет. */
    overrunLimitSeconds?: number;
    /** Штампует patch(); в начальном состоянии (до первого патча) поля нет. */
    allowNegative?: boolean;
}

/**
 * `widget-style-update`. Сборка — ОДНА: panel-state.js `widgetStylePayload()`.
 */
interface WidgetStyleUpdate {
    timerStyle: string;
    timerScale: number;
    digitsFont: string;
    statusLabel: boolean;
    alwaysOnTop: boolean;
}

/**
 * `display-settings-update`. Сборка — ОДНА: panel-display.js
 * `pushDisplaySettings()` (+ collectDisplayToggles / collectBlockLabels /
 * attachChangedBgImage). Часам main шлёт ту же посылку без `bgLocalImage`
 * (relay-payload.js withoutBgImage).
 *
 * Тумблеры и подписи блоков перечислены поимённо: в коде их списки — реестры
 * settings-schema.js (DISPLAY_BLOCK_KEYS, DISPLAY_LABEL_KEYS) и
 * display-layouts.js (labelKey). Расхождение с реестром ловит
 * tests/typecheck-ratchet.test.js.
 */
interface DisplaySettingsUpdate {
    clockStyle: string;
    bgMode: string;
    bgSolid: string;
    bgGrad1: string;
    bgGrad2: string;
    bgLocalFit: string;
    /** Проценты [0, 100] — RendererShared.bgOverlayPercent. */
    bgLocalOverlay: number;
    /** Только при СМЕНЕ картинки (BUG-10): нет ключа — «без изменений», '' — «картинки нет». */
    bgLocalImage?: string;
    eventTime: string;
    endTime: string;
    eventTitle: string;
    heroMode: string;
    labelHeroCurrent: string;
    labelHeroToStart: string;
    labelHeroToEnd: string;
    timeBlocksScale: number;
    displayTimerStyle: string;
    displayTimerScale: number;
    /** Общее имя рядом со своим: откат на прежнюю версию и e2e (panel-display.js). */
    timerStyle: string;
    /** Общее имя рядом со своим: откат на прежнюю версию и e2e (panel-display.js). */
    timerScale: number;
    displayDigitsFont: string;
    /** Ставка СТРОКОЙ — к числу её приводит money-meter.js. */
    overrunPrice: string;
    overrunPeriod: string;
    floor47Unlocked: boolean;
    reportOnlyOverruns: boolean;

    // collectDisplayToggles: ключ есть, только если контрол есть в документе.
    showCurrentTime?: boolean;
    showEventTime?: boolean;
    showEndTime?: boolean;
    showTimeLeft?: boolean;
    showEventTitle?: boolean;
    showOverrunCost?: boolean;
    showTotalCost?: boolean;
    showHeroLabel?: boolean;
    showStatusPill?: boolean;

    // collectBlockLabels: ключ есть, только если поле подписи есть в документе.
    labelCurrentTime?: string;
    labelEventTime?: string;
    labelEndTime?: string;
    labelTimeLeft?: string;
    labelOverrunCost?: string;
    labelTotalCost?: string;
}

/**
 * `widget-colors-update` / `clock-colors-update` / `display-colors-update`.
 * Сборка — panel-colors.js (`mergeColors`, `updateColors`, `loadWindowColors`)
 * и control-app.js `saveColors()`. Поле отсутствует = «владелец умолчания — CSS»
 * (COLOR_FIELDS в panel-colors.js), поэтому все необязательные.
 */
interface ColorsUpdate {
    timer?: string;
    progress?: string;
    bg?: string;
    surface?: string;
    /** Доля [0, 1]. */
    surfaceAlpha?: number;
}

/** Патч цветов (`updateColors`): `null` в поле — «сбрось это поле». */
type ColorsPatch = { [K in keyof ColorsUpdate]?: ColorsUpdate[K] | null };

interface IpcPayloads {
    'timer-state': TimerState;
    'widget-style-update': WidgetStyleUpdate;
    'display-settings-update': DisplaySettingsUpdate;
    'widget-colors-update': ColorsUpdate;
    'clock-colors-update': ColorsUpdate;
    'display-colors-update': ColorsUpdate;
}

type IpcChannel = keyof IpcPayloads;

/** Аргументы payload канала: для канала из карты — ровно его тип, иначе — как раньше. */
type IpcArgs<C extends string> = C extends IpcChannel ? [payload: IpcPayloads[C]] : any[];

/**
 * Обработчик, сохранённый в поле (его снимает removeListener), — тип ему
 * даёт не вызов on(), а эта запись: `/** @type {IpcListener<'timer-state'>} *\/`.
 */
type IpcListener<C extends IpcChannel> = (event: { sender: null }, payload: IpcPayloads[C]) => void;
