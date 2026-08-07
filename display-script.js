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
        // Защёлка «вспышку завершения уже показали» — см. updateDisplay().
        this._finishEffectShown = false;

        // Самокорректирующийся таймер часов «Текущее время» (см. startCurrentTimeClock)
        this._currentTimeTimeout = null;

        // F-024: трекинг setInterval для cleanup. Единственный владелец — сейчас
        // это flashInterval из triggerFinishEffect.
        //
        // Раньше рядом жил ВТОРОЙ такой же массив (this.intervals) — он собирал
        // поллинг браузерного режима и интервал часов текущего времени. Оба ушли
        // (мёртвая ветка и переход на самокорректирующийся таймер), так что второй
        // массив остался бы всегда пустым.
        //
        // Таймеры перекидывания карточек здесь НЕ учитываются: их ведёт flip-card.js
        // и гасит FlipCard.cancelPending() — внешний список рос неограниченно.
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

        this.initElements();
        this.initProgress();
        // initDefaultStyle идёт ДО loadColors: он безусловно вешает style-circle
        // и .active на кольцо, ничего не снимая, а loadColors через
        // loadBackgroundSettings уже применяет сохранённый стиль. В прежнем
        // порядке при не-круговом стиле на body оказывались ДВА класса стиля и
        // две активные панели — до следующего пуша от панели управления.
        this.initDefaultStyle();
        this.loadColors();
        this.setupIPCIfAvailable();
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
                this.applyTimerScale();
            }, window.CONFIG ? window.CONFIG.RESIZE_DEBOUNCE : 300)
            : () => this.applyTimerScale();

        this._handlers.windowResize = debouncedResize;
        window.addEventListener('resize', this._handlers.windowResize);
        // Начальный расчёт
        this.applyTimerScale();
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
                const presets = window.CONFIG.PRESET_DURATIONS;
                const idx = parseInt(e.code.replace('Digit', '')) - 1;
                if (this.ipcRenderer) {
                    this.ipcRenderer.send('timer-command', { type: 'set', seconds: presets[idx] });
                }
            }
        };
        document.addEventListener('keydown', this._handlers.shortcutsKeydown);
    }

    /**
     * Применить this.timerScale ко ВСЕМ блокам стилей.
     *
     * Раньше эти четыре строки были написаны трижды — в applyDisplaySettings,
     * в обработчике Ctrl+колеса и в восстановлении из localStorage, — а метод
     * был назван по кольцу и масштабировал ОДНО кольцо: остальные три
     * блока каждый раз масштабировал вызывающий. Добавление стиля означало
     * пятую строку в трёх местах, и пропуск в одном из них не виден ничем.
     */
    applyTimerScale() {
        const scale = (this.timerScale || 100) / 100;
        const blocks = [this.timerRing, this.timerDigital, this.timerFlip, this.timerAnalog];
        for (const block of blocks) {
            if (block) { block.style.transform = `scale(${scale})`; }
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

        // Самокорректирующийся тик по системным часам — тот же приём, что в
        // виджете часов (_scheduleNextTick). Ровный setInterval(1000) отсчитывает
        // от предыдущего СРАБАТЫВАНИЯ, а не от границы секунды: задержки event
        // loop накапливаются, показ уползает от реального времени, и в какой-то
        // момент секунда визуально «прыгает через одну». На презентационном
        // экране, где рядом висит настоящее время, это заметно.
        const scheduleNext = () => {
            const msToNextSecond = 1000 - (Date.now() % 1000);
            this._currentTimeTimeout = setTimeout(() => {
                updateClock();
                scheduleNext();
            }, msToNextSecond);
        };
        scheduleNext();
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

    // Раньше здесь была развилка detectElectronAndSetup(): при отсутствии
    // ipcRenderer окно уходило в «браузерный режим» и синхронизировалось через
    // localStorage-ключ `timerState` с поллингом раз в секунду и слушателем
    // storage-события. Ветка была НЕРАБОЧЕЙ: ключ `timerState` никто в проекте
    // не пишет (главный процесс рассылает состояние только по IPC), поэтому
    // читать его было бесполезно — окно навсегда осталось бы на нулях. Туда же
    // относился поллинг цветов startColorSync/syncColors раз в 2 секунды.
    // Развилка удалена вместе с обеими мёртвыми ветками.
    setupIPCIfAvailable() {
        if (!window.ipcRenderer) { return; }
        this.ipcRenderer = window.ipcRenderer;
        this.setupIPC();
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
        this.ipcRenderer.on('display-colors-update', this.ipcHandlers.colorsUpdate);
        this.ipcRenderer.on('display-settings-update', this.ipcHandlers.displaySettingsUpdate);
    }

    applyDisplaySettings(settings) {
        // Стиль таймера — только свой. Общее имя `timerStyle` в этом наборе
        // может означать стиль ВИДЖЕТА (когда набор пришёл из localStorage),
        // см. RendererShared.pickOwnSetting.
        const style = window.RendererShared.pickOwnSetting(settings, 'displayTimerStyle', 'timerStyle');
        if (style) {
            this.setTimerStyle(style);
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

        // Масштаб таймера. Панель управления шлёт ВЕСЬ объект настроек при любом
        // изменении (цвет, фон, блоки), поэтому применять timerScale безусловно
        // нельзя — каждая правка цвета сбрасывала бы масштаб, выставленный
        // Ctrl+колесом прямо на дисплее. И наоборот: раньше localStorage имел
        // безусловный приоритет, из-за чего ползунок в панели становился мёртвым
        // навсегда после первого же Ctrl+колеса.
        // Решение — то же, что уже применено к timeLayoutPreset: применяем
        // значение только когда оно РЕАЛЬНО изменилось с прошлой посылки, то
        // есть когда пользователь действительно двигал ползунок.
        // Имя `timerScale` в наборе из localStorage — масштаб ВИДЖЕТА; из-за
        // этого _lastPushedTimerScale засевался чужим значением, и первый же
        // пуш панели уходил в ветку «осознанное движение ползунка».
        const incomingScale = window.RendererShared.pickOwnSetting(settings, 'displayTimerScale', 'timerScale');
        if (incomingScale !== undefined) {
            const incoming = parseInt(incomingScale, 10);
            if (Number.isFinite(incoming) && incoming !== this._lastPushedTimerScale) {
                if (this._lastPushedTimerScale === undefined) {
                    // Первая посылка после открытия окна — локальный масштаб,
                    // уже восстановленный из localStorage, актуальнее.
                    const localScale = parseInt(localStorage.getItem('displayTimerScale'), 10);
                    this.timerScale = Number.isFinite(localScale) ? localScale : incoming;
                } else {
                    // Осознанное движение ползунка — оно главнее Ctrl+колеса.
                    this.timerScale = incoming;
                    this._safeSetItem('displayTimerScale', String(incoming));
                }
                this._lastPushedTimerScale = incoming;
            }
        }
        // Всегда применяем текущий масштаб
        this.applyTimerScale();

        // Показ цифр на аналоговом циферблате
        if (settings.showAnalogNumbers !== undefined && this.clockNumbers) {
            this.clockNumbers.classList.toggle('visible', settings.showAnalogNumbers);
        }

        // Масштаб блоков времени — та же логика «применяем только при реальном
        // изменении», что и для timerScale выше (см. комментарий там).
        if (settings.timeBlocksScale !== undefined) {
            const incoming = parseInt(settings.timeBlocksScale, 10);
            if (Number.isFinite(incoming) && incoming !== this._lastPushedBlockScale) {
                let effectivePct = incoming;
                if (this._lastPushedBlockScale === undefined) {
                    const localBlockScale = parseInt(localStorage.getItem('displayBlockScale'), 10);
                    if (Number.isFinite(localBlockScale)) { effectivePct = localBlockScale; }
                } else {
                    this._safeSetItem('displayBlockScale', String(incoming));
                }
                const effectiveScale = effectivePct / 100;
                if (this.currentTimeBlock) {this.currentTimeBlock.style.setProperty('--info-scale', effectiveScale);}
                if (this.eventTimeBlock) {this.eventTimeBlock.style.setProperty('--info-scale', effectiveScale);}
                if (this.endTimeBlock) {this.endTimeBlock.style.setProperty('--info-scale', effectiveScale);}
                this._lastPushedBlockScale = incoming;
            }
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

    loadColors() {
        // Дефолта здесь нет намеренно: на чистом профиле владельцем остаётся
        // CSS. Так же ведут себя часы и — после этого прохода — виджет,
        // который раньше подставлял захардкоженный #0a84ff и потому
        // расходился с остальными на всех четырёх стилях.
        const saved = localStorage.getItem('timerColors');
        const colors = saved && window.SecurityUtils
            ? window.SecurityUtils.safeJSONParse(saved, null)
            : null;
        if (colors) { this.applyColors(colors); }

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
        // L7: also skip the 'warning' (yellow) band, not just 'danger', so a color
        // update while paused in the warning band doesn't overwrite the yellow.
        if (timerColor && digitalTime
            && !digitalTime.classList.contains('danger')
            && !digitalTime.classList.contains('warning')) {
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
            // L7: skip both 'danger' and 'warning' so a color update during the
            // warning band doesn't overwrite the yellow on flip digits.
            this._cachedFlipDigits.forEach(el => {
                if (!el.closest('.danger') && !el.closest('.warning')) {
                    el.style.color = timerColor;
                }
            });
            // L6: while in overtime the separators must stay red (only
            // _enforceOvertimeColors / per-tick methods own that). Keep the cache
            // populated above, but guard the actual recolor on overtime.
            if (this.remainingSeconds >= 0) {
                this._cachedFlipSeparators.forEach(el => {
                    el.style.color = timerColor;
                });
            }
        }

        // Info blocks (time blocks): ЗНАЧЕНИЕ берёт цвет темы, ПОДПИСЬ — нет.
        //
        // Раньше подпись красилась в `${timerColor}80`, то есть в цвет темы при
        // жёсткой 50% альфе. На тёмном фоне это убивало контраст: замерено по всем
        // восьми встроенным темам — от 2.15:1 («Синий», тема по умолчанию) до
        // 4.04:1 («Неон»), тогда как подпись .info-label идёт 12px uppercase 600 и
        // требует 4.5:1. Не проходила НИ ОДНА тема. И запаса нет в принципе: сам
        // #667eea даёт лишь 4.82:1 на полной насыщенности, то есть «сделать тише,
        // но читаемо» математически невозможно. Мешать с белым тоже нельзя —
        // подпись станет ЯРЧЕ значения и перевернёт иерархию.
        //
        // Поэтому подпись отдана нейтральным fallback'ам, которые уже объявлены в
        // display.html под каждый стиль (--tw-fg-dim для круга и аналога,
        // --tw-fg-muted для флипа, зелёный для LED). Замер по восьми темам: 4.55–6.63:1.
        // Иерархию несут размер, насыщенность и капитель, а не понижение контраста
        // ниже порога читаемости. Побочная выгода: подпись остаётся читаемой при
        // ЛЮБОМ пользовательском цвете из палитры, а не только у восьми встроенных.
        //
        // removeProperty, а не «просто не ставить»: инлайновое значение с прошлой
        // версии могло остаться на documentElement и переживало бы обновление.
        if (timerColor) {
            document.documentElement.style.setProperty('--info-color', timerColor);
            document.documentElement.style.removeProperty('--info-color-dim');
            document.documentElement.style.setProperty('--info-glow', `${timerColor}33`);
        }

        // Analog style
        // L6: while in overtime the second hand / center / analog-digital text must
        // stay red (owned by _enforceOvertimeColors / per-tick methods). Skip the
        // unconditional recolor on overtime so a control-panel color change doesn't
        // revert them while paused in overtime.
        // Базовые значения аналогового стиля запоминаем ВСЕГДА, даже в перерасходе:
        // updateAnalogDisplay() обязан уметь вернуть стрелку и центр к теме, когда
        // перерасход закончился. Раньше эти инлайновые стили ставила только ветка
        // перерасхода, а снять их было нечем — красные стрелки залипали до
        // следующей смены цвета в панели управления.
        if (progressColor) {
            this._baseSecondHandBg =
                `linear-gradient(180deg, ${timerColor || progressColor} 0%, ${progressColor} 100%)`;
            this._baseSecondHandShadow = `0 0 15px ${progressColor}80`;
        }
        if (timerColor) {
            this._baseCenterBg = `linear-gradient(145deg, ${timerColor}, ${progressColor || timerColor})`;
            this._baseCenterShadow = `0 0 15px ${timerColor}99`;
            // Было b3 (0.7): выбор темы приглушал отсчёт ВТОРОЙ раз поверх
            // токена, который и так вторичен. Инвариант сброса не задет —
            // это база восстановления после перерасхода, она и должна быть
            // непустой, а красные полосы ставятся и снимаются своими ветками.
            this._baseAnalogDigitalColor = `${timerColor}e6`;
        }

        // L6: пока идёт перерасход, стрелки/центр/цифры держит красными
        // _enforceOvertimeColors и per-tick методы — не перебиваем их здесь.
        if (this.remainingSeconds >= 0) {
            const secondHand = document.getElementById('analogHandSecond');
            const clockCenter = document.querySelector('.clock-center');
            const analogDigital = document.getElementById('analogDigitalTime');
            if (progressColor && secondHand) {
                secondHand.style.background = this._baseSecondHandBg;
                secondHand.style.boxShadow = this._baseSecondHandShadow;
            }
            if (timerColor && clockCenter) {
                clockCenter.style.background = this._baseCenterBg;
                clockCenter.style.boxShadow = this._baseCenterShadow;
            }
            if (timerColor && analogDigital) {
                analogDigital.style.color = this._baseAnalogDigitalColor;
            }
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
        // Тот же валидатор, что у остальных окон: своя регулярка принимала
        // любой набор цифр в скобках, а значение попадает и в style.color, и в
        // строку linear-gradient().
        return window.SecurityUtils.isSafeColor(value);
    }

    applyBackground(settings) {
        const mode = settings.bgMode || 'gradient';
        let bg = '';

        // Три радиальных свечения из body::before рисуются ПОВЕРХ фона, а не
        // под ним, поэтому режим «Заливка» заливки не давал: выбранный цвет
        // всегда оставался подкрашен синим и зелёным пятнами. Комментарий над
        // правилом при этом утверждал обратное.
        if (mode === 'solid' && settings.bgSolid && this._isSafeColor(settings.bgSolid)) {
            bg = settings.bgSolid;
            document.body.classList.add('custom-bg');
        } else if (mode === 'gradient') {
            document.body.classList.remove('custom-bg');
            const c1 = this._isSafeColor(settings.bgGrad1) ? settings.bgGrad1 : '#0f0c29';
            const c2 = this._isSafeColor(settings.bgGrad2) ? settings.bgGrad2 : '#302b63';
            bg = `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
        } else if (mode === 'local' && settings.bgLocalImage) {
            // Локальный фон с настройками
            const fit = settings.bgLocalFit || 'cover';
            const overlay = settings.bgLocalOverlay || 30;

            // Создаём или обновляем оверлей
            this.applyLocalBackground(settings.bgLocalImage, fit, overlay);
            document.body.classList.add('custom-bg');
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

        // Снимаем защёлку вспышки, как только состояние перестало быть
        // «завершено» (сброс, новый пресет, старт) — следующее завершение снова
        // имеет право мигнуть. Стоит ДО раннего выхода по кэшу намеренно.
        if (!this.finished) { this._finishEffectShown = false; }

        // ОПТИМИЗАЦИЯ (FIX BUG-007): Проверка изменений перед обновлением
        // Если секунды не изменились, нечего обновлять
        if (this.cache.lastSeconds === secs && !this.finished) {
            // FIX BUG-C: BUT статус проверяем ВСЕГДА (не зависит от кэша секунд)
            const status = this.getTimerStatusValue(secs);
            if (this.cache.lastStatus !== status
                || this.cache.lastRunning !== this.isRunning
                || this.cache.lastPaused !== this.isPaused
                || this.cache.lastFinished !== this.finished) {
                this.updateStatus(secs);
                this.cache.lastStatus = status;
                this.cache.lastRunning = this.isRunning;
                this.cache.lastPaused = this.isPaused;
                this.cache.lastFinished = this.finished;
            }
            // L6: applyColors (decoupled from ticks) can reset overtime red on
            // flip separators / analog elements while paused in overtime. Re-enforce
            // here too — _enforceOvertimeColors no-ops when secs >= 0.
            this._enforceOvertimeColors(secs);
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

        // Статус-пилюля зависит от нескольких флагов, а getTimerStatusValue()
        // смотрит только на секунды — нужно инвалидировать кэш по каждому из них.
        const status = this.getTimerStatusValue(secs);
        if (this.cache.lastStatus !== status
            || this.cache.lastRunning !== this.isRunning
            || this.cache.lastPaused !== this.isPaused
            || this.cache.lastFinished !== this.finished) {
            this.updateStatus(secs);
            this.cache.lastStatus = status;
            this.cache.lastRunning = this.isRunning;
            this.cache.lastPaused = this.isPaused;
            this.cache.lastFinished = this.finished;
        }

        // Сохраняем последнее значение секунд
        this.cache.lastSeconds = secs;

        // Эффект завершения — РОВНО ОДИН РАЗ на каждое завершение.
        //
        // Раньше условие было `finished && !flashInterval`, а flashInterval сам
        // себя обнуляет, когда серия миганий доиграла (≈3 с). Флаг finished при
        // этом залатчен движком до сброса, поэтому любое следующее обновление
        // состояния запускало мигание заново — и так по кругу. Триггеров хватало:
        // повторное нажатие Space/Start на 00:00 (контроллер отвечает finish()),
        // любая посылка настроек перерасхода из панели (configChanged → emit),
        // ответ на get-timer-state у только что открытого окна.
        if (this.finished && !this._finishEffectShown && !this.flashInterval) {
            this._finishEffectShown = true;
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

    // Цвет и свечение для «нормальной» полосы времени.
    //
    // КЛЮЧЕВОЙ МОМЕНТ. Раньше во всех местах восстановление было записано как
    // `else if (this._baseTimerColor) { ...ставим цвет... }` — без завершающего
    // else. Если пользователь не менял тему, `_baseTimerColor` не определён
    // (applyColors вызывается только когда в localStorage есть timerColors либо
    // пришло display-colors-update), и тогда ветка не срабатывала вообще, а
    // инлайновый красный/жёлтый, выставленный полосой danger/warning, не снимался.
    // Результат: время осталось красным навсегда — в том числе после установки
    // нового пресета, когда до конца снова далеко.
    //
    // Пустая строка здесь принципиальна: она УДАЛЯЕТ инлайновый стиль и возвращает
    // управление CSS-классу, а не «красит в чёрное».
    // Полоса срочности — общая для всех окон (RendererShared.timerColorBand).
    _colorBand(secs) {
        return window.RendererShared.timerColorBand(secs, this.totalSeconds);
    }

    _normalColor() { return this._baseTimerColor || ''; }
    _normalGlow() { return this._baseTimerColor ? (this._baseTimerGlow || '') : ''; }

    // Вспомогательная функция для определения статуса (для кэширования)
    getTimerStatusValue(secs) {
        if (window.TimeUtils && window.TimeUtils.getTimerStatus) {
            return window.TimeUtils.getTimerStatus(secs, this.totalSeconds);
        }
        if (secs < 0) {return 'overtime';}
        if (secs === 0 && this.totalSeconds > 0) {return 'danger';}
        if (secs <= 60 && secs > 0) {return 'warning';}
        return 'normal';
    }

    updateDigitalDisplay(secs, _formatted) {
        if (!this.digitalMinutes || !this.digitalSeconds) {return;}

        const { hours, minutes: mins, seconds } = window.RendererShared
            ? window.RendererShared.breakdown(secs)
            : (() => {
                const absSecs = Math.abs(secs);
                return {
                    hours: Math.floor(absSecs / 3600),
                    minutes: Math.floor((absSecs % 3600) / 60),
                    seconds: absSecs % 60
                };
            })();

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
        const band = this._colorBand(secs);
        if (band === 'overtime') {
            this.digitalTime.classList.add('danger', 'overtime');
            this.digitalTime.style.color = '#ff3333';
            this.digitalTime.style.textShadow = '0 0 20px #ff3333, 0 0 40px #ff3333, 0 0 80px #ff333366';
        } else if (band === 'danger') {
            this.digitalTime.classList.add('danger');
            this.digitalTime.style.color = '#ff3333';
            this.digitalTime.style.textShadow = '0 0 20px #ff3333, 0 0 40px #ff3333, 0 0 80px #ff333366';
        } else if (band === 'warning') {
            this.digitalTime.classList.add('warning');
            // Было #ffc107 против --tw-led-warn = #ffcc00 в собственном CSS
            // этого же окна: правило .digital-time.warning не применялось
            // НИКОГДА, потому что инлайн всегда бьёт класс.
            this.digitalTime.style.color = '#ffcc00';
            this.digitalTime.style.textShadow = '0 0 20px #ffcc00, 0 0 40px #ffcc00, 0 0 80px #ffcc0066';
        } else {
            this.digitalTime.style.color = this._normalColor();
            this.digitalTime.style.textShadow = this._normalGlow();
        }
    }

    updateFlipDisplay(secs) {
        if (!this.flipMin1 || !this.flipMin2 || !this.flipSec1 || !this.flipSec2) {return;}

        const isNegative = secs < 0;

        // F-024/refactor: общая логика разбиения на цифры (renderer-shared.flipCells).
        // Передаём preset (this.totalSeconds), чтобы правило показа часов осталось
        // `hours > 0 || totalSeconds >= 3600`.
        let cells;
        if (window.RendererShared) {
            cells = window.RendererShared.flipCells(secs, this.totalSeconds);
        } else {
            const absSecs = Math.abs(secs);
            const hours = Math.floor(absSecs / 3600);
            const mins = Math.floor((absSecs % 3600) / 60);
            const seconds = absSecs % 60;
            cells = {
                h1: String(Math.floor(hours / 10) % 10),
                h2: String(hours % 10),
                m1: String(Math.floor(mins / 10) % 10),
                m2: String(mins % 10),
                s1: String(Math.floor(seconds / 10)),
                s2: String(seconds % 10),
                hasHours: hours > 0 || this.totalSeconds >= 3600
            };
        }

        // Показываем/скрываем знак минуса
        if (this.flipMinus) {
            this.flipMinus.classList.toggle('visible', isNegative);
        }

        // Показываем/скрываем часы
        const showHours = cells.hasHours;
        if (this.flipHoursUnit && this.flipHoursSep) {
            this.flipHoursUnit.style.display = showHours ? '' : 'none';
            this.flipHoursSep.style.display = showHours ? '' : 'none';
            if (showHours && this.flipHr1 && this.flipHr2) {
                this.updateFlipCard(this.flipHr1, cells.h1, 'hr1');
                this.updateFlipCard(this.flipHr2, cells.h2, 'hr2');
            }
        }

        const min1 = cells.m1;
        const min2 = cells.m2;
        const sec1 = cells.s1;
        const sec2 = cells.s2;

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

        const band = this._colorBand(secs);
        const flipSeparators = document.querySelectorAll('.flip-separator');
        // Цвет цифр и разделителей всегда задаётся ЯВНО для каждой полосы —
        // включая normal, где пустая строка снимает инлайн и отдаёт цвет CSS.
        const BAND_COLOR = { overtime: '#ff4444', danger: '#ff4444', warning: '#ffc107' };
        const digitColor = BAND_COLOR[band] || this._normalColor();

        if (band === 'overtime') {
            flipCards.forEach(card => card.classList.add('danger', 'overtime'));
        } else if (band === 'danger') {
            flipCards.forEach(card => card.classList.add('danger'));
        } else if (band === 'warning') {
            flipCards.forEach(card => card.classList.add('warning'));
        }
        flipCards.forEach(card => {
            const digit = card.querySelector('.flip-digit');
            if (digit) { digit.style.color = digitColor; }
        });
        flipSeparators.forEach(el => { el.style.color = digitColor; });
    }

    // Перекидывание карточки. Реализация общая для всех трёх окон —
    // flip-card.js: раньше она жила только здесь, а виджет и часы меняли цифру
    // рывком. Незавершённые таймеры снятия класса ведёт сам модуль, cleanup()
    // гасит их одним FlipCard.cancelPending().
    updateFlipCard(card, value, key) {
        const id = window.FlipCard.flipCardTo(card, '.flip-digit', value);
        if (id !== null) { this.lastFlipValues[key] = value; }
    }

    updateAnalogDisplay(secs) {
        if (!this.analogHandMinute || !this.analogHandSecond) {return;}

        const absSecs = Math.abs(secs);
        const totalMins = absSecs / 60;
        const seconds = absSecs % 60;

        // Часовая стрелка — полный оборот за 12 часов ОСТАТКА, плавно (дробные
        // часы учитываются так же, как минутная учитывает дробные минуты).
        //
        // Раньше её не двигал никто: элемент есть в разметке (#analogHandHour),
        // стиль .hand-hour есть, ссылка в initElements() есть — а присваивания
        // transform не было ни одного, поэтому стрелка навсегда стояла на 12.
        // На таймерах короче часа это выглядело «случайно правильно» (0 часов и
        // есть 12), а на 1:30:00 минутная бежала, часовая же продолжала
        // показывать 12 — циферблат читался как сломанный. На презентационном
        // экране, где как раз и ставят длинные интервалы, это самый заметный случай.
        if (this.analogHandHour) {
            const hourDeg = ((absSecs / 3600) % 12) * 30;
            this.analogHandHour.style.transform = `rotate(${hourDeg}deg)`;
        }

        // Минутная стрелка - полный оборот за 60 минут
        // Плавное движение с учетом секунд
        const minuteDeg = (totalMins / 60) * 360;
        this.analogHandMinute.style.transform = `rotate(${minuteDeg}deg)`;

        // Секундная стрелка - полный оборот за 60 секунд
        const secondDeg = (seconds / 60) * 360;
        this.analogHandSecond.style.transform = `rotate(${secondDeg}deg)`;

        // Обновляем цифровое время под циферблатом
        if (this.analogDigitalTime) {
            // absSecs >= 0, поэтому formatTimeShort не добавит знак — знак минуса
            // рисуется отдельно через _setAnalogTimeContent. Вывод идентичен ручному
            // `H:MM:SS` / `MM:SS`.
            const timeStr = (window.TimeUtils && window.TimeUtils.formatTimeShort)
                ? window.TimeUtils.formatTimeShort(absSecs)
                : (() => {
                    const hours = Math.floor(absSecs / 3600);
                    const mins = Math.floor((absSecs % 3600) / 60);
                    return hours > 0
                        ? `${hours}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
                        : `${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                })();
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

        const band = this._colorBand(secs);
        if (band === 'overtime') {
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
        } else {
            // Снимаем ИНЛАЙНОВЫЕ красные стили, выставленные веткой перерасхода.
            // Раньше эта ветка трогала только классы, а инлайн переживал выход из
            // перерасхода и побеждал CSS — секундная стрелка, центр циферблата и
            // цифры под ним оставались красными до следующей смены темы.
            if (this.analogHandSecond) {
                this.analogHandSecond.style.background = this._baseSecondHandBg || '';
                this.analogHandSecond.style.boxShadow = this._baseSecondHandShadow || '';
            }
            if (clockCenter) {
                clockCenter.style.background = this._baseCenterBg || '';
                clockCenter.style.boxShadow = this._baseCenterShadow || '';
            }
            if (this.analogDigitalTime) {
                this.analogDigitalTime.style.color = this._baseAnalogDigitalColor || '';
            }

            if (band === 'danger' || band === 'warning') {
                analogElements.forEach(el => {
                    if (el) {el.classList.add(band);}
                });
                if (this.analogDigitalTime) {
                    this.analogDigitalTime.classList.add(band);
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
            const band = this._colorBand(Math.floor(this.remainingSeconds));

            this.progressRing.classList.remove('warning', 'danger', 'overtime');
            this.timeDisplay.classList.remove('warning', 'danger', 'overtime');

            if (band === 'overtime') {
                this.progressRing.classList.add('danger', 'overtime');
                this.timeDisplay.classList.add('danger', 'overtime');
                // Force inline color override — CSS class alone may be insufficient
                this.timeDisplay.style.color = '#ff4444';
            } else if (band === 'danger') {
                this.progressRing.classList.add('danger');
                this.timeDisplay.classList.add('danger');
                this.timeDisplay.style.color = '#ff4444';
            } else if (band === 'warning') {
                this.progressRing.classList.add('warning');
                this.timeDisplay.classList.add('warning');
                this.timeDisplay.style.color = '#ffc107';
            } else {
                this.timeDisplay.style.color = this._normalColor();
            }
        } else {
            this.progressRing.style.strokeDashoffset = this.circumference;
            // Без пресета (totalSeconds === 0) полос danger/warning быть не может,
            // но раньше эта ветка не снимала ни классы, ни инлайновый цвет — после
            // перерасхода круглый стиль оставался красным.
            this.progressRing.classList.remove('warning', 'danger', 'overtime');
            this.timeDisplay.classList.remove('warning', 'danger', 'overtime');
            this.timeDisplay.style.color = this._normalColor();
        }
    }

    // ЕДИНЫЙ порядок приоритетов статуса для всех трёх окон (панель управления,
    // виджет, полноэкранный режим). Раньше он расходился: здесь `finished`
    // проверялся ПЕРВЫМ, а в панели и виджете первым шёл перерасход — из-за чего
    // одно и то же состояние подписывалось по-разному в разных окнах.
    //
    // Пауза идёт первой намеренно: остановка в перерасходе — это пауза, а не
    // «Время вышло». Раньше ветка isPaused была недостижима при secs <= 0, и
    // пауза в перерасходе (обычное дело для докладчика, выбившегося из времени)
    // подписывалась как «Время вышло!». Сам перерасход и так виден по красным цифрам.
    updateStatus(secs) {
        const STATUS_TEXT = {
            paused: 'На паузе',
            overtime: 'Перерасход времени',
            finished: 'Время вышло!',
            running: 'Таймер активен',
            idle: 'Готов к запуску'
        };
        const status = this._lifecycleStatus(secs);

        this.statusPill.classList.remove('running', 'paused', 'finished', 'overtime');
        if (status !== 'idle') { this.statusPill.classList.add(status); }
        this.statusText.textContent = STATUS_TEXT[status];

        this.updateChipState(status);
    }

    _lifecycleStatus(secs) {
        return window.RendererShared.timerLifecycleStatus({
            remainingSeconds: secs,
            totalSeconds: this.totalSeconds,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            finished: this.finished
        });
    }

    // Принимает уже вычисленный ключ статуса, а не сырое состояние: раньше здесь
    // была ВТОРАЯ независимая копия условий, и она расходилась с updateStatus() —
    // плашка красилась в зелёный is-success с подписью «Завершено», пока таймер
    // показывал красный минус.
    updateChipState(status) {
        const pill = this.statusPill;
        const label = document.getElementById('heroLabel');
        if (!pill) { return; }

        // ЦВЕТ плашки задают только семантические классы (running / paused /
        // finished / overtime) из updateStatus(). Раньше сюда добавлялась ВТОРАЯ
        // система классов — is-success / is-attention, — и они дрались с первой:
        // объявленные в CSS ниже, они выигрывали каскад, из-за чего «ВРЕМЯ ВЫШЛО!»
        // получало зелёный фон is-success поверх красной пульсации .finished, а
        // оранжевый .overtime перекрашивался в красный .is-attention.
        // Здесь остаются только подпись над таймером и глиф.
        const CHIP = {
            // Поля glyph здесь не было бы смысла: CSS гасит текст элемента
            // (font-size: 0) и рисует свой символ через ::before, поэтому
            // присвоение из JS было мертво — а списки при этом разошлись
            // содержимым (finished: JS писал '✓', CSS рисует '×').
            // Владельцем оставлен CSS: он и виден. Обратный вариант потребовал
            // бы снять font-size: 0 и удалить пять правил ::before, то есть
            // заменить видимые сегодня глифы на другой набор — это уже
            // дизайнерское решение, а не устранение дублирования.
            paused:   { label: 'Пауза' },
            overtime: { label: 'Сверх времени' },
            finished: { label: 'Завершено' },
            running:  { label: 'Осталось' },
            idle:     { label: 'Осталось' }
        };
        const chip = CHIP[status] || CHIP.idle;

        pill.classList.remove('is-success', 'is-attention');
        if (label) { label.textContent = chip.label; }
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

    isWindowDragTarget(target) {
        return !!(
            target
            && typeof target.closest === 'function'
            && !target.closest('.window-controls, .info-block, button, input, select, textarea, [role="button"], [tabindex]')
        );
    }

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
        const clampScale = (window.RendererShared && window.RendererShared.clampScale)
            ? window.RendererShared.clampScale
            : (value, min, max) => Math.max(min, Math.min(max, value));
        const scaleTimer = (delta) => {
            const cur = this.timerScale || 100;
            const newPct = clampScale(cur + delta, TIMER_MIN_SCALE, TIMER_MAX_SCALE);
            if (newPct !== cur) {
                this.timerScale = newPct;
                this.applyTimerScale();
                this._safeSetItem(STORAGE_TIMER_SCALE_KEY, String(newPct));
                // Сообщаем панели управления — иначе её ползунок останется на
                // старом значении, и два источника правды снова разойдутся.
                this._lastPushedTimerScale = newPct;
                if (this.ipcRenderer) {
                    this.ipcRenderer.send('report-scale', { source: 'display', scalePct: newPct });
                }
            }
        };
        const scaleBlocks = (delta) => {
            const raw = this.currentTimeBlock
                ? getComputedStyle(this.currentTimeBlock).getPropertyValue('--info-scale')
                : '1.2';
            const cur = Math.round(parseFloat(raw) * 100) || 120;
            const newPct = clampScale(cur + delta, BLOCK_MIN_SCALE, BLOCK_MAX_SCALE);
            if (newPct !== cur) {
                const scale = newPct / 100;
                [this.currentTimeBlock, this.eventTimeBlock, this.endTimeBlock].forEach(b => {
                    if (b) { b.style.setProperty('--info-scale', scale); }
                });
                this._safeSetItem(STORAGE_BLOCK_SCALE_KEY, String(newPct));
                this._lastPushedBlockScale = newPct;
                if (this.ipcRenderer) {
                    this.ipcRenderer.send('report-scale', { source: 'display-blocks', scalePct: newPct });
                }
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
                        // Clamp so the block always keeps ~20px breathing room
                        // from every viewport edge — a card flush against the
                        // edge reads as a line on the side of the screen.
                        const MARGIN = 20;
                        const bw = block.offsetWidth || 0;
                        const bh = block.offsetHeight || 0;
                        const maxLeft = Math.max(MARGIN, window.innerWidth - bw - MARGIN);
                        const maxTop  = Math.max(MARGIN, window.innerHeight - bh - MARGIN);
                        const nextLeft = Math.min(maxLeft, Math.max(MARGIN, startLeft + dx));
                        const nextTop  = Math.min(maxTop,  Math.max(MARGIN, startTop + dy));
                        block.style.left = nextLeft + 'px';
                        block.style.top  = nextTop  + 'px';
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
            if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }
            if (!this.isWindowDragTarget(e.target)) { return; }
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
                    this.applyTimerScale();
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
                // Pull saved positions into the viewport with a 20px margin so
                // old coordinates (from before the clamp was enforced) don't
                // leave blocks flush against the screen edges.
                const MARGIN = 20;
                const bw = block.offsetWidth || 100;
                const bh = block.offsetHeight || 100;
                const maxLeft = Math.max(MARGIN, window.innerWidth - bw - MARGIN);
                const maxTop  = Math.max(MARGIN, window.innerHeight - bh - MARGIN);
                const left = Math.min(maxLeft, Math.max(MARGIN, pos.left));
                const top  = Math.min(maxTop,  Math.max(MARGIN, pos.top));
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
        // Очищаем flashInterval если он активен
        if (this.flashInterval) {
            clearInterval(this.flashInterval);
            this.flashInterval = null;
        }

        // Самокорректирующийся таймер часов «Текущее время»
        if (this._currentTimeTimeout) {
            clearTimeout(this._currentTimeTimeout);
            this._currentTimeTimeout = null;
        }

        // F-024: Очищаем отслеживаемые setInterval (flashInterval и пр.), чтобы не
        // было утечек таймеров при закрытии окна.
        for (const id of this._intervals) { clearInterval(id); }
        this._intervals = [];

        // Незавершённые таймеры перекидывания карточек.
        if (window.FlipCard && window.FlipCard.cancelPending) {
            window.FlipCard.cancelPending();
        }

        // Удаляем IPC listeners если они есть
        if (this.ipcRenderer) {
            if (this.ipcHandlers.timerState) {
                this.ipcRenderer.removeListener('timer-state', this.ipcHandlers.timerState);
            }
            if (this.ipcHandlers.colorsUpdate) {
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

        // Hint-strip: показываем первые 5 секунд, затем навсегда скрываем
        // (без возврата на mousemove/keydown — чтобы не мешала в презентации)
        (function hintFade() {
            const hint = document.getElementById('controlsHint');
            if (!hint) { return; }
            setTimeout(() => {
                hint.classList.add('faded');
                // После fade-анимации полностью убираем из потока, чтобы не ловить фокус/клики
                setTimeout(() => { hint.style.display = 'none'; }, 500);
            }, 5000);
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
