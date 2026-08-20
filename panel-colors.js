'use strict';

/**
 * panel-colors.js — цвета окон в панели управления: ОДНА сборка объекта цветов
 * и ряд «Фон» (цвет подложки + прозрачность + сбросы) для виджета и часов.
 *
 * Зачем модуль, а не пара строк в inline-скрипте:
 *
 * 1. Объект цветов окна собирался в ЧЕТЫРЁХ местах — в трёх обработчиках
 *    пипетки (`tc.currentColors = { timer: hex, progress: hex }`) и в клике по
 *    свотчу темы (theme-grid.js). Каждое из них ЗАМЕЩАЛО объект целиком. Пока
 *    полей было два, это сходило с рук; с добавлением фона любой такой путь
 *    молча стирал бы выбранный фон — ровно тот класс дефектов, про который в
 *    CLAUDE.md записано «соберите payload в одном месте». Здесь сборка одна:
 *    updateColors(target, patch) сливает патч с сохранённым состоянием, а
 *    `null` в патче означает «сбрось это поле».
 *
 * 2. Разметка ряда «Фон» тоже живёт здесь. Потолок electron-control.html —
 *    сторож tests/control-decomposition.test.js — оставлял считаные строки, и
 *    статическая вёрстка четырёх контролов в двух экземплярах в него не
 *    помещалась. В HTML остались две точки монтирования, остальное строится
 *    DOM-вызовами (как у theme-grid.js).
 *
 * Это ПРОТОТИПНЫЙ МИКСИН: методы обращаются к this.currentColors /
 * this.clockColors / this.displayColors, к this.saveColors() и к
 * this.highlightActiveThemes(). Если строка Object.assign потеряется, при
 * загрузке не упадёт ничего — упадёт при первом клике по фону.
 *
 * Чистая часть (mergeColors) экспортируется отдельно и проверяется в Node.
 */

// Куда какое окно кладёт свои цвета. Таблица одна и та же для сборки, сброса и
// отрисовки контролов — иначе появится второй список полей.
const COLOR_TARGETS = {
    widget: { field: 'currentColors', label: 'виджета' },
    clock: { field: 'clockColors', label: 'часов' },
    display: { field: 'displayColors', label: 'полноэкранного окна' }
};

/**
 * Из каких полей состоит объект цветов окна.
 *
 * Список нужен ВТОРОЙ стороне — сбросу («Сбросить всё» обнуляет все поля), и
 * держать его там своей копией нельзя: добавленное поле молча пережило бы
 * сброс. Ровно так после сброса и оставалось `bg` — единственное поле, которого
 * не было в копии списка внутри panel-reset.js.
 */
const COLOR_FIELDS = ['timer', 'progress', 'bg', 'surface', 'surfaceAlpha'];

// Окна, у которых настраивается подложка. У полноэкранного окна фон свой
// (сплошной/градиент/картинка) — вторая пара контролов там означала бы двух
// владельцев одного значения.
const SURFACE_TARGETS = ['widget', 'clock'];

/**
 * Чистое слияние: `null`/`undefined` в патче УДАЛЯЕТ поле, а не пишет пустоту.
 * Разница видна снаружи: удалённого поля в объекте нет, и окно читает это как
 * «владелец значения по умолчанию — CSS».
 *
 * @param {object|null} current
 * @param {object} patch
 * @returns {object}
 */
function mergeColors(current, patch) {
    const next = Object.assign({}, current || {});
    Object.keys(patch || {}).forEach((key) => {
        const value = patch[key];
        if (value === null || value === undefined) { delete next[key]; }
        else { next[key] = value; }
    });
    return next;
}

/** Компактная сборка DOM: модуль владеет своей разметкой целиком. */
function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.keys(props || {}).forEach((key) => {
        if (key === 'class') { node.className = props[key]; }
        else if (key === 'text') { node.textContent = props[key]; }
        else if (key === 'role' || key === 'for' || key === 'type' || key.startsWith('aria-')) {
            node.setAttribute(key, props[key]);
        } else { node[key] = props[key]; }
    });
    (children || []).forEach((child) => node.appendChild(child));
    return node;
}

const PanelColorsMixin = {
    /**
     * ЕДИНСТВЕННОЕ место, где меняется объект цветов окна.
     * @param {'widget'|'clock'|'display'} target
     * @param {object} patch поля цветов; null означает сброс поля
     */
    updateColors(target, patch) {
        const spec = COLOR_TARGETS[target];
        if (!spec) { return; }
        this[spec.field] = mergeColors(this[spec.field], patch);
        // Сохранение и отправка остаются за saveColors(): там уже один владелец
        // канала на каждое окно.
        this.saveColors(target);
        this.renderSurfaceControls();
    },

    /** Строит ряд «Фон» для виджета и часов. Вызывается один раз при старте. */
    initSurfaceControls() {
        this.surfacePickers = {};
        SURFACE_TARGETS.forEach((target) => this.buildSurfaceRow(target));
        this.renderSurfaceControls();
    },

    buildSurfaceRow(target) {
        const mount = document.getElementById(target + 'SurfaceRow');
        if (!mount) { return; }
        const spec = COLOR_TARGETS[target];
        mount.className = 'surface-row';

        const swatch = el('button', {
            type: 'button',
            class: 'surface-swatch',
            title: 'Выбрать цвет фона',
            'aria-label': 'Выбрать цвет фона ' + spec.label,
            'aria-expanded': 'false'
        });
        const resetSurface = el('button', {
            type: 'button',
            class: 'surface-reset surface-reset-bg',
            text: 'Сбросить',
            title: 'Вернуть фон стиля по умолчанию',
            'aria-label': 'Сбросить фон ' + spec.label
        });
        const alphaId = target + 'SurfaceAlpha';
        const alpha = el('input', {
            type: 'range',
            class: 'surface-alpha',
            id: alphaId,
            min: '0',
            max: '100',
            step: '1',
            value: '100'
        });
        const alphaValue = el('span', { class: 'surface-alpha-value', text: '100%' });
        const resetTimer = el('button', {
            type: 'button',
            class: 'surface-reset surface-reset-timer',
            text: 'Сбросить',
            title: 'Вернуть цвет цифр по умолчанию',
            'aria-label': 'Сбросить цвет цифр ' + spec.label
        });

        // Панель пипетки — тот же класс, что у остальных трёх: стили и поведение
        // общие, отличается только владелец значения.
        const panelId = target + 'SurfaceCpPanel';
        const svId = target + 'SurfaceCpSv';
        const hueId = target + 'SurfaceCpHue';
        const hexId = target + 'SurfaceCpHex';
        const previewId = target + 'SurfaceCpPreview';
        const pickerPanel = el('div', { class: 'color-picker-panel', id: panelId }, [
            el('canvas', { class: 'cp-sv-canvas', id: svId }),
            el('canvas', { class: 'cp-hue-slider', id: hueId }),
            el('div', { class: 'cp-hex-row' }, [
                el('div', { class: 'cp-preview', id: previewId }),
                el('input', {
                    type: 'text',
                    class: 'cp-hex-input',
                    id: hexId,
                    maxLength: 7,
                    placeholder: '#ffffff',
                    'aria-label': 'HEX-код фона ' + spec.label
                })
            ])
        ]);

        mount.appendChild(el('div', { class: 'surface-line' }, [
            el('span', { class: 'surface-label', text: 'Фон' }), swatch, resetSurface
        ]));
        mount.appendChild(pickerPanel);
        mount.appendChild(el('div', {
            class: 'surface-line', id: target + 'AlphaLine'
        }, [
            el('label', { class: 'surface-label', for: alphaId, text: 'Прозрачность' }),
            alpha, alphaValue
        ]));
        mount.appendChild(el('div', { class: 'surface-line' }, [
            el('span', { class: 'surface-label', text: 'Цвет цифр' }), resetTimer
        ]));

        const picker = new window.ColorPicker(svId, hueId, hexId, previewId, panelId, (hex) => {
            this.updateColors(target, { surface: hex });
        });
        this.surfacePickers[target] = picker;

        swatch.addEventListener('click', () => {
            picker.toggle();
            const open = picker.panel.classList.contains('open');
            swatch.classList.toggle('active', open);
            swatch.setAttribute('aria-expanded', String(open));
        });
        resetSurface.addEventListener('click', () => {
            this.updateColors(target, { surface: null, surfaceAlpha: null });
        });
        resetTimer.addEventListener('click', () => {
            this.updateColors(target, { timer: null, progress: null });
            // Свотч темы больше ничему не соответствует — снимаем подсветку.
            this.highlightActiveThemes();
        });
        // 0…100 в контроле, 0…1 в хранилище: доля — то, что понимает CSS.
        alpha.addEventListener('input', () => {
            this.updateColors(target, { surfaceAlpha: Number(alpha.value) / 100 });
        });
    },

    /** Приводит контролы к сохранённому состоянию (в том числе после запуска). */
    renderSurfaceControls() {
        if (!this.surfacePickers) { return; }
        SURFACE_TARGETS.forEach((target) => {
            const mount = document.getElementById(target + 'SurfaceRow');
            if (!mount) { return; }
            const colors = this[COLOR_TARGETS[target].field] || {};
            const hex = typeof colors.surface === 'string' ? colors.surface : null;
            const hasAlpha = colors.surfaceAlpha !== null && colors.surfaceAlpha !== undefined;
            const alphaPct = hasAlpha ? Math.round(Number(colors.surfaceAlpha) * 100) : 100;

            const swatch = mount.querySelector('.surface-swatch');
            if (swatch) {
                // «Фон не задан» и «фон задан прозрачным» обязаны различаться на
                // глаз, поэтому пустой свотч помечен КЛАССОМ, а не только
                // отсутствием цвета.
                swatch.classList.toggle('is-empty', !hex);
                swatch.style.setProperty('--surface-swatch', hex || 'transparent');
            }
            const alpha = mount.querySelector('.surface-alpha');
            if (alpha) {
                // Ползунок работает и БЕЗ выбранного цвета: он гасит подложку
                // самого стиля (её альфу умножает --surface-alpha в CSS окна).
                // Первая версия его отключала — то есть у стилей с собственным
                // непрозрачным фоном прозрачность требовала сначала выбрать
                // цвет, которого пользователь не хотел.
                alpha.value = String(alphaPct);
            }
            const alphaValue = mount.querySelector('.surface-alpha-value');
            if (alphaValue) { alphaValue.textContent = alphaPct + '%'; }
            const resetBg = mount.querySelector('.surface-reset-bg');
            // Сбрасывать есть что, если задано ЛЮБОЕ из двух значений.
            if (resetBg) { resetBg.disabled = !hex && !hasAlpha; }
            const resetTimer = mount.querySelector('.surface-reset-timer');
            if (resetTimer) { resetTimer.disabled = !colors.timer; }
            if (hex && this.surfacePickers[target]) { this.surfacePickers[target].setColor(hex); }
        });
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mergeColors, PanelColorsMixin, COLOR_TARGETS, SURFACE_TARGETS, COLOR_FIELDS };
}

if (typeof window !== 'undefined') {
    window.PanelColorsMixin = PanelColorsMixin;
    window.mergeColors = mergeColors;
    window.PanelColorFields = COLOR_FIELDS;
}
