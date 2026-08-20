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
 * Где живут ячейки. Комплектов ДВА — в развёрнутой панели и в полосе, — но
 * привязка одна: второй bindPresets означал бы второе место, которое решает,
 * какая ячейка помечена, и они разошлись бы на первом же применении из полосы.
 */
const SLOT_BUTTON_PREFIXES = [SLOT_BUTTON_PREFIX, 'miniPresetSlot'];

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {Storage} deps.storage
 * @param {object} deps.presets              модуль presets.js
 * @param {() => void} deps.onApplied        что делать после записи ключей
 * @param {(msg: string) => void} [deps.notify]  сообщение пользователю
 * @param {string[]} [deps.prefixes]         префиксы id комплектов кнопок
 * @returns {{apply: (slot:number)=>boolean, save: (slot:number)=>boolean, refresh: ()=>void}|null}
 */
function bindPresets({ doc, storage, presets, onApplied, notify, prefixes = SLOT_BUTTON_PREFIXES }) {
    if (!doc || !storage || !presets) { return null; }

    const cells = [];
    for (let slot = 1; slot <= presets.PRESET_SLOTS; slot++) {
        const els = [];
        for (const prefix of prefixes) {
            const el = doc.getElementById(`${prefix}${slot}`);
            if (el) { els.push(el); }
        }
        if (els.length) { cells.push({ slot, els }); }
    }
    if (!cells.length) { return null; }

    const say = (msg) => { if (typeof notify === 'function') { notify(msg); } };

    /**
     * Три состояния ячейки, и каждое видно.
     *
     * Пустая ячейка выглядит пустой. Кнопка, которая молчит на клик, читается
     * как сломанная, поэтому пустая ячейка не молчит: она ЗАПИСЫВАЕТ текущий
     * вид (и говорит об этом). Это же решает задачу «как узнать, что тут можно
     * сохранить» без второй кнопки на четыре ячейки.
     *
     * ЗАПИСАННАЯ и ПРИМЕНЁННАЯ — разные состояния, и до 20.08.2026 они
     * выглядели одинаково: «не понятно, какой активный». Применённая — та, чей
     * снимок СОВПАДАЕТ с текущим профилем (см. presets.matchesPreset), поэтому
     * отметка гаснет сама, как только пользователь что-нибудь поменял.
     */
    // Подпись ряда — ОТЧЁТ, а не ярлык: она отвечает на вопрос «какой вид
    // сейчас», включая ответ «никакой из ячеек». Молчащий ряд в этом состоянии
    // читается как поломка, а не как «вид настроен руками».
    const caption = doc.getElementById('presetCaption');

    const refresh = () => {
        // Применена РОВНО ОДНА ячейка — последняя нажатая, и только пока её
        // снимок совпадает с профилем. Одного совпадения мало: одинаковые
        // снимки в разных ячейках совпадают все сразу, и горел бы весь ряд.
        const applied = presets.activeSlot(storage);
        for (const { slot, els } of cells) {
            const filled = presets.hasPreset(slot, storage);
            const active = filled && applied === String(slot);
            const label = !filled
                ? `Пресет ${slot}: пусто. Клик запомнит текущий вид`
                : (active
                    ? `Пресет ${slot}: этот вид сейчас на экране. Shift+клик — заменить его текущим`
                    : `Пресет ${slot}: применить сохранённый вид. Shift+клик — заменить его текущим`);
            const title = !filled
                ? `Ячейка ${slot} пуста.\nКлик запомнит в неё текущий вид: стили окон, блоки и их места, цвета, масштабы`
                : (active
                    ? `Вид из ячейки ${slot} сейчас на экране.\nShift+клик — заменить его текущим видом`
                    : `Применить вид из ячейки ${slot} (или Ctrl+${slot})\nShift+клик — заменить его текущим видом`);
            for (const el of els) {
                el.classList.toggle('filled', filled);
                el.classList.toggle('active', active);
                // Состояние объявляется и словом: индикатор, отличимый только
                // цветом, в этом проекте уже был отдельным дефектом.
                el.setAttribute('aria-pressed', String(active));
                el.setAttribute('aria-label', label);
                el.title = title;
            }
        }
        if (caption) {
            caption.textContent = applied ? `Вид · ${applied}` : 'Вид · свой';
            caption.setAttribute('title', applied
                ? `На экране вид из ячейки ${applied}`
                : 'Вид настроен вручную и ни с одной ячейкой не совпадает');
        }
    };

    const save = (slot) => {
        const key = presets.normalizeSlot(slot);
        if (!key) { return false; }
        presets.writePreset(key, presets.capturePreset(storage), storage);
        // Запись — тоже выбор: записанный вид И ЕСТЬ то, что на экране.
        presets.writeActiveSlot(key, storage);
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
        presets.writeActiveSlot(key, storage);
        if (typeof onApplied === 'function') { onApplied(); }
        refresh();
        say(`Пресет ${key} применён`);
        return true;
    };

    for (const { slot, els } of cells) {
        for (const el of els) {
            el.addEventListener('click', (e) => {
                // Shift — «записать», без него — «применить». Одна кнопка на два
                // действия, потому что четыре ячейки × две кнопки не помещаются в
                // панель шириной 400px, а модальное «сейчас режим записи» — это
                // состояние, которое пользователь обязан помнить.
                if (e.shiftKey) { save(slot); } else { apply(slot); }
            });
        }
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
    // Настройки меняются и в ДРУГИХ окнах: места карточек дисплея, масштабы
    // блоков, стиль часов. Отметка «применён» обязана гаснуть и от них, иначе
    // она врёт ровно в том случае, ради которого затевалась. Событие storage
    // приходит от чужого документа того же происхождения — опроса не нужно.
    const view = doc.defaultView;
    if (view && typeof view.addEventListener === 'function') {
        view.addEventListener('storage', () => api.refresh());
        // Страховка на случай, если событие storage между окнами не доедет:
        // вернулся в панель — отметки пересчитаны. Тоже по событию, без опроса.
        view.addEventListener('focus', () => api.refresh());
    }
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

const PanelPresets = { bindPresets, presetHotkeyHandler, applyProfile, install, SLOT_BUTTON_PREFIX, SLOT_BUTTON_PREFIXES };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PanelPresets;
}

if (typeof window !== 'undefined') {
    window.PanelPresets = PanelPresets;
}
