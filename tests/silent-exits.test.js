'use strict';

/**
 * Выход без следа — это дефект, который нельзя увидеть.
 *
 * История. Фон виджета и дисплея живёт в `displayExtSettings`, который пишет
 * ПАНЕЛЬ. В режиме съёмки все четыре окна поднимаются одновременно, поэтому
 * окно успевает прочитать localStorage раньше, чем панель туда пишет:
 * `loadBackgroundSettings()` не находил ключа и уходил молча, `applyBackground()`
 * не звался вовсе, и круг виджета оставался с CSS-дефолтом. Кадр расходился с
 * эталоном на половину площади — при полностью исправном приложении. Диагноз
 * занял отдельную сессию именно потому, что в логах не было НИЧЕГО.
 *
 * Инициализацию виджета при этом обнимал `try/catch` с `console.warn`, которого
 * «в терминале не видно». Теперь видно: `bindRenderConsole` в главном процессе
 * пересылает консоль каждого рендерера в общий лог.
 *
 * Здесь проверяется, что ранние выходы этих функций НАЗЫВАЮТ себя. Проверка по
 * исходнику: логика живёт в инлайновом <script> окна виджета и в классе
 * дисплея, импортировать нечего.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { codeOnly } = require('./helpers/source-scan');

const repoRoot = path.join(__dirname, '..');

/** Тело `loadBackgroundSettings()` из файла — по балансировке скобок. */
function loadBackgroundBody(src) {
    const start = src.indexOf('loadBackgroundSettings() {');
    assert.ok(start > -1, 'loadBackgroundSettings() не найдена');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') { depth += 1; }
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) { return src.slice(open, i + 1); }
        }
    }
    throw new Error('не удалось сбалансировать тело loadBackgroundSettings()');
}

const CASES = [
    { file: 'display-script.js', who: 'дисплей' },
    { file: 'electron-widget.html', who: 'виджет' }
];

for (const { file, who } of CASES) {
    test(`${who}: loadBackgroundSettings не уходит молча`, () => {
        const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
        const body = codeOnly(loadBackgroundBody(src));

        // Две причины не применить настройки, и обе обязаны быть названы:
        // ключа нет вовсе (нормально на чистом профиле) и ключ есть, но пуст
        // либо не разобрался (это уже порча).
        const returns = (body.match(/\breturn\b/g) || []).length;
        const logs = (body.match(/console\.(info|warn|error)\(/g) || []).length;
        assert.ok(
            returns >= 2,
            `${file}: ожидались ДВА ранних выхода (нет ключа / ключ пуст), найдено ${returns}`
        );
        assert.ok(
            logs >= returns,
            `${file}: выходов ${returns}, а сообщений ${logs} — какой-то из них молчит`
        );
        // Сообщение обязано называть окно: в общем логе рядом лежат строки
        // всех четырёх рендереров.
        assert.match(
            body,
            /console\.(info|warn)\(\s*'\[(display|widget)\]/,
            `${file}: сообщение обязано называть окно — в общем логе оно лежит рядом с тремя другими`
        );
    });
}

test('виджет: сорванная инициализация — это ошибка со стеком, а не warning', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron-widget.html'), 'utf8');
    const code = codeOnly(src);

    // Сюда попадает окно, у которого не отработали настройки, цвета ИЛИ фон:
    // человек видит не то, что настроил. Уровень обязан быть error, а стек —
    // присутствовать: три вызова в этом try выглядят в сообщении одинаково.
    assert.match(
        code,
        /console\.error\('\[widget\] инициализация не отработала:'[^)]*stack/,
        'сорванная инициализация обязана логироваться как error и со стеком'
    );
    assert.doesNotMatch(
        code,
        /console\.warn\('Widget init warning:'/,
        'прежний молчаливый warning без стека вернулся'
    );
});

test('зонд не путает наличие сообщений с их отсутствием', () => {
    // Тест, утверждающий отсутствие, обязан проверять сам себя.
    const fake = '{ if (!x) { return; } const y = 1; if (!y) { return; } }';
    const returns = (fake.match(/\breturn\b/g) || []).length;
    const logs = (fake.match(/console\.(info|warn|error)\(/g) || []).length;
    assert.equal(returns, 2, 'зонд не считает выходы');
    assert.equal(logs, 0, 'зонд видит сообщения там, где их нет');
    assert.ok(!(logs >= returns), 'зонд обязан признать молчащий образец негодным');
});
