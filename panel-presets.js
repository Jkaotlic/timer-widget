'use strict';

/**
 * panel-presets.js — четыре ячейки пресетов в панели: клик применяет,
 * Shift+клик записывает.
 *
 * Сам снимок собирает и раскладывает presets.js (чистый модуль над
 * хранилищем). Здесь — панельная сторона: кнопки, подписи, горячие клавиши и
 * то, ЧТО нужно сделать после записи ключей, чтобы окна показали новое.
 *
 * Применение пресета — это не «послать окнам объект»: панель уже умеет
 * раскладывать профиль по контролам и рассылать его (loadSettings +
 * pushDisplaySettings). Пресет пишет ТЕ ЖЕ ключи профиля и зовёт тот же путь.
 * Вторая дорога до окон разошлась бы с первой на первой же новой настройке.
 *
 * Зависимости внедряются, поэтому поведение проверяется в Node на поддельных
 * документе и хранилище (tests/presets.test.js).
 */

const SLOT_BUTTON_PREFIX = 'presetSlot';

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {Storage} deps.storage
 * @param {object} deps.presets              модуль presets.js
 * @param {() => void} deps.onApplied        что делать после записи ключей
 * @param {(msg: string) => void} [deps.notify]  сообщение пользователю
 * @returns {{apply: (slot:number)=>boolean, save: (slot:number)=>boolean, refresh: ()=>void}|null}
 */
function bindPresets({ doc, storage, presets, onApplied, notify }) {
    if (!doc || !storage || !presets) { return null; }

    const buttons = [];
    for (let slot = 1; slot <= presets.PRESET_SLOTS; slot++) {
        const el = doc.getElementById(`${SLOT_BUTTON_PREFIX}${slot}`);
        if (el) { buttons.push({ slot, el }); }
    }
    if (!buttons.length) { return null; }

    const say = (msg) => { if (typeof notify === 'function') { notify(msg); } };

    /**
     * Пустая ячейка выглядит пустой.
     *
     * Кнопка, которая молчит на клик, читается как сломанная, поэтому пустая
     * ячейка не молчит: она ЗАПИСЫВАЕТ текущий вид (и говорит об этом). Это же
     * решает задачу «как узнать, что тут можно сохранить» без второй кнопки на
     * четыре ячейки.
     */
    const refresh = () => {
        for (const { slot, el } of buttons) {
            const filled = presets.hasPreset(slot, storage);
            el.classList.toggle('filled', filled);
            el.setAttribute('aria-label', filled
                ? `Пресет ${slot}: применить (Shift+клик — перезаписать)`
                : `Пресет ${slot}: пусто, клик сохранит текущий вид`);
            el.title = filled
                ? `Применить пресет ${slot} · Ctrl+${slot}\nShift+клик — записать текущий вид`
                : `Пусто. Клик запишет текущий вид в пресет ${slot}`;
        }
    };

    const save = (slot) => {
        const key = presets.normalizeSlot(slot);
        if (!key) { return false; }
        presets.writePreset(key, presets.capturePreset(storage), storage);
        refresh();
        say(`Пресет ${key} записан`);
        return true;
    };

    const apply = (slot) => {
        const key = presets.normalizeSlot(slot);
        if (!key) { return false; }
        const all = presets.readPresets(storage);
        const preset = all[key];
        if (!preset) {
            // Пустая ячейка не молчит — она предлагает единственное осмысленное
            // действие: запомнить то, что на экране сейчас.
            return save(key);
        }
        const written = presets.applyPreset(preset, storage);
        if (!written.length) { return false; }
        if (typeof onApplied === 'function') { onApplied(); }
        say(`Пресет ${key} применён`);
        return true;
    };

    for (const { slot, el } of buttons) {
        el.addEventListener('click', (e) => {
            // Shift — «записать», без него — «применить». Одна кнопка на два
            // действия, потому что четыре ячейки × две кнопки не помещаются в
            // панель шириной 400px, а модальное «сейчас режим записи» — это
            // состояние, которое пользователь обязан помнить.
            if (e.shiftKey) { save(slot); } else { apply(slot); }
        });
    }

    refresh();
    return { apply, save, refresh };
}

/**
 * Ctrl+1…4 — применить, Ctrl+Shift+1…4 — записать.
 *
 * Отдельная функция: те же клавиши нужны и в полноэкранном окне, где своего
 * хранилища настроек нет, и оно шлёт номер ячейки в панель.
 *
 * ПРОСТЫЕ 1…4 не трогаются: на дисплее они уже ставят длительность из
 * CONFIG.PRESET_DURATIONS, и отобрать их значило бы сломать работающий жест
 * ради нового.
 *
 * @returns {(e: KeyboardEvent) => void} обработчик keydown
 */
function presetHotkeyHandler({ apply, save, slots = 4 }) {
    return (e) => {
        if (!e.ctrlKey && !e.metaKey) { return; }
        const m = /^Digit([1-9])$/.exec(e.code || '');
        if (!m) { return; }
        const slot = Number(m[1]);
        if (slot > slots) { return; }
        e.preventDefault();
        if (e.shiftKey) {
            if (typeof save === 'function') { save(slot); }
        } else if (typeof apply === 'function') {
            apply(slot);
        }
    };
}

/**
 * Перечитать профиль и разослать его окнам.
 *
 * Ровно тот же путь, которым панель поднимается при запуске: `loadSettings()`
 * раскладывает ключи по контролам и рассылает стиль, цвета и настройки часов,
 * `pushDisplaySettings()` — набор полноэкранного окна, а `display-restore-state`
 * просит его перечитать МЕСТА карточек: они лежат в профиле, а не в payload.
 *
 * Функция здесь, а не методом контроллера, по той же причине, что и остальные
 * панельные модули: у `electron-control.html` храповик на размер, и знание,
 * которое можно вынести, выносится.
 */
function applyProfile(controller, ipc) {
    if (!controller) { return false; }
    controller.loadSettings();
    if (typeof controller.pushDisplaySettings === 'function') { controller.pushDisplaySettings(); }
    if (typeof controller.renderWindowRows === 'function') { controller.renderWindowRows(); }
    if (ipc && typeof ipc.send === 'function') { ipc.send('display-restore-state'); }
    return true;
}

/**
 * Всё вместе: кнопки, горячие клавиши и путь применения.
 *
 * Одна точка входа, потому что панель обязана оставаться тонкой: у
 * `electron-control.html` храповик на размер, и десять строк проводки в нём —
 * это десять строк, которые кто-то потом будет искать среди трёх тысяч.
 *
 * `controller` принимается функцией ИЛИ объектом: в момент установки
 * контроллер панели может быть ещё не создан, а искать его в момент
 * применения — надёжно.
 */
function install({ doc, storage, presets, controller, ipc, notify }) {
    const resolve = () => (typeof controller === 'function' ? controller() : controller);
    const api = bindPresets({
        doc,
        storage,
        presets,
        onApplied: () => applyProfile(resolve(), ipc),
        notify
    });
    if (!api) { return null; }
    doc.addEventListener('keydown', presetHotkeyHandler({
        apply: (slot) => api.apply(slot),
        save: (slot) => api.save(slot),
        slots: presets.PRESET_SLOTS
    }));
    // Те же Ctrl+1…4, нажатые в ДРУГОМ окне: своего профиля у него нет, оно
    // шлёт номер ячейки сюда (см. канал `preset-apply`).
    if (ipc && typeof ipc.on === 'function') {
        ipc.on('preset-apply', (_event, payload) => api.apply(payload && payload.slot));
    }
    return api;
}

const PanelPresets = { bindPresets, presetHotkeyHandler, applyProfile, install, SLOT_BUTTON_PREFIX };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PanelPresets;
}

if (typeof window !== 'undefined') {
    window.PanelPresets = PanelPresets;
}
