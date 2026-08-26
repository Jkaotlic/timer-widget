'use strict';

/**
 * Кастомные подписи блоков времени (просьба 24.08.2026: «нужна возможность
 * сделать кастомные названия плашек в функциональных блоках времени»).
 *
 * Что здесь проверяется и почему именно это.
 *
 * 1. У подписи ОДИН владелец. Слово «Начало» до сих пор жило только в разметке
 *    display.html; теперь его же показывает поле панели (как placeholder) и
 *    подставляет дисплей, когда пользователь стёр своё. Три копии слова
 *    разъезжаются молча: в панели написано одно, в окне — другое, и заметно
 *    это лишь на проекторе. Поэтому умолчание объявлено в реестре
 *    display-layouts.js, а тест сверяет с ним РАЗМЕТКУ.
 *
 * 2. Разбор пользовательского ввода — арифметика, и ей место в Node: пустая
 *    строка и строка из пробелов означают «верни стандартную подпись», а не
 *    «покажи пустоту»; длина ограничена, потому что подпись стоит в блоке,
 *    габарит которого считают раскладки.
 *
 * 3. Ключ, контрол и умолчание настройки — ОДНА строка таблицы (правило
 *    проекта). Здесь проверяется, что четыре новые строки в ней есть и что
 *    круговой рейс «разложить → собрать» возвращает введённое.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Layouts = require('../display-layouts');
const Schema = require('../settings-schema');
const { collectBlockLabels } = require('../panel-display');
const { codeOnly } = require('./helpers/source-scan');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const LABELLED = ['currentTime', 'eventTime', 'endTime', 'timeLeft'];

test('реестр: у четырёх блоков времени есть подпись и ключ настройки', () => {
    for (const id of LABELLED) {
        const row = Layouts.DISPLAY_ELEMENTS.find((el) => el.id === id);
        assert.ok(row, `в реестре нет элемента ${id}`);
        assert.ok(row.caption && row.caption.length > 0, `${id}: нет подписи по умолчанию`);
        assert.equal(row.labelKey, 'label' + id[0].toUpperCase() + id.slice(1),
            `${id}: ключ настройки назван не по элементу`);
    }
    // Название мероприятия подписи не носит намеренно: там пустая строка —
    // РЕЗЕРВ высоты, а значение блока и есть текст пользователя.
    const title = Layouts.DISPLAY_ELEMENTS.find((el) => el.id === 'eventTitle');
    assert.equal(title.caption, undefined, 'у названия мероприятия появилась подпись — переименовывать там нечего');
});

test('разметка дисплея повторяет подписи из реестра слово в слово', () => {
    const html = read('display.html');
    const BLOCK_NODE = {
        currentTime: 'currentTimeBlock',
        eventTime: 'eventTimeBlock',
        endTime: 'endTimeBlock',
        timeLeft: 'timeLeftBlock'
    };
    for (const id of LABELLED) {
        const at = html.indexOf(`id="${BLOCK_NODE[id]}"`);
        assert.ok(at > 0, `в разметке нет блока ${BLOCK_NODE[id]}`);
        const chunk = html.slice(at, at + 400);
        const m = /<div class="info-label"[^>]*>([^<]*)<\/div>/.exec(chunk);
        assert.ok(m, `${id}: в блоке не найдена подпись`);
        const caption = Layouts.DISPLAY_ELEMENTS.find((el) => el.id === id).caption;
        assert.equal(m[1].trim(), caption, `${id}: разметка и реестр разошлись в подписи`);
    }
});

test('blockCaption: пустое и пробелы означают стандартную подпись', () => {
    assert.equal(Layouts.blockCaption('eventTime', 'Доклад'), 'Доклад');
    assert.equal(Layouts.blockCaption('eventTime', ''), 'Начало');
    assert.equal(Layouts.blockCaption('eventTime', '   '), 'Начало');
    assert.equal(Layouts.blockCaption('eventTime', undefined), 'Начало');
    assert.equal(Layouts.blockCaption('eventTime', null), 'Начало');
    assert.equal(Layouts.blockCaption('eventTime', 42), 'Начало');
});

test('blockCaption: перевод строки и длина не ломают габарит блока', () => {
    assert.equal(Layouts.blockCaption('endTime', '  Конец   доклада  '), 'Конец доклада');
    const long = 'а'.repeat(200);
    const got = Layouts.blockCaption('endTime', long);
    assert.equal(got.length, Layouts.MAX_CAPTION);
    assert.ok(Layouts.MAX_CAPTION > 0 && Layouts.MAX_CAPTION <= 60, 'потолок подписи вне разумного');
});

test('blockCaption: неизвестный элемент не выдумывает подпись', () => {
    assert.equal(Layouts.blockCaption('нет-такого', ''), '');
    assert.equal(Layouts.blockCaption('нет-такого', 'Своё'), 'Своё');
});

test('таблица настроек: у каждой подписи своя строка с пустым умолчанием', () => {
    for (const id of LABELLED) {
        const key = 'label' + id[0].toUpperCase() + id.slice(1);
        const row = Schema.SETTINGS_DESCRIPTORS.find((d) => d.key === key);
        assert.ok(row, `в таблице настроек нет строки ${key}`);
        assert.equal(row.el, key, `${key}: контрол назван иначе, чем ключ`);
        assert.equal(row.def, '', `${key}: умолчание не пустое — стандартная подпись пришла бы в поле как текст`);
        assert.equal(row.owner, 'display', `${key}: настройка принадлежит дисплею`);
    }
});

test('круговой рейс: введённое в поле возвращается из хранилища', () => {
    const doc = fakeDocument();
    Schema.applyStoredSettings({ labelEventTime: 'Доклад', labelEndTime: '' }, doc);
    assert.equal(doc.getElementById('labelEventTime').value, 'Доклад');
    assert.equal(doc.getElementById('labelEndTime').value, '');

    doc.getElementById('labelTimeLeft').value = 'До перерыва';
    const saved = Schema.collectSettings(doc);
    assert.equal(saved.labelEventTime, 'Доклад');
    assert.equal(saved.labelTimeLeft, 'До перерыва');
});

test('панель: подписи собираются одним проходом по реестру', () => {
    const doc = fakeDocument();
    doc.getElementById('labelCurrentTime').value = ' Сейчас ';
    doc.getElementById('labelEndTime').value = '';
    const got = collectBlockLabels(doc);
    assert.deepEqual(Object.keys(got).sort(), [
        'labelCurrentTime', 'labelEndTime', 'labelEventTime', 'labelTimeLeft'
    ]);
    assert.equal(got.labelCurrentTime, ' Сейчас ', 'панель отдаёт ВВЕДЁННОЕ, обрезает дисплей');
    assert.equal(got.labelEndTime, '');
});

test('payload дисплея собирается в одном месте — и подписи в нём', () => {
    const src = codeOnly(read('panel-display.js'));
    const sends = src.match(/ipcRenderer\.send\('display-settings-update'/g) || [];
    assert.equal(sends.length, 1, 'сборок payload стало больше одной — подпись забудут в одной из них');
    assert.match(src, /collectBlockLabels\(document\)/, 'подписи не попадают в payload');
});

test('дисплей применяет подпись через реестр, а не своим списком слов', () => {
    const src = codeOnly(read('display-script.js'));
    assert.match(src, /blockCaption\(/, 'дисплей не спрашивает подпись у реестра');
    for (const word of ['Текущее время', 'Начало', 'Окончание', 'До завершения']) {
        assert.doesNotMatch(
            src, new RegExp(`'${word}'`),
            `в display-script.js завелась вторая копия слова «${word}»`
        );
    }
});

// ---------------------------------------------------------------------------
// Поддельный документ: ровно то, чем пользуется таблица настроек.
// ---------------------------------------------------------------------------
function fakeDocument() {
    const nodes = new Map();
    const ensure = (id) => {
        if (!nodes.has(id)) {
            nodes.set(id, { id, value: '', checked: false, textContent: '', style: {} });
        }
        return nodes.get(id);
    };
    for (const d of Schema.SETTINGS_DESCRIPTORS) { ensure(d.el); if (d.label) { ensure(d.label); } }
    return { getElementById: (id) => (nodes.has(id) ? nodes.get(id) : null) };
}
