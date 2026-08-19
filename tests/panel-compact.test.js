'use strict';

/**
 * Компактный режим панели: решение по ЗАМЕРУ, с гистерезисом.
 *
 * Почему это чистая функция и почему у неё есть тест. Компактный режим САМ
 * МЕНЯЕТ высоту содержимого (замер: 708 → 660 на окне 660), поэтому наивное
 * «не влезло — сожмись, влезло — разожмись» — это цикл на каждом кадре:
 * сжались, влезло, разжались, снова не влезло. Такое в живом окне выглядит как
 * мигание интерфейса, и ловить его глазами поздно.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { fits, decideCompact } = require(path.join(ROOT, 'panel-compact.js'));
const { codeOnly } = require('./helpers/source-scan.js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('«влезло ровно» — это влезло, а не «почти»', () => {
    assert.equal(fits(700, 700), true);
    assert.equal(fits(701, 700), true, 'пиксель округления не повод сжиматься');
    assert.equal(fits(740, 700), false);
});

/** Поддельные замеры: панель, которая в компактном режиме на 48px ниже. */
function fakePanel({ natural, compact, client, startCompact = false }) {
    let isCompact = startCompact;
    const seen = [];
    return {
        io: {
            isCompact: () => isCompact,
            setCompact: (v) => { isCompact = v; seen.push(v); },
            // Растянутая панель: если помещается, scrollHeight РАВЕН окну —
            // ровно поэтому «сколько нужно» по нему не узнать.
            measure: () => {
                const need = isCompact ? compact : natural;
                return [Math.max(need, client) === need ? need : client, client];
            }
        },
        get isCompact() { return isCompact; },
        seen
    };
}

test('не влезло — сжимаемся', () => {
    const p = fakePanel({ natural: 708, compact: 660, client: 660 });
    assert.equal(decideCompact(p.io), true);
    assert.equal(p.isCompact, true);
});

test('влезло — не сжимаемся и ничего не трогаем', () => {
    const p = fakePanel({ natural: 700, compact: 660, client: 740 });
    assert.equal(decideCompact(p.io), false);
    assert.equal(p.isCompact, false);
    assert.deepEqual(p.seen, [], 'состояние переключали впустую');
});

test('окно выросло — разжимаемся', () => {
    // Сжаты, окно стало 800: без сжатия нужно 708 — помещается.
    const p = fakePanel({ natural: 708, compact: 660, client: 800, startCompact: true });
    assert.equal(decideCompact(p.io), false);
    assert.equal(p.isCompact, false);
});

test('окно не выросло — остаёмся сжатыми, а не мигаем', () => {
    // Ключевой случай: в сжатом состоянии содержимое РАВНО окну, и наивное
    // «влезло — разожмись» дало бы цикл на каждом кадре.
    const p = fakePanel({ natural: 708, compact: 660, client: 660, startCompact: true });
    assert.equal(decideCompact(p.io), true);
    assert.equal(p.isCompact, true);
});

test('решение устойчиво: повтор ничего не меняет', () => {
    for (const client of [600, 660, 700, 740, 800, 1000]) {
        const p = fakePanel({ natural: 708, compact: 660, client });
        const first = decideCompact(p.io);
        const second = decideCompact(p.io);
        const third = decideCompact(p.io);
        assert.equal(second, first, `окно ${client}: решение поменялось на втором проходе`);
        assert.equal(third, first, `окно ${client}: решение поменялось на третьем проходе`);
    }
});

test('панель подключает модуль и вешает режим', () => {
    const control = codeOnly(read('electron-control.html'));
    assert.match(control, /<script src="panel-compact\.js"><\/script>/, 'панель не подключает panel-compact.js');
    assert.match(control, /window\.PanelCompact\.bindCompactMode\(/, 'компактный режим ни к чему не привязан');
});

test('CSS компактного режима висит на КЛАССЕ, а не на медиазапросе высоты', () => {
    // Медиазапрос по высоте не знает ни про перенос подсказок, ни про ширину:
    // жалоба 19.08.2026 — окно 761×737 в порог max-height: 700px не попадало,
    // а содержимое в него не влезало.
    const css = read('control.css');
    assert.match(css, /body\.compact-panel \.control-panel \.timer-display-main \{[^}]*font-size: 56px/,
        'кегль компактного режима не привязан к классу');
    assert.doesNotMatch(css, /@media \(max-height: 700px\)/,
        'остался медиазапрос по высоте — два владельца одного решения');
    // Подсказки в компактном режиме НЕ прячутся: экономить на них — значит
    // убрать единственное место, где правила пресетов написаны словами.
    assert.doesNotMatch(css, /body\.compact-panel[^{]*\.preset-hint[^{]*\{[^}]*display:\s*none/,
        'компактный режим снова прячет подсказку под ячейками');
});
