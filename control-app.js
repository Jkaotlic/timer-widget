/*
 * control-app.js — TimerController панели управления и её запуск.
 *
 * Код страницы electron-control.html, до 25.09.2026 — её inline-<script>.
 * Вынесен целиком, без правок, ради CSP `script-src 'self'` (без хешей и
 * 'unsafe-inline'). Это classic script, НЕ модуль и НЕ strict: имена верхнего
 * уровня общие со всеми остальными <script> страницы, как и были.
 * Самодостаточный блок, который трогаете, — выносите в свой модуль (CLAUDE.md).
 *
 * Отступ в 8 пробелов — от HTML, и оставлен намеренно: source-level тесты
 * режут код по отступу (`\n {16}\};`), и сдвиг отступа молча сдвинул бы их
 * срезы. Тесты читают окно через tests/helpers/window-source.js.
 */
        // ipcRenderer теперь доступен через ipc-compat.js (безопасно)

        // debounce: используем из utils.js (TimeUtils), иначе — встроенный fallback
        // Нельзя использовать const/let — utils.js уже определяет function debounce в глобальной области
        if (typeof debounce === 'undefined') {
            var debounce = (window.TimeUtils && window.TimeUtils.debounce)
                ? window.TimeUtils.debounce
                : (fn, delay = (window.CONFIG && CONFIG.DEBOUNCE_DELAY) || 120) => {
                    let timeoutId;
                    return (...args) => {
                        clearTimeout(timeoutId);
                        timeoutId = setTimeout(() => fn(...args), delay);
                    };
                };
        }

        // Обе величины — из реестра, а не литералами: масштаб «как при открытии»
        // (ползунки говорят процентами, CONFIG.DEFAULT_SCALE хранит долю) и
        // базовый размер окна часов, который панель дважды считала по числу 220.
        const DEFAULT_SCALE_PCT = Math.round(window.CONFIG.DEFAULT_SCALE * 100);
        const CLOCK_BASE_PX = window.CONFIG.CLOCK_WIDGET_DEFAULT_SIZE;

        class TimerController {
            constructor() {
                this.totalSeconds = 0;
                this.remainingSeconds = 0;
                this.isRunning = false;
                this.isPaused = false;
                this.lastTimestamp = 0;
                this.soundEnabled = true; // overwritten by initTabs()
                // Ручной ввод — состояние панели, а не поле сбоку.
                this.inputMode = false;
                this.lastUpdateCounter = -1;
                this.wasFinished = false;
                this.currentBgMode = 'theme';
                // Stored handler refs for cleanup
                this._handlers = {};

                // FIX BUG-023: Track active theme button to avoid querySelectorAll
                this.activeThemeButton = null;

                // Стартовые цвета панели. Здесь стояла пара #667eea/#764ba2 —
                // фиолетовая, которой нет в наборе токенов вообще: наследство
                // первой версии. Именно она уходила в widgetColors при первом
                // же изменении настроек, то есть окна красились цветом, не
                // принадлежащим палитре приложения.
                this.currentColors = {
                    timer: window.CONFIG.DEFAULT_TIMER_COLORS.timer,
                    progress: window.CONFIG.DEFAULT_TIMER_COLORS.progress,
                    bg: '#0f0c29'
                };

                // Списки звуков строятся ДО чтения настроек: applyStoredSettings
                // ставит select.value, а значение без <option> браузер молча
                // отбрасывает — выбранный звук превратился бы в «— без звука —».
                window.SoundPresets.buildSoundSelects(document);
                this.initElements();
                this.initTabs();
                this.initThemes();
                this.attachEvents();
                this.loadSettings();
                this.loadClockSettings();
                this.setupIPC();
                
                // Авто-размер при загрузке
                setTimeout(() => this.autoResizeWindow(), 100);
                
                // Отправляем текущие настройки для синхронизации
                setTimeout(() => {
                    this.pushDisplaySettings();
                    this.pushClockSettings();
                }, 200);
            }

            initElements() {
                this.controlTimeEl = document.getElementById('controlTime');
                this.controlHeroLabelEl = document.getElementById('controlHeroLabel');
                this.controlTimeSignEl = document.getElementById('controlTimeSign');
                this.controlTimeDigitsEl = document.getElementById('controlTimeDigits');
                this.statusDot = document.getElementById('statusDot');
                this.statusText = document.getElementById('statusText');
                this.startBtn = document.getElementById('startBtn');
                this.pauseBtn = document.getElementById('pauseBtn');
                this.resetBtn = document.getElementById('resetBtn');
                // customMinutes / customSeconds убраны вместе со старым вводом
                // «минуты + секунды»: поля жили в блоке display:none и были
                // недостижимы. Точное время вводится прямо в крупных цифрах:
                // клик по #controlTime → поля #manualHours / #manualMinutes /
                // #manualSeconds (panel-state.js).

                // Настройки
                this.allowNegativeEl = document.getElementById('allowNegative');
                this.soundMasterEl = document.getElementById('soundMasterEnabled');
                this.soundStartEl = document.getElementById('soundStartEnabled');
                this.soundEndEl = document.getElementById('soundEndEnabled');
                this.soundMinuteEl = document.getElementById('soundMinuteEnabled');
                this.soundOverrunEl = document.getElementById('soundOverrunEnabled');
                this.overrunIntervalEl = document.getElementById('overrunIntervalMinutes');
                
                // Настройки полноэкранного режима
                this.displaySelectEl = document.getElementById('displaySelect');
                this.eventTimeInputEl = document.getElementById('eventTimeInput');
                this.eventTitleInputEl = document.getElementById('eventTitleInput');
                this.endTimeInputEl = document.getElementById('endTimeInput');
                this.timeBlocksScaleEl = document.getElementById('timeBlocksScale');
                this.timeBlocksScaleValueEl = document.getElementById('timeBlocksScaleValue');
                this.timerStyleEl = document.getElementById('timerStyle');
                this._attachSegmented(this.timerStyleEl, 'circle');
                this.clockShowTicksEl = document.getElementById('clockShowTicks');
                // Два тумблера редизайна. Проводка одинаковая: записать и
                // отправить ВЕСЬ payload стиля — он собирается в одном месте,
                // поэтому новое поле уезжает само.
                this.widgetStatusLabelEl = document.getElementById('widgetStatusLabel');
                this.widgetAlwaysOnTopEl = document.getElementById('widgetAlwaysOnTop');
                for (const el of [this.widgetStatusLabelEl, this.widgetAlwaysOnTopEl]) {
                    el?.addEventListener('change', () => {
                        ipcRenderer.send('widget-style-update', this.widgetStylePayload());
                        this.saveExtSettings();
                    });
                }
                if (this.clockShowTicksEl) {
                    // Деления принадлежат ЧАСАМ и только им. Раньше это была одна
                    // настройка на два циферблата, и жила она во вкладке виджета:
                    // у кольца обратного отсчёта засечки только шумели, а к
                    // делениям часов можно было добраться лишь через чужую вкладку.
                    this.clockShowTicksEl.checked = localStorage.getItem('clockShowTicks') === 'true';
                    this.clockShowTicksEl.addEventListener('change', () => {
                        localStorage.setItem('clockShowTicks', this.clockShowTicksEl.checked);
                        this.pushClockSettings();
                    });
                }
                this.timerScaleEl = document.getElementById('timerScale');
                this.timerScaleValueEl = document.getElementById('timerScaleValue');

                // Display-specific style/scale (Полноэкранный tab)
                this.displayTimerStyleEl = document.getElementById('displayTimerStyle');
                this._attachSegmented(this.displayTimerStyleEl, 'circle');
                this.displayTimerScaleEl = document.getElementById('displayTimerScale');
                this.displayTimerScaleValueEl = document.getElementById('displayTimerScaleValue');

                // Настройки виджета часов
                this.syncClockStyleEl = document.getElementById('syncClockStyle');
                this.clockStyleEl = document.getElementById('clockStyle');
                this._attachSegmented(this.clockStyleEl, 'circle');
                this.clockAnalogNumbersRowEl = document.getElementById('clockAnalogNumbersRow');
                this.clockShowAnalogNumbersEl = document.getElementById('clockShowAnalogNumbers');
                this.clockShowDateEl = document.getElementById('clockShowDate');
                this.clockShowTimezoneEl = document.getElementById('clockShowTimezone');
                this.clockShowSecondsEl = document.getElementById('clockShowSeconds');
                this.clockFormat24hEl = document.getElementById('clockFormat24h');

                // Шрифт стиля «Цифры» — свой список на каждое окно (Task 7).
                this.widgetDigitsFontEl = document.getElementById('widgetDigitsFont');
                this.clockDigitsFontEl = document.getElementById('clockDigitsFont');
                this.displayDigitsFontEl = document.getElementById('displayDigitsFont');
                // attachFontSelect — в font-select.js, не здесь (лимит строк).
                attachFontSelect(this.widgetDigitsFontEl);
                attachFontSelect(this.clockDigitsFontEl);
                attachFontSelect(this.displayDigitsFontEl);
                this.widgetDigitsFontRowEl = document.getElementById('widgetDigitsFontRow');
                this.clockDigitsFontRowEl = document.getElementById('clockDigitsFontRow');
                this.displayDigitsFontRowEl = document.getElementById('displayDigitsFontRow');

                // Синхронизация стиля часов. ВЫКЛЮЧЕНА по умолчанию — то же
                // значение стоит строкой в settings-schema.js.
                this.syncClockStyle = false;
            }

            initSettingsDrawer() {
                this.settingsDrawerEl = document.getElementById('settingsDrawer');
                this.drawerTitleEl = document.getElementById('drawerTitle');
                this.drawerBodyEl = document.getElementById('drawerBody');
                this.drawerCloseBtn = document.getElementById('drawerClose');
                this._currentDrawerTab = null;
                this._drawerExtraWidth = 336; // 320 drawer + 16 gap

                // Move tab-content elements from main panel into drawer body.
                // Keep tabs-row buttons in their original spot for triggering.
                if (this.drawerBodyEl) {
                    document.querySelectorAll('.advanced-settings .tab-content').forEach(tc => {
                        this.drawerBodyEl.appendChild(tc);
                        tc.classList.remove('active');
                    });
                }
                // Initial state: drawer closed, no tab active
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

                if (this.drawerCloseBtn) {
                    this.drawerCloseBtn.addEventListener('click', () => this.closeSettingsDrawer());
                    // «‹» ведёт туда же: список окон — это и есть то, из
                    // чего ящик открыли.
                    document.getElementById('drawerBack')?.addEventListener('click', () => this.closeSettingsDrawer());
                }

                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape'
                        && this.settingsDrawerEl
                        && this.settingsDrawerEl.classList.contains('open')
                        && !e.ctrlKey && !e.altKey && !e.metaKey) {
                        // Don't steal Esc from inputs/textareas
                        const tag = (e.target && e.target.tagName) || '';
                        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
                            this.closeSettingsDrawer();
                            e.preventDefault();
                        }
                    }
                });
            }

            openSettingsDrawer(tabKey) {
                if (!this.settingsDrawerEl || !this.drawerBodyEl) { return; }
                const TITLES = { timer: 'Виджет', clock: 'Часы', display: 'Дисплей', sound: 'Звуки' };
                const target = document.getElementById(`tab-${tabKey}`);
                if (!target) { return; }

                this.drawerBodyEl.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                target.classList.add('active');
                if (this.drawerTitleEl) { this.drawerTitleEl.textContent = TITLES[tabKey] || 'Настройки'; }

                document.querySelectorAll('.tab-btn').forEach(b => {
                    const on = b.dataset.tab === tabKey;
                    b.classList.toggle('active', on);
                    // Паттерн disclosure: кнопка сообщает, раскрыта ли связанная панель.
                    b.setAttribute('aria-expanded', on ? 'true' : 'false');
                });

                const wasOpen = this.settingsDrawerEl.classList.contains('open');
                this._currentDrawerTab = tabKey;

                // Куда вернуть фокус при закрытии. Модалки это уже умеют
                // (modal-manager.js), а ящик — нет: фокус оставался на кнопке-табе,
                // и до только что открытых настроек надо было пройти Tab-ом всю
                // панель, потому что ящик лежит в конце документа.
                this._drawerFocusReturn = document.activeElement;

                if (!wasOpen) {
                    // Capture current outer width so close can restore exactly.
                    const baseDefault = (window.CONFIG && CONFIG.CONTROL_WINDOW_WIDTH) || 380;
                    this._baseWidthBeforeDrawer = window.outerWidth || window.innerWidth || baseDefault;
                    const shell = document.querySelector('.app-shell');
                    // Ширина колонки панели выводится из ФАКТИЧЕСКОЙ ширины окна, а
                    // не предсказывается.
                    //
                    // Здесь стояла просто текущая ширина окна, и у окна, растянутого
                    // до предела, ящик накрывал панель: запрос «текущая + 336»
                    // обрезался, окно не расширялось, а колонка оставалась во всю
                    // ширину (ящик — absolute; right: 0). Первая попытка починки
                    // вычитала ящик из КОНСТАНТЫ потолка — и падала на Windows, где
                    // главный процесс обрезает ширину ещё и по размеру экрана
                    // (`screenWidth - 50`): при окне 974px колонка получалась 864px,
                    // то есть снова с наложением. Предсказать эффективный потолок из
                    // рендерера нельзя, поэтому колонка считается от того, что
                    // реально получилось, и пересчитывается на каждый resize, пока
                    // ящик открыт — заодно это чинит ручное изменение размера окна
                    // при открытом ящике.
                    const syncColumn = () => {
                        if (!shell) { return; }
                        shell.style.setProperty('--control-panel-width', `${window.PanelDrawer.columnFromWindow(
                            window.innerWidth || baseDefault, this._drawerExtraWidth)}px`);
                    };
                    this._syncDrawerColumn = syncColumn;
                    window.addEventListener('resize', syncColumn);

                    // ПИН колонки ДО роста окна: пока колонка была 1fr, в зазор
                    // между мгновенным ростом окна и её переходом в 240ms панель
                    // успевала перецентроваться и вернуться. Пин обязан встать БЕЗ
                    // перехода — иначе тот стартует от 1fr и тащит панель за собой.
                    // Гасим переход, коммитим рефлоу, возвращаем. Разбор и числа —
                    // в panel-drawer.js.
                    this._baseInnerBeforeDrawer = window.innerWidth || baseDefault;
                    // Пин — по ПРЕДСКАЗАННОЙ финальной ширине, а не по текущей:
                    // на узком экране окно вырастает не на всю ширину ящика, и
                    // пин оказывался шире правды (разбор — в panel-drawer.js).
                    const pinnedColumn = window.PanelDrawer.drawerColumnWidth({
                        innerWidth: this._baseInnerBeforeDrawer,
                        drawerWidth: this._drawerExtraWidth,
                        availWidth: window.screen && window.screen.availWidth
                    });
                    if (shell) {
                        shell.style.setProperty(
                            '--control-panel-width',
                            `${pinnedColumn}px`
                        );
                        shell.style.transition = 'none';
                        shell.classList.add('drawer-open');
                        void shell.offsetWidth;
                        shell.style.transition = '';
                    }

                    // Потолок ширины поднимается ПЕРВЫМ, иначе запрос ниже обрежется (см. main).
                    ipcRenderer.send('control-drawer', { open: true });
                    // Drawer-операция меняет только ширину — высоту main оставит
                    // как есть (иначе ручная высота, выставленная юзером,
                    // перезаписывалась innerHeight с HiDPI-дрейфом).
                    ipcRenderer.send('resize-control-window', {
                        width: this._baseWidthBeforeDrawer + this._drawerExtraWidth
                    });
                    // Ящик раскрывается СРАЗУ: когда раскрытие лежало в отложенном
                    // кадре, на медленном раннере e2e видел aria-expanded="true"
                    // при ещё отсутствующем классе .open.
                    this.settingsDrawerEl.classList.add('open');
                    this.settingsDrawerEl.setAttribute('aria-hidden', 'false');
                    this._focusFirstInDrawer();
                    // Колонку пересчитываем, когда ширина окна УЖЕ приехала: раньше —
                    // значит по ещё не выросшему окну, панель уедет влево и вернётся
                    // вправо (тот же дёрганый ход наоборот). Если окно упёрлось в
                    // потолок, resize не придёт — тогда сработает сторож по времени.
                    const startWidth = window.innerWidth;
                    const settleStartedAt = performance.now();
                    const settleColumn = () => {
                        if (!this.settingsDrawerEl.classList.contains('open')) { return; }
                        if (window.innerWidth !== startWidth || performance.now() - settleStartedAt > 400) {
                            syncColumn();
                            return;
                        }
                        requestAnimationFrame(settleColumn);
                    };
                    requestAnimationFrame(settleColumn);
                } else {
                    // Ящик уже открыт, сменили вкладку — фокус ведём к новому содержимому.
                    this._focusFirstInDrawer();
                }
            }

            // Уводит фокус на первый контрол активной вкладки ящика.
            // Вызывается ПОСЛЕ снятия visibility: hidden — на скрытом поддереве
            // focus() молча ничего не делает.
            _focusFirstInDrawer() {
                const active = this.drawerBodyEl && this.drawerBodyEl.querySelector('.tab-content.active');
                const scope = active || this.settingsDrawerEl;
                const first = scope.querySelector(
                    'button:not([disabled]), input:not([disabled]), select:not([disabled]),'
                    + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                );
                // Крестик закрытия — приемлемая цель, если внутри вкладки нечего фокусировать.
                const target = first || this.drawerCloseBtn;
                if (target) { setTimeout(() => target.focus(), 0); }
            }

            closeSettingsDrawer() {
                if (!this.settingsDrawerEl) { return; }
                if (!this.settingsDrawerEl.classList.contains('open')) { return; }
                const shell = document.querySelector('.app-shell');
                this.settingsDrawerEl.classList.remove('open');
                this.settingsDrawerEl.setAttribute('aria-hidden', 'true');
                document.querySelectorAll('.tab-btn').forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-expanded', 'false');
                });
                this._currentDrawerTab = null;

                // Возвращаем фокус туда, откуда ящик открыли. Без этого фокус
                // оставался на элементе внутри уже скрытого ящика и «схлопывался»
                // на body — дальнейший Tab начинался с начала документа.
                const back = this._drawerFocusReturn;
                this._drawerFocusReturn = null;
                if (back && typeof back.focus === 'function' && back.isConnected) {
                    try { back.focus(); } catch { /* элемент мог исчезнуть */ }
                }

                // ВАЖНО: НЕ снимаем shell.drawer-open сразу — иначе panel мгновенно
                // перестраивается из left-docked (max 392) в centered (max 560) внутри
                // ещё широкого 716px-окна, и получается двойной скачок panel:
                // left-392 → center-560 → full-380. Снимаем класс ТОЛЬКО после того
                // как окно физически сузилось — тогда визуальное положение panel
                // не меняется (в узком окне start == center для 100% ширины).
                const baseDefault = (window.CONFIG && CONFIG.CONTROL_WINDOW_WIDTH) || 380;
                const restoreWidth = this._baseWidthBeforeDrawer || (window.outerWidth - this._drawerExtraWidth) || baseDefault;
                // Снимаем пересчёт колонки: пока ящик открыт, он держал её равной
                // «фактическая ширина минус ящик», но у закрытого ящика колонка не
                // нужна вовсе — иначе слушатель продолжал бы писать переменную,
                // которую clearDrawerOpen() тут же удаляет.
                if (this._syncDrawerColumn) {
                    window.removeEventListener('resize', this._syncDrawerColumn);
                    this._syncDrawerColumn = null;
                }
                // Схлопываем ТОЛЬКО резерв: он обязан обнулиться ЗАРАНЕЕ, иначе
                // снятие drawer-open вернёт первую дорожку к 1fr = «окно минус
                // вторая дорожка», и панель отскочит назад (замер: 64px).
                // Колонку НЕ трогаем: здесь стояло зеркало пина, и оно повторяло
                // его ошибку — на узком экране колонка уже узкая, а возврат её
                // расширял при ещё широком окне (замер CI: откат 40px).
                const baseInner = this._baseInnerBeforeDrawer;
                if (shell) {
                    shell.style.setProperty('--drawer-reserve', '0px');
                }
                ipcRenderer.send('resize-control-window', { width: restoreWidth });
                ipcRenderer.send('control-drawer', { open: false }); // потолок вниз ПОСЛЕ сжатия
                // Класс снимаем, когда ширина окна вернулась И анимация дорожек
                // отыграла: в этот момент 1fr уже равен пину, поэтому снятие
                // визуально ничего не меняет. Сторож по времени — на случай, если
                // окно и так было нужной ширины и resize не придёт вовсе.
                const closeStartedAt = performance.now();
                const finishClose = () => {
                    if (this.settingsDrawerEl.classList.contains('open')) { return; }
                    const elapsed = performance.now() - closeStartedAt;
                    const widthBack = !baseInner || Math.abs(window.innerWidth - baseInner) <= 4;
                    if ((widthBack && elapsed > 260) || elapsed > 700) {
                        if (shell) {
                            shell.classList.remove('drawer-open');
                            shell.style.removeProperty('--control-panel-width');
                            shell.style.removeProperty('--drawer-reserve');
                        }
                        return;
                    }
                    requestAnimationFrame(finishClose);
                };
                requestAnimationFrame(finishClose);
            }

            toggleSettingsDrawer(tabKey) {
                if (this._currentDrawerTab === tabKey
                    && this.settingsDrawerEl
                    && this.settingsDrawerEl.classList.contains('open')) {
                    this.closeSettingsDrawer();
                } else {
                    this.openSettingsDrawer(tabKey);
                }
            }

            initTabs() {
                // Настройки всегда видны (кнопка toggle убрана)
                const advancedSettings = document.getElementById('advancedSettings');
                if (advancedSettings) {
                    advancedSettings.classList.add('open');
                }

                this.initSettingsDrawer();

                // Табы открывают/закрывают slide-out drawer
                document.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        this.toggleSettingsDrawer(btn.dataset.tab);
                    });
                });

                // Быстрые пресеты
                // Подсветку НЕ ставим здесь: она выводится из фактического пресета
                // в syncPresetHighlight() на каждом обновлении состояния таймера.
                // Раньше класс active вешался по клику и не снимался ничем, поэтому
                // после ручного ввода времени, кнопок ±, горячих клавиш 1-8 или
                // команды из другого окна подсвеченной оставалась кнопка, которая
                // уже не соответствует таймеру.

                // Проводка ручного ввода и мастер-тумблера звука — в panel-state.js:
                // это те же четыре состояния, вид сбоку. Потолок inline-скрипта
                // (tests/control-decomposition.test.js) выгнал её отсюда, и правильно.
                this.bindPanelInputs();

                // Стартовое состояние: localStorage — лишь подсказка, финальное
                // значение выставит loadSettings() из soundMasterEnabled, чтобы
                // чекбокс и флаг никогда не расходились.
                this.setSoundEnabled(localStorage.getItem('soundEnabled') !== 'false');

                // Режим фона
                document.querySelectorAll('.bg-mode-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        document.querySelectorAll('.bg-mode-btn').forEach(b => b.classList.remove('active'));
                        document.querySelectorAll('.bg-controls').forEach(c => c.classList.remove('active'));
                        btn.classList.add('active');
                        this.currentBgMode = btn.dataset.mode;
                        document.getElementById(`bg${this.capitalize(btn.dataset.mode)}Controls`).classList.add('active');
                        this.pushDisplaySettings();
                    });
                });
            }

            // Единая точка правды для мастер-флага звука: держит вместе
            // this.soundEnabled и localStorage. Раньше флаг и мастер-чекбокс жили
            // отдельно, и звук мог залипнуть в выключенном состоянии без
            // возможности включить его из UI. Скрытая кнопка-тумблер, которую этот
            // метод раньше подкрашивал, удалена: после того как #soundMasterEnabled
            // стал единственным источником правды, она была мёртвым кодом.
            setSoundEnabled(enabled) {
                this.soundEnabled = !!enabled;
                localStorage.setItem('soundEnabled', this.soundEnabled);
            }

            attachEvents() {
                // Здесь жил обработчик #setCustomTime — старый ввод «минуты + секунды»
                // с валидацией и всплывающими сообщениями об ошибке. Сами поля и кнопка
                // лежали в блоке `display:none` («removed from UI but needed by JS»),
                // то есть дотянуться до них было невозможно: ни ввести, ни нажать.
                // Живая замена — ввод прямо в крупных цифрах (#controlTime →
                // #manualHours / #manualMinutes / #manualSeconds, panel-state.js).
                // Строгий TimeUtils.parseManualTime с подсветкой .input-error
                // разбирает поле лимита перерасхода (#overrunLimit).

                // Здесь же висел обработчик на .adjust-btn с data-seconds — вторая
                // половина того же трупа: класс не встречается в разметке ни разу
                // (замер querySelectorAll в живом окне: 0 элементов), а стили к нему
                // лежали в удалённом components.css. Живые кнопки корректировки —
                // .adjust-main-btn с data-adjust, они подключаются выше.

                // Главные кнопки
                // В режиме ввода та же синяя кнопка называется «Поставить» и
                // ставит время, а не запускает: кнопка ОДНА, потому что в макете
                // она одна, и разводится по смыслу здесь, а не второй кнопкой.
                this.startBtn.addEventListener('click', () => {
                    if (this.inputMode) { this._applyManualTime?.(); return; }
                    this.start();
                });
                this.pauseBtn.addEventListener('click', () => this.pause());
                this.resetBtn.addEventListener('click', () => this.reset());

                // Окна (переключение открыть/закрыть)
                document.getElementById('openWidgetBtn').addEventListener('click', () => {
                    if (isWidgetOpen) {
                        ipcRenderer.send('close-widget');
                    } else {
                        ipcRenderer.send('open-widget');
                    }
                });
                document.getElementById('openClockBtn').addEventListener('click', () => {
                    if (isClockOpen) {
                        ipcRenderer.send('close-clock-widget');
                    } else {
                        ipcRenderer.send('open-clock-widget');
                        // Синхронизируем настройки и стиль часов при открытии
                        setTimeout(() => {
                            this.pushClockSettings();
                            const clockStyle = this.syncClockStyle ? this.timerStyleEl.value : this.clockStyleEl.value;
                            ipcRenderer.send('clock-widget-set-style', clockStyle);
                        }, 500);
                    }
                });
                document.getElementById('openDisplayBtn').addEventListener('click', () => {
                    if (isDisplayOpen) {
                        ipcRenderer.send('close-display');
                    } else {
                        // При открытии дисплея закрываем виджеты таймера и часов
                        if (isWidgetOpen) {
                            ipcRenderer.send('close-widget');
                        }
                        if (isClockOpen) {
                            ipcRenderer.send('close-clock-widget');
                        }
                        const displayIndex = this.displaySelectEl.value;
                        ipcRenderer.send('open-display', { displayIndex });
                    }
                });
                
                // Сохранение выбора монитора
                this.displaySelectEl.addEventListener('change', () => {
                    localStorage.setItem('selectedDisplay', this.displaySelectEl.value);
                });

                // Настройки перерасхода
                this.allowNegativeEl.addEventListener('change', () => {
                    document.getElementById('overrunRow').style.display =
                        this.allowNegativeEl.checked ? 'flex' : 'none';
                    this.saveExtSettings();
                    // Выключили минус — лимит теряет смысл; включили — сразу шлём.
                    this.pushOverrunLimit();
                });

                // Тумблеры блоков, поля времени и название — panel-display.js.
                this.bindDisplayBlockControls();
                // Кнопки готовых раскладок — оттуда же.
                this.bindDisplayLayouts();
                
                this.timeBlocksScaleEl.addEventListener('input', () => {
                    this.timeBlocksScaleValueEl.textContent = this.timeBlocksScaleEl.value + '%';
                    this.pushDisplaySettings();
                });
                
                this.timerStyleEl.addEventListener('change', () => {
                    // Send widget-specific style update (only affects widget, not display)
                    ipcRenderer.send('widget-style-update', this.widgetStylePayload());
                    // При синхронизации часы идут за виджетом — И ОКНО, И ПЕРЕКЛЮЧАТЕЛЬ.
                    // Присваивание .value не порождает 'change' (см. _attachSegmented),
                    // поэтому петля не замыкается и синхронизация не гаснет.
                    if (this.syncClockStyle) {
                        this.clockStyleEl.value = this.timerStyleEl.value;
                        ipcRenderer.send('clock-widget-set-style', this.timerStyleEl.value);
                    }
                    this.updateClockAnalogNumbersVisibility();
                    this.updateStyleDependentRows();
                    this.saveExtSettings();
                });

                this.timerScaleEl.addEventListener('input', () => {
                    this.timerScaleValueEl.textContent = this.timerScaleEl.value + '%';
                    ipcRenderer.send('widget-style-update', this.widgetStylePayload());
                    this.saveExtSettings();
                });

                // Display-specific style/scale (Полноэкранный tab)
                if (this.displayTimerStyleEl) {
                    this.displayTimerStyleEl.addEventListener('change', () => {
                        this.updateStyleDependentRows();
                        this.pushDisplaySettings();
                    });
                }
                if (this.displayTimerScaleEl) {
                    this.displayTimerScaleEl.addEventListener('input', () => {
                        this.displayTimerScaleValueEl.textContent = this.displayTimerScaleEl.value + '%';
                        this.pushDisplaySettings();
                    });
                }

                // Синхронизация стиля часов
                this.syncClockStyleEl.addEventListener('change', () => {
                    this.syncClockStyle = this.syncClockStyleEl.checked;
                    
                    if (this.syncClockStyle) {
                        // При включении синхронизации - применяем стиль таймера к часам
                        this.clockStyleEl.value = this.timerStyleEl.value;
                        ipcRenderer.send('clock-widget-set-style', this.timerStyleEl.value);
                    }
                    this.updateClockAnalogNumbersVisibility();
                    this.updateStyleDependentRows();
                    this.saveExtSettings();
                });

                // Отдельный стиль часов — явное изменение из вкладки Часы отключает синхронизацию
                this.clockStyleEl.addEventListener('change', () => {
                    if (this.syncClockStyle) {
                        this.syncClockStyle = false;
                        if (this.syncClockStyleEl) { this.syncClockStyleEl.checked = false; }
                    }
                    ipcRenderer.send('clock-widget-set-style', this.clockStyleEl.value);
                    this.updateClockAnalogNumbersVisibility();
                    this.updateStyleDependentRows();
                    this.saveExtSettings();
                });

                // Три независимых списка шрифта — каждый шлёт только своему окну.
                if (this.widgetDigitsFontEl) {
                    this.widgetDigitsFontEl.addEventListener('change', () => {
                        ipcRenderer.send('widget-style-update', this.widgetStylePayload());
                        this.saveExtSettings();
                    });
                }
                if (this.clockDigitsFontEl) {
                    this.clockDigitsFontEl.addEventListener('change', () => {
                        this.pushClockSettings();
                        this.saveExtSettings();
                    });
                }
                if (this.displayDigitsFontEl) {
                    this.displayDigitsFontEl.addEventListener('change', () => {
                        this.pushDisplaySettings();
                    });
                }

                // Масштаб часов
                const clockScaleEl = document.getElementById('clockScale');
                const clockScaleValueEl = document.getElementById('clockScaleValue');
                if (clockScaleEl) {
                    clockScaleEl.addEventListener('input', () => {
                        const val = parseInt(clockScaleEl.value);
                        clockScaleValueEl.textContent = val + '%';
                        const newSize = Math.round(CLOCK_BASE_PX * val / 100);
                        ipcRenderer.send('clock-widget-resize', { width: newSize, height: newSize });
                    });
                }

                // Scale value click-to-edit and double-click-to-reset wiring
                setupScaleValueEdit(
                    document.getElementById('timerScaleValue'),
                    document.getElementById('timerScale'),
                    DEFAULT_SCALE_PCT,
                    (val) => {
                        ipcRenderer.send('widget-style-update', this.widgetStylePayload({ timerScale: val }));
                        this.saveExtSettings();
                    }
                );

                setupScaleValueEdit(
                    document.getElementById('clockScaleValue'),
                    document.getElementById('clockScale'),
                    DEFAULT_SCALE_PCT,
                    (val) => {
                        const newSize = Math.round(CLOCK_BASE_PX * val / 100);
                        ipcRenderer.send('clock-widget-resize', { width: newSize, height: newSize });
                    }
                );

                // Границы обязаны совпадать с Ctrl/Shift+колесом в display-script.js
                // (TIMER_*_SCALE 30..300, BLOCK_*_SCALE 50..600) и с валидацией в
                // restoreBlockPositions — иначе ползунок выставляет значение,
                // которое дисплей потом откажется восстанавливать.
                setupScaleValueEdit(
                    document.getElementById('displayTimerScaleValue'),
                    document.getElementById('displayTimerScale'),
                    DEFAULT_SCALE_PCT,
                    () => { this.pushDisplaySettings(); }
                );

                setupScaleValueEdit(
                    document.getElementById('timeBlocksScaleValue'),
                    document.getElementById('timeBlocksScale'),
                    window.DisplayLayouts.DEFAULT_BLOCK_SCALE,
                    () => { this.pushDisplaySettings(); }
                );

                // Цифры на циферблате для часов
                this.clockShowAnalogNumbersEl.addEventListener('change', () => {
                    this.pushClockSettings();
                });

                // Настройки виджета часов
                this.clockShowDateEl.addEventListener('change', () => this.pushClockSettings());
                this.clockShowTimezoneEl.addEventListener('change', () => this.pushClockSettings());
                this.clockShowSecondsEl.addEventListener('change', () => this.pushClockSettings());
                this.clockFormat24hEl.addEventListener('change', () => this.pushClockSettings());

                // Фон дисплея
                ['bgSolidColor', 'bgGrad1', 'bgGrad2'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {el.addEventListener('input', debounce(() => this.pushDisplaySettings()));}
                });
                // Сброс стиля
                const resetStyleBtn = document.getElementById('resetStyleBtn');
                if (resetStyleBtn) {
                    resetStyleBtn.addEventListener('click', () => {
                        // Кнопка сбрасывает ФОН и только его: она стоит в разделе
                        // фона полноэкранного окна. Раньше последней строкой она
                        // кликала ПЕРВЫЙ свотч темы в документе, а первый
                        // принадлежит сетке ВИДЖЕТА, — и сброс фона дисплея
                        // перекрашивал соседнее окно в тему «Синий», которая к
                        // тому же не заводская: на чистом профиле ключа
                        // widgetColors нет вовсе.
                        //
                        // Значения берутся из таблицы настроек, а не литералами:
                        // умолчание правят в ней, и третья копия разошлась бы с
                        // ней молча.
                        window.SettingsSchema.resetKeys(['bgSolid', 'bgGrad1', 'bgGrad2'], document);
                        // «По умолчанию» — это то, что стоит на чистом профиле,
                        // а там «По теме». Кнопка, возвращающая не то же самое,
                        // что новая установка, — это две разные правды. Клик по
                        // режиму сохраняет настройки и шлёт их окну.
                        const themeModeBtn = document.querySelector('.bg-mode-btn[data-mode="theme"]');
                        if (themeModeBtn) { themeModeBtn.click(); }
                    });
                }

                // Звуки
                this.soundMasterEl.addEventListener('change', () => {
                    const soundSettings = document.getElementById('soundSettings');
                    soundSettings.style.opacity = this.soundMasterEl.checked ? '1' : '0.5';
                    soundSettings.style.pointerEvents = this.soundMasterEl.checked ? 'auto' : 'none';
                    // Мастер-чекбокс — единственный видимый переключатель звука,
                    // поэтому он ОБЯЗАН вести за собой флаг soundEnabled. Без этого
                    // старое значение soundEnabled=false из localStorage навсегда
                    // глушило playSound(), хотя чекбокс показывал «включено».
                    this.setSoundEnabled(this.soundMasterEl.checked);
                    this.renderSoundRow();  // строка «Звуки» показывает ТОТ ЖЕ чекбокс
                    this.saveExtSettings();
                });

                [this.soundStartEl, this.soundEndEl, this.soundMinuteEl].forEach(el => {
                    el.addEventListener('change', () => this.saveExtSettings());
                });

                ['soundStartPreset', 'soundEndPreset', 'soundMinutePreset'].forEach(id => {
                    document.getElementById(id).addEventListener('change', () => this.saveExtSettings());
                });

                // Превью звуков
                document.getElementById('soundStartPreview').addEventListener('click', () => this.previewSound('start'));
                document.getElementById('soundEndPreview').addEventListener('click', () => this.previewSound('end'));
                document.getElementById('soundMinutePreview').addEventListener('click', () => this.previewSound('minute'));
                document.getElementById('soundOverrunPreview').addEventListener('click', () => this.previewSound('overrun'));

                // Настройки перерасхода звука
                this.soundOverrunEl.addEventListener('change', () => this.saveExtSettings());
                this.overrunIntervalEl.addEventListener('change', () => {
                    this.saveExtSettings();
                    this.pushOverrunInterval();
                });

                // Лимит перерасхода. Значение уезжает в движок через getConfig()
                // при следующей команде таймера; pushOverrunLimit() досылает его
                // сразу, чтобы лимит применился без ожидания старта/паузы.
                const overrunLimitEl = document.getElementById('overrunLimit');
                if (overrunLimitEl) {
                    overrunLimitEl.addEventListener('input', () => this.refreshOverrunLimitHint());
                    overrunLimitEl.addEventListener('change', () => {
                        this.refreshOverrunLimitHint();
                        this.saveExtSettings();
                        this.pushOverrunLimit();
                    });
                }

                // Загрузка пользовательских звуков
                document.getElementById('addSoundBtn').addEventListener('click', () => {
                    document.getElementById('soundFileInput').click();
                });

                this.bindSoundDropZone();
                document.getElementById('soundFileInput').addEventListener('change', (e) => {
                    this.handleSoundFileUpload(e);
                });

                // Загружаем список пользовательских звуков
                this.loadCustomSounds();

                // Локальный фон
                this.setupLocalBackground();
            }



            loadSettings() {
                // Загрузка цветов
                // Старый общий ключ: то, что в нём есть, ДОПОЛНЯЕТ стартовые
                // цвета, а не пересобирает их. Прежняя версия строила объект из
                // трёх полей с фиолетовыми запасными значениями — и тем самым
                // теряла бы всё, чего в ключе нет (фон окна, прозрачность).
                const savedColors = localStorage.getItem('timerColors');
                if (savedColors) {
                    this.currentColors = window.mergeColors(
                        this.currentColors, safeJSONParse(savedColors, {})
                    );
                }

                // Загрузка расширенных настроек
                // Профиль прежней версии: общий тумблер блоков переводится в
                // личные ДО раскладки по контролам, иначе дисплей, у которого
                // блоки были включены, откроется пустым — новых ключей в таком
                // профиле нет, а их умолчание «выключено».
                const ext = window.RendererShared.migrateDisplayBlocks(
                    safeJSONParse(localStorage.getItem('displayExtSettings'), {})
                );

                // Значения раскладывает таблица (settings-schema.js): ключ, контрол
                // и значение по умолчанию описаны там ОДИН раз — и для загрузки, и
                // для сохранения. Здесь остаётся только то, что таблицей не
                // выражается: собственный формат двух ключей, побочные эффекты
                // (видимость строк, отправка в окна) и поля контроллера.
                const applied = window.SettingsSchema.applyStoredSettings(ext, document);
                // Выбранного звука могло не стать: пресет убрали из набора или
                // пользователь удалил свой файл. Тогда браузер молча показывает
                // первый пункт, а в хранилище лежит другое — событие беззвучно,
                // а настройка утверждает обратное. Чинит sound-presets.js.
                window.SoundPresets.repairSelection(document, window.SettingsSchema);

                // Слитый стиль. Профиль мог хранить `digital` (LED) — стиля с
                // таким именем больше нет ни в одном окне, и сегментированный
                // контрол просто не нашёл бы такой кнопки: пользователь увидел
                // бы, что стиль «не выбран». Переводим ЗДЕСЬ, в единственном
                // месте, где панель раскладывает сохранённое по контролам, и
                // сразу отдаём фон и цвет цифр от прежнего LED — чтобы окно
                // выглядело так же, как до слияния.
                for (const [el, target] of [[this.timerStyleEl, 'widget'], [this.clockStyleEl, 'clock'], [this.displayTimerStyleEl, 'display']]) {
                    if (!el || el.value !== 'digital') { continue; }
                    el.value = window.RendererShared.migrateTimerStyle('digital');
                    if (target !== 'display') {
                        const colors = target === 'widget' ? this.currentColors : this.clockColors;
                        if (!colors || !colors.surface) {
                            this.updateColors(target, { surface: '#0a0a0f', surfaceAlpha: 0.85 });
                        }
                    }
                }

                // Лимит перерасхода: в хранилище секунды, в поле «MM:SS».
                document.getElementById('overrunRow').style.display = applied.allowNegative ? 'flex' : 'none';
                if (Number.isFinite(Number(ext.overrunLimitSeconds)) && Number(ext.overrunLimitSeconds) > 0) {
                    const secs = Number(ext.overrunLimitSeconds);
                    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
                    const ss = String(secs % 60).padStart(2, '0');
                    document.getElementById('overrunLimit').value = `${mm}:${ss}`;
                }
                this.refreshOverrunLimitHint();

                // Чекбокс — авторитет: подтягиваем к нему внутренний флаг, иначе
                // сохранённое soundEnabled=false молча глушит все звуки.
                this.setSoundEnabled(applied.soundMasterEnabled);
                this.renderSoundRow();
                const soundSettings = document.getElementById('soundSettings');
                soundSettings.style.opacity = applied.soundMasterEnabled ? '1' : '0.5';
                soundSettings.style.pointerEvents = applied.soundMasterEnabled ? 'auto' : 'none';

                // Режим фона — не поле ввода, а три кнопки (image-по-URL удалён,
                // legacy-значения маппим в solid).
                // Умолчание — «По теме» (18.08.2026). Раньше здесь стояла
                // тёмная ЗАЛИВКА, то есть на чистом профиле дисплей был тёмным
                // в любой теме, и светлая тема окна существовала, но добраться
                // до неё можно было только выбрав светлый цвет руками.
                // Профили, где фон уже настраивали, значение хранят и его же и
                // получат: saveExtSettings пишет bgMode всегда.
                let bgMode = ext.bgMode || 'theme';
                if (bgMode === 'image') { bgMode = 'solid'; }
                this.currentBgMode = bgMode;
                document.querySelectorAll('.bg-mode-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.mode === bgMode);
                });
                document.querySelectorAll('.bg-controls').forEach(c => c.classList.remove('active'));
                document.getElementById(`bg${this.capitalize(bgMode)}Controls`).classList.add('active');

                // Режим центрального времени — тоже кнопки, а не поле; setHeroMode
                // сам ставит и активную кнопку, и видимость поля заголовка, иначе
                // после перезапуска значение восстановилось бы, а вид панели — нет.
                this.setHeroMode(ext.heroMode || window.HeroModes.DEFAULT_MODE);

                // Синхронизация: переключатель часов показывает стиль виджета.
                // Присваивание лечит и профили прежней версии, где в хранилище
                // остался стиль, которого на экране нет (ряд был скрыт).
                this.syncClockStyle = applied.syncClockStyle;
                if (this.syncClockStyle) { this.clockStyleEl.value = this.timerStyleEl.value; }

                // Ползунок «Масштаб часов». Единственный источник правды здесь —
                // clockGeometry, который пишет САМО окно часов (localStorage общий
                // для всех окон приложения). В displayExtSettings масштаба часов
                // нет вообще, поэтому без этого чтения ползунок при каждом запуске
                // показывал «100%» независимо от реального размера окна.
                const clockGeo = safeJSONParse(localStorage.getItem('clockGeometry'), null);
                const clockScaleSliderEl = document.getElementById('clockScale');
                const clockScaleLabelEl = document.getElementById('clockScaleValue');
                if (clockScaleSliderEl && clockGeo && Number.isFinite(Number(clockGeo.scalePct))) {
                    // Присваивание .value НЕ порождает 'input', поэтому обратной
                    // отправки в окно часов не происходит и петля не замыкается.
                    const pct = window.RendererShared.clampScale(Number(clockGeo.scalePct), 30, 600);
                    clockScaleSliderEl.value = pct;
                    if (clockScaleLabelEl) { clockScaleLabelEl.textContent = pct + '%'; }
                }

                // Обновляем видимость опции цифр для часов
                this.updateClockAnalogNumbersVisibility();
                // Строки выбора шрифта «Цифры» — видимость зависит от
                // восстановленного выше стиля каждого из трёх окон.
                this.updateStyleDependentRows();

                // Отправляем стиль часам при загрузке
                const clockStyleToSend = this.syncClockStyle ? this.timerStyleEl.value : this.clockStyleEl.value;
                setTimeout(() => {
                    ipcRenderer.send('clock-widget-set-style', clockStyleToSend);
                }, 500);

                // Отправляем интервал и лимит перерасхода при загрузке
                this.pushOverrunInterval();
                this.pushOverrunLimit();

                // Отправляем начальный стиль виджета
                setTimeout(() => {
                    ipcRenderer.send('widget-style-update', this.widgetStylePayload());
                }, 600);

                // Загружаем per-window цвета
                const savedWidgetColors = safeJSONParse(localStorage.getItem('widgetColors'), null);
                const savedClockColors = safeJSONParse(localStorage.getItem('clockColors'), null);
                const savedDisplayColors = safeJSONParse(localStorage.getItem('displayColors'), null);
                if (savedWidgetColors) {
                    this.currentColors = savedWidgetColors;
                    ipcRenderer.send('widget-colors-update', savedWidgetColors);
                }
                if (savedClockColors) {
                    this.clockColors = savedClockColors;
                    ipcRenderer.send('clock-colors-update', savedClockColors);
                }
                if (savedDisplayColors) {
                    this.displayColors = savedDisplayColors;
                    ipcRenderer.send('display-colors-update', savedDisplayColors);
                }

                // Цвета загружены — показать, какая тема им соответствует и в
                // каком состоянии фон окна (до сборки ряда вызов холостой).
                this.highlightActiveThemes();
                this.renderSurfaceControls();
            }

            saveColors(target = 'all') {
                if (target === 'all' || target === 'widget') {
                    localStorage.setItem('widgetColors', JSON.stringify(this.currentColors));
                    ipcRenderer.send('widget-colors-update', this.currentColors);
                }
                if (target === 'all' || target === 'clock') {
                    const colors = this.clockColors || this.currentColors;
                    localStorage.setItem('clockColors', JSON.stringify(colors));
                    ipcRenderer.send('clock-colors-update', colors);
                }
                if (target === 'all' || target === 'display') {
                    const colors = this.displayColors || this.currentColors;
                    localStorage.setItem('displayColors', JSON.stringify(colors));
                    ipcRenderer.send('display-colors-update', colors);
                }
                // Backward compat (localStorage only, no global IPC broadcast)
                localStorage.setItem('timerColors', JSON.stringify(this.currentColors));
                this.refreshPresetMarks();
            }

            saveExtSettings() {
                const settings = {
                    // Всё, что описано таблицей, собирается из контролов ею же —
                    // включая устаревшие ключи timerStyle/timerScale, которые
                    // продолжают писаться ради отката на предыдущую версию.
                    ...window.SettingsSchema.collectSettings(document),
                    // Своего формата: секунды из поля «MM:SS».
                    overrunLimitSeconds: this.readOverrunLimit(),
                    // Не поле ввода, а активная кнопка из трёх.
                    bgMode: this.currentBgMode,
                    // Тоже не поле ввода, а активная кнопка — теперь из четырёх.
                    heroMode: this.heroMode || window.HeroModes.DEFAULT_MODE
                };

                // СЛИЯНИЕ, а не перезапись: ключ мог быть записан прежней версией
                // приложения, и незнакомые панели поля переживают обновление.
                const prev = safeJSONParse(localStorage.getItem('displayExtSettings'), {});
                localStorage.setItem('displayExtSettings', JSON.stringify({ ...prev, ...settings }));
                // Подписи строк — производная от этих же настроек (почему здесь,
                // а не в пяти обработчиках, — в renderWindowRows).
                this.renderWindowRows();
                // И отметка «этот пресет сейчас на экране»: она вычисляется
                // сравнением снимка с профилем, а профиль только что изменился.
                this.refreshPresetMarks();
            }

            // Отметка «этот вид сейчас на экране» вычисляется сравнением с
            // профилем, поэтому зовётся из КАЖДОГО места, где панель пишет его
            // ключи. Метод — чтобы таких мест не стало три разных строки.
            refreshPresetMarks() {
                if (window.presetsApi) { window.presetsApi.refresh(); }
            }

            pushOverrunLimit() {
                ipcRenderer.send('timer-command', {
                    allowNegative: this.allowNegativeEl.checked,
                    overrunLimitSeconds: this.readOverrunLimit()
                });
            }

            pushOverrunInterval() {
                const interval = parseInt(this.overrunIntervalEl.value) || 1;
                ipcRenderer.send('timer-command', {
                    overrunIntervalMinutes: interval
                });
            }


            updateClockAnalogNumbersVisibility() {
                // Определяем текущий стиль часов
                const clockStyle = this.syncClockStyle ? this.timerStyleEl.value : this.clockStyleEl.value;
                // Показываем опцию цифр только для аналогового стиля
                if (this.clockAnalogNumbersRowEl) {
                    this.clockAnalogNumbersRowEl.style.display = clockStyle === 'analog' ? 'flex' : 'none';
                }
            }

            // Строка выбора шрифта видна только при стиле «Цифры» — у остальных
            // четырёх стилей начертание задаёт сам стиль, выбирать нечего.
            // Три независимых проверки: у каждого окна свой активный стиль.
            // Адаптер: div.segmented притворяется форм-контролем с .value.
            //
            // КРИТИЧНО: присваивание .value НЕ порождает 'change' — ровно как у
            // нативных <input>/<select>. Событие шлёт ТОЛЬКО клик пользователя.
            //
            // Раньше событие летело и на присваивание, и это ломало всю
            // синхронизацию стиля часов. Цепочка: пользователь ставит галочку
            // «синхронизировать со стилем виджета» → обработчик присваивает
            // clockStyleEl.value = timerStyleEl.value → сеттер шлёт 'change' →
            // обработчик clockStyleEl трактует это как РУЧНОЙ выбор стиля часов и
            // тут же снимает галочку, а saveExtSettings() сохраняет
            // syncClockStyle: false. То же происходило при загрузке панели, где
            // loadSettings восстанавливает clockStyleEl.value: сохранённое «включено»
            // уничтожалось на старте. Функция не работала никогда.
            //
            // Про ползунки в CLAUDE.md записано это же свойство с обратной стороны:
            // «Присваивание slider.value НЕ порождает 'input', и это то, что не даёт
            // петле замкнуться». Сегментированный адаптер нарушал тот же инвариант.
            _attachSegmented(el, defaultVal) {
                if (!el || !el.classList || !el.classList.contains('segmented')) { return; }

                // Обновление вида и ARIA без всякого события.
                const apply = (v) => {
                    el.dataset.value = v;
                    el.querySelectorAll('button').forEach(b => {
                        const on = b.dataset.val === v;
                        b.classList.toggle('active', on);
                        // Состояние обязано быть и в ARIA, а не только в классе:
                        // без aria-checked скринридер видит группу одинаковых
                        // кнопок и не может сказать, какая выбрана.
                        b.setAttribute('aria-checked', on ? 'true' : 'false');
                    });
                };

                if (!Object.getOwnPropertyDescriptor(el, 'value')) {
                    Object.defineProperty(el, 'value', {
                        get() {
                            return this.dataset.value
                                || (this.querySelector('button.active')?.dataset.val)
                                || defaultVal || '';
                        },
                        set(v) { apply(v); },
                        configurable: true
                    });
                }

                el.querySelectorAll('button').forEach(btn => {
                    // Контейнер объявлен role="radiogroup" — потомки обязаны быть radio.
                    // Раньше контейнер был role="tablist" с обычными кнопками внутри:
                    // структура невалидная, скринридер сообщал «список вкладок» без
                    // единой вкладки. Это не табы — выбор одного значения из набора.
                    btn.setAttribute('role', 'radio');
                    btn.setAttribute('aria-checked', btn.classList.contains('active') ? 'true' : 'false');
                    btn.addEventListener('click', () => {
                        apply(btn.dataset.val);
                        // Событие — признак действия ПОЛЬЗОВАТЕЛЯ, и только его.
                        el.dispatchEvent(new Event('change'));
                    });
                });
            }

            pushClockSettings() {
                // Ключ, контрол и умолчание описаны ОДНОЙ строкой таблицы в
                // clock-settings-schema.js. Здесь остаётся то, что таблица
                // выразить не может: деления циферблата и запись в хранилище.
                const persisted = window.ClockSettingsSchema.collectClockSettings(this);

                // Деления — настройка ОБЩАЯ с виджетом, у неё свои ключи, и
                // восстанавливают её сами окна. Поэтому в хранилище часов она не
                // идёт (вторая копия настройки рано или поздно разойдётся), а по
                // IPC идёт: там её ждут прямо сейчас.
                const settings = { ...persisted, showTicks: this.clockShowTicksEl?.checked ?? false };

                // СЛИЯНИЕ, а не перезапись: ключ пишут двое — эта панель и сам
                // виджет часов (у него там ещё clockStyle). Прямая перезапись
                // стирала чужие поля.
                const prevClock = safeJSONParse(localStorage.getItem('clockWidgetSettings'), {});
                localStorage.setItem('clockWidgetSettings', JSON.stringify({ ...prevClock, ...persisted }));
                this.refreshPresetMarks();

                ipcRenderer.send('clock-widget-settings', settings);
            }

            loadClockSettings() {
                window.ClockSettingsSchema.applyClockSettings(
                    this,
                    safeJSONParse(localStorage.getItem('clockWidgetSettings'), {})
                );
                this.updateClockAnalogNumbersVisibility();
            }

            setupIPC() {
                ipcRenderer.send('get-timer-state');
                ipcRenderer.send('get-displays');

                this._onDisplaysList = (event, displays) => {
                    this.updateDisplaysList(displays);
                };
                ipcRenderer.on('displays-list', this._onDisplaysList);

                this._onTimerState = (event, state) => {
                    // FIX: Use monotonic updateCounter instead of timestamp for dedup
                    const updateCounter = state.updateCounter || 0;
                    if (updateCounter > 0 && updateCounter <= this.lastUpdateCounter) {return;}
                    this.lastUpdateCounter = updateCounter;
                    this.lastTimestamp = state.timestamp || Date.now();

                    const wasRunningBefore = this.isRunning;
                    const wasFinishedBefore = this.wasFinished;
                    const wasPausedBefore = this.isPaused;
                    this.totalSeconds = state.totalSeconds;
                    this.remainingSeconds = state.remainingSeconds;
                    // presetSeconds — «к чему вернёт сброс». Именно он, а не
                    // totalSeconds, определяет, какая кнопка быстрого выбора активна:
                    // корректировки ± меняют total, но пресет остаётся прежним.
                    this.presetSeconds = Number(state.presetSeconds) || 0;
                    this.isRunning = state.isRunning;
                    this.isPaused = state.isPaused;
                    this.wasFinished = !!state.finished;

                    this.updateDisplay();
                    this.updateControls();
                    this.syncPresetHighlight();

                    // Звук старта при запуске из другого окна (только холодный старт, не возобновление из паузы)
                    if (!wasRunningBefore && !wasPausedBefore && state.isRunning) {
                        if (this._localStartTriggered) {
                            this._localStartTriggered = false;
                        } else if (this.soundStartEl.checked) {
                            this.playSound('start');
                        }
                    }

                    // Звук окончания таймера
                    if (state.finished && !wasFinishedBefore) {
                        if (this.soundEndEl.checked) {
                            this.playSound('end');
                        }
                    }
                };
                ipcRenderer.on('timer-state', this._onTimerState);

                // Обратный канал масштаба: окно сообщило, что его отмасштабировали
                // Ctrl+колесом — подтягиваем соответствующий ползунок. Без этого
                // панель и окно держали два расходящихся значения, и следующая
                // отправка настроек возвращала масштаб назад.
                //
                // Присваивание .value НЕ порождает событие 'input', поэтому обратной
                // отправки в окно не происходит и петля не замыкается. В localStorage
                // пишем через saveExtSettings() — она не шлёт IPC.
                this._onScaleReport = (event, data) => {
                    const applied = window.ScaleReport.applyScaleReport(data, {
                        doc: document,
                        storage: localStorage,
                        clamp: window.RendererShared.clampScale,
                        parseJSON: safeJSONParse
                    });
                    // Подписи строк — отчёт о ДЕЙСТВУЮЩИХ значениях, и масштаб
                    // в них входит (см. renderWindowRows).
                    if (applied !== null) { this.renderWindowRows(); }
                };
                ipcRenderer.on('scale-report', this._onScaleReport);

                // Блок дисплея закрыли крестиком прямо в окне. Панель — владелец
                // настроек, поэтому снимает тумблер у себя и рассылает настройки:
                // иначе состояние жило бы в двух местах и разошлось бы при первом
                // же переоткрытии дисплея.
                this._onBlockHidden = (_event, payload) => this.onDisplayBlockHidden(payload);
                ipcRenderer.on('block-hidden', this._onBlockHidden);

                this._onTimerMinute = () => {
                    if (this.soundMinuteEl.checked) {
                        this.playSound('minute');
                    }
                };
                ipcRenderer.on('timer-minute', this._onTimerMinute);

                this._onTimerReachedZero = () => {
                    if (this.soundEndEl.checked) {
                        this.playSound('end');
                    }
                };
                ipcRenderer.on('timer-reached-zero', this._onTimerReachedZero);

                this._onTimerOverrun = () => {
                    if (this.soundOverrunEl.checked) {
                        this.playSound('overrun');
                    }
                };
                ipcRenderer.on('timer-overrun-minute', this._onTimerOverrun);

                // Восстановление после падения. Главный процесс возвращает время в
                // состояние таймера сам, а этим каналом СООБЩАЕТ об этом панели —
                // без сообщения пользователь после сбоя видит на экране чужое на
                // вид время и не знает, откуда оно взялось.
                //
                // Слушателя не было ни одного: канал стоял в обоих белых списках, в
                // главном процессе стояла отправка, и комментарий рядом с ней гласил
                // «канал больше не мёртвый код». Отправка без приёмника — ровно то же
                // мёртвое место, только теперь в двух файлах.
                this._onRecoveryAvailable = (event, saved) => {
                    if (!saved || typeof saved !== 'object') { return; }
                    const secs = Number(saved.remainingSeconds);
                    if (!Number.isFinite(secs)) { return; }
                    window.Toast.show(
                        `Время восстановлено после сбоя: ${window.TimeUtils.formatTime(secs)}`,
                        'warning',
                        6000
                    );
                };
                ipcRenderer.on('timer-recovery-available', this._onRecoveryAvailable);
            }

            cleanup() {
                if (this._onDisplaysList) {ipcRenderer.removeListener('displays-list', this._onDisplaysList);}
                if (this._onTimerState) {ipcRenderer.removeListener('timer-state', this._onTimerState);}
                if (this._onTimerMinute) {ipcRenderer.removeListener('timer-minute', this._onTimerMinute);}
                if (this._onTimerReachedZero) {ipcRenderer.removeListener('timer-reached-zero', this._onTimerReachedZero);}
                if (this._onTimerOverrun) {ipcRenderer.removeListener('timer-overrun-minute', this._onTimerOverrun);}
                if (this._onScaleReport) {ipcRenderer.removeListener('scale-report', this._onScaleReport);}
                if (this._onBlockHidden) {ipcRenderer.removeListener('block-hidden', this._onBlockHidden);}
                if (this._onRecoveryAvailable) {ipcRenderer.removeListener('timer-recovery-available', this._onRecoveryAvailable);}

                // Удаляем глобальные DOM и IPC handlers из _handlers
                const h = this._handlers || {};
                if (h.onDisplayWindowState) { ipcRenderer.removeListener('display-window-state', h.onDisplayWindowState); }
                if (h.onWidgetWindowState) { ipcRenderer.removeListener('widget-window-state', h.onWidgetWindowState); }
                if (h.onClockWindowState) { ipcRenderer.removeListener('clock-window-state', h.onClockWindowState); }
                if (h.onEscapeKeydown) { document.removeEventListener('keydown', h.onEscapeKeydown); }
                if (h.onGlobalShortcutsKeydown) { document.removeEventListener('keydown', h.onGlobalShortcutsKeydown); }
                this._handlers = {};

                if (this._audioCtx) {
                    this._audioCtx.close().catch(() => {});
                    this._audioCtx = null;
                }
            }

            // Команды таймера
            getConfig() {
                return {
                    allowNegative: this.allowNegativeEl.checked,
                    overrunLimitSeconds: this.readOverrunLimit()
                };
            }

            // Лимит перерасхода в секундах. 0 — без лимита (движок трактует 0 как
            // «считать в минус бесконечно»). Формат ввода тот же, что у поля
            // точного времени: 90 = 90 сек, 5:00 = 5 мин.
            readOverrunLimit() {
                const el = document.getElementById('overrunLimit');
                if (!el) { return 0; }
                const raw = String(el.value || '').trim();
                if (!raw) { return 0; }
                const parsed = window.TimeUtils.parseManualTime(raw);
                if (parsed === null || !Number.isFinite(parsed) || parsed < 0) { return 0; }
                return parsed;
            }

            // Подсказка справа от поля + подсветка неразобранного ввода.
            refreshOverrunLimitHint() {
                const el = document.getElementById('overrunLimit');
                const hint = document.getElementById('overrunLimitHint');
                if (!el || !hint) { return; }
                const raw = String(el.value || '').trim();
                const parsed = raw ? window.TimeUtils.parseManualTime(raw) : 0;
                const bad = raw !== '' && parsed === null;
                el.classList.toggle('input-error', bad);
                if (bad) { hint.textContent = 'не понял формат'; return; }
                const secs = this.readOverrunLimit();
                hint.textContent = secs > 0
                    ? `стоп на \u2212${window.TimeUtils.formatTimeShort(secs)}`
                    : 'без лимита';
            }

            sendCommand(type, extra = {}) {
                const cfg = this.getConfig();
                ipcRenderer.send('timer-command', { type, ...cfg, ...extra });
            }

            setTime(seconds) {
                if (this.isRunning) {return;}
                this.sendCommand('set', { seconds: Math.max(0, seconds) });
            }

            adjustTime(seconds) {
                this.sendCommand('adjust', { deltaSeconds: seconds });
            }

            start() {
                if (this.remainingSeconds <= 0 && !this.getConfig().allowNegative) {
                    // Небольшая анимация ошибки
                    this.controlTimeEl.style.animation = 'shake 0.3s';
                    setTimeout(() => this.controlTimeEl.style.animation = '', 300);
                    return;
                }
                this._localStartTriggered = true;
                this.sendCommand('start');
                // Не проигрываем звук старта при возобновлении из паузы (this.isPaused ещё отражает прежнее состояние)
                if (!this.isPaused && this.soundStartEl.checked) {this.playSound('start');}
            }

            pause() {
                this.sendCommand('pause');
            }

            reset() {
                this.sendCommand('reset');
            }

            // Отображение
            updateDisplay() {
                // Сплит знака и цифр держит цифры центрированными при переходе в минус.
                const _neg = this.remainingSeconds < 0;
                const _digits = this.formatTime(Math.abs(this.remainingSeconds));
                this.controlTimeSignEl.textContent = _neg ? '−' : '';
                this.controlTimeDigitsEl.textContent = _digits;

                // Цветовые классы для времени
                // Полоса срочности — общая для всех окон (RendererShared).
                this.controlTimeEl.classList.remove('warning', 'danger');
                const band = window.RendererShared.timerColorBand(this.remainingSeconds, this.totalSeconds);
                const isOvertime = band === 'overtime';
                if (isOvertime || band === 'danger') {
                    this.controlTimeEl.classList.add('danger');
                } else if (band === 'warning') {
                    this.controlTimeEl.classList.add('warning');
                }
                
                // Приоритеты статуса — общие для всех трёх окон, живут в
                // RendererShared.timerLifecycleStatus(). Здесь остаётся только
                // раскладка ключа в подпись и CSS-класс этого окна.
                const STATUS_TEXT = {
                    paused: 'Пауза',
                    overtime: 'Перерасход',
                    finished: 'Завершено',
                    running: 'Активен',
                    idle: 'Готов'
                };
                const status = window.RendererShared.timerLifecycleStatus({
                    remainingSeconds: this.remainingSeconds,
                    totalSeconds: this.totalSeconds,
                    isRunning: this.isRunning,
                    isPaused: this.isPaused,
                    finished: this.wasFinished
                });
                this.statusDot.className = 'status-dot';
                if (status !== 'idle') { this.statusDot.classList.add(status); }
                this.statusText.textContent = STATUS_TEXT[status];

                // Подпись героя принадлежит renderPanelState(): она зависит от
                // СОСТОЯНИЯ, а не только от знака остатка. Прежняя строка писала
                // сюда textContent и сносила разом и точку, и <span id="statusText">,
                // из-за чего в покое оставалось «Осталось» вместо «Длительность».

                // Полоса берёт время ОТСЮДА, а не считает своё: второй источник
                // времени — расхождение, которое проект уже ловил на дисплее.
                // `resume` — признак паузы, а не слово: как его показать, решает сама полоса.
                window.miniBar?.render({ text: (_neg ? '−' : '') + _digits,
                    band: isOvertime ? 'danger' : band, resume: !this.inputMode && !!this.isPaused });

                this.renderPanelState(status, band);
            }

            // Подсветка быстрого выбора выводится из состояния таймера, а не из
            // последнего клика — иначе она врёт после любого другого способа
            // задать время (ручной ввод, ±, горячие клавиши, команда из другого окна).
            syncPresetHighlight() {
                const preset = this.presetSeconds || 0;
                document.querySelectorAll('.preset').forEach(btn => {
                    const minutes = parseInt(btn.dataset.minutes, 10);
                    const matches = Number.isFinite(minutes) && preset > 0 && minutes * 60 === preset;
                    btn.classList.toggle('active', matches);
                });
            }

            updateControls() {
                // Какая кнопка на экране, решает состояние (CSS по классу на
                // <body>). disabled здесь снят намеренно: он оставался бы на
                // СКРЫТОЙ кнопке и глушил бы её, когда состояние её показывает.
                this.startBtn.disabled = false;
                this.pauseBtn.disabled = false;
            }

            // updateDisplaysList() живёт в panel-display.js (BUG-18: сохранённый
            // выбор монитора встраивался в CSS-селектор без экранирования).

            autoResizeWindow() {
                // Skip auto-resize while drawer is open — drawer manages width itself.
                if (this.settingsDrawerEl && this.settingsDrawerEl.classList.contains('open')) {
                    return;
                }
                // Временно убираем max-height с активного таба, чтобы измерить реальную высоту
                const activeTab = document.querySelector('.tab-content.active');
                if (activeTab) {
                    activeTab.style.maxHeight = 'none';
                    activeTab.style.overflow = 'visible';
                }

                const panel = document.querySelector('.control-panel');
                const contentHeight = panel.scrollHeight;
                const margin = 0; // shell is edge-to-edge; no transparent safe-area card
                const extra = 48; // titlebar/compositor breathing room

                const neededHeight = Math.ceil(contentHeight + margin + extra);

                // Восстанавливаем стили таба
                if (activeTab) {
                    activeTab.style.maxHeight = '';
                    activeTab.style.overflow = '';
                }

                ipcRenderer.send('resize-control-window', {
                    width: (window.CONFIG && CONFIG.CONTROL_WINDOW_WIDTH) || 380,
                    height: neededHeight
                });
            }

            formatTime(seconds) {
                return window.TimeUtils.formatTimeShort(seconds);
            }

            // FIX BUG-020: Add async/await for async operations
            async playSound(type) {
                if (!this.soundEnabled) { return; }
                if (this.soundMasterEl && !this.soundMasterEl.checked) { return; }

                const presetId = `sound${this.capitalize(type)}Preset`;
                const preset = document.getElementById(presetId)?.value || 'none';

                // '— без звука —' означает тишину. Раньше здесь играл beep(880),
                // из-за чего опцию было невозможно использовать по назначению.
                if (preset === 'none') { return; }

                await this.playPreset(preset);
            }

            async previewSound(type) {
                const presetId = `sound${this.capitalize(type)}Preset`;
                const preset = document.getElementById(presetId)?.value || 'none';

                // Превью должно звучать ровно так же, как реальное событие:
                // для 'none' это тишина — поясняем это тостом, чтобы кнопка
                // не выглядела сломанной.
                if (preset === 'none') {
                    Toast.show('Для этого события звук отключён', 'warning', 2000);
                    return;
                }

                await this.playPreset(preset);
            }

            // Синтез встроенных звуков вынесен в sound-bank.js — это была самая
            // крупная самодостаточная часть панели (≈470 строк чистого Web Audio
            // без обращений к DOM и состоянию). Здесь остаётся только владение
            // общим AudioContext и ветка пользовательских звуков.
            async playPreset(name) {
                if (name.startsWith('custom:')) {
                    await this.playCustomSound(name.replace('custom:', ''));
                    return;
                }

                // Один AudioContext на окно: браузеры ограничивают число
                // одновременных контекстов (~6), поэтому переиспользуем.
                if (!this._audioCtx || this._audioCtx.state === 'closed') {
                    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                const ctx = this._audioCtx;
                if (ctx.state === 'suspended') {
                    await ctx.resume();
                }

                window.SoundBank.playBuiltInPreset(ctx, name);
            }



            async beep(freq, dur) {
                // Переиспользуем AudioContext вместо создания нового каждый раз
                if (!this._audioCtx) {
                    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                const ctx = this._audioCtx;
                // Возобновляем AudioContext если он приостановлен
                if (ctx.state === 'suspended') {
                    await ctx.resume();
                }
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.connect(g);
                g.connect(ctx.destination);
                o.frequency.value = freq;
                g.gain.setValueAtTime(0.2, ctx.currentTime);
                g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
                o.start();
                o.stop(ctx.currentTime + dur);
            }

            capitalize(str) {
                return str.charAt(0).toUpperCase() + str.slice(1);
            }
        }

        // Пользовательские звуки живут в custom-sounds.js и подмешиваются в
        // прототип: их методы вызывают друг друга и общий this.beep(), а
        // обработчики в списке замыкаются на this. Примесь сохраняет семантику
        // this один в один, поэтому перенос кода был дословным.
        Object.assign(TimerController.prototype, window.CustomSoundsMixin);
        Object.assign(TimerController.prototype, window.LocalBackgroundMixin);
        Object.assign(TimerController.prototype, window.ThemeGridMixin);
        Object.assign(TimerController.prototype, window.PanelStateMixin);
        Object.assign(TimerController.prototype, window.PanelColorsMixin);
        // Настройки дисплея: сборка payload, тумблеры блоков, приём «закрыли крестиком».
        Object.assign(TimerController.prototype, window.PanelDisplayMixin);
        Object.assign(TimerController.prototype, window.PanelResetMixin);

        window.timerController = new TimerController();
        // Ряд «Фон» строится ПОСЛЕ конструктора: ему нужны загруженные цвета.
        window.timerController.initSurfaceControls();
        window.timerController.initResetButtons();

        // Пипетки трёх окон. Объект цветов НЕ пересобирается здесь: раньше
        // каждая писала `{ timer: hex, progress: hex }` целиком и вместе с
        // цветом цифр стирала бы выбранный фон окна. Сборка одна — updateColors.
        [
            { target: 'widget', grid: 'themesGrid', panel: 'widgetColorPickerPanel', ids: ['widgetCpSv', 'widgetCpHue', 'widgetCpHex', 'widgetCpPreview'] },
            { target: 'clock', grid: 'clockThemesGrid', panel: 'clockColorPickerPanel', ids: ['clockCpSv', 'clockCpHue', 'clockCpHex', 'clockCpPreview'] },
            { target: 'display', grid: 'displayThemesGrid', panel: 'displayColorPickerPanel', ids: ['displayCpSv', 'displayCpHue', 'displayCpHex', 'displayCpPreview'] }
        ].forEach(({ target, grid, panel, ids }) => {
            addPickerToggle(grid, panel, {
                sv: ids[0], hue: ids[1], hex: ids[2], preview: ids[3],
                onChange: (hex) => {
                    document.querySelectorAll(`#${grid} .theme-btn`).forEach(b => b.classList.remove('active'));
                    window.timerController.updateColors(target, { timer: hex, progress: hex });
                }
            });
        });

        // Отслеживание состояния окон
        let isDisplayOpen = false;
        let isWidgetOpen = false;
        let isClockOpen = false;

        // Функция обновления визуала кнопок
        // Сохраняем внутреннюю структуру span.qw-icon/span.qw-label — индикатор
        // активного состояния рисуется CSS (::after checkmark).
        function updateWindowButton(buttonId, isOpen) {
            const button = document.getElementById(buttonId);
            if (!button) { return; }

            button.classList.toggle('active', isOpen);
            // Тумблер строки объявлен role="switch" — состояние обязано
            // читаться скринридером, а не только глазом по цвету дорожки.
            if (button.getAttribute('role') === 'switch') {
                button.setAttribute('aria-checked', String(isOpen));
            }
            // Подзаголовок собирает panel-state.js: он читает ЖИВЫЕ значения
            // стиля, масштаба и монитора из самих контролов настроек. Первая
            // версия писала здесь просто «показан» — то есть теряла ровно ту
            // часть, ради которой строка и заведена.
            window.timerController?.renderWindowRows?.();
            if (isOpen) {
                button.title = button.title.replace(/открыть|Компактный|Часы в реальном|На весь экран/i, 'Закрыть');
            } else if (buttonId === 'openWidgetBtn') {
                button.title = 'Компактный виджет поверх окон (W)';
            } else if (buttonId === 'openClockBtn') {
                button.title = 'Часы в реальном времени (C)';
            } else if (buttonId === 'openDisplayBtn') {
                button.title = 'На весь экран для презентаций (D)';
            }
        }

        // Слушатели для обновления состояния окон
        if (window.ipcRenderer && window.timerController) {
            const tc = window.timerController;
            tc._handlers.onDisplayWindowState = (event, data) => {
                isDisplayOpen = data.isOpen;
                updateWindowButton('openDisplayBtn', isDisplayOpen);
            };
            tc._handlers.onWidgetWindowState = (event, data) => {
                isWidgetOpen = data.isOpen;
                updateWindowButton('openWidgetBtn', isWidgetOpen);
            };
            tc._handlers.onClockWindowState = (event, data) => {
                isClockOpen = data.isOpen;
                updateWindowButton('openClockBtn', isClockOpen);
            };
            window.ipcRenderer.on('display-window-state', tc._handlers.onDisplayWindowState);
            window.ipcRenderer.on('widget-window-state', tc._handlers.onWidgetWindowState);
            window.ipcRenderer.on('clock-window-state', tc._handlers.onClockWindowState);
        }

        // Кнопки кастомной панели заголовка
        document.getElementById('minimizeBtn').addEventListener('click', () => {
            if (window.ipcRenderer) {window.ipcRenderer.send('minimize-window');}
        });






        // Диалог подтверждения выхода
        const exitModal = document.getElementById('exitModal');
        const exitCancelBtn = document.getElementById('exitCancel');
        document.getElementById('closeAppBtn').addEventListener('click', () => {
            openModal(exitModal, exitCancelBtn);
        });
        exitCancelBtn.addEventListener('click', () => {
            closeModal(exitModal);
        });
        document.getElementById('exitConfirm').addEventListener('click', () => {
            if (window.ipcRenderer) {window.ipcRenderer.send('quit-app');}
        });
        exitModal.addEventListener('click', (e) => {
            if (e.target === exitModal) { closeModal(exitModal); }
        });

        // Cleanup при закрытии окна
        window.addEventListener('beforeunload', () => {
            window.timerController.cleanup();
        });

        // FAQ Modal Logic
        const faqBtn = document.getElementById('faqBtn');
        // Подсказка про F1 при первом запуске + кнопка «Проверить
        // обновления». Подробности и зависимости — в onboarding.js.
        window.Onboarding.init();
        // Режим «полоса». Логика — в mini-bar.js, здесь только проводка.
        const _tc = () => window.timerController;
        window.miniBar = window.MiniBar.init({ doc: document, ipc: window.ipcRenderer,
            // Сворачивание закрывает ящик И выходит из ввода: полей в полосе нет.
            onToggle: (on) => { if (on) { _tc()?.closeSettingsDrawer(); _tc()?.setInputMode(false); } },
            actions: { start: () => _tc()?.start(), pause: () => _tc()?.pause(), reset: () => _tc()?.reset() } });

        const faqModal = document.getElementById('faqModal');
        const faqClose = document.getElementById('faqClose');
        const faqQuestions = document.querySelectorAll('.faq-question');

        // Переключатель темы и замок «Закрепить положение» — panel-titlebar.js.
        // Обе величины общие для всех окон: локально применяются сразу,
        // остальным уезжают по IPC.
        window.PanelTitlebar.bindThemeToggle({ doc: document, ipc: window.ipcRenderer || null, theme: window.UITheme });
        window.PanelTitlebar.bindLockToggle({ doc: document, ipc: window.ipcRenderer || null, lock: window.UILock });

        // Пресеты вида: снимок ключей профиля и тот же путь применения, что при запуске панели.
        window.PanelCompact.bindCompactMode({ doc: document }); // компактный режим по ЗАМЕРУ
        window.presetsApi = window.PanelPresets.install({
            doc: document, storage: localStorage, presets: window.Presets, ipc: window.ipcRenderer || null,
            controller: () => window.timerController, notify: (msg) => window.Toast && window.Toast.show(msg, 'success', 1600)
        });
        // Open FAQ modal
        faqBtn.addEventListener('click', () => {
            openModal(faqModal, faqClose);
        });

        // Close FAQ modal
        faqClose.addEventListener('click', () => {
            closeModal(faqModal);
        });

        // Close on backdrop click
        faqModal.addEventListener('click', (e) => {
            if (e.target === faqModal) {
                closeModal(faqModal);
            }
        });

        // Reset settings modal
        const resetModal = document.getElementById('resetModal');
        const resetCancelBtn = document.getElementById('resetCancel');
        document.getElementById('resetSettingsBtn').addEventListener('click', () => {
            openModal(resetModal, resetCancelBtn);
        });
        resetCancelBtn.addEventListener('click', () => {
            closeModal(resetModal);
        });
        resetModal.addEventListener('click', (e) => {
            if (e.target === resetModal) { closeModal(resetModal); }
        });
        document.getElementById('resetConfirm').addEventListener('click', () => {
            localStorage.clear();
            ipcRenderer.send('reset-and-relaunch');
        });

        // Close on Escape key
        const _onEscapeKeydown = (e) => {
            if (e.key === 'Escape') {
                if (resetModal.classList.contains('show')) { closeModal(resetModal); }
                if (exitModal.classList.contains('show')) { closeModal(exitModal); }
                if (faqModal.classList.contains('show')) { closeModal(faqModal); }
            }
        };
        document.addEventListener('keydown', _onEscapeKeydown);
        if (window.timerController) {
            window.timerController._handlers.onEscapeKeydown = _onEscapeKeydown;
        }

        // Аккордеон справки: в секции открыт максимум один ответ.
        //
        // Обработчик здесь ЕДИНСТВЕННЫЙ и обязан таким остаться. Второй, добавленный
        // рядом, выглядит безобидно, но ломает раскрытие насмерть: первый ставит
        // класс `open`, второй видит `wasOpen === true`, снимает класс со всей
        // секции и обратно не возвращает — ответ мигает и остаётся закрытым.
        //
        // Состояние сообщается ассистивным технологиям здесь же, в одном месте с
        // классом: раньше вопрос был <div> без роли, без фокуса и без
        // aria-expanded — мышью работало, с клавиатуры нет.
        faqQuestions.forEach((question, i) => {
            const item = question.parentElement;
            const answer = item.querySelector('.faq-answer');
            if (answer && !answer.id) { answer.id = `faqAnswer${i}`; }
            if (answer) { question.setAttribute('aria-controls', answer.id); }

            question.addEventListener('click', () => {
                const wasOpen = item.classList.contains('open');
                const section = item.closest('.faq-section');

                section.querySelectorAll('.faq-item').forEach(i2 => {
                    i2.classList.remove('open');
                    const q2 = i2.querySelector('.faq-question');
                    if (q2) { q2.setAttribute('aria-expanded', 'false'); }
                });

                if (!wasOpen) {
                    item.classList.add('open');
                    question.setAttribute('aria-expanded', 'true');
                }
            });
        });

        // FIX BUG-027: Keyboard shortcuts
        const _onGlobalShortcutsKeydown = (event) => {
            // Ignore if user is typing in an input field
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }

            // Модификаторы отсекаем ЦЕЛИКОМ и в одном месте — ровно так, как это
            // делают виджет, часы и полноэкранный режим (`if (e.ctrlKey ||
            // e.altKey || e.metaKey) return`). Раньше здесь ветка Space не
            // проверяла модификаторы вообще, а остальные смотрели только
            // ctrl/meta: Alt+D закрывал полноэкранный режим, Alt+W убивал виджет,
            // а Ctrl+Space и Alt+Space (переключение раскладки и системное меню
            // окна на Windows) заодно дёргали таймер.
            if (event.ctrlKey || event.altKey || event.metaKey) { return; }

            // Space: Start/Pause timer
            if (event.code === 'Space') {
                event.preventDefault();
                if (window.timerController) {
                    if (window.timerController.isRunning) {
                        window.timerController.pause();
                    } else {
                        window.timerController.start();
                    }
                }
            }

            // R: Reset timer
            else if (event.code === 'KeyR') {
                event.preventDefault();
                if (window.timerController) {
                    window.timerController.reset();
                }
            }

            // S: Stop timer (pause)
            else if (event.code === 'KeyS') {
                event.preventDefault();
                if (window.timerController) {
                    window.timerController.pause();
                }
            }

            // W: Toggle widget (open/close)
            else if (event.code === 'KeyW') {
                event.preventDefault();
                if (window.ipcRenderer) {
                    if (isWidgetOpen) {
                        window.ipcRenderer.send('close-widget');
                    } else {
                        window.ipcRenderer.send('open-widget');
                    }
                }
            }

            // C: Toggle clock widget (open/close)
            else if (event.code === 'KeyC') {
                event.preventDefault();
                if (window.ipcRenderer) {
                    if (isClockOpen) {
                        window.ipcRenderer.send('close-clock-widget');
                    } else {
                        window.ipcRenderer.send('open-clock-widget');
                        if (window.timerController) {
                            setTimeout(() => {
                                window.timerController.pushClockSettings();
                                const tc = window.timerController;
                                const clockStyle = tc.syncClockStyle ? tc.timerStyleEl.value : tc.clockStyleEl.value;
                                window.ipcRenderer.send('clock-widget-set-style', clockStyle);
                            }, 500);
                        }
                    }
                }
            }

            // D: Toggle display (open/close fullscreen)
            else if (event.code === 'KeyD') {
                event.preventDefault();
                if (window.ipcRenderer) {
                    if (isDisplayOpen) {
                        window.ipcRenderer.send('close-display');
                    } else {
                        const displayIndex = document.getElementById('displaySelect')?.value || 'auto';
                        window.ipcRenderer.send('open-display', { displayIndex });
                    }
                }
            }

            // 1–4: пресеты (5, 15, 25, 45 минут). 5: своё время.
            // Диапазон клавиш выводится ИЗ реестра, а не пишется числом: после
            // редизайна длительностей стало четыре, и вторая копия числа «8»
            // здесь означала бы setTime(undefined) на клавишах 5–8.
            else if (event.code >= 'Digit1' && event.code <= 'Digit9') {
                const presets = window.CONFIG.PRESET_DURATIONS;
                const presetIndex = parseInt(event.code.replace('Digit', '')) - 1;
                if (presetIndex < presets.length) {
                    event.preventDefault();
                    if (window.timerController) {
                        window.timerController.setTime(presets[presetIndex]);
                    }
                } else if (presetIndex === presets.length) {
                    // Клавиша сразу за последним пресетом — та же «мин».
                    event.preventDefault();
                    window.timerController?.setInputMode(true);
                }
            }

            // Ветки Escape здесь БОЛЬШЕ НЕТ (просьба 24.08.2026: «сделать так,
            // чтобы ескейп не выключал окна»). Она гасила разом дисплей, виджет
            // и часы, и потому требовала охранника `_isEscapeConsumedByOverlay`:
            // одно нажатие закрывало модалку И убивало три окна. Охранник ушёл
            // вместе с веткой — сторожить больше нечего, а слои (справка,
            // модалки, ящик, ручной ввод) как обрабатывали Esc сами, так и
            // обрабатывают. Закрыть окно по-прежнему можно буквой: W / C / D.

            // Z: мастер-звук (S занята паузой, M — полосой). Общий путь — тот
            // же, что у клика по тумблеру строки (panel-state.js).
            else if (event.code === 'KeyZ') {
                event.preventDefault();
                window.timerController?.toggleSoundMaster();
            }

            // M: свернуть окно в полосу и обратно. Клавиша выбрана по коду из
            // свободных; модификаторы не трогаем — Cmd+M остаётся за системой.
            else if (event.code === 'KeyM') {
                event.preventDefault();
                if (window.miniBar) { window.miniBar.toggle(); }
            }

            // F1: Show help/shortcuts
            else if (event.code === 'F1') {
                event.preventDefault();
                showKeyboardShortcuts();
            }
        };
        document.addEventListener('keydown', _onGlobalShortcutsKeydown);
        if (window.timerController) {
            window.timerController._handlers.onGlobalShortcutsKeydown = _onGlobalShortcutsKeydown;
        }
