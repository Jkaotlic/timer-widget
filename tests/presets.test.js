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
