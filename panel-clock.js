'use strict';

/**
 * panel-clock.js — окно часов со стороны панели: настройки, стиль, их запись.
 *
 * Писатель `clockWidgetSettings` ОДИН — панель, и весь он здесь. До 29.10.2026
 * ключ писало и само окно часов (стиль — получив его по IPC, настройки — на
 * каждом пакете), отсюда «слияние, а не перезапись» в двух местах и стиль,
 * который попадал в профиль, только если часы были открыты: сменил стиль при
 * закрытых часах — после перезапуска они открывались в прежнем. Теперь окно
 * часов этот ключ (и `clockColors`) только читает —
 * tests/clock-single-writer.test.js.
 *
 * Слияние осталось: поля ключа пишут ДВЕ функции ниже — таблица настроек
 * (pushClockSettings) и стиль (sendClockStyle); прямая перезапись одной
 * стирала бы поля другой.
 *
 * Прототипная примесь: методы читают контролы контроллера (this.clockStyleEl,
 * this.timerStyleEl, this.syncClockStyle, элементы таблицы часов) и зовут
 * this.refreshPresetMarks().
 */

function readClockStored() {
    return window.SecurityUtils.safeJSONParse(localStorage.getItem('clockWidgetSettings'), {});
}

const PanelClockMixin = {
    /** Стиль, который часы показывают: под синхронизацией — стиль виджета. */
    effectiveClockStyle() {
        return this.syncClockStyle ? this.timerStyleEl.value : this.clockStyleEl.value;
    },

    /**
     * Стиль часов — в профиль и в окно. Зовут ВСЕ события, меняющие стиль
     * часов: свой выбор, синхронизация, стиль виджета под синхронизацией,
     * открытие часов, старт и пресет (loadSettings), сброс.
     */
    sendClockStyle() {
        const style = this.effectiveClockStyle();
        const prevClock = readClockStored();
        // Отсутствие поля часы читают как умолчание (круг) — писать его
        // незачем: запись на старте завела бы ключ в профиле, где его не
        // было, и погасила бы отметку пресета, записанного без него.
        const def = window.SettingsSchema.SETTINGS_DESCRIPTORS.find((r) => r.key === 'clockStyle')?.def;
        if ((prevClock.clockStyle ?? def) !== style) {
            localStorage.setItem('clockWidgetSettings', JSON.stringify({ ...prevClock, clockStyle: style }));
            this.refreshPresetMarks();
        }
        window.ipcRenderer.send('clock-widget-set-style', style);
    },

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

        // СЛИЯНИЕ, а не перезапись — см. шапку: стиль в том же ключе пишет
        // sendClockStyle.
        const prevClock = readClockStored();
        localStorage.setItem('clockWidgetSettings', JSON.stringify({ ...prevClock, ...persisted }));
        this.refreshPresetMarks();

        window.ipcRenderer.send('clock-widget-settings', settings);
    },

    loadClockSettings() {
        window.ClockSettingsSchema.applyClockSettings(this, readClockStored());
        // Деления — свой ключ вне clockWidgetSettings. Перечитываются
        // здесь же: эту раскладку зовёт и применение пресета, и без
        // строки тумблер после пресета показывал прежнее значение.
        if (this.clockShowTicksEl) {
            this.clockShowTicksEl.checked = localStorage.getItem('clockShowTicks') === 'true';
        }
        this.updateClockAnalogNumbersVisibility();
    },

    updateClockAnalogNumbersVisibility() {
        // Опция цифр циферблата — только для аналогового стиля.
        if (this.clockAnalogNumbersRowEl) {
            this.clockAnalogNumbersRowEl.style.display = this.effectiveClockStyle() === 'analog' ? 'flex' : 'none';
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PanelClockMixin };
}

if (typeof window !== 'undefined') {
    window.PanelClockMixin = PanelClockMixin;
}
