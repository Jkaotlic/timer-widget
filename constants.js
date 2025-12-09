// Constants для Timer Widget
// Централизованное хранилище всех констант и magic numbers

const CONFIG = {
    // ============================================
    // TIMER INTERVALS
    // ============================================
    TIMER_TICK_INTERVAL: 1000,              // Интервал обновления таймера (1 секунда)
    CLOCK_UPDATE_INTERVAL: 1000,            // Интервал обновления часов (1 секунда)
    STORAGE_SYNC_INTERVAL: 100,             // Интервал синхронизации через localStorage
    COLOR_SYNC_INTERVAL: 2000,              // Интервал синхронизации цветов (2 секунды)

    // ============================================
    // UI DELAYS & DEBOUNCE
    // ============================================
    ANIMATION_DELAY: 50,                    // Задержка для анимаций
    DEBOUNCE_DELAY: 120,                    // Debounce для UI events
    RESIZE_DEBOUNCE: 300,                   // Debounce для resize events
    FLASH_INTERVAL: 250,                    // Интервал мигания при завершении таймера

    // ============================================
    // WIDGET DIMENSIONS
    // ============================================
    // Timer Widget
    WIDGET_DEFAULT_WIDTH: 250,
    WIDGET_DEFAULT_HEIGHT: 280,
    WIDGET_MIN_WIDTH: 120,
    WIDGET_MIN_HEIGHT: 140,

    // Clock Widget
    CLOCK_WIDGET_DEFAULT_SIZE: 220,
    CLOCK_WIDGET_MIN_SIZE: 100,

    // Control Window
    CONTROL_WINDOW_WIDTH: 420,
    CONTROL_WINDOW_HEIGHT: 500,
    CONTROL_WINDOW_MIN_WIDTH: 350,
    CONTROL_WINDOW_MIN_HEIGHT: 300,

    // ============================================
    // SCALING & ZOOM
    // ============================================
    SCALE_STEP: 20,                         // Шаг масштабирования (пиксели)
    ZOOM_SCALE_FACTOR: 0.1,                 // Фактор масштабирования при Ctrl+Wheel
    MIN_SCALE: 0.5,                         // Минимальный масштаб (50%)
    MAX_SCALE: 3.0,                         // Максимальный масштаб (300%)
    DEFAULT_SCALE: 1.0,                     // Масштаб по умолчанию (100%)

    // ============================================
    // TIMER THRESHOLDS
    // ============================================
    WARNING_THRESHOLD: 60,                  // Показать warning при < 60 секунд
    WARNING_PERCENTAGE: 25,                 // Показать warning при < 25% времени
    DANGER_PERCENTAGE: 10,                  // Показать danger при < 10% времени
    MINUTE_WARNING: 60,                     // Звук "осталась минута" при 60 секундах

    // ============================================
    // FILE LIMITS
    // ============================================
    MAX_SOUND_FILE_SIZE: 5 * 1024 * 1024,   // Максимальный размер звукового файла (5 MB)
    MAX_IMAGE_FILE_SIZE: 10 * 1024 * 1024,  // Максимальный размер изображения (10 MB)

    // ============================================
    // OPACITY & COLORS
    // ============================================
    DEFAULT_OPACITY: 0.95,
    MIN_OPACITY: 0.3,
    MAX_OPACITY: 1.0,
    OPACITY_STEP: 0.05,                     // Шаг изменения прозрачности

    // Overlay для фоновых изображений
    MIN_OVERLAY: 0,                         // Минимальное затемнение (0%)
    MAX_OVERLAY: 100,                       // Максимальное затемнение (100%)
    DEFAULT_OVERLAY: 50,                    // Затемнение по умолчанию (50%)

    // ============================================
    // DISPLAY SETTINGS
    // ============================================
    INFO_BLOCK_COUNT: 3,                    // Количество информационных блоков
    MIN_TIMER_SCALE: 50,                    // Минимальный масштаб таймера (50%)
    MAX_TIMER_SCALE: 200,                   // Максимальный масштаб таймера (200%)
    DEFAULT_TIMER_SCALE: 100,               // Масштаб таймера по умолчанию (100%)

    // ============================================
    // ANALOG CLOCK
    // ============================================
    CLOCK_RADIUS: 160,                      // Радиус аналоговых часов
    MINI_CLOCK_RADIUS: 40,                  // Радиус мини-часов в info блоках

    // ============================================
    // FLIP CARDS
    // ============================================
    FLIP_ANIMATION_DURATION: 600,           // Длительность анимации flip (мс)

    // ============================================
    // TIMER PRESETS
    // ============================================
    PRESET_5_MIN: 5 * 60,                   // 5 минут в секундах
    PRESET_10_MIN: 10 * 60,                 // 10 минут в секундах
    PRESET_15_MIN: 15 * 60,                 // 15 минут в секундах
    PRESET_30_MIN: 30 * 60,                 // 30 минут в секундах
    PRESET_45_MIN: 45 * 60,                 // 45 минут в секундах
    PRESET_60_MIN: 60 * 60,                 // 60 минут в секундах

    // ============================================
    // INPUT VALIDATION
    // ============================================
    MAX_HOURS: 99,                          // Максимум часов
    MAX_MINUTES: 59,                        // Максимум минут
    MAX_SECONDS: 59,                        // Максимум секунд
    MIN_TIME_VALUE: 0,                      // Минимальное значение времени

    // ============================================
    // OVERTIME SETTINGS
    // ============================================
    DEFAULT_OVERRUN_LIMIT: 300,             // Лимит переработки по умолчанию (5 минут)
    MAX_OVERRUN_LIMIT: 3600,                // Максимальный лимит переработки (1 час)

    // ============================================
    // FLASH ANIMATION
    // ============================================
    MAX_FLASH_COUNT: 6,                     // Максимальное количество миганий
    FLASH_DURATION: 250,                    // Длительность одного мигания (мс)

    // ============================================
    // STORAGE KEYS
    // ============================================
    STORAGE_KEYS: {
        TIMER_COLORS: 'timerColors',
        DISPLAY_SETTINGS: 'displaySettings',
        TIMER_SOUND: 'timerSound',
        MINUTE_SOUND: 'minuteSound',
        TIMER_SOUND_ENABLED: 'timerSoundEnabled',
        MINUTE_SOUND_ENABLED: 'minuteSoundEnabled',
        BACKGROUND_IMAGE: 'backgroundImage',
        CUSTOM_BACKGROUND_FILE: 'customBackgroundFile',
        WIDGET_POSITION: 'widgetPosition',
        WIDGET_SIZE: 'widgetSize',
        WIDGET_OPACITY: 'widgetOpacity',
        CLOCK_SETTINGS: 'clockSettings',
        CLOCK_POSITION: 'clockPosition',
        CLOCK_SIZE: 'clockSize',
        CLOCK_WIDGET_SETTINGS: 'clockWidgetSettings',
        TIMER_STATE: 'timerState',
        TIMER_CONFIG: 'timerConfig'
    },

    // ============================================
    // DEFAULT COLORS
    // ============================================
    DEFAULT_COLORS: {
        primary: '#4a90e2',
        secondary: '#7cb3e9',
        warning: '#f5a623',
        danger: '#d0021b',
        overtime: '#ff6b35',
        text: '#ffffff',
        textSecondary: '#cccccc',
        background: '#1a1a1a'
    },

    // ============================================
    // TIMER STYLES
    // ============================================
    TIMER_STYLES: {
        CIRCLE: 'circle',
        DIGITAL: 'digital',
        FLIP: 'flip',
        ANALOG: 'analog'
    },

    // ============================================
    // TIMER STATES
    // ============================================
    TIMER_STATES: {
        IDLE: 'idle',
        READY: 'ready',
        RUNNING: 'running',
        PAUSED: 'paused',
        FINISHED: 'finished',
        OVERTIME: 'overtime'
    },

    // ============================================
    // TIMER STATUS
    // ============================================
    TIMER_STATUS: {
        NORMAL: 'normal',
        WARNING: 'warning',
        DANGER: 'danger',
        OVERTIME: 'overtime'
    },

    // ============================================
    // BACKGROUND MODES
    // ============================================
    BACKGROUND_MODES: {
        GRADIENT: 'gradient',
        SOLID: 'solid',
        IMAGE: 'image',
        NONE: 'none'
    },

    // ============================================
    // BACKGROUND FIT OPTIONS
    // ============================================
    BACKGROUND_FIT: {
        COVER: 'cover',
        CONTAIN: 'contain',
        TILE: 'tile',
        AUTO: 'auto'
    },

    // ============================================
    // SOUND IDS
    // ============================================
    BUILTIN_SOUNDS: [
        'bell',
        'gong',
        'chime',
        'beep',
        'alarm',
        'ding',
        'buzz',
        'tone',
        'ping',
        'ring',
        'alert',
        'notification'
    ],

    // ============================================
    // ALLOWED FILE TYPES
    // ============================================
    ALLOWED_AUDIO_TYPES: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3'],
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],

    // ============================================
    // IPC CHANNELS
    // ============================================
    IPC_CHANNELS: {
        // Timer commands
        TIMER_COMMAND: 'timer-command',
        TIMER_CONTROL: 'timer-control',
        TIMER_STATE: 'timer-state',
        TIMER_MINUTE: 'timer-minute',
        GET_TIMER_STATE: 'get-timer-state',

        // Window management
        OPEN_WIDGET: 'open-widget',
        CLOSE_WIDGET: 'close-widget',
        OPEN_DISPLAY: 'open-display',
        CLOSE_DISPLAY: 'close-display',
        OPEN_CLOCK_WIDGET: 'open-clock-widget',
        CLOSE_CLOCK_WIDGET: 'close-clock-widget',

        // Settings
        COLORS_UPDATE: 'colors-update',
        DISPLAY_SETTINGS_UPDATE: 'display-settings-update',
        CLOCK_SETTINGS: 'clock-settings',
        SET_CLOCK_STYLE: 'set-clock-style',

        // Widget controls
        WIDGET_SET_POSITION: 'widget-set-position',
        WIDGET_SET_OPACITY: 'widget-set-opacity',
        WIDGET_RESIZE: 'widget-resize',
        WIDGET_SCALE: 'widget-scale',
        WIDGET_MOVE: 'widget-move',
        WIDGET_GET_SIZE: 'widget-get-size',

        // Display controls
        GET_DISPLAYS: 'get-displays',
        DISPLAYS_LIST: 'displays-list'
    },

    // ============================================
    // Z-INDEX LAYERS
    // ============================================
    Z_INDEX: {
        BACKGROUND: 0,
        OVERLAY: 1,
        CONTENT: 10,
        INFO_BLOCKS: 100,
        CONTROLS: 1000,
        CLOSE_BUTTON: 9998,
        BORDER: 9998,
        RESIZE_HANDLES: 9999
    },

    // ============================================
    // THEMES
    // ============================================
    THEMES: {
        DEFAULT: 'default',
        OCEAN: 'ocean',
        SUNSET: 'sunset',
        FOREST: 'forest',
        LAVENDER: 'lavender',
        MIDNIGHT: 'midnight'
    }
};

// Freeze объект чтобы предотвратить изменения
Object.freeze(CONFIG);
Object.freeze(CONFIG.STORAGE_KEYS);
Object.freeze(CONFIG.DEFAULT_COLORS);
Object.freeze(CONFIG.TIMER_STYLES);
Object.freeze(CONFIG.TIMER_STATES);
Object.freeze(CONFIG.TIMER_STATUS);
Object.freeze(CONFIG.BACKGROUND_MODES);
Object.freeze(CONFIG.BACKGROUND_FIT);
Object.freeze(CONFIG.IPC_CHANNELS);
Object.freeze(CONFIG.Z_INDEX);
Object.freeze(CONFIG.THEMES);

// Экспорт для Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}

// Экспорт для браузера (renderer process)
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}
