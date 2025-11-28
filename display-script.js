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
        this.lastTimestamp = 0;
        this.flashCount = 0;
        this.flashInterval = null;
        
        // Настройки отображения
        this.showCurrentTime = false;
        this.showEventTime = false;
        this.eventTime = '10:00';
        this.timerScale = 100;

        this.initElements();
        this.initProgress();
        this.loadColors();
        this.detectElectronAndSetup();
        this.startColorSync();
        this.startCurrentTimeClock();
    }

    initElements() {
        this.timeDisplay = document.getElementById('timeDisplay');
        this.progressRing = document.getElementById('progressRing');
        this.statusPill = document.getElementById('statusPill');
        this.statusText = document.getElementById('statusText');
        this.timerRing = document.getElementById('timerRing');
        this.currentTimeBlock = document.getElementById('currentTimeBlock');
        this.eventTimeBlock = document.getElementById('eventTimeBlock');
        this.currentTimeEl = document.getElementById('currentTime');
        this.eventTimeEl = document.getElementById('eventTime');
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
        };
        updateClock();
        setInterval(updateClock, 1000);
    }

    detectElectronAndSetup() {
        try {
            const { ipcRenderer } = require('electron');
            if (ipcRenderer) {
                this.ipcRenderer = ipcRenderer;
                this.setupIPC();
            }
        } catch (_) {
            // Браузерный режим - синхронизация через localStorage
            this.startLocalStorageSync();
        }
    }

    setupIPC() {
        // Запрашиваем текущее состояние
        this.ipcRenderer.send('get-timer-state');

        this.ipcRenderer.on('timer-state', (event, state) => {
            // Фильтруем устаревшие пакеты
            const ts = state.timestamp || Date.now();
            if (ts <= this.lastTimestamp) return;
            this.lastTimestamp = ts;

            this.totalSeconds = Number(state.totalSeconds) || 0;
            this.remainingSeconds = Number(state.remainingSeconds) || 0;
            this.isRunning = !!state.isRunning;
            this.isPaused = !!state.isPaused;
            this.finished = !!state.finished;

            this.updateDisplay();
        });

        this.ipcRenderer.on('colors-update', (event, colors) => {
            this.applyColors(colors);
        });

        this.ipcRenderer.on('display-settings-update', (event, settings) => {
            if (settings.bgMode || settings.bgSolid || settings.bgGrad1) {
                this.applyBackground(settings);
            }
            this.applyDisplaySettings(settings);
        });
    }
    
    applyDisplaySettings(settings) {
        // Показ/скрытие текущего времени
        if (settings.showCurrentTime !== undefined) {
            this.showCurrentTime = settings.showCurrentTime;
            if (this.currentTimeBlock) {
                this.currentTimeBlock.classList.toggle('visible', this.showCurrentTime);
            }
        }
        
        // Показ/скрытие времени мероприятия
        if (settings.showEventTime !== undefined) {
            this.showEventTime = settings.showEventTime;
            if (this.eventTimeBlock) {
                this.eventTimeBlock.classList.toggle('visible', this.showEventTime);
            }
        }
        
        // Время мероприятия
        if (settings.eventTime && this.eventTimeEl) {
            this.eventTime = settings.eventTime;
            this.eventTimeEl.textContent = settings.eventTime;
        }
        
        // Масштаб таймера
        if (settings.timerScale !== undefined && this.timerRing) {
            this.timerScale = settings.timerScale;
            const scale = settings.timerScale / 100;
            this.timerRing.style.transform = `scale(${scale})`;
        }
    }

    startLocalStorageSync() {
        // Синхронизация каждые 100мс через localStorage
        setInterval(() => {
            const stateStr = localStorage.getItem('timerState');
            if (!stateStr) return;

            try {
                const state = JSON.parse(stateStr);
                this.totalSeconds = Number(state.totalSeconds) || 0;
                this.remainingSeconds = Number(state.remainingSeconds) || 0;
                this.isRunning = !!state.isRunning;
                this.isPaused = !!state.isPaused;
                this.finished = !!state.finished;
                this.updateDisplay();
            } catch (_) {}
        }, 100);

        // Слушаем изменения цветов
        window.addEventListener('storage', (e) => {
            if (e.key === 'timerColors' && e.newValue) {
                try {
                    this.applyColors(JSON.parse(e.newValue));
                } catch (_) {}
            }
        });
    }

    startColorSync() {
        // Периодическая проверка цветов (только цвета, не фон - фон управляется через IPC)
        setInterval(() => {
            this.syncColors();
        }, 2000);
    }

    syncColors() {
        // Только цвета таймера, БЕЗ фона
        const saved = localStorage.getItem('timerColors');
        if (saved) {
            try {
                this.applyColors(JSON.parse(saved));
            } catch (_) {}
        }
    }

    loadColors() {
        // При первой загрузке - применяем всё
        const saved = localStorage.getItem('timerColors');
        if (saved) {
            try {
                this.applyColors(JSON.parse(saved));
            } catch (_) {}
        }

        // Фон - загружаем один раз и из правильного источника
        this.loadBackgroundSettings();
    }

    loadBackgroundSettings() {
        const bgSettings = localStorage.getItem('displayExtSettings');
        if (bgSettings) {
            try {
                const settings = JSON.parse(bgSettings);
                
                // Для локального фона нужно дополнительно загрузить изображение
                if (settings.bgMode === 'local') {
                    const localBgImage = localStorage.getItem('localBgImage');
                    const localBgSettings = JSON.parse(localStorage.getItem('localBgSettings') || '{}');
                    if (localBgImage) {
                        settings.bgLocalImage = localBgImage;
                        settings.bgLocalFit = localBgSettings.fit || 'cover';
                        settings.bgLocalOverlay = localBgSettings.overlay || 30;
                    }
                }
                
                this.applyBackground(settings);
                this.applyDisplaySettings(settings);
            } catch (_) {}
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

        // Применяем фон
        document.body.style.backgroundImage = `url('${imageData}')`;
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
        overlayEl.style.background = `rgba(0, 0, 0, ${overlay / 100})`;
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
        const formatted = this.formatTime(secs);
        
        // Обновляем время
        this.timeDisplay.textContent = formatted;
        
        // Добавляем класс compact для длинного времени (минус или часы)
        const isCompact = secs < 0 || Math.abs(secs) >= 3600 || formatted.length > 5;
        this.timeDisplay.classList.toggle('compact', isCompact);

        // Обновляем прогресс
        this.updateProgress();

        // Обновляем статус
        this.updateStatus(secs);

        // Эффект завершения
        if (this.finished && !this.flashInterval) {
            this.triggerFinishEffect();
        }
    }

    updateProgress() {
        if (this.totalSeconds > 0) {
            const ratio = Math.max(0, Math.min(1, this.remainingSeconds / this.totalSeconds));
            const offset = this.circumference - (ratio * this.circumference);
            this.progressRing.style.strokeDashoffset = offset;

            // Цветовые предупреждения
            const percentLeft = (this.remainingSeconds / this.totalSeconds) * 100;
            
            this.progressRing.classList.remove('warning', 'danger');
            this.timeDisplay.classList.remove('warning', 'danger');

            if (percentLeft <= 10 && percentLeft > 0) {
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
        this.statusPill.classList.remove('running', 'paused', 'finished');

        if (this.finished || (secs <= 0 && this.totalSeconds > 0 && !this.isRunning)) {
            this.statusText.textContent = 'Время вышло!';
            this.statusPill.classList.add('finished');
        } else if (this.isRunning) {
            this.statusText.textContent = secs < 0 ? 'Перерасход времени' : 'Таймер активен';
            this.statusPill.classList.add('running');
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
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    new DisplayTimer();
});
