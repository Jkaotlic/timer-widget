const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Круговой рейс настроек: выставил → перезагрузил окно → значение вернулось.
 *
 * Зачем именно такой тест. `tests/storage-keys.test.js` проверяет, что каждый ключ
 * И пишется, И читается — но не проверяет, что доезжает ЗНАЧЕНИЕ. Между записью и
 * чтением стоит `loadSettings()` с длинной лесенкой значений по умолчанию вида
 * `ext.foo !== false` и `ext.bar || 100`, и любая ошибка в ней тихо подменяет
 * сохранённое: настройка вроде бы сохраняется, а после перезапуска возвращается к
 * дефолту. Поймать это можно только сравнив ДО и ПОСЛЕ.
 *
 * Настройки живут в ТРЁХ хранилищах, и тест обязан покрыть все:
 *   - `displayExtSettings` — звуки, фон, блоки времени, стили и масштабы;
 *   - `clockWidgetSettings` — секунды, 24 часа, дата, пояс, цифры циферблата;
 *   - отдельные ключи `widgetShowTicks` / `clockShowTicks` (одна галочка на два окна).
 *
 * Значения выставляются программно с правильными событиями — здесь проверяется
 * ПЕРСИСТЕНТНОСТЬ, а достижимость мышью проверяет reachable-controls.spec.js.
 * Сегментированные контролы всё же кликаются: у них присваивание `.value`
 * намеренно НЕ порождает `change` (см. CLAUDE.md), поэтому иначе они не сохранятся.
 *
 * Тест собирает ВСЕ расхождения и падает один раз со списком — так за один прогон
 * видно всю картину, а не первое несовпадение.
 */

// Одно место, где описано «как выставить» и «как прочитать» для каждой настройки.
// Значения выбраны отличными от значений по умолчанию — иначе тест зелёный даже
// когда настройка не сохраняется вовсе.
const PLAN = [
    // --- вкладка «Виджет» ---
    { id: 'timerStyle', kind: 'segmented', value: 'flip' },
    { id: 'timerScale', kind: 'range', value: '150' },
    { id: 'widgetShowTicks', kind: 'checkbox', value: true },

    // --- вкладка «Часы» ---
    { id: 'clockStyle', kind: 'segmented', value: 'digital' },
    { id: 'clockShowSeconds', kind: 'checkbox', value: false },
    { id: 'clockFormat24h', kind: 'checkbox', value: false },
    { id: 'clockShowDate', kind: 'checkbox', value: true },
    { id: 'clockShowTimezone', kind: 'checkbox', value: true },

    // --- вкладка «Полноэкранный» ---
    { id: 'displayTimerStyle', kind: 'segmented', value: 'analog' },
    { id: 'displayTimerScale', kind: 'range', value: '180' },
    { id: 'showCurrentTime', kind: 'checkbox', value: false },
    { id: 'showTimeBlocks', kind: 'checkbox', value: true },
    { id: 'timeLayoutPreset', kind: 'select', value: 'corners' },
    { id: 'timeBlocksScale', kind: 'range', value: '250' },
    { id: 'eventTimeInput', kind: 'text', value: '09:15' },
    { id: 'endTimeInput', kind: 'text', value: '18:45' },
    { id: 'bgSolidColor', kind: 'color', value: '#123456' },
    { id: 'bgGrad1', kind: 'color', value: '#654321' },
    { id: 'bgGrad2', kind: 'color', value: '#abcdef' },

    // --- вкладка «Звуки» ---
    { id: 'soundStartEnabled', kind: 'checkbox', value: true },
    { id: 'soundEndEnabled', kind: 'checkbox', value: false },
    { id: 'soundMinuteEnabled', kind: 'checkbox', value: true },
    { id: 'soundOverrunEnabled', kind: 'checkbox', value: true },
    { id: 'soundStartPreset', kind: 'select', value: 'chime' },
    { id: 'soundEndPreset', kind: 'select', value: 'gong' },
    { id: 'soundMinutePreset', kind: 'select', value: 'tick' },
    { id: 'soundOverrunPreset', kind: 'select', value: 'siren' },
    { id: 'overrunIntervalMinutes', kind: 'select', value: '5' },

    // --- главный экран ---
    { id: 'allowNegative', kind: 'checkbox', value: true }
];

// Выставляет значение так, как это делает пользователь, и возвращает, что
// получилось прочитать сразу после установки (санитарная проверка самого плана).
function applyPlan(plan) {
    const applied = {};
    for (const item of plan) {
        const el = document.getElementById(item.id);
        if (!el) { applied[item.id] = '__НЕТ ЭЛЕМЕНТА__'; continue; }
        switch (item.kind) {
            case 'checkbox':
                el.checked = item.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                applied[item.id] = el.checked;
                break;
            case 'range':
                el.value = item.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                applied[item.id] = el.value;
                break;
            case 'select':
            case 'text':
                el.value = item.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                applied[item.id] = el.value;
                break;
            case 'color':
                el.value = item.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                applied[item.id] = el.value;
                break;
            case 'segmented': {
                // Присваивание .value у самодельного сегментированного контрола
                // намеренно НЕ порождает change — иначе оно выдавало бы себя за
                // клик пользователя (см. CLAUDE.md). Поэтому кликаем.
                const btn = el.querySelector(`button[data-val="${item.value}"]`);
                if (btn) { btn.click(); }
                applied[item.id] = el.getAttribute('data-value') || el.value;
                break;
            }
            default:
                applied[item.id] = '__НЕИЗВЕСТНЫЙ ВИД__';
        }
    }
    return applied;
}

// Читает текущее состояние тех же контролов.
function readPlan(plan) {
    const state = {};
    for (const item of plan) {
        const el = document.getElementById(item.id);
        if (!el) { state[item.id] = '__НЕТ ЭЛЕМЕНТА__'; continue; }
        if (item.kind === 'checkbox') { state[item.id] = el.checked; }
        else if (item.kind === 'segmented') { state[item.id] = el.getAttribute('data-value') || el.value; }
        else { state[item.id] = el.value; }
    }
    return state;
}

test('все настройки панели переживают перезагрузку окна', async () => {
    const { app, control } = await launchApp();

    // Выставляем всё. Ящик открывать не нужно: контролы существуют в DOM всегда,
    // ящик лишь переносит их поддерево.
    const applied = await control.evaluate(applyPlan, PLAN);

    // Санитарная проверка плана: если контрол не нашёлся или не принял значение,
    // тест обязан сказать об этом прямо, а не сравнивать мусор с мусором.
    const badPlan = PLAN.filter((item) => {
        const got = applied[item.id];
        if (typeof got === 'string' && got.startsWith('__')) { return true; }
        return String(got) !== String(item.value);
    });
    expect(
        badPlan.map((i) => `${i.id}: просили ${i.value}, получили ${applied[i.id]}`),
        'значение не удалось выставить — тест бы ничего не проверил'
    ).toEqual([]);

    // Даём обработчикам дописать все три хранилища.
    await control.waitForTimeout(1200);

    const stored = await control.evaluate(() => ({
        ext: localStorage.getItem('displayExtSettings'),
        clock: localStorage.getItem('clockWidgetSettings'),
        widgetTicks: localStorage.getItem('widgetShowTicks'),
        clockTicks: localStorage.getItem('clockShowTicks')
    }));
    expect(stored.ext, 'displayExtSettings не записан вовсе').toBeTruthy();

    // Перезагрузка окна — то же, что перезапуск приложения для рендерера.
    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(2000);

    const after = await control.evaluate(readPlan, PLAN);

    const mismatches = PLAN
        .filter((item) => String(after[item.id]) !== String(item.value))
        .map((item) => `${item.id} (${item.kind}): выставили ${item.value}, после перезагрузки ${after[item.id]}`);

    expect(
        mismatches,
        `настройки не дожили до перезагрузки:\n  ${mismatches.join('\n  ')}\n`
        + `Хранилища: ticks=${stored.widgetTicks}/${stored.clockTicks}, `
        + `clockWidgetSettings=${stored.clock ? 'есть' : 'НЕТ'}`
    ).toEqual([]);

    // Возвращаем хранилища к состоянию по умолчанию.
    //
    // Настройки живут в localStorage и переживают перезапуск приложения, а спеки
    // идут по алфавиту в одном воркере: этот файл выставляет 30 значений (включая
    // «Считать ниже нуля») и без уборки ронял следующий за ним
    // status-and-colors.spec.js, который ожидает строку лимита скрытой. Тест,
    // портящий состояние соседям, хуже отсутствующего — он даёт ложные падения
    // не там, где сломано.
    await control.evaluate(() => {
        for (const key of ['displayExtSettings', 'clockWidgetSettings', 'widgetShowTicks', 'clockShowTicks']) {
            localStorage.removeItem(key);
        }
    });
    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(1200);

    await app.close();
});
