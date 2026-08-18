'use strict';

/**
 * Колесо масштабирования: ноль — это «ничего не произошло», а не «уменьшить».
 *
 * Дефект, ради которого написан тест. Во всех трёх окнах стояло
 * `const delta = e.deltaY < 0 ? step : -step`. Ноль попадает в «иначе», то есть
 * в уменьшение. Пока колесо крутят с Ctrl, deltaY не ноль и это незаметно; но
 * SHIFT на macOS перекладывает колесо на горизонтальную ось — приходит deltaX,
 * а deltaY РАВЕН НУЛЮ. В результате Shift+колесо на дисплее умело только
 * уменьшать: пользователь упёр все пять блоков в предел 50 % и не смог вернуть
 * их обратно (жалоба 17.08.2026, значения из его профиля — ровно 50).
 *
 * Почему это ловится ИСХОДНИКОМ, а не только e2e: ось перекладывает СИСТЕМА, и
 * синтетическое событие в тесте получает поля из рук автора теста. Прежняя
 * e2e-проверка Shift+колеса подавала deltaY и была зелёной — она повторяла
 * ошибку кода, то есть проверяла собственное понимание, а не поведение.
 * Поведение с настоящей осью проверяет e2e/display-layouts.spec.js (deltaX),
 * а этот тест держит саму форму записи во всех окнах сразу.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { codeOnly } = require('./helpers/source-scan.js');

const ROOT = path.join(__dirname, '..');
const WINDOWS = ['display-script.js', 'electron-widget.html', 'electron-clock-widget.html'];

for (const file of WINDOWS) {
    const code = codeOnly(fs.readFileSync(path.join(ROOT, file), 'utf8'));

    test(`${file}: направление берётся из ОСИ, по которой пришло движение`, () => {
        assert.match(
            code,
            /const\s+raw\s*=\s*e\.deltaY\s*!==\s*0\s*\?\s*e\.deltaY\s*:\s*e\.deltaX\s*;/,
            'ось выбирается не по факту движения — Shift+колесо снова станет односторонним'
        );
    });

    test(`${file}: событие без движения ничего не меняет`, () => {
        assert.match(
            code,
            /if\s*\(\s*!raw\s*\)\s*\{\s*return;\s*\}/,
            'нулевое колесо не отсекается — ноль будет прочитан как «уменьшить»'
        );
    });

    test(`${file}: прежняя односторонняя форма не вернулась`, () => {
        assert.doesNotMatch(
            code,
            /delta\s*=\s*e\.deltaY\s*<\s*0\s*\?/,
            'вернулась запись `e.deltaY < 0 ? …`: ноль снова означает уменьшение'
        );
    });
}

test('проверка отсутствия видит саму себя', () => {
    // Зелёный «прежняя форма не вернулась» обязан означать «чисто», а не
    // «регулярка не работает»: подаём ей ровно ту строку, которую она ловит.
    const stale = 'const delta = e.deltaY < 0 ? step : -step;';
    assert.match(stale, /delta\s*=\s*e\.deltaY\s*<\s*0\s*\?/);
});
