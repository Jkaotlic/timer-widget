/*
 * clock-widget-app.js — ClockWidget: логика окна часов и его запуск.
 *
 * Код страницы electron-clock-widget.html, до 25.09.2026 — её inline-<script>.
 * Вынесен целиком ради CSP `script-src 'self'` (без хешей и 'unsafe-inline').
 * Classic script, НЕ модуль и НЕ strict: имена верхнего уровня общие со всеми
 * остальными <script> страницы, как и были.
 *
 * Отступ в 8 пробелов — от HTML, и оставлен намеренно: source-level тесты
 * режут код по отступу (`\n {16}\};`), и сдвиг отступа молча сдвинул бы их
 * срезы. Тесты читают окно через tests/helpers/window-source.js.
 */
        // ipcRenderer теперь доступен через ipc-compat.js (безопасно)

        function applyShowTicks(showTicks) {
            const el = document.querySelector('.widget-container') || document.body;
            el.classList.toggle('ticks-on', !!showTicks);
        }

        // Размер окна при масштабе 100%. Раньше жил внутри setupEventListeners,
        // а восстановление геометрии считало от той же цифры, вписанной
        // отдельным литералом — то есть база существовала в двух местах.
        const CLOCK_BASE_SIZE = 220;

        class ClockWidget {
            constructor() {
                this.radius = 82;
                this.circumference = 2 * Math.PI * this.radius;

                // Настройки
                this.showSeconds = true;
                this.format24h = true;
                this.showDate = false;
                this.showTimezone = false;  // Убрано из UI — всегда выключено
                this.showNumbers = false;
                this.clockStyle = 'circle';
                // Stored handler refs for cleanup
                this._handlers = {};

                // Размер и позиция окна — общий механизм с виджетом таймера.
                // Различий ровно четыре, и все они здесь: ключ хранилища,
                // базовый размер и пара каналов (см. window-geometry.js).
                this._geometry = window.WindowGeometry.createWindowGeometry({
                    storageKey: 'clockGeometry',
                    baseSize: CLOCK_BASE_SIZE,
                    channels: {
                        move: 'clock-widget-move',
                        resize: 'clock-widget-resize',
                        position: 'clock-widget-set-position'
                    },
                    send: (channel, payload) => ipcRenderer.send(channel, payload),
                    parseJSON: safeJSONParse,
                    storage: localStorage,
                    getOuterWidth: () => window.outerWidth,
                    getScreenPosition: () => ({ x: window.screenX, y: window.screenY }),
                    // Размер меняют не только Ctrl+колесом: окно тянут за край
                    // рамки. Тот путь ползунку панели ничего не сообщал, и
                    // панель оставалась на прежнем числе (замер: окно 200 %,
                    // ползунок 100 %). Сообщаем ТЕМ ЖЕ каналом, что и колесо.
                    onScaleSettled: (pct) => ipcRenderer.send(
                        'report-scale', { source: 'clock', scalePct: pct }
                    )
                });

                this.initElements();
                this.initProgress();
                this.loadSettings();
                // Как и в виджете таймера: восстанавливаем из хранилища, иначе
                // включённые деления мигают отсутствием до первой посылки настроек
                // из панели. Ключ пишет обработчик галочки в electron-control.html.
                applyShowTicks(localStorage.getItem('clockShowTicks') === 'true');
                this.setupEventListeners();
                this.setupSettings();
                this.setupIPC();
                this.startClock();
            }

            initElements() {
                this.container = document.getElementById('widgetContainer');
                this.timeDisplay = document.getElementById('timeDisplay');
                this.dateBadge = document.getElementById('dateBadge');
                this.timezoneBadge = document.getElementById('timezoneBadge');
                this.secondsBar = document.getElementById('secondsBar');
                // Контролы убраны — управление из главного окна через IPC
                // Элементы удалены из HTML, ставим null чтобы избежать крэшей
                this.showSecondsEl = null;
                this.format24hEl = null;
                this.showDateEl = null;
                this.showTimezoneEl = null;
                this.showNumbersEl = null;
                this.showNumbersRow = null;
                
                // Дополнительные элементы для стилей
                this.digitsDateBadge = document.getElementById('digitsDateBadge');
                this.digitsTimezoneBadge = document.getElementById('digitsTimezoneBadge');
                this.flipDateBadge = document.getElementById('flipDateBadge');
                this.flipTimezoneBadge = document.getElementById('flipTimezoneBadge');
                
                // Элементы для разных стилей
                this.circularWidget = document.querySelector('.circular-widget');
                this.widgetFlip = document.getElementById('widgetFlip');
                this.widgetFlipContent = document.getElementById('widgetFlipContent');
                
                // Flip карточки
                this.wFlipHr1 = document.getElementById('wFlipHr1');
                this.wFlipHr2 = document.getElementById('wFlipHr2');
                this.wFlipMin1 = document.getElementById('wFlipMin1');
                this.wFlipMin2 = document.getElementById('wFlipMin2');
                this.wFlipSec1 = document.getElementById('wFlipSec1');
                this.wFlipSec2 = document.getElementById('wFlipSec2');
                this.wFlipSecGroup = document.getElementById('wFlipSecGroup');
                this.wFlipSecSep = document.getElementById('wFlipSecSep');
                
                // Аналоговые часы
                this.widgetAnalog = document.getElementById('widgetAnalog');
                this.clockAnalogHour = document.getElementById('clockAnalogHour');
                this.clockAnalogMinute = document.getElementById('clockAnalogMinute');
                this.clockAnalogSecond = document.getElementById('clockAnalogSecond');
                this.clockAnalogNumbers = document.getElementById('clockAnalogNumbers');
                this.analogDateBadge = document.getElementById('analogDateBadge');
                this.analogTimezoneBadge = document.getElementById('analogTimezoneBadge');

                // Стиль «Цифры». Знака минуса нет — часы не бывают
                // отрицательными, поэтому потомка -sign у #clockDigitsTime нет.
                this.clockDigits = document.getElementById('clockDigits');
                this.clockDigitsTime = document.getElementById('clockDigitsTime');
                this.clockDigitsValue = document.getElementById('clockDigitsValue');
                this.clockDigitsProbe = document.getElementById('clockDigitsProbe');
                this.digitsFont = window.DigitsStyle.DEFAULT_FONT_ID;
                this._digitsFontsReady = false;
                if (document.fonts && document.fonts.ready) {
                    document.fonts.ready.then(() => {
                        this._digitsFontsReady = true;
                        window.DigitsStyle.clearProbeCache();
                        this.updateScaling();
                    });
                } else {
                    this._digitsFontsReady = true;
                }

                // Устанавливаем стиль по умолчанию
                if (this.circularWidget) {this.circularWidget.classList.add('active');}
                document.body.classList.add('style-circle');
                
                // Настраиваем масштабирование флипа и «Цифр»
                this.updateScaling();
                this._handlers.onResizeScaling = () => this.updateScaling();
                window.addEventListener('resize', this._handlers.onResizeScaling);
            }

            updateScaling() {
                const containerWidth = this.container.offsetWidth;
                const containerHeight = this.container.offsetHeight;
                
                const showSeconds = this.showSeconds;
                
                // Масштаб для flip:
                // С секундами (HH:MM:SS): 6 карт×40 + 2×4 gap + 2 сеп×~20 + 4×8 flex gap ≈ 320
                // Без секунд (HH:MM): 4 карт×50 + 1×4 gap + 1 сеп×~25 + 2×8 flex gap ≈ 253
                const baseFlipWidth = showSeconds ? 320 : 255;
                const hasExtraInfo = this.showDate || this.showTimezone;
                // Карточки: 56px (с секундами) или 70px (без), плюс ~35px на дату/timezone
                const baseCardHeight = showSeconds ? 56 : 70;
                const baseFlipHeight = hasExtraInfo ? baseCardHeight + 35 : baseCardHeight;
                
                const scaleX = (containerWidth * 0.95) / baseFlipWidth;
                const scaleY = (containerHeight * 0.95) / baseFlipHeight;
                const flipScale = Math.min(scaleX, scaleY);
                
                this.container.style.setProperty('--flip-scale', flipScale);
                
                // Масштаб для аналоговых часов (базовый размер 200px + ~50px для info)
                const hasAnalogInfo = this.showDate || this.showTimezone;
                const baseAnalogWidth = 200;
                const baseAnalogHeight = hasAnalogInfo ? 250 : 200;
                
                const analogScaleX = (containerWidth * 0.8) / baseAnalogWidth;
                const analogScaleY = (containerHeight * 0.8) / baseAnalogHeight;
                const analogScale = Math.min(analogScaleX, analogScaleY);
                
                this.container.style.setProperty('--analog-scale', analogScale);

                // Цифры: кегль по замеру ЭТАЛОНА через measureDigits()/
                // fitFontSize() (digits-style.js) — тем же путём (и тем же
                // кэшу по паре «шрифт, эталон»), что у виджета и дисплея.
                // signWidth: 0, потому что часы не бывают отрицательными и
                // знака у них нет вообще (в отличие от таймера).
                //
                // Эталон — СВОЯ строка, не PROBE_MINUTES/PROBE_HOURS: те два
                // смоделированы под ТАЙМЕР и ничего не знают про суффикс
                // « AM»/« PM», который существует только у часов, в
                // 12-часовом формате. Замерено e2e (`часы «Цифры» не
                // обрезаются…`): при 12ч + секундах реальная строка
                // «07:29:58 PM» рисовалась 496px против эталонных 74px по
                // PROBE_HOURS, кегль выходил в 1.5 раза крупнее нужного, и
                // текст резался о край окна (320px блок). Эталон строится из
                // РЕАЛЬНОЙ формы текущего форматирования (showSeconds и
                // _uses24h() — те же источники, что уже определяют timeStr в
                // updateDisplay()), но измерение — measureDigits(), не
                // отдельный инлайновый DOM-замер: тот раньше не кэшировался
                // (getBoundingClientRect() на КАЖДЫЙ resize) и молча
                // расходился бы с этой функцией при любой будущей правке
                // самого модуля (например, letter-spacing).
                if (this.clockDigitsTime && this.clockDigitsProbe && this._digitsFontsReady) {
                    const sample = (showSeconds ? '88:88:88' : '88:88') + (this._uses24h() ? '' : ' PM');
                    const probe = window.DigitsStyle.measureDigits(this.clockDigitsProbe, this.digitsFont, sample);
                    // Место, занятое датой и поясом, вычитается из доступной
                    // ВЫСОТЫ. Они лежат в той же колонке, что и цифры, и без
                    // этого кегль подбирался бы под всё окно, а шильдики
                    // выдавливались бы за нижний край — тот же дефект, что
                    // строка вместо колонки, только по другой оси.
                    //
                    // Замер шильдиков собственным выходом подгонки НЕ является:
                    // их кегль задан clamp() от размера ОКНА и от
                    // --digits-font-size не зависит вовсе. Иначе это была бы
                    // подача замера себе на вход (см. разбор про подгонку).
                    const badgesHeight = [this.digitsDateBadge, this.digitsTimezoneBadge]
                        .filter((el) => el && el.offsetParent !== null)
                        .reduce((sum, el) => sum + el.offsetHeight + 8, 0);
                    if (probe) {
                        const size = window.DigitsStyle.fitFontSize({
                            availableWidth: containerWidth * 0.9,
                            availableHeight: Math.max(0, containerHeight * 0.9 - badgesHeight),
                            probeWidth: probe.width,
                            probeHeight: probe.height,
                            signWidth: 0
                        });
                        if (size > 0) {
                            this.clockDigitsTime.style.setProperty('--digits-font-size', size + 'px');
                        }
                    }
                }
            }

            initProgress() {
                this.secondsBar.style.strokeDasharray = `${this.circumference}`;
                this.secondsBar.style.strokeDashoffset = this.circumference;
            }


            /**
             * Пересчитать тон окна. Отдельный метод, потому что поводов два:
             * пришли цвета (сменилась подложка) и сменилась тема (сменился фон
             * ПО УМОЛЧАНИЮ). Второй повод до 18.08.2026 не существовал вовсе —
             * окно тему не принимало, палитра была прибита.
             */
            refreshTone() {
                const s = this._surface || {};
                window.UITheme.applyTone(window.RendererShared.surfaceTone({
                    color: s.color,
                    alpha: s.alpha,
                    theme: document.documentElement.getAttribute('data-theme')
                }));
            }

            applyColors(colors = null) {
                if (!colors) {
                    const saved = localStorage.getItem('clockColors');
                    colors = saved ? window.SecurityUtils.safeJSONParse(saved, null) : null;
                }
                // Пустой объект вместо выхода: сброс цвета в панели приходит
                // сюда как ОТСУТСТВИЕ поля, и ранний return делал его пустой
                // кнопкой — снятый цвет оставался на экране до перезапуска.
                colors = colors || {};

                const isSafeColor = window.SecurityUtils.isSafeColor;
                const timerColor = isSafeColor(colors.timer) ? colors.timer : null;
                const progressColor = isSafeColor(colors.progress) ? colors.progress : null;
                // Пустая строка снимает инлайн и возвращает управление CSS —
                // ровно так же, как removeProperty у переменных.
                const paint = (el, prop, value) => { if (el) { el.style[prop] = value || ''; } };

                // Подложка — одна пара «цвет + прозрачность» на окно; каждая
                // подложка в CSS записана как var(--surface-paint, <своё>),
                // поэтому красится ровно тот стиль, который сейчас на экране.
                const surface = window.RendererShared.surfacePaint({
                    color: colors.surface,
                    alpha: colors.surfaceAlpha
                });
                const root = document.documentElement;
                if (surface) { root.style.setProperty('--surface-paint', surface); }
                else { root.style.removeProperty('--surface-paint'); }
                // Прозрачность действует и без выбранного цвета: её множитель
                // вплетён в альфу подложки КАЖДОГО стиля (см. <style> выше).
                // Непрозрачный вариант того же цвета — для перекидыша: его
                // карточка это пластина, с которой створки берут свой фон.
                const solid = window.RendererShared.surfaceSolid({ color: colors.surface });
                if (solid) { root.style.setProperty('--surface-solid', solid); }
                else { root.style.removeProperty('--surface-solid'); }

                const alphaValue = window.RendererShared.surfaceAlpha(colors.surfaceAlpha);
                if (alphaValue === null) { root.style.removeProperty('--surface-alpha'); }
                else { root.style.setProperty('--surface-alpha', String(alphaValue)); }

                // Тон окна — тот же расчёт, что у виджета. Часы теме следовали
                // и раньше, но через `data-theme` напрямую: выбранная ТЁМНАЯ
                // подложка при светлой теме давала тёмный текст на тёмном.
                // Теперь решает яркость того, что реально под цифрами.
                this._surface = { color: colors.surface, alpha: colors.surfaceAlpha };
                this.refreshTone();

                // Circle style
                paint(this.timeDisplay, 'color', timerColor);
                paint(this.secondsBar, 'stroke', progressColor);
                // Стопы градиента красит КАСКАД (#clockGradient stop в <style>):
                // stop-color из CSS сильнее презентационного атрибута, а снять
                // атрибут, поставленный setAttribute, было нечем.
                if (timerColor) { root.style.setProperty('--timer-color-stop', timerColor); }
                else { root.style.removeProperty('--timer-color-stop'); }
                // Виджет и дисплей ставят эту переменную давно, часы — нет: их
                // флип красился инлайновым `color`. Точкам разделителя такой
                // цвет недоступен в принципе (их рисуют псевдоэлементы), и до
                // 14.08.2026 они были единственной частью стиля, до которой
                // выбранный цвет не доходил.
                if (timerColor) { root.style.setProperty('--timer-color', timerColor); }
                else { root.style.removeProperty('--timer-color'); }
                if (progressColor) { root.style.setProperty('--progress-color-stop', progressColor); }
                else { root.style.removeProperty('--progress-color-stop'); }

                // Цифры — у часов нет полос срочности (danger/overtime), красим
                // безусловно, без гейта по data-status, в отличие от таймера.
                paint(this.clockDigitsTime, 'color', timerColor);

                // Flip style. Разделитель здесь НЕ красится: он рисует точки
                // псевдоэлементами, и цвет до них доезжает переменной
                // --timer-color, выставленной выше. Инлайновый `color` на нём
                // не делал ничего и только выглядел как рабочая покраска.
                document.querySelectorAll('.widget-flip-digit')
                    .forEach(el => paint(el, 'color', timerColor));

                // Analog style
                paint(this.clockAnalogSecond, 'background', progressColor
                    ? `linear-gradient(180deg, ${timerColor || progressColor} 0%, ${progressColor} 100%)`
                    : null);
                paint(this.clockAnalogSecond, 'boxShadow', null);
                paint(document.querySelector('.widget-analog-center'), 'background', timerColor);

                // Date & timezone badges — all styles
                [
                    this.dateBadge, this.digitsDateBadge, this.flipDateBadge, this.analogDateBadge,
                    this.timezoneBadge, this.digitsTimezoneBadge, this.flipTimezoneBadge, this.analogTimezoneBadge
                ].forEach(el => paint(el, 'color', timerColor));

                localStorage.setItem('clockColors', JSON.stringify(colors));
            }

            setupEventListeners() {
                // Перетаскивание окна на JS вместо `-webkit-app-region: drag` —
                // общий механизм с виджетом таймера, см. window-geometry.js.
                // Перечень интерактивных элементов там же: внутренних контролов
                // в этом окне нет с тех пор, как управление переехало в панель,
                // но список оставлен защитой на будущее.
                window.WindowGeometry.bindWindowDrag({
                    container: this.container,
                    doc: document,
                    // Замок «Закрепить положение»: окно перестаёт ездить за
                    // случайно задетой мышью. Предикат, а не проверка внутри
                    // модуля, — window-geometry.js проверяется в Node на
                    // внедрённых DOM и хранилище и о состоянии окна не знает.
                    isLocked: () => !!(window.UILock && window.UILock.isLocked()),
                    onMove: (delta) => ipcRenderer.send('clock-widget-move', delta),
                    onDrop: () => this.saveGeometry(),
                    handlers: this._handlers
                });

                // Track timer and window states for keyboard shortcuts
                let _timerIsRunning = false;
                let _displayIsOpen = false;
                let _widgetIsOpen = false;
                this._handlers.onTimerState = (_event, state) => {
                    _timerIsRunning = !!state.isRunning;
                };
                this._handlers.onDisplayWindowState = (_event, state) => {
                    _displayIsOpen = !!state.isOpen;
                };
                this._handlers.onWidgetWindowState = (_event, state) => {
                    _widgetIsOpen = !!state.isOpen;
                };
                ipcRenderer.on('timer-state', this._handlers.onTimerState);
                ipcRenderer.on('display-window-state', this._handlers.onDisplayWindowState);
                ipcRenderer.on('widget-window-state', this._handlers.onWidgetWindowState);

                // Keyboard shortcuts (Space, R, Escape, C, W, D)
                this._handlers.onKeyDown = (e) => {
                    if (e.ctrlKey || e.altKey || e.metaKey) { return; }
                    switch (e.code) {
                        case 'Space':
                            e.preventDefault();
                            if (_timerIsRunning) {
                                ipcRenderer.send('timer-control', 'pause');
                            } else {
                                ipcRenderer.send('timer-control', 'start');
                            }
                            break;
                        case 'KeyR':
                            e.preventDefault();
                            ipcRenderer.send('timer-control', 'reset');
                            break;
                        // Escape окно не гасит: см. разбор у дисплея — жест
                        // «закрыть» принадлежит букве, а не клавише отмены.
                        case 'KeyC':
                            e.preventDefault();
                            ipcRenderer.send('close-clock-widget');
                            break;
                        case 'KeyW':
                            e.preventDefault();
                            ipcRenderer.send(_widgetIsOpen ? 'close-widget' : 'open-widget');
                            break;
                        case 'KeyD':
                            e.preventDefault();
                            ipcRenderer.send(_displayIsOpen ? 'close-display' : 'open-display');
                            break;
                        // Z: мастер-звук. Значение принадлежит ПАНЕЛИ (она же
                        // и играет), поэтому окно только просит — тем же
                        // приёмом, что и пресеты вида.
                        case 'KeyZ':
                            e.preventDefault();
                            ipcRenderer.send('sound-toggle');
                            break;
                    }

                    // Пресеты. Комментарий «1-8 (5,10,15,20,25,30,45,60 минут)»
                    // остался от прежнего набора длительностей: их четыре
                    // (CONFIG.PRESET_DURATIONS), и клавиши 5–8 слали
                    // `seconds: undefined`, что движок приводит к нулю — то есть
                    // СБРАСЫВАЛИ ТАЙМЕР. Диапазон выводится из реестра.
                    if (e.code >= 'Digit1' && e.code <= 'Digit9') {
                        const presets = window.CONFIG.PRESET_DURATIONS;
                        const idx = parseInt(e.code.replace('Digit', '')) - 1;
                        if (idx < presets.length) {
                            e.preventDefault();
                            ipcRenderer.send('timer-command', { type: 'set', seconds: presets[idx] });
                        }
                    }
                };
                document.addEventListener('keydown', this._handlers.onKeyDown);

                // Ctrl+Wheel scaling — resize clock by 10% per scroll tick
                const CLOCK_MIN_SCALE = window.WindowGeometry.MIN_SCALE_PCT;
                const CLOCK_MAX_SCALE = window.WindowGeometry.MAX_SCALE_PCT;
                // Масштаб НЕ хранится второй копией здесь. Копия жила в этом
                // обработчике, а обработчик `resize` перезаписывал её из
                // `window.outerWidth`, прочитанного ПРЯМО в событии, — то есть
                // ещё СТАРЫМ размером окна (об этом же говорит saveSettled).
                // Счётчик откатывался на ступень назад, и каждый второй щелчок
                // колеса пропадал: замер 8 щелчков вверх от 30 % дал
                // 40 → 40 → 50 → 50 → 60 → 60 → 70 → 70 %.
                //
                // Владелец один — модуль геометрии: он же обновляет величину,
                // когда размер УСТОЯЛСЯ, и знает про все пути (колесо, ползунок
                // панели, край рамки).
                const currentScalePct = () => {
                    const own = this._geometry.scalePct;
                    return Number.isFinite(own)
                        ? own
                        : Math.round(window.outerWidth / CLOCK_BASE_SIZE * 100);
                };
                this._handlers.onWheel = (e) => {
                    if (!e.ctrlKey) { return; }
                    // Замок «Закрепить положение» запрещает жест, но не
                    // настройку: масштаб по-прежнему меняется ползунком в
                    // панели (см. ui-lock.js).
                    if (window.UILock && window.UILock.isLocked()) { e.preventDefault(); return; }
                    e.preventDefault();
                    const step = window.CONFIG.SCALE_STEP;
                    // Та же причина, что у виджета и дисплея: ноль — это не
                    // «уменьшить», а «ничего не произошло».
                    const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                    if (!raw) { return; }
                    const delta = raw < 0 ? step : -step;
                    const cur = currentScalePct();
                    const newPct = window.RendererShared.clampScale(cur + delta, CLOCK_MIN_SCALE, CLOCK_MAX_SCALE);
                    if (newPct === cur) { return; }
                    const newSize = Math.round(CLOCK_BASE_SIZE * newPct / 100);
                    ipcRenderer.send('clock-widget-resize', { width: newSize, height: newSize });
                    // Без этого масштаб от Ctrl+колеса терялся при переоткрытии.
                    this.saveGeometry(newPct);
                    // И сообщаем панели управления, чтобы её ползунок не врал.
                    ipcRenderer.send('report-scale', { source: 'clock', scalePct: newPct });
                };
                document.addEventListener('wheel', this._handlers.onWheel, { passive: false });
                this._handlers.onResizeScalePct = () => {
                    // Окно могли отмасштабировать НЕ колесом: ползунком «Масштаб
                    // часов» в панели управления (она шлёт clock-widget-resize и
                    // сама ничего не сохраняет) либо потянув за край окна. Без
                    // этой ветки clockGeometry оставался со старым scalePct, и
                    // часы при следующем открытии откатывались к прежнему размеру,
                    // а ползунок в панели показывал уже третье значение.
                    //
                    // Решение «писать или не писать» принимает сам модуль, и
                    // принимает ПОСЛЕ того, как размер устоялся. Здесь его
                    // принимать нельзя: restoreGeometry() при старте сама
                    // вызывает resize, и в момент события окно ещё прежнего
                    // размера — раннее событие затирало восстановленную
                    // геометрию позицией открытия по умолчанию, замерено.
                    // См. saveSettled() в window-geometry.js.
                    this._geometry.saveSettled();
                };
                window.addEventListener('resize', this._handlers.onResizeScalePct);
            }

            setupSettings() {
                // Все настройки управляются из главного окна через IPC
                // Ctrl+Wheel resize сохранён в setupEventListeners
            }

            // setSize() с пресетами small/medium/large/xlarge удалён: единственным
            // вызовом был loadSettings(), который теперь восстанавливает реальную
            // геометрию, а UI для выбора пресета размера в приложении отсутствует.

            setClockStyle(style) {
                // Белый список. Значение приходит ДВУМЯ путями, и оба без
                // проверки: из localStorage при старте и по каналу
                // `clock-widget-set-style`, который главный процесс просто
                // ретранслирует. Класс собирается конкатенацией, а
                // `classList.add` роняет DOMException на строке с пробелом или
                // на пустой — обработчик обрывается ПОСЛЕ снятия прежних
                // классов, и body остаётся вообще без `style-*`, то есть
                // раскладка выбранного стиля разваливается целиком (замерено).
                // Виджет и дисплей кладут литералы в ветках switch и такой
                // дырки не имеют. Мусор нельзя и запоминать: this.clockStyle
                // уезжает обратно в localStorage при сохранении настроек.
                // Сохранённый LED переводится в «Цифры» ДО проверки списка:
                // иначе профиль со слитым стилем откатывался бы к кругу.
                const wanted = window.RendererShared.migrateTimerStyle(style);
                const safeStyle = ['circle', 'flip', 'analog', 'digits'].includes(wanted) ? wanted : 'circle';
                this.clockStyle = safeStyle;

                // Применяем класс стиля к body
                document.body.classList.remove('style-circle', 'style-flip', 'style-analog', 'style-digits');
                document.body.classList.add('style-' + safeStyle);

                // Скрываем все стили
                if (this.circularWidget) {this.circularWidget.classList.remove('active');}
                if (this.widgetFlip) {this.widgetFlip.classList.remove('active');}
                if (this.widgetAnalog) {this.widgetAnalog.classList.remove('active');}
                if (this.clockDigits) {this.clockDigits.classList.remove('active');}

                // Показываем выбранный
                switch (safeStyle) {
                    case 'circle':
                        if (this.circularWidget) {this.circularWidget.classList.add('active');}
                        break;
                    case 'flip':
                        if (this.widgetFlip) {this.widgetFlip.classList.add('active');}
                        break;
                    case 'analog':
                        if (this.widgetAnalog) {this.widgetAnalog.classList.add('active');}
                        break;
                    case 'digits':
                        if (this.clockDigits) {this.clockDigits.classList.add('active');}
                        break;
                }
                
                // Показываем/скрываем опцию "Цифры на циферблате" только для analog
                if (this.showNumbersRow) {
                    this.showNumbersRow.style.display = (safeStyle === 'analog') ? 'flex' : 'none';
                }

                // Раньше здесь стояло принудительное `this.showSeconds = true` и
                // `this.format24h = true` для LED и флипа — с последующим
                // saveSettings(). То есть смена стиля МОЛЧА затирала выбор
                // пользователя и сохраняла подмену: снял галочку «Секунды»,
                // переключил стиль — секунды вернулись навсегда, а чекбокс в
                // панели управления продолжал показывать «выключено».
                //
                // Ограничение осталось ровно одно и оно физическое: у расщеплённых
                // карточек нет ячейки AM/PM, поэтому flip всегда 24-часовой. Но это
                // теперь решение ВРЕМЕНИ ОТРИСОВКИ (_uses24h()), а не мутация
                // сохранённой настройки.
                this.updateSecondsVisibility();

                // Обновляем масштабирование после смены стиля
                if (this._scalingTimer) { clearTimeout(this._scalingTimer); }
                this._scalingTimer = setTimeout(() => {
                    this._scalingTimer = null;
                    this.updateScaling();
                }, 50);

                this.saveSettings();
                this.updateDisplay();
            }

            // 24-часовой формат для текущего стиля. Flip не имеет ячейки AM/PM,
            // поэтому там всегда 24 часа — независимо от настройки, но и НЕ
            // перезаписывая её: вернувшись на другой стиль, пользователь получит
            // свой формат обратно.
            _uses24h() {
                return this.clockStyle === 'flip' ? true : this.format24h;
            }

            formatTimezoneString() {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const offset = new Date().getTimezoneOffset();
                const sign = offset <= 0 ? '+' : '-';
                const absOffset = Math.abs(offset);
                const hours = Math.floor(absOffset / 60);
                const mins = absOffset % 60;
                return `UTC${sign}${hours}${mins > 0 ? ':' + String(mins).padStart(2, '0') : ''} • ${tz.split('/').pop().replace('_', ' ')}`;
            }

            updateDateTimezoneVisibility() {
                // Обновляем видимость даты во всех стилях
                [this.dateBadge, this.digitsDateBadge, this.flipDateBadge, this.analogDateBadge].forEach(el => {
                    if (el) {
                        el.style.display = this.showDate ? 'block' : 'none';
                    }
                });
                
                // Обновляем видимость часового пояса во всех стилях
                const tzString = this.formatTimezoneString();
                
                [this.timezoneBadge, this.digitsTimezoneBadge, this.flipTimezoneBadge, this.analogTimezoneBadge].forEach(el => {
                    if (el) {
                        el.textContent = tzString;
                        el.style.display = this.showTimezone ? 'block' : 'none';
                    }
                });
                
                // Пересчитываем масштаб
                this.updateScaling();
            }

            updateSecondsVisibility() {
                // Для flip-часов
                if (this.wFlipSecGroup && this.wFlipSecSep) {
                    this.wFlipSecGroup.style.display = this.showSeconds ? 'flex' : 'none';
                    this.wFlipSecSep.style.display = this.showSeconds ? 'flex' : 'none';
                    this.widgetFlip.classList.toggle('has-seconds', this.showSeconds);
                }
                
                // Обновляем масштаб при изменении количества цифр
                if (this._scalingTimer) { clearTimeout(this._scalingTimer); }
                this._scalingTimer = setTimeout(() => {
                    this._scalingTimer = null;
                    this.updateScaling();
                }, 50);
            }

            // toggleSettings и closeSettings убраны — управление из главного окна

            loadSettings() {
                const settings = localStorage.getItem('clockWidgetSettings');
                if (settings) {
                    const s = window.SecurityUtils.safeJSONParse(settings, {});
                    // Здесь читалась `s.opacity` — ключ, который никто и никогда не
                    // записывал: контрола прозрачности нет ни в панели, ни в самих
                    // часах. Чтение без записи всегда возвращало undefined.
                    if (s.showSeconds !== undefined) {
                        this.showSeconds = s.showSeconds;
                    }
                    if (s.format24h !== undefined) {
                        this.format24h = s.format24h;
                    }
                    if (s.showDate !== undefined) {
                        this.showDate = s.showDate;
                    }
                    if (s.showTimezone !== undefined) {
                        this.showTimezone = s.showTimezone;
                    }
                    if (s.showNumbers !== undefined) {
                        this.showNumbers = s.showNumbers;
                        if (this.clockAnalogNumbers) {
                            this.clockAnalogNumbers.classList.toggle('visible', s.showNumbers);
                        }
                    }
                    // Шрифт стиля «Цифры» — своё имя внутри clockWidgetSettings
                    // (СОБСТВЕННЫЙ набор часов, в отличие от виджета/дисплея,
                    // которые читают displayExtSettings). У шрифта нет
                    // локального источника изменений (только панель).
                    if (s.clockDigitsFont !== undefined) {
                        const font = window.DigitsStyle.applyFont(this.clockDigitsTime, s.clockDigitsFont);
                        this.digitsFont = font.id;
                    }
                    if (s.clockStyle) {
                        this.clockStyle = s.clockStyle;
                        this.setClockStyle(s.clockStyle);
                    }
                }

                this.restoreGeometry();

                // Обновляем видимость элементов
                this.updateSecondsVisibility();
                this.updateDateTimezoneVisibility();
                this.updateScaling();
            }

            // Размер и позиция часов переживают перезапуск. Раньше здесь
            // безусловно вызывался setSize('medium'), поэтому окно каждый раз
            // возвращалось в правый нижний угол с размером по умолчанию, а
            // масштаб от Ctrl+колеса и перетаскивание терялись.
            restoreGeometry() {
                this._geometry.restore();
            }

            saveGeometry(scalePct) {
                this._geometry.save(scalePct);
            }

            saveSettings() {
                const settings = {
                    opacity: parseFloat(this.container.style.opacity) || 1,
                    showSeconds: this.showSeconds,
                    format24h: this.format24h,
                    showDate: this.showDate,
                    showTimezone: this.showTimezone,
                    showNumbers: this.showNumbers,
                    clockStyle: this.clockStyle,
                    clockDigitsFont: this.digitsFont
                };
                // СЛИЯНИЕ, а не перезапись — см. тот же комментарий в
                // electron-control.html:pushClockSettings(). Оба окна пишут этот
                // ключ разными наборами полей, и прямая запись теряла чужие.
                const prev = safeJSONParse(localStorage.getItem('clockWidgetSettings'), {});
                localStorage.setItem('clockWidgetSettings', JSON.stringify({ ...prev, ...settings }));
            }

            setupIPC() {
                // Границы окна от ГЛАВНОГО процесса — источник для записи
                // геометрии. Свои outerWidth/screenX остаются запасным путём,
                // см. window-geometry.js.
                this._handlers.onWindowGeometry = (event, bounds) => {
                    this._geometry.setWindowBounds(bounds);
                };
                ipcRenderer.on('window-geometry', this._handlers.onWindowGeometry);

                // Получаем стиль от панели управления
                this._onSetClockStyle = (event, style) => {
                    this.setClockStyle(style);
                    // Здесь стоял цикл по '.style-btn' — подсветка кнопок выбора стиля
                    // ВНУТРИ окна часов. Этих кнопок нет с тех пор, как управление
                    // переехало в панель: цикл всегда обходил пустую выборку.
                };
                ipcRenderer.on('set-clock-style', this._onSetClockStyle);
                
                // Получаем настройки дисплея (showAnalogNumbers)
                this._onDisplaySettingsUpdate = (event, settings) => {
                    if (settings.showAnalogNumbers !== undefined && this.clockAnalogNumbers) {
                        this.clockAnalogNumbers.classList.toggle('visible', settings.showAnalogNumbers);
                    }
                    // ТОЛЬКО clockStyle. Раньше рядом стоял fallback
                    // `else if (settings.timerStyle) setClockStyle(settings.timerStyle)`,
                    // но timerStyle в ЭТОМ сообщении — стиль ПОЛНОЭКРАННОГО режима
                    // (см. pushDisplaySettings в electron-control.html), а не часов.
                    // Сработав, он молча навязал бы часам чужой стиль в обход и
                    // собственной настройки часов, и переключателя синхронизации
                    // syncClockStyle, который по умолчанию выключен.
                    if (settings.clockStyle) {
                        this.setClockStyle(settings.clockStyle);
                    }
                };
                ipcRenderer.on('display-settings-update', this._onDisplaySettingsUpdate);
                
                // Получаем настройки часов от панели управления
                this._onClockSettings = (event, settings) => {
                    if (settings.showDate !== undefined) {
                        this.showDate = settings.showDate;
                        if (this.showDateEl) { this.showDateEl.checked = settings.showDate; }
                    }
                    if (settings.showTimezone !== undefined) {
                        this.showTimezone = settings.showTimezone;
                        if (this.showTimezoneEl) { this.showTimezoneEl.checked = settings.showTimezone; }
                    }
                    if (settings.showSeconds !== undefined) {
                        this.showSeconds = settings.showSeconds;
                        if (this.showSecondsEl) { this.showSecondsEl.checked = settings.showSeconds; }
                        this.updateSecondsVisibility();
                    }
                    if (settings.format24h !== undefined) {
                        this.format24h = settings.format24h;
                        if (this.format24hEl) { this.format24hEl.checked = settings.format24h; }
                    }
                    if (settings.showNumbers !== undefined) {
                        this.showNumbers = settings.showNumbers;
                        if (this.showNumbersEl) { this.showNumbersEl.checked = settings.showNumbers; }
                        if (this.clockAnalogNumbers) {
                            this.clockAnalogNumbers.classList.toggle('visible', settings.showNumbers);
                        }
                    }
                    // Шрифт «Цифр» — своё поле в том же пакете, сохраняется в
                    // СОБСТВЕННОМ наборе часов (clockWidgetSettings), а не в
                    // displayExtSettings, как у виджета/дисплея.
                    if (settings.clockDigitsFont !== undefined) {
                        const font = window.DigitsStyle.applyFont(this.clockDigitsTime, settings.clockDigitsFont);
                        if (font.id !== this.digitsFont) {
                            this.digitsFont = font.id;
                            this.updateScaling();
                            // И ещё раз, когда доедет woff2. Знака минуса у
                            // часов нет, но подгонка КЕГЛЯ мерит тем же
                            // measureDigits() и так же попадает на запасное
                            // начертание (см. isFontLoaded в digits-style.js).
                            window.DigitsStyle.ensureFont(font.id).then(() => {
                                window.DigitsStyle.clearProbeCache();
                                this.updateScaling();
                            });
                        }
                    }
                    this.updateDateTimezoneVisibility();
                    this.saveSettings();
                    this.updateDisplay();
                    if (settings && 'showTicks' in settings) { applyShowTicks(settings.showTicks); }
                };
                ipcRenderer.on('clock-settings', this._onClockSettings);

                // Per-window color theme
                this._onColorsUpdate = (_event, colors) => {
                    this.applyColors(colors);
                };
                ipcRenderer.on('clock-colors-update', this._onColorsUpdate);
            }

            cleanup() {
                if (this.clockTimeout) {
                    clearTimeout(this.clockTimeout);
                    this.clockTimeout = null;
                }
                if (this.mouseTimeout) {
                    clearTimeout(this.mouseTimeout);
                    this.mouseTimeout = null;
                }
                if (this._scalingTimer) {
                    clearTimeout(this._scalingTimer);
                    this._scalingTimer = null;
                }
                window.FlipCard.cancelPending();
                // Отложенная запись геометрии не должна сработать после того,
                // как окно закрыли — тот же принцип, что строкой выше.
                if (this._geometry) { this._geometry.cancelPendingSave(); }
                if (this._onSetClockStyle) {ipcRenderer.removeListener('set-clock-style', this._onSetClockStyle);}
                if (this._onDisplaySettingsUpdate) {ipcRenderer.removeListener('display-settings-update', this._onDisplaySettingsUpdate);}
                if (this._onClockSettings) {ipcRenderer.removeListener('clock-settings', this._onClockSettings);}
                if (this._onColorsUpdate) {
                    ipcRenderer.removeListener('clock-colors-update', this._onColorsUpdate);
                }

                // Удаляем DOM и IPC handlers из _handlers
                const h = this._handlers || {};
                if (h.onResizeScaling) { window.removeEventListener('resize', h.onResizeScaling); }
                if (h.onResizeScalePct) { window.removeEventListener('resize', h.onResizeScalePct); }
                if (h.onMouseMove) { document.removeEventListener('mousemove', h.onMouseMove); }
                if (h.onMouseUp) { document.removeEventListener('mouseup', h.onMouseUp); }
                if (h.onKeyDown) { document.removeEventListener('keydown', h.onKeyDown); }
                if (h.onWheel) { document.removeEventListener('wheel', h.onWheel); }
                if (h.onContainerMouseDown && this.container) {
                    this.container.removeEventListener('mousedown', h.onContainerMouseDown);
                }
                if (h.onTimerState) { ipcRenderer.removeListener('timer-state', h.onTimerState); }
                if (h.onDisplayWindowState) { ipcRenderer.removeListener('display-window-state', h.onDisplayWindowState); }
                if (h.onWidgetWindowState) { ipcRenderer.removeListener('widget-window-state', h.onWidgetWindowState); }
                if (h.onWindowGeometry) { ipcRenderer.removeListener('window-geometry', h.onWindowGeometry); }
                this._handlers = {};
            }

            startClock() {
                // Очищаем предыдущий таймер если был
                if (this.clockTimeout) {
                    clearTimeout(this.clockTimeout);
                    this.clockTimeout = null;
                }
                this.updateDisplay();
                // Самокорректирующийся таймер, синхронизированный с системными часами
                this._scheduleNextTick();
            }

            _scheduleNextTick() {
                const now = Date.now();
                const msToNextSecond = 1000 - (now % 1000);
                this.clockTimeout = setTimeout(() => {
                    this.updateDisplay();
                    this._scheduleNextTick();
                }, msToNextSecond);
            }

            updateDisplay() {
                const now = new Date();
                const hours = now.getHours();
                const minutes = now.getMinutes();
                const seconds = now.getSeconds();

                // Форматируем время
                let displayHours = hours;
                let ampm = '';
                
                if (!this._uses24h()) {
                    ampm = hours >= 12 ? ' PM' : ' AM';
                    displayHours = hours % 12 || 12;
                }

                const hhmm = `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                const ss = String(seconds).padStart(2, '0');
                const timeStr = this.showSeconds
                    ? `${hhmm}:${ss}${ampm}`
                    : `${hhmm}${ampm}`;

                // Круговой стиль: основной HH:MM + superscript секунды (если включены).
                // innerHTML безопасен — все значения числовые или константа ampm ' AM'/' PM'.
                if (this.showSeconds) {
                    this.timeDisplay.innerHTML = `${hhmm}<span class="clock-seconds">:${ss}${ampm}</span>`;
                } else {
                    this.timeDisplay.textContent = `${hhmm}${ampm}`;
                }

                // Обновляем прогресс секунд
                const ratio = seconds / 60;
                const offset = this.circumference - (ratio * this.circumference);
                this.secondsBar.style.strokeDashoffset = offset;

                // Обновляем цифровой стиль
                if (this.widgetDigitalTime) {
                    this.widgetDigitalTime.textContent = timeStr;
                }

                // Цифры: та же готовая строка (_uses24h() и showSeconds уже
                // учтены выше) — в отличие от flip, у «Цифр» есть место под
                // AM/PM, поэтому 24-часовое ограничение сюда не переносится.
                if (this.clockDigitsValue) {
                    this.clockDigitsValue.textContent = timeStr;
                }

                // Обновляем перекидные часы
                this.updateFlipDisplay(displayHours, minutes, seconds);

                // Обновляем аналоговые часы
                this.updateAnalogClock(hours, minutes, seconds);

                // Обновляем дату во всех стилях
                if (this.showDate) {
                    const options = { weekday: 'short', day: 'numeric', month: 'short' };
                    const dateStr = now.toLocaleDateString('ru-RU', options);
                    [this.dateBadge, this.digitsDateBadge, this.flipDateBadge, this.analogDateBadge].forEach(el => {
                        if (el) {el.textContent = dateStr;}
                    });
                }
                
                // Обновляем часовой пояс во всех стилях
                if (this.showTimezone) {
                    const tzStr = this.formatTimezoneString();
                    [this.timezoneBadge, this.digitsTimezoneBadge, this.flipTimezoneBadge, this.analogTimezoneBadge].forEach(el => {
                        if (el) {el.textContent = tzStr;}
                    });
                }
            }

            updateAnalogClock(hours, minutes, seconds) {
                if (!this.clockAnalogHour || !this.clockAnalogMinute || !this.clockAnalogSecond) {return;}

                // Часовая стрелка - полный оборот за 12 часов
                // Плавное движение с учетом минут
                const hourDeg = ((hours % 12) / 12) * 360 + (minutes / 60) * 30;
                this.clockAnalogHour.style.transform = `rotate(${hourDeg}deg)`;

                // Минутная стрелка - полный оборот за 60 минут
                // Плавное движение с учетом секунд
                const minuteDeg = (minutes / 60) * 360 + (seconds / 60) * 6;
                this.clockAnalogMinute.style.transform = `rotate(${minuteDeg}deg)`;

                // Секундная стрелка - полный оборот за 60 секунд
                const secondDeg = (seconds / 60) * 360;
                // Отключаем transition при переходе 59→0 чтобы не было обратного оборота
                if (seconds === 0) {
                    this.clockAnalogSecond.style.transition = 'none';
                } else if (this.clockAnalogSecond.style.transition === 'none') {
                    this.clockAnalogSecond.style.transition = '';
                }
                this.clockAnalogSecond.style.transform = `rotate(${secondDeg}deg)`;
                
                // Скрываем/показываем секундную стрелку
                if (this.clockAnalogSecond) {
                    this.clockAnalogSecond.style.display = this.showSeconds ? 'block' : 'none';
                }
            }

            // Перекидывание одной карточки. Общая реализация — flip-card.js.
            // Незавершённые таймеры модуль ведёт сам, гасим их одним
            // FlipCard.cancelPending() в cleanup().
            _flip(card, value) {
                window.FlipCard.flipCardTo(card, '.widget-flip-digit', value);
            }

            updateFlipDisplay(hours, minutes, seconds) {
                if (!this.wFlipHr1 || !this.wFlipMin1) {return;}

                const hr1 = String(Math.floor(hours / 10) % 10);
                const hr2 = String(hours % 10);
                const min1 = String(Math.floor(minutes / 10));
                const min2 = String(minutes % 10);
                const sec1 = String(Math.floor(seconds / 10));
                const sec2 = String(seconds % 10);

                // Обновляем цифры с перекидыванием (анимация — только там, где
                // значение реально изменилось, иначе табло мельтешит каждую секунду)
                this._flip(this.wFlipHr1, hr1);
                this._flip(this.wFlipHr2, hr2);
                this._flip(this.wFlipMin1, min1);
                this._flip(this.wFlipMin2, min2);

                if (this.showSeconds && this.wFlipSec1 && this.wFlipSec2) {
                    this._flip(this.wFlipSec1, sec1);
                    this._flip(this.wFlipSec2, sec2);
                }
            }
        }

        // Show hint only on first open
        if (localStorage.getItem('clockHintShown') === 'v2') {
            const h = document.getElementById('clockHint');
            if (h) { h.style.display = 'none'; }
        } else {
            localStorage.setItem('clockHintShown', 'v2');
        }

        // На window — по той же причине, что и в виджете таймера: слушатель
        // темы стоит отдельным <script> и в эту область не заглядывает.
        const clockWidget = new ClockWidget();
        window.clockWidget = clockWidget;

        // Cleanup при закрытии окна
        window.addEventListener('beforeunload', () => {
            clockWidget.cleanup();
        });
