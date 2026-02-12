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

        // Обработчики IPC для cleanup
        this.ipcHandlers = {};

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
        this.showCurrentTime = false;
        this.showEventTime = false;
        this.eventTime = '10:00';
        this.showEndTime = false;
        this.endTime = '12:00';
        this.timerScale = 100;
        this.timerStyle = 'circle';
        this.lastFlipValues = { min1: '', min2: '', sec1: '', sec2: '' };

        this.initElements();
        this.initProgress();
        this.loadColors();
        this.initDefaultStyle();
        this.detectElectronAndSetup();
        this.startColorSync();
        this.startCurrentTimeClock();
        this.setupResizeHandler();
        this.setupKeyboardShortcuts();
    }
    
    setupResizeHandler() {
        // Пересчитываем размеры при изменении окна с debounce
        const debouncedResize = window.TimeUtils && window.TimeUtils.debounce
            ? window.TimeUtils.debounce(() => {
                this.updateRingSize();
            }, window.CONFIG ? window.CONFIG.RESIZE_DEBOUNCE : 300)
            : () => this.updateRingSize();

        window.addEventListener('resize', debouncedResize);
        // Начальный расчёт
        this.updateRingSize();
    }
        setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
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
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        this.ipcRenderer.send('close-display');
                    }
                    break;
            }
        });
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
        this.digitalMinutes = document.getElementById('digitalMinutes');
        this.digitalSeconds = document.getElementById('digitalSeconds');
        
        // Flip карточки
        this.flipMinus = document.getElementById('flipMinus');
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
        const hourHand = block.querySelector('.mini-hand-hour');
        const minuteHand = block.querySelector('.mini-hand-minute');
        const secondHand = block.querySelector('.mini-hand-second');
        
        if (hourHand) {
            // Часовая стрелка: 360/12 = 30 градусов на час + смещение от минут
            const hourDeg = (hours % 12) * 30 + minutes * 0.5;
            hourHand.style.transform = `translateX(-50%) rotate(${hourDeg}deg)`;
        }
        if (minuteHand) {
            // Минутная стрелка: 360/60 = 6 градусов на минуту
            const minuteDeg = minutes * 6 + seconds * 0.1;
            minuteHand.style.transform = `translateX(-50%) rotate(${minuteDeg}deg)`;
        }
        if (secondHand) {
            // Секундная стрелка: 6 градусов на секунду
            const secondDeg = seconds * 6;
            secondHand.style.transform = `translateX(-50%) rotate(${secondDeg}deg)`;
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
        // Кнопка закрытия
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => {
                this.ipcRenderer.send('close-display');
            });
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
        
        // Показ/скрытие всех блоков времени
        if (this.currentTimeBlock) {
            this.currentTimeBlock.classList.toggle('visible', showBlocks);
            this.applyPosition(this.currentTimeBlock, positions.current);
        }
        if (this.eventTimeBlock) {
            this.eventTimeBlock.classList.toggle('visible', showBlocks);
            this.applyPosition(this.eventTimeBlock, positions.start);
        }
        if (this.endTimeBlock) {
            this.endTimeBlock.classList.toggle('visible', showBlocks);
            this.applyPosition(this.endTimeBlock, positions.end);
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
        
        // Масштаб таймера
        if (settings.timerScale !== undefined) {
            this.timerScale = settings.timerScale;
            const scale = settings.timerScale / 100;
            
            // Для кругового стиля - обновляем размер динамически
            this.updateRingSize();
            
            // Для других стилей - transform
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
            const scale = settings.timeBlocksScale / 100;
            if (this.currentTimeBlock) {this.currentTimeBlock.style.setProperty('--info-scale', scale);}
            if (this.eventTimeBlock) {this.eventTimeBlock.style.setProperty('--info-scale', scale);}
            if (this.endTimeBlock) {this.endTimeBlock.style.setProperty('--info-scale', scale);}
        }
    }
    
    setTimerStyle(style) {
        this.timerStyle = style;
        
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
        // Удаляем все классы позиции
        element.classList.remove(
            'top-left', 'top-center', 'top-right',
            'bottom-left', 'bottom-center', 'bottom-right',
            'top-left-third', 'top-right-third',
            'bottom-left-third', 'bottom-right-third'
        );
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
        window.addEventListener('storage', (e) => {
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
        });

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
        const stop1 = document.querySelector('.grad-stop-1');
        const stop2 = document.querySelector('.grad-stop-2');
        
        if (stop1 && colors.timer) {
            stop1.setAttribute('stop-color', colors.timer);
        }
        if (stop2 && colors.progress) {
            stop2.setAttribute('stop-color', colors.progress);
        }

        // Свечение текста
        if (colors.timer) {
            document.documentElement.style.setProperty('--text-glow', `${colors.timer}80`);
            document.documentElement.style.setProperty('--glow-color', `${colors.timer}80`);
        }
    }

    applyBackground(settings) {
        const mode = settings.bgMode || 'gradient';
        let bg = '';

        if (mode === 'solid' && settings.bgSolid) {
            bg = settings.bgSolid;
        } else if (mode === 'gradient') {
            const c1 = settings.bgGrad1 || '#0f0c29';
            const c2 = settings.bgGrad2 || '#302b63';
            bg = `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
        } else if (mode === 'image' && settings.bgImageUrl) {
            bg = `url('${settings.bgImageUrl}') center/cover no-repeat fixed, #000`;
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
            // Fallback если security.js не загружен (не должно случиться)
            console.warn('SecurityUtils not loaded, using unsafe method');
            document.body.style.backgroundImage = `url('${imageData}')`;
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
            this.timeDisplay.textContent = formatted;

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
        const mins = Math.floor(absSecs / 60);
        const seconds = absSecs % 60;
        
        const prefix = secs < 0 ? '-' : '';
        this.digitalMinutes.textContent = prefix + String(mins).padStart(2, '0');
        this.digitalSeconds.textContent = String(seconds).padStart(2, '0');
        
        // Классы предупреждения
        this.digitalTime.classList.remove('warning', 'danger', 'overtime');
        const isOvertime = secs < 0;
        if (isOvertime) {
            this.digitalTime.classList.add('danger', 'overtime');
        } else if (this.totalSeconds > 0) {
            const percentLeft = (this.remainingSeconds / this.totalSeconds) * 100;
            if (percentLeft <= 10 && percentLeft > 0) {
                this.digitalTime.classList.add('danger');
            } else if (percentLeft <= 25) {
                this.digitalTime.classList.add('warning');
            }
        }
    }
    
    updateFlipDisplay(secs) {
        if (!this.flipMin1 || !this.flipMin2 || !this.flipSec1 || !this.flipSec2) {return;}
        
        const isNegative = secs < 0;
        const absSecs = Math.abs(secs);
        const mins = Math.floor(absSecs / 60);
        const seconds = absSecs % 60;
        
        // Показываем/скрываем знак минуса
        if (this.flipMinus) {
            this.flipMinus.classList.toggle('visible', isNegative);
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
        
        // Классы предупреждения
        const flipCards = [this.flipMin1, this.flipMin2, this.flipSec1, this.flipSec2];
        flipCards.forEach(card => {
            card.classList.remove('warning', 'danger', 'overtime');
        });
        
        const isOvertime = secs < 0;
        if (isOvertime) {
            flipCards.forEach(card => card.classList.add('danger', 'overtime'));
        } else if (this.totalSeconds > 0) {
            const percentLeft = (this.remainingSeconds / this.totalSeconds) * 100;
            flipCards.forEach(card => {
                if (percentLeft <= 10 && percentLeft > 0) {
                    card.classList.add('danger');
                } else if (percentLeft <= 25) {
                    card.classList.add('warning');
                }
            });
        }
    }
    
    updateFlipCard(card, value, key) {
        const digit = card.querySelector('.flip-digit');
        if (digit.textContent !== value) {
            // Запускаем анимацию
            card.classList.add('flipping');
            digit.textContent = value;
            this.lastFlipValues[key] = value;
            
            setTimeout(() => {
                card.classList.remove('flipping');
            }, 300);
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
            const mins = Math.floor(absSecs / 60);
            const prefix = secs < 0 ? '-' : '';
            this.analogDigitalTime.textContent = `${prefix}${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
            } else if (percentLeft <= 10 && percentLeft > 0) {
                this.progressRing.classList.add('danger');
                this.timeDisplay.classList.add('danger');
            } else if (percentLeft <= 25) {
                this.progressRing.classList.add('warning');
                this.timeDisplay.classList.add('warning');
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
    }

    triggerFinishEffect() {
        this.flashCount = 0;
        const maxFlashes = 6;

        this.flashInterval = setInterval(() => {
            document.body.classList.toggle('flash-mode');
            this.flashCount++;

            if (this.flashCount >= maxFlashes * 2) {
                clearInterval(this.flashInterval);
                this.flashInterval = null;
                document.body.classList.remove('flash-mode');
            }
        }, 250);
    }

    formatTime(seconds) {
        // Используем централизованную функцию из utils.js
        if (typeof window.formatTimeShort !== 'undefined') {
            return window.formatTimeShort(seconds);
        }
        // Fallback
        const neg = seconds < 0;
        const abs = Math.abs(seconds);
        if (abs >= 3600) {
            const hrs = Math.floor(abs / 3600);
            const mins = Math.floor((abs % 3600) / 60);
            const secs = abs % 60;
            return `${neg ? '-' : ''}${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        const mins = Math.floor(abs / 60);
        const secs = abs % 60;
        return `${neg ? '-' : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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

        // Удаляем IPC listeners если они есть
        if (this.ipcRenderer) {
            if (this.ipcHandlers.timerState) {
                this.ipcRenderer.removeListener('timer-state', this.ipcHandlers.timerState);
            }
            if (this.ipcHandlers.colorsUpdate) {
                this.ipcRenderer.removeListener('colors-update', this.ipcHandlers.colorsUpdate);
            }
            if (this.ipcHandlers.displaySettingsUpdate) {
                this.ipcRenderer.removeListener('display-settings-update', this.ipcHandlers.displaySettingsUpdate);
            }
        }
    }
}

// Инициализация
let displayTimer;
document.addEventListener('DOMContentLoaded', () => {
    displayTimer = new DisplayTimer();
});

// Cleanup при закрытии окна
window.addEventListener('beforeunload', () => {
    if (displayTimer) {
        displayTimer.cleanup();
    }
});
