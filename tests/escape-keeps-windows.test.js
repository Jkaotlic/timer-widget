'use strict';

/**
 * Escape НЕ закрывает окна (просьба 24.08.2026: «сделать так, чтобы ескейп не
 * выключал окна»).
 *
 * Почему это отдельный инвариант, а не строчка в аудите. Закрытие висело в
 * ЧЕТЫРЁХ местах сразу: панель гасила Esc'ом все три дочерних окна, а виджет,
 * часы и дисплей — каждое само себя. Убрать три из четырёх и не заметить
 * четвёртое — ровно тот случай, ради которого в этом проекте пишут проверку в
 * оба конца: жест либо отменён везде, либо не отменён вовсе.
 *
 * Esc при этом НЕ обезврежен: он по-прежнему закрывает ящик настроек, модалку,
 * справку F1 и отменяет ручной ввод. Отменён ровно один смысл — «погасить
 * окно», и остаётся он за буквами W / C / D, которые об этом и написаны.
 *
 * Проверка отсутствия обязана проверять саму себя: тем же зондом ищутся
 * буквенные клавиши, которые окна закрывать ОБЯЗАНЫ. Найдись они — зонд видит
 * такие пары; не найдись Escape при живом зонде — жеста действительно нет.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./helpers/source-scan');

const read = (name) => codeOnly(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'));

/**
 * Ветка `case '<клавиша>':` вместе с телом — до следующего `case` или конца
 * `switch`. Срез грубый намеренно: нам нужно лишь, есть ли внутри посылка
 * закрытия окна.
 */
function switchBranch(src, key) {
    const at = src.indexOf(`case '${key}':`);
    if (at === -1) { return null; }
    const rest = src.slice(at + 1);
    const next = rest.search(/\n\s*(case '|\}\s*\n)/);
    return next === -1 ? rest : rest.slice(0, next);
}

const CLOSES = /send\(\s*'close-(display|widget|clock-widget)'/;

const WINDOWS = [
    { file: 'display-script.js', keeps: 'KeyD' },
    { file: 'electron-widget.html', keeps: 'KeyW' },
    { file: 'electron-clock-widget.html', keeps: 'KeyC' }
];

for (const win of WINDOWS) {
    test(`${win.file}: Escape не гасит окно, а ${win.keeps} — гасит`, () => {
        const src = read(win.file);

        // Зонд живой: буквенная клавиша закрытия на месте вместе с посылкой.
        const letter = switchBranch(src, win.keeps);
        assert.ok(letter, `${win.file}: ветка ${win.keeps} исчезла — зонд больше ничего не меряет`);
        assert.match(
            letter, CLOSES,
            `${win.file}: ${win.keeps} перестала закрывать окно — зонд не видит даже настоящую пару`
        );

        // А Escape такой ветки не имеет вовсе.
        const esc = switchBranch(src, 'Escape');
        assert.equal(
            esc, null,
            `${win.file}: Escape снова попал в разбор клавиш — окно закрывается по Esc`
        );
    });
}

test('панель: Escape не гасит дочерние окна, буквы W / C / D — гасят', () => {
    const src = read('electron-control.html');

    // Зонд живой: буквенная ветка того же обработчика на месте и закрывает окно.
    const letter = src.slice(src.indexOf("else if (event.code === 'KeyW')"), src.indexOf("else if (event.code === 'KeyC')"));
    assert.ok(letter.length > 40, 'панель: обработчик горячих клавиш перестроен — зонд ищет не там');
    assert.match(letter, CLOSES, 'панель: W перестала закрывать виджет — зонд не видит даже настоящую пару');

    assert.doesNotMatch(
        src, /event\.code === 'Escape'/,
        'панель: Escape снова разбирается глобальным обработчиком клавиш'
    );
    // Охранник существовал ТОЛЬКО ради этой ветки.
    assert.doesNotMatch(
        src, /_isEscapeConsumedByOverlay/,
        'панель: остался охранник ветки Escape — значит и ветка где-то рядом'
    );
});

test('справка и подсказки не обещают закрытие окон по Esc', () => {
    const help = read('shortcuts-help.js');
    assert.doesNotMatch(
        help, /\['Esc',[^\]]*окн/i,
        'справка F1 по-прежнему обещает, что Esc закрывает окна'
    );
    // Зонд живой: строка про Esc в справке есть, просто про другое.
    assert.match(help, /\['Esc',/, 'в справке пропала строка про Esc — зонд ничего не меряет');

    const control = read('electron-control.html');
    assert.doesNotMatch(
        control, /Esc<\/span> <span class="shortcut-desc">Закрыть все окна/,
        'в справке панели осталась строка «Esc — закрыть все окна»'
    );
    assert.doesNotMatch(
        control, /<strong>Esc<\/strong> — закрыть все окна/,
        'в тексте помощи осталось обещание «Esc — закрыть все окна»'
    );
});

/**
 * Отменённый жест обязан быть ЗАМЕНЁН в тексте, а не просто вычеркнут.
 *
 * Esc перестал гасить окна — значит пользователю надо где-то узнать, чем гасить
 * теперь. Справка F1 и вкладка помощи это говорят, но обе спрятаны за отдельным
 * действием; подсказка в самой вкладке настроек стоит там, где человек и решает
 * судьбу окна. Поэтому каждая из трёх вкладок окон называет СВОЮ букву и
 * оговаривает, что Esc окна не гасит.
 *
 * Проверка идёт по срезу вкладки, а не по всему файлу: буква `W` найдётся в
 * документе всегда, и утверждение «в панели написано про W» ничего не значило
 * бы — важно, что оно написано ИМЕННО на вкладке виджета.
 */
const WINDOW_TABS = [
    { id: 'tab-timer', key: 'W', word: 'иджет' },
    { id: 'tab-clock', key: 'C', word: 'асы' },
    { id: 'tab-display', key: 'D', word: 'исплей' }
];

for (const tab of WINDOW_TABS) {
    test(`вкладка ${tab.id}: подсказка называет клавишу ${tab.key} и оговаривает Esc`, () => {
        const src = read('electron-control.html');
        const at = src.indexOf(`id="${tab.id}"`);
        assert.ok(at > 0, `в панели нет вкладки ${tab.id}`);
        // Срез до следующей вкладки: подсказка соседней вкладки не должна
        // засчитываться за свою.
        const next = src.indexOf('class="tab-content"', at + 1);
        const chunk = src.slice(at, next === -1 ? src.length : next);

        const hint = /<span class="hint-text">([\s\S]*?)<\/span>/.exec(chunk);
        assert.ok(hint, `${tab.id}: подсказки нет вовсе — заменять нечего`);
        // Зонд живой: в подсказке уже написано про жесты этого окна.
        assert.match(hint[1], new RegExp(tab.word), `${tab.id}: подсказка не про это окно`);

        assert.match(
            hint[1], new RegExp(`<kbd>${tab.key}</kbd>`),
            `${tab.id}: подсказка не называет клавишу ${tab.key} — жест «закрыть окно» стал безымянным`
        );
        assert.match(
            hint[1], /Esc/,
            `${tab.id}: подсказка не оговаривает, что Esc окна не гасит`
        );
    });
}

/**
 * Клавиша названа ТАМ, ГДЕ открывают окно.
 *
 * Подсказки во вкладках настроек (проверка выше) описывают жесты ВНУТРИ окна и
 * лежат за шевроном — их читают, когда уже полезли настраивать. Решение
 * «открыть или закрыть» принимается строкой на главном экране, и клавиша обязана
 * стоять там же. Оговорка про Esc — ОДНА на группу, у её заголовка: три копии
 * одной фразы в колонке шириной 238px это шум, а не подсказка.
 *
 * Срез по строке обязателен: буква `W` в документе найдётся всегда, и
 * утверждение «в панели написано про W» не значило бы ничего.
 */
const WINDOW_ROWS = [
    { btn: 'openWidgetBtn', key: 'W' },
    { btn: 'openClockBtn', key: 'C' },
    { btn: 'openDisplayBtn', key: 'D' }
];

test('строка окна называет свою клавишу, а оговорка про Esc стоит у заголовка группы', () => {
    const src = read('electron-control.html');

    // Зонд живой: заголовок группы на месте.
    const title = /<div class="group-title">Показать на экране([\s\S]*?)<\/div>/.exec(src);
    assert.ok(title, 'заголовок «Показать на экране» переименован — зонд ищет не там');
    assert.match(
        title[1], /Esc/,
        'у заголовка группы нет оговорки про Esc — жест отменён, а сказать об этом негде'
    );

    for (const row of WINDOW_ROWS) {
        const at = src.indexOf(`id="${row.btn}"`);
        assert.ok(at > 0, `в панели нет кнопки ${row.btn}`);
        // Строка целиком: от её открывающего тега до кнопки-тумблера.
        const from = src.lastIndexOf('<div class="wrow">', at);
        assert.ok(from > 0 && from < at, `${row.btn}: не найдено начало строки`);
        const chunk = src.slice(from, at);

        assert.match(
            chunk, new RegExp(`<kbd>${row.key}</kbd>`),
            `${row.btn}: в строке не названа клавиша ${row.key}`
        );
        assert.match(
            chunk, /открыть\/закрыть/,
            `${row.btn}: клавиша названа, но не сказано, что она делает`
        );
    }
});

test('клавиша в строке окна оформлена ТЕМ ЖЕ правилом, что и в подсказках', () => {
    // Вторая копия стиля клавиши разъедется с первой на первой же теме: у
    // `.settings-hint kbd` есть отдельный набор цветов для светлой.
    const css = read('control.css');
    assert.match(
        css, /\.wrow-key kbd,?[^{]*\{|[^,]*,\s*\.wrow-key kbd\s*\{/,
        'у клавиши в строке окна нет общего с подсказками правила'
    );
    const light = css.slice(css.indexOf('[data-theme="light"] .settings-hint kbd'));
    assert.ok(light.length > 0, 'в светлой теме клавиша не переопределяется — зонд смотрит не туда');
    assert.match(
        light.slice(0, 400), /\.wrow-key kbd/,
        'в светлой теме клавиша строки окна осталась без своего цвета'
    );
});
