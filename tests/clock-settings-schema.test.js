'use strict';

/**
 * Таблица настроек часов.
 *
 * Инвариант, ради которого таблица и появилась: то, что записано, читается
 * обратно ТЕМ ЖЕ. Раньше запись и чтение были двумя зеркальными списками —
 * объектным литералом в pushClockSettings и лесенкой `!!x` / `y !== false` в
 * loadClockSettings. Расхождение между ними не видно ниоткуда, кроме теста на
 * полный оборот: настройка просто молча откатывается после перезапуска.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLOCK_SETTINGS, collectClockSettings, applyClockSettings } = require('../clock-settings-schema');

/**
 * Подставные контролы — по одному на каждую строку таблицы. Форма элемента
 * зависит от `kind`: галочка получает `.checked`, строковая настройка —
 * `.value`. Оба свойства присутствуют всегда (реальный DOM-элемент тоже не
 * бывает без обоих), но читает и пишет каждую строку только СВОЁ поле —
 * ровно то, что проверяет collectClockSettings/applyClockSettings.
 */
function fakeControls(initial = {}) {
    const els = {};
    for (const row of CLOCK_SETTINGS) {
        const value = initial[row.key] !== undefined ? initial[row.key] : row.def;
        els[row.el] = row.kind === 'value' ? { value } : { checked: value };
    }
    return els;
}

// Читает подставной контрол СВОИМ полем — .value для строковой настройки,
// .checked для галочки. Тот же выбор, что делают collectClockSettings и
// fakeControls; вынесен отдельно, чтобы тесты ниже не подглядывали в .checked
// у строковой настройки (там его просто нет).
function readControl(row, els) {
    const el = els[row.el];
    return row.kind === 'value' ? el.value : el.checked;
}

test('оборот запись → чтение не теряет ни одну настройку', () => {
    // Главная проверка: гоняем ВСЕ комбинации, а не одну удобную — включая
    // строковую настройку (шрифт «Цифры»), а не только галочки.
    const combos = [
        {
            showDate: true, showTimezone: true, showSeconds: false, format24h: false, showNumbers: true,
            clockDigitsFont: 'oswald'
        },
        {
            showDate: false, showTimezone: false, showSeconds: true, format24h: true, showNumbers: false,
            clockDigitsFont: 'playfair'
        }
    ];

    for (const want of combos) {
        const written = collectClockSettings(fakeControls(want));
        assert.deepEqual(written, want, 'собранный набор разошёлся с состоянием контролов');

        const restored = fakeControls();
        applyClockSettings(restored, written);
        assert.deepEqual(collectClockSettings(restored), want, 'после перезапуска настройки поехали');
    }
});

test('умолчания берутся из таблицы, когда настройку никогда не трогали', () => {
    const els = fakeControls({ showDate: true, showSeconds: false, format24h: false, clockDigitsFont: 'bebas' });
    applyClockSettings(els, {});

    for (const row of CLOCK_SETTINGS) {
        assert.equal(readControl(row, els), row.def, `${row.key}: без сохранённого значения нужен дефолт из таблицы`);
    }

    // Секунды и 24 часа включены по умолчанию — часы без секунд и в 12-часовом
    // формате на чистом профиле были бы неожиданностью. Шрифт по умолчанию — Inter.
    const defaults = Object.fromEntries(CLOCK_SETTINGS.map(r => [r.key, r.def]));
    assert.deepEqual(defaults, {
        showDate: false, showTimezone: false, showSeconds: true, format24h: true, showNumbers: false,
        clockDigitsFont: 'inter'
    });
});

test('сохранённое false — это выбор пользователя, а не отсутствие значения', () => {
    // Именно здесь ломалась прежняя лесенка: `settings.showSeconds !== false`
    // и `!!settings.showDate` — две РАЗНЫЕ трактовки отсутствия, написанные
    // рядом. Проверка идёт на undefined, поэтому false доживает до контрола.
    const els = fakeControls();
    applyClockSettings(els, { showSeconds: false, format24h: false });

    assert.equal(els.clockShowSecondsEl.checked, false, 'выключенные секунды обязаны остаться выключенными');
    assert.equal(els.clockFormat24hEl.checked, false, 'выбранный 12-часовой формат обязан пережить перезапуск');
});

test('деления циферблата в таблице отсутствуют — у них свой владелец', () => {
    // showTicks — настройка ОБЩАЯ с виджетом таймера, с собственными ключами
    // хранилища. Попав в эту таблицу, она стала бы второй копией.
    assert.equal(CLOCK_SETTINGS.some(r => r.key === 'showTicks'), false);
});

test('мусор вместо сохранённых настроек не роняет панель и даёт умолчания', () => {
    for (const junk of [null, undefined, 'строка', 42, []]) {
        const els = fakeControls({ showDate: true });
        applyClockSettings(els, junk);
        assert.equal(els.clockShowDateEl.checked, false, `${JSON.stringify(junk)}: нужен дефолт`);
    }
});

test('таблица часов принимает строковое значение, а не только галочки', () => {
    const row = CLOCK_SETTINGS.find((r) => r.key === 'clockDigitsFont');
    assert.ok(row, 'строка clockDigitsFont должна быть в таблице');
    assert.equal(row.kind, 'value');
    assert.equal(row.def, 'inter');
});

test('строковая строка таблицы кладётся и читается через .value, а не .checked', () => {
    const els = { clockDigitsFontEl: { value: 'oswald' } };
    assert.equal(collectClockSettings(els).clockDigitsFont, 'oswald');

    const target = { clockDigitsFontEl: { value: '' } };
    applyClockSettings(target, { clockDigitsFont: 'playfair' });
    assert.equal(target.clockDigitsFontEl.value, 'playfair');
});

test('строковая строка: сохранённая пустая строка НЕ подменяется умолчанием', () => {
    const target = { clockDigitsFontEl: { value: 'oswald' } };
    applyClockSettings(target, { clockDigitsFont: '' });
    assert.equal(target.clockDigitsFontEl.value, '');
});

test('пропавший контрол не ломает ни сбор, ни расстановку', () => {
    // Элементы ищутся по id; вырезанный из разметки контрол — реальный случай
    // в этом проекте (так однажды исчезла галочка делений).
    const els = fakeControls();
    delete els.clockShowDateEl;

    assert.doesNotThrow(() => applyClockSettings(els, { showDate: true }));
    assert.equal(collectClockSettings(els).showDate, false, 'без контрола берётся умолчание таблицы');
});
