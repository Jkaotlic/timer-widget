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
 * Настройки живут в ЧЕТЫРЁХ хранилищах, и тест обязан покрыть все:
 *   - `displayExtSettings` — звуки, фон, блоки времени, стили и масштабы;
 *   - `clockWidgetSettings` — секунды, 24 часа, дата, пояс, цифры циферблата;
 *   - отдельные ключи `widgetShowTicks` / `clockShowTicks` (одна галочка на два окна);
 *   - `widgetColors` / `clockColors` / `displayColors` — по ключу на окно, общего
 *     вещания цветов в проекте нет намеренно.
 *
 * Три теста, а не один: синхронизация стиля часов затирает выбранный стиль часов,
 * а цвета читаются не из контролов, поэтому оба живут отдельно от общего плана.
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
    // Список шрифта живёт в displayExtSettings ровно как стиль/масштаб выше —
    // читается и пишется независимо от того, каким стилем сейчас выставлен
    // timerStyle в этом же плане (строка «скрыта», но контрол в DOM остаётся).
    { id: 'widgetDigitsFont', kind: 'fontselect', value: 'bebas' },

    // --- вкладка «Часы» ---
    { id: 'clockStyle', kind: 'segmented', value: 'digital' },
    { id: 'clockShowSeconds', kind: 'checkbox', value: false },
    { id: 'clockFormat24h', kind: 'checkbox', value: false },
    { id: 'clockShowDate', kind: 'checkbox', value: true },
    { id: 'clockShowTimezone', kind: 'checkbox', value: true },
    // Цифры циферблата видимы только у аналогового стиля, но пишутся и читаются
    // всегда — скрытая строка не повод не проверять сохранение.
    { id: 'clockShowAnalogNumbers', kind: 'checkbox', value: true },
    { id: 'clockDigitsFont', kind: 'fontselect', value: 'oswald' },

    // --- вкладка «Полноэкранный» ---
    { id: 'displayTimerStyle', kind: 'segmented', value: 'analog' },
    { id: 'displayTimerScale', kind: 'range', value: '180' },
    { id: 'displayDigitsFont', kind: 'fontselect', value: 'orbitron' },
    { id: 'showCurrentTime', kind: 'checkbox', value: false },
    { id: 'showTimeBlocks', kind: 'checkbox', value: true },
    { id: 'timeLayoutPreset', kind: 'select', value: 'corners' },
    { id: 'timeBlocksScale', kind: 'range', value: '250' },
    { id: 'eventTimeInput', kind: 'text', value: '09:15' },
    { id: 'endTimeInput', kind: 'text', value: '18:45' },
    { id: 'bgSolidColor', kind: 'color', value: '#123456' },
    { id: 'bgGrad1', kind: 'color', value: '#654321' },
    { id: 'bgGrad2', kind: 'color', value: '#abcdef' },
    // Режим фона — не поле ввода, а три кнопки с .active. Ставится и читается по
    // data-mode, поэтому у него собственный вид.
    { id: 'bgMode', kind: 'bgmode', value: 'gradient' },

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
    // Мастер-выключатель звука идёт ПОСЛЕДНИМ в своей группе: выключенный, он
    // гасит pointer-events всего блока звуков, и клик по соседям стал бы
    // невозможен. Он же — единственная настройка, чьё значение по умолчанию
    // «включено», а сохранять надо «выключено».
    { id: 'soundMasterEnabled', kind: 'checkbox', value: false },

    // --- главный экран ---
    // Порядок обязателен: строка лимита показывается только при включённом
    // «Считать ниже нуля».
    { id: 'allowNegative', kind: 'checkbox', value: true },
    { id: 'overrunLimit', kind: 'text', value: '05:30' }
];

// Выставляет значение так, как это делает пользователь, и возвращает, что
// получилось прочитать сразу после установки (санитарная проверка самого плана).
function applyPlan(plan) {
    const applied = {};
    for (const item of plan) {
        // Режим фона живёт не в элементе с таким id, а в наборе кнопок.
        if (item.kind === 'bgmode') {
            const btn = document.querySelector(`.bg-mode-btn[data-mode="${item.value}"]`);
            if (btn) { btn.click(); }
            applied[item.id] = document.querySelector('.bg-mode-btn.active')?.dataset.mode || '__НЕТ КНОПКИ__';
            continue;
        }
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
            case 'fontselect': {
                // Тот же инвариант, что у 'segmented' выше: .value молчит,
                // событие шлёт только клик по пункту списка.
                const opt = el.querySelector(`.font-option[data-val="${item.value}"]`);
                if (opt) { opt.click(); }
                applied[item.id] = el.getAttribute('data-value') || el.value;
                break;
            }
            default:
                applied[item.id] = '__НЕИЗВЕСТНЫЙ ВИД__';
        }
    }
    return applied;
}

// Ключи, которые этот файл трогает. Уборка обязана снести ВСЕ: настройки живут в
// localStorage и переживают перезапуск приложения, а спеки идут по алфавиту в
// одном воркере. Без уборки этот файл ронял status-and-colors.spec.js, который
// ожидает строку лимита скрытой. Тест, портящий состояние соседям, хуже
// отсутствующего — он даёт ложные падения не там, где сломано.
const TOUCHED_KEYS = [
    'displayExtSettings',
    'clockWidgetSettings',
    'widgetShowTicks',
    'clockShowTicks',
    // Мастер-выключатель звука пишет ещё и сюда; выключенным он заглушил бы
    // sound-events.spec.js, который идёт следом.
    'soundEnabled',
    // Цвета окон — их выставляет тест тем.
    'timerColors',
    'widgetColors',
    'clockColors',
    'displayColors'
];

async function resetStorages(control) {
    await control.evaluate((keys) => {
        for (const key of keys) { localStorage.removeItem(key); }
    }, TOUCHED_KEYS);
    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(1200);
}

// Читает текущее состояние тех же контролов.
function readPlan(plan) {
    const state = {};
    for (const item of plan) {
        if (item.kind === 'bgmode') {
            state[item.id] = document.querySelector('.bg-mode-btn.active')?.dataset.mode || '__НЕТ АКТИВНОЙ КНОПКИ__';
            continue;
        }
        const el = document.getElementById(item.id);
        if (!el) { state[item.id] = '__НЕТ ЭЛЕМЕНТА__'; continue; }
        if (item.kind === 'checkbox') { state[item.id] = el.checked; }
        else if (item.kind === 'segmented' || item.kind === 'fontselect') {
            state[item.id] = el.getAttribute('data-value') || el.value;
        } else { state[item.id] = el.value; }
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

    // Возвращаем хранилища к состоянию по умолчанию (см. TOUCHED_KEYS).
    await resetStorages(control);

    await app.close();
});

/**
 * Синхронизация стиля часов — отдельным тестом, потому что она НЕСОВМЕСТИМА с
 * планом выше: включение синхронизации присваивает clockStyleEl значение стиля
 * виджета, то есть затирает выбранный там 'digital'.
 *
 * Проверяется ровно тот дефект, который описан в CLAUDE.md: сохранённое
 * «включено» уничтожалось на старте, потому что loadSettings восстанавливал
 * clockStyleEl.value, сеттер сегментированного контрола слал 'change', а его
 * обработчик трактовал это как ручной выбор стиля часов и снимал галочку.
 * Спек clock-style-sync.spec.js проверяет только видимость строки в живом окне и
 * перезагрузку не делает — то есть эту сторону не закрывает.
 */
test('синхронизация стиля часов переживает перезагрузку окна', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => {
        // Сначала стиль виджета — именно он станет стилем часов.
        document.querySelector('#timerStyle button[data-val="flip"]').click();
        // Затем ручной выбор стиля часов: он гарантированно выключает синхронизацию,
        // чтобы следующий шаг включал её с заведомо выключенного состояния.
        document.querySelector('#clockStyle button[data-val="digital"]').click();
        const sync = document.getElementById('syncClockStyle');
        sync.checked = true;
        sync.dispatchEvent(new Event('change'));
    });
    await control.waitForTimeout(1200);

    const before = await control.evaluate(() => ({
        sync: document.getElementById('syncClockStyle').checked,
        clockStyle: document.getElementById('clockStyle').value,
        rowVisible: document.getElementById('clockStyleRow').offsetParent !== null,
        stored: localStorage.getItem('displayExtSettings')
    }));

    expect(before.sync, 'галочку не удалось включить — тест бы ничего не проверил').toBe(true);
    expect(before.clockStyle, 'при включении синхронизации часы обязаны взять стиль виджета').toBe('flip');
    expect(before.rowVisible, 'строка выбора стиля часов обязана скрыться').toBe(false);
    expect(
        JSON.parse(before.stored || '{}').syncClockStyle,
        'syncClockStyle не записан в displayExtSettings'
    ).toBe(true);

    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(2000);

    const after = await control.evaluate(() => ({
        sync: document.getElementById('syncClockStyle').checked,
        clockStyle: document.getElementById('clockStyle').value,
        rowVisible: document.getElementById('clockStyleRow').offsetParent !== null,
        stored: localStorage.getItem('displayExtSettings')
    }));

    expect(
        after.sync,
        `после перезагрузки синхронизация выключилась. В хранилище: ${after.stored}`
    ).toBe(true);
    expect(after.rowVisible, 'после перезагрузки строка стиля часов снова видна при включённой синхронизации').toBe(false);

    await resetStorages(control);
    await app.close();
});

/**
 * Цвета — четвёртое хранилище, и в круговом рейсе его не было вовсе.
 *
 * Каждому окну свой ключ (`widgetColors` / `clockColors` / `displayColors`) —
 * в проекте намеренно НЕТ общего вещания цветов, поэтому три окна получают три
 * разные темы: так тест заодно ловит протечку цвета между окнами.
 *
 * Проверяется и то, что видно глазу: подсветка выбранной темы. Значение может
 * лежать в localStorage и доезжать до окон, но если после перезапуска ни одна
 * кнопка не подсвечена, пользователь не видит, какая тема выбрана.
 */
const THEME_PICKS = [
    { grid: 'themesGrid', index: 1, key: 'widgetColors', state: 'currentColors', timer: '#39ff14', progress: '#00ffa3' },
    { grid: 'clockThemesGrid', index: 3, key: 'clockColors', state: 'clockColors', timer: '#36d1dc', progress: '#5b86e5' },
    { grid: 'displayThemesGrid', index: 5, key: 'displayColors', state: 'displayColors', timer: '#b993d6', progress: '#8ca6db' }
];

function readThemes(picks) {
    const out = {};
    for (const pick of picks) {
        const grid = document.getElementById(pick.grid);
        const buttons = grid ? Array.from(grid.querySelectorAll('.theme-btn')) : [];
        const tc = window.timerController;
        out[pick.grid] = {
            activeIndex: buttons.findIndex((b) => b.classList.contains('active')),
            stored: localStorage.getItem(pick.key),
            state: tc ? tc[pick.state] : null
        };
    }
    return out;
}

test('цвета тем переживают перезагрузку окна и не смешиваются между окнами', async () => {
    const { app, control } = await launchApp();

    await control.evaluate((picks) => {
        for (const pick of picks) {
            const grid = document.getElementById(pick.grid);
            const buttons = grid ? Array.from(grid.querySelectorAll('.theme-btn')) : [];
            if (buttons[pick.index]) { buttons[pick.index].click(); }
        }
    }, THEME_PICKS);
    await control.waitForTimeout(1200);

    const before = await control.evaluate(readThemes, THEME_PICKS);

    // Санитарная проверка: клик действительно выбрал тему.
    const notPicked = THEME_PICKS
        .filter((p) => before[p.grid].activeIndex !== p.index)
        .map((p) => `${p.grid}: ожидали активной кнопку #${p.index}, активна #${before[p.grid].activeIndex}`);
    expect(notPicked, 'тему не удалось выбрать — тест бы ничего не проверил').toEqual([]);

    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(2000);

    const after = await control.evaluate(readThemes, THEME_PICKS);

    // 1. Значение доехало до хранилища и до состояния панели.
    const wrongValue = [];
    for (const pick of THEME_PICKS) {
        const stored = JSON.parse(after[pick.grid].stored || 'null');
        const state = after[pick.grid].state;
        if (!stored || stored.timer !== pick.timer || stored.progress !== pick.progress) {
            wrongValue.push(`${pick.key}: ожидали ${pick.timer}/${pick.progress}, в хранилище ${after[pick.grid].stored}`);
        }
        if (!state || state.timer !== pick.timer || state.progress !== pick.progress) {
            wrongValue.push(`${pick.state}: ожидали ${pick.timer}/${pick.progress}, в панели ${JSON.stringify(state)}`);
        }
    }
    expect(wrongValue, `цвета не дожили до перезагрузки:\n  ${wrongValue.join('\n  ')}`).toEqual([]);

    // 2. Выбранная тема видна глазу.
    const notHighlighted = THEME_PICKS
        .filter((p) => after[p.grid].activeIndex !== p.index)
        .map((p) => `${p.grid}: после перезагрузки активна кнопка #${after[p.grid].activeIndex}, а выбрана была #${p.index}`);
    expect(
        notHighlighted,
        `подсветка выбранной темы не пережила перезагрузку:\n  ${notHighlighted.join('\n  ')}`
    ).toEqual([]);

    await resetStorages(control);
    await app.close();
});
