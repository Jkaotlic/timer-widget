// Display Timer - Полноэкранное отображение таймера

// Зазор между колонкой героя (подпись «Осталось» + таймер) и всем, что стоит
// у неё на пути. Владелец ОДИН: его просит и потолок масштаба (fitTimerScale),
// и полоса под верхними карточками (updateTopBand). Два числа разъехались бы
// при первой же правке, и таймер упирался бы в один зазор, а отодвигался на
// другой.
const HERO_GAP = 8;

// Места по умолчанию, прижатые к ВЕРХУ окна. Только они спорят с колонкой:
// нижние карточки стоят под таймером, а сдвинутая мышью карточка — выбор
// пользователя, и место ей уступать не за что.
const TOP_HOME_POSITIONS = ['top-left', 'top-center', 'top-right', 'top-left-third', 'top-right-third'];

// Больше этой доли своей высоты рама героя не уступает никогда. Предохранитель,
// а не настройка: он срабатывает только там, где уступка всё равно бесполезна
// (стиль, чья высота от рамы не зависит), и не даёт ответу уехать в бесконечность.
const MAX_FRAME_SHRINK_SHARE = 0.45;

class DisplayTimer {
    constructor() {
        // Радиус дуги прогресса во вьюбоксе 400×400. Дублируется в display.html
        // (r у .ring-track и #progressRing) — там же разбор, почему 176.
        this.radius = 176;
        this.circumference = 2 * Math.PI * this.radius;
        this.totalSeconds = 0;
        this.remainingSeconds = 0;
        this.isRunning = false;
        this.isPaused = false;
        this.finished = false;
        this.overrunLimitSeconds = 0;

        // Скрытый режим «47-й этаж»: накопитель приезжает каналом
        // event-overrun-state и снимается окну на открытии — здесь только
        // зеркало. Ставка приходит с настройками СТРОКОЙ (таблица настроек
        // знает только 'checkbox' и 'value'), к числу её приводит money-meter.
        this.eventOverrunSeconds = 0;
        this.eventFinished = false;
        this.floor47Unlocked = false;
        this.showOverrunCost = false;
        this.showTotalCost = false;
        this.overrunPrice = '1000';
        this.overrunPeriod = '3';
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
        this.initMovableElements();
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

    /**
     * Реестр подвижных элементов: id из display-layouts.js → узел этого окна.
     *
     * Список ОДИН на всё окно: по нему вешается перетаскивание, крестик и
     * колесо, по нему же раскладываются раскладки и сохраняются позиции с
     * масштабами. Раньше он был написан трижды — в setupBlockControls, в
     * restoreBlockPositions и в applyDisplaySettings, — и блок «До завершения»
     * успел появиться в двух копиях из трёх: масштаб его не касался вовсе.
     */
    initMovableElements() {
        const nodes = {
            currentTime: this.currentTimeBlock,
            eventTime: this.eventTimeBlock,
            endTime: this.endTimeBlock,
            timeLeft: this.timeLeftBlock,
            eventTitle: this.eventTitleBlock,
            heroLabel: this.heroLabel,
            statusPill: this.statusPill,
            // Скрытый режим «47-й этаж». Без узла здесь элемент молча
            // отфильтровывается ниже и теряет перетаскивание, масштаб и
            // память о своём месте, оставаясь при этом на экране.
            overrunCost: this.overrunCostBlock,
            totalCost: this.totalCostBlock
        };
        // Подпись и плашка масштабируются кеглем через переменную на <body>
        // (см. display.css): они набраны в em и `transform` им не годится —
        // подпись стоит в потоке, а трансформация в раскладке не участвует.
        const labelVars = { heroLabel: '--hero-label-scale', statusPill: '--status-pill-scale' };
        const registry = (window.DisplayLayouts && window.DisplayLayouts.DISPLAY_ELEMENTS) || [];
        this.movableElements = registry
            .map((row) => Object.assign({}, row, {
                el: nodes[row.id],
                cssVar: labelVars[row.id] || null,
                // Подпись стоит В ПОТОКЕ над таймером, и колонка держит под неё
                // место. Ушла из потока — компенсация обязана уйти следом.
                flowClass: row.id === 'heroLabel' ? 'hero-label-moved' : null
            }))
            .filter((row) => row.el);

        // ВОСЬМОЙ подвижный элемент — сама колонка героя: подпись и таймер
        // (просьба 24.08.2026). В реестре display-layouts.js его НЕТ, и это
        // не забывчивость: тот реестр описывает элементы, у каждого из которых
        // есть тумблер в панели и СВОЙ масштаб (`--info-scale`). У таймера нет
        // ни того, ни другого — выключать его бессмысленно, а масштаб у него
        // свой собственный и давно (`displayTimerScale`, Ctrl+колесо). Попади
        // он в тот реестр — у масштаба таймера стало бы два владельца.
        //
        // `kind: 'timer'` читают ровно три места: колесо (масштабировать
        // ТАЙМЕР, а не элемент), крестик (у колонки его нет) и раскладка
        // (вернуть колонку в поток). Всё остальное — перетаскивание,
        // сохранение места, пересчёт по доле окна — работает с ним как с любым
        // другим подвижным элементом, потому что спрашивает про класс
        // `custom-position`, а не про вид элемента.
        const heroColumn = document.querySelector('.display-container');
        if (heroColumn) {
            this.movableElements.push({
                id: 'timerBox',
                toggle: null,
                kind: 'timer',
                el: heroColumn,
                cssVar: null,
                flowClass: 'timer-moved',
                // Держать при перетаскивании надо ТО, за что взялись: у колонки
                // при выходе из потока меняются отступы (уходят `--top-band` и
                // `--hero-block`), и её собственная коробка съезжает
                // относительно таймера внутри. Якорь — активный блок стиля.
                anchor: () => [this.timerRing, this.timerFlip, this.timerAnalog, this.timerDigits]
                    .find((el) => el && el.classList.contains('active')) || heroColumn
            });
        }

        this.elementScales = {};
        // Доля окна для КАЖДОГО сдвинутого элемента — по ней он переставляется
        // при смене размера окна (см. reflowElements).
        this.elementFractions = {};
    }

    movableRow(id) {
        return (this.movableElements || []).find((row) => row.id === id) || null;
    }

    /**
     * Масштаб ОДНОГО элемента. Возвращает применённое значение.
     *
     * Масштабов теперь семь, по одному на элемент. Общего больше нет: он двигал
     * три карточки из семи элементов, и пользователь, увеличивший «Текущее
     * время», получал заодно увеличенные «Начало» и «Окончание».
     */
    applyElementScale(id, pct) {
        const row = this.movableRow(id);
        if (!row) { return null; }
        const value = window.DisplayLayouts.clampScale(pct);
        if (value === null) { return null; }
        this.elementScales[id] = value;
        if (row.cssVar) {
            document.body.style.setProperty(row.cssVar, String(value / 100));
        } else {
            row.el.style.setProperty('--info-scale', String(value / 100));
        }
        return value;
    }

    saveElementScales() {
        this._safeSetItem('displayBlockScales', JSON.stringify(this.elementScales));
    }

    /**
     * Масштабы из хранилища. Старый общий ключ `displayBlockScale` читается как
     * запасной: профиль, переживший обновление, обязан открыться таким же.
     */
    restoreElementScales() {
        const parse = window.SecurityUtils && window.SecurityUtils.safeJSONParse;
        let stored = null;
        try {
            const raw = localStorage.getItem('displayBlockScales');
            stored = parse ? parse(raw, null) : null;
        } catch { /* ok */ }
        let legacy = null;
        try {
            const raw = parseInt(localStorage.getItem('displayBlockScale'), 10);
            if (Number.isFinite(raw)) { legacy = raw; }
        } catch { /* ok */ }
        const scales = window.DisplayLayouts.normalizeScales(stored, legacy);
        for (const [id, pct] of Object.entries(scales)) { this.applyElementScale(id, pct); }
    }

    /**
     * Позиции ВСЕХ сдвинутых элементов — одна запись в хранилище.
     *
     * Пишутся И пиксели, И доля окна. Доля — то, чем пользуются: пиксель верен
     * ровно для того окна, в котором его записали, и в оконном режиме, где
     * размер меняют мышью, блоки по пикселям разъезжаются. Пиксель остаётся
     * ради отката на предыдущую версию, которая доли не понимает.
     */
    saveElementPositions() {
        const positions = {};
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        for (const row of (this.movableElements || [])) {
            if (!row.el.classList.contains('custom-position')) { continue; }
            const record = {
                left: parseInt(row.el.style.left) || 0,
                top: parseInt(row.el.style.top) || 0
            };
            const rect = row.el.getBoundingClientRect();
            const fraction = rect.width > 0
                ? window.DisplayLayouts.positionToFraction(rect, viewport)
                : null;
            if (fraction) {
                record.cx = Math.round(fraction.cx * 10000) / 10000;
                record.cy = Math.round(fraction.cy * 10000) / 10000;
                this.elementFractions[row.id] = fraction;
            }
            positions[row.id] = record;
        }
        if (Object.keys(positions).length > 0) {
            this._safeSetItem('displayBlockPositions', JSON.stringify(positions));
        }
    }

    /**
     * Переложить сдвинутые элементы под НОВЫЙ размер окна.
     *
     * Жалоба 17.08.2026: «сворачиваю окно, начинаю масштабировать — все плашки
     * разъезжаются». Так и было: позиция хранилась в пикселях, а в оконном
     * режиме размер окна меняет пользователь. Блок, стоявший у нижнего края,
     * оказывался в середине, стоявший у правого — за краем. Вдобавок сами
     * блоки набраны от `vw` и при смене ширины меняют габарит, так что даже
     * «неподвижная» координата переставала означать то же место.
     *
     * Пересчёт идёт по ДОЛЕ, запомненной при постановке, а не по прежним
     * пикселям: доля не зависит от того, каким окно было в прошлый раз.
     */
    /**
     * Пересчёт мест на СЛЕДУЮЩЕМ кадре.
     *
     * Габарит карточки меняется не в тот же миг, когда меняется её причина:
     * шрифт «Цифр» применяется переменной и перерисовывается после загрузки
     * woff2, длинное название мероприятия переносится по новым метрикам, стиль
     * приходит раньше шрифта. Замер 19.08.2026: пересчёт, сделанный сразу,
     * видел название шириной 595px, а через кадр оно стало 617px — и центр,
     * который пересчёт только что выставил, уехал на 0.003 ширины окна.
     *
     * Кадр здесь — не «подождать на всякий случай»: браузер к его началу уже
     * пересчитал раскладку с новыми метриками. Повторные вызовы схлопываются в
     * один: пересчёт идемпотентен, но делать его четыре раза подряд незачем.
     */
    reflowSoon() {
        if (this._reflowScheduled) { return; }
        this._reflowScheduled = true;
        const run = () => {
            this._reflowScheduled = false;
            this.reflowElements();
        };
        if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(run); } else { run(); }
    }

    reflowElements() {
        // Тот же замер коробок, что и в раскладке, — значит та же оговорка про
        // едущий `transform`: ресайз окна может прийти посреди перехода.
        return this.withSettledTransforms(() => this._reflowPass());
    }

    _reflowPass() {
        if (!this.movableElements || !this.elementFractions) { return; }
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        if (!viewport.width || !viewport.height) { return; }
        let moved = false;
        for (const row of this.movableElements) {
            if (!row.el.classList.contains('custom-position')) { continue; }
            const fraction = this.elementFractions[row.id];
            if (!fraction) { continue; }
            const rect = row.el.getBoundingClientRect();
            if (!rect.width || !rect.height) { continue; }
            const pos = window.DisplayLayouts.fractionToPosition(
                fraction, viewport, { width: rect.width, height: rect.height }
            );
            if (!pos) { continue; }
            const wasLeft = parseFloat(row.el.style.left);
            const wasTop = parseFloat(row.el.style.top);
            this.placeElementAt(row, pos.left, pos.top);
            this.settleAfterResize(row, fraction, viewport, rect);
            // Записываем, только если место ДЕЙСТВИТЕЛЬНО изменилось.
            //
            // Пересчёт зовётся на каждой посылке настроек, а не только при
            // изменении размера окна, и раньше он писал места ВСЕГДА — теми же
            // числами, что и прочитал. Безобидно ровно до пресета: панель
            // сначала кладёт в профиль места из снимка, потом рассылает
            // настройки, и вот этот холостой пересчёт успевал ЗАТЕРЕТЬ их
            // текущими, ещё не обновлёнными. Дальше приходило «перечитай» — и
            // окно перечитывало собственную запись. Замер: таймер, сдвинутый
            // после записи пресета, оставался сдвинутым после его применения.
            const nowLeft = parseFloat(row.el.style.left);
            const nowTop = parseFloat(row.el.style.top);
            if (!Number.isFinite(wasLeft) || !Number.isFinite(wasTop)
                || Math.abs(nowLeft - wasLeft) > 0.5 || Math.abs(nowTop - wasTop) > 0.5) {
                moved = true;
            }
        }
        // Доли НЕ пересобираются из нового положения: у прижатого к краю
        // элемента доля изменилась бы, и следующий ресайз считал бы уже от
        // сдвинутой точки — окно «съедало» бы композицию шаг за шагом.
        // Поэтому в хранилище уходят прежние доли с новыми пикселями.
        if (moved) { this.saveElementPositionsKeepingFractions(); }
    }

    /** Записать позиции, оставив доли такими, какими они были. */
    saveElementPositionsKeepingFractions() {
        const positions = {};
        for (const row of (this.movableElements || [])) {
            if (!row.el.classList.contains('custom-position')) { continue; }
            const record = {
                left: parseInt(row.el.style.left) || 0,
                top: parseInt(row.el.style.top) || 0
            };
            const fraction = this.elementFractions[row.id];
            if (fraction) {
                record.cx = Math.round(fraction.cx * 10000) / 10000;
                record.cy = Math.round(fraction.cy * 10000) / 10000;
            }
            positions[row.id] = record;
        }
        if (Object.keys(positions).length > 0) {
            this._safeSetItem('displayBlockPositions', JSON.stringify(positions));
        }
    }

    /**
     * Поставить элемент так, чтобы его ВИДИМАЯ коробка встала в (left, top).
     *
     * Второй проход обязателен: `left`/`top` задают НЕотмасштабированную
     * коробку, а видно отмасштабированную, и расходятся они на величину,
     * зависящую от `transform-origin`. Тот же приём уже стоит в перетаскивании
     * блоков — там его пришлось завести после замера «блок прыгает под курсором
     * на 32px ещё до первого движения мыши».
     */
    markCustomPosition(row) {
        row.el.classList.remove(
            'top-left', 'top-center', 'top-right',
            'bottom-left', 'bottom-center', 'bottom-right',
            'top-left-third', 'top-right-third',
            'bottom-left-third', 'bottom-right-third'
        );
        row.el.classList.add('custom-position');
        if (row.flowClass) { document.body.classList.add(row.flowClass); }
        row.el.style.right = '';
        row.el.style.bottom = '';
        row.el.style.marginLeft = '';
        row.el.style.marginRight = '';
    }

    /**
     * Выполнить расчёт раскладки на ОСЕВШИХ трансформациях.
     *
     * Всё, что здесь считается, опирается на замер коробок, а масштаб элемента
     * едет переходом: `--info-scale` меняется мгновенно, `transform` — 400 мс.
     * Замер в этом промежутке возвращает ПРОШЛЫЙ масштаб, и дальше он врёт
     * дважды — в натуральном габарите и в доводке позиции.
     *
     * Класс снимается в requestAnimationFrame, а не сразу: значения к концу
     * расчёта уже конечные, и вернувшийся переход анимировать не станет.
     */
    withSettledTransforms(fn) {
        const body = document.body;
        // Счётчик, а не голый класс: вложенный вызов (полоса сверху считается
        // ВНУТРИ раскладки) снял бы класс на своём выходе, и внешний расчёт
        // домеривал бы уже едущие трансформации — ровно тот дефект, ради
        // которого класс и заведён.
        this._settleDepth = (this._settleDepth || 0) + 1;
        body.classList.add('layout-settling');
        // Чтение форсирует пересчёт стилей: без него класс мог бы примениться
        // уже ПОСЛЕ того, как браузер завёл переход на новое значение.
        void body.offsetWidth;
        const release = () => {
            this._settleDepth = Math.max(0, (this._settleDepth || 1) - 1);
            if (this._settleDepth === 0) { body.classList.remove('layout-settling'); }
        };
        try {
            return fn();
        } finally {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(release);
            } else {
                release();
            }
        }
    }

    placeElementAt(row, left, top) {
        this.markCustomPosition(row);
        row.el.style.left = left + 'px';
        row.el.style.top = top + 'px';
        const shifted = row.el.getBoundingClientRect();
        const wantLeft = left + (left - shifted.left);
        const wantTop = top + (top - shifted.top);
        row.el.style.left = wantLeft + 'px';
        row.el.style.top = wantTop + 'px';
    }


    /**
     * Переставить элемент ЕЩЁ РАЗ, если от перестановки изменился его габарит.
     *
     * Место считается по коробке, измеренной ДО перестановки, а между замером
     * и результатом габарит может измениться: кегль подписи и значения задан
     * долями вьюпорта (`vmin` / `vw`), поэтому при изменении размера окна
     * карточка меняет ширину сама, а пересчёт приходит по debounce. Замер на
     * CI 19.08.2026: окно 900×640, правый край карточки 901.7 — вылет на
     * 1.7px, невидимый глазом и всё же нарушающий инвариант «ничто не выходит
     * за окно».
     *
     * Лечится не поджатием к краю, а ПОВТОРНЫМ счётом по новому габариту: доля
     * остаётся та же, поджатие к окну делает та же `fractionToPosition`, и
     * элемент, который в окно помещается, не сдвигается ни на пиксель.
     * Поджатие «по факту» здесь было бы хуже: окно после открытия доезжает до
     * своего размера не мгновенно, и элемент, оказавшийся за краем
     * ПРОМЕЖУТОЧНОГО вьюпорта, уехал бы навсегда (замер: подпись 1188 → 1191).
     *
     * Итерация ровно одна: второй замер сделан уже на новом месте, и третий
     * дал бы то же число.
     */
    settleAfterResize(row, fraction, viewport, before) {
        const after = row.el.getBoundingClientRect();
        if (Math.abs(after.width - before.width) < 0.5 && Math.abs(after.height - before.height) < 0.5) { return; }
        const pos = window.DisplayLayouts.fractionToPosition(
            fraction, viewport, { width: after.width, height: after.height }
        );
        if (pos) { this.placeElementAt(row, pos.left, pos.top); }
    }

    /** Вернуть элемент на его место в раскладке окна (подпись, плашка). */
    releaseToFlow(row) {
        // Доля принадлежит СДВИНУТОМУ элементу. Оставь её здесь — и при первом
        // же изменении размера окна вернувшийся в поток элемент снова выдернуло
        // бы в старую точку.
        if (this.elementFractions) { delete this.elementFractions[row.id]; }
        row.el.classList.remove('custom-position');
        if (row.flowClass) { document.body.classList.remove(row.flowClass); }
        row.el.style.left = '';
        row.el.style.top = '';
        row.el.style.right = '';
        row.el.style.bottom = '';
        row.el.style.marginLeft = '';
        row.el.style.marginRight = '';
    }

    /**
     * Применить готовую раскладку.
     *
     * Порядок шагов несущий:
     *   1. масштабы подписи и плашки — по ним считается свободное место;
     *   2. подпись и плашка возвращаются в поток, если раскладка их там держит;
     *   3. масштаб таймера — он ограничен свободным местом (fitTimerScale);
     *   4. НАТУРАЛЬНЫЕ габариты карточек (замер делится на текущий масштаб);
     *   5. раскладка считает координаты и, если надо, УМЕНЬШАЕТ масштаб;
     *   6. запись позиций и масштабов.
     *
     * Тумблеры блоков здесь не трогаются вовсе: ими владеет панель, и она
     * присылает их обычными настройками ДО этого канала. Вторая копия
     * состояния видимости в этом окне уже была источником дефекта.
     */
    applyLayout(layoutId) {
        const DL = window.DisplayLayouts;
        const layout = DL && DL.layoutById(layoutId);
        if (!layout || !this.movableElements) { return false; }

        return this.withSettledTransforms(() => this._layoutPass(DL, layout));
    }

    /** Сам расчёт раскладки. Вызывается только из applyLayout, на осевших трансформациях. */
    _layoutPass(DL, layout) {
        // Раскладка ставит карточки САМА и считает координаты от коробки
        // таймера. Полоса по умолчанию здесь не действует и обнуляется ДО
        // расчёта: иначе сдвинутый ею таймер увёл бы за собой все семь
        // координат, а после раскладки полоса всё равно стала бы нулевой —
        // каждая карточка получает custom-position. Уступка рамы обнуляется по
        // той же причине: раскладка задаёт масштаб героя сама.
        this.setTopBand(0);
        this.setTimerShrink(0);
        const scales = DL.layoutScales(layout);
        for (const [id, pct] of Object.entries(scales)) { this.applyElementScale(id, pct); }

        for (const row of this.movableElements) {
            const entry = layout.elements[row.id];
            if (!entry || entry.flow) {
                // Выключенный элемент тоже возвращается в поток: включённый
                // потом руками, он иначе появился бы там, где его оставила
                // позапрошлая раскладка.
                // Подпись, плашка и колонка героя — те, у кого поток и есть
                // их место. У карточек места в потоке нет вовсе.
                if (row.cssVar || row.kind === 'timer') { this.releaseToFlow(row); }
            }
        }

        this.timerScale = layout.timerScale;
        const effective = this.applyTimerScale();
        this.updateDigitsScale();
        if (Number.isFinite(effective)) {
            this.timerScale = effective;
            this._safeSetItem('displayTimerScale', String(effective));
            this._lastPushedTimerScale = effective;
            if (this.ipcRenderer) {
                this.ipcRenderer.send('report-scale', { source: 'display', scalePct: effective });
            }
        }

        // Натуральный габарит — это НЕОТМАСШТАБИРОВАННАЯ коробка, и берётся она
        // из offsetWidth/offsetHeight, а не из getBoundingClientRect() с
        // делением на текущий масштаб.
        //
        // Почему деление не работало. Масштаб элемента живёт в `transform:
        // scale(var(--info-scale))`, а на `transform` у `.info-block` висит
        // переход в 400 мс. Переменная меняется мгновенно, матрица едет.
        // Замер на живом окне ровно в этой точке: `--info-scale` уже `0.95`, а
        // `transform` ещё `matrix(1.2, …)`, `getBoundingClientRect().width` =
        // 255.8 при настоящих 213 — то есть замер отдавал ПРОШЛЫЙ масштаб, а
        // делился на НОВЫЙ, и габарит выходил завышенным в (прошлый/новый) раз.
        //
        // На позицию это не влияло, и потому дефект дожил до жалобы: ошибка
        // гасилась второй, симметричной — `placeElementAt` доводит видимую
        // коробку до места ТЕМ ЖЕ устаревшим замером, и по арифметике обе
        // сокращаются точно. А вот поджатие масштаба к свободной полосе внутри
        // placeElements считается от высоты, и там гасить нечем: раскрученные
        // колесом блоки, которые пересекают коробку таймера, приезжали на 62 %
        // при 95 % у соседей — ряд из четырёх карточек ДВУХ разных размеров.
        // Это и есть «пресеты ставят элементы неровно при масштабировании».
        //
        // offsetWidth/offsetHeight трансформацию не видят вовсе — ни текущую,
        // ни промежуточную, — поэтому делить больше не на что и ждать
        // нечего. Замер подтверждён: во всех состояниях перехода offsetWidth
        // держался на 213.
        const naturalSizes = {};
        for (const row of this.movableElements) {
            const entry = layout.elements[row.id];
            if (!entry || entry.flow) { continue; }
            const width = row.el.offsetWidth;
            const height = row.el.offsetHeight;
            if (!width || !height) { continue; }
            naturalSizes[row.id] = { width, height };
        }

        const timerBlock = [this.timerRing, this.timerFlip, this.timerAnalog, this.timerDigits]
            .find((b) => b && b.classList.contains('active'));
        // Полоса сверху обнуляется ПОВТОРНО и прямо перед замером колонки.
        //
        // Первый ноль стоит в начале метода, но между ним и этой точкой
        // вызывается applyTimerScale(), а он начинается с updateTopBand() —
        // и та считает полосу по СТАРЫМ местам карточек (раскладка их ещё не
        // переставила). Замер 19.08.2026 на 1440×900: полоса 44px, колонка
        // сдвинута ею на 22px вниз, hero.top 178 вместо 156 — и «Классика»
        // укладывала карточку впритык к тому месту, где подпись окажется
        // ЧЕРЕЗ мгновение, когда финальный updateTopBand() вернёт ноль.
        // Перекрытие 14px, видимое на 1440×900 и 1280×720 и невидимое на
        // 1920×1080.
        this.setTopBand(0);
        void document.body.offsetWidth;

        // Препятствие для карточек — вся КОЛОНКА ГЕРОЯ, а не одно кольцо.
        //
        // Подпись «Осталось» стоит НАД таймером, в том же потоке, и ширина её
        // меньше — из коробки таймера она не выводится никак. Пока сюда
        // приезжал только таймер, раскладка честно обходила его и ложилась на
        // подпись: «Классика» ставит «Текущее время» на 0.10 высоты, и на
        // 1440×900 карточка накрывала подпись (замер 19.08.2026, после подъёма
        // карточек до 150 %; на 1920×1080 не воспроизводилось — тот самый
        // случай, когда экран разработчика прячет дефект).
        //
        // Та же коробка, что у полосы сверху (`heroColumnBox`): «где герой» —
        // это один вопрос, и двух ответов у него быть не должно.
        const heroBox = timerBlock ? this.heroColumnBox(timerBlock) : null;

        const placed = DL.placeElements(
            layout,
            { width: window.innerWidth, height: window.innerHeight },
            naturalSizes,
            heroBox ? { timer: heroBox } : {}
        );

        for (const [id, pos] of Object.entries(placed)) {
            const row = this.movableRow(id);
            if (!row) { continue; }
            this.applyElementScale(id, pos.scale);
            this.placeElementAt(row, pos.left, pos.top);
        }

        this.saveElementPositions();
        this.saveElementScales();
        // Пересчёт честный, а не формальный ноль: раскладка перечисляет не все
        // семь элементов, и оставшийся на месте по умолчанию всё ещё на пути.
        this.updateTopBand();
        return true;
    }

    setupResizeHandler() {
        // Пересчитываем размеры при изменении окна с debounce.
        //
        // Стиль «Цифры» кладёт кегль НЕ в масштаб (applyTimerScale двигает CSS
        // transform: scale, а не font-size), а в --digits-font-size — свою
        // отдельную величину, подобранную под фактические px окна. Изменение
        // размера окна меняет доступный прямоугольник ровно так же, как первое
        // включение стиля, поэтому без отдельного вызова кегль остаётся
        // прежним после ресайза, пока пользователь не пересечёт границу часов.
        const recalc = () => {
            this.applyTimerScale();
            this.updateDigitsScale();
            // Сдвинутые элементы переставляются по своей доле окна: в оконном
            // режиме размер меняет пользователь, и позиция в пикселях означала
            // бы разъезжающуюся композицию.
            this.reflowElements();
        };
        const debouncedResize = window.TimeUtils && window.TimeUtils.debounce
            ? window.TimeUtils.debounce(recalc, window.CONFIG ? window.CONFIG.RESIZE_DEBOUNCE : 300)
            : recalc;

        this._handlers.windowResize = debouncedResize;
        window.addEventListener('resize', this._handlers.windowResize);
        // Начальный расчёт
        recalc();
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
                // Escape окно НЕ гасит (просьба 24.08.2026): на совещании его
                // жмут рефлекторно — чтобы выйти из ввода, снять выделение,
                // закрыть чужой попап, — и таймер пропадал с проектора. Жест
                // «закрыть» остался за буквой, которая об этом написана.
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
                // Z: мастер-звук. Значение принадлежит ПАНЕЛИ — окно просит.
                case 'KeyZ':
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        this.ipcRenderer.send('sound-toggle');
                    }
                    break;
            }

            // Ctrl+1…4 — пресеты ВИДА. Само окно применить их не может: ключи
            // профиля раскладывает по контролам и рассылает панель, поэтому
            // отсюда уезжает только НОМЕР ячейки. Голые 1…4 остаются за
            // пресетами времени — отбирать работающий жест ради нового нельзя.
            if ((e.ctrlKey || e.metaKey) && /^Digit[1-4]$/.test(e.code)) {
                e.preventDefault();
                if (this.ipcRenderer) {
                    this.ipcRenderer.send('preset-apply', { slot: Number(e.code.replace('Digit', '')) });
                }
                return;
            }

            // Пресеты. Комментарий «1-8 (5,10,15,20,25,30,45,60 минут)» остался
            // от прежнего набора длительностей: их четыре
            // (CONFIG.PRESET_DURATIONS), и клавиши 5–8 слали
            // `seconds: undefined`, что движок приводит к нулю — то есть
            // СБРАСЫВАЛИ ТАЙМЕР. Диапазон выводится из реестра, а не пишется
            // числом: второе число разъедется с реестром при первой же правке.
            if (e.code >= 'Digit1' && e.code <= 'Digit9') {
                const presets = window.CONFIG.PRESET_DURATIONS;
                const idx = parseInt(e.code.replace('Digit', '')) - 1;
                if (idx < presets.length) {
                    e.preventDefault();
                    if (this.ipcRenderer) {
                        this.ipcRenderer.send('timer-command', { type: 'set', seconds: presets[idx] });
                    }
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
    /**
     * Полоса сверху, которую колонка героя уступает прижатым к верху карточкам.
     *
     * Дефект (жалоба 18.08.2026). Карточки стоят `position: fixed` в 20px от
     * верхнего края, а подпись «Осталось» с таймером центрируются ПО ОКНУ. Это
     * два независимых способа сказать, где элемент: на высоком окне они
     * расходятся, на низком сходятся в одной точке. Замер на позиции по
     * умолчанию («Текущее время» — сверху по центру): 3440×1440 — зазор 108px,
     * 1600×900 — перекрытие 21px в «Аналоге», 1280×720 — 14/58/15px в «Круге»,
     * «Аналоге» и «Цифрах», 1100×620 — 28/2/81/29px во ВСЕХ четырёх стилях.
     *
     * Готовые раскладки такого не допускают, потому что считают координаты от
     * свободной полосы. Вид по умолчанию не считал ничего — отсюда правка:
     * колонка центрируется не по окну, а по тому, что от окна осталось.
     * Величина уезжает в `--top-band`, а складывает её с отступом CSS
     * (см. `.display-container`) — ровно так же, как `--hero-block` держит
     * место под подпись.
     *
     * Полоса не зависит от того, где колонка оказалась: считается по карточкам,
     * а они `fixed` и от отступа колонки не двигаются. Поэтому пересчёт
     * идемпотентен и не может разогнать сам себя.
     *
     * @returns {number} применённая высота полосы в пикселях
     */
    updateTopBand() {
        // Колонку поставил пользователь — значит она стоит там, где он её
        // поставил, и никаких полос никому не уступает. Обе величины
        // обнуляются явно: иначе последняя посчитанная полоса осталась бы в
        // отступе и сдвигала бы таймер относительно точки, за которую его
        // тащили.
        const hero = this.movableRow('timerBox');
        if (hero && hero.el.classList.contains('custom-position')) {
            this.setTimerShrink(0);
            this.setTopBand(0);
            return 0;
        }

        const shared = window.RendererShared;
        const active = [this.timerRing, this.timerFlip, this.timerAnalog, this.timerDigits]
            .find((b) => b && b.classList.contains('active'));
        if (!shared || !shared.topBandReserve || !active) { return 0; }

        // Замер коробок — на ОСЕВШИХ трансформациях: масштаб карточки живёт в
        // `transform: scale(var(--info-scale))` с переходом в 400 мс, и замер
        // в этом промежутке вернул бы ПРОШЛЫЙ масштаб (тот же разбор, что у
        // раскладки).
        return this.withSettledTransforms(() => {
            const boxes = this.topAnchoredBoxes();
            if (boxes.length === 0) {
                // Мешать некому — и оба ответа заведомо нулевые. Выход здесь не
                // оптимизация, а отказ от двух принудительных пересчётов
                // раскладки в самом частом случае: карточки выключены по
                // умолчанию, а метод зовётся на каждой посылке настроек.
                this.setTimerShrink(0);
                this.setTopBand(0);
                return 0;
            }

            // Ниже плашки состояния колонке нельзя: она прижата к краю окна и
            // не уступает. Зазора здесь НЕТ, в отличие от потолка масштаба:
            // там блок растёт и ему нужен запас, а тут колонка стоит. Каждый
            // отданный плашке пиксель — это пиксель перекрытия, оставшийся
            // наверху, а жалоба была именно про верх.
            // Выключенная плашка не ограничивает ничего: у скрытого элемента
            // прямоугольник нулевой, и её `top` дал бы 0, то есть «ехать некуда».
            const pillRect = this.statusPill ? this.statusPill.getBoundingClientRect() : null;
            const pill = pillRect && pillRect.height > 0 ? pillRect : null;
            const floor = pill ? pill.top : window.innerHeight;

            // --- Шаг 1: уступка рамы, если колонка не помещается ВООБЩЕ ---
            //
            // Меряется при НУЛЕВОЙ уступке, а не «от текущей минус дельта»:
            // высота колонки зависит от рамы, рама — от этого ответа, и
            // считать одно через другое значило бы подать собственный выход
            // себе на вход. Обнулили, заставили пересчитать раскладку,
            // померили натуральную величину — ответ абсолютный и одинаковый
            // при любом числе повторов.
            this.setTimerShrink(0);
            void document.body.offsetWidth;
            const natural = this.heroColumnBox(active);
            const shrink = shared.heroFrameShrink({
                column: natural,
                boxes,
                gap: HERO_GAP,
                floor,
                // Предохранитель на случай стиля, чья высота от рамы не зависит
                // (флип строит высоту из карточек): уступка тогда ничего не
                // исправит, но обязана остаться ограниченной.
                limit: active.offsetHeight * MAX_FRAME_SHRINK_SHARE
            });
            // Пересчёт раскладки форсируем, только если уступка НЕНУЛЕВАЯ:
            // ноль уже применён строкой выше, и второй раз мерить нечего.
            if (this.setTimerShrink(shrink) > 0) { void document.body.offsetWidth; }

            // --- Шаг 2: сдвиг колонки под карточку ---
            //
            // Грани приводятся к НУЛЕВОЙ полосе: применённую вычитаем, потому
            // что знаем её точно — её ставит setTopBand, и сдвиг от неё ровно
            // половина. Это не замер собственного выхода, а замер, приведённый
            // к общей точке отсчёта: повторный вызов даёт то же число.
            const shift = (this._topBand || 0) / 2;
            const column = this.heroColumnBox(active);
            const band = shared.topBandReserve({
                column: { ...column, top: column.top - shift, bottom: column.bottom - shift },
                boxes,
                gap: HERO_GAP,
                floor
            });
            this.setTopBand(band);
            return band;
        });
    }

    /**
     * Прямоугольники карточек, прижатых к ВЕРХУ окна в местах по умолчанию.
     *
     * Сдвинутая мышью карточка сюда не попадает: её положение — выбор
     * пользователя, и таймер не должен ездить за ней прямо во время
     * перетаскивания.
     */
    topAnchoredBoxes() {
        const boxes = [];
        for (const row of (this.movableElements || [])) {
            const el = row.el;
            if (!el || !el.classList.contains('info-block')) { continue; }
            if (!el.classList.contains('visible')) { continue; }
            if (el.classList.contains('custom-position')) { continue; }
            if (!TOP_HOME_POSITIONS.some((cls) => el.classList.contains(cls))) { continue; }
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) { continue; }
            boxes.push({ left: rect.left, right: rect.right, bottom: rect.bottom });
        }
        return boxes;
    }

    /**
     * Габарит колонки героя: таймер И подпись над ним.
     *
     * Шире то один, то другая (у «Цифр» подпись уже блока, у «Круга» на узком
     * окне — наоборот), поэтому берётся объединение. Подпись, вытащенную из
     * потока, колонка уже не содержит.
     */
    heroColumnBox(active) {
        const timerRect = active.getBoundingClientRect();
        let left = timerRect.left;
        let right = timerRect.right;
        let top = timerRect.top;
        const label = this.heroLabel;
        if (label && !label.classList.contains('custom-position')) {
            const labelRect = label.getBoundingClientRect();
            if (labelRect.width > 0) {
                left = Math.min(left, labelRect.left);
                right = Math.max(right, labelRect.right);
                top = Math.min(top, labelRect.top);
            }
        }
        return { left, right, top, bottom: timerRect.bottom };
    }

    /**
     * Единственная запись `--timer-shrink` — уступки рамы героя.
     *
     * @returns {number} применённое значение в пикселях
     */
    setTimerShrink(px) {
        const value = Number.isFinite(px) ? Math.max(0, Math.round(px)) : 0;
        if (value === this._timerShrink) { return value; }
        this._timerShrink = value;
        document.body.style.setProperty('--timer-shrink', value + 'px');
        return value;
    }

    /** Единственная запись `--top-band`: раскладка обнуляет полосу тем же ключом. */
    setTopBand(px) {
        const value = Number.isFinite(px) ? Math.max(0, Math.round(px)) : 0;
        this._topBand = value;
        document.body.style.setProperty('--top-band', value + 'px');
        return value;
    }

    applyTimerScale() {
        // Полоса считается ПЕРВОЙ: она двигает колонку, а потолок масштаба
        // меряется уже по сдвинутой — иначе таймер подгонялся бы под место,
        // которого у него в следующее мгновение не будет.
        this.updateTopBand();
        const requested = this.timerScale || 100;
        // Потолок по свободному месту: `transform` раскладку не двигает, и без
        // него увеличенный блок наезжает на подпись «Осталось» и плашку
        // статуса, а дальше уходит за край окна (замер: 150 % — перекрытие
        // подписи на 148px, 300 % — вылет на 429px). Считается по АКТИВНОМУ
        // блоку: у стилей разные габариты, и общий потолок был бы либо
        // бессмысленно тесным для одних, либо бесполезным для других.
        const effective = this.fitTimerScale(requested);
        const scale = effective / 100;
        const blocks = [this.timerRing, this.timerFlip, this.timerAnalog, this.timerDigits];
        for (const block of blocks) {
            if (!block) { continue; }
            block.style.transform = `scale(${scale})`;
            // Место под прирост РЕЗЕРВИРУЕТСЯ полями: `transform` в раскладке
            // не участвует, поэтому подпись «Осталось» оставалась стоять
            // вплотную к невыросшему габариту и круг наезжал на неё уже на
            // 106 %. С полями подпись отъезжает вверх ровно на столько, на
            // сколько блок вырос, и потолок по свободному месту поднимается
            // (замер на 3440×1320: 106 % → 142 %).
            // Поля симметричны, иначе центр блока поехал бы вниз — а он общий
            // с центром окна и на нём держится вся композиция.
            const grow = Math.max(0, (block.offsetHeight * (scale - 1)) / 2);
            block.style.marginTop = grow ? grow + 'px' : '';
            block.style.marginBottom = grow ? grow + 'px' : '';
        }
        return effective;
    }

    /**
     * ЧТО именно не даёт таймеру расти дальше.
     *
     * Потолок считается по свободной полосе (см. fitTimerScale), а полосу
     * задают подпись сверху и плашка снизу. Молчаливый упор читается как
     * «колесо только уменьшает» — жалоба пользователя 17.08.2026, и он был
     * прав: вверх ничего не происходит, вниз работает. Ответ на жест обязан
     * называть ПРИЧИНУ, иначе это неисправность, а не ограничение.
     *
     * @returns {string} человеческое имя помехи
     */
    timerScaleBlocker() {
        const labelH = this.heroLabel ? this.heroLabel.getBoundingClientRect().height : 0;
        const pillRect = this.statusPill ? this.statusPill.getBoundingClientRect() : null;
        const pill = pillRect && pillRect.height > 0 ? pillRect : null;
        const centerY = window.innerHeight / 2;
        const topSlack = centerY - labelH;
        const bottomSlack = (pill ? pill.top : window.innerHeight) - centerY;
        if (bottomSlack <= topSlack) {
            return pill ? 'мешает плашка состояния' : 'дальше край экрана';
        }
        return labelH > 0 ? 'мешает подпись над таймером' : 'дальше край экрана';
    }

    /**
     * Короткая надпись поверх окна: почему жест ничего не сделал.
     *
     * Живёт ровно столько, сколько нужно прочесть. В презентации на экране не
     * должно оставаться служебных надписей, поэтому она не липнет.
     */
    showScaleNote(text) {
        if (!this.scaleNote) { this.scaleNote = document.getElementById('scaleNote'); }
        if (!this.scaleNote) { return; }
        this.scaleNote.textContent = text;
        this.scaleNote.classList.add('visible');
        if (this._scaleNoteTimer) { clearTimeout(this._scaleNoteTimer); }
        this._scaleNoteTimer = setTimeout(() => {
            this.scaleNote.classList.remove('visible');
            this._scaleNoteTimer = null;
        }, 2200);
    }

    /**
     * Сколько процентов из запрошенных реально помещается.
     *
     * Свободное место — это полоса между подписью над таймером и плашкой
     * статуса, обрезанная краями окна: обе стоят на своих местах и при
     * увеличении блока никуда не двигаются, потому что трансформация в
     * раскладке не участвует. Арифметика — в `RendererShared.fitBlockScale`,
     * чтобы проверяться в Node.
     */
    fitTimerScale(requested) {
        const blocks = [this.timerRing, this.timerFlip, this.timerAnalog, this.timerDigits];
        const active = blocks.find((b) => b && b.classList.contains('active'));
        if (!active || !window.RendererShared || !window.RendererShared.fitBlockScale) { return requested; }

        // Габарит БЕЗ трансформации: offsetWidth/offsetHeight её не видят,
        // а getBoundingClientRect() вернул бы уже увеличенный блок — то есть
        // подал бы собственный выход себе на вход.
        const width = active.offsetWidth;
        const height = active.offsetHeight;
        const rect = active.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Сверху ограничивает не ТЕКУЩЕЕ положение подписи, а место, которое ей
        // нужно: подпись стоит в потоке над блоком и при росте уезжает вверх
        // вместе с полями (см. applyTimerScale). Считать по её нынешнему
        // нижнему краю значило бы мерить собственный выход: чем больше блок,
        // тем выше подпись, тем «теснее» она выглядит.
        const labelH = this.heroLabel ? this.heroLabel.getBoundingClientRect().height : 0;
        // Снизу — плашка статуса: она прижата к краю окна и не уступает.
        // ВЫКЛЮЧЕННАЯ плашка не ограничивает ничего: у скрытого элемента
        // прямоугольник нулевой, и без проверки высоты `pill.top` дал бы 0 —
        // то есть «свободного места нет вовсе», и таймер схлопнулся бы.
        const pillRect = this.statusPill ? this.statusPill.getBoundingClientRect() : null;
        const pill = pillRect && pillRect.height > 0 ? pillRect : null;

        return window.RendererShared.fitBlockScale({
            width, height, centerX, centerY,
            free: {
                left: 0,
                right: window.innerWidth,
                top: labelH + HERO_GAP,
                bottom: pill ? pill.top - HERO_GAP : window.innerHeight
            },
            requested
        });
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
        // Подпись над таймером. Её нижний край — верхняя граница свободного
        // места для блока таймера (см. fitTimerScale). Раньше её доставали
        // getElementById прямо в updateChipState — единственном месте, где она
        // была нужна.
        this.heroLabel = document.getElementById('heroLabel');
        // Текст подписи живёт в отдельном span: в самом блоке ещё крестик.
        this.heroLabelText = document.getElementById('heroLabelText');
        this.timerRing = document.getElementById('timerRing');
        this.currentTimeBlock = document.getElementById('currentTimeBlock');
        this.eventTimeBlock = document.getElementById('eventTimeBlock');
        this.endTimeBlock = document.getElementById('endTimeBlock');
        this.currentTimeEl = document.getElementById('currentTime');
        this.eventTimeEl = document.getElementById('eventTime');
        this.endTimeEl = document.getElementById('endTime');
        this.closeBtn = document.getElementById('closeBtn');

        // Элементы для разных стилей
        this.timerFlip = document.getElementById('timerFlip');

        // Блоки, добавленные 17.08.2026: «До завершения» и название мероприятия.
        this.timeLeftBlock = document.getElementById('timeLeftBlock');
        this.overrunCostBlock = document.getElementById('overrunCostBlock');
        this.overrunCostValueEl = document.getElementById('overrunCostValue');
        this.totalCostBlock = document.getElementById('totalCostBlock');
        this.totalCostValueEl = document.getElementById('totalCostValue');
        this.timeLeftValueEl = document.getElementById('timeLeftValue');
        this.eventTitleBlock = document.getElementById('eventTitleBlock');
        this.eventTitleValueEl = document.getElementById('eventTitleValue');

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

        // Стиль «Цифры»
        this.timerDigits = document.getElementById('timerDigits');
        this.digitsTime = document.getElementById('digitsTime');
        this.digitsSign = document.getElementById('digitsSign');
        this.digitsValue = document.getElementById('digitsValue');
        this.digitsProbe = document.getElementById('digitsProbe');
        this.digitsFont = window.DigitsStyle.DEFAULT_FONT_ID;
        this._digitsFontsReady = false;

        // Замер эталона до загрузки woff2 меряет ЗАПАСНОЕ начертание и кэширует
        // чужие цифры: у всех шрифтов проекта font-display: swap.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                this._digitsFontsReady = true;
                window.DigitsStyle.clearProbeCache();
                this.updateDigitsScale();
                // Шрифт меняет ширину не только таймера, но и КАРТОЧЕК: в
                // стиле «Цифры» значение блока набрано тем же шрифтом. А место
                // карточки хранится долей окна для центра, и изменившийся
                // габарит уводит центр, если её не переставить.
                this.reflowSoon();
            });
        } else {
            this._digitsFontsReady = true;
        }
    }

    initProgress() {
        this.displayProgressFill = document.getElementById('displayProgressFill');
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

            // «До завершения» — расстояние от системных часов до времени
            // «Конец». С таймером доклада не связано: тот считает заданную
            // длительность, а это — сколько идти до конца мероприятия.
            if (this.timeLeftValueEl) {
                const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
                const left = window.RendererShared.secondsUntilClock(nowSeconds, this.endTime);
                // formatTime всегда даёт HH:MM:SS — «02:04:21» с фотографии.
                this.timeLeftValueEl.textContent = window.TimeUtils.formatTime(left);
                // Стрелки мини-циферблата этого блока крутит ДЛИТЕЛЬНОСТЬ, а не
                // момент: час за 12 часов остатка, минута за 60 минут — та же
                // арифметика, что у большого циферблата стиля «Аналог»
                // (updateAnalogDisplay). Разложение на части делается здесь, а
                // не второй формулой в updateMiniClockHands: у той на входе
                // часы/минуты/секунды, и для длительности они значат ровно то
                // же самое.
                this.updateMiniClockHands(
                    this.timeLeftBlock,
                    Math.floor(left / 3600),
                    Math.floor(left / 60) % 60,
                    left % 60
                );
            }
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
            this.updateMoneyBlocks();
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

        // Готовая раскладка. Приходит ПОСЛЕ настроек с тумблерами (панель шлёт
        // их первыми): раскладка меряет живые габариты элементов, а у
        // выключенного элемента прямоугольник нулевой — разложить его было бы
        // не по чему.
        this.ipcHandlers.displayLayout = (event, payload) => {
            if (!payload || typeof payload.layout !== 'string') { return; }
            this.applyLayout(payload.layout);
        };

        // Регистрируем обработчики
        this.ipcRenderer.on('timer-state', this.ipcHandlers.timerState);
        this.ipcRenderer.on('display-colors-update', this.ipcHandlers.colorsUpdate);
        this.ipcRenderer.on('display-settings-update', this.ipcHandlers.displaySettingsUpdate);
        this.ipcRenderer.on('display-layout', this.ipcHandlers.displayLayout);

        // Накопитель перелимита мероприятия. Секунды, а не рубли: ставку знает
        // это окно, и поправленная посреди мероприятия она обязана пересчитать
        // уже накопленное.
        this.ipcHandlers.eventOverrunState = (event, payload) => {
            if (!payload || typeof payload !== 'object') { return; }
            this.eventOverrunSeconds = Number(payload.overrunSeconds) || 0;
            this.eventFinished = !!payload.finished;
            this.updateMoneyBlocks();
        };
        this.ipcRenderer.on('event-overrun-state', this.ipcHandlers.eventOverrunState);

        // Пресет вернул в профиль другие места и масштабы карточек. Окно
        // перечитывает их ТЕМ ЖЕ путём, что и при открытии: два восстановления
        // — это две копии знания о том, что такое «место карточки».
        this.ipcHandlers.displayRestoreState = () => {
            this.restoreElementScales();
            this.restoreBlockPositions();
            this.reflowSoon();
        };
        this.ipcRenderer.on('display-restore-state', this.ipcHandlers.displayRestoreState);
        // Замок приходит тем же способом, что и тема: панель шлёт, главный
        // процесс рассылает всем окнам.
        if (window.UILock) { window.UILock.bindLockSync(this.ipcRenderer); }
    }

    /**
     * Две денежные величины скрытого режима «47-й этаж».
     *
     * Обе — чистая функция от накопителя, состояния таймера и ставки; ничего
     * своего окно не хранит и на диск не пишет. Накопитель держит главный
     * процесс, потому что это единственная величина, которую нельзя
     * пересчитать заново.
     *
     * «Перелимит» прячется, пока таймер в плюсе, ДАЖЕ при включённом тумблере:
     * висящий весь доклад ноль мозолит глаз и обесценивает момент, когда сумма
     * пойдёт. «Итого» показывается всегда, когда включён его тумблер, — он для
     * того и нужен, чтобы видеть накопленное.
     */
    updateMoneyBlocks() {
        const Money = window.MoneyMeter;
        if (!Money) { return; }
        const live = Money.overrunSeconds(this.remainingSeconds);
        const price = this.overrunPrice;
        const period = this.overrunPeriod;

        if (this.overrunCostValueEl) {
            this.overrunCostValueEl.textContent = Money.formatMoney(Money.overrunCost(live, price, period));
        }
        if (this.totalCostValueEl) {
            this.totalCostValueEl.textContent = Money.formatMoney(
                Money.totalCost(this.eventOverrunSeconds, this.remainingSeconds, price, period)
            );
        }

        const unlocked = this.floor47Unlocked === true;
        if (this.overrunCostBlock) {
            this.overrunCostBlock.classList.toggle('visible',
                unlocked && this.showOverrunCost === true && live > 0);
        }
        if (this.totalCostBlock) {
            this.totalCostBlock.classList.toggle('visible',
                unlocked && this.showTotalCost === true);
        }
    }

    applyDisplaySettings(settings) {
        // Стиль таймера — только свой. Общее имя `timerStyle` в этом наборе
        // может означать стиль ВИДЖЕТА (когда набор пришёл из localStorage),
        // см. RendererShared.pickOwnSetting.
        const style = window.RendererShared.pickOwnSetting(settings, 'displayTimerStyle', 'timerStyle');
        if (style) {
            this.setTimerStyle(style);
        }

        // Шрифт стиля «Цифры». Имя СВОЁ: общее имя в этом проекте уже означало
        // разные окна в разных наборах и стоило отдельного бага.
        //
        // Своего ключа в localStorage у настройки НЕТ (в отличие от
        // displayTimerScale): у масштаба есть локальный источник изменений —
        // Ctrl+колесо прямо на дисплее, и его обязательно персистить самому
        // окну. У шрифта локального источника нет вообще, его выставляет
        // только панель — значит и хранит его только она, полем внутри
        // displayExtSettings, тем же путём, что и displayTimerStyle. Здесь
        // шрифт только ПРИМЕНЯЕТСЯ, ничего никуда не пишет.
        if (settings.displayDigitsFont !== undefined) {
            const font = window.DigitsStyle.applyFont(this.digitsTime, settings.displayDigitsFont);
            // Тот же шрифт — и блокам времени: в стиле «Цифры» блок обязан
            // повторять сам стиль, а не оставаться набранным интерфейсным sans.
            //
            // ПЕРЕМЕННЫЕ, а не inline на каждом .info-value: инлайн сильнее
            // любого правила и остался бы на блоках после переключения стиля,
            // то есть «Цифры» красили бы блоки круга и аналога. Правило
            // `body.style-digits .info-value` читает эти переменные, поэтому
            // выбор шрифта действует ровно там, где выбран стиль.
            const root = document.documentElement.style;
            root.setProperty('--digits-font-family', font.family);
            root.setProperty('--digits-font-weight', String(font.weight));
            if (font.id !== this.digitsFont) {
                this.digitsFont = font.id;
                this.updateDigitsScale();
                // И ещё раз, когда доедет woff2: первый замер после
                // переключения снимается с ЗАПАСНОГО начертания —
                // `document.fonts.ready` разрешился на старте и об этом шрифте
                // ничего не знал (см. isFontLoaded в digits-style.js).
                window.DigitsStyle.ensureFont(font.id).then(() => {
                    window.DigitsStyle.clearProbeCache();
                    this.updateDigitsScale();
                    // Тот же довод, что и у document.fonts.ready: приехавший
                    // woff2 меняет ширину карточек, а место у них — доля
                    // окна для центра.
                    this.reflowSoon();
                });
            }
        }

        // Блоки: у каждого свой тумблер. Общий `showTimeBlocks` и выбор пресета
        // расположения убраны 17.08.2026 — перевод старых профилей делает
        // RendererShared.migrateDisplayBlocks в панели, а расположение задаётся
        // перетаскиванием (Alt) и живёт в displayBlockPositions.
        //
        // Место по умолчанию — прежняя «рамка»: она применяется ОДИН раз, на
        // первой раскладке, и только к блоку, которого пользователь ещё не
        // двигал. Раньше эти позиции переставлялись при смене пресета и тогда же
        // стиралось сохранённое расположение; менять положение блока теперь
        // некому, кроме самого пользователя.
        const migrated = window.RendererShared.migrateDisplayBlocks(settings);
        const firstLoad = this._blocksLaidOut !== true;
        this._blocksLaidOut = true;
        const hasCustomPositions = (block) => block && block.classList.contains('custom-position');

        const BLOCKS = [
            { el: this.currentTimeBlock, key: 'showCurrentTime', home: 'top-center' },
            { el: this.eventTimeBlock, key: 'showEventTime', home: 'bottom-left' },
            { el: this.endTimeBlock, key: 'showEndTime', home: 'bottom-right' },
            { el: this.timeLeftBlock, key: 'showTimeLeft', home: 'top-left' },
            // Название НЕ ставится по центру снизу, хотя на образце у
            // пользователя оно там: там же стоит плашка состояния, и на замере
            // они наложились друг на друга. Пять блоков — пять разных углов;
            // передвинуть в центр можно перетаскиванием, и это уже выбор
            // пользователя, а вид по умолчанию не должен выглядеть сломанным.
            { el: this.eventTitleBlock, key: 'showEventTitle', home: 'top-right' }
        ];
        for (const block of BLOCKS) {
            if (!block.el) { continue; }
            if (migrated[block.key] !== undefined) {
                block.el.classList.toggle('visible', migrated[block.key] === true);
            }
            if (firstLoad && !hasCustomPositions(block.el)) {
                this.applyPosition(block.el, block.home);
            }
        }

        // Кастомные подписи блоков времени (24.08.2026). Слова по умолчанию
        // здесь НЕ пишутся: их знает реестр (DisplayLayouts.blockCaption), он
        // же обрезает длину и схлопывает пробелы. Только textContent —
        // разметка из настроек в окно не попадает.
        //
        // Перерисовка не безусловна: подпись задаёт ШИРИНУ карточки, а по
        // ширине считаются места элементов и полоса сверху. Пересчитывать их на
        // каждой посылке настроек (а она приходит на любое движение ползунка
        // цвета) значило бы гонять раскладку впустую.
        let captionChanged = false;
        for (const row of window.DisplayLayouts.LABELLED_ELEMENTS) {
            const movable = this.movableRow(row.id);
            const node = movable && movable.el.querySelector('.info-label');
            if (!node) { continue; }
            const next = window.DisplayLayouts.blockCaption(row.id, settings[row.labelKey]);
            if (node.textContent === next) { continue; }
            node.textContent = next;
            captionChanged = true;
        }
        if (captionChanged) {
            this.reflowSoon();
            this.updateTopBand();
        }

        // Скрытый режим «47-й этаж»: ставка и разблокировка.
        //
        // Видимость денежных блоков считает ОДНО место (updateMoneyBlocks), и
        // в списке BLOCKS выше их намеренно нет: у «Перелимита» условие показа
        // не сводится к тумблеру — он прячется, пока таймер в плюсе.
        this.floor47Unlocked = settings.floor47Unlocked === true;
        this.showOverrunCost = settings.showOverrunCost === true;
        this.showTotalCost = settings.showTotalCost === true;
        if (settings.overrunPrice !== undefined) { this.overrunPrice = settings.overrunPrice; }
        if (settings.overrunPeriod !== undefined) { this.overrunPeriod = settings.overrunPeriod; }
        this.updateMoneyBlocks();

        // Название мероприятия — единственное значение блока, которое вводит
        // пользователь. Только textContent: разметка из настроек в окно не
        // попадает, и экранировать нечего.
        if (settings.eventTitle !== undefined && this.eventTitleValueEl) {
            this.eventTitleValueEl.textContent = String(settings.eventTitle);
        }

        // Подпись над таймером и плашка состояния — по тумблеру на каждую.
        // Скрывают всегда, а не только в перерасходе: элемент, который то есть,
        // то нет, читается как сбой окна, а не как настройка.
        // Класс на <body>, а не на самих элементах: подпись мало убрать — вместе
        // с ней обязан уйти и нижний отступ колонки, которым её высота
        // компенсируется (иначе таймер уедет вверх на половину подписи). Такое
        // «одно состояние — два правила» и есть работа каскада.
        if (settings.showHeroLabel !== undefined) {
            document.body.classList.toggle('no-hero-label', settings.showHeroLabel === false);
        }
        if (settings.showStatusPill !== undefined) {
            document.body.classList.toggle('no-status-pill', settings.showStatusPill === false);
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
        // Всегда применяем текущий масштаб. Если он не поместился, ползунок
        // панели обязан узнать РЕАЛЬНОЕ значение: два источника правды здесь
        // уже расходились (см. комментарий выше), и молча показывать 300 % при
        // видимых 130 % — тот же дефект с другой стороны.
        const effectiveScale = this.applyTimerScale();
        if (Number.isFinite(effectiveScale) && effectiveScale !== this.timerScale) {
            this.timerScale = effectiveScale;
            this._safeSetItem('displayTimerScale', String(effectiveScale));
            this._lastPushedTimerScale = effectiveScale;
            if (this.ipcRenderer) {
                this.ipcRenderer.send('report-scale', { source: 'display', scalePct: effectiveScale });
            }
        }

        // Показ цифр на аналоговом циферблате
        if (settings.showAnalogNumbers !== undefined && this.clockNumbers) {
            this.clockNumbers.classList.toggle('visible', settings.showAnalogNumbers);
        }

        // Масштаб блоков времени — та же логика «применяем только при реальном
        // изменении», что и для timerScale выше (см. комментарий там).
        if (settings.timeBlocksScale !== undefined) {
            const incoming = parseInt(settings.timeBlocksScale, 10);
            if (Number.isFinite(incoming) && incoming !== this._lastPushedBlockScale) {
                // ПЕРВАЯ посылка после открытия окна не применяется вовсе:
                // масштабы уже восстановлены из хранилища, и каждый свой. Одно
                // число ползунка перебило бы все пять — замер до правки:
                // раскладка «Сводка» ставила карточкам 110 %, а хидрейт при
                // следующем открытии окна возвращал им 100 % и СОХРАНЯЛ это,
                // так что позиции переставали совпадать с сохранёнными на 10px.
                // Та же логика уже стоит у масштаба таймера выше.
                if (this._lastPushedBlockScale !== undefined) {
                    this._safeSetItem('displayBlockScale', String(incoming));
                    // Ползунок панели — команда «поставить ВСЕМ карточкам
                    // сразу», а не зеркало: масштабов семь, по одному на
                    // элемент, и одним числом их не отобразить. Свой масштаб
                    // элемента задаётся на дисплее (Ctrl+колесо над ним) и
                    // панели не сообщается — иначе ползунок дёргался бы от
                    // каждого элемента.
                    for (const row of (this.movableElements || [])) {
                        if (row.kind !== 'block') { continue; }
                        this.applyElementScale(row.id, incoming);
                    }
                    this.saveElementScales();
                }
                this._lastPushedBlockScale = incoming;
            }
        }

        // Пересчёт мест — ПОСЛЕДНИМ шагом набора, а не внутри отдельных его
        // частей. Всё выше меняет ГАБАРИТ карточек: стиль (у аналога карточка
        // с циферблатом на 20px выше, у флипа пластина шире), шрифт «Цифр»
        // (значение блока набрано им же), масштаб. Место хранится долей окна
        // для ЦЕНТРА, поэтому изменившийся габарит обязан переставить
        // карточку, иначе она растёт из своего левого верхнего угла и уносит
        // центр — это и есть «раскладки съезжают при перещёлкивании стилей».
        //
        // Почему именно здесь, а не в setTimerStyle: в этом наборе стиль
        // применяется РАНЬШЕ шрифта, и пересчёт, сделанный внутри смены стиля,
        // мерил бы карточки, которым шрифт ещё не поставили (замер: название
        // мероприятия 634 → 617px уже ПОСЛЕ пересчёта, доля центра 0.500 →
        // 0.503). В setTimerStyle вызов тоже остался — он покрывает прямые
        // смены стиля, а повторный пересчёт идемпотентен.
        this.reflowElements();
    }

    setTimerStyle(style) {
        this.timerStyle = style;

        // F-023: Инвалидируем кэши DOM-узлов на случай, если смена стиля пересоздаёт элементы
        this._cachedFlipDigits = null;
        this._cachedFlipSeparators = null;

        // Удаляем все классы стилей с body
        document.body.classList.remove('style-circle', 'style-flip', 'style-analog', 'style-digits');

        // Скрываем все стили таймера
        if (this.timerRing) {this.timerRing.classList.remove('active');}
        if (this.timerFlip) {this.timerFlip.classList.remove('active');}
        if (this.timerAnalog) {this.timerAnalog.classList.remove('active');}
        if (this.timerDigits) {this.timerDigits.classList.remove('active');}

        // Показываем выбранный и добавляем класс на body
        switch (style) {
            case 'circle':
                if (this.timerRing) {this.timerRing.classList.add('active');}
                document.body.classList.add('style-circle');
                break;
            case 'flip':
                if (this.timerFlip) {this.timerFlip.classList.add('active');}
                document.body.classList.add('style-flip');
                break;
            case 'analog':
                if (this.timerAnalog) {this.timerAnalog.classList.add('active');}
                document.body.classList.add('style-analog');
                break;
            case 'digits':
                if (this.timerDigits) {this.timerDigits.classList.add('active');}
                document.body.classList.add('style-digits');
                // Пока стиль неактивен, #timerDigits лежит в display:none и
                // getBoundingClientRect() отдаёт 0×0 — обе точки, которые сами
                // зовут updateDigitsScale() (document.fonts.ready и смена
                // формата ЧЧ в updateDigitsDisplay), почти всегда срабатывают
                // ДО того, как пользователь включит этот стиль, и замер
                // проходит вхолостую. Пересчитываем явно ЗДЕСЬ, когда блок уже
                // получил .active и есть реальные размеры.
                this.updateDigitsScale();
                break;
        }

        // Обновляем отображение
        this.updateDisplay();

        // Смена стиля меняет РАЗМЕР карточек, а место у них хранится долей
        // окна для ЦЕНТРА. Без пересчёта карточка остаётся стоять прежним
        // ЛЕВЫМ ВЕРХНИМ углом и растёт (или сжимается) из него — то есть её
        // центр уезжает, и разложенная композиция расползается.
        //
        // Замер 19.08.2026 («при перещёлкивании стилей раскладки съезжают»),
        // раскладка «Совещание» на 3440×1440: «Текущее время» 245×121 в круге,
        // 262×136 во флипе и 190×144 в аналоге; доля центра 0.783/0.120 →
        // 0.785/0.124 → 0.776/0.127. По вертикали у аналога уезжало на 0.007
        // высоты окна, и в ряду из четырёх карточек это видно сразу.
        //
        // reflowElements переставляет по ТОЙ ЖЕ доле, что и ресайз окна:
        // отдельной арифметики здесь нет и быть не должно.
        this.reflowElements();
        this.reflowSoon();
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

        /**
         * Переменная либо СТАВИТСЯ, либо УДАЛЯЕТСЯ.
         *
         * Односторонняя запись («поставить, если цвет пришёл») делает цвет
         * несбрасываемым: «Сбросить всё» шлёт объект без полей, окно ничего не
         * применяет — и продолжает краситься прошлым значением, потому что
         * инлайновая переменная на documentElement пережила пустой payload.
         * Замер 20.08.2026: после сброса дисплей оставался неоновым
         * (`--timer-color: #39ff14`), тогда как виджет и часы возвращались к
         * заводскому виду — у них этот приём уже был.
         *
         * Удаление возвращает значение по умолчанию его владельцу — CSS.
         */
        const root = document.documentElement.style;
        const setVar = (name, value) => {
            if (value) { root.setProperty(name, value); }
            else { root.removeProperty(name); }
        };

        // Circle style — стопы градиента красит КАСКАД: правило
        // `#mainGradient stop` в display.css сильнее презентационного атрибута.
        // Раньше здесь стоял setAttribute, и снять поставленный им цвет было
        // нечем: атрибут — не инлайновый стиль, removeProperty его не видит.
        // Тот же приём и теми же именами переменных уже работает в виджете и в
        // часах: одна механика окраски кольца на три окна.
        //
        // Свечения здесь больше нет. `--text-glow` и `--glow-color` писались
        // на каждый приход цвета и не читались НИ ОДНИМ правилом: редизайн
        // 12.08.2026 снял внешние ореолы (инвариант держит
        // tests/flat-surfaces.test.js), а записи пережили своих читателей.
        // Мёртвая переменная опаснее отсутствующей: она выглядит как рабочий
        // механизм, и следующая правка цвета честно тащит её за собой.
        setVar('--timer-color-stop', timerColor);
        setVar('--progress-color-stop', progressColor);

        // Цвет темы для цифр КРУГА, «Цифр» и ФЛИПА — одна переменная.
        //
        // Раньше каждый из этих стилей красился инлайном, и каждому нужен был
        // охранник «не трогать, если сейчас danger/warning»: инлайн бьёт
        // правило полосы, поэтому применить цвет темы поверх полосы означало
        // её стереть. С переменной охранники не нужны — правило .danger
        // сильнее по специфичности и выигрывает само, в каком бы порядке ни
        // пришли обновление цвета и обновление полосы.
        setVar('--timer-color', timerColor);

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
        // --tw-fg-muted для флипа). Замер по восьми темам: 4.55–6.63:1.
        // Иерархию несут размер, насыщенность и капитель, а не понижение контраста
        // ниже порога читаемости. Побочная выгода: подпись остаётся читаемой при
        // ЛЮБОМ пользовательском цвете из палитры, а не только у восьми встроенных.
        setVar('--info-color', timerColor);
        setVar('--info-color-dim', null);

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
        //
        // `--analog-hand-bg`, `--analog-hand-shadow`, `--analog-center-shadow` и
        // `--info-glow` отсюда убраны: их не читало НИ ОДНО правило ни в
        // display.css, ни в display.html — тени ушли вместе с ореолами в
        // редизайне 12.08.2026, а записи остались. См. абзац про мёртвые
        // переменные выше.
        setVar('--analog-center-bg', timerColor
            ? `linear-gradient(145deg, ${timerColor}, ${progressColor || timerColor})`
            : null);
        // Было b3 (0.7): выбор темы приглушал отсчёт ВТОРОЙ раз поверх
        // токена, который и так вторичен.
        setVar('--analog-digital-color', timerColor ? `${timerColor}e6` : null);

        // Охранника «применять цвет темы, только если НЕ идёт перерасход» здесь
        // больше нет, и он больше не нужен. Он существовал потому, что цвет
        // писался инлайном и затирал красный перерасхода; теперь тема — это
        // переменные, а полосу держат классы .danger/.warning, которые сильнее
        // по специфичности. Порядок прихода событий перестал иметь значение.
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

        // Последний применённый набор нужен на смену темы: в режиме «По теме»
        // фон обязан перекраситься, а перекрашивать нечем, если настройки
        // приходили один раз при открытии окна.
        this._bgSettings = settings;

        // Страж яркости: цвет текста решает ФОН, а не тема. Режим передаётся уже
        // РАЗРЕШЁННЫЙ: первая версия отдавала сырой settings.bgMode, и на
        // профиле без сохранённого фона страж видел undefined, откатывался к
        // теме и красил светлым по тёмному градиенту — ровно тот провал,
        // который он и обязан предотвращать. Поймал это снимок окраски.
        this.applyBackgroundTone(settings, mode);

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
        } else if (mode === 'theme') {
            // «По теме» — умолчание чистого профиля. До 18.08.2026 умолчанием
            // была тёмная ЗАЛИВКА, то есть фон дисплея не зависел от темы
            // вовсе: светлая тема на дисплее существовала, но добраться до неё
            // можно было только выбрав светлую заливку руками.
            //
            // Это по-прежнему НАСТРОЙКА, а не магия: выбравший заливку получит
            // заливку. Цвета зашиты здесь, а не приходят полями, ровно
            // поэтому: у режима нет пользовательских значений, которые можно
            // было бы забыть сохранить.
            document.body.classList.remove('custom-bg');
            bg = this._themeIsLight()
                ? 'linear-gradient(135deg, #ffffff 0%, #ececf3 100%)'
                : 'linear-gradient(135deg, #0f0c29 0%, #302b63 100%)';
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

    /**
     * Ставит класс .on-light-bg по яркости фактического фона.
     *
     * Тема сюда попадает только как выбор фона ПО УМОЛЧАНИЮ: если своего фона
     * нет, светлая тема даёт белый холст, тёмная — тёмный градиент. Решение о
     * цвете текста принимает владелец фона, и владелец тут один.
     */
    applyBackgroundTone(settings, mode) {
        const tone = window.RendererShared.backgroundTone({
            mode: mode || settings.bgMode,
            solid: settings.bgSolid,
            grad1: settings.bgGrad1,
            grad2: settings.bgGrad2,
            theme: document.documentElement.getAttribute('data-theme')
        });
        // Класс вешается на <html>, а не на <body>, и это не стиль, а
        // необходимость: токены вроде `--tw-led-green: var(--tw-green)`
        // объявлены в design-tokens.css на :root и вычисляются ТАМ ЖЕ. Палитра
        // на <body> переопределяла --tw-green уже после того, как
        // --tw-led-green вычислился из html-овского значения, и LED-зелёный
        // оставался светлым на тёмном фоне. Поймал это снимок окраски.
        window.UITheme.applyTone(tone);
    }

    /** Тема окна как булево — единственное место, где читается атрибут. */
    _themeIsLight() {
        return document.documentElement.getAttribute('data-theme') === 'light';
    }

    /**
     * Смена темы в панели. Тема выбирает фон ПО УМОЛЧАНИЮ, а фон решает цвет
     * текста — значит перекрасить надо и то и другое, и именно в этом порядке.
     * Без этого переключатель темы менял атрибут и ни одного пикселя дисплея.
     */
    onThemeChanged() {
        // Запасной набор — именно `{ bgMode: 'theme' }`, а не пустой объект:
        // пустой разрешается в 'gradient' с тёмными умолчаниями, то есть смена
        // темы ДО прихода настроек залила бы окно тёмным вопреки самой теме.
        this.applyBackground(this._bgSettings || { bgMode: 'theme' });
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
            // Здесь стоял вызов _enforceOvertimeColors(secs) — перекраска
            // «на всякий случай» на КАЖДОМ тике. Она была нужна лишь потому,
            // что applyColors писала цвет инлайном и стирала красный
            // перерасхода. Инлайна больше нет: цвет темы приходит переменной
            // --timer-color, а полосу держат классы .danger/.warning. Стирать
            // друг друга им нечем, и восстанавливать нечего.
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

        // Обновляем стиль «Цифры»
        this.updateDigitsDisplay(secs);

        // Полоса срочности стиля «Цифры». Не через _colorBand() кэшированный
        // где-то ещё — считается здесь же, потому что danger/warning должны
        // покраситься на каждое реальное изменение секунд, а не только когда
        // сменился формат ЧЧ (то, чем гейтится updateDigitsDisplay выше).
        if (this.digitsTime) {
            // Снимаем классы на каждый реальный тик — как в
            // updateFlipDisplay. Без remove() здесь danger/overtime, добавленные
            // _enforceOvertimeColors(), никогда не снимались бы: сейчас это
            // безвредно (ни одно правило CSS на .digits-time не завязано на эти
            // классы), но остаётся ловушкой для того, кто такое правило добавит.
            this.digitsTime.classList.remove('warning', 'danger', 'overtime');
            const band = this._colorBand(secs);
            if (band === 'overtime') {
                this.digitsTime.classList.add('danger', 'overtime');
            } else if (band === 'danger') {
                this.digitsTime.classList.add('danger');
            } else if (band === 'warning') {
                this.digitsTime.classList.add('warning');
            }
        }

        // Прогресс обновляется только если процент изменился
        const progress = this.calculateProgressValue();
        if (this.cache.lastProgress !== progress) {
            this.updateProgress();
            this.cache.lastProgress = progress;
        }


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

    // Полоса срочности — общая для всех окон (RendererShared.timerColorBand).
    //
    // Здесь же жили _normalColor() / _normalGlow() — помощники «к чему
    // возвращаться после полосы». Они были правильным решением НЕВЕРНОЙ задачи:
    // возвращаться приходилось потому, что цвет полосы писался инлайном и бил
    // CSS. С 11.08.2026 цвет темы приходит переменной --timer-color, полосу
    // держат классы .warning/.danger, и восстанавливать нечего — вместе с
    // помощниками ушли поля _baseTimerColor / _baseTimerGlow /
    // _baseSecondHandBg / _baseSecondHandShadow / _baseCenterBg /
    // _baseCenterShadow / _baseAnalogDigitalColor и вся функция
    // _enforceOvertimeColors(), которая перекрашивала DOM на каждом тике.
    _colorBand(secs) {
        return window.RendererShared.timerColorBand(secs, this.totalSeconds);
    }

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
        // Разделители ведут полосу тем же классом, что и карточки. Раньше их
        // красил инлайн, и правил CSS для них не существовало вовсе — то есть
        // состояние было выражено только в JS и теме не подчинялось.
        flipSeparators.forEach(el => el.classList.remove('warning', 'danger', 'overtime'));

        if (band === 'overtime') {
            flipCards.forEach(card => card.classList.add('danger', 'overtime'));
            flipSeparators.forEach(el => el.classList.add('danger', 'overtime'));
        } else if (band === 'danger') {
            flipCards.forEach(card => card.classList.add('danger'));
            flipSeparators.forEach(el => el.classList.add('danger'));
        } else if (band === 'warning') {
            flipCards.forEach(card => card.classList.add('warning'));
            flipSeparators.forEach(el => el.classList.add('warning'));
        }
        // Цифры и разделители цвет инлайном не получают: полосу задают правила
        // `.flip-card.warning/.danger .flip-digit`, цвет темы — переменная
        // --timer-color в базовом правиле. Раньше здесь считался digitColor,
        // который приходилось выбирать между темой и полосой вручную.
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
            }
            // Инлайновые красные стили стрелки и центра больше не ставятся:
            // их задают правила `.hand-second.danger` / `.clock-center.danger`.
            // Раньше их приходилось ставить и снимать вручную, и ветка снятия
            // была отдельным источником залипшего красного.
        } else {
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

    /**
     * Пересчитать кегль цифр под текущее окно.
     *
     * По эталону, а не по живому тексту: иначе цифры «дышат» каждую секунду
     * на шрифтах с непостоянной шириной знака. Запас 0.9 по обеим осям —
     * поля вокруг, как у остальных стилей окна.
     */
    updateDigitsScale() {
        if (!this.timerDigits || !this.digitsTime || !this._digitsFontsReady) { return; }

        const hasHours = Math.abs(Math.floor(this.remainingSeconds)) >= 3600;
        // measureDigits() принимает ЯВНУЮ эталонную строку, не булев hasHours —
        // выбор строки остаётся здесь, у потребителя.
        const probeText = hasHours ? window.DigitsStyle.PROBE_HOURS : window.DigitsStyle.PROBE_MINUTES;
        const probe = window.DigitsStyle.measureDigits(this.digitsProbe, this.digitsFont, probeText);
        if (!probe) { return; }

        const box = this.timerDigits.getBoundingClientRect();
        const size = window.DigitsStyle.fitFontSize({
            availableWidth: box.width * 0.9,
            availableHeight: box.height * 0.9,
            probeWidth: probe.width,
            probeHeight: probe.height,
            signWidth: probe.signWidth
        });
        if (size > 0) { this.digitsTime.style.setProperty('--digits-font-size', size + 'px'); }
        // Вертикаль знака минуса — своя у каждого шрифта (см. measureSignShift):
        // центрируется бокс, а видно чернила.
        this.digitsTime.style.setProperty(
            '--digits-sign-shift',
            window.DigitsStyle.measureSignShift(this.digitsFont)
        );
    }

    /**
     * Обновить текст стиля «Цифры».
     *
     * Знак и цифры — РАЗНЫЕ узлы: знак вынесен из потока, иначе центрируется
     * надпись целиком и цифры уезжают с оси кольца.
     */
    updateDigitsDisplay(secs) {
        if (!this.digitsValue) { return; }
        const wasHours = this._digitsHadHours;
        const hasHours = Math.abs(secs) >= 3600;

        this.digitsSign.textContent = secs < 0 ? '−' : '';
        this.digitsValue.textContent = this.formatTime(Math.abs(secs));

        // Кегль пересчитываем только когда сменился ФОРМАТ, а не каждый тик.
        if (wasHours !== hasHours) {
            this._digitsHadHours = hasHours;
            this.updateDigitsScale();
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

            // Полоса по нижнему краю показывает ПРОЙДЕННОЕ, а кольцо —
            // оставшееся: у полосы нет начала отсчёта по кругу, и «пустая
            // слева» читается как «ещё не начали». Источник у обеих один —
            // calculateProgressValue(), второго счёта времени тут нет.
            if (this.displayProgressFill) {
                this.displayProgressFill.style.width = ((1 - ratio) * 100) + '%';
            }

            // Цветовые предупреждения
            const band = this._colorBand(Math.floor(this.remainingSeconds));

            // Полосу красит КЛАСС на <body>, а не инлайн: цвет в этом проекте
            // принадлежит каскаду. Полоса лежит вне всех пяти контейнеров
            // стилей, поэтому и класс общий, на body.
            document.body.classList.toggle('overtime', band === 'overtime');
            document.body.classList.toggle('warning', band === 'warning');
            document.body.classList.toggle('danger', band === 'danger');

            this.progressRing.classList.remove('warning', 'danger', 'overtime');
            this.timeDisplay.classList.remove('warning', 'danger', 'overtime');

            // Комментарий «CSS class alone may be insufficient» описывал
            // следствие, а не причину: класса не хватало ровно потому, что
            // applyColors писала цвет темы ИНЛАЙНОМ и била его. Теперь тема
            // приходит переменной, и класса достаточно.
            if (band === 'overtime') {
                this.progressRing.classList.add('danger', 'overtime');
                this.timeDisplay.classList.add('danger', 'overtime');
            } else if (band === 'danger') {
                this.progressRing.classList.add('danger');
                this.timeDisplay.classList.add('danger');
            } else if (band === 'warning') {
                this.progressRing.classList.add('warning');
                this.timeDisplay.classList.add('warning');
            }
        } else {
            this.progressRing.style.strokeDashoffset = this.circumference;
            // Без пресета (totalSeconds === 0) полос danger/warning быть не может,
            // но раньше эта ветка не снимала ни классы, ни инлайновый цвет — после
            // перерасхода круглый стиль оставался красным.
            this.progressRing.classList.remove('warning', 'danger', 'overtime');
            this.timeDisplay.classList.remove('warning', 'danger', 'overtime');
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
        const label = this.heroLabelText;
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
        const TIMER_MIN_SCALE = window.CONFIG.MIN_TIMER_SCALE;
        const TIMER_MAX_SCALE = window.CONFIG.MAX_TIMER_SCALE;
        const STORAGE_BLOCK_SCALE_KEY = 'displayBlockScale';
        const STORAGE_TIMER_SCALE_KEY = 'displayTimerScale';

        // --- Alt key tracking (for block drag) ---
        this._handlers.altKeydown = (e) => {
            // Под замком подсветка не зажигается вовсе: она ОБЕЩАЕТ жест
            // (пунктир вокруг карточек и крестики), а жеста нет. Интерфейс,
            // обещающий то, чего не делает, читается как поломка.
            if (window.UILock && window.UILock.isLocked()) { return; }
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
            let newPct = clampScale(cur + delta, TIMER_MIN_SCALE, TIMER_MAX_SCALE);
            if (newPct !== cur) {
                this.timerScale = newPct;
                // Колесо упирается в ПОТОЛОК по месту, а не крутится вхолостую
                // до 300 %: иначе сохранённое значение и ползунок панели
                // говорили бы одно, а окно показывало другое.
                const effective = this.applyTimerScale();
                if (effective !== newPct) {
                    newPct = effective;
                    this.timerScale = effective;
                    if (effective === cur) {
                        // Упор в потолок. Раньше здесь был молчаливый выход, и
                        // жест выглядел сломанным: вверх ничего, вниз работает.
                        if (delta > 0) {
                            this.showScaleNote(`Таймер уже во всю высоту — ${this.timerScaleBlocker()}`);
                        }
                        return;
                    }
                }
                this._safeSetItem(STORAGE_TIMER_SCALE_KEY, String(newPct));
                // Сообщаем панели управления — иначе её ползунок останется на
                // старом значении, и два источника правды снова разойдутся.
                this._lastPushedTimerScale = newPct;
                if (this.ipcRenderer) {
                    this.ipcRenderer.send('report-scale', { source: 'display', scalePct: newPct });
                }
            }
        };
        // Масштаб ОДНОГО элемента. Панели он не сообщается намеренно: у неё
        // один ползунок на все блоки, и семью значениями он не управляет.
        // Ползунок остаётся командой «поставить всем сразу», а не зеркалом —
        // зеркалом семи величин одно число быть не может.
        const scaleOne = (id, delta) => {
            const cur = this.elementScales[id];
            const next = clampScale((cur || 100) + delta, BLOCK_MIN_SCALE, BLOCK_MAX_SCALE);
            if (next === cur) {
                // Тот же принцип, что у таймера: упор объясняется, а не молчит.
                this.showScaleNote(delta > 0
                    ? `Больше некуда: предел ${BLOCK_MAX_SCALE} %`
                    : `Меньше некуда: предел ${BLOCK_MIN_SCALE} %`);
                return;
            }
            this.applyElementScale(id, next);
            this.saveElementScales();
        };

        // Масштаб ВСЕХ карточек сразу — Shift+колесо и ползунок панели.
        // Подпись и плашка сюда не входят: у них своя пара, и «все блоки» на
        // экране означает именно карточки.
        const scaleAllBlocks = (delta) => {
            const blocks = this.movableElements.filter((row) => row.kind === 'block');
            if (!blocks.length) { return; }
            const cur = this.elementScales[blocks[0].id] || 120;
            const next = clampScale(cur + delta, BLOCK_MIN_SCALE, BLOCK_MAX_SCALE);
            if (next === cur) { return; }
            for (const row of blocks) { this.applyElementScale(row.id, next); }
            this.saveElementScales();
            this._safeSetItem(STORAGE_BLOCK_SCALE_KEY, String(next));
            this._lastPushedBlockScale = next;
            if (this.ipcRenderer) {
                this.ipcRenderer.send('report-scale', { source: 'display-blocks', scalePct: next });
            }
        };

        this._handlers.wheel = (e) => {
            if (!e.ctrlKey && !e.shiftKey) { return; }
            // Замок запрещает ЖЕСТЫ, а не настройки: масштаб продолжает
            // меняться из панели, но не колесом над окном, где это происходит
            // мимоходом (см. ui-lock.js). Ответ на упёршийся жест обязан
            // называть причину — молчание читается как неисправность.
            if (window.UILock && window.UILock.isLocked()) {
                e.preventDefault();
                this.showScaleNote('Закреплено: снимите замок в панели');
                return;
            }
            e.preventDefault();
            const step = window.CONFIG.SCALE_STEP;
            // Ось берётся ТА, ПО КОТОРОЙ ПРИШЛО ДВИЖЕНИЕ, а не всегда вертикаль.
            //
            // Shift на macOS перекладывает колесо на горизонтальную ось: в
            // событии приходит deltaX, а deltaY РАВЕН НУЛЮ. Прежняя строка
            // `e.deltaY < 0 ? step : -step` относила ноль к «иначе», то есть
            // ЛЮБОЙ поворот колеса со Shift означал уменьшение. Колесо со Shift
            // умело только уменьшать и упиралось в предел 50 % — жалоба
            // пользователя 17.08.2026, в его профиле все пять блоков лежали
            // ровно на пятидесяти.
            //
            // Синтетическое событие этого не ловит: в тесте deltaY задаётся
            // руками и нулём не бывает. Ось перекладывает СИСТЕМА, поэтому
            // проверка обязана подавать deltaX — см. e2e/display-layouts.spec.js.
            const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX;
            if (!raw) { return; }
            const delta = raw < 0 ? step : -step;

            // Shift+колесо — всем карточкам сразу, где бы ни стоял курсор.
            if (e.shiftKey) {
                scaleAllBlocks(delta);
                return;
            }

            // Ctrl+колесо — тому элементу, над которым курсор: карточке,
            // подписи или плашке. Мимо всех — таймеру.
            const target = e.target;
            const hovered = target && typeof target.closest === 'function'
                ? target.closest('.display-movable')
                : null;
            const row = hovered
                ? this.movableElements.find((r) => r.el === hovered)
                : null;
            // Колонка героя тоже подвижна, но масштаб у неё СВОЙ и давно:
            // Ctrl+колесо над таймером обязано менять `displayTimerScale`, а не
            // заводить таймеру второй масштаб через `--info-scale`.
            if (row && row.kind !== 'timer') {
                scaleOne(row.id, delta);
            } else {
                scaleTimer(delta);
            }
        };
        document.addEventListener('wheel', this._handlers.wheel, { passive: false });

        // --- Alt+Drag blocks ---
        // Реестр подвижных элементов — ОДИН на окно, он собран в
        // initMovableElements по таблице display-layouts.js. Здесь он только
        // читается: имя элемента уходит в панель при закрытии крестиком и в
        // хранилище при перетаскивании, и второй список этих пар неизбежно
        // разъехался бы с первым (в этом проекте так уже было).
        // Особенность у подписи одна, и она в CSS: пока она в потоке, колонка
        // компенсирует её высоту нижним отступом, а сдвинутая подпись
        // становится `position: fixed` — тогда компенсацию надо снять, иначе
        // таймер уедет вверх. За это отвечает класс `hero-label-moved`.
        const BLOCK_REGISTRY = this.movableElements;

        const saveBlockPositions = () => this.saveElementPositions();

        // Крестик блока: гасит блок здесь же и сообщает панели, чтобы та сняла
        // его тумблер. Владелец настроек — панель, и второй копии состояния тут
        // не заводится: локальное скрытие нужно лишь для того, чтобы блок исчез
        // в тот же кадр, а не через круг «дисплей → панель → дисплей».
        this._handlers.blockCloses = [];
        for (const row of BLOCK_REGISTRY) {
            // У колонки героя своего крестика нет — а `querySelector` нашёл бы
            // ЧУЖОЙ: крестик подписи лежит внутри неё. Второй обработчик на той
            // же кнопке гасил бы вместе с подписью весь таймер.
            if (row.kind === 'timer') { continue; }
            const button = row.el.querySelector('.info-close');
            if (!button) { continue; }
            const onClose = (e) => {
                // stopPropagation обязателен: клик по крестику идёт сквозь блок,
                // а на блоке висит начало перетаскивания.
                e.preventDefault();
                e.stopPropagation();
                row.el.classList.remove('visible');
                // Закрытая карточка больше никому не мешает: полосу, которую
                // под неё держала колонка, надо вернуть таймеру сразу, а не
                // ждать следующей посылки настроек.
                this.updateTopBand();
                if (this.ipcRenderer) {
                    this.ipcRenderer.send('display-block-hidden', { block: row.toggle });
                }
            };
            this._handlers.blockCloses.push({ button, handler: onClose });
            button.addEventListener('click', onClose);
            // Нажатие мышью на крестике не должно начинать жест перетаскивания.
            button.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        // Храним ссылки на mousedown handlers блоков для cleanup
        this._handlers.blockMousedowns = [];

        BLOCK_REGISTRY.forEach(({ el: block, flowClass, anchor }) => {
            const blockMousedown = (e) => {
                if (!e.altKey) { return; }
                if (window.UILock && window.UILock.isLocked()) { return; }
                e.preventDefault();
                e.stopPropagation();
                block.classList.add('dragging-block');

                // Коробка якоря ДО выхода из потока: см. третий проход ниже.
                const anchorEl = typeof anchor === 'function' ? anchor() : null;
                const anchorBefore = anchorEl ? anchorEl.getBoundingClientRect() : null;

                // If block uses preset positioning, switch to absolute left/top
                if (!block.classList.contains('custom-position')) {
                    const rect = block.getBoundingClientRect();
                    // Элемент, стоявший В ПОТОКЕ (подпись над таймером),
                    // уходит из него — и колонка обязана перестать держать под
                    // него место, иначе таймер съедет.
                    if (flowClass) { document.body.classList.add(flowClass); }
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

                    // ВТОРОЙ проход — иначе блок прыгает под курсором в момент
                    // нажатия. `left`/`top` задают положение НЕотмасштабированной
                    // коробки, а `getBoundingClientRect()` возвращает видимую, то
                    // есть увеличенную на --info-scale; насколько они разъезжаются,
                    // зависит от `transform-origin`, а он у каждого места свой
                    // (`top right` у правых, `center` у свободных). Замер: блок
                    // названия уезжал на 32px влево и 7px вверх ещё до первого
                    // движения мыши. Считать это в уме не нужно — достаточно
                    // померить остаток и вычесть его.
                    const shifted = block.getBoundingClientRect();
                    block.style.left = (rect.left + (rect.left - shifted.left)) + 'px';
                    block.style.top = (rect.top + (rect.top - shifted.top)) + 'px';

                    // ТРЕТИЙ проход — только у элемента с якорем (колонка
                    // героя). Два прохода выше держат на месте коробку САМОГО
                    // элемента, и этого довольно, пока выход из потока её
                    // размеров не меняет. У колонки меняет: вместе с
                    // `custom-position` уходят отступы `--top-band` и
                    // `--hero-block`, то есть таймер внутри коробки съезжает
                    // вверх ровно на полосу — на глаз это «таймер прыгнул при
                    // нажатии Alt». Держать надо то, за что взялись, поэтому
                    // остаток меряется по якорю: активному блоку стиля.
                    if (anchorEl && anchorBefore) {
                        const now = anchorEl.getBoundingClientRect();
                        block.style.left = ((parseFloat(block.style.left) || 0) + (anchorBefore.left - now.left)) + 'px';
                        block.style.top = ((parseFloat(block.style.top) || 0) + (anchorBefore.top - now.top)) + 'px';
                    }
                }

                const startScreenX = e.screenX;
                const startScreenY = e.screenY;
                const startLeft = parseInt(block.style.left) || 0;
                const startTop = parseInt(block.style.top) || 0;
                let rafId = 0;
                // Последнее ДВИЖЕНИЕ помнится отдельно от кадра отрисовки.
                // Раньше `mouseup` отменял незавершённый кадр — и то, что
                // произошло между последней отрисовкой и отпусканием мыши,
                // пропадало: блок оставался чуть позади курсора, а в хранилище
                // уходила эта же отставшая позиция. Заметно это ровно тогда,
                // когда движение и отпускание попали в один кадр (быстрый
                // короткий рывок) — то есть при аккуратной подгонке на пиксель.
                let pending = null;

                // Границы считаются по ВИДИМОЙ коробке и в её координатах, а
                // `left`/`top` задают неотмасштабированную: между ними
                // постоянный сдвиг, который здесь и замеряется. Прежний расчёт
                // брал `offsetWidth` (без масштаба) и потому при --info-scale
                // 1.2 позволял блоку вылезти за край на десятую его ширины.
                const visual = block.getBoundingClientRect();
                const offsetX = visual.left - (parseFloat(block.style.left) || 0);
                const offsetY = visual.top - (parseFloat(block.style.top) || 0);

                const place = () => {
                    if (!pending) { return; }
                    const dx = pending.x - startScreenX;
                    const dy = pending.y - startScreenY;
                    // Clamp so the block always keeps ~20px breathing room
                    // from every viewport edge — a card flush against the
                    // edge reads as a line on the side of the screen.
                    const MARGIN = 20;
                    const minLeft = MARGIN - offsetX;
                    const minTop = MARGIN - offsetY;
                    const maxLeft = Math.max(minLeft, window.innerWidth - visual.width - MARGIN - offsetX);
                    const maxTop  = Math.max(minTop, window.innerHeight - visual.height - MARGIN - offsetY);
                    const nextLeft = Math.min(maxLeft, Math.max(minLeft, startLeft + dx));
                    const nextTop  = Math.min(maxTop,  Math.max(minTop, startTop + dy));
                    block.style.left = nextLeft + 'px';
                    block.style.top  = nextTop  + 'px';
                };

                const onMove = (ev) => {
                    ev.preventDefault();
                    pending = { x: ev.screenX, y: ev.screenY };
                    if (rafId) { cancelAnimationFrame(rafId); }
                    rafId = requestAnimationFrame(() => {
                        rafId = 0;
                        place();
                    });
                };

                const onUp = () => {
                    block.classList.remove('dragging-block');
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                    // Кадр мог не успеть — доводим руками, ПОТОМ сохраняем.
                    place();
                    saveBlockPositions();
                    // Карточка ушла из места по умолчанию (или пришла в
                    // верхнюю часть окна) — полоса, которую держит колонка,
                    // пересчитывается по факту, а не в следующей посылке
                    // настроек.
                    this.updateTopBand();
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            };
            this._handlers.blockMousedowns.push({ block, handler: blockMousedown });
            block.addEventListener('mousedown', blockMousedown);
        });

        // --- Window drag in windowed (non-fullscreen) mode ---
        let isWindowDrag = false;
        let isFirstDragMove = true;
        let winDragStartX = 0, winDragStartY = 0;

        this._handlers.windowDragMousedown = (e) => {
            // Only drag when not fullscreen, not Alt (block drag), not on controls/buttons
            if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }
            if (!this.isWindowDragTarget(e.target)) { return; }
            // Check if window is NOT fullscreen (body width === screen width as heuristic)
            if (window.innerWidth === screen.width && window.innerHeight === screen.height) { return; }
            isWindowDrag = true;
            isFirstDragMove = true;
            winDragStartX = e.screenX;
            winDragStartY = e.screenY;
        };

        this._handlers.windowDragMousemove = (e) => {
            if (!isWindowDrag) { return; }
            const dx = e.screenX - winDragStartX;
            const dy = e.screenY - winDragStartY;
            if (dx !== 0 || dy !== 0) {
                // `first` помечает НАЧАЛО жеста, и без него окно теряет свой
                // размер. Главный процесс задаёт размер на каждом шаге (иначе
                // на мониторе с другим масштабом окно «дышит» — см. разбор про
                // WM_DPICHANGED), а какой именно — запоминает по этому флагу.
                // Дисплей его не слал вовсе: размер запоминался при ПЕРВОМ в
                // жизни окна перетаскивании и потом навязывался всем
                // последующим. Замер: окно 900×600 после перетаскивания
                // становилось 1200×800 — тем, каким было час назад.
                // Виджет и часы шлют этот флаг из WindowGeometry.bindWindowDrag.
                this.ipcRenderer.send('display-move', { deltaX: dx, deltaY: dy, first: isFirstDragMove });
                isFirstDragMove = false;
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
    }

    /**
     * Восстановление мест ПОСЛЕ открытия окна.
     *
     * Идёт на ОСЕВШИХ трансформациях — та же оговорка, что у раскладки и
     * пересчёта по ресайзу, и найдена она была третьей по счёту. Место
     * доводится по замеру видимой коробки (`placeElementAt`), а на элементах
     * висит переход в 400 мс: замер посреди него отдаёт коробку, которой уже
     * нет, и поправка выходит неверной ровно на остаток перехода. Значение
     * записывается в `style.left`, поэтому промах не рассасывается — он
     * остаётся сохранённым местом.
     *
     * Замер на раннере Windows 19.08.2026 (окно 1024×720, машина медленнее
     * локальной): центр подписи 388,189 → 392,187 после переоткрытия при
     * НЕИЗМЕННОЙ ширине 135 — то есть уехала не метрика шрифта, а сам замер.
     */
    restoreBlockPositions() {
        return this.withSettledTransforms(() => this._restoreBlockPositionsPass());
    }

    _restoreBlockPositionsPass() {
        const STORAGE_KEY = 'displayBlockPositions';
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

        // Масштабы: свой у каждого элемента, со старым общим ключом как
        // запасным (см. restoreElementScales и normalizeScales).
        this.restoreElementScales();

        // Restore positions (with JSON structure validation)
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            // Ключа НЕТ — это не «нечего делать», а полноценное состояние
            // «ничего не сдвинуто». Так выглядит профиль после пресета,
            // записанного на нетронутом виде: применение убирает ключ, и окно
            // обязано вернуть сдвинутое на место. Раньше здесь стоял ранний
            // выход, и таймер, подпись и плашка оставались там, куда их
            // утащили, — то есть пресет не воспроизводил вид.
            let positions = {};
            if (typeof saved === 'string' && saved.trim()) {
                try { positions = JSON.parse(saved); } catch { return; }
            }
            if (typeof positions !== 'object' || positions === null) { return; }

            // Имена берутся из ТОГО ЖЕ реестра, что и при сохранении
            // (initMovableElements). Прежде здесь стоял его третий по счёту
            // список, и блок, забытый в нём, терял сохранённое место при
            // каждом открытии окна, молча возвращаясь в исходный угол.
            for (const row of this.movableElements) {
                const key = row.id;
                const block = row.el;
                const pos = positions[key];
                if (!pos || typeof pos !== 'object'
                    || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
                    // Записи нет — а элемент СТОИТ сдвинутым. Так бывает после
                    // пресета: снимок сделан до того, как элемент двигали, и
                    // «применить вид» обязано вернуть его на место, иначе на
                    // экране не тот вид, что записан (а ряд ячеек это сравнение
                    // и показывает). Возвращается только тот, чьё место в
                    // ПОТОКЕ: подпись, плашка и колонка героя. У карточки места
                    // в потоке нет вовсе — её положение задаёт класс угла, и
                    // снятие custom-position оставило бы её без координат.
                    if ((row.cssVar || row.kind === 'timer')
                        && block.classList.contains('custom-position')) {
                        this.releaseToFlow(row);
                    }
                    continue;
                }

                // Доля окна главнее пикселя: окно могли открыть на другом
                // мониторе или другого размера, и пиксель означал бы место в
                // ПРОШЛОМ окне. Пиксель остаётся запасным путём для записей,
                // сделанных версией, которая долей ещё не знала.
                const fraction = (Number.isFinite(pos.cx) && Number.isFinite(pos.cy))
                    ? { cx: pos.cx, cy: pos.cy }
                    : null;

                // Классы места снимает общий метод — он же снимает компенсацию
                // потока у подписи (см. row.flowClass).
                this.markCustomPosition(row);

                if (fraction) {
                    this.elementFractions[key] = fraction;
                    const rect = block.getBoundingClientRect();
                    const placed = rect.width > 0
                        ? window.DisplayLayouts.fractionToPosition(
                            fraction,
                            { width: window.innerWidth, height: window.innerHeight },
                            { width: rect.width, height: rect.height }
                        )
                        : null;
                    if (placed) {
                        this.placeElementAt(row, placed.left, placed.top);
                        continue;
                    }
                }

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
                // Координата кладётся КАК СОХРАНЕНА. Не placeElementAt: тот
                // приводит к цели ВИДИМУЮ коробку, а в хранилище лежит
                // неотмасштабированная — поправка накапливалась бы при каждом
                // открытии окна.
                block.style.left = left + 'px';
                block.style.top = top + 'px';
                // Доли у старой записи нет — берём из фактического места, чтобы
                // следующий ресайз уже умел пересчитывать.
                const restored = block.getBoundingClientRect();
                const own = restored.width > 0
                    ? window.DisplayLayouts.positionToFraction(restored, { width: window.innerWidth, height: window.innerHeight })
                    : null;
                if (own) { this.elementFractions[key] = own; }
            }
        } catch { /* ok */ }
    }

    cleanup() {
        // Очищаем flashInterval если он активен
        if (this.flashInterval) {
            clearInterval(this.flashInterval);
            this.flashInterval = null;
        }

        // Надпись про упор в предел могла не догореть.
        if (this._scaleNoteTimer) {
            clearTimeout(this._scaleNoteTimer);
            this._scaleNoteTimer = null;
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
            if (this.ipcHandlers.displayLayout) {
                this.ipcRenderer.removeListener('display-layout', this.ipcHandlers.displayLayout);
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
        // На window — слушатель темы стоит отдельным <script> в display.html и
        // в область этого модуля не заглядывает.
        window.displayTimer = displayTimer;

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
