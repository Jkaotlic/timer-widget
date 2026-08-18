'use strict';

/**
 * Клавиши пресетов обещаны в ЧЕТЫРЁХ окнах, а длительностей в реестре четыре.
 *
 * Дефект, ради которого написан тест: во всех окнах стояло
 * `e.code >= 'Digit1' && e.code <= 'Digit8'` — число из времён, когда пресетов
 * было восемь. После редизайна в `CONFIG.PRESET_DURATIONS` осталось четыре, и
 * клавиши 5–8 слали `{ type: 'set', seconds: undefined }`. Это НЕ безобидная
 * пустая команда: `timer-engine.setPreset` приводит нечисло к нулю, то есть
 * нажатие «6» на виджете СБРАСЫВАЛО набранное время в 00:00.
 *
 * Панель этот дефект у себя закрыла (там стоит `presetIndex < presets.length`
 * и комментарий про него), а три окна остались — классическая правка «в одной
 * копии из четырёх». Подсказки при этом продолжали обещать «1–8».
 *
 * Проверяется поэтому И код (граница выводится из реестра, а не из числа), И
 * подписи (ни одна не обещает больше клавиш, чем есть длительностей).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { codeOnly } = require('./helpers/source-scan.js');
const CONFIG = require('../constants');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Файлы, где живёт обработчик клавиш пресетов.
const HANDLERS = [
    'electron-widget.html',
    'electron-clock-widget.html',
    'display-script.js',
    'electron-control.html'
];

test('пресетов в реестре ровно столько, сколько обещают подписи', () => {
    assert.equal(CONFIG.PRESET_DURATIONS.length, 4, 'реестр изменился — подписи ниже надо пересмотреть');
});

for (const file of HANDLERS) {
    test(`${file}: клавиша без пресета не отправляет команду`, () => {
        const code = codeOnly(read(file));
        const hit = /e(?:vent)?\.code\s*>=\s*'Digit1'\s*&&\s*e(?:vent)?\.code\s*<=\s*'Digit(\d)'/.exec(code);
        assert.ok(hit, 'обработчик клавиш пресетов не найден');

        // Верхняя граница диапазона сама по себе ничего не решает — решает
        // проверка по длине реестра. Она обязана быть, и обязана стоять ДО
        // отправки команды.
        assert.match(
            code,
            /(?:idx|presetIndex)\s*<\s*presets\.length/,
            'нет проверки по длине CONFIG.PRESET_DURATIONS: клавиша без пресета обнулит таймер'
        );

        // Прибитое `<= 'Digit8'` без проверки — ровно та форма, которая
        // сбрасывала таймер. Держим границу на Digit9 (все цифровые клавиши),
        // а отсев делает реестр.
        assert.equal(hit[1], '9', `граница диапазона прибита числом (${hit[0]}) — отсев должен делать реестр`);
    });
}

// Обещание вида «1–4 — пресеты» в любой вёрстке: «1–4», «<kbd>1</kbd>–<kbd>4</kbd>»,
// «<strong>1–4</strong>».
const PROMISE = />?\s*1\s*<?\/?[a-z]*>?\s*[–-]\s*<?[a-z]*>?\s*(\d)\s*<?\/?[a-z]*>?\s*(?:—|-)?\s*(?:пресет|Пресет)/g;

test('ни одна подсказка не обещает больше клавиш пресетов, чем есть', () => {
    const last = CONFIG.PRESET_DURATIONS.length;
    let found = 0;
    for (const file of ['electron-control.html', 'display.html', 'electron-widget.html', 'electron-clock-widget.html']) {
        for (const m of read(file).matchAll(PROMISE)) {
            found++;
            assert.equal(
                Number(m[1]), last,
                `${file}: подсказка обещает клавиши 1–${m[1]}, а пресетов ${last}`
            );
        }
    }
    // Проверка ОТСУТСТВИЯ обязана доказать, что она вообще смотрит: не найди
    // регулярка ни одного обещания, тест был бы зелёным и при «1–8» в каждой
    // подсказке. Обещаний сейчас три: подсказка дисплея в панели, шпаргалка в
    // самом окне дисплея и строка в справке.
    assert.ok(found >= 3, `регулярка нашла ${found} обещаний — она перестала видеть подсказки`);
});

test('регулярка обещаний ловит устаревшую форму — проверка теста на себе', () => {
    const stale = '<strong>1–8</strong> — пресеты';
    const hit = [...stale.matchAll(PROMISE)];
    assert.equal(hit.length, 1, 'регулярка не видит устаревшее обещание — предыдущий тест бесполезен');
    assert.equal(Number(hit[0][1]), 8);
});
