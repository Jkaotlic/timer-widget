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
            displayDigitsFont: this.displayDigitsFontEl ? this.displayDigitsFontEl.value : 'inter'
        }, collectDisplayToggles(document));

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
    module.exports = { PanelDisplayMixin, collectDisplayToggles, BLOCK_KEYS, LABEL_KEYS, DISPLAY_TOGGLE_KEYS };
}

if (typeof window !== 'undefined') {
    window.PanelDisplayMixin = PanelDisplayMixin;
    window.PanelDisplay = { collectDisplayToggles, BLOCK_KEYS, LABEL_KEYS, DISPLAY_TOGGLE_KEYS };
}
