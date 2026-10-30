'use strict';

/**
 * panel-reset.js — кнопка «Сбросить всё» у каждого окна: виджет, часы,
 * полноэкранное.
 *
 * Что сбрасывается: настройки ЭТОЙ вкладки (стиль, масштаб, тумблеры, шрифт
 * «Цифр», фон полноэкранного) и цвета окна — цвет цифр, цвет фона и его
 * прозрачность. Что НЕ сбрасывается: положение окна на экране и его размер.
 * Это сознательно: окно, прыгнувшее из-под мыши в угол экрана, читается как
 * поломка, а не как сброс настроек. Геометрия правится колесом и мышью там же,
 * где живёт, — и восстанавливается тем же жестом.
 *
 * Знание «какая настройка чьё окно» живёт ОДНОЙ строкой в settings-schema.js
 * (поле `owner`), а не третьим списком здесь: именно из-за вторых и третьих
 * списков одного и того же в этом проекте настройки молча возвращались к
 * умолчанию после перезапуска.
 *
 * Прототипная примесь: методы зовут this.saveExtSettings(), this.updateColors()
 * и отправку в окна — всё это принадлежит контроллеру панели.
 */

// Список полей цвета — у сборщика; своя копия уже теряла `bg` (см. ниже).
import * as ClockSettingsSchema from './clock-settings-schema.js';
import * as HeroModes from './hero-modes.js';
import * as SettingsSchema from './settings-schema.js';
import { COLOR_FIELDS } from './panel-colors.js';

const RESET_TARGETS = {
    widget: { mount: 'widgetResetRow', label: 'виджета', toast: 'Настройки виджета сброшены' },
    clock: { mount: 'clockResetRow', label: 'часов', toast: 'Настройки часов сброшены' },
    display: { mount: 'displayResetRow', label: 'полноэкранного окна', toast: 'Настройки полноэкранного окна сброшены' }
};

const PanelResetMixin = {
    initResetButtons() {
        Object.keys(RESET_TARGETS).forEach((target) => {
            const spec = RESET_TARGETS[target];
            const mount = document.getElementById(spec.mount);
            if (!mount) { return; }
            mount.className = 'surface-line reset-line';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'surface-reset reset-all';
            button.textContent = 'Сбросить всё';
            button.title = 'Вернуть настройки ' + spec.label + ' к заводским (положение и размер окна останутся)';
            button.setAttribute('aria-label', 'Сбросить все настройки ' + spec.label);
            button.addEventListener('click', () => this.resetWindowSettings(target));

            const hint = document.createElement('span');
            hint.className = 'surface-label reset-hint';
            hint.textContent = 'Кроме положения окна';

            mount.appendChild(hint);
            mount.appendChild(button);
        });
    },

    resetWindowSettings(target) {
        if (!RESET_TARGETS[target]) { return; }

        SettingsSchema.resetOwnedSettings(target, document);

        // Сброс ставит el.checked и событий НЕ порождает, поэтому всё, что
        // панель держит полем или выводит из контрола побочным эффектом,
        // подтягивается здесь — до записи и посылки ниже.
        //  - синхронизация стиля часов живёт и полем this.syncClockStyle: без
        //    этой строки чекбокс снят, а часам уходил стиль ВИДЖЕТА;
        //  - замок 47-го этажа прячет секцию, секретные раскладки и ряды
        //    подписей только в renderFloor47: без вызова дисплей получал
        //    floor47Unlocked:false, а панель продолжала их показывать.
        if (target === 'clock' && this.syncClockStyleEl) {
            this.syncClockStyle = !!this.syncClockStyleEl.checked;
        }
        if (target === 'display' && typeof this.renderFloor47 === 'function') {
            this.renderFloor47();
        }

        // Настройки часов описаны своей таблицей; пустой объект означает «взять
        // всё из значений по умолчанию».
        if (target === 'clock') {
            ClockSettingsSchema.applyClockSettings(this, {});
        }

        // Режим центрального времени — РУЧНОЙ ключ (settings-schema.js,
        // MANUAL_KEYS): строки в таблице у него нет, потому что ряд кнопок с
        // классом `.active` — ни `checkbox`, ни `value`. Значит и
        // resetOwnedSettings() его не видит: три поля заголовков (обычные
        // строки таблицы) сбрасывались, а сам режим оставался, и
        // pushDisplaySettings() ниже отправлял его в окно заново. Кнопка при
        // этом обещает «вернуть настройки полноэкранного окна к заводским».
        //
        // Через setHeroMode(), а не присвоением поля: владелец значения —
        // this.heroMode, но кнопки, видимость поля заголовка и подпись под ним
        // — его ВИД, и обновляет их одно место.
        //
        // У `bgMode` дыра ровно та же, но у него есть СВОЯ кнопка сброса фона;
        // у режима второго пути нет.
        if (target === 'display' && typeof this.setHeroMode === 'function') {
            this.setHeroMode(HeroModes.DEFAULT_MODE);
        }

        // Деления живут в своём ключе, а не в таблице настроек, и принадлежат
        // ЧАСАМ: у виджета таймера кольцо обратного отсчёта, а не циферблат.
        if (target === 'clock' && this.clockShowTicksEl) {
            this.clockShowTicksEl.checked = false;
            localStorage.setItem('clockShowTicks', 'false');
        }

        // Цвета — тем же единственным сборщиком, что и всё остальное:
        // null означает «удали поле», то есть верни владельцу-CSS.
        //
        // СПИСОК ПОЛЕЙ берётся у сборщика (panel-colors.js), а не перечисляется
        // здесь. Своя копия списка уже подвела: поля `bg` в ней не было, и оно
        // переживало «Сбросить всё» — то есть кнопка возвращала к заводскому
        // виду не всё, а всё, кроме одного.
        const patch = {};
        for (const field of COLOR_FIELDS) { patch[field] = null; }
        this.updateColors(target, patch);

        this.saveExtSettings();
        this.pushResetTarget(target);

        this.updateStyleDependentRows();
        this.updateClockAnalogNumbersVisibility();
        this.highlightActiveThemes();
        this.renderSurfaceControls();
        window.Toast?.show(RESET_TARGETS[target].toast);
    },

    // Отправка в само окно. Каналы у каждого свои — общего «применить всё» в
    // этом приложении нет и заводить его ради сброса означало бы новый payload.
    pushResetTarget(target) {
        if (target === 'widget') {
            window.ipcRenderer.send('widget-style-update', this.widgetStylePayload());
            // У часов может стоять синхронизация со стилем виджета.
            if (this.syncClockStyle) { this.sendClockStyle(); }
            this.pushClockSettings();
        } else if (target === 'clock') {
            this.sendClockStyle();
            this.pushClockSettings();
        } else if (target === 'display') {
            this.pushDisplaySettings();
        }
    }
};

export { PanelResetMixin, RESET_TARGETS };
