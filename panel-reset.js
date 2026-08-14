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

        window.SettingsSchema.resetOwnedSettings(target, document);

        // Настройки часов описаны своей таблицей; пустой объект означает «взять
        // всё из значений по умолчанию».
        if (target === 'clock') {
            window.ClockSettingsSchema.applyClockSettings(this, {});
        }

        // Деления живут в своём ключе, а не в таблице настроек, и принадлежат
        // ЧАСАМ: у виджета таймера кольцо обратного отсчёта, а не циферблат.
        if (target === 'clock' && this.clockShowTicksEl) {
            this.clockShowTicksEl.checked = false;
            localStorage.setItem('clockShowTicks', 'false');
        }

        // Цвета — тем же единственным сборщиком, что и всё остальное:
        // null означает «удали поле», то есть верни владельцу-CSS.
        this.updateColors(target, {
            timer: null, progress: null, surface: null, surfaceAlpha: null
        });

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
            if (this.syncClockStyle) {
                window.ipcRenderer.send('clock-widget-set-style', this.timerStyleEl.value);
            }
            this.pushClockSettings();
        } else if (target === 'clock') {
            const style = this.syncClockStyle ? this.timerStyleEl.value : this.clockStyleEl.value;
            window.ipcRenderer.send('clock-widget-set-style', style);
            this.pushClockSettings();
        } else if (target === 'display') {
            this.pushDisplaySettings();
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PanelResetMixin, RESET_TARGETS };
}

if (typeof window !== 'undefined') {
    window.PanelResetMixin = PanelResetMixin;
}
