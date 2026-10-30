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
const { pageLoads } = require('./helpers/page-graph');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { fits, decideCompact } = require(path.join(ROOT, 'panel-compact.js'));
const { codeOnly } = require('./helpers/source-scan.js');
const { readSource } = require('./helpers/window-source');
const read = (f) => readSource(f);

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
    assert.ok(pageLoads('electron-control.html', 'panel-compact.js'), 'панель не подключает panel-compact.js');
    assert.match(control, /(?<![\w.])PanelCompact\.bindCompactMode\(/, 'компактный режим ни к чему не привязан');
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

/**
 * Петля ступеней на Windows (жалоба 27.10.2026, видео со Сбербука, Windows 11).
 *
 * В каждом кадре видео два состояния панели сразу: крупные и мелкие цифры, два
 * ряда «Считать ниже нуля». Ступень менялась чаще кадра и замирала после
 * пробела (старт прячет пресеты — содержимое уходит от границы). На macOS петля
 * не воспроизводится ни на одном размере окна при масштабе 1 / 1.25 / 1.5, то
 * есть звено, которое её замыкает, живёт в Windows. Поэтому защита не от
 * конкретной причины, а от самой петли: поддельная панель ниже устроена
 * злонамеренно — ступень 0 у неё «влезает» ровно тогда, когда до этого стояла
 * ступень 1, и наоборот.
 */
const { bindCompactMode, createFlipBreaker } = require(path.join(ROOT, 'panel-compact.js'));

function flappingDoc({ viewport }) {
    const classes = new Set();
    let committed = 0; // ступень, стоявшая ДО текущего прохода
    const level = () => (classes.has('compact-panel-2') ? 2 : classes.has('compact-panel') ? 1 : 0);
    const panel = {
        children: [],
        get offsetHeight() { return 660; },
        get clientHeight() { return 660; },
        get scrollHeight() {
            const n = level();
            if (n === 0) { return committed === 1 ? 660 : 700; }
            return 660;
        }
    };
    const doc = {
        querySelector: () => panel,
        body: { classList: {
            toggle: (c, on) => { if (on) { classes.add(c); } else { classes.delete(c); } },
            contains: (c) => classes.has(c)
        } }
    };
    return {
        doc,
        level,
        commit() { committed = level(); },
        viewport
    };
}

test('предохранитель: пять смен ступени за секунду — петля, одна смена в секунду — нет', () => {
    let t = 0;
    const b = createFlipBreaker({ now: () => t, limit: 4, windowMs: 1000 });
    for (let i = 0; i < 4; i++) { t += 16; assert.equal(b.record(i % 2), false, `сработал на смене ${i + 1}`); }
    t += 16;
    assert.equal(b.record(1), true, 'пятая смена за 80 мс — это петля');

    let s = 0;
    const slow = createFlipBreaker({ now: () => s, limit: 4, windowMs: 1000 });
    for (let i = 0; i < 20; i++) { s += 1100; assert.equal(slow.record(i % 2), false, 'редкие смены — это пользователь, а не петля'); }
});

test('петля ступеней гаснет: после срабатывания ступень больше не меняется', () => {
    let t = 0;
    const viewport = { w: 400, h: 660 };
    const f = flappingDoc({ viewport });
    const ctl = bindCompactMode({ doc: f.doc, now: () => t, getViewport: () => viewport });
    f.commit();
    const seen = [];
    for (let i = 0; i < 40; i++) {
        t += 16;
        ctl.update();
        f.commit();
        seen.push(f.level());
    }
    const tail = seen.slice(-20);
    assert.equal(new Set(tail).size, 1, `ступень всё ещё скачет: ${seen.join('')}`);
    assert.ok(tail[0] >= 1, 'замирать надо на сжатой ступени: на несжатой содержимое не влезает');
});

test('после срабатывания новое окно снова решает замером; дрожь в пиксель — нет', () => {
    let t = 0;
    const viewport = { w: 400, h: 660 };
    const f = flappingDoc({ viewport });
    const ctl = bindCompactMode({ doc: f.doc, now: () => t, getViewport: () => viewport });
    for (let i = 0; i < 20; i++) { t += 16; ctl.update(); f.commit(); }
    assert.equal(ctl.locked(), true);

    viewport.h = 661; // округление дробного масштаба, а не новый размер
    t += 16; ctl.update();
    assert.equal(ctl.locked(), true, 'пиксель округления снял предохранитель');

    viewport.h = 800;
    t += 2000; ctl.update();
    assert.equal(ctl.locked(), false, 'пользователь поменял размер окна, а ступень заморожена навсегда');
});
