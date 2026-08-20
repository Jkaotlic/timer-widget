'use strict';

/**
 * settings-schema.js — таблица настроек панели управления и две операции над ней:
 * разложить сохранённое по контролам и собрать сохраняемое обратно.
 *
 * Зачем модуль. В `electron-control.html` эти две операции были написаны руками,
 * по строке на настройку: `loadSettings()` — лесенка из 28 присваиваний вида
 * `ext.foo !== false` / `ext.bar || 100` / `ext.a || ext.b || 'circle'`, а
 * `saveExtSettings()` — параллельный ей объектный литерал. Две копии одного знания
 * (ключ, контрол, значение по умолчанию) в разных концах файла: значение по
 * умолчанию правится в одной, ключ добавляется в другую, и настройка молча
 * возвращается к дефолту после перезапуска. Ни пиксельная сверка, ни линтер такого
 * не видят — видит только круговой рейс (`e2e/settings-roundtrip.spec.js`).
 *
 * Теперь знание одно: строка таблицы. Из неё выводится и чтение, и запись.
 *
 * Что СПЕЦИАЛЬНО осталось за пределами таблицы (в панели, руками):
 *   - `overrunLimitSeconds` — в хранилище секунды, в поле «MM:SS»; свой формат в
 *     обе стороны;
 *   - `bgMode` — не поле ввода, а три кнопки с классом `.active`, плюс отображение
 *     устаревшего значения `image` в `solid`;
 *   - все побочные эффекты загрузки (видимость строк, отправка в окна, поля
 *     контроллера) — таблица описывает ЗНАЧЕНИЯ, а не поведение.
 *
 * Модуль не знает ни о `timerController`, ни о localStorage: на вход — простой
 * объект настроек и `document`. Поэтому его поведение проверяется юнит-тестами на
 * поддельном DOM (`tests/settings-schema.test.js`), а не только через e2e.
 *
 * Двойной экспорт, как в utils.js / renderer-shared.js:
 *   - Node (тесты):     `module.exports`
 *   - Браузер (рендер): `window.SettingsSchema`
 */

// ---------------------------------------------------------------------------
// Таблица
// ---------------------------------------------------------------------------
/**
 * Тумблеры полноэкранного окна: пять БЛОКОВ и две ПОДПИСИ.
 *
 * Список живёт здесь, а не рядом с проводкой, потому что нужен в трёх местах и
 * в двух процессах: панель по нему навешивает обработчики и собирает payload
 * (panel-display.js), а главный процесс проверяет по нему имя блока, пришедшее
 * из окна при закрытии крестиком. Три копии одного перечня — это ровно тот
 * дефект, ради которого написан этот файл.
 *
 * Ключ совпадает с id контрола, как во всей таблице ниже; что каждый из них в
 * таблице ОПИСАН, проверяет tests/settings-schema.test.js.
 */
const DISPLAY_BLOCK_KEYS = [
    'showCurrentTime', 'showEventTime', 'showEndTime', 'showTimeLeft', 'showEventTitle'
];
const DISPLAY_LABEL_KEYS = ['showHeroLabel', 'showStatusPill'];

/**
 * Поля строки:
 *   key      — ключ в `displayExtSettings`;
 *   el       — id контрола;
 *   kind     — 'checkbox' | 'value' (value: select, text, color, range, сегментированный);
 *   def      — значение по умолчанию, когда в хранилище ничего нет;
 *   legacy   — устаревшие ключи, откуда брать значение, если своего ещё нет
 *              (порядок значим: сначала свой ключ, потом эти);
 *   label    — id элемента, которому при раскладке пишется `значение + '%'`;
 *   numeric  — при сборке значение проходит через parseInt;
 *   saveMin  — подстановка при нечисловом вводе (сохраняет прежнее `parseInt(x) || 1`);
 *   alsoWrite — дополнительные ключи, куда пишется то же значение (обратная
 *              совместимость: старые ключи `timerStyle` / `timerScale` до сих пор
 *              читаются как запасные, поэтому их надо продолжать писать);
 *   fallbackEl — откуда брать значение при сборке, если своего контрола нет в DOM;
 *   keepIfUnset — не трогать контрол, если в хранилище пусто (оставить значение из
 *              разметки). Ровно прежнее `if (ext.overrunIntervalMinutes) { ... }`.
 *
 * Значения по умолчанию здесь — те же, что были в лесенке `loadSettings()`;
 * `def: true` соответствует прежнему `ext.foo !== false`, `def: false` — `!!ext.foo`.
 */
const SETTINGS_DESCRIPTORS = [
    // --- главный экран ---
    { key: 'allowNegative', el: 'allowNegative', kind: 'checkbox', def: false },

    // --- звуки ---
    { key: 'soundMasterEnabled', el: 'soundMasterEnabled', kind: 'checkbox', def: true },
    { key: 'soundStartEnabled', el: 'soundStartEnabled', kind: 'checkbox', def: false },
    { key: 'soundEndEnabled', el: 'soundEndEnabled', kind: 'checkbox', def: true },
    { key: 'soundMinuteEnabled', el: 'soundMinuteEnabled', kind: 'checkbox', def: false },
    { key: 'soundOverrunEnabled', el: 'soundOverrunEnabled', kind: 'checkbox', def: false },
    // Умолчание — звук, НАПИСАННЫЙ под это событие (см. sound-bank.js).
    // Раньше три события из четырёх молчали по умолчанию, а перерасход подавал
    // «тройной сигнал» — набор бипов, случайно выбранный из общего списка.
    { key: 'soundStartPreset', el: 'soundStartPreset', kind: 'value', def: 'start-boost' },
    { key: 'soundEndPreset', el: 'soundEndPreset', kind: 'value', def: 'finish-chime' },
    { key: 'soundMinutePreset', el: 'soundMinutePreset', kind: 'value', def: 'minute-mark' },
    { key: 'soundOverrunPreset', el: 'soundOverrunPreset', kind: 'value', def: 'overrun-alert' },
    {
        key: 'overrunIntervalMinutes', el: 'overrunIntervalMinutes', kind: 'value',
        // Своего значения по умолчанию нет: пустое хранилище оставляет выбранным
        // первый пункт списка из разметки.
        keepIfUnset: true, numeric: true, saveMin: 1
    },

    // --- фон полноэкранного режима (сам режим — руками, это кнопки) ---
    { key: 'bgSolid', el: 'bgSolidColor', kind: 'value', def: '#0f0c29', owner: 'display' },
    { key: 'bgGrad1', el: 'bgGrad1', kind: 'value', def: '#0f0c29', owner: 'display' },
    { key: 'bgGrad2', el: 'bgGrad2', kind: 'value', def: '#302b63', owner: 'display' },

    // --- блоки на полноэкранном ---
    // У КАЖДОГО блока свой тумблер. Общий `showTimeBlocks` и пресет
    // `timeLayoutPreset` удалены 17.08.2026: общий тумблер поверх личных давал
    // два уровня состояния (см. RendererShared.migrateDisplayBlocks — там же
    // перевод старых профилей), а расположение задаётся перетаскиванием, и
    // список из четырёх пресетов только спорил с ним.
    //
    // Умолчание «выключено» у всех: прежде блоки были выключены общим
    // тумблером (`showTimeBlocks: def false`), и включённое «Текущее время»
    // (`def: true`) на пустом профиле всё равно ничего не показывало.
    { key: 'showCurrentTime', el: 'showCurrentTime', kind: 'checkbox', def: false, owner: 'display' },
    { key: 'showEventTime', el: 'showEventTime', kind: 'checkbox', def: false, owner: 'display' },
    { key: 'showEndTime', el: 'showEndTime', kind: 'checkbox', def: false, owner: 'display' },
    { key: 'showEventTitle', el: 'showEventTitle', kind: 'checkbox', def: false, owner: 'display' },
    { key: 'showTimeLeft', el: 'showTimeLeft', kind: 'checkbox', def: false, owner: 'display' },
    { key: 'eventTime', el: 'eventTimeInput', kind: 'value', def: '10:00', owner: 'display' },
    { key: 'endTime', el: 'endTimeInput', kind: 'value', def: '12:00', owner: 'display' },
    { key: 'eventTitle', el: 'eventTitleInput', kind: 'value', def: '', owner: 'display' },
    {
        key: 'timeBlocksScale', el: 'timeBlocksScale', kind: 'value', def: 100,
        label: 'timeBlocksScaleValue', numeric: true, owner: 'display'
    },

    // --- стиль и масштаб: у виджета и дисплея свои ключи ---
    // `timerStyle` / `timerScale` — общие ключи прежних версий. Их продолжают
    // читать как запасные и продолжают писать (alsoWrite), иначе откат на
    // предыдущую версию потеряет настройку.
    {
        key: 'widgetTimerStyle', el: 'timerStyle', kind: 'value', def: 'circle',
        legacy: ['timerStyle'], alsoWrite: ['timerStyle'], owner: 'widget'
    },
    {
        key: 'widgetTimerScale', el: 'timerScale', kind: 'value', def: 100,
        legacy: ['timerScale'], label: 'timerScaleValue', numeric: true,
        alsoWrite: ['timerScale'], owner: 'widget'
    },
    // Подпись состояния выключена по умолчанию: её работу делает цвет дуги, а
    // на маленьком виджете слово занимает место, которого нет.
    { key: 'widgetStatusLabel', el: 'widgetStatusLabel', kind: 'checkbox', def: false, owner: 'widget' },
    // Уровень окна был прибит в главном процессе; теперь им управляет
    // пользователь. По умолчанию включено — это прежнее поведение.
    { key: 'widgetAlwaysOnTop', el: 'widgetAlwaysOnTop', kind: 'checkbox', def: true, owner: 'widget' },
    {
        key: 'displayTimerStyle', el: 'displayTimerStyle', kind: 'value', def: 'circle',
        legacy: ['timerStyle'], fallbackEl: 'timerStyle', owner: 'display'
    },
    {
        key: 'displayTimerScale', el: 'displayTimerScale', kind: 'value', def: 100,
        legacy: ['timerScale'], label: 'displayTimerScaleValue', numeric: true,
        fallbackEl: 'timerScale', owner: 'display'
    },

    // --- часы ---
    { key: 'syncClockStyle', el: 'syncClockStyle', kind: 'checkbox', def: false, owner: 'clock' },
    { key: 'clockStyle', el: 'clockStyle', kind: 'value', def: 'circle', legacy: ['timerStyle'], owner: 'clock' },

    // Шрифт стиля «Цифры». Три РАЗНЫХ имени с самого начала: общее имя
    // `timerStyle` в этом проекте уже означало разные окна в разных наборах
    // и стоило отдельного бага, где дисплей рисовал стиль виджета.
    { key: 'widgetDigitsFont', el: 'widgetDigitsFont', kind: 'value', def: 'inter', owner: 'widget' },
    { key: 'displayDigitsFont', el: 'displayDigitsFont', kind: 'value', def: 'inter', owner: 'display' },
    // Подпись над таймером («Осталось» / «Сверх времени») и плашка состояния
    // («Перерасход времени») — два отдельных тумблера. Скрывают ВСЕГДА, а не
    // только в перерасходе: элемент, который то есть, то нет, читается как сбой,
    // а не как настройка. По умолчанию включены — это прежний вид дисплея.
    { key: 'showHeroLabel', el: 'showHeroLabel', kind: 'checkbox', def: true, owner: 'display' },
    { key: 'showStatusPill', el: 'showStatusPill', kind: 'checkbox', def: true, owner: 'display' },
    { key: 'clockDigitsFont', el: 'clockDigitsFont', kind: 'value', def: 'inter', owner: 'clock' }
];

// Ключи, которые панель пишет в `displayExtSettings` МИМО таблицы. Держим списком,
// чтобы тест мог убедиться, что ни один ключ не потерялся при переносе.
const MANUAL_KEYS = ['overrunLimitSeconds', 'bgMode'];

// ---------------------------------------------------------------------------
// Чтение значения из хранилища
// ---------------------------------------------------------------------------
/**
 * Значение настройки с учётом устаревших ключей и значения по умолчанию.
 *
 * Семантика намеренно повторяет прежнюю лесенку до мелочей:
 *   - галочка «по умолчанию включено» = «включено, пока не записано ровно false»
 *     (`ext.foo !== false`), поэтому мусор в хранилище её не гасит;
 *   - у остальных пустая строка и 0 считаются «не задано» (`ext.bar || 100`) —
 *     так было, и менять это здесь значило бы менять поведение под видом переноса.
 */
function settingValue(ext, descriptor) {
    const store = ext && typeof ext === 'object' ? ext : {};
    const keys = [descriptor.key, ...(descriptor.legacy || [])];

    if (descriptor.kind === 'checkbox') {
        const raw = store[descriptor.key];
        if (descriptor.def === true) { return raw !== false; }
        return !!raw;
    }

    for (const key of keys) {
        if (store[key]) { return store[key]; }
    }
    return descriptor.def;
}

// Настройка не задана ни своим ключом, ни устаревшими — то есть контрол трогать
// нечем и (при keepIfUnset) не нужно.
function isUnset(ext, descriptor) {
    const store = ext && typeof ext === 'object' ? ext : {};
    return [descriptor.key, ...(descriptor.legacy || [])].every((key) => !store[key]);
}

// ---------------------------------------------------------------------------
// Раскладка по контролам и сборка обратно
// ---------------------------------------------------------------------------
function elementById(doc, id) {
    return doc && typeof doc.getElementById === 'function' ? doc.getElementById(id) : null;
}

/**
 * Раскладывает сохранённые настройки по контролам панели.
 *
 * Отсутствующий в DOM контрол пропускается молча — ровно как прежние проверки
 * `if (this.displayTimerScaleEl)`. Возвращает разложенные значения: панели они
 * нужны, чтобы не читать те же контролы заново, а тестам — чтобы проверять
 * результат, не разглядывая поддельный DOM.
 */
function applyStoredSettings(ext, doc) {
    const target = doc || (typeof document !== 'undefined' ? document : null);
    const applied = {};

    for (const descriptor of SETTINGS_DESCRIPTORS) {
        const el = elementById(target, descriptor.el);
        if (!el) { continue; }
        if (descriptor.keepIfUnset && isUnset(ext, descriptor)) {
            applied[descriptor.key] = descriptor.kind === 'checkbox' ? !!el.checked : el.value;
            continue;
        }

        const value = settingValue(ext, descriptor);
        if (descriptor.kind === 'checkbox') {
            el.checked = !!value;
        } else {
            el.value = value;
        }
        applied[descriptor.key] = value;

        if (descriptor.label) {
            const labelEl = elementById(target, descriptor.label);
            if (labelEl) { labelEl.textContent = value + '%'; }
        }
    }

    return applied;
}

/**
 * Собирает объект настроек из контролов — то, что уходит в `displayExtSettings`.
 *
 * Ключи из `alsoWrite` пишутся тем же значением: их читают старые версии.
 */
function collectSettings(doc) {
    const target = doc || (typeof document !== 'undefined' ? document : null);
    const out = {};

    for (const descriptor of SETTINGS_DESCRIPTORS) {
        const el = elementById(target, descriptor.el)
            || (descriptor.fallbackEl ? elementById(target, descriptor.fallbackEl) : null);
        if (!el) { continue; }

        let value;
        if (descriptor.kind === 'checkbox') {
            value = !!el.checked;
        } else if (descriptor.numeric) {
            const parsed = parseInt(el.value, 10);
            value = descriptor.saveMin !== undefined ? (parsed || descriptor.saveMin) : parsed;
        } else {
            value = el.value;
        }

        out[descriptor.key] = value;
        for (const alias of descriptor.alsoWrite || []) { out[alias] = value; }
    }

    return out;
}

// ---------------------------------------------------------------------------
// Сброс настроек ОДНОГО окна
// ---------------------------------------------------------------------------
/**
 * Возвращает контролы указанного окна к значениям по умолчанию.
 *
 * Владелец строки (`owner`) — то же знание в той же таблице: третьего списка
 * «что относится к виджету» не заводим. Ровно из-за таких вторых списков в этом
 * файле и появилась таблица.
 *
 * Функция трогает ТОЛЬКО контролы: сохранение, отправку в окно и цвета делает
 * панель. Здесь нет ни localStorage, ни IPC — поэтому её поведение проверяется
 * на поддельном документе.
 *
 * @param {'widget'|'clock'|'display'} owner
 * @param {Document} [doc]
 * @returns {Object} применённые значения (ключ → значение по умолчанию)
 */
/**
 * Общая механика сброса: «как вернуть контрол к умолчанию» знает ОДНО место.
 * Кого именно сбрасывать, решает предикат — по владельцу или по списку ключей.
 */
function resetMatching(match, doc) {
    const target = doc || (typeof document !== 'undefined' ? document : null);
    const applied = {};

    for (const descriptor of SETTINGS_DESCRIPTORS) {
        if (!match(descriptor)) { continue; }
        const el = elementById(target, descriptor.el);
        if (!el) { continue; }

        if (descriptor.kind === 'checkbox') { el.checked = !!descriptor.def; }
        else { el.value = descriptor.def; }

        const label = descriptor.label ? elementById(target, descriptor.label) : null;
        if (label) { label.textContent = descriptor.def + '%'; }

        applied[descriptor.key] = descriptor.def;
    }

    return applied;
}

function resetOwnedSettings(owner, doc) {
    return resetMatching((descriptor) => descriptor.owner === owner, doc);
}

/**
 * Сбросить НАЗВАННЫЕ ключи — для кнопок уже́ настройки, а не всей вкладки.
 *
 * «Сбросить фон по умолчанию» перечисляла значения литералами прямо в
 * обработчике: третья копия того, что описано таблицей. Умолчание правят в
 * таблице — кнопка продолжала бы возвращать старое, и молча.
 */
function resetKeys(keys, doc) {
    const wanted = new Set(keys || []);
    return resetMatching((descriptor) => wanted.has(descriptor.key), doc);
}

const SettingsSchema = {
    SETTINGS_DESCRIPTORS,
    DISPLAY_BLOCK_KEYS,
    DISPLAY_LABEL_KEYS,
    MANUAL_KEYS,
    settingValue,
    applyStoredSettings,
    collectSettings,
    resetOwnedSettings,
    resetKeys
};

// Node.js (тесты)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettingsSchema;
}

// Браузер (окно управления)
if (typeof window !== 'undefined') {
    window.SettingsSchema = SettingsSchema;
}
