'use strict';

/**
 * panel-display.js — настройки полноэкранного окна в панели: ОДНА сборка их
 * payload, проводка тумблеров блоков и приём «блок закрыли крестиком».
 *
 * Зачем модуль, а не строки в inline-скрипте:
 *
 * 1. Блоков дисплея стало пять, и у каждого свой тумблер (17.08.2026). Список
 *    тумблеров нужен в ТРЁХ местах панели — навесить обработчики, собрать
 *    payload, принять сообщение о закрытии крестиком. Три копии списка — это
 *    ровно тот дефект, ради которого написан settings-schema.js: блок
 *    добавляют в одну копию и забывают в другой, и настройка работает до
 *    перезапуска. Здесь список ОДИН, и он тот же, что в таблице настроек.
 *
 * 2. Потолок `electron-control.html` (tests/control-decomposition.test.js)
 *    сработал по назначению: первая версия правки писала всё это прямо в
 *    inline-скрипте и упёрлась в него. Заодно наружу уехала `pushDisplaySettings`
 *    — единственная сборка payload канала `display-settings-update`.
 *
 * Это ПРОТОТИПНЫЙ МИКСИН, как panel-colors.js и panel-state.js: методы
 * обращаются к this.currentBgMode, this.syncClockStyle, this.saveExtSettings()
 * и к полям контроллера с ссылками на контролы. Если строка Object.assign
 * потеряется, при загрузке не упадёт ничего — упадёт при первом клике.
 *
 * Чистая часть (collectDisplayToggles на переданном документе) проверяется в
 * Node на поддельном DOM.
 */

/**
 * Тумблеры дисплея: пять блоков и две подписи.
 *
 * Сам перечень живёт в settings-schema.js — он нужен ещё и главному процессу
 * (проверка имени блока, пришедшего из окна), а таблица настроек и без того
 * владеет ключами. Здесь только разделение обязанностей: крестик на дисплее
 * закрывает БЛОКИ, подписи выключаются лишь тумблером в панели.
 */
const Schema = (typeof window !== 'undefined' && window.SettingsSchema)
    ? window.SettingsSchema
    : require('./settings-schema');
const BLOCK_KEYS = Schema.DISPLAY_BLOCK_KEYS;
const LABEL_KEYS = Schema.DISPLAY_LABEL_KEYS;
const DISPLAY_TOGGLE_KEYS = BLOCK_KEYS.concat(LABEL_KEYS);

/**
 * Реестр подписей: id элемента → ключ настройки и стандартное слово.
 *
 * Берётся из display-layouts.js, а не пишется здесь списком: то же знание
 * нужно дисплею (подставить стандартную подпись) и тесту (сверить разметку),
 * и три копии слова «Начало» разъехались бы молча.
 */
const Layouts = (typeof window !== 'undefined' && window.DisplayLayouts)
    ? window.DisplayLayouts
    : require('./display-layouts');

/**
 * Значения полей с кастомными подписями блоков.
 *
 * @param {Document} doc
 * @returns {object} ключ настройки → введённая строка (как есть)
 *
 * Обрезкой и подстановкой умолчания занимается ДИСПЛЕЙ (blockCaption): панель
 * хранит ровно то, что человек напечатал, иначе его собственный текст
 * менялся бы под курсором.
 */
function collectBlockLabels(doc) {
    const out = {};
    for (const el of Layouts.LABELLED_ELEMENTS) {
        const node = doc.getElementById(el.labelKey);
        if (node) { out[el.labelKey] = String(node.value || ''); }
    }
    return out;
}

/**
 * Значения всех тумблеров дисплея одним объектом.
 *
 * @param {Document} doc
 * @returns {object} ключ → boolean; отсутствующий контрол пропускается
 */
function collectDisplayToggles(doc) {
    const out = {};
    for (const key of DISPLAY_TOGGLE_KEYS) {
        const el = doc.getElementById(key);
        if (el) { out[key] = !!el.checked; }
    }
    return out;
}

const PanelDisplayMixin = {

    /**
     * Единственная сборка payload канала `display-settings-update`.
     *
     * Здесь же и сохранение: настройки дисплея пишутся в `displayExtSettings`
     * тем же движением, каким уходят в окно. Разъехаться этим двум нельзя —
     * иначе после перезапуска дисплей получит не то, что показывал.
     */
    pushDisplaySettings() {
        this.saveExtSettings();

        const parse = window.SecurityUtils.safeJSONParse;
        const localBgImage = localStorage.getItem('localBgImage') || '';
        const localBgSettings = parse(localStorage.getItem('localBgSettings'), {});

        const styleEl = this.displayTimerStyleEl || this.timerStyleEl;
        const scaleEl = this.displayTimerScaleEl || this.timerScaleEl;

        const settings = Object.assign({
            clockStyle: this.syncClockStyle
                ? this.timerStyleEl.value
                : (this.clockStyleEl ? this.clockStyleEl.value : 'circle'),
            bgMode: this.currentBgMode,
            bgSolid: document.getElementById('bgSolidColor').value,
            bgGrad1: document.getElementById('bgGrad1').value,
            bgGrad2: document.getElementById('bgGrad2').value,
            bgLocalImage: this.currentBgMode === 'local' ? localBgImage : '',
            bgLocalFit: localBgSettings.fit || 'cover',
            bgLocalOverlay: localBgSettings.overlay || 30,
            eventTime: this.eventTimeInputEl.value,
            endTime: this.endTimeInputEl.value,
            eventTitle: this.eventTitleInputEl ? this.eventTitleInputEl.value : '',
            timeBlocksScale: parseInt(this.timeBlocksScaleEl.value, 10),
            // Стиль и масштаб идут ПОД СВОИМИ именами. Общие
            // `timerStyle`/`timerScale` остаются рядом: на них опирается откат
            // на предыдущую версию и существующие e2e-спеки, которые шлют голое
            // общее имя. В localStorage под общим именем лежит стиль ВИДЖЕТА
            // (settings-schema.js, alsoWrite), поэтому дисплей выбирает своё имя
            // первым — см. pickOwnSetting в display-script.js.
            displayTimerStyle: styleEl.value,
            displayTimerScale: parseInt(scaleEl.value, 10),
            timerStyle: styleEl.value,
            timerScale: parseInt(scaleEl.value, 10),
            displayDigitsFont: this.displayDigitsFontEl ? this.displayDigitsFontEl.value : 'inter',
            // Скрытый режим «47-й этаж». Ставка идёт СТРОКОЙ — к числу её
            // приводит money-meter.js, один раз и одинаково для обоих счётчиков.
            overrunPrice: this.overrunPriceEl ? this.overrunPriceEl.value : '1000',
            overrunPeriod: this.overrunPeriodEl ? this.overrunPeriodEl.value : '3',
            floor47Unlocked: this.isFloor47Unlocked()
        }, collectDisplayToggles(document), collectBlockLabels(document));

        window.ipcRenderer.send('display-settings-update', settings);
    },

    /**
     * Проводка тумблеров блоков, полей времени и названия — одним списком.
     *
     * Прежде здесь стоял общий тумблер «Показывать блоки», который ещё и прятал
     * ряды настроек. Ряды теперь видны всегда: они описывают блоки независимо
     * от того, показан ли каждый, а спрятанный ряд — это настройка, которой для
     * пользователя не существует.
     */
    bindDisplayBlockControls() {
        for (const key of DISPLAY_TOGGLE_KEYS) {
            const el = document.getElementById(key);
            if (el) { el.addEventListener('change', () => this.pushDisplaySettings()); }
        }
        if (this.eventTimeInputEl) {
            this.eventTimeInputEl.addEventListener('change', () => this.pushDisplaySettings());
        }
        if (this.endTimeInputEl) {
            this.endTimeInputEl.addEventListener('change', () => this.pushDisplaySettings());
        }
        if (this.eventTitleInputEl) {
            this.eventTitleInputEl.addEventListener('input', () => this.pushDisplaySettings());
        }
        // Замок читается ДО рядов подписей: ряды спрашивают его про секретные
        // элементы. bindFloor47 в конце сам зовёт renderFloor47, а тот —
        // bindBlockLabelRows, поэтому второго вызова здесь нет.
        this.bindFloor47();
    },

    /**
     * Поля «своё название плашки» — по одному на блок времени.
     *
     * Разметку строит модуль, а не HTML: список блоков живёт в реестре
     * (display-layouts.js), и ряды обязаны выводиться ИЗ него. Стандартное
     * слово стоит и подписью ряда, и placeholder'ом поля — так видно, что
     * покажет дисплей, если поле оставить пустым.
     *
     * Значение поля таблица настроек раскладывает сама (ключ = id контрола),
     * поэтому ряды строятся ДО applyStoredSettings — иначе класть было бы
     * некуда. Порядок держит bindDisplayBlockControls, вызываемая при сборке
     * контроллера.
     */
    isFloor47Unlocked() {
        return !!(this.floor47UnlockedEl && this.floor47UnlockedEl.checked);
    },

    /**
     * Скрытый режим «47-й этаж».
     *
     * Разблокировка — тройной клик по строке подсказок в подвале панели. Один
     * жест мышью, без клавиатуры и без открытия справки; строка неинтерактивна,
     * случайно трижды по ней не щёлкают. Это УДОБСТВО, а не защита: кто откроет
     * профиль — увидит флаг. Настоящего замка здесь нет, и делать вид, что есть,
     * не нужно: задача — чтобы контролы про деньги не мозолили глаза на обычных
     * мероприятиях.
     *
     * `event.detail` считает браузер: у третьего клика подряд он равен 3. Свой
     * счётчик с таймаутом был бы второй реализацией того же и разъехался бы с
     * первой при первой же правке.
     */
    /**
     * Разметка скрытого режима: секция настроек и модалка подтверждения.
     *
     * Строит МОДУЛЬ, а не HTML, — по тому же правилу, что ряды подписей выше и
     * ряд «Фон» в panel-colors.js. Здесь у него есть и вторая причина:
     * `electron-control.html` живёт под храповиком (tests/control-decomposition),
     * и число его строк может только убывать. Пятьдесят строк статики внутри
     * god-файла подняли бы потолок, а потолок не поднимают.
     *
     * Строится ДО applyStoredSettings: таблица настроек раскладывает значения
     * по getElementById, и класть их было бы некуда. Порядок держит
     * bindDisplayBlockControls, вызываемая при сборке контроллера.
     */
    buildFloor47Markup() {
        const mount = document.getElementById('floor47Mount');
        if (!mount || document.getElementById('floor47Section')) { return; }

        const row = (labelText, forId, control) => {
            const r = document.createElement('div');
            r.className = 'toggle-row';
            const label = document.createElement('label');
            label.className = 'toggle-label';
            label.setAttribute('for', forId);
            label.textContent = labelText;
            r.appendChild(label);
            r.appendChild(control);
            return r;
        };

        const numberInput = (id, min, step, aria) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.id = id;
            input.className = 'srow-input';
            input.min = String(min);
            input.step = String(step);
            input.inputMode = 'numeric';
            input.setAttribute('aria-label', aria);
            return input;
        };

        // Тумблер повторяет разметку соседей: label.toggle-switch + чекбокс +
        // span.toggle-slider. Без span правило CSS не находит ползунок, и
        // чекбокс остаётся системным.
        const toggle = (id) => {
            const wrap = document.createElement('label');
            wrap.className = 'toggle-switch';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = id;
            const slider = document.createElement('span');
            slider.className = 'toggle-slider';
            wrap.appendChild(input);
            wrap.appendChild(slider);
            return wrap;
        };

        const section = document.createElement('div');
        section.className = 'settings-group';
        section.id = 'floor47Section';
        section.hidden = true;

        const title = document.createElement('div');
        title.className = 'settings-subtitle';
        title.textContent = 'Перелимит доклада';
        section.appendChild(title);

        section.appendChild(row('Сумма, ₽', 'overrunPrice',
            numberInput('overrunPrice', 0, 100, 'Сумма штрафа за перелимит, рублей')));
        section.appendChild(row('За каждые, сек', 'overrunPeriod',
            numberInput('overrunPeriod', 1, 1, 'Период начисления штрафа, секунд')));
        section.appendChild(row('Показывать перелимит', 'showOverrunCost', toggle('showOverrunCost')));
        section.appendChild(row('Показывать итог', 'showTotalCost', toggle('showTotalCost')));

        const actions = document.createElement('div');
        actions.className = 'toggle-row floor47-actions';
        for (const [id, text] of [['eventFinishBtn', 'Завершить мероприятие'], ['eventResetBtn', 'Новое мероприятие']]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'reset-btn';
            btn.id = id;
            btn.textContent = text;
            actions.appendChild(btn);
        }
        section.appendChild(actions);
        section.appendChild(row('Показывать этот раздел', 'floor47Unlocked', toggle('floor47Unlocked')));
        mount.appendChild(section);

        // Модалка подтверждения — копия разметки #resetModal: подтверждения в
        // этом проекте делаются модалкой с ловушкой фокуса (modal-manager.js),
        // а window.confirm не используется нигде.
        const modal = document.createElement('div');
        modal.className = 'reset-modal';
        modal.id = 'eventResetModal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'eventResetModalTitle');
        const dialog = document.createElement('div');
        dialog.className = 'reset-dialog';
        const h3 = document.createElement('h3');
        h3.id = 'eventResetModalTitle';
        h3.textContent = 'Обнулить итог мероприятия?';
        const p = document.createElement('p');
        p.textContent = 'Накопленная сумма перелимита будет стёрта насовсем. Настройки и ставка останутся.';
        const buttons = document.createElement('div');
        buttons.className = 'reset-dialog-buttons';
        for (const [id, cls, text] of [
            ['eventResetCancel', 'reset-btn-cancel', 'Отмена'],
            ['eventResetConfirm', 'reset-btn-confirm', 'Обнулить']
        ]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = cls;
            btn.id = id;
            btn.textContent = text;
            buttons.appendChild(btn);
        }
        dialog.appendChild(h3);
        dialog.appendChild(p);
        dialog.appendChild(buttons);
        modal.appendChild(dialog);
        document.body.appendChild(modal);
    },

    bindFloor47() {
        this.buildFloor47Markup();
        this.overrunPriceEl = document.getElementById('overrunPrice');
        this.overrunPeriodEl = document.getElementById('overrunPeriod');
        this.floor47UnlockedEl = document.getElementById('floor47Unlocked');
        this.floor47SectionEl = document.getElementById('floor47Section');

        const footer = document.getElementById('panelFooter');
        if (footer) {
            footer.addEventListener('click', (event) => {
                if (event.detail < 3 || !this.floor47UnlockedEl) { return; }
                this.floor47UnlockedEl.checked = true;
                this.renderFloor47();
                this.pushDisplaySettings();
            });
        }

        for (const el of [this.overrunPriceEl, this.overrunPeriodEl]) {
            if (el) { el.addEventListener('input', () => this.pushDisplaySettings()); }
        }

        // Тумблеры денег подписывает ТОТ, КТО ИХ СТРОИТ.
        //
        // Общий проход по ключам таблицы в bindDisplayBlockControls случается
        // РАНЬШЕ, чем эта секция появляется в документе, — там их ещё нет, и
        // обработчик им не достаётся. Симптом был бесшумный: тумблер щёлкал,
        // галочка вставала, а в окно не уходило ничего.
        for (const el of Layouts.SECRET_ELEMENTS) {
            const node = document.getElementById(el.toggle);
            if (node) { node.addEventListener('change', () => this.pushDisplaySettings()); }
        }
        if (this.floor47UnlockedEl) {
            this.floor47UnlockedEl.addEventListener('change', () => {
                this.renderFloor47();
                this.pushDisplaySettings();
            });
        }

        const finishBtn = document.getElementById('eventFinishBtn');
        if (finishBtn) {
            finishBtn.addEventListener('click', () => {
                window.ipcRenderer.send('event-finish');
            });
        }

        // Обнуление необратимо, поэтому спрашивается модалкой проекта:
        // window.confirm здесь не используется нигде, зато есть три модалки с
        // ловушкой фокуса и возвратом фокуса (modal-manager.js).
        const resetBtn = document.getElementById('eventResetBtn');
        const resetModal = document.getElementById('eventResetModal');
        const resetCancel = document.getElementById('eventResetCancel');
        const resetConfirm = document.getElementById('eventResetConfirm');
        if (resetBtn && resetModal) {
            resetBtn.addEventListener('click', () => window.openModal(resetModal, resetCancel));
        }
        if (resetCancel) {
            resetCancel.addEventListener('click', () => window.closeModal(resetModal));
        }
        if (resetConfirm) {
            resetConfirm.addEventListener('click', () => {
                window.ipcRenderer.send('event-reset');
                window.closeModal(resetModal);
            });
        }

        this.renderFloor47();
    },

    /** Секция видна ровно тогда, когда режим разблокирован. */
    renderFloor47() {
        if (this.floor47SectionEl) {
            this.floor47SectionEl.hidden = !this.isFloor47Unlocked();
        }
        // Ряды подписей строятся из реестра и знают про секретность, поэтому
        // после смены замка их надо пересобрать.
        this.bindBlockLabelRows();
    },

    bindBlockLabelRows() {
        const mount = document.getElementById('blockLabelRows');
        const Layouts = window.DisplayLayouts;
        if (!mount || !Layouts) { return; }
        mount.textContent = '';
        for (const el of Layouts.LABELLED_ELEMENTS) {
            // Ряд секретного элемента строится только при разблокировке: иначе
            // поле «своё название плашки Итого» увидел бы каждый.
            if (el.secret && !this.isFloor47Unlocked()) { continue; }
            const row = document.createElement('div');
            row.className = 'toggle-row';

            const label = document.createElement('label');
            label.className = 'toggle-label';
            label.setAttribute('for', el.labelKey);
            label.textContent = el.caption;

            const input = document.createElement('input');
            input.type = 'text';
            input.id = el.labelKey;
            input.className = 'srow-input';
            input.maxLength = Layouts.MAX_CAPTION;
            input.placeholder = el.caption;
            input.setAttribute('aria-label', `Своё название плашки «${el.caption}»`);
            input.addEventListener('input', () => this.pushDisplaySettings());

            row.appendChild(label);
            row.appendChild(input);
            mount.appendChild(row);
        }
    },

    /**
     * Кнопки готовых раскладок. Разметку строит модуль — в HTML только точка
     * монтирования, как у ряда «Фон» в panel-colors.js: перечень раскладок
     * живёт в display-layouts.js, и вторая его копия в вёрстке разъехалась бы
     * с первой при первом же добавлении раскладки.
     */
    bindDisplayLayouts() {
        const grid = document.getElementById('displayLayoutGrid');
        const Layouts = window.DisplayLayouts;
        if (!grid || !Layouts) { return; }
        grid.textContent = '';
        for (const layout of Layouts.LAYOUTS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'layout-btn';
            button.dataset.layout = layout.id;
            button.textContent = layout.name;
            button.title = layout.hint;
            // Кнопка НЕ переключатель: раскладка — действие, а не состояние.
            // Отмеченная как выбранная, она врала бы уже после первого
            // перетаскивания блока на дисплее.
            button.setAttribute('aria-label', `Раскладка «${layout.name}»: ${layout.hint}`);
            button.addEventListener('click', () => this.applyDisplayLayout(layout.id));
            grid.appendChild(button);
        }
    },

    /**
     * Применить раскладку.
     *
     * Порядок из двух шагов несущий: сначала УХОДЯТ НАСТРОЙКИ с тумблерами,
     * потом отдельным каналом — сама раскладка. Дисплей раскладывает по живым
     * габаритам элементов, а у выключенного элемента прямоугольник нулевой:
     * приди раскладка первой, включённый ею блок раскладывать было бы не по чему.
     *
     * Тумблерами и масштабом таймера владеет панель — поэтому здесь меняются её
     * собственные контролы, а не посылается «поставь такой-то тумблер».
     */
    applyDisplayLayout(layoutId) {
        const Layouts = window.DisplayLayouts;
        const layout = Layouts && Layouts.layoutById(layoutId);
        if (!layout) { return; }

        for (const [key, on] of Object.entries(Layouts.layoutToggles(layout))) {
            const el = document.getElementById(key);
            if (el) { el.checked = on; }
        }

        const scaleEl = this.displayTimerScaleEl || this.timerScaleEl;
        if (scaleEl) {
            scaleEl.value = String(layout.timerScale);
            const label = document.getElementById('displayTimerScaleValue');
            if (label) { label.textContent = layout.timerScale + '%'; }
        }

        this.pushDisplaySettings();
        window.ipcRenderer.send('display-layout', { layout: layout.id });

        if (window.Toast && window.Toast.show) {
            window.Toast.show(`Раскладка «${layout.name}»`, 'success');
        }
    },

    /**
     * Блок закрыли крестиком прямо на дисплее.
     *
     * Владелец настройки — панель: она снимает тумблер и рассылает настройки
     * заново. Дисплей гасит блок у себя сразу (чтобы он исчез в тот же кадр), но
     * СОСТОЯНИЕ хранится здесь и только здесь — иначе после переоткрытия окна
     * блок вернулся бы.
     */
    onDisplayBlockHidden(payload) {
        const key = payload && payload.block;
        // Крестик есть и у подписей, поэтому проверяется ВЕСЬ список тумблеров,
        // а не только блоки.
        if (!DISPLAY_TOGGLE_KEYS.includes(key)) { return; }
        const el = document.getElementById(key);
        if (!el || !el.checked) { return; }
        el.checked = false;
        this.pushDisplaySettings();
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
    PanelDisplayMixin, collectDisplayToggles, collectBlockLabels,
    BLOCK_KEYS, LABEL_KEYS, DISPLAY_TOGGLE_KEYS
};
}

if (typeof window !== 'undefined') {
    window.PanelDisplayMixin = PanelDisplayMixin;
    window.PanelDisplay = {
        collectDisplayToggles, collectBlockLabels,
        BLOCK_KEYS, LABEL_KEYS, DISPLAY_TOGGLE_KEYS
    };
}
