// Constants для Timer Widget
// Централизованное хранилище всех констант и magic numbers

const CONFIG = {
    // ============================================
    // TIMER INTERVALS
    // ============================================
    TIMER_TICK_INTERVAL: 1000,              // Интервал обновления таймера (1 секунда)

    // ============================================
    // UI DELAYS & DEBOUNCE
    // ============================================
    DEBOUNCE_DELAY: 120,                    // Debounce для UI events
    RESIZE_DEBOUNCE: 300,                   // Debounce для resize events
    FLASH_INTERVAL: 250,                    // Интервал мигания при завершении таймера

    // ============================================
    // WIDGET DIMENSIONS
    // ============================================
    // Timer Widget. Окно КВАДРАТНОЕ: WIDGET_BASE_SIZE в рендерере считает и
    // ширину, и высоту от одного числа, поэтому высота 280 жила ровно до
    // первого масштабирования, а потом навсегда становилась 250 — и стартовый
    // вид больше не воспроизводился за всю сессию.
    WIDGET_DEFAULT_WIDTH: 250,
    WIDGET_DEFAULT_HEIGHT: 250,
    WIDGET_MIN_WIDTH: 120,
    WIDGET_MIN_HEIGHT: 140,

    // Clock Widget. CLOCK_WIDGET_MIN_SIZE объявлялся как 100, а окно всё это
    // время создавалось со 120 — реестр никто не читал, поэтому расхождение
    // никого не роняло и никем не замечалось. Здесь стоит НАСТОЯЩЕЕ значение.
    CLOCK_WIDGET_DEFAULT_SIZE: 220,
    CLOCK_WIDGET_MIN_SIZE: 120,

    // Control Window. CONTROL_WINDOW_HEIGHT объявлялась как 500, а окно
    // создавалось в диапазоне 660…740; CONTROL_WINDOW_MIN_HEIGHT — как 300 при
    // настоящем минимуме 660, вдвое больше. Ни ту, ни другую никто не читал.
    // Здесь стоят НАСТОЯЩИЕ значения.
    CONTROL_WINDOW_WIDTH: 400,
    CONTROL_WINDOW_HEIGHT: 740,
    CONTROL_WINDOW_MIN_WIDTH: 380,
    // Потолок ширины окна управления. Значение нужно ДВУМ сторонам: главный
    // процесс ставит его в maxWidth, а панель обязана учитывать его, когда
    // считает ширину своей левой колонки при открытии ящика настроек. Пока
    // константа была литералом только в главном процессе, панель у предела
    // ширины просила «текущая + 336», запрос обрезался до потолка, а колонка
    // оставалась во всю ширину — ящик ложился ПОВЕРХ содержимого панели.
    CONTROL_WINDOW_MAX_WIDTH: 1200,
    CONTROL_WINDOW_MIN_HEIGHT: 660,

    // ============================================
    // SCALING & ZOOM
    // ============================================
    // Шаг Ctrl+колеса, В ПРОЦЕНТАХ. Объявлялся как 20 «пикселей», а все три окна
    // независимо держали свой литерал 10 процентов — ни одно реестр не читало.
    SCALE_STEP: 10,
    DEFAULT_SCALE: 1.0,                     // Масштаб по умолчанию (100%)

    // ============================================
    // TIMER THRESHOLDS
    // ============================================
    WARNING_THRESHOLD: 60,                  // Показать warning при < 60 секунд
    WARNING_PERCENTAGE: 25,                 // Показать warning при < 25% времени
    DANGER_PERCENTAGE: 10,                  // Показать danger при < 10% времени

    // ============================================
    // PRESET DURATIONS
    // ============================================
    // Длительности клавиатурных пресетов (клавиши 1-8): 5/10/15/20/25/30/45/60 минут
    PRESET_DURATIONS: [300, 600, 900, 1200, 1500, 1800, 2700, 3600],

    // ============================================
    // FILE LIMITS
    // ============================================
    MAX_SOUND_FILE_SIZE: 5 * 1024 * 1024,   // Максимальный размер звукового файла (5 MB)
    MAX_IMAGE_FILE_SIZE: 10 * 1024 * 1024,  // Максимальный размер изображения (10 MB)

    // ============================================
    // DISPLAY SETTINGS
    // ============================================
    // Границы масштаба таймера на полноэкранном дисплее. Объявлялись как 50/200
    // при настоящих 30/300 в display-script.js — реестр не читал никто.
    MIN_TIMER_SCALE: 30,
    MAX_TIMER_SCALE: 300,

    // ============================================
    // FLASH ANIMATION
    // ============================================
    MAX_FLASH_COUNT: 6,                     // Максимальное количество миганий

    // ============================================
    // STORAGE KEYS
    // ============================================
    // РЕЕСТР ключей localStorage. Рендереры обращаются к хранилищу строковыми
    // литералами (модулей-обёрток нет, сборщика тоже), поэтому этот объект —
    // документация, а не единственная точка доступа. Ровно поэтому он и разъехался
    // с реальностью: 16 ключей здесь были фантомными (widgetStyle, timerSound,
    // widgetPosition, clockSize, timerConfig и другие — ни одного обращения в коде),
    // а 10 реально используемых, наоборот, отсутствовали (widgetGeometry,
    // clockGeometry, displayBlockPositions, selectedDisplay и прочие).
    //
    // Синхронность реестра и кода теперь проверяется тестом в оба конца
    // (tests/storage-keys.test.js): и лишний ключ здесь, и незарегистрированный
    // ключ в коде роняют прогон.
    STORAGE_KEYS: {
        // Цвета (по окну)
        TIMER_COLORS: 'timerColors',
        WIDGET_COLORS: 'widgetColors',
        CLOCK_COLORS: 'clockColors',
        DISPLAY_COLORS: 'displayColors',
        // Настройки окон
        WIDGET_SETTINGS: 'widgetSettings',
        CLOCK_WIDGET_SETTINGS: 'clockWidgetSettings',
        DISPLAY_EXT_SETTINGS: 'displayExtSettings',
        // Геометрия виджетов (размер + позиция), см. restoreGeometry/saveGeometry
        WIDGET_GEOMETRY: 'widgetGeometry',
        CLOCK_GEOMETRY: 'clockGeometry',
        // Деления на круглом циферблате (общая настройка двух окон)
        WIDGET_SHOW_TICKS: 'widgetShowTicks',
        CLOCK_SHOW_TICKS: 'clockShowTicks',
        // Полноэкранный режим: масштабы и позиции info-блоков
        DISPLAY_TIMER_SCALE: 'displayTimerScale',
        DISPLAY_BLOCK_SCALE: 'displayBlockScale',
        DISPLAY_BLOCK_POSITIONS: 'displayBlockPositions',
        SELECTED_DISPLAY: 'selectedDisplay',
        // Фон полноэкранного режима
        LOCAL_BG_IMAGE: 'localBgImage',
        LOCAL_BG_SETTINGS: 'localBgSettings',
        // Первый запуск: показана ли подсказка про F1 (ровно один раз за профиль)
        ONBOARDING_SHOWN: 'onboardingShown',
        // Звук
        CUSTOM_SOUNDS: 'customSounds',
        SOUND_ENABLED: 'soundEnabled',
        // Тема интерфейса ('dark' | 'light'), владелец — ui-theme.js
        UI_THEME: 'uiTheme',
        // Однократные подсказки при первом открытии окна
        WIDGET_HINT_SHOWN: 'widgetHintShown',
        CLOCK_HINT_SHOWN: 'clockHintShown',
        DISPLAY_HINT_SHOWN: 'displayHintShown'
    },

    // ============================================
    // DEFAULT COLORS
    // ============================================
    /**
     * Дефолтные цвета таймера — ОДИН владелец на четыре окна.
     *
     * Их было три, и они разъехались: панель держала #667eea/#764ba2 —
     * фиолетовую пару, которой нет в токенах вообще; виджет подставлял
     * #0a84ff/#30d158; дисплей не применял НИЧЕГО и оставался на CSS-зелёном.
     * Поэтому один и тот же стиль LED выглядел зелёным на полноэкранном окне и
     * синим в виджете: расхождение было не в CSS, а в данных.
     *
     * Здесь стояла ещё и пятая палитра DEFAULT_COLORS (primary/secondary/
     * warning/danger/overtime/text/…). Её не читал НИКТО — ни одного
     * обращения по всему репозиторию, — а держала она overtime: '#ff6b35',
     * то есть оранжевый перерасход, который в этом проекте запрещён и был
     * вычищен из всех живых мест. Удалена.
     */
    DEFAULT_TIMER_COLORS: {
        timer: '#0a84ff',
        progress: '#30d158'
    },

    // ============================================
    // TIMER STYLES
    // ============================================

    // ============================================
    // TIMER STATES
    // ============================================

    // ============================================
    // TIMER STATUS
    // ============================================

    // ============================================
    // BACKGROUND MODES
    // ============================================

    // ============================================
    // ALLOWED FILE TYPES
    // ============================================
    ALLOWED_AUDIO_TYPES: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/webm', 'audio/aac', 'audio/flac'],
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],

    // ============================================
    // Z-INDEX LAYERS
    // ============================================

};

// Freeze объект чтобы предотвратить изменения
Object.freeze(CONFIG);
Object.freeze(CONFIG.STORAGE_KEYS);
Object.freeze(CONFIG.DEFAULT_TIMER_COLORS);
Object.freeze(CONFIG.TIMER_STYLES);
Object.freeze(CONFIG.TIMER_STATES);
Object.freeze(CONFIG.TIMER_STATUS);
Object.freeze(CONFIG.BACKGROUND_MODES);
Object.freeze(CONFIG.Z_INDEX);
if (CONFIG.ALLOWED_AUDIO_TYPES) { Object.freeze(CONFIG.ALLOWED_AUDIO_TYPES); }
if (CONFIG.ALLOWED_IMAGE_TYPES) { Object.freeze(CONFIG.ALLOWED_IMAGE_TYPES); }
if (CONFIG.PRESET_DURATIONS) { Object.freeze(CONFIG.PRESET_DURATIONS); }

// Экспорт для Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}

// Экспорт для браузера (renderer process)
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}
