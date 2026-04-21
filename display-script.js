// Display Timer - Полноэкранное отображение таймера
class DisplayTimer {
    constructor() {
        this.radius = 160;
        this.circumference = 2 * Math.PI * this.radius;
        this.totalSeconds = 0;
        this.remainingSeconds = 0;
        this.isRunning = false;
        this.isPaused = false;
        this.finished = false;
        this.overrunLimitSeconds = 0;
        this.lastTimestamp = 0;
        this.lastUpdateCounter = -1;  // FIX BUG-012: Монотонный счетчик вместо timestamp
        this.flashCount = 0;
        this.flashInterval = null;

        // Массив для хранения ID всех интервалов
        this.intervals = [];

        // F-024: трекинг всех setTimeout / setInterval для cleanup
        // (intervals[] уже существует для setInterval — дублируем сюда для единой очистки)
        this._timeouts = [];
        this._intervals = [];

        // Обработчики IPC для cleanup
        this.ipcHandlers = {};

        // Именованные listeners для cleanup (document/window)
        this._handlers = {};

        // Кэшированные DOM-узлы для timeDisplay (минус-знак)
        this._timeDisplayMinusSpan = null;
        this._timeDisplayTextNode = null;

        // Кэшированные DOM-узлы для analogDigitalTime (минус-знак + текст)
        this._analogMinusSpan = null;
        this._analogTextNode = null;

        // F-023: Кэш flip-элементов для applyColors (избегаем querySelectorAll на каждый вызов)
        this._cachedFlipDigits = null;
        this._cachedFlipSeparators = null;

        // F-025: Кэш стрелок мини-часов по блоку (избегаем querySelector на каждый tick)
        // WeakMap<HTMLElement, { hour, minute, second }>
        this._miniClockHandsCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

        // Кэш для оптимизации re-renders (FIX BUG-007)
        this.cache = {
            lastSeconds: null,
            lastFormatted: null,
            lastStatus: null,
            lastProgress: null,
            lastDigitalUpdate: null,
            lastFlipUpdate: null,
            lastAnalogUpdate: null,
            lastRunning: null  // FIX BUG-C: track running state
        };

        // Настройки отображения
        this.eventTime = '10:00';
        this.endTime = '12:00';
        this.timerScale = 100;
        this.timerStyle = 'circle';
        this.lastFlipValues = { min1: '', min2: '', sec1: '', sec2: '' };

        this.isElectron = !!window.ipcRenderer;

        this.initElements();
        this.initProgress();
        this.loadColors();
        this.initDefaultStyle();
        this.detectElectronAndSetup();
        // Polling синхронизация цветов только в браузерном режиме;
        // в Electron цвета приходят через IPC
        if (!this.isElectron) {
            this.startColorSync();
        }
        this.startCurrentTimeClock();
        this.setupResizeHandler();
        this.setupKeyboardShortcuts();
        this.setupBlockControls();
        this.restoreBlockPositions();

        // Show controls hint once (v2 = added wheel+shift info)
        if (localStorage.getItem('displayHintShown') === 'v2') {
            const hint = document.getElementById('controlsHint');
            if (hint) { hint.style.display = 'none'; }
        } else {
            this._safeSetItem('displayHintShown', 'v2');
        }
    }

    // localStorage.setItem с защитой от QuotaExceeded и лимитом 1MB на значение
    _safeSetItem(key, value) {
        try {
            if (new Blob([value]).size > 1024 * 1024) { // 1 MB limit
                console.warn(`localStorage skipped (too big): ${key}`);
                return false;
            }
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            if (e && e.name === 'QuotaExceededError') {
                console.error('localStorage quota exceeded');
                return false;
            }
            throw e;
        }
    }

    setupResizeHandler() {
        // Пересчитываем размеры при изменении окна с debounce
        const debouncedResize = window.TimeUtils && window.TimeUtils.debounce
            ? window.TimeUtils.debounce(() => {
                this.updateRingSize();
            }, window.CONFIG ? window.CONFIG.RESIZE_DEBOUNCE : 300)
            : () => this.updateRingSize();

        this._handlers.windowResize = debouncedResize;
        window.addEventListener('resize', this._handlers.windowResize);
        // Начальный расчёт
        this.updateRingSize();
    }

    setupKeyboardShortcuts() {
        // Track window states for W/C/D toggles
        this._widgetOpen = false;
        this._clockOpen = false;
        if (this.ipcRenderer) {
            this.ipcHandlers.widgetWindowState = (_event, data) => { this._widgetOpen = data && data.isOpen; };
            this.ipcHandlers.clockWindowState = (_event, data) => { this._clockOpen = data && data.isOpen; };
            this.ipcRenderer.on('widget-window-state', this.ipcHandlers.widgetWindowState);
            this.ipcRenderer.on('clock-window-state', this.ipcHandlers.clockWindowState);
        }

        this._handlers.shortcutsKeydown = (e) => {
            if (e.ctrlKey || e.altKey || e.metaKey) { return; }
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        if (this.isRunning) {
                            this.ipcRenderer.send('timer-control', 'pause');
                        } else {
                            this.ipcRenderer.send('timer-control', 'start');
                        }
                    }
                    break;
                case 'KeyR':
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        this.ipcRenderer.send('timer-control', 'reset');
                    }
                    break;
                case 'KeyS':
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        this.ipcRenderer.send('timer-control', 'pause');
                    }
                    break;
                case 'Escape':
                case 'KeyD':
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        this.ipcRenderer.send('close-display');
                    }
                    break;
                case 'KeyW':
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        this.ipcRenderer.send(this._widgetOpen ? 'close-widget' : 'open-widget');
                    }
                    break;
                case 'KeyC':
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        this.ipcRenderer.send(this._clockOpen ? 'close-clock-widget' : 'open-clock-widget');
                    }
                    break;
            }

            // 1-8: Quick timer presets (5, 10, 15, 20, 25, 30, 45, 60 minutes)
            if (e.code >= 'Digit1' && e.code <= 'Digit8') {
                e.preventDefault();
                const presets = [300, 600, 900, 1200, 1500, 1800, 2700, 3600];
                const idx = parseInt(e.code.replace('Digit', '')) - 1;
                if (this.ipcRenderer) {
                    this.ipcRenderer.send('timer-command', { type: 'set', seconds: presets[idx] });
                }
            }
        };
        document.addEventListener('keydown', this._handlers.shortcutsKeydown);
    }

    updateRingSize() {
        if (this.timerRing) {
            const scale = this.timerScale / 100;
            // Используем transform для масштабирования всего таймера (круг + текст)
            this.timerRing.style.transform = `scale(${scale})`;
        }
    }

    initDefaultStyle() {
        // По умолчанию показываем круговой стиль
        if (this.timerRing) {this.timerRing.classList.add('active');}
        document.body.classList.add('style-circle');
    }

    initElements() {
        this.timeDisplay = document.getElementById('timeDisplay');
        this.progressRing = document.getElementById('progressRing');
        this.statusPill = document.getElementById('statusPill');
        this.statusText = document.getElementById('statusText');
        this.timerRing = document.getElementById('timerRing');
        this.currentTimeBlock = document.getElementById('currentTimeBlock');
        this.eventTimeBlock = document.getElementById('eventTimeBlock');
        this.endTimeBlock = document.getElementById('endTimeBlock');
        this.currentTimeEl = document.getElementById('currentTime');
        this.eventTimeEl = document.getElementById('eventTime');
        this.endTimeEl = document.getElementById('endTime');
        this.closeBtn = document.getElementById('closeBtn');

        // Элементы для разных стилей
        this.timerDigital = document.getElementById('timerDigital');
        this.timerFlip = document.getElementById('timerFlip');
        this.digitalTime = document.getElementById('digitalTime');
        this.digitalHoursGroup = document.getElementById('digitalHoursGroup');
        this.digitalHours = document.getElementById('digitalHours');
        this.digitalMinutes = document.getElementById('digitalMinutes');
        this.digitalSeconds = document.getElementById('digitalSeconds');

        // Flip карточки
        this.flipMinus = document.getElementById('flipMinus');
        this.flipHoursUnit = document.getElementById('flipHoursUnit');
        this.flipHoursSep = document.getElementById('flipHoursSep');
        this.flipHr1 = document.getElementById('flipHr1');
        this.flipHr2 = document.getElementById('flipHr2');
        this.flipMin1 = document.getElementById('flipMin1');
        this.flipMin2 = document.getElementById('flipMin2');
        this.flipSec1 = document.getElementById('flipSec1');
        this.flipSec2 = document.getElementById('flipSec2');

        // Аналоговые часы
        this.timerAnalog = document.getElementById('timerAnalog');
        this.analogHandHour = document.getElementById('analogHandHour');
        this.analogHandMinute = document.getElementById('analogHandMinute');
        this.analogHandSecond = document.getElementById('analogHandSecond');
        this.analogDigitalTime = document.getElementById('analogDigitalTime');
        this.clockNumbers = document.getElementById('clockNumbers');
    }

    initProgress() {
        this.progressRing.style.strokeDasharray = `${this.circumference}`;
        this.progressRing.style.strokeDashoffset = this.circumference;
    }

    startCurrentTimeClock() {
        const updateClock = () => {
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const mins = String(now.getMinutes()).padStart(2, '0');
            const secs = String(now.getSeconds()).padStart(2, '0');
            if (this.currentTimeEl) {
                this.currentTimeEl.textContent = `${hours}:${mins}:${secs}`;
            }
            // Обновляем стрелки мини-часов для текущего времени
            this.updateMiniClockHands(this.currentTimeBlock, now.getHours(), now.getMinutes(), now.getSeconds());
        };
        updateClock();
        const intervalId = setInterval(updateClock, 1000);
        this.intervals.push(intervalId);
    }

    updateMiniClockHands(block, hours, minutes, seconds = 0) {
        if (!block) {return;}

        // F-025: кэшируем стрелки по блоку, чтобы не звать querySelector каждый tick
        let hands = this._miniClockHandsCache ? this._miniClockHandsCache.get(block) : null;
        if (!hands) {
            hands = {
                hour: block.querySelector('.mini-hand-hour'),
                minute: block.querySelector('.mini-hand-minute'),
                second: block.querySelector('.mini-hand-second')
            };
            if (this._miniClockHandsCache) {
                this._miniClockHandsCache.set(block, hands);
            }
        }

        if (hands.hour) {
            // Часовая стрелка: 360/12 = 30 градусов на час + смещение от минут
            const hourDeg = (hours % 12) * 30 + minutes * 0.5;
            hands.hour.style.transform = `translateX(-50%) rotate(${hourDeg}deg)`;
        }
        if (hands.minute) {
            // Минутная стрелка: 360/60 = 6 градусов на минуту
            const minuteDeg = minutes * 6 + seconds * 0.1;
            hands.minute.style.transform = `translateX(-50%) rotate(${minuteDeg}deg)`;
        }
        if (hands.second) {
            // Секундная стрелка: 6 градусов на секунду
            const secondDeg = seconds * 6;
            hands.second.style.transform = `translateX(-50%) rotate(${secondDeg}deg)`;
        }
    }

    updateStaticMiniClock(block, timeString) {
        if (!block || !timeString) {return;}
        const parts = timeString.split(':');
        if (parts.length >= 2) {
            const hours = parseInt(parts[0], 10);
            const minutes = parseInt(parts[1], 10);
            this.updateMiniClockHands(block, hours, minutes);
        }
    }

    detectElectronAndSetup() {
        if (window.ipcRenderer) {
            this.ipcRenderer = window.ipcRenderer;
            this.setupIPC();
            return;
        }

        // Браузерный режим - синхронизация через localStorage
        this.startLocalStorageSync();
    }

    setupIPC() {
        // Кнопки управления окном
        if (this.closeBtn) {
            this._handlers.closeBtnClick = () => {
                this.ipcRenderer.send('close-display');
            };
            this.closeBtn.addEventListener('click', this._handlers.closeBtnClick);
        }
        const minimizeBtn = document.getElementById('minimizeBtn');
        if (minimizeBtn) {
            this._minimizeBtn = minimizeBtn;
            this._handlers.minimizeBtnClick = () => {
                this.ipcRenderer.send('minimize-window');
            };
            minimizeBtn.addEventListener('click', this._handlers.minimizeBtnClick);
        }
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        if (fullscreenBtn) {
            this._fullscreenBtn = fullscreenBtn;
            this._handlers.fullscreenBtnClick = () => {
                this.ipcRenderer.send('toggle-fullscreen');
            };
            fullscreenBtn.addEventListener('click', this._handlers.fullscreenBtnClick);
        }

        // Запрашиваем текущее состояние
        this.ipcRenderer.send('get-timer-state');

        // Сохраняем ссылки на обработчики для cleanup
        this.ipcHandlers.timerState = (event, state) => {
            // FIX BUG-012: Используем монотонный счетчик вместо timestamp
            // Это предотвращает проблемы при изменении системного времени
            const updateCounter = state.updateCounter || 0;
            if (updateCounter <= this.lastUpdateCounter) {return;}
            this.lastUpdateCounter = updateCounter;

            // Сохраняем timestamp для совместимости
            this.lastTimestamp = state.timestamp || Date.now();

            this.totalSeconds = Number(state.totalSeconds) || 0;
            this.remainingSeconds = Number(state.remainingSeconds) || 0;
            this.isRunning = !!state.isRunning;
            this.isPaused = !!state.isPaused;
            this.finished = !!state.finished;
            this.overrunLimitSeconds = Number(state.overrunLimitSeconds) || 0;

            this.updateDisplay();
        };

        this.ipcHandlers.colorsUpdate = (event, colors) => {
            this.applyColors(colors);
        };

        this.ipcHandlers.displaySettingsUpdate = (event, settings) => {
            if (settings.bgMode || settings.bgSolid || settings.bgGrad1) {
                this.applyBackground(settings);
            }
            this.applyDisplaySettings(settings);
        };

        // Регистрируем обработчики
        this.ipcRenderer.on('timer-state', this.ipcHandlers.timerState);
        this.ipcRenderer.on('colors-update', this.ipcHandlers.colorsUpdate);
        this.ipcRenderer.on('display-colors-update', this.ipcHandlers.colorsUpdate);
        this.ipcRenderer.on('display-settings-update', this.ipcHandlers.displaySettingsUpdate);
    }

    applyDisplaySettings(settings) {
        // Стиль таймера
        if (settings.timerStyle) {
            this.setTimerStyle(settings.timerStyle);
        }

        // Пресет расположения блоков времени
        const showBlocks = settings.showTimeBlocks !== undefined ? settings.showTimeBlocks : false;
        const preset = settings.timeLayoutPreset || 'frame';

        // Определяем позиции по пресету
        const presetPositions = {
            'frame': {
                current: 'top-center',
                start: 'bottom-left',
                end: 'bottom-right'
            },
            'top-line': {
                current: 'top-center',
                start: 'top-left-third',
                end: 'top-right-third'
            },
            'bottom-line': {
                current: 'bottom-center',
                start: 'bottom-left-third',
                end: 'bottom-right-third'
            },
            'corners': {
                current: 'top-left',
                start: 'top-right',
                end: 'bottom-right'
            }
        };

        const positions = presetPositions[preset] || presetPositions['frame'];

        // Only reapply positions when preset changes — preserve custom drag positions
        const presetChanged = this._lastPreset !== undefined && this._lastPreset !== preset;
        const firstLoad = this._lastPreset === undefined;
        this._lastPreset = preset;

        // Check if blocks have custom positions (from Alt+drag)
        const hasCustomPositions = (block) => block && block.classList.contains('custom-position');

        // Показ/скрытие всех блоков времени
        const showCurrentTime = settings.showCurrentTime !== false;
        if (this.currentTimeBlock) {
            this.currentTimeBlock.classList.toggle('visible', showBlocks && showCurrentTime);
            if (presetChanged || (firstLoad && !hasCustomPositions(this.currentTimeBlock))) {
                this.applyPosition(this.currentTimeBlock, positions.current);
            }
        }
        if (this.eventTimeBlock) {
            this.eventTimeBlock.classList.toggle('visible', showBlocks);
            if (presetChanged || (firstLoad && !hasCustomPositions(this.eventTimeBlock))) {
                this.applyPosition(this.eventTimeBlock, positions.start);
            }
        }
        if (this.endTimeBlock) {
            this.endTimeBlock.classList.toggle('visible', showBlocks);
            if (presetChanged || (firstLoad && !hasCustomPositions(this.endTimeBlock))) {
                this.applyPosition(this.endTimeBlock, positions.end);
            }
        }

        // Clear saved positions only on explicit preset change
        if (presetChanged) {
            try { localStorage.removeItem('displayBlockPositions'); } catch { /* ok */ }
        }

        // Время начала
        if (settings.eventTime && this.eventTimeEl) {
            this.eventTime = settings.eventTime;
            this.eventTimeEl.textContent = settings.eventTime;
            this.updateStaticMiniClock(this.eventTimeBlock, settings.eventTime);
        }

        // Время окончания
        if (settings.endTime && this.endTimeEl) {
            this.endTime = settings.endTime;
            this.endTimeEl.textContent = settings.endTime;
            this.updateStaticMiniClock(this.endTimeBlock, settings.endTime);
        }

        // Масштаб таймера — localStorage (от Ctrl+колесо) имеет приоритет над settings
        if (settings.timerScale !== undefined) {
            const localScale = parseInt(localStorage.getItem('displayTimerScale'));
            // Используем localStorage если он есть, иначе settings из control panel
            this.timerScale = localScale || settings.timerScale;
        }
        // Всегда применяем текущий масштаб
        {
            const scale = (this.timerScale || 100) / 100;
            this.updateRingSize();
            if (this.timerDigital) {this.timerDigital.style.transform = `scale(${scale})`;}
            if (this.timerFlip) {this.timerFlip.style.transform = `scale(${scale})`;}
            if (this.timerAnalog) {this.timerAnalog.style.transform = `scale(${scale})`;}
        }

        // Показ цифр на аналоговом циферблате
        if (settings.showAnalogNumbers !== undefined && this.clockNumbers) {
            this.clockNumbers.classList.toggle('visible', settings.showAnalogNumbers);
        }

        // Масштаб блоков времени (общий)
        if (settings.timeBlocksScale !== undefined) {
            // localStorage (от Ctrl+колесо/Shift+колесо) имеет приоритет
            const localBlockScale = parseInt(localStorage.getItem('displayBlockScale'));
            const effectiveScale = (localBlockScale || settings.timeBlocksScale) / 100;
            if (this.currentTimeBlock) {this.currentTimeBlock.style.setProperty('--info-scale', effectiveScale);}
            if (this.eventTimeBlock) {this.eventTimeBlock.style.setProperty('--info-scale', effectiveScale);}
            if (this.endTimeBlock) {this.endTimeBlock.style.setProperty('--info-scale', effectiveScale);}
        }
    }

    setTimerStyle(style) {
        this.timerStyle = style;

        // F-023: Инвалидируем кэши DOM-узлов на случай, если смена стиля пересоздаёт элементы
        this._cachedFlipDigits = null;
        this._cachedFlipSeparators = null;

        // Удаляем все классы стилей с body
        document.body.classList.remove('style-circle', 'style-digital', 'style-flip', 'style-analog');

        // Скрываем все стили таймера
        if (this.timerRing) {this.timerRing.classList.remove('active');}
        if (this.timerDigital) {this.timerDigital.classList.remove('active');}
        if (this.timerFlip) {this.timerFlip.classList.remove('active');}
        if (this.timerAnalog) {this.timerAnalog.classList.remove('active');}

        // Показываем выбранный и добавляем класс на body
        switch (style) {
            case 'circle':
                if (this.timerRing) {this.timerRing.classList.add('active');}
                document.body.classList.add('style-circle');
                break;
            case 'digital':
                if (this.timerDigital) {this.timerDigital.classList.add('active');}
                document.body.classList.add('style-digital');
                break;
            case 'flip':
                if (this.timerFlip) {this.timerFlip.classList.add('active');}
                document.body.classList.add('style-flip');
                break;
            case 'analog':
                if (this.timerAnalog) {this.timerAnalog.classList.add('active');}
                document.body.classList.add('style-analog');
                break;
        }

        // Обновляем отображение
        this.updateDisplay();
    }

    applyPosition(element, position) {
        // Clear custom positioning if present
        element.classList.remove(
            'top-left', 'top-center', 'top-right',
            'bottom-left', 'bottom-center', 'bottom-right',
            'top-left-third', 'top-right-third',
            'bottom-left-third', 'bottom-right-third',
            'custom-position'
        );
        element.style.left = '';
        element.style.top = '';
        element.style.right = '';
        element.style.bottom = '';
        element.style.marginLeft = '';
        element.style.marginRight = '';
        // Добавляем новый класс позиции
        element.classList.add(position);
    }

    startLocalStorageSync() {
        // FIX BUG-021: Используем storage event вместо polling для синхронизации состояния
        const defaultState = {
            totalSeconds: 0,
            remainingSeconds: 0,
            isRunning: false,
            isPaused: false,
            finished: false
        };

        // Обработчик обновления состояния из localStorage
        const applyState = (stateStr) => {
            if (!stateStr) {return;}
            let state;
            try { state = JSON.parse(stateStr); }
            catch (e) { console.error('JSON parse error:', e.message); state = defaultState; }

            this.totalSeconds = Number(state.totalSeconds) || 0;
            this.remainingSeconds = Number(state.remainingSeconds) || 0;
            this.isRunning = !!state.isRunning;
            this.isPaused = !!state.isPaused;
            this.finished = !!state.finished;
            this.updateDisplay();
        };

        // Начальное чтение
        applyState(localStorage.getItem('timerState'));

        // Слушаем изменения через storage event (вместо 100ms polling)
        this._handlers.storage = (e) => {
            if (e.key === 'timerState' && e.newValue) {
                applyState(e.newValue);
            }
            if (e.key === 'timerColors' && e.newValue) {
                let colors;
                try { colors = JSON.parse(e.newValue); }
                catch (err) { console.error('JSON parse error:', err.message); colors = {}; }
                if (colors) {
                    this.applyColors(colors);
                }
            }
        };
        window.addEventListener('storage', this._handlers.storage);

        // Fallback: редкий polling для случаев когда storage event не срабатывает
        // (происходит в рамках того же окна)
        const syncIntervalId = setInterval(() => {
            applyState(localStorage.getItem('timerState'));
        }, 1000); // 1с вместо 100мс
        this.intervals.push(syncIntervalId);
    }

    startColorSync() {
        // Периодическая проверка цветов (только цвета, не фон - фон управляется через IPC)
        const colorSyncIntervalId = setInterval(() => {
            this.syncColors();
        }, 2000);
        this.intervals.push(colorSyncIntervalId);
    }

    syncColors() {
        // Только цвета таймера, БЕЗ фона
        const saved = localStorage.getItem('timerColors');
        if (saved) {
            const colors = window.SecurityUtils
                ? window.SecurityUtils.safeJSONParse(saved, null)
                : null;
            if (colors) {
                this.applyColors(colors);
            }
        }
    }

    loadColors() {
        // При первой загрузке - применяем всё
        const saved = localStorage.getItem('timerColors');
        if (saved) {
            const colors = window.SecurityUtils
                ? window.SecurityUtils.safeJSONParse(saved, null)
                : null;
            if (colors) {
                this.applyColors(colors);
            }
        }

        // Фон - загружаем один раз и из правильного источника
        this.loadBackgroundSettings();
    }

    loadBackgroundSettings() {
        const bgSettings = localStorage.getItem('displayExtSettings');
        if (bgSettings) {
            const settings = window.SecurityUtils
                ? window.SecurityUtils.safeJSONParse(bgSettings, {})
                : {};

            if (settings && Object.keys(settings).length > 0) {
                // Для локального фона нужно дополнительно загрузить изображение
                if (settings.bgMode === 'local') {
                    const localBgImage = localStorage.getItem('localBgImage');
                    const localBgSettingsStr = localStorage.getItem('localBgSettings') || '{}';
                    const localBgSettings = window.SecurityUtils
                        ? window.SecurityUtils.safeJSONParse(localBgSettingsStr, {})
                        : {};

                    if (localBgImage) {
                        settings.bgLocalImage = localBgImage;
                        settings.bgLocalFit = localBgSettings.fit || 'cover';
                        settings.bgLocalOverlay = localBgSettings.overlay || 30;
                    }
                }

                this.applyBackground(settings);
                this.applyDisplaySettings(settings);
            }
        }
    }

    applyColors(colors) {
        const timerColor = colors.timer && this._isSafeColor(colors.timer) ? colors.timer : null;
        const progressColor = colors.progress && this._isSafeColor(colors.progress) ? colors.progress : null;

        // Circle style — SVG gradient stops + text glow
        const stop1 = document.querySelector('.grad-stop-1');
        const stop2 = document.querySelector('.grad-stop-2');
        if (stop1 && timerColor) { stop1.setAttribute('stop-color', timerColor); }
        if (stop2 && progressColor) { stop2.setAttribute('stop-color', progressColor); }
        if (timerColor) {
            document.documentElement.style.setProperty('--text-glow', `${timerColor}80`);
            document.documentElement.style.setProperty('--glow-color', `${timerColor}80`);
        }

        // Digital style — save base color, apply only if not in danger/overtime
        const digitalTime = document.getElementById('digitalTime');
        if (timerColor) {
            this._baseTimerColor = timerColor;
            this._baseTimerGlow = `0 0 20px ${timerColor}, 0 0 40px ${timerColor}, 0 0 80px ${timerColor}66`;
        }
        if (timerColor && digitalTime && !digitalTime.classList.contains('danger')) {
            digitalTime.style.color = timerColor;
            digitalTime.style.textShadow = this._baseTimerGlow;
        }

        // Flip style — save base color, apply only if not in danger/overtime
        // F-023: кэшируем узлы, чтобы не вызывать querySelectorAll на каждое обновление цвета
        if (timerColor) {
            if (!this._cachedFlipDigits) {
                this._cachedFlipDigits = document.querySelectorAll('.flip-digit');
            }
            if (!this._cachedFlipSeparators) {
                this._cachedFlipSeparators = document.querySelectorAll('.flip-separator');
            }
            this._cachedFlipDigits.forEach(el => {
                if (!el.closest('.danger')) {
                    el.style.color = timerColor;
                }
            });
            this._cachedFlipSeparators.forEach(el => {
                el.style.color = timerColor;
            });
        }

        // Info blocks (time blocks) — inherit timer color
        if (timerColor) {
            document.documentElement.style.setProperty('--info-color', timerColor);
            document.documentElement.style.setProperty('--info-color-dim', `${timerColor}80`);
            document.documentElement.style.setProperty('--info-glow', `${timerColor}33`);
        }

        // Analog style
        const secondHand = document.getElementById('analogHandSecond');
        const clockCenter = document.querySelector('.clock-center');
        const analogDigital = document.getElementById('analogDigitalTime');
        if (progressColor && secondHand) {
            secondHand.style.background =
                `linear-gradient(180deg, ${timerColor || progressColor} 0%, ${progressColor} 100%)`;
            secondHand.style.boxShadow = `0 0 15px ${progressColor}80`;
        }
        if (timerColor && clockCenter) {
            clockCenter.style.background = `linear-gradient(145deg, ${timerColor}, ${progressColor || timerColor})`;
            clockCenter.style.boxShadow = `0 0 15px ${timerColor}99`;
        }
        if (timerColor && analogDigital) {
            analogDigital.style.color = `${timerColor}b3`;
        }
    }

    // Called every tick to ensure overtime red color persists
    // (applyColors or cache logic may reset inline styles)
    _enforceOvertimeColors(secs) {
        const isOvertime = secs < 0;
        if (!isOvertime) { return; }

        // Circle time-text
        if (this.timeDisplay) {
            if (!this.timeDisplay.classList.contains('danger')) {
                this.timeDisplay.classList.add('danger', 'overtime');
            }
            this.timeDisplay.style.color = '#ff4444';
        }

        // Circle progress ring
        if (this.progressRing && !this.progressRing.classList.contains('danger')) {
            this.progressRing.classList.add('danger', 'overtime');
        }

        // Digital
        if (this.digitalTime) {
            if (!this.digitalTime.classList.contains('danger')) {
                this.digitalTime.classList.add('danger', 'overtime');
            }
            this.digitalTime.style.color = '#ff3333';
            this.digitalTime.style.textShadow = '0 0 20px #ff3333, 0 0 40px #ff3333, 0 0 80px #ff333366';
        }

        // Flip cards + separators
        const flipCards = [this.flipMin1, this.flipMin2, this.flipSec1, this.flipSec2].filter(Boolean);
        flipCards.forEach(card => {
            if (!card.classList.contains('danger')) {
                card.classList.add('danger', 'overtime');
            }
            const digit = card.querySelector('.flip-digit');
            if (digit) { digit.style.color = '#ff4444'; }
        });
        document.querySelectorAll('.flip-separator').forEach(el => {
            el.style.color = '#ff4444';
        });

        // Analog
        if (this.analogHandSecond) {
            this.analogHandSecond.style.background = 'linear-gradient(180deg, #ff4444 0%, #cc0000 100%)';
            this.analogHandSecond.style.boxShadow = '0 0 15px rgba(255,68,68,0.8)';
        }
        const clockCenter = this.timerAnalog ? this.timerAnalog.querySelector('.clock-center') : null;
        if (clockCenter) {
            clockCenter.style.background = 'linear-gradient(145deg, #ff4444, #cc0000)';
            clockCenter.style.boxShadow = '0 0 15px rgba(255,68,68,0.6)';
        }
        if (this.analogDigitalTime) {
            this.analogDigitalTime.style.color = '#ff4444';
        }
    }

    _isSafeColor(value) {
        return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d,.\s%]+\)$/.test(value);
    }

    _isSafeUrl(value) {
        if (typeof value !== 'string') { return false; }
        try {
            const url = new URL(value);
            return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
            return false;
        }
    }

    applyBackground(settings) {
        const mode = settings.bgMode || 'gradient';
        let bg = '';

        if (mode === 'solid' && settings.bgSolid && this._isSafeColor(settings.bgSolid)) {
            bg = settings.bgSolid;
        } else if (mode === 'gradient') {
            const c1 = this._isSafeColor(settings.bgGrad1) ? settings.bgGrad1 : '#0f0c29';
            const c2 = this._isSafeColor(settings.bgGrad2) ? settings.bgGrad2 : '#302b63';
            bg = `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
        } else if (mode === 'image' && settings.bgImageUrl) {
            const validation = window.SecurityUtils
                ? window.SecurityUtils.validateImageSource(settings.bgImageUrl)
                : null;
            if (validation && validation.valid) {
                bg = `url("${validation.sanitized.replace(/"/g, '\\"')}") center/cover no-repeat fixed, #000`;
            }
        } else if (mode === 'local' && settings.bgLocalImage) {
            // Локальный фон с настройками
            const fit = settings.bgLocalFit || 'cover';
            const overlay = settings.bgLocalOverlay || 30;

            // Создаём или обновляем оверлей
            this.applyLocalBackground(settings.bgLocalImage, fit, overlay);
            return; // Не применяем стандартный фон
        }

        // Убираем локальный оверлей если он был
        this.removeLocalBackgroundOverlay();

        if (bg) {
            document.body.style.setProperty('--bg', bg);
        }
    }

    applyLocalBackground(imageData, fit, overlay) {
        // Удаляем старый оверлей если есть
        this.removeLocalBackgroundOverlay();

        // Настройки размещения
        let bgSize, bgRepeat, bgPosition;
        if (fit === 'cover') {
            bgSize = 'cover';
            bgRepeat = 'no-repeat';
            bgPosition = 'center';
        } else if (fit === 'contain') {
            bgSize = 'contain';
            bgRepeat = 'no-repeat';
            bgPosition = 'center';
        } else if (fit === 'tile') {
            bgSize = 'auto';
            bgRepeat = 'repeat';
            bgPosition = 'top left';
        }

        // Безопасная установка фона с валидацией (FIX BUG-004: XSS prevention)
        if (window.SecurityUtils) {
            const success = window.SecurityUtils.safeSetBackgroundImage(document.body, imageData);
            if (!success) {
                console.error('Failed to set background image: invalid or unsafe URL');
                return;
            }
        } else {
            console.error('SecurityUtils not loaded, background image rejected for security');
            return;
        }

        document.body.style.backgroundSize = bgSize;
        document.body.style.backgroundRepeat = bgRepeat;
        document.body.style.backgroundPosition = bgPosition;
        document.body.style.backgroundAttachment = 'fixed';

        // Создаём оверлей для затемнения
        let overlayEl = document.getElementById('bgOverlay');
        if (!overlayEl) {
            overlayEl = document.createElement('div');
            overlayEl.id = 'bgOverlay';
            overlayEl.style.cssText = `
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 0;
                transition: background 0.3s;
            `;
            document.body.insertBefore(overlayEl, document.body.firstChild);
        }

        // Валидация overlay значения
        const safeOverlay = Math.max(0, Math.min(100, parseFloat(overlay) || 0));
        overlayEl.style.background = `rgba(0, 0, 0, ${safeOverlay / 100})`;
    }

    removeLocalBackgroundOverlay() {
        const overlayEl = document.getElementById('bgOverlay');
        if (overlayEl) {
            overlayEl.remove();
        }
        // Сбрасываем inline стили фона
        document.body.style.backgroundImage = '';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundRepeat = '';
        document.body.style.backgroundPosition = '';
        document.body.style.backgroundAttachment = '';
    }

    // Заменяет innerHTML на безопасное обновление через DOM API.
    // Кэширует span/textNode, чтобы не пересоздавать DOM каждую секунду.
    _setTimeDisplayContent(formatted, isNegative) {
        if (!this.timeDisplay) { return; }
        if (isNegative && formatted.startsWith('-')) {
            const textPart = formatted.slice(1);
            if (!this._timeDisplayMinusSpan) {
                // Первая инициализация: очищаем и создаём span + textNode
                while (this.timeDisplay.firstChild) { this.timeDisplay.removeChild(this.timeDisplay.firstChild); }
                this._timeDisplayMinusSpan = document.createElement('span');
                this._timeDisplayMinusSpan.className = 'time-minus';
                this._timeDisplayMinusSpan.textContent = '\u2212';
                this._timeDisplayTextNode = document.createTextNode(textPart);
                this.timeDisplay.appendChild(this._timeDisplayMinusSpan);
                this.timeDisplay.appendChild(this._timeDisplayTextNode);
            } else {
                // Убедимся, что наши кэшированные узлы всё ещё в DOM
                if (this._timeDisplayMinusSpan.parentNode !== this.timeDisplay) {
                    while (this.timeDisplay.firstChild) { this.timeDisplay.removeChild(this.timeDisplay.firstChild); }
                    this.timeDisplay.appendChild(this._timeDisplayMinusSpan);
                    this.timeDisplay.appendChild(this._timeDisplayTextNode);
                }
                this._timeDisplayTextNode.data = textPart;
            }
        } else {
            // Переход в обычный режим — сбрасываем кэш span
            this.timeDisplay.textContent = formatted;
            this._timeDisplayMinusSpan = null;
            this._timeDisplayTextNode = null;
        }
    }

    // Заменяет innerHTML в analogDigitalTime на DOM API с кэшированием узлов.
    _setAnalogTimeContent(timeStr, isNegative) {
        if (!this.analogDigitalTime) { return; }
        if (isNegative) {
            if (!this._analogMinusSpan) {
                while (this.analogDigitalTime.firstChild) {
                    this.analogDigitalTime.removeChild(this.analogDigitalTime.firstChild);
                }
                this._analogMinusSpan = document.createElement('span');
                this._analogMinusSpan.className = 'analog-time-minus';
                this._analogMinusSpan.textContent = '\u2212';
                this._analogTextNode = document.createTextNode(timeStr);
                this.analogDigitalTime.appendChild(this._analogMinusSpan);
                this.analogDigitalTime.appendChild(this._analogTextNode);
            } else {
                if (this._analogMinusSpan.parentNode !== this.analogDigitalTime) {
                    while (this.analogDigitalTime.firstChild) {
                        this.analogDigitalTime.removeChild(this.analogDigitalTime.firstChild);
                    }
                    this.analogDigitalTime.appendChild(this._analogMinusSpan);
                    this.analogDigitalTime.appendChild(this._analogTextNode);
                }
                this._analogTextNode.data = timeStr;
            }
        } else {
            this.analogDigitalTime.textContent = timeStr;
            this._analogMinusSpan = null;
            this._analogTextNode = null;
        }
    }

    updateDisplay() {
        const secs = Math.floor(this.remainingSeconds);

        // ОПТИМИЗАЦИЯ (FIX BUG-007): Проверка изменений перед обновлением
        // Если секунды не изменились, нечего обновлять
        if (this.cache.lastSeconds === secs && !this.finished) {
            // FIX BUG-C: BUT статус проверяем ВСЕГДА (не зависит от кэша секунд)
            const status = this.getTimerStatusValue(secs);
            if (this.cache.lastStatus !== status || this.cache.lastRunning !== this.isRunning) {
                this.updateStatus(secs);
                this.cache.lastStatus = status;
                this.cache.lastRunning = this.isRunning;
            }
            return;
        }

        const formatted = this.formatTime(secs);
        const hasFormattedChanged = this.cache.lastFormatted !== formatted;

        // Обновляем время для кругового стиля (только если изменилось)
        if (hasFormattedChanged) {
            // Минус-знак в отдельном span с width:0, чтобы цифры оставались по центру
            this._setTimeDisplayContent(formatted, secs < 0);

            // Добавляем класс compact для длинного времени (минус или часы)
            const isCompact = secs < 0 || Math.abs(secs) >= 3600 || formatted.length > 5;
            this.timeDisplay.classList.toggle('compact', isCompact);

            this.cache.lastFormatted = formatted;
        }

        // Обновляем цифровой стиль (только если изменилось)
        if (hasFormattedChanged || this.cache.lastDigitalUpdate !== secs) {
            this.updateDigitalDisplay(secs, formatted);
            this.cache.lastDigitalUpdate = secs;
        }

        // Обновляем перекидные часы (только если изменилось)
        if (hasFormattedChanged || this.cache.lastFlipUpdate !== secs) {
            this.updateFlipDisplay(secs);
            this.cache.lastFlipUpdate = secs;
        }

        // Обновляем аналоговые часы (только если изменилось)
        if (hasFormattedChanged || this.cache.lastAnalogUpdate !== secs) {
            this.updateAnalogDisplay(secs);
            this.cache.lastAnalogUpdate = secs;
        }

        // Прогресс обновляется только если процент изменился
        const progress = this.calculateProgressValue();
        if (this.cache.lastProgress !== progress) {
            this.updateProgress();
            this.cache.lastProgress = progress;
        }

        // Force overtime color on every tick (applyColors or cache may reset it)
        this._enforceOvertimeColors(secs);

        // Статус меняется редко (normal → warning → danger → overtime)
        const status = this.getTimerStatusValue(secs);
        if (this.cache.lastStatus !== status) {
            this.updateStatus(secs);
            this.cache.lastStatus = status;
        }

        // Сохраняем последнее значение секунд
        this.cache.lastSeconds = secs;

        // Эффект завершения
        if (this.finished && !this.flashInterval) {
            this.triggerFinishEffect();
        }
    }

    // Вспомогательная функция для вычисления прогресса (для кэширования)
    calculateProgressValue() {
        if (this.totalSeconds === 0) {return 0;}

        // FIX BUG-016: Handle overtime progress correctly
        if (this.remainingSeconds < 0) {
            // В overtime режиме показываем прогресс от 0 до -1
            // Это позволит визуализировать "обратный" прогресс
            const overrunLimit = this.overrunLimitSeconds || 300;
            const overtimeRatio = Math.abs(this.remainingSeconds) / overrunLimit;
            return -Math.min(1, overtimeRatio); // Отрицательное значение
        }

        return Math.round((this.remainingSeconds / this.totalSeconds) * 1000) / 1000;
    }

    // Вспомогательная функция для определения статуса (для кэширования)
    getTimerStatusValue(secs) {
        if (secs < 0) {return 'overtime';}
        if (secs === 0 && this.totalSeconds > 0) {return 'danger';}
        if (secs <= 60 && secs > 0) {return 'warning';}
        return 'normal';
    }

    updateDigitalDisplay(secs, _formatted) {
        if (!this.digitalMinutes || !this.digitalSeconds) {return;}

        const absSecs = Math.abs(secs);
        const hours = Math.floor(absSecs / 3600);
        const mins = Math.floor((absSecs % 3600) / 60);
        const seconds = absSecs % 60;

        const prefix = secs < 0 ? '-' : '';

        // Show/hide hours group
        if (this.digitalHoursGroup && this.digitalHours) {
            if (hours > 0) {
                this.digitalHoursGroup.style.display = '';
                this.digitalHours.textContent = prefix + String(hours);
                this.digitalMinutes.textContent = String(mins).padStart(2, '0');
            } else {
                this.digitalHoursGroup.style.display = 'none';
                this.digitalMinutes.textContent = prefix + String(mins).padStart(2, '0');
            }
        } else {
            this.digitalMinutes.textContent = prefix + String(mins).padStart(2, '0');
        }
        this.digitalSeconds.textContent = String(seconds).padStart(2, '0');

        // Классы предупреждения + inline color override (applyColors sets inline style)
        this.digitalTime.classList.remove('warning', 'danger', 'overtime');
        const isOvertime = secs < 0;
        if (isOvertime) {
            this.digitalTime.classList.add('danger', 'overtime');
            this.digitalTime.style.color = '#ff3333';
            this.digitalTime.style.textShadow = '0 0 20px #ff3333, 0 0 40px #ff3333, 0 0 80px #ff333366';
        } else if (this.totalSeconds > 0) {
            const percentLeft = (this.remainingSeconds / this.totalSeconds) * 100;
            if (percentLeft <= 10 && percentLeft > 0) {
                this.digitalTime.classList.add('danger');
                this.digitalTime.style.color = '#ff3333';
                this.digitalTime.style.textShadow = '0 0 20px #ff3333, 0 0 40px #ff3333, 0 0 80px #ff333366';
            } else if (percentLeft <= 25) {
                this.digitalTime.classList.add('warning');
                this.digitalTime.style.color = '#ffc107';
                this.digitalTime.style.textShadow = '0 0 20px #ffc107, 0 0 40px #ffc107, 0 0 80px #ffc10766';
            } else if (this._baseTimerColor) {
                this.digitalTime.style.color = this._baseTimerColor;
                this.digitalTime.style.textShadow = this._baseTimerGlow || '';
            }
        } else if (this._baseTimerColor) {
            this.digitalTime.style.color = this._baseTimerColor;
            this.digitalTime.style.textShadow = this._baseTimerGlow || '';
        }
    }

    updateFlipDisplay(secs) {
        if (!this.flipMin1 || !this.flipMin2 || !this.flipSec1 || !this.flipSec2) {return;}

        const isNegative = secs < 0;
        const absSecs = Math.abs(secs);
        const hours = Math.floor(absSecs / 3600);
        const mins = Math.floor((absSecs % 3600) / 60);
        const seconds = absSecs % 60;

        // Показываем/скрываем знак минуса
        if (this.flipMinus) {
            this.flipMinus.classList.toggle('visible', isNegative);
        }

        // Показываем/скрываем часы
        const showHours = hours > 0 || this.totalSeconds >= 3600;
        if (this.flipHoursUnit && this.flipHoursSep) {
            this.flipHoursUnit.style.display = showHours ? '' : 'none';
            this.flipHoursSep.style.display = showHours ? '' : 'none';
            if (showHours && this.flipHr1 && this.flipHr2) {
                this.updateFlipCard(this.flipHr1, String(Math.floor(hours / 10) % 10), 'hr1');
                this.updateFlipCard(this.flipHr2, String(hours % 10), 'hr2');
            }
        }

        const min1 = String(Math.floor(mins / 10) % 10);
        const min2 = String(mins % 10);
        const sec1 = String(Math.floor(seconds / 10));
        const sec2 = String(seconds % 10);

        // Анимация перекидывания при изменении
        this.updateFlipCard(this.flipMin1, min1, 'min1');
        this.updateFlipCard(this.flipMin2, min2, 'min2');
        this.updateFlipCard(this.flipSec1, sec1, 'sec1');
        this.updateFlipCard(this.flipSec2, sec2, 'sec2');

        // Классы предупреждения + inline color override (applyColors sets inline style)
        const flipCards = [this.flipMin1, this.flipMin2, this.flipSec1, this.flipSec2];
        if (showHours && this.flipHr1 && this.flipHr2) {
            flipCards.push(this.flipHr1, this.flipHr2);
        }
        flipCards.forEach(card => {
            card.classList.remove('warning', 'danger', 'overtime');
        });

        const isOvertime = secs < 0;
        const flipSeparators = document.querySelectorAll('.flip-separator');
        if (isOvertime) {
            flipCards.forEach(card => {
                card.classList.add('danger', 'overtime');
                const digit = card.querySelector('.flip-digit');
                if (digit) { digit.style.color = '#ff4444'; }
            });
            flipSeparators.forEach(el => { el.style.color = '#ff4444'; });
        } else if (this.totalSeconds > 0) {
            const percentLeft = (this.remainingSeconds / this.totalSeconds) * 100;
            flipCards.forEach(card => {
                if (percentLeft <= 10 && percentLeft > 0) {
                    card.classList.add('danger');
                    const digit = card.querySelector('.flip-digit');
                    if (digit) { digit.style.color = '#ff4444'; }
                } else if (percentLeft <= 25) {
                    card.classList.add('warning');
                    const digit = card.querySelector('.flip-digit');
                    if (digit) { digit.style.color = '#ffc107'; }
                } else {
                    const digit = card.querySelector('.flip-digit');
                    if (digit && this._baseTimerColor) { digit.style.color = this._baseTimerColor; }
                }
            });
            if (percentLeft <= 10 && percentLeft > 0) {
                flipSeparators.forEach(el => { el.style.color = '#ff4444'; });
            } else if (percentLeft <= 25) {
                flipSeparators.forEach(el => { el.style.color = '#ffc107'; });
            } else if (this._baseTimerColor) {
                flipSeparators.forEach(el => { el.style.color = this._baseTimerColor; });
            }
        } else {
            flipCards.forEach(card => {
                const digit = card.querySelector('.flip-digit');
                if (digit && this._baseTimerColor) { digit.style.color = this._baseTimerColor; }
            });
            if (this._baseTimerColor) {
                flipSeparators.forEach(el => { el.style.color = this._baseTimerColor; });
            }
        }
    }

    updateFlipCard(card, value, key) {
        const digit = card.querySelector('.flip-digit');
        if (digit.textContent !== value) {
            // Запускаем анимацию
            card.classList.add('flipping');
            digit.textContent = value;
            this.lastFlipValues[key] = value;

            // F-024: трекинг setTimeout для cleanup
            const flipTimeoutId = setTimeout(() => {
                card.classList.remove('flipping');
                const idx = this._timeouts.indexOf(flipTimeoutId);
                if (idx !== -1) { this._timeouts.splice(idx, 1); }
            }, 300);
            this._timeouts.push(flipTimeoutId);
        }
    }

    updateAnalogDisplay(secs) {
        if (!this.analogHandMinute || !this.analogHandSecond) {return;}

        const absSecs = Math.abs(secs);
        const totalMins = absSecs / 60;
        const seconds = absSecs % 60;

        // Минутная стрелка - полный оборот за 60 минут
        // Плавное движение с учетом секунд
        const minuteDeg = (totalMins / 60) * 360;
        this.analogHandMinute.style.transform = `rotate(${minuteDeg}deg)`;

        // Секундная стрелка - полный оборот за 60 секунд
        const secondDeg = (seconds / 60) * 360;
        this.analogHandSecond.style.transform = `rotate(${secondDeg}deg)`;

        // Обновляем цифровое время под циферблатом
        if (this.analogDigitalTime) {
            const hours = Math.floor(absSecs / 3600);
            const mins = Math.floor((absSecs % 3600) / 60);
            let timeStr;
            if (hours > 0) {
                timeStr = `${hours}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            } else {
                timeStr = `${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }
            this._setAnalogTimeContent(timeStr, secs < 0);
        }

        // Классы предупреждения для центра и стрелок
        const clockCenter = this.timerAnalog ? this.timerAnalog.querySelector('.clock-center') : null;
        const analogElements = [this.analogHandMinute, this.analogHandSecond, clockCenter];

        analogElements.forEach(el => {
            if (el) {el.classList.remove('warning', 'danger', 'overtime');}
        });
        if (this.analogDigitalTime) {
            this.analogDigitalTime.classList.remove('warning', 'danger', 'overtime');
        }

        const isOvertime = secs < 0;
        if (isOvertime) {
            analogElements.forEach(el => {
                if (el) {el.classList.add('danger', 'overtime');}
            });
            if (this.analogDigitalTime) {
                this.analogDigitalTime.classList.add('danger', 'overtime');
                this.analogDigitalTime.style.color = '#ff4444';
            }
            // Override inline styles from applyColors
            if (this.analogHandSecond) {
                this.analogHandSecond.style.background = 'linear-gradient(180deg, #ff4444 0%, #cc0000 100%)';
                this.analogHandSecond.style.boxShadow = '0 0 15px rgba(255,68,68,0.8)';
            }
            if (clockCenter) {
                clockCenter.style.background = 'linear-gradient(145deg, #ff4444, #cc0000)';
                clockCenter.style.boxShadow = '0 0 15px rgba(255,68,68,0.6)';
            }
        } else if (this.totalSeconds > 0) {
            const percentLeft = (this.remainingSeconds / this.totalSeconds) * 100;
            if (percentLeft <= 10 && percentLeft > 0) {
                analogElements.forEach(el => {
                    if (el) {el.classList.add('danger');}
                });
                if (this.analogDigitalTime) {
                    this.analogDigitalTime.classList.add('danger');
                }
            } else if (percentLeft <= 25) {
                analogElements.forEach(el => {
                    if (el) {el.classList.add('warning');}
                });
                if (this.analogDigitalTime) {
                    this.analogDigitalTime.classList.add('warning');
                }
            }
        }
    }

    updateProgress() {
        if (this.totalSeconds > 0) {
            // FIX BUG-016: Use calculateProgressValue() for correct overtime handling
            const progress = this.calculateProgressValue();

            // Для overtime (отрицательный прогресс) показываем обратное заполнение
            const ratio = progress < 0 ? 0 : Math.max(0, Math.min(1, progress));
            const offset = this.circumference - (ratio * this.circumference);
            this.progressRing.style.strokeDashoffset = offset;

            // Цветовые предупреждения
            const percentLeft = (this.remainingSeconds / this.totalSeconds) * 100;
            const isOvertime = this.remainingSeconds < 0;

            this.progressRing.classList.remove('warning', 'danger', 'overtime');
            this.timeDisplay.classList.remove('warning', 'danger', 'overtime');

            if (isOvertime) {
                this.progressRing.classList.add('danger', 'overtime');
                this.timeDisplay.classList.add('danger', 'overtime');
                // Force inline color override — CSS class alone may be insufficient
                this.timeDisplay.style.color = '#ff4444';
            } else if (percentLeft <= 10 && percentLeft > 0) {
                this.progressRing.classList.add('danger');
                this.timeDisplay.classList.add('danger');
                this.timeDisplay.style.color = '#ff4444';
            } else if (percentLeft <= 25) {
                this.progressRing.classList.add('warning');
                this.timeDisplay.classList.add('warning');
                this.timeDisplay.style.color = '#ffc107';
            } else {
                this.timeDisplay.style.color = '';
            }
        } else {
            this.progressRing.style.strokeDashoffset = this.circumference;
        }
    }

    updateStatus(secs) {
        this.statusPill.classList.remove('running', 'paused', 'finished', 'overtime');

        if (this.finished || (secs <= 0 && this.totalSeconds > 0 && !this.isRunning)) {
            this.statusText.textContent = 'Время вышло!';
            this.statusPill.classList.add('finished');
        } else if (this.isRunning) {
            if (secs < 0) {
                this.statusText.textContent = 'Перерасход времени';
                this.statusPill.classList.add('overtime');
            } else {
                this.statusText.textContent = 'Таймер активен';
                this.statusPill.classList.add('running');
            }
        } else if (this.isPaused) {
            this.statusText.textContent = 'На паузе';
            this.statusPill.classList.add('paused');
        } else {
            this.statusText.textContent = 'Готов к запуску';
        }

        this.updateChipState({ finished: this.finished, remainingSeconds: secs, isRunning: this.isRunning, isPaused: this.isPaused });
    }

    updateChipState(state) {
        const pill = this.statusPill;
        const label = document.getElementById('heroLabel');
        const glyphEl = pill && pill.querySelector('.status-glyph');
        if (!pill) { return; }

        pill.classList.remove('is-success', 'is-attention');
        let labelText = 'Осталось';
        let glyph = '·';

        if (state.finished) {
            pill.classList.add('is-success');
            labelText = 'Завершено';
            glyph = '✓';
        } else if (state.remainingSeconds < 0) {
            pill.classList.add('is-attention');
            labelText = 'Сверх времени';
            glyph = '!';
        } else if (state.isRunning && !state.isPaused) {
            pill.classList.add('is-success');
            glyph = '▶';
        } else if (state.isPaused) {
            labelText = 'Пауза';
            glyph = '‖';
        }

        if (glyphEl) { glyphEl.textContent = glyph; }
        if (label) { label.textContent = labelText; }
    }

    triggerFinishEffect() {
        this.flashCount = 0;
        const maxFlashes = (window.CONFIG && window.CONFIG.MAX_FLASH_COUNT) || 6;
        const flashInterval = (window.CONFIG && window.CONFIG.FLASH_INTERVAL) || 250;

        this.flashInterval = setInterval(() => {
            document.body.classList.toggle('flash-mode');
            this.flashCount++;

            if (this.flashCount >= maxFlashes * 2) {
                clearInterval(this.flashInterval);
                const idx = this._intervals.indexOf(this.flashInterval);
                if (idx !== -1) { this._intervals.splice(idx, 1); }
                this.flashInterval = null;
                document.body.classList.remove('flash-mode');
            }
        }, flashInterval);
        // F-024: трекинг flashInterval для cleanup
        this._intervals.push(this.flashInterval);
    }

    formatTime(seconds) {
        return window.TimeUtils.formatTimeShort(seconds);
    }

    // ===== Block Controls: Ctrl+Scale, Alt+Drag =====

    setupBlockControls() {
        const BLOCK_MIN_SCALE = 50;
        const BLOCK_MAX_SCALE = 600;
        const TIMER_MIN_SCALE = 30;
        const TIMER_MAX_SCALE = 300;
        const STORAGE_KEY = 'displayBlockPositions';
        const STORAGE_BLOCK_SCALE_KEY = 'displayBlockScale';
        const STORAGE_TIMER_SCALE_KEY = 'displayTimerScale';

        // --- Alt key tracking (for block drag) ---
        this._handlers.altKeydown = (e) => {
            if (e.key === 'Alt') { e.preventDefault(); document.body.classList.add('alt-active'); }
        };
        this._handlers.altKeyup = (e) => {
            if (e.key === 'Alt') { document.body.classList.remove('alt-active'); }
        };
        this._handlers.altBlur = () => {
            document.body.classList.remove('alt-active');
        };
        document.addEventListener('keydown', this._handlers.altKeydown);
        document.addEventListener('keyup', this._handlers.altKeyup);
        window.addEventListener('blur', this._handlers.altBlur);

        // --- Ctrl+Wheel = scale (context-sensitive: hover over blocks → block scale, else → timer scale) ---
        // --- Shift+Wheel = block scale (explicit) ---
        const scaleTimer = (delta) => {
            const cur = this.timerScale || 100;
            const newPct = Math.max(TIMER_MIN_SCALE, Math.min(TIMER_MAX_SCALE, cur + delta));
            if (newPct !== cur) {
                const scale = newPct / 100;
                this.timerScale = newPct;
                this.updateRingSize();
                if (this.timerDigital) { this.timerDigital.style.transform = `scale(${scale})`; }
                if (this.timerFlip) { this.timerFlip.style.transform = `scale(${scale})`; }
                if (this.timerAnalog) { this.timerAnalog.style.transform = `scale(${scale})`; }
                this._safeSetItem(STORAGE_TIMER_SCALE_KEY, String(newPct));
            }
        };
        const scaleBlocks = (delta) => {
            const raw = this.currentTimeBlock
                ? getComputedStyle(this.currentTimeBlock).getPropertyValue('--info-scale')
                : '1.2';
            const cur = Math.round(parseFloat(raw) * 100) || 120;
            const newPct = Math.max(BLOCK_MIN_SCALE, Math.min(BLOCK_MAX_SCALE, cur + delta));
            if (newPct !== cur) {
                const scale = newPct / 100;
                [this.currentTimeBlock, this.eventTimeBlock, this.endTimeBlock].forEach(b => {
                    if (b) { b.style.setProperty('--info-scale', scale); }
                });
                this._safeSetItem(STORAGE_BLOCK_SCALE_KEY, String(newPct));
            }
        };

        this._handlers.wheel = (e) => {
            if (!e.ctrlKey && !e.shiftKey) { return; }
            e.preventDefault();
            const step = 10;
            const delta = e.deltaY < 0 ? step : -step;

            // Shift+Wheel always scales blocks
            if (e.shiftKey) {
                scaleBlocks(delta);
                return;
            }

            // Ctrl+Wheel — context-sensitive: hover over info block → block scale, else → timer scale
            const target = e.target;
            const isOverBlock = target.closest('.info-block');
            if (isOverBlock) {
                scaleBlocks(delta);
            } else {
                scaleTimer(delta);
            }
        };
        document.addEventListener('wheel', this._handlers.wheel, { passive: false });

        // --- Alt+Drag blocks ---
        const infoBlocks = [this.currentTimeBlock, this.eventTimeBlock, this.endTimeBlock].filter(Boolean);
        const blockIds = ['currentTime', 'eventTime', 'endTime'];

        const saveBlockPositions = () => {
            const positions = {};
            infoBlocks.forEach((block, i) => {
                if (block.classList.contains('custom-position')) {
                    positions[blockIds[i]] = {
                        left: parseInt(block.style.left) || 0,
                        top: parseInt(block.style.top) || 0
                    };
                }
            });
            if (Object.keys(positions).length > 0) {
                this._safeSetItem(STORAGE_KEY, JSON.stringify(positions));
            }
        };

        // Храним ссылки на mousedown handlers блоков для cleanup
        this._handlers.blockMousedowns = [];

        infoBlocks.forEach((block) => {
            const blockMousedown = (e) => {
                if (!e.altKey) { return; }
                e.preventDefault();
                e.stopPropagation();
                block.classList.add('dragging-block');

                // If block uses preset positioning, switch to absolute left/top
                if (!block.classList.contains('custom-position')) {
                    const rect = block.getBoundingClientRect();
                    // Remove all position classes
                    block.classList.remove(
                        'top-left', 'top-center', 'top-right',
                        'bottom-left', 'bottom-center', 'bottom-right',
                        'top-left-third', 'top-right-third',
                        'bottom-left-third', 'bottom-right-third'
                    );
                    block.classList.add('custom-position');
                    // Clear any preset CSS positioning
                    block.style.right = '';
                    block.style.bottom = '';
                    block.style.marginLeft = '';
                    block.style.marginRight = '';
                    block.style.left = rect.left + 'px';
                    block.style.top = rect.top + 'px';
                }

                const startScreenX = e.screenX;
                const startScreenY = e.screenY;
                const startLeft = parseInt(block.style.left) || 0;
                const startTop = parseInt(block.style.top) || 0;
                let rafId = 0;

                const onMove = (ev) => {
                    ev.preventDefault();
                    if (rafId) { cancelAnimationFrame(rafId); }
                    rafId = requestAnimationFrame(() => {
                        const dx = ev.screenX - startScreenX;
                        const dy = ev.screenY - startScreenY;
                        block.style.left = (startLeft + dx) + 'px';
                        block.style.top = (startTop + dy) + 'px';
                    });
                };

                const onUp = () => {
                    block.classList.remove('dragging-block');
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (rafId) { cancelAnimationFrame(rafId); }
                    saveBlockPositions();
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            };
            this._handlers.blockMousedowns.push({ block, handler: blockMousedown });
            block.addEventListener('mousedown', blockMousedown);
        });

        // --- Window drag in windowed (non-fullscreen) mode ---
        let isWindowDrag = false;
        let winDragStartX = 0, winDragStartY = 0;

        this._handlers.windowDragMousedown = (e) => {
            // Only drag when not fullscreen, not Alt (block drag), not on controls/buttons
            if (e.altKey || e.ctrlKey || e.shiftKey) { return; }
            if (e.target.closest('.window-controls, .info-block, button')) { return; }
            // Check if window is NOT fullscreen (body width === screen width as heuristic)
            if (window.innerWidth === screen.width && window.innerHeight === screen.height) { return; }
            isWindowDrag = true;
            winDragStartX = e.screenX;
            winDragStartY = e.screenY;
        };

        this._handlers.windowDragMousemove = (e) => {
            if (!isWindowDrag) { return; }
            const dx = e.screenX - winDragStartX;
            const dy = e.screenY - winDragStartY;
            if (dx !== 0 || dy !== 0) {
                this.ipcRenderer.send('display-move', { deltaX: dx, deltaY: dy });
                winDragStartX = e.screenX;
                winDragStartY = e.screenY;
            }
        };

        this._handlers.windowDragMouseup = () => {
            isWindowDrag = false;
        };

        document.addEventListener('mousedown', this._handlers.windowDragMousedown);
        document.addEventListener('mousemove', this._handlers.windowDragMousemove);
        document.addEventListener('mouseup', this._handlers.windowDragMouseup);

        // Store references for preset reset
        this._blockControlRefs = { infoBlocks, blockIds, STORAGE_KEY, STORAGE_BLOCK_SCALE_KEY };
    }

    restoreBlockPositions() {
        const STORAGE_KEY = 'displayBlockPositions';
        const STORAGE_BLOCK_SCALE_KEY = 'displayBlockScale';
        const STORAGE_TIMER_SCALE_KEY = 'displayTimerScale';

        // Restore timer scale
        try {
            const savedTimerScale = localStorage.getItem(STORAGE_TIMER_SCALE_KEY);
            if (savedTimerScale) {
                const pct = parseInt(savedTimerScale);
                if (pct >= 30 && pct <= 300) {
                    this.timerScale = pct;
                    const scale = pct / 100;
                    this.updateRingSize();
                    if (this.timerDigital) { this.timerDigital.style.transform = `scale(${scale})`; }
                    if (this.timerFlip) { this.timerFlip.style.transform = `scale(${scale})`; }
                    if (this.timerAnalog) { this.timerAnalog.style.transform = `scale(${scale})`; }
                }
            }
        } catch { /* ok */ }

        // Restore block scale
        try {
            const savedScale = localStorage.getItem(STORAGE_BLOCK_SCALE_KEY);
            if (savedScale) {
                const pct = parseInt(savedScale);
                if (pct >= 50 && pct <= 600) {
                    const scale = pct / 100;
                    [this.currentTimeBlock, this.eventTimeBlock, this.endTimeBlock].forEach(b => {
                        if (b) { b.style.setProperty('--info-scale', scale); }
                    });
                }
            }
        } catch { /* ok */ }

        // Restore positions (with JSON structure validation)
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) { return; }
            let positions;
            try { positions = JSON.parse(saved); } catch { return; }
            if (typeof positions !== 'object' || positions === null) { return; }

            const blocks = { currentTime: this.currentTimeBlock, eventTime: this.eventTimeBlock, endTime: this.endTimeBlock };
            for (const [key, block] of Object.entries(blocks)) {
                if (!block) { continue; }
                const pos = positions[key];
                if (!pos || typeof pos !== 'object') { continue; }
                if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) { continue; }
                // Clamp to reasonable screen bounds (protects against corrupted data)
                const left = Math.max(-5000, Math.min(5000, pos.left));
                const top = Math.max(-5000, Math.min(5000, pos.top));
                block.classList.remove(
                    'top-left', 'top-center', 'top-right',
                    'bottom-left', 'bottom-center', 'bottom-right',
                    'top-left-third', 'top-right-third',
                    'bottom-left-third', 'bottom-right-third'
                );
                block.classList.add('custom-position');
                block.style.right = '';
                block.style.bottom = '';
                block.style.marginLeft = '';
                block.style.marginRight = '';
                block.style.left = left + 'px';
                block.style.top = top + 'px';
            }
        } catch { /* ok */ }
    }

    cleanup() {
        // Очищаем все интервалы
        this.intervals.forEach(intervalId => clearInterval(intervalId));
        this.intervals = [];

        // Очищаем flashInterval если он активен
        if (this.flashInterval) {
            clearInterval(this.flashInterval);
            this.flashInterval = null;
        }

        // F-024: Очищаем все отслеживаемые setTimeout / setInterval, чтобы не было
        // утечек таймеров при закрытии окна (flip-анимации, flashInterval и пр.)
        for (const id of this._timeouts) { clearTimeout(id); }
        for (const id of this._intervals) { clearInterval(id); }
        this._timeouts = [];
        this._intervals = [];

        // Удаляем IPC listeners если они есть
        if (this.ipcRenderer) {
            if (this.ipcHandlers.timerState) {
                this.ipcRenderer.removeListener('timer-state', this.ipcHandlers.timerState);
            }
            if (this.ipcHandlers.colorsUpdate) {
                this.ipcRenderer.removeListener('colors-update', this.ipcHandlers.colorsUpdate);
                this.ipcRenderer.removeListener('display-colors-update', this.ipcHandlers.colorsUpdate);
            }
            if (this.ipcHandlers.displaySettingsUpdate) {
                this.ipcRenderer.removeListener('display-settings-update', this.ipcHandlers.displaySettingsUpdate);
            }
            if (this.ipcHandlers.widgetWindowState) {
                this.ipcRenderer.removeListener('widget-window-state', this.ipcHandlers.widgetWindowState);
            }
            if (this.ipcHandlers.clockWindowState) {
                this.ipcRenderer.removeListener('clock-window-state', this.ipcHandlers.clockWindowState);
            }
        }

        // Удаляем document/window listeners
        if (this._handlers.windowResize) {
            window.removeEventListener('resize', this._handlers.windowResize);
        }
        if (this._handlers.shortcutsKeydown) {
            document.removeEventListener('keydown', this._handlers.shortcutsKeydown);
        }
        if (this._handlers.altKeydown) {
            document.removeEventListener('keydown', this._handlers.altKeydown);
        }
        if (this._handlers.altKeyup) {
            document.removeEventListener('keyup', this._handlers.altKeyup);
        }
        if (this._handlers.altBlur) {
            window.removeEventListener('blur', this._handlers.altBlur);
        }
        if (this._handlers.wheel) {
            document.removeEventListener('wheel', this._handlers.wheel);
        }
        if (this._handlers.windowDragMousedown) {
            document.removeEventListener('mousedown', this._handlers.windowDragMousedown);
        }
        if (this._handlers.windowDragMousemove) {
            document.removeEventListener('mousemove', this._handlers.windowDragMousemove);
        }
        if (this._handlers.windowDragMouseup) {
            document.removeEventListener('mouseup', this._handlers.windowDragMouseup);
        }
        if (this._handlers.storage) {
            window.removeEventListener('storage', this._handlers.storage);
        }
        // Block mousedown handlers
        if (Array.isArray(this._handlers.blockMousedowns)) {
            this._handlers.blockMousedowns.forEach(({ block, handler }) => {
                if (block && handler) {
                    block.removeEventListener('mousedown', handler);
                }
            });
            this._handlers.blockMousedowns = [];
        }
        // Button click handlers
        if (this.closeBtn && this._handlers.closeBtnClick) {
            this.closeBtn.removeEventListener('click', this._handlers.closeBtnClick);
        }
        if (this._minimizeBtn && this._handlers.minimizeBtnClick) {
            this._minimizeBtn.removeEventListener('click', this._handlers.minimizeBtnClick);
        }
        if (this._fullscreenBtn && this._handlers.fullscreenBtnClick) {
            this._fullscreenBtn.removeEventListener('click', this._handlers.fullscreenBtnClick);
        }

        this._handlers = {};
    }
}

// Pure helpers для переиспользования и тестирования
// Работает в браузере (через window.DisplayTimerHelpers) и в Node (module.exports).

// Валидирует структуру позиций блоков после JSON.parse.
// Возвращает очищенный объект { [key]: { left, top } } или null.
function validateBlockPositions(positions) {
    if (typeof positions !== 'object' || positions === null) { return null; }
    const result = {};
    for (const [key, pos] of Object.entries(positions)) {
        if (!pos || typeof pos !== 'object') { continue; }
        if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) { continue; }
        const left = Math.max(-5000, Math.min(5000, pos.left));
        const top = Math.max(-5000, Math.min(5000, pos.top));
        result[key] = { left, top };
    }
    return result;
}

// Проверяет, безопасно ли записать значение в localStorage (без выброса).
// 1 MB лимит на значение + проверка QuotaExceeded.
function canSafelyStore(value, limitBytes = 1024 * 1024) {
    if (typeof value !== 'string') { return false; }
    try {
        const size = typeof Blob !== 'undefined'
            ? new Blob([value]).size
            : Buffer.byteLength(value, 'utf8');
        return size <= limitBytes;
    } catch {
        return false;
    }
}

// Экспорт: в браузер через window, в Node через module.exports.
if (typeof window !== 'undefined') {
    window.DisplayTimerHelpers = { validateBlockPositions, canSafelyStore };
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateBlockPositions, canSafelyStore };
}

// Инициализация
let displayTimer;
if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', () => {
        displayTimer = new DisplayTimer();

        // Hint-strip: автоскрытие через 4 сек бездействия мыши
        (function hintFade() {
            const hint = document.getElementById('controlsHint');
            if (!hint) { return; }
            let timer;
            const reset = () => {
                hint.classList.remove('faded');
                clearTimeout(timer);
                timer = setTimeout(() => hint.classList.add('faded'), 4000);
            };
            document.addEventListener('mousemove', reset, { passive: true });
            document.addEventListener('keydown', reset);
            reset();
        })();
    });

    // Cleanup при закрытии окна
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('beforeunload', () => {
            if (displayTimer) {
                displayTimer.cleanup();
            }
        });
    }
}
