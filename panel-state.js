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


/**
 * Подзаголовок строки окна: «показан · круг · 140%».
 *
 * Чистая функция — принимает уже собранные значения и возвращает строку.
 * Отделена от DOM намеренно: собрать текст и достать значения — две разные
 * задачи, и ошибаться они будут по-разному.
 *
 * @param {{open: boolean, idle: string, style?: string, scale?: number, where?: string}} p
 * @returns {string}
 */
function windowRowSubtitle(p) {
    // Закрытое окно описывает СЕБЯ, открытое — своё состояние.
    if (!p || !p.open) { return (p && p.idle) || ''; }

    const parts = ['показан'];
    if (p.style) { parts.push(p.style); }
    // 100% — это «как обычно», и в подписи оно только шумит. Показываем
    // масштаб, только когда он о чём-то говорит.
    if (Number.isFinite(p.scale) && p.scale !== 100) { parts.push(p.scale + '%'); }
    if (p.where) { parts.push(p.where); }
    return parts.join(' · ');
}

/** Человеческие имена стилей — те же слова, что на кнопках выбора стиля. */
const STYLE_LABELS = {
    circle: 'круг',
    digital: 'LED',
    flip: 'флип',
    analog: 'аналог',
    digits: 'цифры'
};

const PanelStateMixin = {

    /**
     * Единственная сборка payload канала `widget-style-update`.
     *
     * Она была написана ШЕСТЬ раз подряд — в обработчиках стиля, шрифта,
     * масштаба, делений и в отложенном пуше. Копии уже разошлись: две из шести
     * не клали `timerScale` вообще, то есть виджет получал стиль без размера.
     * Добавить сюда новое поле значило бы отредактировать шесть мест и забыть
     * одно — ровно та поломка, которую этот проект уже ловил на настройках.
     *
     * @param {object} [extra] поля, которые вызывающий знает точнее (например
     *                         новое значение из обработчика change, ещё не
     *                         записанное в контрол)
     */
    widgetStylePayload(extra) {
        return Object.assign({
            timerStyle: this.timerStyleEl.value,
            timerScale: parseInt(this.timerScaleEl.value, 10),
            digitsFont: this.widgetDigitsFontEl ? this.widgetDigitsFontEl.value : 'inter',
            showTicks: this.widgetShowTicksEl?.checked ?? false,
            // Подпись состояния («идёт / пауза / перерасход») по умолчанию
            // ВЫКЛЮЧЕНА: её работу делает цвет дуги, а на маленьком виджете
            // слово занимает место, которого нет.
            statusLabel: this.widgetStatusLabelEl?.checked ?? false,
            alwaysOnTop: this.widgetAlwaysOnTopEl?.checked ?? true
        }, extra || {});
    },

    /**
     * Раскладывает живое состояние окон в подзаголовки их строк.
     *
     * Значения берутся из САМИХ контролов настроек, а не из отдельной копии:
     * копия разошлась бы с ящиком ровно в тот момент, когда пользователь
     * что-то в нём поменял.
     */
    renderWindowRows() {
        const val = (id) => {
            const el = document.getElementById(id);
            if (!el) { return undefined; }
            return el.value !== undefined ? el.value : el.dataset.value;
        };
        const num = (id) => {
            const n = parseInt(val(id), 10);
            return Number.isFinite(n) ? n : undefined;
        };
        const styleOf = (id) => STYLE_LABELS[val(id)];

        const monitor = document.getElementById('displaySelect');
        const where = monitor && monitor.value !== 'auto'
            ? monitor.options[monitor.selectedIndex]?.text.replace(/\s*\(.*\)$/, '')
            : undefined;

        const ROWS = [
            { btn: 'openWidgetBtn',  sub: 'subWidget',  style: styleOf('timerStyle'), scale: num('timerScale') },
            { btn: 'openClockBtn',   sub: 'subClock',   style: styleOf('clockStyle'), scale: num('clockScale') },
            { btn: 'openDisplayBtn', sub: 'subDisplay', where }
        ];

        for (const row of ROWS) {
            const btn = document.getElementById(row.btn);
            const sub = document.getElementById(row.sub);
            if (!btn || !sub) { continue; }
            if (!sub.dataset.idle) { sub.dataset.idle = sub.textContent; }
            sub.textContent = windowRowSubtitle({
                open: btn.classList.contains('active'),
                idle: sub.dataset.idle,
                style: row.style,
                scale: row.scale,
                where: row.where
            });
        }
    },

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

        // ВВОД ВРЕМЕНИ: три поля вместо одной слепленной строки.
        //
        // Разбирать формат больше не нужно — каждое поле принимает просто
        // число, и «1:30:00» перестало быть тем, что надо помнить и во что
        // надо попадать курсором.
        //
        // Таблица, а не три копии обработчика: поля отличаются только
        // потолком и соседями, и написанные по отдельности они разошлись бы
        // на первой же правке — как уже разошлись шесть копий payload.
        const TIME_FIELDS = [
            { id: 'manualHours', max: 99, mult: 3600 },
            { id: 'manualMinutes', max: 59, mult: 60 },
            { id: 'manualSeconds', max: 59, mult: 1 }
        ];
        const fields = TIME_FIELDS
            .map((f) => Object.assign({}, f, { el: document.getElementById(f.id) }))
            .filter((f) => f.el);
        this._timeFields = fields;

        const flashError = (el) => {
            el.classList.add('input-error');
            setTimeout(() => el.classList.remove('input-error'), 300);
            el.focus();
            el.select();
        };

        const applyManualTime = () => {
            let total = 0;
            for (const f of fields) {
                const n = parseInt(f.el.value, 10) || 0;
                // Значение выше потолка — опечатка, а не «ещё одна единица
                // старшего разряда»: молча перенести 75 секунд в минуты значило
                // бы поставить не то время, которое набрано. Часы потолка по
                // смыслу не имеют, но 99 хватает с запасом на любой доклад.
                if (n > f.max) { flashError(f.el); return; }
                total += n * f.mult;
            }
            // Ноль — не время. Прежний парсер его тоже не принимал.
            if (total <= 0) { flashError(fields[0].el); return; }

            ipcRenderer.send('timer-command', { type: 'set', seconds: total });
            this.setInputMode(false);
        };
        // Кнопка «Поставить» живёт в attachEvents() — это ДРУГАЯ область
        // видимости, локальная const оттуда не видна. Кладём на объект.
        this._applyManualTime = applyManualTime;

        fields.forEach((f, i) => {
            const prev = fields[i - 1];
            const next = fields[i + 1];

            // Цифры и ничего больше: поле числовое, буквам тут делать нечего.
            f.el.addEventListener('input', () => {
                const clean = f.el.value.replace(/\D/g, '').slice(0, 2);
                if (clean !== f.el.value) { f.el.value = clean; }
            });
            // Выделяем по фокусу: первая же цифра заменяет значение целиком,
            // а не дописывается к предзаполненному.
            f.el.addEventListener('focus', () => f.el.select());

            f.el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyManualTime();
                    return;
                }
                // Esc выходит из режима ввода и НЕ всплывает выше: Escape в этом
                // окне слоёный, и без остановки он закрыл бы заодно ящик настроек.
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.setInputMode(false);
                    return;
                }
                // Двоеточие — привычный разделитель: набравший «1:30:00» подряд
                // попадёт туда же, куда и нажавший Tab.
                if ((e.key === ':' || e.key === 'ArrowRight') && next) {
                    e.preventDefault();
                    next.el.focus();
                }
                if (e.key === 'ArrowLeft' && prev && f.el.selectionStart === 0) {
                    e.preventDefault();
                    prev.el.focus();
                }
                // Backspace в пустом поле возвращает к предыдущему — иначе
                // стирание упирается в невидимую стену.
                if (e.key === 'Backspace' && prev && f.el.value === '') {
                    e.preventDefault();
                    prev.el.focus();
                }
            });
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
        const fields = this._timeFields || [];
        if (this.inputMode) {
            // Предзаполняем ТЕКУЩИМ временем, а не пустотой: чаще всего правят
            // его, а не набирают с нуля. Поле выделяется по фокусу, поэтому
            // первая же цифра заменяет значение целиком.
            const total = Math.max(0, Math.round(this.remainingSeconds || this.presetSeconds || 0));
            const parts = window.RendererShared.breakdown(total);
            const value = { manualHours: parts.hours, manualMinutes: parts.minutes, manualSeconds: parts.seconds };
            for (const f of fields) {
                f.el.value = String(value[f.id]).padStart(f.id === 'manualHours' ? 1 : 2, '0');
            }
            // focus() после смены класса: пока поле display:none, фокус на нём
            // не удерживается. Начинаем с МИНУТ — часы почти всегда нули, и
            // начинать с них значило бы заставлять пропускать их каждый раз.
            const first = fields.find((f) => f.id === 'manualMinutes') || fields[0];
            requestAnimationFrame(() => first?.el.focus());
        } else {
            for (const f of fields) { f.el.blur(); }
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
        // Замечание про ПЕРВЫЙ КАДР: класс state-idle стоит прямо в разметке
        // <body>. До прихода первого timer-state этот метод ещё не вызывался,
        // класса состояния нет вообще — и правила видимости не находят ни одной
        // кнопки транспорта: панель показывалась без «Старта». Дефект живёт
        // ровно одну секунду и потому незаметен в разработке.

        const isOvertime = (band || window.RendererShared.timerColorBand(
            this.remainingSeconds, this.totalSeconds)) === 'overtime';
        const live = this.isRunning || this.isPaused;

        const mode = this.inputMode ? 'input'
            : isOvertime ? 'overtime'
                : live ? 'running' : 'idle';

        document.body.classList.remove('state-idle', 'state-running', 'state-overtime', 'state-input');
        document.body.classList.add('state-' + mode);

        // Подписи строк пересобираются здесь же, а не только при открытии окна:
        // стиль и масштаб меняются в ящике, и подпись обязана догонять их без
        // отдельной проводки от каждого контрола.
        this.renderWindowRows();

        // СЛОВО берётся из общего владельца приоритетов, а не из режима
        // раскладки. Первая версия писала слово по режиму и завела вторую
        // лестницу приоритетов: в перерасходе она печатала «Перерасход»,
        // затирая паузу, — а правило этого проекта обратное, пауза важнее
        // всего (докладчик, выбившийся из времени и нажавший паузу, видел
        // «Завершено» ровно из-за такой же второй лестницы).
        // Режим решает РАСКЛАДКУ, статус решает НАДПИСЬ.
        const LIFECYCLE_LABEL = {
            paused: 'Пауза',
            overtime: 'Перерасход',
            finished: 'Завершено',
            running: 'Осталось',
            idle: 'Длительность'
        };
        const lifecycle = status || window.RendererShared.timerLifecycleStatus({
            remainingSeconds: this.remainingSeconds,
            totalSeconds: this.totalSeconds,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            finished: this.wasFinished
        });
        const label = mode === 'input' ? 'Своё время' : LIFECYCLE_LABEL[lifecycle];
        if (this.statusText) { this.statusText.textContent = label; }

        // Подсказка под цифрами. В отсчёте и перерасходе это ВРЕМЯ
        // ОКОНЧАНИЯ — оно отвечает на вопрос, который иначе считают в
        // уме: «во сколько это кончится».
        const endLabel = window.RendererShared.endsAt(this.remainingSeconds, new Date());
        const HINT = {
            idle: 'нажмите на время, чтобы ввести своё',
            running: endLabel ? `закончится в ${endLabel}` : '',
            overtime: endLabel ? `должно было закончиться в ${endLabel}` : '',
            input: 'часы · минуты · секунды — Enter поставит'
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
    module.exports.windowRowSubtitle = windowRowSubtitle;
}
if (typeof window !== 'undefined') {
    window.PanelStateMixin = PanelStateMixin;
}
