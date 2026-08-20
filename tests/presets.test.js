'use strict';

/**
 * Пресеты вида: снимок профиля, его применение и проводка кнопок.
 *
 * Просьба 19.08.2026: «пресеты для быстрой настройки стилей и отображения…
 * контрол 1-2-3-4, больше не надо, 4 пресета… один раз настроить и сохранить».
 *
 * Почему это проверяется в Node, а не только глазами. Пресет — операция над
 * ЧУЖИМ профилем: он перезаписывает ключи, из которых собран весь вид. Ошибка
 * здесь не выглядит ошибкой — она выглядит как «часть настроек не вернулась», и
 * заметить её можно только сравнив ДО и ПОСЛЕ по каждому ключу.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Presets = require(path.join(ROOT, 'presets.js'));
const PanelPresets = require(path.join(ROOT, 'panel-presets.js'));
const { codeOnly } = require('./helpers/source-scan.js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function fakeStorage(initial = {}) {
    const data = { ...initial };
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        data
    };
}

const SAMPLE = {
    displayExtSettings: JSON.stringify({ displayTimerStyle: 'flip', showCurrentTime: true }),
    widgetColors: JSON.stringify({ timer: '#ff0000' }),
    displayBlockPositions: JSON.stringify({ currentTime: { left: 10, top: 20, cx: 0.5, cy: 0.1 } }),
    displayTimerScale: '120'
};

test('ячеек ровно четыре, и пятая не заводится', () => {
    assert.equal(Presets.PRESET_SLOTS, 4);
    assert.equal(Presets.normalizeSlot(1), '1');
    assert.equal(Presets.normalizeSlot('4'), '4');
    assert.equal(Presets.normalizeSlot(5), null);
    assert.equal(Presets.normalizeSlot(0), null);
    assert.equal(Presets.normalizeSlot('первый'), null);
});

test('снимок берёт ЗНАЧЕНИЯ ключей профиля, а не пересказывает настройки', () => {
    const store = fakeStorage(SAMPLE);
    const snap = Presets.capturePreset(store);
    for (const [key, value] of Object.entries(SAMPLE)) {
        assert.equal(snap.values[key], value, `ключ ${key} не попал в снимок как есть`);
    }
    // Ключи, которых в профиле нет, в снимок не попадают ВОВСЕ: применить их
    // как «пусто» значило бы стереть чужую настройку.
    assert.equal('clockColors' in snap.values, false);
});

test('картинка фона в пресет не попадает — четыре ячейки выбили бы квоту', () => {
    assert.equal(Presets.PRESET_KEYS.includes('localBgImage'), false);
    // Настройки вписывания при этом остаются: без них режим «Файл» вернулся бы
    // с чужим кадрированием.
    assert.equal(Presets.PRESET_KEYS.includes('localBgSettings'), true);
});

test('геометрия окон в пресет не попадает — это ГДЕ окно, а не как оно выглядит', () => {
    assert.equal(Presets.PRESET_KEYS.includes('widgetGeometry'), false);
    assert.equal(Presets.PRESET_KEYS.includes('clockGeometry'), false);
});

test('круговой рейс: записали вид, всё поменяли, применили — вернулось', () => {
    const store = fakeStorage(SAMPLE);
    Presets.writePreset(2, Presets.capturePreset(store), store);

    // Пользователь всё перенастроил.
    store.setItem('displayExtSettings', JSON.stringify({ displayTimerStyle: 'analog' }));
    store.setItem('displayTimerScale', '250');
    store.removeItem('displayBlockPositions');

    const written = Presets.applyPreset(Presets.readPresets(store)['2'], store);
    assert.ok(written.includes('displayExtSettings'));
    for (const [key, value] of Object.entries(SAMPLE)) {
        assert.equal(store.data[key], value, `ключ ${key} не вернулся`);
    }
});

test('мусор в хранилище пресетов не роняет чтение и не притворяется пресетом', () => {
    for (const junk of ['не json', '[]', '3', 'null', '{"9":{"values":{}}}', '{"1":42}']) {
        const store = fakeStorage({ uiPresets: junk });
        const all = Presets.readPresets(store);
        assert.equal(typeof all, 'object');
        assert.equal(Object.keys(all).some((k) => !['1', '2', '3', '4'].includes(k)), false, `${junk}: чужая ячейка прошла`);
    }
    assert.equal(Presets.hasPreset(1, fakeStorage({ uiPresets: '{"1":{"values":{}}}' })), false, 'пустой снимок считается заполненным');
});

test('переполненное хранилище не роняет ни запись, ни применение', () => {
    const full = {
        getItem: () => null,
        setItem() { throw new Error('QuotaExceededError'); }
    };
    assert.doesNotThrow(() => Presets.writePreset(1, { values: { a: 'b' } }, full));
    assert.deepEqual(Presets.applyPreset({ values: { displayTimerScale: '120' } }, full), []);
});

// ---------------------------------------------------------------------------
// Проводка кнопок — на поддельных документе и хранилище
// ---------------------------------------------------------------------------

function fakeButton() {
    const listeners = {};
    return {
        listeners,
        attrs: {},
        classes: new Set(),
        title: '',
        setAttribute(k, v) { this.attrs[k] = v; },
        classList: {
            toggle: function (cls, on) { if (on) { this.owner.classes.add(cls); } else { this.owner.classes.delete(cls); } }
        },
        addEventListener(type, fn) { listeners[type] = fn; }
    };
}

function fakeDoc(buttons) {
    return {
        getElementById: (id) => buttons[id] || null,
        addEventListener: () => {}
    };
}

test('клик по ПУСТОЙ ячейке записывает вид, а не молчит', () => {
    const buttons = {};
    for (let i = 1; i <= 4; i++) {
        const b = fakeButton();
        b.classList.owner = b;
        buttons[`presetSlot${i}`] = b;
    }
    const store = fakeStorage(SAMPLE);
    const said = [];
    const api = PanelPresets.bindPresets({
        doc: fakeDoc(buttons), storage: store, presets: Presets,
        onApplied: () => said.push('применено'),
        notify: (m) => said.push(m)
    });
    assert.ok(api);
    assert.equal(buttons.presetSlot1.classes.has('filled'), false, 'пустая ячейка выглядит заполненной');

    buttons.presetSlot1.listeners.click({ shiftKey: false });
    assert.equal(said[said.length - 1], 'Пресет 1 записан', 'клик по пустой ячейке ничего не сделал');
    assert.equal(buttons.presetSlot1.classes.has('filled'), true, 'ячейка не пометилась заполненной');
});

test('клик применяет, Shift+клик перезаписывает', () => {
    const buttons = {};
    for (let i = 1; i <= 4; i++) {
        const b = fakeButton();
        b.classList.owner = b;
        buttons[`presetSlot${i}`] = b;
    }
    const store = fakeStorage(SAMPLE);
    let applied = 0;
    const said = [];
    const api = PanelPresets.bindPresets({
        doc: fakeDoc(buttons), storage: store, presets: Presets,
        onApplied: () => { applied++; },
        notify: (m) => said.push(m)
    });

    api.save(3);
    store.setItem('displayTimerScale', '300');

    buttons.presetSlot3.listeners.click({ shiftKey: false });
    assert.equal(applied, 1, 'применение не позвало пересборку окон');
    assert.equal(store.data.displayTimerScale, '120', 'применение не вернуло значение');

    store.setItem('displayTimerScale', '300');
    buttons.presetSlot3.listeners.click({ shiftKey: true });
    assert.equal(said[said.length - 1], 'Пресет 3 записан');
    assert.equal(applied, 1, 'Shift+клик применил вместо записи');
    // Записан ТЕКУЩИЙ вид — значит применение теперь вернёт именно его.
    store.setItem('displayTimerScale', '100');
    api.apply(3);
    assert.equal(store.data.displayTimerScale, '300', 'перезапись не сохранила новый вид');
});

test('горячие клавиши: Ctrl+N применяет, Ctrl+Shift+N записывает, голая цифра не трогается', () => {
    const calls = [];
    const handler = PanelPresets.presetHotkeyHandler({
        apply: (slot) => calls.push(['apply', slot]),
        save: (slot) => calls.push(['save', slot])
    });
    const ev = (code, mods = {}) => Object.assign({ code, preventDefault: () => calls.push(['prevent', code]) }, mods);

    handler(ev('Digit2', { ctrlKey: true }));
    handler(ev('Digit3', { metaKey: true, shiftKey: true }));
    // Голая цифра — это пресет ВРЕМЕНИ, он давно работает и отбирать его нельзя.
    handler(ev('Digit1'));
    // Пятой ячейки нет.
    handler(ev('Digit5', { ctrlKey: true }));

    assert.deepEqual(
        calls.filter((c) => c[0] !== 'prevent'),
        [['apply', 2], ['save', 3]]
    );
});

test('применение идёт ТЕМ ЖЕ путём, что и запуск панели', () => {
    // Вторая дорога до окон разошлась бы с первой на первой же новой настройке,
    // поэтому проверяется именно состав вызовов.
    const calls = [];
    const controller = {
        loadSettings: () => calls.push('loadSettings'),
        pushDisplaySettings: () => calls.push('pushDisplaySettings'),
        renderWindowRows: () => calls.push('renderWindowRows')
    };
    const ipc = { send: (channel) => calls.push(channel) };
    PanelPresets.applyProfile(controller, ipc);
    assert.deepEqual(calls, ['loadSettings', 'pushDisplaySettings', 'renderWindowRows', 'display-restore-state']);
});

test('панель подключает модули и ставит ячейки в разметку', () => {
    const control = read('electron-control.html');
    assert.match(control, /<script src="presets\.js"><\/script>/, 'панель не подключает presets.js');
    assert.match(control, /<script src="panel-presets\.js"><\/script>/, 'панель не подключает panel-presets.js');
    for (let i = 1; i <= Presets.PRESET_SLOTS; i++) {
        assert.match(control, new RegExp(`id="presetSlot${i}"`), `нет ячейки ${i}`);
    }
    assert.match(codeOnly(control), /window\.PanelPresets\.install\(/, 'ячейки ни к чему не привязаны');
});

test('дисплей умеет перечитать места карточек по просьбе', () => {
    // Пресет возвращает в профиль ЧУЖИЕ места и масштабы: без этой ветки
    // применение меняло бы стиль и не меняло раскладку.
    const display = codeOnly(read('display-script.js'));
    assert.match(display, /on\('display-restore-state'/, 'дисплей не слушает просьбу перечитать состояние');
    assert.match(
        display,
        /displayRestoreState = \(\) => \{[\s\S]{0,300}restoreBlockPositions\(\)/,
        'обработчик не восстанавливает места карточек'
    );
});

// ---------------------------------------------------------------------------
// «Применён» — это СОВПАДЕНИЕ, а не память о последнем клике
// ---------------------------------------------------------------------------
// Просьба 20.08.2026: «сделай более явные кнопочки визуально для пресет записан
// и пресет применен, сейчас не понятно какой активный».
//
// Отметку можно было бы хранить полем «последняя применённая ячейка». Такое
// поле ЛЖЁТ: после применения пресета 2 пользователь меняет стиль виджета — на
// экране уже не пресет 2, а отметка продолжает утверждать обратное. Поэтому
// «применён» вычисляется сравнением снимка с профилем: изменил настройку —
// отметка гаснет сама, без единого места, которое обязано о ней вспомнить.

test('«применён» = снимок совпадает с профилем; изменил настройку — не совпадает', () => {
    const store = fakeStorage(SAMPLE);
    const snap = Presets.capturePreset(store);
    assert.equal(Presets.matchesPreset(snap, store), true, 'свежий снимок не совпал сам с собой');
    store.setItem('displayTimerScale', '300');
    assert.equal(Presets.matchesPreset(snap, store), false, 'отметка пережила смену настройки');
});

test('совпадение не зависит от порядка ключей в JSON', () => {
    // Панель пересобирает displayExtSettings слиянием, и порядок ключей в
    // строке может отличаться при тех же значениях. Сравнение строк «как есть»
    // гасило бы отметку на ровном месте.
    const store = fakeStorage({ displayExtSettings: JSON.stringify({ a: 1, b: { x: 1, y: 2 } }) });
    const snap = Presets.capturePreset(store);
    store.setItem('displayExtSettings', JSON.stringify({ b: { y: 2, x: 1 }, a: 1 }));
    assert.equal(Presets.matchesPreset(snap, store), true);
});

test('пустая ячейка не бывает применённой', () => {
    assert.equal(Presets.matchesPreset({ values: {} }, fakeStorage(SAMPLE)), false);
    assert.equal(Presets.matchesPreset(null, fakeStorage(SAMPLE)), false);
});

test('ключ, которого в снимке нет, на совпадение не влияет', () => {
    // Применение такой ключ не трогает — значит и совпадению он не помеха,
    // иначе отметка не загоралась бы сразу после применения.
    const store = fakeStorage(SAMPLE);
    const snap = Presets.capturePreset(store);
    store.setItem('clockColors', JSON.stringify({ timer: '#00ff00' }));
    assert.equal(Presets.matchesPreset(snap, store), true);
});

test('после применения ячейка помечается применённой, соседняя — нет', () => {
    const store = fakeStorage(SAMPLE);
    Presets.writePreset(1, Presets.capturePreset(store), store);
    store.setItem('displayTimerScale', '300');
    Presets.writePreset(2, Presets.capturePreset(store), store);
    const all = Presets.readPresets(store);
    assert.equal(Presets.matchesPreset(all['2'], store), true, 'только что записанный вид не считается применённым');
    assert.equal(Presets.matchesPreset(all['1'], store), false, 'применёнными оказались две ячейки сразу');
    Presets.applyPreset(all['1'], store);
    assert.equal(Presets.matchesPreset(all['1'], store), true);
    assert.equal(Presets.matchesPreset(all['2'], store), false);
});

// ---------------------------------------------------------------------------
// Один владелец на ДВА комплекта кнопок: панель и полоса
// ---------------------------------------------------------------------------
// Просьба 20.08.2026: «когда сворачиваешь окно в минибар, добавь туда кнопочку
// блокировки всего и кнопочки пресетов».
//
// Соблазн — вторая привязка для полосы. Тогда состояние ячейки живёт в двух
// местах и расходится на первом же применении из другого комплекта. Поэтому
// bindPresets собирает ВСЕ элементы ячейки (сколько бы их ни было в документе)
// и красит их одним проходом.

function slotButtons(prefixes = ['presetSlot', 'miniPresetSlot']) {
    const buttons = {};
    for (const prefix of prefixes) {
        for (let i = 1; i <= 4; i++) {
            const b = fakeButton();
            b.classList.owner = b;
            buttons[`${prefix}${i}`] = b;
        }
    }
    return buttons;
}

test('ячейка красится в ОБОИХ комплектах — панельном и в полосе', () => {
    const buttons = slotButtons();
    const store = fakeStorage(SAMPLE);
    const api = PanelPresets.bindPresets({
        doc: fakeDoc(buttons), storage: store, presets: Presets, onApplied: () => {}
    });
    assert.ok(api);
    api.save(2);
    assert.equal(buttons.presetSlot2.classes.has('filled'), true, 'панельная ячейка не помечена записанной');
    assert.equal(buttons.miniPresetSlot2.classes.has('filled'), true, 'ячейка в полосе не помечена записанной');
    assert.equal(buttons.miniPresetSlot2.classes.has('active'), true, 'только что записанный вид не помечен применённым');
});

test('клик по ячейке В ПОЛОСЕ применяет тот же вид, что и в панели', () => {
    const buttons = slotButtons();
    const store = fakeStorage(SAMPLE);
    let applied = 0;
    const api = PanelPresets.bindPresets({
        doc: fakeDoc(buttons), storage: store, presets: Presets, onApplied: () => { applied++; }
    });
    api.save(1);
    store.setItem('displayTimerScale', '300');
    buttons.miniPresetSlot1.listeners.click({ shiftKey: false });
    assert.equal(applied, 1, 'клик в полосе не позвал пересборку окон');
    assert.equal(store.data.displayTimerScale, '120', 'клик в полосе не вернул вид');
    // Shift в полосе — то же «записать», второго договора у полосы нет.
    store.setItem('displayTimerScale', '90');
    buttons.miniPresetSlot1.listeners.click({ shiftKey: true });
    assert.equal(applied, 1, 'Shift+клик в полосе применил вместо записи');
    assert.equal(Presets.readPresets(store)['1'].values.displayTimerScale, '90');
});

test('отметка «применён» гаснет, когда вид разошёлся, и горит ровно у одной ячейки', () => {
    const buttons = slotButtons();
    const store = fakeStorage(SAMPLE);
    const api = PanelPresets.bindPresets({
        doc: fakeDoc(buttons), storage: store, presets: Presets, onApplied: () => {}
    });
    api.save(1);
    assert.equal(buttons.presetSlot1.classes.has('active'), true);
    assert.equal(buttons.presetSlot1.attrs['aria-pressed'], 'true', 'состояние не объявлено для скринридера');

    // Пользователь поменял настройку: пресет 1 на экране больше не показан.
    store.setItem('displayTimerScale', '300');
    api.refresh();
    assert.equal(buttons.presetSlot1.classes.has('active'), false, 'отметка пережила смену настройки');
    assert.equal(buttons.presetSlot1.classes.has('filled'), true, 'ячейка перестала быть записанной');
    assert.equal(buttons.miniPresetSlot1.classes.has('active'), false, 'в полосе отметка осталась гореть');

    api.save(2);
    assert.equal(buttons.presetSlot2.classes.has('active'), true);
    assert.equal(buttons.presetSlot1.classes.has('active'), false, 'применёнными горят две ячейки сразу');
});

test('подсказка ячейки называет ТРИ состояния разными словами', () => {
    const buttons = slotButtons(['presetSlot']);
    const store = fakeStorage(SAMPLE);
    const api = PanelPresets.bindPresets({
        doc: fakeDoc(buttons), storage: store, presets: Presets, onApplied: () => {}
    });
    const empty = buttons.presetSlot1.attrs['aria-label'];
    api.save(1);
    const active = buttons.presetSlot1.attrs['aria-label'];
    store.setItem('displayTimerScale', '300');
    api.refresh();
    const filled = buttons.presetSlot1.attrs['aria-label'];
    assert.notEqual(empty, filled, 'пустая и записанная ячейки подписаны одинаково');
    assert.notEqual(active, filled, 'применённая и просто записанная подписаны одинаково');
    assert.match(active, /сейчас на экране/, 'применённая ячейка не говорит, что она на экране');
});

// ---------------------------------------------------------------------------
// Подпись ряда — ОТЧЁТ о том, какой вид на экране
// ---------------------------------------------------------------------------
// Жалоба 20.08.2026 повторилась после первой правки: «не понятно, какой профиль
// сейчас выбран». Одной заливки мало ещё и потому, что у вопроса бывает ответ
// «никакой»: стоит поменять любую настройку — и ни одна ячейка не совпадает с
// экраном. Молчащий ряд в этом состоянии выглядит как поломка, поэтому ряд
// ОТВЕЧАЕТ словом: «Вид · 2» либо «Вид · свой».

test('подпись ряда называет применённую ячейку, а без совпадения говорит «свой»', () => {
    const buttons = slotButtons(['presetSlot']);
    const caption = { textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const doc = {
        getElementById: (id) => (id === 'presetCaption' ? caption : buttons[id] || null),
        addEventListener: () => {}
    };
    const store = fakeStorage(SAMPLE);
    const api = PanelPresets.bindPresets({ doc, storage: store, presets: Presets, onApplied: () => {} });

    assert.match(caption.textContent, /свой/, 'на чистом профиле ряд не признаётся, что вид не из ячейки');

    api.save(2);
    assert.match(caption.textContent, /2/, 'подпись не назвала применённую ячейку');
    assert.doesNotMatch(caption.textContent, /свой/);

    store.setItem('displayTimerScale', '300');
    api.refresh();
    assert.match(caption.textContent, /свой/, 'подпись пережила правку настройки — она врёт про экран');
});

// ---------------------------------------------------------------------------
// Применённой может быть ТОЛЬКО ОДНА ячейка
// ---------------------------------------------------------------------------
// Жалоба 20.08.2026 повторилась ТРЕТИЙ раз: «всё ещё нет чёткого различия между
// пресет записан и пресет применён». Замер в живом окне объяснил почему: три
// ячейки подряд записывали ОДИН И ТОТ ЖЕ вид (между кликами ничего не меняли),
// снимки совпадали с профилем у всех трёх — и все три горели применёнными.
// Различие было, но означало «этот вид на экране», а не «выбрана эта ячейка»,
// и при одинаковых снимках вырождалось.
//
// Отсюда договор: применённая — та, которую ПОСЛЕДНЕЙ применили или записали, и
// только пока её снимок ещё совпадает с профилем. Память одна лжёт (переживает
// правку настройки), сравнение одно — неоднозначно (совпасть может несколько);
// вместе они дают ровно один честный ответ.

test('применённой считается последняя нажатая ячейка, а не каждая совпавшая', () => {
    const store = fakeStorage(SAMPLE);
    // Три ячейки с ОДИНАКОВЫМ снимком: вид между записями не менялся.
    for (const slot of [1, 2, 3]) {
        Presets.writePreset(slot, Presets.capturePreset(store), store);
        Presets.writeActiveSlot(slot, store);
    }
    assert.equal(Presets.activeSlot(store), '3', 'применённой считается не последняя нажатая');

    Presets.writeActiveSlot(1, store);
    assert.equal(Presets.activeSlot(store), '1');
});

test('память о ячейке проверяется сравнением: разошёлся вид — применённых нет', () => {
    const store = fakeStorage(SAMPLE);
    Presets.writePreset(2, Presets.capturePreset(store), store);
    Presets.writeActiveSlot(2, store);
    assert.equal(Presets.activeSlot(store), '2');

    store.setItem('displayTimerScale', '300');
    assert.equal(Presets.activeSlot(store), null, 'память пережила правку настройки — она врёт про экран');
});

test('мусор в памяти о ячейке не ломает ряд', () => {
    const store = fakeStorage(SAMPLE);
    Presets.writePreset(1, Presets.capturePreset(store), store);
    for (const junk of ['9', 'первый', '', '0']) {
        store.setItem('uiPresetActive', junk);
        assert.equal(Presets.activeSlot(store), null, `мусор «${junk}» принят за номер ячейки`);
    }
    // Ячейка, которую стёрли, тоже не применена.
    store.setItem('uiPresetActive', '4');
    assert.equal(Presets.activeSlot(store), null);
});

test('в ряду горит РОВНО ОДНА ячейка, даже если снимки одинаковые', () => {
    const buttons = slotButtons(['presetSlot']);
    const store = fakeStorage(SAMPLE);
    const api = PanelPresets.bindPresets({
        doc: fakeDoc(buttons), storage: store, presets: Presets, onApplied: () => {}
    });
    api.save(1);
    api.save(2);
    api.save(3);
    const lit = [1, 2, 3, 4].filter((i) => buttons[`presetSlot${i}`].classes.has('active'));
    assert.deepEqual(lit, [3], `горят ячейки ${lit.join(', ')} вместо одной`);
    // Все три при этом ЗАПИСАНЫ — это другое состояние, и оно не исчезло.
    for (const i of [1, 2, 3]) {
        assert.equal(buttons[`presetSlot${i}`].classes.has('filled'), true, `ячейка ${i} потеряла признак «записана»`);
    }
    // Применение зажигает ту, по которой щёлкнули.
    api.apply(1);
    const litAfter = [1, 2, 3, 4].filter((i) => buttons[`presetSlot${i}`].classes.has('active'));
    assert.deepEqual(litAfter, [1]);
});
