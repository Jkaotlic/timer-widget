'use strict';

/**
 * clock-settings-schema.js — таблица настроек виджета часов:
 * ключ → контрол → значение по умолчанию.
 *
 * Раньше эти пять настроек были описаны ДВАЖДЫ и зеркально: объектным литералом
 * в `pushClockSettings()` и лесенкой `!!settings.x` / `settings.y !== false` в
 * `loadClockSettings()`. Добавить настройку в одну половину и забыть про другую
 * (или поправить умолчание только в одной) — значит получить настройку, которая
 * молча откатывается после перезапуска. Ровно эту форму `settings-schema.js`
 * уже устранила для `displayExtSettings`; здесь она дожила последней.
 *
 * Модуль ничего не знает ни о контроллере панели, ни о localStorage, ни об IPC:
 * он принимает объект с ссылками на элементы. Поэтому проверяется в Node на
 * подставных элементах — как и settings-schema.js.
 *
 * `showTicks` в таблице НЕТ намеренно. Деления циферблата — настройка ОБЩАЯ с
 * виджетом таймера, у неё собственные ключи хранилища (`widgetShowTicks` /
 * `clockShowTicks`), и восстанавливают её сами окна при инициализации. В пакет
 * для часов она попадает, но только по IPC и только на лету.
 */

const CLOCK_SETTINGS = [
    { key: 'showDate', el: 'clockShowDateEl', def: false },
    { key: 'showTimezone', el: 'clockShowTimezoneEl', def: false },
    { key: 'showSeconds', el: 'clockShowSecondsEl', def: true },
    { key: 'format24h', el: 'clockFormat24hEl', def: true },
    { key: 'showNumbers', el: 'clockShowAnalogNumbersEl', def: false }
];

/**
 * Читает состояние контролов в объект настроек.
 * @param {Record<string, {checked: boolean}>} els — владелец ссылок на элементы
 * @returns {Record<string, boolean>}
 */
function collectClockSettings(els) {
    const out = {};
    for (const row of CLOCK_SETTINGS) {
        const el = els[row.el];
        out[row.key] = el ? !!el.checked : row.def;
    }
    return out;
}

/**
 * Расставляет контролы по сохранённым настройкам.
 *
 * Отсутствующее значение — это «настройку никогда не трогали», и тогда берётся
 * умолчание из таблицы. Проверка именно на undefined: `false` — сохранённый
 * выбор пользователя, и подменять его умолчанием нельзя.
 *
 * @param {Record<string, {checked: boolean}>} els
 * @param {Record<string, unknown>} stored
 */
function applyClockSettings(els, stored) {
    const src = (stored && typeof stored === 'object') ? stored : {};
    for (const row of CLOCK_SETTINGS) {
        const el = els[row.el];
        if (!el) { continue; }
        el.checked = src[row.key] === undefined ? row.def : !!src[row.key];
    }
}

const ClockSettingsSchema = { CLOCK_SETTINGS, collectClockSettings, applyClockSettings };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClockSettingsSchema;
}
if (typeof window !== 'undefined') {
    window.ClockSettingsSchema = ClockSettingsSchema;
}
