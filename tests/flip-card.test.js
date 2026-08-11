'use strict';

/**
 * Тесты перекидывания карточек.
 *
 * Анимация уже однажды исчезла из виджета таймера и виджета часов, оставшись
 * только в полноэкранном режиме, — регресс жил незамеченным, потому что
 * поведение «цифра просто сменилась» выглядит рабочим. Эти тесты фиксируют оба
 * ключевых свойства: анимация запускается при смене значения и НЕ запускается,
 * когда значение то же.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { flipCardTo, FLIP_CLASS, FLIP_DURATION_MS } = require('../flip-card');

// Двойник карточки: узел с цифрой внутри и список классов.
function fakeCard(initial = '0') {
    const digit = { textContent: initial };
    const classes = new Set();
    return {
        digit,
        classes,
        querySelector: (sel) => (sel === '.digit' ? digit : null),
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
        }
    };
}

test('смена значения ставит цифру и запускает анимацию', () => {
    const card = fakeCard('3');
    const id = flipCardTo(card, '.digit', '4');

    assert.equal(card.digit.textContent, '4');
    assert.equal(card.classList.contains(FLIP_CLASS), true);
    assert.notEqual(id, null, 'должен вернуться таймер снятия класса');
    clearTimeout(id);
});

test('то же значение не трогает карточку и не анимирует', () => {
    // Секунды тикают ежесекундно, а минуты и часы стоят. Без этой проверки
    // перекидывалось бы всё табло разом, и эффект превращался бы в мельтешение.
    const card = fakeCard('7');
    const id = flipCardTo(card, '.digit', '7');

    assert.equal(id, null);
    assert.equal(card.classList.contains(FLIP_CLASS), false);
});

test('числовое значение приводится к строке', () => {
    const card = fakeCard('0');
    const id = flipCardTo(card, '.digit', 5);
    assert.equal(card.digit.textContent, '5');
    clearTimeout(id);

    // И повторная подача того же числа уже не анимирует.
    assert.equal(flipCardTo(card, '.digit', 5), null);
});

test('класс снимается по таймеру', async () => {
    const card = fakeCard('1');
    flipCardTo(card, '.digit', '2');
    assert.equal(card.classList.contains(FLIP_CLASS), true);

    await new Promise((r) => setTimeout(r, FLIP_DURATION_MS + 60));
    assert.equal(card.classList.contains(FLIP_CLASS), false,
        'класс обязан сниматься сам, иначе карточка больше никогда не анимируется');
});

test('таймер отдаётся наружу для очистки при закрытии окна', () => {
    const seen = [];
    const card = fakeCard('1');
    flipCardTo(card, '.digit', '9', { onTimeout: (id) => seen.push(id) });

    assert.equal(seen.length, 1);
    clearTimeout(seen[0]);
});

test('отсутствующая карточка или цифра не роняют', () => {
    assert.equal(flipCardTo(null, '.digit', '1'), null);
    assert.equal(flipCardTo(undefined, '.digit', '1'), null);

    const empty = fakeCard('0');
    assert.equal(flipCardTo(empty, '.нет-такого', '1'), null);
});

test('длительность в JS совпадает с длительностью анимации в CSS', () => {
    // Разъедутся — класс снимется раньше конца анимации и её оборвёт.
    const fs = require('node:fs');
    const path = require('node:path');
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

    const seconds = (FLIP_DURATION_MS / 1000).toFixed(1).replace(/\.0$/, '');
    for (const [file, rule] of [
        ['display.css', /\.flip-card\.flipping \.flip-card-inner \{[^}]*animation: flip-animation ([\d.]+)s/s],
        ['electron-widget.html', /\.widget-flip-card\.flipping \.widget-flip-inner \{[^}]*animation: widget-flip-animation ([\d.]+)s/s],
        ['electron-clock-widget.html', /\.widget-flip-card\.flipping \.widget-flip-inner \{[^}]*animation: widget-flip-animation ([\d.]+)s/s]
    ]) {
        const m = read(file).match(rule);
        assert.ok(m, `${file}: правило анимации перекидывания не найдено`);
        assert.equal(m[1], seconds, `${file}: длительность разошлась с FLIP_DURATION_MS`);
    }
});

test('анимация выключается при prefers-reduced-motion во всех окнах', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    for (const file of ['electron-widget.html', 'electron-clock-widget.html']) {
        const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(
            src,
            /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.widget-flip-card\.flipping[^}]*animation: none/s,
            `${file}: перекидывание обязано отключаться при reduced-motion`
        );
    }
});

test('все три окна используют общую реализацию, а не свою копию', () => {
    // Три копии этой логики уже однажды разъехались — см. аудит 2026-07-29.
    const fs = require('node:fs');
    const path = require('node:path');
    for (const file of ['display-script.js', 'electron-widget.html', 'electron-clock-widget.html']) {
        const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(src, /window\.FlipCard\.flipCardTo\(/, `${file} должен звать общий flipCardTo`);
        assert.doesNotMatch(src, /classList\.add\('flipping'\)/, `${file} не должен навешивать класс сам`);
    }
});
