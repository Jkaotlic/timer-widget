/*
 * widget-app.js — WidgetTimer: логика окна виджета таймера и его запуск.
 *
 * Код страницы electron-widget.html, до 25.09.2026 — её inline-<script>.
 * Вынесен целиком ради CSP `script-src 'self'` (без хешей и 'unsafe-inline').
 * Classic script, НЕ модуль и НЕ strict: имена верхнего уровня общие со всеми
 * остальными <script> страницы, как и были.
 *
 * Отступ в 8 пробелов — от HTML, и оставлен намеренно: source-level тесты
 * режут код по отступу (`\n {16}\};`), и сдвиг отступа молча сдвинул бы их
 * срезы. Тесты читают окно через tests/helpers/window-source.js.
 */
        // ipcRenderer теперь доступен через ipc-compat.js (безопасно)

        // safeJSONParse доступна глобально из security.js

        // Размер окна при масштабе 100%. Раньше жил внутри setupEventListeners,
        // а восстановление геометрии считало от той же цифры, вписанной
        // отдельным литералом — то есть база существовала в двух местах.
        const WIDGET_BASE_SIZE = 250;

        class WidgetTimer {
            constructor() {
                this.radius = 82;
                this.circumference = 2 * Math.PI * this.radius;
                this.totalSeconds = 0;
                this.remainingSeconds = 0;
                this.isRunning = false;
                this.isPaused = false;
                this.lastTimestamp = 0;
                this.lastUpdateCounter = -1;
                this._hasWidgetStyle = false;
                // Stored handler refs for cleanup
                this._handlers = {};

                // Размер и позиция окна — общий механизм с часами. Различий
                // ровно четыре, и все они здесь: ключ хранилища, базовый размер
                // и пара каналов (см. window-geometry.js).
                this._geometry = window.WindowGeometry.createWindowGeometry({
                    storageKey: 'widgetGeometry',
                    baseSize: WIDGET_BASE_SIZE,
                    channels: {
                        move: 'widget-move',
                        resize: 'widget-resize',
                        position: 'widget-set-position'
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
                        'report-scale', { source: 'widget', scalePct: pct }
                    )
                });

                this.initElements();
                this.initProgress();

                try {
                    this.loadSettings();
                    this.applyColors();
                    this.loadBackgroundSettings();
                } catch (e) {
                    // Это не «warning»: сюда попадает окно, у которого не
                    // отработали настройки, цвета ИЛИ фон — то есть виджет
                    // остался на умолчаниях, и человек видит не то, что
                    // настроил. Стек обязателен: без него сообщение говорит,
                    // ЧТО сломалось, но не ГДЕ, а три вызова выше выглядят
                    // одинаково.
                    console.error('[widget] инициализация не отработала:', e && (e.stack || e.message));
                }

                this.setupIPC();
                this.setupEventListeners();
                this.setupSettings();
            }

            initElements() {
                this.container = document.getElementById('widgetContainer');
                this.timeDisplay = document.getElementById('timeDisplay');
                this.timeDisplaySign = document.getElementById('timeDisplaySign');
                this.timeDisplayDigits = document.getElementById('timeDisplayDigits');
                this.statusBadge = document.getElementById('statusBadge');
                this.progressBar = document.getElementById('progressBar');
                // Контролы убраны — управление из главного окна
                
                // Элементы для разных стилей
                this.circularWidget = document.querySelector('.circular-widget');
                this.widgetFlip = document.getElementById('widgetFlip');
                this.widgetAnalog = document.getElementById('widgetAnalog');
                this.widgetFlipContent = document.getElementById('widgetFlipContent');
                
                // Аналоговые элементы
                this.widgetHandHour = document.getElementById('widgetHandHour');
                this.widgetHandMinute = document.getElementById('widgetHandMinute');
                this.widgetHandSecond = document.getElementById('widgetHandSecond');
                this.widgetClockCenter = document.getElementById('widgetClockCenter');
                this.widgetAnalogDigital = document.getElementById('widgetAnalogDigital');
                this.widgetClockNumbers = document.getElementById('widgetClockNumbers');
                
                // Flip карточки
                this.wFlipHr1 = document.getElementById('wFlipHr1');
                this.wFlipHr2 = document.getElementById('wFlipHr2');
                this.wFlipHoursGroup = document.getElementById('wFlipHoursGroup');
                this.wFlipHoursSep = document.getElementById('wFlipHoursSep');
                this.wFlipContent = document.getElementById('widgetFlipContent');
                this.wFlipMinus = document.getElementById('wFlipMinus');
                this.wFlipMin1 = document.getElementById('wFlipMin1');
                this.wFlipMin2 = document.getElementById('wFlipMin2');
                this.wFlipSec1 = document.getElementById('wFlipSec1');
                this.wFlipSec2 = document.getElementById('wFlipSec2');

                // Стиль «Цифры»
                this.widgetDigits = document.getElementById('widgetDigits');
                this.widgetDigitsTime = document.getElementById('widgetDigitsTime');
                this.widgetDigitsSign = document.getElementById('widgetDigitsSign');
                this.widgetDigitsValue = document.getElementById('widgetDigitsValue');
                this.widgetDigitsProbe = document.getElementById('widgetDigitsProbe');
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

                // Текущий стиль
                this.timerStyle = 'circle';
                
                // Устанавливаем стиль по умолчанию
                if (this.circularWidget) {this.circularWidget.classList.add('active');}
                
                // Настраиваем масштабирование для digital и flip
                this.updateScaling();
                this._handlers.onResizeScaling = () => this.updateScaling();
                window.addEventListener('resize', this._handlers.onResizeScaling);
            }
            
            updateScaling() {
                const containerWidth = this.container.offsetWidth;
                const containerHeight = this.container.offsetHeight;
                
                const hasHours = this.wFlipHoursGroup && this.wFlipHoursGroup.style.display !== 'none';

                // Масштаб для flip (базовая ширина с запасом для возможного знака минуса:
                // карточка минуса 25px + margin 4px ≈ 30px + буфер)
                const baseFlipWidth = hasHours ? 420 : 320;
                const baseFlipHeight = 100;
                
                const scaleX = (containerWidth * 0.9) / baseFlipWidth;
                const scaleY = (containerHeight * 0.9) / baseFlipHeight;
                const flipScale = Math.min(scaleX, scaleY);
                
                this.container.style.setProperty('--flip-scale', flipScale);
                
                // Масштаб для аналоговых часов (базовый размер 150px)
                const baseAnalogSize = 150;
                const analogScaleX = (containerWidth * 0.85) / baseAnalogSize;
                const analogScaleY = (containerHeight * 0.85) / baseAnalogSize;
                const analogScale = Math.min(analogScaleX, analogScaleY);

                this.container.style.setProperty('--analog-scale', analogScale);

                // Цифры: кегль по замеру ЭТАЛОНА. Формула charCount * 0.6 выше
                // предполагает моноширинный шрифт и на шести шрифтах стиля
                // «Цифры» врёт от 0.42 до 0.78 em — поэтому здесь меряем.
                if (this.widgetDigitsTime && this._digitsFontsReady) {
                    const hasDigitsHours = Math.abs(Math.floor(this.remainingSeconds)) >= 3600;
                    // measureDigits() принимает ЯВНУЮ эталонную строку, не булев
                    // hasHours — выбор строки остаётся здесь, у потребителя.
                    const probeText = hasDigitsHours
                        ? window.DigitsStyle.PROBE_HOURS : window.DigitsStyle.PROBE_MINUTES;
                    const probe = window.DigitsStyle.measureDigits(
                        this.widgetDigitsProbe, this.digitsFont, probeText
                    );
                    if (probe) {
                        const size = window.DigitsStyle.fitFontSize({
                            availableWidth: containerWidth * 0.9,
                            availableHeight: containerHeight * 0.9,
                            probeWidth: probe.width,
                            probeHeight: probe.height,
                            signWidth: probe.signWidth
                        });
                        if (size > 0) {
                            this.widgetDigitsTime.style.setProperty('--digits-font-size', size + 'px');
                        }
                        // Вертикаль знака минуса — своя у каждого шрифта, см.
                        // measureSignShift(). Ставится здесь же, потому что
                        // считается по тем же метрикам и меняется вместе со
                        // шрифтом, а не со временем на табло.
                        this.widgetDigitsTime.style.setProperty(
                            '--digits-sign-shift',
                            window.DigitsStyle.measureSignShift(this.digitsFont)
                        );
                    }
                }
            }

            /**
             * Пересчитать раскладку под НОВЫЙ шрифт «Цифр» — дважды.
             *
             * Первый раз сразу, чтобы цифры не ждали сети (её здесь нет, но
             * woff2 всё равно читается с диска асинхронно), второй — когда шрифт
             * доехал. Без второго раза замер остаётся снятым с ЗАПАСНОГО
             * начертания: `document.fonts.ready` в окне разрешился один раз на
             * старте и о шрифте, выбранном позже, ничего не знал. Замер
             * 17.08.2026: сразу после переключения на Playfair Display вертикаль
             * знака мерилась по Georgia — 0.044 кегля вместо 0.094.
             */
            applyDigitsFont(fontId) {
                this.updateScaling();
                window.DigitsStyle.ensureFont(fontId).then(() => {
                    window.DigitsStyle.clearProbeCache();
                    this.updateScaling();
                });
            }

            initProgress() {
                this.progressBar.style.strokeDasharray = `${this.circumference}`;
                this.progressBar.style.strokeDashoffset = this.circumference;
            }

            setupEventListeners() {
                // Перетаскивание окна на JS вместо `-webkit-app-region: drag` —
                // общий механизм с окном часов, см. window-geometry.js (там же
                // объяснено, почему на Windows иначе нельзя).
                window.WindowGeometry.bindWindowDrag({
                    container: this.container,
                    doc: document,
                    // Замок «Закрепить положение»: окно перестаёт ездить за
                    // случайно задетой мышью. Предикат, а не проверка внутри
                    // модуля, — window-geometry.js проверяется в Node на
                    // внедрённых DOM и хранилище и о состоянии окна не знает.
                    isLocked: () => !!(window.UILock && window.UILock.isLocked()),
                    onMove: (delta) => ipcRenderer.send('widget-move', delta),
                    onDrop: () => this.saveGeometry(),
                    handlers: this._handlers
                });

                // Track window states for keyboard toggle shortcuts
                let _displayIsOpen = false;
                let _clockIsOpen = false;
                this._handlers.onDisplayWindowState = (_event, state) => {
                    _displayIsOpen = !!state.isOpen;
                };
                this._handlers.onClockWindowState = (_event, state) => {
                    _clockIsOpen = !!state.isOpen;
                };
                ipcRenderer.on('display-window-state', this._handlers.onDisplayWindowState);
                ipcRenderer.on('clock-window-state', this._handlers.onClockWindowState);

                // Keyboard shortcuts (Space, R, Escape, W, D, C)
                this._handlers.onKeyDown = (e) => {
                    if (e.ctrlKey || e.altKey || e.metaKey) { return; }
                    switch (e.code) {
                        case 'Space':
                            e.preventDefault();
                            if (widgetTimer.isRunning) {
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
                        case 'KeyW':
                            e.preventDefault();
                            ipcRenderer.send('close-widget');
                            break;
                        case 'KeyD':
                            e.preventDefault();
                            ipcRenderer.send(_displayIsOpen ? 'close-display' : 'open-display');
                            break;
                        case 'KeyC':
                            e.preventDefault();
                            ipcRenderer.send(_clockIsOpen ? 'close-clock-widget' : 'open-clock-widget');
                            break;
                        // Z: мастер-звук. Значение принадлежит ПАНЕЛИ (она же
                        // и играет), поэтому окно только просит — тем же
                        // приёмом, что и пресеты вида.
                        case 'KeyZ':
                            e.preventDefault();
                            ipcRenderer.send('sound-toggle');
                            break;
                    }

                    // 1-8: Quick timer presets (5, 10, 15, 20, 25, 30, 45, 60 minutes)
                    // Диапазон клавиш выводится ИЗ реестра, а не пишется числом.
                    // Прежде здесь стояло Digit8 при четырёх длительностях, и
                    // клавиши 5–8 слали `seconds: undefined` — движок приводит
                    // это к нулю, то есть НАЖАТИЕ СБРАСЫВАЛО ТАЙМЕР В 00:00.
                    // Панель этот же дефект у себя уже закрыла; окна остались.
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

                // Ctrl+Wheel scaling — resize widget by 10% per scroll tick
                const WIDGET_MIN_SCALE = window.WindowGeometry.MIN_SCALE_PCT;
                const WIDGET_MAX_SCALE = window.WindowGeometry.MAX_SCALE_PCT;
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
                        : Math.round(window.outerWidth / WIDGET_BASE_SIZE * 100);
                };
                this._handlers.onWheel = (e) => {
                    if (!e.ctrlKey) { return; }
                    // Замок «Закрепить положение» запрещает жест, но не
                    // настройку: масштаб по-прежнему меняется ползунком в
                    // панели (см. ui-lock.js).
                    if (window.UILock && window.UILock.isLocked()) { e.preventDefault(); return; }
                    e.preventDefault();
                    const step = window.CONFIG.SCALE_STEP;
                    // Ось берётся та, по которой пришло движение, а событие без
                    // движения не решает за пользователя. `e.deltaY < 0 ? … : …`
                    // относит НОЛЬ к «уменьшить» — на дисплее это сделало
                    // Shift+колесо односторонним (см. display-script.js).
                    const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                    if (!raw) { return; }
                    const delta = raw < 0 ? step : -step;
                    const cur = currentScalePct();
                    const newPct = window.RendererShared.clampScale(cur + delta, WIDGET_MIN_SCALE, WIDGET_MAX_SCALE);
                    if (newPct === cur) { return; }
                    // Масштаб от Ctrl+колеса раньше нигде не сохранялся, поэтому
                    // при следующем открытии виджет откатывался к 250px. Запись
                    // делает resizeToScale — он же выводит высоту из стиля.
                    this.resizeToScale(newPct);
                    // И сообщаем панели управления, чтобы её ползунок не врал.
                    ipcRenderer.send('report-scale', { source: 'widget', scalePct: newPct });
                };
                document.addEventListener('wheel', this._handlers.onWheel, { passive: false });
                this._handlers.onResizeScalePct = () => {
                    // Размер могли изменить не колесом, а ползунком «Масштаб» в
                    // панели или потянув за край окна — тогда saveGeometry никто
                    // не вызывал и размер терялся при переоткрытии.
                    //
                    // Решение «писать или не писать» принимает сам модуль, и
                    // принимает ПОСЛЕ того, как размер устоялся. Здесь его
                    // принимать нельзя: в момент события окно ещё прежнего
                    // размера, и раннее событие затирало восстановленную
                    // геометрию позицией открытия по умолчанию — замерено,
                    // см. saveSettled() в window-geometry.js.
                    this._geometry.saveSettled();
                };
                window.addEventListener('resize', this._handlers.onResizeScalePct);
            }

            setupSettings() {
                // Настройки управляются из главного окна
            }

            // setSize() с пресетами small/medium/large/xlarge удалён: единственным
            // вызовом был loadSettings(), который теперь восстанавливает реальную
            // геометрию, а UI для выбора пресета размера в приложении отсутствует.

            loadSettings() {
                // Настройки виджета
                const settings = localStorage.getItem('widgetSettings');
                if (settings) {
                    const s = safeJSONParse(settings, {});
                    if (s && s.opacity) {
                        this.container.style.opacity = s.opacity;
                    }
                }

                this.restoreGeometry();
            }

            // Размер и позиция виджета переживают перезапуск. Раньше здесь
            // безусловно вызывался setSize('medium'), из-за чего окно каждый раз
            // возвращалось к 250×250 в правый верхний угол, а масштаб от
            // Ctrl+колеса и результат перетаскивания терялись.
            //
            // Сама механика общая с окном часов — window-geometry.js. Здесь
            // остаются только ЧЕТЫРЕ различия между окнами: ключ хранилища,
            // базовый размер и пара каналов.
            restoreGeometry() {
                this._geometry.restore();
            }

            saveGeometry(scalePct) {
                this._geometry.save(scalePct);
            }

            saveSettings() {
                const settings = {
                    opacity: parseFloat(this.container.style.opacity) || 1
                };
                localStorage.setItem('widgetSettings', JSON.stringify(settings));
            }

            // FIX BUG-020: Removed checkColorChanges() - dead code
            // Colors are updated via the per-window 'widget-colors-update' IPC event, no polling needed


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
                // Владельцем дефолта остаётся CSS — ровно так уже работают часы
                // (electron-clock-widget.html:1168-1173) и полноэкранное окно.
                // Раньше здесь подставлялся захардкоженный #0a84ff, и он бил
                // инлайном ЛЮБОЕ правило CSS: обещанный зелёный --tw-led-green
                // у LED-цифр не срабатывал никогда, флип-цифры были синими
                // вместо --tw-fg, а секундная стрелка аналога — сине-зелёной
                // вместо своей красной. Три стиля из четырёх выглядели не так,
                // как описаны, и виджет расходился с двумя другими окнами.
                if (!colors) {
                    const saved = localStorage.getItem('timerColors');
                    colors = saved ? safeJSONParse(saved, null) : null;
                }
                // Пустой объект вместо выхода: у каждого цвета в панели своя
                // кнопка сброса, и сброс приходит сюда как ОТСУТСТВИЕ поля.
                // Ранний `return` делал сброс невозможным — снятый цвет
                // оставался на экране до перезапуска окна.
                colors = colors || {};

                // Валидация цветов
                // Проверка цвета одна на всё приложение: своя регулярка
                // `rgba?\([\d,.\s%]+\)` принимала любой набор цифр и запятых —
                // rgb(999,999,999) и rgba(1,2,3,77) проходили как безопасные,
                // а значение уходит прямо в style.color.
                const isSafeColor = window.SecurityUtils.isSafeColor;
                const timerColor = isSafeColor(colors.timer) ? colors.timer : null;
                const progressColor = isSafeColor(colors.progress) ? colors.progress : null;
                const root = document.documentElement;
                // Переменная либо ставится, либо УДАЛЯЕТСЯ: удаление возвращает
                // значение по умолчанию его владельцу — CSS.
                const setVar = (name, value) => {
                    if (value) { root.style.setProperty(name, value); }
                    else { root.style.removeProperty(name); }
                };

                // Подложка — одна пара «цвет + прозрачность» на окно, красит
                // подложку ТОГО стиля, который сейчас на экране: каждая
                // подложка в CSS записана как var(--surface-paint, <своё>).
                setVar('--surface-paint', window.RendererShared.surfacePaint({
                    color: colors.surface,
                    alpha: colors.surfaceAlpha
                }));
                // Тот же цвет без прозрачности — для перекидыша. Его карточка
                // это пластина, с которой створки берут свой фон, и прозрачной
                // ей быть нельзя: сквозь падающую створку стало бы видно и
                // цифру под ней, и рабочий стол.
                setVar('--surface-solid', window.RendererShared.surfaceSolid({
                    color: colors.surface
                }));
                // Прозрачность работает и БЕЗ выбранного цвета: подложка каждого
                // стиля вплетает эту переменную в свою собственную альфу, так что
                // ползунок гасит родной фон стиля, а не только заливку
                // пользователя. Отдельной переменной — потому что множитель нужен
                // именно CSS, где живут сами значения по умолчанию.
                const alphaValue = window.RendererShared.surfaceAlpha(colors.surfaceAlpha);
                setVar('--surface-alpha', alphaValue === null ? null : String(alphaValue));

                // Тон окна. Своего фона у виджета нет вовсе — он лежит поверх
                // чужого рабочего стола, — поэтому под цифрами оказывается либо
                // подложка стиля, которую задал пользователь, либо обои. Первое
                // можно измерить, второе нет: значит решает яркость подложки, а
                // когда её нет — тема. Палитра обоих тонов в surface-tones.css.
                this._surface = { color: colors.surface, alpha: colors.surfaceAlpha };
                this.refreshTone();

                // Circle style — стопы градиента красит КАСКАД: правила
                // #widgetGradient stop живут в <style>, а stop-color из CSS
                // сильнее презентационного атрибута. Раньше здесь стоял
                // setAttribute, и снять поставленный им цвет было нечем:
                // атрибут — не инлайновый стиль, removeProperty его не видит.
                setVar('--timer-color-stop', timerColor);
                setVar('--progress-color-stop', progressColor);
                // `--timer-glow` здесь больше не ставится: ни одно правило его
                // не читало. Ореолы снял редизайн 12.08.2026 (инвариант держит
                // tests/flat-surfaces.test.js), а запись пережила читателей —
                // и выглядела рабочим механизмом ровно до попытки ею
                // воспользоваться.

                // LED, «Цифры» и флип берут цвет темы из ОДНОЙ переменной.
                //
                // Раньше это были три отдельные ветки, каждая со своим
                // охранником `!dataset.status?.match(/danger|overtime/)` — они
                // существовали ровно потому, что инлайн бьёт правила полос и
                // применить цвет темы поверх полосы означало её стереть. С
                // переменной охранники не нужны: правило [data-status] сильнее
                // по специфичности и выигрывает само, независимо от того, в
                // каком порядке пришли обновление цвета и обновление полосы.
                //
                // Заодно ушла и гонка: applyColors и updateDisplay больше не
                // пишут в одно и то же свойство одного и того же элемента.
                setVar('--timer-color', timerColor);

                // Точки-разделители флипа — псевдоэлементы с фирменным
                // градиентом: цвет темы на них не распространяется, полосы
                // (warning/danger/overtime) рисуют правила [data-status].

                // Analog style
                const secondHand = document.getElementById('widgetHandSecond');
                const clockCenter = document.getElementById('widgetClockCenter');
                // Секундная стрелка отдана CSS. Раньше она красилась ТЕМ ЖЕ
                // градиентом, что и минутная: две стрелки становились
                // неразличимы по цвету, а CSS-правило с красной секундной было
                // мертво. Пустая строка удаляет инлайн, поставленный прошлой
                // версией в этом же профиле, и возвращает управление CSS.
                // (Раньше здесь упоминалась «ветка сброса ниже» с
                // _baseSecondHandBg — той ветки больше нет: полосу теперь
                // держит правило [data-status], снимать нечего.)
                if (secondHand) { secondHand.style.background = ''; }
                // Центр и цифры аналога красятся ПЕРЕМЕННЫМИ, а не инлайном.
                // Инлайн на элементе бьёт правила [data-status], поэтому раньше
                // полосе приходилось писать свой цвет тоже инлайном, а при
                // выходе из полосы — восстанавливать сохранённый в _base*.
                // Переменная живёт на documentElement и служит лишь ЗАПАСНЫМ
                // значением, которое правило полосы перекрывает каскадом.
                setVar('--timer-center-bg', timerColor
                    ? `linear-gradient(145deg, ${timerColor}, ${progressColor || timerColor})`
                    : null);
                if (clockCenter) { clockCenter.style.boxShadow = ''; }
                // Альфа b3 давала 2.95:1 при кегле 14px. Цвет и так вторичен по
                // кеглю и положению — приглушать его ещё и прозрачностью незачем.
                setVar('--timer-analog-color', timerColor);
                // Свечение — тоже переменной. Инлайновый text-shadow бил бы
                // text-shadow правила [data-status="danger"] ровно так же, как
                // это делал инлайновый color: в перерасходе цифры стали бы
                // красными, а ореол вокруг них остался бы цвета темы.
                setVar('--timer-analog-glow', timerColor ? `${timerColor}4d` : null);
            }

            /**
             * Подложки у виджета больше нет.
             *
             * Редизайн 2026-08-12: на любом фоне читаются только цифры, тонкая
             * дуга и мягкая тень. Прежняя версия заливала круг ИНЛАЙНОМ —
             * `bgCircle.style.fill = …` — и это било правило `.bg-circle { fill:
             * none }`: снимок съёмки показал подложку на месте, хотя CSS её
             * снял. Инлайн бьёт любое правило, ровно как уже было с цветом цифр.
             *
             * Заливка вдобавок приходила из настроек фона ДИСПЛЕЯ: своего
             * контрола «фон виджета» в панели нет вообще, то есть подложка была
             * ещё и чужой.
             *
             * Метод оставлен, а не удалён: его зовут два обработчика настроек, и
             * пустое тело здесь честнее, чем правка обоих ради того же нуля.
             * Фоновая КАРТИНКА снята вместе с заливкой — она была той же
             * подложкой, только растровой.
             */
            applyBackground() {
                const bgCircle = document.querySelector('.bg-circle');
                const bgImageContainer = document.getElementById('widgetBgImage');
                if (bgCircle) { bgCircle.style.removeProperty('fill'); }
                if (bgImageContainer) { bgImageContainer.style.display = 'none'; }
            }

            loadBackgroundSettings() {
                // Не молчать при выходе. Из-за молчания здесь «фон не
                // применялся никогда» жил незамеченным, а в режиме съёмки —
                // где окна читают хранилище раньше, чем панель туда пишет, —
                // круг виджета оставался с CSS-дефолтом, и кадр расходился с
                // эталоном при полностью исправном приложении. Консоль
                // рендерера уезжает в общий лог (bindRenderConsole).
                const bgSettings = localStorage.getItem('displayExtSettings');
                if (!bgSettings) {
                    console.info('[widget] настройки не применены: ключа displayExtSettings нет (первый запуск или чистый профиль)');
                    return;
                }
                const settings = safeJSONParse(bgSettings, {});

                if (!settings || Object.keys(settings).length === 0) {
                    console.warn(
                        '[widget] настройки не применены: displayExtSettings есть, но разобрался '
                        + `в пустой объект (${bgSettings.length} байт). Настройки испорчены?`
                    );
                    return;
                }
                // Виджет всегда прозрачный — картинки только на полноэкранном дисплее
                if (settings.bgMode === 'local') {
                    settings.bgMode = 'default';
                }

                this.applyBackground(settings);

                // Стиль виджета — под СВОИМ именем. Общее `timerStyle`
                // в этом наборе тоже принадлежит виджету (его пишет
                // alsoWrite ради отката версии), но то же самое имя в
                // IPC-пакете display-settings-update означает уже стиль
                // ПОЛНОЭКРАННОГО режима. Спрашиваем своё имя первым,
                // общее держим запасным — см. RendererShared.pickOwnSetting.
                const ownStyle = window.RendererShared.pickOwnSetting(settings, 'widgetTimerStyle', 'timerStyle');
                if (ownStyle) {
                    this.setTimerStyle(ownStyle);
                }

                // Шрифт стиля «Цифры» — своё имя внутри displayExtSettings,
                // тем же путём, каким приходит widgetTimerStyle. У шрифта нет
                // локального источника изменений (только панель), поэтому
                // отдельного ключа в localStorage у него нет.
                if (settings.widgetDigitsFont !== undefined) {
                    const font = window.DigitsStyle.applyFont(this.widgetDigitsTime, settings.widgetDigitsFont);
                    if (font.id !== this.digitsFont) {
                        this.digitsFont = font.id;
                        this.applyDigitsFont(font.id);
                    }
                }
            }

            setupIPC() {
                ipcRenderer.send('get-timer-state');

                // Сохраняем ссылки на обработчики для последующей очистки
                this.timerStateHandler = (event, state) => {
                    // FIX: Use monotonic updateCounter instead of timestamp for dedup
                    const updateCounter = state.updateCounter || 0;
                    if (updateCounter > 0 && updateCounter <= this.lastUpdateCounter) {return;}
                    this.lastUpdateCounter = updateCounter;
                    this.lastTimestamp = state.timestamp || Date.now();

                    this.totalSeconds = Number(state.totalSeconds) || 0;
                    this.remainingSeconds = Number(state.remainingSeconds) || 0;
                    this.isRunning = !!state.isRunning;
                    this.isPaused = !!state.isPaused;
                    // Виджет раньше вообще не читал `finished` из состояния и
                    // выводил статус завершения по косвенному признаку — из-за
                    // этого он мог расходиться с панелью управления.
                    this.finished = !!state.finished;

                    this.updateDisplay();
                };

                this.colorsUpdateHandler = (event, colors) => {
                    this.applyColors(colors);
                };

                this.displaySettingsUpdateHandler = (event, settings) => {
                    // Виджет всегда прозрачный — фоновые картинки только на полноэкранном дисплее
                    const widgetSettings = { ...settings };
                    if (widgetSettings.bgMode === 'local') {
                        widgetSettings.bgMode = 'default';
                    }
                    this.applyBackground(widgetSettings);
                    // Стиль отсюда НЕ берём. `timerStyle` в этом сообщении —
                    // стиль ПОЛНОЭКРАННОГО режима (см. pushDisplaySettings в
                    // electron-control.html), а не виджета. Прежний fallback
                    // срабатывал, пока не пришёл widget-style-update, и молча
                    // навязывал виджету чужой стиль — у окна, открытого из трея,
                    // флаг _hasWidgetStyle оставался false, и любая правка во
                    // вкладке «Полноэкранный» перерисовывала виджет.
                    // Ровно эту же ветку уже убрали в часах (electron-clock-widget.html).
                    // Показ цифр на аналоговом циферблате
                    if (settings.showAnalogNumbers !== undefined && this.widgetClockNumbers) {
                        this.widgetClockNumbers.classList.toggle('visible', settings.showAnalogNumbers);
                    }
                };

                this.widgetStyleUpdateHandler = (event, settings) => {
                    // Подпись состояния. По умолчанию СКРЫТА: состояние уже несёт
                    // цвет дуги, а на маленьком виджете слово занимает место,
                    // которого нет. Класс на <body>, а не инлайн на элементе:
                    // видимостью в этом проекте распоряжается каскад.
                    if (settings.statusLabel !== undefined) {
                        document.body.classList.toggle('status-label-on', !!settings.statusLabel);
                    }
                    if (settings.timerStyle) {
                        this._hasWidgetStyle = true;
                        this.setTimerStyle(settings.timerStyle);
                    }
                    if (settings.digitsFont !== undefined) {
                        const font = window.DigitsStyle.applyFont(this.widgetDigitsTime, settings.digitsFont);
                        if (font.id !== this.digitsFont) {
                            this.digitsFont = font.id;
                            this.applyDigitsFont(font.id);
                        }
                    }
                    // Панель управления повторно шлёт timerScale и при смене стиля,
                    // и один раз при своей загрузке. Применяем только реальное
                    // изменение ползунка — иначе эти «фоновые» посылки затирают
                    // масштаб, восстановленный из widgetGeometry или выставленный
                    // Ctrl+колесом прямо на виджете.
                    if (settings.timerScale !== undefined) {
                        const incoming = parseInt(settings.timerScale, 10);
                        if (Number.isFinite(incoming) && incoming !== this._lastPushedTimerScale) {
                            if (this._lastPushedTimerScale !== undefined) {
                                this.resizeToScale(incoming);
                            }
                            this._lastPushedTimerScale = incoming;
                        }
                    }
                };

                // Границы окна от ГЛАВНОГО процесса — источник для записи
                // геометрии. Свои outerWidth/screenX остаются запасным путём,
                // см. window-geometry.js.
                this._handlers.onWindowGeometry = (event, bounds) => {
                    this._geometry.setWindowBounds(bounds);
                };
                ipcRenderer.on('window-geometry', this._handlers.onWindowGeometry);

                // Регистрируем обработчики
                ipcRenderer.on('timer-state', this.timerStateHandler);
                ipcRenderer.on('widget-colors-update', this.colorsUpdateHandler);
                ipcRenderer.on('display-settings-update', this.displaySettingsUpdateHandler);
                ipcRenderer.on('widget-style-update', this.widgetStyleUpdateHandler);
            }

            cleanup() {
                // Удаляем IPC listeners
                if (this.timerStateHandler) {
                    ipcRenderer.removeListener('timer-state', this.timerStateHandler);
                }
                if (this.colorsUpdateHandler) {
                    ipcRenderer.removeListener('widget-colors-update', this.colorsUpdateHandler);
                }
                if (this.displaySettingsUpdateHandler) {
                    ipcRenderer.removeListener('display-settings-update', this.displaySettingsUpdateHandler);
                }
                if (this.widgetStyleUpdateHandler) {
                    ipcRenderer.removeListener('widget-style-update', this.widgetStyleUpdateHandler);
                }

                // Отложенная запись геометрии не должна сработать после того,
                // как окно закрыли: тот же принцип, что у FlipCard.cancelPending().
                if (this._geometry) { this._geometry.cancelPendingSave(); }

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
                if (h.onDisplayWindowState) {
                    ipcRenderer.removeListener('display-window-state', h.onDisplayWindowState);
                }
                if (h.onClockWindowState) {
                    ipcRenderer.removeListener('clock-window-state', h.onClockWindowState);
                }
                if (h.onWindowGeometry) {
                    ipcRenderer.removeListener('window-geometry', h.onWindowGeometry);
                }
                this._handlers = {};

                // Очищаем интервал обновления
                if (this.updateInterval) {
                    clearInterval(this.updateInterval);
                    this.updateInterval = null;
                }

                // Очищаем mouseTimeout
                if (this.mouseTimeout) {
                    clearTimeout(this.mouseTimeout);
                    this.mouseTimeout = null;
                }
                if (this._scalingTimer) {
                    clearTimeout(this._scalingTimer);
                    this._scalingTimer = null;
                }
                window.FlipCard.cancelPending();
            }
            
            /**
             * Высота окна для заданной ширины. Окно квадратное при ЛЮБОМ стиле.
             *
             * Полоса была только у LED, а он слит с «Цифрами»: у объединённого
             * стиля рамка обнимает цифры сама, и подстраивать под неё форму
             * окна больше незачем. Метод оставлен одним владельцем размера —
             * прежде он собирался в трёх местах отдельно (Ctrl+колесо, ползунок
             * панели, восстановление геометрии), и копии разошлись.
             */
            windowHeightFor(width) {
                return width;
            }

            /** Меняет масштаб окна: ширину задаёт процент, высоту — стиль. */
            resizeToScale(pct) {
                // Пол ширины учитываем ЗДЕСЬ, а не полагаемся на поджатие в
                // главном процессе: оно правит ширину уже после того, как
                // высота посчитана, и пропорция полосы разъезжается — замерено
                // зондом на 30 %: окно 120×28 при рамке 70 px, то есть рамка
                // переставала заполнять полосу.
                const width = Math.max(
                    window.CONFIG.WIDGET_MIN_WIDTH,
                    Math.round(WIDGET_BASE_SIZE * pct / 100)
                );
                ipcRenderer.send('widget-resize', { width, height: this.windowHeightFor(width) });
                this.saveGeometry(pct);
            }

            setTimerStyle(style) {
                // Стиль больше НЕ трогает форму окна. Полоса была только у LED,
                // а его больше нет; навязывать форму на каждой смене стиля
                // нельзя — окно растягивают за край рамки, и переключение
                // «Флип» → «Цифры» схлопывало бы растянутое обратно (поймано
                // визуальной сверкой: кадры уехали с 320×260 на 320×320).
                this.timerStyle = window.RendererShared.migrateTimerStyle(style);
                style = this.timerStyle;
                
                // Скрываем все стили
                if (this.circularWidget) {this.circularWidget.classList.remove('active');}
                if (this.widgetFlip) {this.widgetFlip.classList.remove('active');}
                if (this.widgetAnalog) {this.widgetAnalog.classList.remove('active');}
                if (this.widgetDigits) {this.widgetDigits.classList.remove('active');}

                // Показываем выбранный
                switch (style) {
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
                        if (this.widgetDigits) {this.widgetDigits.classList.add('active');}
                        break;
                }
                

                // Обновляем масштабирование после смены стиля
                if (this._scalingTimer) { clearTimeout(this._scalingTimer); }
                this._scalingTimer = setTimeout(() => {
                    this._scalingTimer = null;
                    this.updateScaling();
                }, 50);

                this.updateDisplay();
            }

            updateDisplay() {
                const secs = Math.floor(this.remainingSeconds);
                const formatted = this.formatTime(secs);

                // Circle: split sign and digits — цифры остаются в центре даже в минусе
                if (this.timeDisplaySign && this.timeDisplayDigits) {
                    this.timeDisplaySign.textContent = secs < 0 ? '−' : '';
                    this.timeDisplayDigits.textContent = this.formatTime(Math.abs(secs));
                } else {
                    this.timeDisplay.textContent = formatted;
                }
                
                // Обновляем цифровой стиль

                // Цифры: знак и цифры — РАЗНЫЕ узлы, знак вне потока.
                if (this.widgetDigitsValue) {
                    this.widgetDigitsSign.textContent = secs < 0 ? '−' : '';
                    this.widgetDigitsValue.textContent = this.formatTime(Math.abs(secs));
                    const nowHours = Math.abs(secs) >= 3600;
                    if (this._digitsHadHours !== nowHours) {
                        this._digitsHadHours = nowHours;
                        // Строка стала длиннее или короче: «Цифрам» это меняет
                        // кегль, полосе LED — ещё и высоту окна.
                        //
                        // ТОЛЬКО для LED. Прочие стили тоже имеют форму
                        // (квадрат), но навязывать её здесь нельзя: окно
                        // растягивают и за край рамки, а переход через час
                        // тогда молча схлопывал бы растянутое обратно в
                        // квадрат — поймано визуальной сверкой, кадры
                        // hours-h1-circle/digits/flip уехали с 320×260 на
                        // 320×320. Форму НЕ-LED стилей возвращает смена стиля,
                        // и только она.
                        this.updateScaling();
                    }
                }

                // Обновляем перекидные часы
                this.updateFlipDisplay(secs);
                
                // Обновляем аналоговые часы
                this.updateAnalogDisplay(secs);

                // Обновляем прогресс (для кругового)
                if (this.totalSeconds > 0) {
                    const ratio = Math.max(0, Math.min(1, this.remainingSeconds / this.totalSeconds));
                    const offset = this.circumference - (ratio * this.circumference);
                    this.progressBar.style.strokeDashoffset = offset;
                } else {
                    this.progressBar.style.strokeDashoffset = this.circumference;
                }

                // Status detection — always runs, not gated by totalSeconds
                // Полоса срочности — общая для всех окон (RendererShared).
                const status = window.RendererShared.timerColorBand(secs, this.totalSeconds);

                // Apply status to all elements
                this.progressBar.dataset.status = status;
                this.timeDisplay.dataset.status = status;

                // Круг цвет полосы НЕ пишет: его задают правила
                // `.time-display[data-status="…"]` выше по файлу, и берут они
                // токены полос (`--tw-band-warning` / `--tw-band-danger`),
                // которые следуют тону окна. Достаточно выставленного строкой
                // выше data-status.
                //
                // Здесь стоял инлайновый ладдер, и он был не просто лишним —
                // он был источником бага. Ветка возврата в норму снимала цвет
                // (`style.color = ''`), но свечение возвращала только под
                // условием `if (this._baseTimerColor)`, БЕЗ завершающего else.
                // А _baseTimerColor заполняется исключительно в applyColors(),
                // которая выходит раньше, когда в localStorage нет `timerColors`
                // — то есть на свежей установке ветки сброса не существовало.
                // Замерено: после выхода из danger отрисовывалось
                // `rgba(255,68,68,0.8) 0 0 20px` на цифрах нормального цвета,
                // и держалось до перезапуска. e2e/color-band-reset.spec.js.

                // LED и «Цифры» цвет полосы не пишут — его задают правила
                // [data-status] в CSS. Значения сверялись при удалении ладдера
                // и с 18.08.2026 не литералы вовсе: полосы объявлены ссылками
                // на акценты палитры и потому следуют тону окна, чего
                // инлайновый ладдер не умел в принципе.
                if (this.widgetDigitsTime) {
                    this.widgetDigitsTime.dataset.status = status;
                }

                // Обновляем статус
                this.updateStatus(secs);

                // Класс для контейнера
                // Класс timer-running здесь больше не навешивается: ни одно правило
                // CSS в этом окне его не использовало, то есть это была запись в DOM
                // на каждом тике впустую. Статус виджета показывает .status-badge,
                // цвета — data-status на самих элементах.
            }
            
            // Перекидывание одной карточки. Общая реализация — flip-card.js.
            // Незавершённые таймеры модуль ведёт сам, гасим их одним
            // FlipCard.cancelPending() в cleanup().
            _flip(card, value) {
                window.FlipCard.flipCardTo(card, '.widget-flip-digit', value);
            }

            updateFlipDisplay(secs) {
                if (!this.wFlipMin1 || !this.wFlipMin2 || !this.wFlipSec1 || !this.wFlipSec2) {return;}
                
                const isNegative = secs < 0;
                const absSecs = Math.abs(secs);
                const cells = window.RendererShared.flipCells(absSecs, this.totalSeconds);

                // Показываем/скрываем знак минуса
                if (this.wFlipMinus) {
                    this.wFlipMinus.classList.toggle('visible', isNegative);
                }

                // Показываем/скрываем часы в зависимости от общего времени
                const showHours = cells.hasHours;

                // Добавляем/удаляем класс для адаптивных размеров
                if (this.widgetFlip) {
                    this.widgetFlip.classList.toggle('has-hours', showHours);
                }

                if (this.wFlipHoursGroup && this.wFlipHoursSep) {
                    this.wFlipHoursGroup.style.display = showHours ? 'flex' : 'none';
                    this.wFlipHoursSep.style.display = showHours ? 'flex' : 'none';

                    if (showHours && this.wFlipHr1 && this.wFlipHr2) {
                        this._flip(this.wFlipHr1, cells.h1);
                        this._flip(this.wFlipHr2, cells.h2);
                    }
                }

                // Обновляем цифры
                this._flip(this.wFlipMin1, cells.m1);
                this._flip(this.wFlipMin2, cells.m2);
                this._flip(this.wFlipSec1, cells.s1);
                this._flip(this.wFlipSec2, cells.s2);
                
                // Классы предупреждения
                // FIX BUG-018: Use data attributes instead of classList
                const flipCards = [this.wFlipMin1, this.wFlipMin2, this.wFlipSec1, this.wFlipSec2];
                if (showHours && this.wFlipHr1 && this.wFlipHr2) {
                    flipCards.push(this.wFlipHr1, this.wFlipHr2);
                }

                // Полоса срочности — общая для всех окон (RendererShared).
                const status = window.RendererShared.timerColorBand(secs, this.totalSeconds);

                // Карточке достаточно data-status: цвет цифры задают правила
                // `.widget-flip-card[data-status=…] .widget-flip-digit`, и они
                // берут токены полос — те же значения, что стояли в удалённом
                // отсюда инлайновом ладдере, но следующие тону окна.
                flipCards.forEach(card => {
                    card.dataset.status = status;
                });

                // Мигание перерасхода живёт на контейнере (см. правило
                // `.widget-flip-content[data-status]`): у карточек и знака минуса
                // фаза общая только тогда, когда анимация одна на всех.
                if (this.wFlipContent) {
                    this.wFlipContent.dataset.status = status;
                }

                // Separator dots are painted by ::before/::after backgrounds, so
                // color/background on the element itself is ignored — we drive
                // them through data-status and matching CSS rules instead.
                document.querySelectorAll('.widget-flip-separator').forEach(el => {
                    if (status === 'danger' || status === 'overtime' || status === 'warning') {
                        el.dataset.status = status;
                    } else if (el.dataset.status) {
                        delete el.dataset.status;
                    }
                });
            }

            updateAnalogDisplay(secs) {
                if (!this.widgetHandMinute || !this.widgetHandSecond) {return;}

                const absSecs = Math.abs(secs);
                const totalMins = absSecs / 60;
                const seconds = absSecs % 60;

                // Минутная стрелка - полный оборот за 60 минут
                const minuteDeg = (totalMins / 60) * 360;
                this.widgetHandMinute.style.transform = `rotate(${minuteDeg}deg)`;

                // Секундная стрелка - полный оборот за 60 секунд
                const secondDeg = (seconds / 60) * 360;
                this.widgetHandSecond.style.transform = `rotate(${secondDeg}deg)`;

                // Часовая — полный оборот за 12 часов. Формула строго как в
                // display-script.js, где она уже работает. Проверка на null
                // отдельная: расширять ранний выход выше нельзя, иначе старый
                // профиль без этого элемента заблокировал бы весь аналоговый
                // рендер.
                if (this.widgetHandHour) {
                    this.widgetHandHour.style.transform = `rotate(${((absSecs / 3600) % 12) * 30}deg)`;
                }

                // Обновляем цифровое время
                if (this.widgetAnalogDigital) {
                    const { hours, minutes: mins } = window.RendererShared.breakdown(absSecs);
                    const prefix = secs < 0 ? '-' : '';
                    if (hours > 0) {
                        this.widgetAnalogDigital.textContent = `${prefix}${hours}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    } else {
                        this.widgetAnalogDigital.textContent = `${prefix}${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    }
                }

                // FIX BUG-018: Use data attributes instead of classList
                const analogElements = [this.widgetHandHour, this.widgetHandMinute, this.widgetHandSecond, this.widgetClockCenter, this.widgetAnalogDigital];

                // Полоса срочности — общая для всех окон (RendererShared).
                const status = window.RendererShared.timerColorBand(secs, this.totalSeconds);

                analogElements.forEach(el => {
                    if (el) { el.dataset.status = status; }
                });

                // Цвет полосы здесь больше не пишется. Стрелка, центр и цифры
                // аналога красятся правилами [data-status] выше по файлу, а
                // цвет темы приходит переменными (--timer-center-bg,
                // --timer-analog-color, --timer-analog-glow), которые эти
                // правила перекрывают каскадом. Восстанавливать при выходе из
                // полосы нечего — вместе с ладдером ушли и поля
                // _baseSecondHandBg / _baseCenterBg / _baseAnalogDigitalColor.
            }

            // Приоритеты статуса — общие для всех трёх окон, живут в
            // RendererShared.timerLifecycleStatus(). Здесь остаётся только
            // раскладка ключа в подпись и CSS-класс этого окна.
            updateStatus(secs) {
                const STATUS_TEXT = {
                    paused: 'Пауза',
                    overtime: 'Перерасход',
                    finished: 'Завершён',
                    running: 'Активен',
                    idle: 'Готов'
                };
                const status = window.RendererShared.timerLifecycleStatus({
                    remainingSeconds: secs,
                    totalSeconds: this.totalSeconds,
                    isRunning: this.isRunning,
                    isPaused: this.isPaused,
                    finished: this.finished
                });
                this.statusBadge.classList.remove('running', 'paused', 'finished', 'overtime');
                if (status !== 'idle') { this.statusBadge.classList.add(status); }
                this.statusBadge.textContent = STATUS_TEXT[status];
            }

            formatTime(seconds) {
                return window.TimeUtils.formatTimeShort(seconds);
            }
        }

        // Show hint on first open or after hint update (v2 = added wheel info)
        if (localStorage.getItem('widgetHintShown') === 'v2') {
            const h = document.getElementById('widgetHint');
            if (h) { h.style.display = 'none'; }
        } else {
            localStorage.setItem('widgetHintShown', 'v2');
        }

        // На window — чтобы до окна дотянулся слушатель темы, который стоит
        // ОТДЕЛЬНЫМ <script> после ipc-compat.js и в эту область не заглядывает.
        const widgetTimer = new WidgetTimer();
        window.timerWidget = widgetTimer;

        // Cleanup при закрытии окна
        window.addEventListener('beforeunload', () => {
            widgetTimer.cleanup();
        });
