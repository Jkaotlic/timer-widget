// Глобальные имена окон — ОДНО объявление для проекта рендерера
// (tsconfig.renderer.json; в tsconfig.main.json этот файл не входит).
//
// Зачем. Сборщика нет: каждый модуль — classic <script>, и перекрёстные
// ссылки идут через `window.X` (CLAUDE.md). Для tsc `window.X` — это поле
// `interface Window`; без этого файла каждое обращение — TS2339.
//
// Правило поля. Тип берётся из ЭКСПОРТА модуля (`typeof import('../m.js')`),
// а не пишется второй раз руками: guarded `module.exports` в модуле — источник
// и для тестов в Node, и для этих типов. Где `window.X` у модуля отличается
// от `module.exports`, это сказано через Pick/Omit, а не скрыто.
//
// Голые имена (`safeJSONParse`, `closeModal`, `CONFIG`…) здесь НАРОЧНО не
// объявлены: в коде они переписываются на `window.X`. Единственное исключение —
// `ipcRenderer`: голым именем его зовёт почти каждый файл окна (так задумано
// ipc-compat.js), и объявлен он ссылкой на поле Window, а не своим типом.
//
// Node-типов в проекте рендерера нет (`types: []`): с ними каждый setTimeout
// стал бы NodeJS.Timeout. Общие модули зовут `require`/`Buffer` за проверкой
// `typeof … !== 'undefined'` — для них ниже минимальные объявления.

/** Только для фолбэка общих модулей вне браузера (`typeof require === 'function'`). */
declare function require(id: string): any;

/** Только для фолбэка общих модулей вне браузера (`typeof Buffer !== 'undefined'`). */
declare var Buffer: {
    byteLength(value: string, encoding?: string): number;
};

/**
 * Мост preload.js (`contextBridge.exposeInMainWorld('electronAPI', …)`).
 *
 * send/on/once типизированы картой «канал → payload» (ipc-payloads.d.ts):
 * для канала из карты payload — его тип, для прочих — `any`, как раньше.
 * Одна сигнатура с условным типом, а не две перегрузки: при перегрузках
 * неверный payload канала из карты молча ушёл бы в запасную `(string, any)`.
 */
interface ElectronBridge {
    send<C extends string>(channel: C, ...data: C extends IpcChannel ? IpcArgs<C> : [data?: any]): void;
    /** Возвращает функцию отписки. */
    on<C extends string>(channel: C, callback: (...args: IpcArgs<C>) => void): () => void;
    once<C extends string>(channel: C, callback: (...args: IpcArgs<C>) => void): void;
    removeListener(channel: string, callback: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
}

/**
 * Совместимый шим ipc-compat.js: колбэк получает (event, ...args).
 * Объект создаётся внутри IIFE и наружу (module.exports) не отдаётся —
 * поэтому тип описан здесь, а не взят из импорта.
 */
interface IpcRendererShim {
    /** Канал из карты (ipc-payloads.d.ts) требует ровно свой payload. */
    send<C extends string>(channel: C, ...data: C extends IpcChannel ? IpcArgs<C> : [data?: any]): void;
    /**
     * Колбэк, написанный прямо в вызове, получает тип payload по имени канала
     * сам — без аннотации на месте. Возвращает функцию отписки.
     */
    on<C extends string>(channel: C, callback: (event: { sender: null }, ...args: IpcArgs<C>) => void): () => void;
    once<C extends string>(channel: C, callback: (event: { sender: null }, ...args: IpcArgs<C>) => void): void;
    removeListener(channel: string, callback: Function): void;
    removeAllListeners(channel: string): void;
    /** Внутреннее: обёртки слушателей по каналу (для removeListener). */
    _listeners: Map<string, Array<{ original: Function; wrapped: Function; cleanup: () => void }>>;
}

interface Window {
    // --- мост и шим IPC
    electronAPI: ElectronBridge;
    ipcRenderer: IpcRendererShim;

    // --- общие модули (window.X = тот же объект, что module.exports)
    CONFIG: typeof import('../constants.js');
    SecurityUtils: typeof import('../security.js');
    /** utils.js кладёт в окно всё, КРОМЕ safelySendToWindow (она — для main). */
    TimeUtils: Omit<typeof import('../utils.js'), 'safelySendToWindow'>;
    ColorUtils: typeof import('../color-utils.js');
    RendererShared: typeof import('../renderer-shared.js');
    RendererStorage: typeof import('../renderer-storage.js');
    DigitsStyle: typeof import('../digits-style.js');
    DisplayLayouts: typeof import('../display-layouts.js');
    HeroModes: typeof import('../hero-modes.js');
    MoneyMeter: typeof import('../money-meter.js');
    EventReport: typeof import('../event-report.js');
    FlipCard: typeof import('../flip-card.js');
    WindowGeometry: typeof import('../window-geometry.js');
    UILock: typeof import('../ui-lock.js');
    UITheme: typeof import('../ui-theme.js');
    SettingsSchema: typeof import('../settings-schema.js');
    ClockSettingsSchema: typeof import('../clock-settings-schema.js');
    Presets: typeof import('../presets.js');
    SoundBank: typeof import('../sound-bank.js');
    SoundPresets: typeof import('../sound-presets.js');

    // --- модули панели
    Toast: typeof import('../ui-feedback.js').Toast;
    LoadingIndicator: typeof import('../ui-feedback.js').LoadingIndicator;
    setupScaleValueEdit: typeof import('../scale-input.js').setupScaleValueEdit;
    ColorPicker: typeof import('../color-picker.js').ColorPicker;
    addPickerToggle: typeof import('../color-picker.js').addPickerToggle;
    openModal: typeof import('../modal-manager.js').openModal;
    closeModal: typeof import('../modal-manager.js').closeModal;
    showKeyboardShortcuts: typeof import('../shortcuts-help.js').showKeyboardShortcuts;
    DisplayTimerHelpers: typeof import('../display-script.js');

    // --- примесь, которую читает e2e (status-and-colors); control-app.js импортирует
    CustomSoundsMixin: typeof import('../custom-sounds.js').CustomSoundsMixin;

    // --- экземпляры окон. Классы живут в точках входа (*-app.js,
    // display-script.js), которые ничего не экспортируют, поэтому any.
    timerController: any;
    timerWidget: any;
    clockWidget: any;
    displayTimer: any;
    miniBar: ReturnType<typeof import('../mini-bar.js').init>;

    /** Старый Safari/WebKit: префиксный AudioContext. */
    webkitAudioContext: typeof AudioContext;
}

/**
 * Что примеси приносят TimerController (control-app.js импортирует их и
 * делает `Object.assign(TimerController.prototype, XMixin)`). Класс объявляет
 * свои члены через `@type {TimerMixins['имя']}` в конструкторе.
 */
type TimerMixins = typeof import('../custom-sounds.js').CustomSoundsMixin
    & typeof import('../local-background.js').LocalBackgroundMixin
    & typeof import('../theme-grid.js').ThemeGridMixin
    & typeof import('../panel-state.js').PanelStateMixin
    & typeof import('../panel-colors.js').PanelColorsMixin
    & typeof import('../panel-display.js').PanelDisplayMixin
    & typeof import('../panel-reset.js').PanelResetMixin
    & typeof import('../panel-clock.js').PanelClockMixin;

/** ipc-compat.js кладёт шим в window; окна зовут его голым именем. */
declare var ipcRenderer: Window['ipcRenderer'];
