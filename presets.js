'use strict';

/**
 * presets.js — четыре ячейки «как всё выглядит»: стили, блоки, раскладка,
 * цвета, шрифты, масштабы.
 *
 * Просьба 19.08.2026: «пресеты для быстрой настройки стилей и отображения,
 * чтобы долго не ковыряться: выбрать пресет и запустить. Нужно для всех —
 * полноэкранного, таймера и виджета, что-то типа контрол 1-2-3-4, больше не
 * надо, 4 пресета; ещё можно один раз настроить и сохранить настройку в
 * пресет».
 *
 * ЧТО ЗАПОМИНАЕТСЯ. Ключи профиля, из которых собран ВИД приложения, — тот же
 * список, что окна читают при открытии. Пресет не изобретает своей структуры и
 * не пересказывает настройки полями: он хранит ЗНАЧЕНИЯ ТЕХ ЖЕ КЛЮЧЕЙ. Иначе
 * появилась бы вторая копия знания о том, из чего состоит вид, и разошлась бы
 * с первой на первой же новой настройке.
 *
 * ЧЕГО В ПРЕСЕТЕ НЕТ И ПОЧЕМУ:
 *   - `localBgImage` — картинка фона весит мегабайты, а ячеек четыре: пресеты
 *     выбили бы квоту localStorage и утащили с собой всё остальное. Режим фона
 *     и настройки вписывания запоминаются, сама картинка остаётся текущей;
 *   - геометрия окон виджета и часов (`widgetGeometry`, `clockGeometry`) —
 *     это ГДЕ окно на экране, а не как оно выглядит. Пресет, переносящий окна
 *     между мониторами, на чужой машине уводит их за край;
 *   - длительность таймера — пресет отвечает за вид, а не за ход мероприятия:
 *     применение пресета во время отсчёта не должно менять оставшееся время.
 *
 * Модуль ЧИСТЫЙ: на вход — хранилище (внедряется), на выход — объект. Ни DOM,
 * ни IPC он не знает, поэтому проверяется в Node на поддельном хранилище
 * (tests/presets.test.js), а проводка — отдельно.
 */

/** Сколько ячеек. Ровно четыре — «больше не надо» из просьбы. */
const PRESET_SLOTS = 4;

/** Где лежат сами пресеты. */
const PRESETS_STORAGE_KEY = 'uiPresets';

/**
 * Какую ячейку применили последней.
 *
 * Зачем номер, если совпадение и так вычисляется. Потому что совпадение
 * отвечает на вопрос «этот ли вид на экране», а не «какая ячейка выбрана», и
 * при одинаковых снимках вырождается: три ячейки, записанные подряд без правок
 * между ними, совпадают ВСЕ ТРИ и горят все три. Замер в живом окне 20.08.2026
 * показал ровно это, и со стороны выглядело как «различия между записан и
 * применён нет».
 *
 * Память и сравнение работают в паре: память отвечает «какая», сравнение —
 * «ещё ли». Память в одиночку врёт (переживает любую правку настройки),
 * сравнение в одиночку неоднозначно.
 */
const ACTIVE_SLOT_STORAGE_KEY = 'uiPresetActive';

/**
 * Ключи профиля, из которых состоит ВИД.
 *
 * Порядок значения не имеет, но список держится одним местом: добавили
 * настройку с собственным ключом — добавьте её сюда, иначе пресет будет
 * возвращать «почти всё», а это хуже, чем не возвращать ничего.
 */
const PRESET_KEYS = [
    // Всё, что панель собирает таблицей settings-schema.js: стили трёх окон,
    // тумблеры блоков, шрифты «Цифр», фон, масштабы, время и название события.
    'displayExtSettings',
    // Цвета — у каждого окна свои.
    'timerColors',
    'widgetColors',
    'clockColors',
    'displayColors',
    // Настройки окна часов и общая настройка делений.
    'clockWidgetSettings',
    'clockShowTicks',
    // Полноэкранное окно: масштаб таймера, масштабы и МЕСТА карточек.
    'displayTimerScale',
    'displayBlockScale',
    'displayBlockScales',
    'displayBlockPositions',
    // Настройки вписывания локального фона (без самой картинки).
    'localBgSettings'
];

function safeParse(raw, fallback) {
    if (typeof raw !== 'string') { return fallback; }
    try {
        const parsed = JSON.parse(raw);
        return parsed === null ? fallback : parsed;
    } catch {
        return fallback;
    }
}

/** Номер ячейки → нормализованный ключ или null. */
function normalizeSlot(slot) {
    const n = parseInt(slot, 10);
    if (!Number.isFinite(n) || n < 1 || n > PRESET_SLOTS) { return null; }
    return String(n);
}

/**
 * Снять текущий вид.
 *
 * Отсутствующий ключ НЕ записывается вовсе (а не пишется как null): пресет
 * снят с профиля, в котором этой настройки не было, и применять её как
 * «пусто» значило бы стирать чужую настройку у того, кто пресет применяет.
 *
 * @param {Storage} storage
 * @returns {{savedAt:null, values:object}} снимок
 */
function capturePreset(storage) {
    const values = {};
    if (!storage) { return { values }; }
    for (const key of PRESET_KEYS) {
        let raw;
        try { raw = storage.getItem(key); } catch { /* ключ недоступен — пропускаем */ }
        if (typeof raw === 'string') { values[key] = raw; }
    }
    return { values };
}

/**
 * Применить снимок к профилю.
 *
 * Возвращает список ключей, которые действительно записаны, — по нему
 * вызывающий решает, что пересылать окнам.
 */
function applyPreset(preset, storage) {
    const values = preset && preset.values ? preset.values : null;
    if (!values || !storage) { return []; }
    const written = [];
    for (const key of PRESET_KEYS) {
        const raw = values[key];
        if (typeof raw !== 'string') { continue; }
        try {
            storage.setItem(key, raw);
            written.push(key);
        } catch { /* квота: остальные ключи всё равно применяем */ }
    }
    return written;
}

/** Все ячейки: ключ '1'…'4' → снимок. Мусор игнорируется. */
function readPresets(storage) {
    if (!storage) { return {}; }
    let raw;
    try { raw = storage.getItem(PRESETS_STORAGE_KEY); } catch { /* хранилище недоступно */ }
    const parsed = safeParse(raw, {});
    if (typeof parsed !== 'object' || Array.isArray(parsed)) { return {}; }
    const out = {};
    for (const [slot, preset] of Object.entries(parsed)) {
        const key = normalizeSlot(slot);
        if (!key) { continue; }
        if (!preset || typeof preset !== 'object' || typeof preset.values !== 'object' || !preset.values) { continue; }
        out[key] = preset;
    }
    return out;
}

/** Записать снимок в ячейку. Возвращает обновлённый набор ячеек. */
function writePreset(slot, preset, storage) {
    const key = normalizeSlot(slot);
    if (!key || !storage) { return readPresets(storage); }
    const all = readPresets(storage);
    all[key] = preset;
    try {
        storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(all));
    } catch { /* квота — пресет не сохранился, окно об этом скажет тостом */ }
    return all;
}

/**
 * Каноничный вид значения для СРАВНЕНИЯ.
 *
 * Значения в профиле — строки, и почти все они JSON. Панель пересобирает их
 * слиянием (`{ ...prev, ...settings }`), поэтому при тех же значениях порядок
 * ключей в строке может отличаться. Сравнение строк «как есть» гасило бы
 * отметку «применён» на ровном месте, поэтому объекты сравниваются с
 * упорядоченными ключами, а не-JSON остаётся строкой.
 */
function canonicalValue(raw) {
    if (typeof raw !== 'string') { return null; }
    const trimmed = raw.trim();
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) { return raw; }
    try {
        return JSON.stringify(sortDeep(JSON.parse(trimmed)));
    } catch {
        return raw;
    }
}

function sortDeep(value) {
    if (Array.isArray(value)) { return value.map(sortDeep); }
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) { out[key] = sortDeep(value[key]); }
        return out;
    }
    return value;
}

/**
 * Показывает ли экран ИМЕННО этот пресет.
 *
 * Отметку «применён» можно было бы хранить полем «последняя нажатая ячейка».
 * Такое поле лжёт: после применения пресета пользователь меняет одну настройку,
 * на экране уже не пресет — а поле продолжает утверждать обратное. Поэтому
 * состояние ВЫЧИСЛЯЕТСЯ: совпали значения всех ключей снимка — значит на экране
 * он, разошёлся хоть один — отметка гаснет сама.
 *
 * Сравниваются ТОЛЬКО ключи снимка: остальных применение не касается, и
 * требовать от них совпадения значило бы не зажигать отметку никогда.
 */
function matchesPreset(preset, storage) {
    const values = preset && preset.values ? preset.values : null;
    if (!values || !storage) { return false; }
    const keys = PRESET_KEYS.filter((key) => typeof values[key] === 'string');
    if (!keys.length) { return false; }
    for (const key of keys) {
        let raw;
        try { raw = storage.getItem(key); } catch { return false; }
        if (canonicalValue(raw) !== canonicalValue(values[key])) { return false; }
    }
    return true;
}

/** Есть ли что применять в ячейке. */
function hasPreset(slot, storage) {
    const key = normalizeSlot(slot);
    if (!key) { return false; }
    const all = readPresets(storage);
    return !!(all[key] && all[key].values && Object.keys(all[key].values).length > 0);
}

/** Запомнить, какую ячейку применили (или записали — это тоже выбор). */
function writeActiveSlot(slot, storage) {
    const key = normalizeSlot(slot);
    if (!storage) { return null; }
    try {
        if (key) { storage.setItem(ACTIVE_SLOT_STORAGE_KEY, key); } else { storage.removeItem(ACTIVE_SLOT_STORAGE_KEY); }
    } catch { /* переполненное хранилище не должно ломать ряд */ }
    return key;
}

/**
 * Какая ячейка ПРИМЕНЕНА сейчас: последняя нажатая, если её снимок всё ещё
 * совпадает с профилем. Иначе — никакая, и ряд обязан это сказать словом.
 */
function activeSlot(storage) {
    if (!storage) { return null; }
    let raw;
    try { raw = storage.getItem(ACTIVE_SLOT_STORAGE_KEY); } catch { return null; }
    const key = normalizeSlot(raw);
    if (!key) { return null; }
    const preset = readPresets(storage)[key];
    if (!preset || !matchesPreset(preset, storage)) { return null; }
    return key;
}

const Presets = {
    PRESET_SLOTS,
    PRESETS_STORAGE_KEY,
    PRESET_KEYS,
    normalizeSlot,
    capturePreset,
    applyPreset,
    readPresets,
    writePreset,
    hasPreset,
    matchesPreset,
    ACTIVE_SLOT_STORAGE_KEY,
    writeActiveSlot,
    activeSlot
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Presets;
}

if (typeof window !== 'undefined') {
    window.Presets = Presets;
}
