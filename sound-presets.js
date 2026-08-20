'use strict';

/**
 * sound-presets.js — РЕЕСТР звуков для выпадающих списков панели: имя, подпись
 * и события, которым звук предлагается.
 *
 * Зачем модуль. Списки в четырёх `<select>` вели РУКАМИ прямо в разметке: 79
 * строк `<option>`, четыре куратора одного и того же набора. Добавление одного
 * звука 20.08.2026 означало четыре одинаковых правки в четырёх местах — ровно
 * тот класс дубля, из-за которого в этом проекте настройки уже разъезжались.
 * Здесь набор ОДИН, а кому что показывать, решает поле `events`.
 *
 * Синтез живёт в sound-bank.js и остаётся единственным владельцем звучания;
 * реестр знает только имена и подписи. Что имена совпадают, проверяется В ОБА
 * КОНЦА (tests/sound-bank.test.js): реестр не предлагает того, чего банк не
 * умеет, а банк не прячет звук, до которого нет дороги из интерфейса.
 *
 * DOM модуль строит сам (как theme-grid.js и panel-colors.js): у панели
 * храповик на размер, и статическая разметка списков в него не помещается.
 */

/**
 * Подписи КОРОТКИЕ намеренно: ящик настроек 336px, и на список остаётся 128px.
 * Замер 20.08.2026: «Металлический удар» — 126px, то есть впритык, а при
 * длинном имени события пункт обрезался многоточием. Подпись, которую не
 * прочитать целиком, не помогает выбрать.
 */

/** Событие → id элемента `<select>` и суффикс группы пользовательских звуков. */
const SOUND_EVENTS = [
    { event: 'start', select: 'soundStartPreset', group: 'customSoundsGroupStart' },
    { event: 'end', select: 'soundEndPreset', group: 'customSoundsGroupEnd' },
    { event: 'minute', select: 'soundMinutePreset', group: 'customSoundsGroupMinute' },
    { event: 'overrun', select: 'soundOverrunPreset', group: 'customSoundsGroupOverrun' }
];

/**
 * Набор звуков. `signature` — звук, НАПИСАННЫЙ под это событие: он стоит
 * первым, отдельной группой, и он же умолчание в settings-schema.js.
 *
 * `events` — курирование, а не ограничение: список каждого события собран под
 * его задачу (метке минуты незачем предлагать корабельный гудок), но все четыре
 * фирменных звука доступны везде — событие своё, а вкус чужой.
 */
const SOUND_PRESETS = [
    { id: 'start-boost', label: 'Разгон', events: ['start', 'end', 'minute', 'overrun'], signature: 'start' },
    { id: 'finish-chime', label: 'Финал', events: ['start', 'end', 'minute', 'overrun'], signature: 'end' },
    { id: 'minute-mark', label: 'Метка минуты', events: ['start', 'end', 'minute', 'overrun'], signature: 'minute' },
    { id: 'overrun-alert', label: 'Тревога', events: ['start', 'end', 'minute', 'overrun'], signature: 'overrun' },

    { id: 'beep-short', label: 'Бип короткий', events: ['start', 'end', 'minute', 'overrun'] },
    { id: 'beep-long', label: 'Бип длинный', events: ['start', 'end', 'minute', 'overrun'] },
    { id: 'triple', label: 'Тройной', events: ['start', 'end', 'minute'] },
    { id: 'bell', label: 'Колокольчик', events: ['start', 'end', 'minute', 'overrun'] },
    { id: 'ding', label: 'Динь', events: ['start', 'end', 'minute', 'overrun'] },
    { id: 'whoosh', label: 'Свист', events: ['start'] },
    { id: 'click', label: 'Клик', events: ['start'] },
    { id: 'alarm', label: 'Будильник', events: ['end', 'overrun'] },
    { id: 'fanfare', label: 'Фанфары', events: ['end'] },
    { id: 'gong', label: 'Гонг', events: ['end'] },
    { id: 'tick', label: 'Тик', events: ['minute'] },
    { id: 'soft-alert', label: 'Мягкий', events: ['minute', 'overrun'] },
    { id: 'chime', label: 'Перезвон', events: ['start', 'end'] },
    { id: 'pulse', label: 'Пульс', events: ['start', 'minute', 'overrun'] },
    { id: 'rising', label: 'Нарастающий', events: ['start', 'overrun'] },
    { id: 'drop', label: 'Падающий', events: ['end'] },
    { id: 'notification', label: 'Нотификация', events: ['start', 'end', 'minute'] },
    { id: 'countdown-tick', label: 'Отсчёт', events: ['minute', 'overrun'] },
    { id: 'complete', label: 'Завершение', events: ['end'] },
    { id: 'cymbal', label: 'Тарелки', events: ['end', 'overrun'] },
    { id: 'deep-gong', label: 'Гонг низкий', events: ['end', 'overrun'] },
    { id: 'air-horn', label: 'Рожок', events: ['start', 'end', 'overrun'] },
    { id: 'siren', label: 'Сирена', events: ['end', 'overrun'] },
    { id: 'church-bell', label: 'Колокол', events: ['end', 'minute'] },
    { id: 'drum-roll', label: 'Барабаны', events: ['start', 'end'] },
    { id: 'ship-horn', label: 'Гудок', events: ['end', 'overrun'] },
    { id: 'metal-strike', label: 'Металл', events: ['start', 'end', 'minute', 'overrun'] },
    { id: 'epic-brass', label: 'Труба', events: ['start', 'end'] }
];

/**
 * Починка выбора, которого больше нет.
 *
 * Звук могли УБРАТЬ (20.08.2026 так ушёл «Чирп» — пила 400→1200 Гц без всякого
 * прототипа), а пользователь мог удалить свой звук из «Ваших звуков». В обоих
 * случаях в профиле остаётся имя, которому не соответствует ни один пункт, и
 * браузер молча показывает первый — «— без звука —», хотя в хранилище лежит
 * другое. То есть событие беззвучно, а настройка утверждает обратное.
 *
 * Поэтому после загрузки настроек выбор ЧИНИТСЯ: нет такого пункта — ставим
 * умолчание события и записываем его. Правило общее, а не про конкретный
 * удалённый звук: список пунктов меняется и от пользовательских звуков тоже.
 *
 * Умолчание берётся у ВЛАДЕЛЬЦА умолчаний — таблицы настроек: своё значение
 * здесь было бы второй копией и разошлось бы с ней.
 *
 * @param {Document} doc
 * @param {{SETTINGS_DESCRIPTORS: Array}} schema  модуль settings-schema.js
 * @returns {string[]} ключи, которые пришлось починить
 */
function repairSelection(doc, schema) {
    const target = doc || (typeof document !== 'undefined' ? document : null);
    if (!target) { return []; }
    const rows = (schema && schema.SETTINGS_DESCRIPTORS) || [];
    const fixed = [];
    for (const spec of SOUND_EVENTS) {
        const select = target.getElementById(spec.select);
        if (!select || !select.options) { continue; }
        const wanted = select.value;
        const has = [...select.options].some((o) => o.value === wanted);
        if (has && wanted) { continue; }
        const row = rows.find((d) => d.el === spec.select);
        select.value = row ? row.def : 'none';
        fixed.push(spec.select);
    }
    return fixed;
}

/** Что предлагается событию: сначала фирменный звук, потом остальные. */
function presetsForEvent(event) {
    const signature = SOUND_PRESETS.filter((p) => p.signature === event);
    const rest = SOUND_PRESETS.filter((p) => p.signature !== event && p.events.includes(event));
    return { signature, rest };
}

/**
 * Заполнить четыре списка. Зовётся ДО загрузки настроек: `applyStoredSettings`
 * ставит `select.value`, а значение, для которого нет `<option>`, браузер молча
 * отбрасывает — список обязан существовать раньше выбора.
 */
function buildSoundSelects(doc) {
    const target = doc || (typeof document !== 'undefined' ? document : null);
    if (!target) { return 0; }
    let filled = 0;

    for (const spec of SOUND_EVENTS) {
        const select = target.getElementById(spec.select);
        if (!select) { continue; }
        select.innerHTML = '';

        const option = (value, label) => {
            const el = target.createElement('option');
            el.value = value;
            el.textContent = label;
            return el;
        };
        const group = (label, id) => {
            const el = target.createElement('optgroup');
            el.label = label;
            if (id) { el.id = id; }
            return el;
        };

        // «Без звука» — не пресет, а отсутствие звука, поэтому вне групп.
        select.appendChild(option('none', '— без звука —'));

        const { signature, rest } = presetsForEvent(spec.event);
        if (signature.length) {
            const own = group('Для этого события');
            for (const preset of signature) { own.appendChild(option(preset.id, preset.label)); }
            select.appendChild(own);
        }
        const standard = group('Стандартные');
        for (const preset of rest) { standard.appendChild(option(preset.id, preset.label)); }
        select.appendChild(standard);

        // Пустая группа для пользовательских звуков: её наполняет
        // custom-sounds.js по своему id, и существовать она обязана всегда.
        select.appendChild(group('Ваши звуки', spec.group));
        filled++;
    }
    return filled;
}

const SoundPresets = { SOUND_PRESETS, SOUND_EVENTS, presetsForEvent, buildSoundSelects, repairSelection };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SoundPresets;
}

if (typeof window !== 'undefined') {
    window.SoundPresets = SoundPresets;
}
