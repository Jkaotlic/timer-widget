'use strict';

/**
 * Четыре состояния панели управления (редизайн 2026-08-12).
 *
 * Это ПРОТОТИПНЫЙ ПРИМЕСЬ-модуль, как custom-sounds.js и local-background.js:
 * методы обращаются к this.startBtn / this.remainingSeconds и вызывают друг
 * друга, поэтому свободными функциями их сделать нельзя без переписывания
 * семантики this. Подключение — одна строка в панели:
 *
 *     Object.assign(TimerController.prototype, window.PanelStateMixin);
 *
 * Если эта строка потеряется, при загрузке НИЧЕГО не упадёт — упадёт первый
 * же тик таймера. Ровно так в этом проекте уже терялись примеси.
 *
 * Что модуль знает о вёрстке: класс `state-*` на <body> и горстку id. Всё
 * остальное — видимость блоков, цвета, порядок — решает CSS по этому классу.
 * Модуль отдаёт ЗНАЧЕНИЯ и состояние, а не раскладку.
 */

const PanelStateMixin = {

    /**
     * Проводка ручного ввода: поле, три входа в режим и мастер-тумблер звука.
     *
     * Живёт здесь, а не в панели, по той же причине, что и сами состояния:
     * это ОДНА тема — «как панель принимает своё время». Разрезать её между
     * двумя файлами значило бы чинить один сценарий в двух местах.
     */
    bindPanelInputs() {
        const ipcRenderer = window.ipcRenderer;
        // Пятая ячейка ряда — «мин», у неё НЕТ data-minutes: она не
        // длительность, а вход в ручной ввод. Без этого условия
        // parseInt(undefined) дал бы NaN и команду set с NaN секунд.
        document.querySelectorAll('.preset[data-minutes]').forEach(btn => {
            btn.addEventListener('click', () => {
                const minutes = parseInt(btn.dataset.minutes);
                this.sendCommand('set', { seconds: minutes * 60 });
            });
        });

        // Кнопки корректировки времени (±1 мин, ±5 мин)
        document.querySelectorAll('.adjust-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.adjustTime(parseInt(btn.dataset.adjust));
            });
        });

        // Manual time input
        const manualTimeInput = document.getElementById('manualTimeInput');

        // Smart manual time parsing — delegate to TimeUtils (utils.js)
        // Сборщика нет: каждый файл — обычный <script>, поэтому ссылка на
        // соседний модуль идёт через window, а не голым именем.
        const parseManualTime = (input) => window.TimeUtils.parseManualTime(input);

        const applyManualTime = () => {
            const seconds = parseManualTime(manualTimeInput.value);
            if (seconds !== null) {
                ipcRenderer.send('timer-command', { type: 'set', seconds: seconds });
                manualTimeInput.value = '';
                manualTimeInput.blur();
                this.setInputMode(false);
            } else {
                manualTimeInput.classList.add('input-error');
                setTimeout(() => manualTimeInput.classList.remove('input-error'), 300);
            }
        };
        // Кнопка «Поставить» живёт в attachEvents() — это ДРУГАЯ область
        // видимости, локальная const оттуда не видна. Кладём на объект.
        this._applyManualTime = applyManualTime;

        manualTimeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyManualTime();
            }
            // Esc из поля выходит из режима ввода, а не всплывает выше:
            // Escape в этом окне слоёный, и без остановки он закрыл бы
            // заодно ящик настроек.
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.setInputMode(false);
            }
        });

        // Три входа в ручной ввод — клик по времени, ячейка «мин» и
        // синяя кнопка «Поставить» (она же #startBtn в этом режиме).
        document.getElementById('controlTime')?.addEventListener('click', () => this.setInputMode(true));
        document.getElementById('presetCustom')?.addEventListener('click', () => this.setInputMode(true));
        document.getElementById('manualCancel')?.addEventListener('click', () => this.setInputMode(false));

        // Мастер-тумблер звука живёт строкой «Звуки» в списке окон.
        const soundMaster = document.getElementById('soundMasterToggle');
        soundMaster?.addEventListener('click', () => {
            this.setSoundEnabled(!this.soundEnabled);
            soundMaster.setAttribute('aria-checked', String(!!this.soundEnabled));
            soundMaster.classList.toggle('active', !!this.soundEnabled);
            soundMaster.title = this.soundEnabled ? 'Звук включён' : 'Звук выключен';
        });
    },

    /**
     * Ручной ввод — ЧЕТВЁРТОЕ состояние панели, а не поле сбоку.
     * Флаг держится здесь, а вся раскладка выводится из него в
     * renderPanelState(): иначе состояние пришлось бы чинить в двух местах.
     */
    setInputMode(on) {
        // Во время отсчёта вводить нечего: там работают ± и пауза.
        if (on && (this.isRunning || this.isPaused)) { return; }
        this.inputMode = !!on;
        const field = document.getElementById('manualTimeInput');
        if (this.inputMode) {
            field.value = '';
            // focus() после смены класса: пока поле display:none,
            // фокус на нём не удерживается.
            requestAnimationFrame(() => field.focus());
        } else {
            field.blur();
        }
        this.renderPanelState();
    },

    /**
     * Одна точка, которая раскладывает состояние таймера в панель:
     * класс на <body> (он же управляет видимостью блоков через CSS),
     * подпись над цифрами, подсказку под ними, полосу и футер.
     *
     * Состояние выводится из таймера, а не запоминается по последнему
     * клику: любой другой способ изменить таймер — горячая клавиша,
     * команда из другого окна, восстановление после падения — обязан
     * приводить панель в тот же вид.
     */
    renderPanelState(status, band) {
        const isOvertime = (band || window.RendererShared.timerColorBand(
            this.remainingSeconds, this.totalSeconds)) === 'overtime';
        const live = this.isRunning || this.isPaused;

        const mode = this.inputMode ? 'input'
            : isOvertime ? 'overtime'
                : live ? 'running' : 'idle';

        document.body.classList.remove('state-idle', 'state-running', 'state-overtime', 'state-input');
        document.body.classList.add('state-' + mode);

        const LABEL = {
            idle: 'Длительность',
            running: this.isPaused ? 'Пауза' : 'Осталось',
            overtime: 'Перерасход',
            input: 'Своё время'
        };
        if (this.statusText) { this.statusText.textContent = LABEL[mode]; }

        // Подсказка под цифрами. В отсчёте и перерасходе это ВРЕМЯ
        // ОКОНЧАНИЯ — оно отвечает на вопрос, который иначе считают в
        // уме: «во сколько это кончится».
        const endLabel = window.RendererShared.endsAt(this.remainingSeconds, new Date());
        const HINT = {
            idle: 'нажмите на время, чтобы ввести своё',
            running: endLabel ? `закончится в ${endLabel}` : '',
            overtime: endLabel ? `должно было закончиться в ${endLabel}` : '',
            input: '90 — секунды · 5:30 — минуты · 1:30:00 — часы'
        };
        const hintEl = document.getElementById('heroHint');
        if (hintEl) { hintEl.textContent = HINT[mode]; }

        // Полоса. В перерасходе её заливка прибита к 100% в CSS —
        // проценты там уже не значат ничего.
        const fill = document.getElementById('panelProgressFill');
        if (fill && mode === 'running') {
            const total = this.totalSeconds || 0;
            const done = total > 0 ? (total - this.remainingSeconds) / total : 0;
            fill.style.width = Math.max(0, Math.min(1, done)) * 100 + '%';
        }

        const footer = document.getElementById('panelFooter');
        if (footer) {
            const every = parseInt(this.overrunIntervalEl?.value, 10);
            footer.textContent = mode === 'overtime' && Number.isFinite(every) && every > 0
                ? `Уведомление каждые ${every} мин`
                : mode === 'running'
                    ? 'Space — пауза · R — сброс'
                    : 'Space — старт · R — сброс · 1–4 — пресеты';
        }

        // Кнопка одна, названий у неё три.
        if (this.startBtn) {
            this.startBtn.firstChild.nodeValue = this.inputMode ? 'Поставить' : 'Старт';
            const key = this.startBtn.querySelector('.transport-key');
            if (key) { key.textContent = this.inputMode ? 'Enter' : 'Space'; }
        }
        if (this.pauseBtn) {
            this.pauseBtn.firstChild.nodeValue = isOvertime ? 'Стоп' : 'Пауза';
        }
    }
};

// Node (тесты) и браузер (панель) — двойной экспорт, как у остальных модулей.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PanelStateMixin;
}
if (typeof window !== 'undefined') {
    window.PanelStateMixin = PanelStateMixin;
}
