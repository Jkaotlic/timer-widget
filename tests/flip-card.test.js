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

test('длительность в JS покрывает ОБЕ фазы перекидывания из CSS', () => {
    // Разъедутся — слои снимутся раньше конца движения и оборвут его на
    // полукадре: створка исчезнет, не доехав.
    //
    // Механика теперь одна на три окна и живёт в flip-card.css: падение
    // верхней створки, затем подъём нижней с той же задержкой. Прежние
    // «правила на окно» проверять больше нечего — их нет, и это проверяется
    // отдельно ниже.
    const fs = require('node:fs');
    const path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'flip-card.css'), 'utf8');

    const fall = css.match(/\.fc-leaf-top \{[^}]*animation: fc-fall ([\d.]+)s/s);
    const rise = css.match(/\.fc-leaf-bottom \{[^}]*animation: fc-rise ([\d.]+)s [^;]*?([\d.]+)s forwards/s);
    assert.ok(fall, 'не найдено правило падающей створки');
    assert.ok(rise, 'не найдено правило поднимающейся створки');

    const fallMs = Number(fall[1]) * 1000;
    const riseMs = Number(rise[1]) * 1000;
    const riseDelayMs = Number(rise[2]) * 1000;
    const total = riseDelayMs + riseMs;

    // Равной длины фазы БЫТЬ НЕ ОБЯЗАНЫ, и раньше здесь стояло именно это
    // требование. Оно и держало прежний темп 180 + 180, который пользователь
    // 14.08.2026 назвал дёрганым: у настоящей пластины падение короче подъёма.
    // Настоящее условие другое — вторая створка не начинает подниматься
    // РАНЬШЕ, чем легла первая, иначе на карточке одновременно живут две
    // половины одной цифры.
    assert.ok(
        riseDelayMs >= fallMs,
        `подъём стартует на ${riseDelayMs} мс, а падение длится ${fallMs} мс — створки перекроются`
    );
    assert.ok(
        FLIP_DURATION_MS >= total,
        `FLIP_DURATION_MS=${FLIP_DURATION_MS} мс меньше движения в ${total} мс — слои снимутся посреди анимации`
    );
    // И не «на всякий случай втрое больше»: лишнее время держит лишние узлы.
    assert.ok(FLIP_DURATION_MS <= total + 100, `FLIP_DURATION_MS=${FLIP_DURATION_MS} мс заметно больше движения`);
});

test('наклона карточки в окнах больше нет — механика перекидывания одна', () => {
    // Он и был «анимацией, которой не видно»: rotateX всей карточки без
    // перспективы даёт плоское сжатие на cos(угол), замерено 0.79 px.
    const fs = require('node:fs');
    const path = require('node:path');
    for (const file of ['display.css', 'electron-widget.html', 'electron-clock-widget.html']) {
        const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.doesNotMatch(src, /@keyframes (widget-)?flip-animation/, `${file}: вернулся собственный наклон`);
    }
    for (const file of ['display.html', 'electron-widget.html', 'electron-clock-widget.html']) {
        const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(src, /<link rel="stylesheet" href="flip-card\.css">/, `${file}: не подключена общая таблица`);
    }
});

test('перспектива объявлена на прямом родителе створок, а окна дают ей значение', () => {
    // 14.08.2026: `perspective` стояла в каждом окне на самой карточке, а
    // створки ей ВНУКИ — свойство действует только на прямых детей, и достать
    // глубже нельзя: промежуточный узел несёт `overflow: hidden`, что по
    // спецификации возвращает `transform-style: flat`. Поворота не было вовсе,
    // рисовалось плоское сжатие: ширина створки 42.19 px по всей дуге падения.
    // Движение меряет e2e; здесь проверяется, что владелец свойства ОДИН и что
    // ни одно окно не осталось без значения.
    const fs = require('node:fs');
    const path = require('node:path');
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

    const css = read('flip-card.css');
    assert.match(
        css,
        /\.fc-flip \{[^}]*perspective: var\(--fc-perspective/s,
        'flip-card.css: perspective обязана стоять на .fc-flip — прямом родителе створок'
    );

    // Проверка ОТСУТСТВИЯ обязана проверить сама себя: зелёная строка ниже
    // иначе значит и «мёртвой копии нет», и «регулярка не работает».
    const dead = /^\s*perspective:/m;
    assert.match('.card {\n    perspective: 260px;\n}', dead, 'регулярка мёртвой копии не ловит саму себя');
    assert.doesNotMatch('.fc-flip {\n    perspective-origin: 50% 50%;\n}', dead, 'регулярка путает perspective-origin с perspective');

    // Каждое окно объявляет значение: карточки различаются высотой втрое, а
    // перспектива обязана быть ей пропорциональна.
    for (const file of ['display.css', 'electron-widget.html', 'electron-clock-widget.html']) {
        const src = read(file);
        assert.match(src, /--fc-perspective:/, `${file}: окно не задало --fc-perspective`);
        // И не держит мёртвую копию на карточке: она вводила в заблуждение
        // ровно до тех пор, пока кто-то не померил ширину.
        assert.doesNotMatch(
            src.replace(/\/\*[\s\S]*?\*\//g, ''),
            dead,
            `${file}: вернулась недействующая perspective на карточке`
        );
    }
});

test('«меньше движения» гасит перекидывание, и не только в CSS', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'flip-card.css'), 'utf8');
    assert.match(
        css,
        /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none/,
        'створки обязаны отключаться при reduced-motion'
    );
    // Одного CSS мало: неподвижный слой со СТАРОЙ цифрой висел бы поверх новой
    // всё время жизни слоёв. Поэтому модуль их вообще не строит.
    const js = fs.readFileSync(path.join(__dirname, '..', 'flip-card.js'), 'utf8');
    assert.match(js, /prefers-reduced-motion: reduce/, 'модуль обязан проверять предпочтение сам');
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

/* ─────────────────── створки: сборка слоёв на поддельном DOM ──────────────── */

// Минимальный документ: модулю нужны createElement, appendChild и querySelector
// внутри карточки. Так же, как и остальные модули рендерера, он проверяется на
// подделке — настоящий DOM здесь ничего не добавил бы, кроме браузера.
function fakeDom(reducedMotion) {
    const make = (tag) => {
        const node = {
            tagName: tag, className: '', textContent: '', children: [], attrs: {},
            appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
            removeChild(child) { this.children = this.children.filter((c) => c !== child); },
            setAttribute(k, v) { this.attrs[k] = v; },
            removeAttribute(k) { delete this.attrs[k]; },
            cloneNode() { const copy = make(tag); copy.className = this.className; copy.textContent = this.textContent; return copy; },
            querySelector(sel) {
                const cls = sel.replace('.', '');
                const walk = (n) => {
                    for (const c of n.children) {
                        if (String(c.className).split(' ').includes(cls)) { return c; }
                        const deep = walk(c);
                        if (deep) { return deep; }
                    }
                    return null;
                };
                return walk(this);
            }
        };
        return node;
    };
    global.document = { createElement: make };
    global.window = { matchMedia: () => ({ matches: !!reducedMotion }) };
    return make;
}

function cleanupDom() {
    delete global.document;
    delete global.window;
}

test('створки строятся из КЛОНОВ цифры — стиль окна не переписывается', () => {
    const make = fakeDom(false);
    try {
        const inner = make('div');
        const digit = make('span');
        digit.className = 'widget-flip-digit';
        digit.textContent = '3';
        inner.appendChild(digit);
        const card = {
            querySelector: () => digit,
            classList: { add() {}, remove() {}, contains: () => false }
        };

        const id = flipCardTo(card, '.widget-flip-digit', '4');
        clearTimeout(id);

        const wrap = inner.querySelector('.fc-flip');
        assert.ok(wrap, 'слои перекидыша не построились');
        assert.equal(wrap.children.length, 3, 'слоёв должно быть ровно три');
        // Старая цифра падает и прикрывает низ, новая поднимается.
        const texts = wrap.children.map((c) => c.children[0].children[0].textContent);
        assert.deepEqual(texts, ['3', '3', '4']);
        // Клон несёт КЛАСС оригинала: шрифт, кегль и цвет приезжают из CSS окна.
        assert.equal(wrap.children[0].children[0].children[0].className, 'widget-flip-digit');
        assert.equal(digit.textContent, '4', 'статичная цифра обязана стать новой сразу');
    } finally { cleanupDom(); }
});

test('«меньше движения» — слоёв нет вовсе, а не «есть, но без анимации»', () => {
    const make = fakeDom(true);
    try {
        const inner = make('div');
        const digit = make('span');
        digit.className = 'widget-flip-digit';
        digit.textContent = '3';
        inner.appendChild(digit);
        const card = {
            querySelector: () => digit,
            classList: { add() {}, remove() {}, contains: () => false }
        };

        const id = flipCardTo(card, '.widget-flip-digit', '4');
        clearTimeout(id);

        assert.equal(inner.querySelector('.fc-flip'), null,
            'неподвижный слой со старой цифрой закрыл бы новую на всё время жизни слоёв');
        assert.equal(digit.textContent, '4', 'гасится движение, а не информация');
    } finally { cleanupDom(); }
});
