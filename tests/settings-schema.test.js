'use strict';

/**
 * Таблица настроек панели: значения по умолчанию, устаревшие ключи, сборка.
 *
 * Эта логика жила в `electron-control.html` внутри inline-скрипта и поэтому не
 * проверялась ничем, кроме e2e: 28 присваиваний с дефолтами в `loadSettings()` и
 * зеркальный им объектный литерал в `saveExtSettings()`. Ошибка в любом из них
 * тихо возвращает настройку к значению по умолчанию после перезапуска.
 *
 * Модуль ничего не знает о DOM сверх `getElementById`, поэтому здесь ему
 * подсовывается поддельный документ: проверяется РЕЗУЛЬТАТ раскладки, а не то,
 * что функция кого-то вызвала.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Schema = require('../settings-schema.js');
const { SETTINGS_DESCRIPTORS, MANUAL_KEYS, settingValue, applyStoredSettings, collectSettings } = Schema;

// --- поддельный DOM -------------------------------------------------------
// Ровно то, чем пользуется модуль: getElementById, .value, .checked, .textContent.
function fakeDoc(extra = {}) {
    const els = new Map();
    for (const descriptor of SETTINGS_DESCRIPTORS) {
        // Контрол в разметке НИКОГДА не пуст: у списка выбран пункт, у поля стоит
        // значение, у ползунка — число. Поддельный DOM обязан это повторять,
        // иначе тест проверял бы состояние, которого в панели не бывает.
        els.set(descriptor.el, {
            value: descriptor.def === undefined ? '' : String(descriptor.def),
            checked: descriptor.def === true
        });
        if (descriptor.label) { els.set(descriptor.label, { textContent: '' }); }
    }
    for (const [id, el] of Object.entries(extra)) { els.set(id, el); }
    return {
        getElementById: (id) => els.get(id) || null,
        _get: (id) => els.get(id),
        _drop: (id) => els.delete(id)
    };
}

const byKey = (key) => SETTINGS_DESCRIPTORS.find((d) => d.key === key);

test('таблица описана полностью и без повторов', () => {
    const seenKeys = new Set();
    const seenEls = new Set();
    for (const d of SETTINGS_DESCRIPTORS) {
        assert.ok(d.key, 'у строки таблицы нет ключа');
        assert.ok(d.el, `${d.key}: не указан контрол`);
        assert.ok(['checkbox', 'value'].includes(d.kind), `${d.key}: неизвестный вид ${d.kind}`);
        assert.ok(!seenKeys.has(d.key), `ключ ${d.key} описан дважды`);
        assert.ok(!seenEls.has(d.el), `контрол ${d.el} описан дважды`);
        seenKeys.add(d.key);
        seenEls.add(d.el);
        if (d.kind === 'checkbox') {
            assert.equal(typeof d.def, 'boolean', `${d.key}: у галочки значение по умолчанию должно быть булевым`);
        } else if (!d.keepIfUnset) {
            assert.notEqual(d.def, undefined, `${d.key}: не задано значение по умолчанию`);
        }
    }
});

test('пустое хранилище даёт документированные значения по умолчанию', () => {
    const doc = fakeDoc();
    const applied = applyStoredSettings({}, doc);

    // Галочки, включённые по умолчанию.
    assert.equal(applied.soundMasterEnabled, true);
    assert.equal(applied.soundEndEnabled, true);
    // Подписи дисплея включены — это его прежний вид.
    assert.equal(applied.showHeroLabel, true);
    assert.equal(applied.showStatusPill, true);
    // Галочки, выключенные по умолчанию.
    assert.equal(applied.allowNegative, false);
    assert.equal(applied.soundStartEnabled, false);
    // Блоки дисплея — каждый со своим тумблером, и все выключены (17.08.2026:
    // прежде их гасил общий `showTimeBlocks`, и включённое «Текущее время» на
    // пустом профиле всё равно ничего не показывало).
    assert.equal(applied.showCurrentTime, false);
    assert.equal(applied.showEventTime, false);
    assert.equal(applied.showEndTime, false);
    assert.equal(applied.showTimeLeft, false);
    assert.equal(applied.showEventTitle, false);
    assert.equal(applied.syncClockStyle, false, 'синхронизация стиля часов по умолчанию ВЫКЛЮЧЕНА');
    // Значения. Звуки событий 20.08.2026: у каждого события умолчанием стоит
    // звук, НАПИСАННЫЙ под него. До этого три события из четырёх молчали, а
    // перерасход подавал «тройной сигнал» — набор бипов из общего списка.
    assert.equal(applied.soundOverrunPreset, 'overrun-alert');
    assert.equal(applied.soundStartPreset, 'start-boost');
    assert.equal(applied.soundEndPreset, 'finish-chime');
    assert.equal(applied.soundMinutePreset, 'minute-mark');
    // И это не выдуманные имена: каждое обязано быть в банке.
    const { BUILT_IN_PRESETS } = require(path.join(__dirname, '..', 'sound-bank.js'));
    for (const key of ['soundStartPreset', 'soundEndPreset', 'soundMinutePreset', 'soundOverrunPreset']) {
        assert.ok(BUILT_IN_PRESETS.includes(applied[key]),
            `умолчание ${key} = ${applied[key]} не реализовано в банке звуков`);
    }
    assert.equal(applied.bgGrad2, '#302b63');
    assert.equal(applied.eventTime, '10:00');
    assert.equal(applied.endTime, '12:00');
    assert.equal(applied.widgetTimerStyle, 'circle');
    assert.equal(applied.widgetTimerScale, 100);

    // Значения действительно доехали до контролов, а не только до отчёта.
    assert.equal(doc._get('soundMasterEnabled').checked, true);
    assert.equal(doc._get('allowNegative').checked, false);
    assert.equal(doc._get('eventTimeInput').value, '10:00');
});

test('галочка «по умолчанию включено» гаснет только от ровного false', () => {
    // Прежняя запись `ext.soundEndEnabled !== false` — её и повторяем: любое
    // другое значение в хранилище оставляет галочку включённой.
    const d = byKey('soundEndEnabled');
    assert.equal(settingValue({ soundEndEnabled: false }, d), false);
    assert.equal(settingValue({ soundEndEnabled: true }, d), true);
    assert.equal(settingValue({}, d), true);
    assert.equal(settingValue({ soundEndEnabled: undefined }, d), true);
    assert.equal(settingValue({ soundEndEnabled: 0 }, d), true, 'мусор в хранилище не должен гасить звук окончания');
});

test('галочка «по умолчанию выключено» включается любым истинным значением', () => {
    const d = byKey('allowNegative');
    assert.equal(settingValue({ allowNegative: true }, d), true);
    assert.equal(settingValue({ allowNegative: false }, d), false);
    assert.equal(settingValue({}, d), false);
});

test('устаревшие ключи читаются, когда своего ещё нет', () => {
    // Профиль, сохранённый до разделения стилей по окнам: общий timerStyle.
    const doc = fakeDoc();
    const applied = applyStoredSettings({ timerStyle: 'flip', timerScale: 150 }, doc);

    assert.equal(applied.widgetTimerStyle, 'flip');
    assert.equal(applied.displayTimerStyle, 'flip');
    assert.equal(applied.clockStyle, 'flip');
    assert.equal(applied.widgetTimerScale, 150);
    assert.equal(applied.displayTimerScale, 150);
});

test('свой ключ важнее устаревшего', () => {
    const doc = fakeDoc();
    const applied = applyStoredSettings(
        { timerStyle: 'flip', widgetTimerStyle: 'digital', displayTimerStyle: 'analog' },
        doc
    );

    assert.equal(applied.widgetTimerStyle, 'digital');
    assert.equal(applied.displayTimerStyle, 'analog');
    assert.equal(applied.clockStyle, 'flip', 'у часов своего ключа нет — берётся устаревший общий');
});

test('подписи масштабов получают проценты', () => {
    const doc = fakeDoc();
    applyStoredSettings({ widgetTimerScale: 150, timeBlocksScale: 250 }, doc);

    assert.equal(doc._get('timerScaleValue').textContent, '150%');
    assert.equal(doc._get('timeBlocksScaleValue').textContent, '250%');
});

test('интервал перерасхода не трогается, когда в хранилище пусто', () => {
    // Прежнее `if (ext.overrunIntervalMinutes) { ... }`: значение по умолчанию
    // задаёт разметка (первый пункт списка), а не таблица.
    const doc = fakeDoc();
    doc._get('overrunIntervalMinutes').value = '1';

    applyStoredSettings({}, doc);
    assert.equal(doc._get('overrunIntervalMinutes').value, '1', 'пустое хранилище не должно сбрасывать список');

    applyStoredSettings({ overrunIntervalMinutes: 5 }, doc);
    assert.equal(doc._get('overrunIntervalMinutes').value, 5);
});

test('отсутствующий контрол пропускается молча', () => {
    // Раньше это были проверки `if (this.displayTimerScaleEl)`.
    const doc = fakeDoc();
    doc._drop('displayTimerScale');
    doc._drop('displayTimerStyle');

    const applied = applyStoredSettings({ displayTimerScale: 180 }, doc);
    assert.equal(applied.displayTimerScale, undefined);
    // Остальное разложено как ни в чём не бывало.
    assert.equal(applied.widgetTimerStyle, 'circle');
});

test('сборка пишет и устаревшие ключи тоже', () => {
    const doc = fakeDoc();
    doc._get('timerStyle').value = 'flip';
    doc._get('timerScale').value = '150';

    const out = collectSettings(doc);
    assert.equal(out.widgetTimerStyle, 'flip');
    assert.equal(out.widgetTimerScale, 150);
    assert.equal(out.timerStyle, 'flip', 'старый ключ должен продолжать писаться');
    assert.equal(out.timerScale, 150, 'старый ключ должен продолжать писаться');
});

test('при сборке масштабы становятся числами, а не строками', () => {
    const doc = fakeDoc();
    doc._get('timerScale').value = '150';
    doc._get('timeBlocksScale').value = '250';
    doc._get('overrunIntervalMinutes').value = '5';

    const out = collectSettings(doc);
    assert.strictEqual(out.widgetTimerScale, 150);
    assert.strictEqual(out.timeBlocksScale, 250);
    assert.strictEqual(out.overrunIntervalMinutes, 5);
});

test('нечитаемый интервал перерасхода превращается в 1, а не в NaN', () => {
    // Прежнее `parseInt(...) || 1`: NaN в JSON стал бы null и обнулил интервал.
    const doc = fakeDoc();
    doc._get('overrunIntervalMinutes').value = '';
    assert.strictEqual(collectSettings(doc).overrunIntervalMinutes, 1);
});

test('без своего контрола масштаб и стиль дисплея берутся у виджета', () => {
    // Прежнее `displayTimerStyle: this.displayTimerStyleEl ? ... : this.timerStyleEl.value`.
    const doc = fakeDoc();
    doc._drop('displayTimerStyle');
    doc._drop('displayTimerScale');
    doc._get('timerStyle').value = 'digital';
    doc._get('timerScale').value = '120';

    const out = collectSettings(doc);
    assert.equal(out.displayTimerStyle, 'digital');
    assert.equal(out.displayTimerScale, 120);
});

test('круговой рейс: собранное раскладывается в то же самое', () => {
    // Главное свойство пары: сохранить → загрузить не меняет ни одного значения.
    const doc = fakeDoc();
    doc._get('timerStyle').value = 'flip';
    doc._get('timerScale').value = '150';
    doc._get('clockStyle').value = 'digital';
    doc._get('displayTimerStyle').value = 'analog';
    doc._get('displayTimerScale').value = '180';
    doc._get('eventTimeInput').value = '09:15';
    doc._get('endTimeInput').value = '18:45';
    doc._get('bgSolidColor').value = '#123456';
    doc._get('timeBlocksScale').value = '250';
    doc._get('eventTitleInput').value = 'Оперативное совещание';
    doc._get('soundEndPreset').value = 'gong';
    doc._get('overrunIntervalMinutes').value = '5';
    doc._get('allowNegative').checked = true;
    doc._get('soundEndEnabled').checked = false;
    doc._get('soundMasterEnabled').checked = false;
    doc._get('syncClockStyle').checked = true;
    doc._get('showCurrentTime').checked = false;
    doc._get('showEventTime').checked = true;
    doc._get('showEndTime').checked = true;
    doc._get('showTimeLeft').checked = true;
    doc._get('showEventTitle').checked = true;
    doc._get('showHeroLabel').checked = false;
    doc._get('showStatusPill').checked = false;

    const saved = collectSettings(doc);
    const fresh = fakeDoc();
    const applied = applyStoredSettings(saved, fresh);

    for (const d of SETTINGS_DESCRIPTORS) {
        assert.equal(
            String(applied[d.key]), String(saved[d.key]),
            `${d.key} изменился на круговом рейсе: сохранили ${saved[d.key]}, загрузили ${applied[d.key]}`
        );
    }
    // И до контролов доехало то же самое.
    assert.equal(fresh._get('soundMasterEnabled').checked, false);
    assert.equal(fresh._get('syncClockStyle').checked, true);
    assert.equal(fresh._get('clockStyle').value, 'digital');
});

// --- связь с панелью ------------------------------------------------------

const repoRoot = path.join(__dirname, '..');
const controlHtml = fs.readFileSync(path.join(repoRoot, 'electron-control.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('модуль подключён в панели и попадает в сборку', () => {
    // Без первого — панель падает при загрузке; без второго модуль исчезает из
    // packaged-релиза (ровно так терялся design-tokens.css, см. CHANGELOG 2.3.2).
    assert.match(controlHtml, /<script src="settings-schema\.js"><\/script>/);
    assert.ok(pkg.build.files.includes('settings-schema.js'), 'settings-schema.js нет в build.files');
});

// Контролы, которых в разметке НЕТ намеренно: их ряды строит модуль по
// реестру (panel-display.js по display-layouts.js), как ряд «Фон» в
// panel-colors.js. Написать их в HTML — значит завести вторую копию слова
// «Начало» рядом с реестром и разметкой дисплея; вместо этого проверяется
// точка монтирования, а совпадение id с ключом настройки держит
// tests/block-labels.test.js.
const DL = require('../display-layouts');
const BUILT_BY_MODULE = new Map([
    ...DL.LABELLED_ELEMENTS.map((el) => [el.labelKey, 'blockLabelRows']),
    // Скрытый режим «47-й этаж»: секцию строит panel-display.js, в вёрстке
    // только точка монтирования. Полсотни строк статики внутри god-файла
    // подняли бы его потолок, а потолок только опускают.
    ...DL.SECRET_ELEMENTS.map((el) => [el.toggle, 'floor47Mount']),
    ['overrunPrice', 'floor47Mount'],
    ['overrunPeriod', 'floor47Mount'],
    ['floor47Unlocked', 'floor47Mount']
]);

test('каждый контрол из таблицы существует в разметке панели', () => {
    // Опечатка в id — молчаливая: контрол не найдётся, настройка не разложится,
    // и пользователь увидит значение по умолчанию вместо своего.
    for (const d of SETTINGS_DESCRIPTORS) {
        const mount = BUILT_BY_MODULE.get(d.el);
        if (mount) {
            assert.match(
                controlHtml, new RegExp(`id="${mount}"`),
                `${d.key}: в разметке панели нет точки монтирования #${mount}`
            );
            continue;
        }
        assert.match(
            controlHtml, new RegExp(`id="${d.el}"`),
            `${d.key}: в разметке панели нет контрола #${d.el}`
        );
        if (d.label) {
            assert.match(controlHtml, new RegExp(`id="${d.label}"`), `нет подписи #${d.label}`);
        }
    }
});

test('панель не сохранила у себя вторую копию лесенки значений по умолчанию', () => {
    // Смысл всей затеи: знание о ключе и его значении по умолчанию живёт в ОДНОМ
    // месте. Если для описанного таблицей ключа в панели снова появится
    // `ext.foo !== false` или `ext.foo || 100` — копии разойдутся, и настройка
    // молча вернётся к дефолту после перезапуска.
    //
    // Комментарии срезаны: они сами упоминают старые выражения, объясняя, почему
    // их больше нет.
    const inline = controlHtml
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    const tableKeys = new Set(SETTINGS_DESCRIPTORS.flatMap((d) => [d.key, ...(d.legacy || [])]));
    const ladder = (inline.match(/\bext\.([A-Za-z]+)\s*(?:!==\s*false|\|\|)/g) || [])
        .filter((hit) => tableKeys.has(hit.match(/ext\.([A-Za-z]+)/)[1]));

    assert.deepEqual(ladder, [], `в панели снова заведена лесенка дефолтов: ${ladder.join(', ')}`);

    // Ручные ключи — исключение, и оно ровно одно: bgMode читается лесенкой,
    // потому что за ним стоят кнопки, а не поле ввода. Умолчание с 18.08.2026 —
    // 'theme': фон дисплея по умолчанию следует теме окна.
    assert.match(inline, /ext\.bgMode \|\| 'theme'/);
});

test('шрифт цифр: три ключа, у каждого свой контрол и умолчание inter', () => {
    const rows = SETTINGS_DESCRIPTORS.filter((d) => d.key.endsWith('DigitsFont'));
    assert.deepEqual(
        rows.map((r) => r.key).sort(),
        ['clockDigitsFont', 'displayDigitsFont', 'widgetDigitsFont']
    );
    for (const row of rows) {
        assert.equal(row.kind, 'value');
        assert.equal(row.def, 'inter');
        assert.equal(row.el, row.key, 'id контрола совпадает с именем ключа');
        assert.ok(!row.legacy, 'общего устаревшего имени у новых ключей нет');
    }
});

test('шрифт цифр: круговой рейс через поддельный документ', () => {
    const doc = fakeDoc();
    applyStoredSettings({ widgetDigitsFont: 'bebas', displayDigitsFont: 'orbitron' }, doc);
    assert.equal(doc._get('widgetDigitsFont').value, 'bebas');
    assert.equal(doc._get('displayDigitsFont').value, 'orbitron');
    assert.equal(doc._get('clockDigitsFont').value, 'inter', 'незаданный — умолчание');

    const out = collectSettings(doc);
    assert.equal(out.widgetDigitsFont, 'bebas');
    assert.equal(out.displayDigitsFont, 'orbitron');
    assert.equal(out.clockDigitsFont, 'inter');
});

test('ключи, оставленные панели, названы явно', () => {
    // Два ключа таблицей не выражаются (свой формат и кнопки вместо поля).
    // Список нужен, чтобы «не описан» нельзя было спутать с «забыт».
    assert.deepEqual(MANUAL_KEYS, ['overrunLimitSeconds', 'bgMode']);
    for (const key of MANUAL_KEYS) {
        assert.equal(byKey(key), undefined, `${key} описан и в таблице, и в списке ручных`);
        assert.match(controlHtml, new RegExp(key), `${key} нигде не сохраняется`);
    }
});

/* ─────────────────────── сброс настроек одного окна ──────────────────────── */

test('resetOwnedSettings: трогает контролы ТОЛЬКО своего окна', () => {
    // Знание «чьё это окно» живёт в той же таблице (поле owner). Второй список
    // ровно этого знания — то, из-за чего настройки уже однажды молча
    // возвращались к умолчанию после перезапуска.
    const doc = fakeDoc();
    doc._get('timerStyle').value = 'flip';
    doc._get('timerScale').value = '160';
    doc._get('widgetStatusLabel').checked = true;
    doc._get('clockStyle').value = 'flip';
    doc._get('displayTimerStyle').value = 'flip';

    const applied = Schema.resetOwnedSettings('widget', doc);

    assert.equal(doc._get('timerStyle').value, 'circle');
    assert.equal(doc._get('timerScale').value, 100);
    assert.equal(doc._get('widgetStatusLabel').checked, false);
    assert.equal(applied.widgetTimerStyle, 'circle');

    assert.equal(doc._get('clockStyle').value, 'flip', 'часы трогать нельзя');
    assert.equal(doc._get('displayTimerStyle').value, 'flip', 'дисплей трогать нельзя');
});

test('resetOwnedSettings: подпись процентов обновляется вместе со значением', () => {
    const doc = fakeDoc();
    doc._get('timerScale').value = '160';
    doc._get('timerScaleValue').textContent = '160%';
    Schema.resetOwnedSettings('widget', doc);
    assert.equal(doc._get('timerScaleValue').textContent, '100%');
});

test('resetOwnedSettings: отсутствующий контрол не роняет сброс', () => {
    const doc = fakeDoc();
    doc._drop('displayTimerStyle');
    assert.doesNotThrow(() => Schema.resetOwnedSettings('display', doc));
});

test('у каждого ряда есть известный владелец, и у каждого окна он есть', () => {
    const known = new Set(['widget', 'clock', 'display', undefined]);
    for (const row of SETTINGS_DESCRIPTORS) {
        assert.ok(known.has(row.owner), `неизвестный владелец у ${row.key}: ${row.owner}`);
    }
    // Пустой владелец означал бы кнопку сброса, которая ничего не делает.
    for (const owner of ['widget', 'clock', 'display']) {
        const count = SETTINGS_DESCRIPTORS.filter((r) => r.owner === owner).length;
        assert.ok(count > 0, `у окна ${owner} нет ни одной своей настройки`);
    }
});

test('resetKeys возвращает к умолчанию ТОЛЬКО названные ключи', () => {
    // 20.08.2026: «Сбросить фон по умолчанию» перечисляла значения фона
    // литералами прямо в обработчике — третья копия того, что уже описано
    // таблицей (`bgSolid`, `bgGrad1`, `bgGrad2`). Копия и разошлась бы первой:
    // умолчание правят в таблице, а кнопка продолжает возвращать старое.
    const doc = fakeDoc();
    doc._get('bgSolidColor').value = '#8b0000';
    doc._get('bgGrad1').value = '#111111';
    doc._get('displayTimerScale').value = '250';

    const applied = Schema.resetKeys(['bgSolid', 'bgGrad1', 'bgGrad2'], doc);

    assert.deepEqual(Object.keys(applied).sort(), ['bgGrad1', 'bgGrad2', 'bgSolid']);
    assert.equal(doc._get('bgSolidColor').value, '#0f0c29');
    assert.equal(doc._get('bgGrad1').value, '#0f0c29');
    assert.equal(doc._get('bgGrad2').value, '#302b63');
    // Чужая настройка не тронута: сброс фона — это сброс фона.
    assert.equal(doc._get('displayTimerScale').value, '250', 'resetKeys задел ключ, которого его не просили');
});

test('resetKeys и resetOwnedSettings — одна механика сброса контрола', () => {
    // Две функции, но знание «как вернуть контрол к умолчанию» одно: чекбокс
    // ставится в checked, остальные — в value, у ползунка обновляется подпись.
    const source = fs.readFileSync(path.join(__dirname, '..', 'settings-schema.js'), 'utf8');
    const resets = source.match(/el\.checked = !!descriptor\.def/g) || [];
    assert.equal(resets.length, 1, 'механика сброса контрола скопирована ещё раз');
});
