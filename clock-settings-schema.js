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
 *
 * `kind` различает галочку и строковое значение (список выбора шрифта
 * «Цифры» — первая нелогическая строка этой таблицы): `.checked` читается и
 * пишется только для `'checkbox'`, `.value` — только для `'value'`.
 */

const CLOCK_SETTINGS = [
    { key: 'showDate', el: 'clockShowDateEl', kind: 'checkbox', def: false },
    { key: 'showTimezone', el: 'clockShowTimezoneEl', kind: 'checkbox', def: false },
    { key: 'showSeconds', el: 'clockShowSecondsEl', kind: 'checkbox', def: true },
    { key: 'format24h', el: 'clockFormat24hEl', kind: 'checkbox', def: true },
    { key: 'showNumbers', el: 'clockShowAnalogNumbersEl', kind: 'checkbox', def: false },
    // Первая нелогическая строка таблицы: шрифт стиля «Цифры».
    { key: 'clockDigitsFont', el: 'clockDigitsFontEl', kind: 'value', def: 'inter' }
];

/**
 * Читает состояние контролов в объект настроек.
 * @param {Record<string, {checked: boolean, value: string}>} els — владелец ссылок на элементы
 * @returns {Record<string, boolean|string>}
 */
function collectClockSettings(els) {
    const out = {};
    for (const row of CLOCK_SETTINGS) {
        const el = els[row.el];
        if (row.kind === 'value') {
            out[row.key] = el ? el.value : row.def;
        } else {
            out[row.key] = el ? !!el.checked : row.def;
        }
    }
    return out;
}

/**
 * Расставляет контролы по сохранённым настройкам.
 *
 * Отсутствующее значение — это «настройку никогда не трогали», и тогда берётся
 * умолчание из таблицы. Проверка именно на undefined: `false` и `''` —
 * сохранённый выбор пользователя, и подменять его умолчанием нельзя.
 *
 * @param {Record<string, {checked: boolean, value: string}>} els
 * @param {Record<string, unknown>} stored
 */
function applyClockSettings(els, stored) {
    const src = (stored && typeof stored === 'object') ? stored : {};
    for (const row of CLOCK_SETTINGS) {
        const el = els[row.el];
        if (!el) { continue; }
        // Проверка именно на undefined: сохранённые `false` и '' — это выбор
        // пользователя, подменять его умолчанием нельзя.
        const raw = src[row.key];
        if (row.kind === 'value') {
            el.value = raw === undefined ? row.def : raw;
        } else {
            el.checked = raw === undefined ? row.def : !!raw;
        }
    }
}

const ClockSettingsSchema = { CLOCK_SETTINGS, collectClockSettings, applyClockSettings };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClockSettingsSchema;
}
if (typeof window !== 'undefined') {
    window.ClockSettingsSchema = ClockSettingsSchema;
}
