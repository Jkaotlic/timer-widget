'use strict';

/**
 * Геометрия и перетаскивание безрамочного окна.
 *
 * До выноса в модуль эта логика жила двумя дословными клонами внутри
 * inline-<script> виджета и часов — то есть была непроверяемой в принципе:
 * импортировать её было неоткуда, и весь надзор сводился к регуляркам по тексту
 * HTML. Здесь она проверяется поведением, с подставными хранилищем и DOM.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createWindowGeometry,
    isWindowDragTarget,
    bindWindowDrag,
    MIN_SCALE_PCT,
    MAX_SCALE_PCT
} = require('../window-geometry');

// --- подставки -------------------------------------------------------------

function fakeStorage(initial = {}) {
    const data = { ...initial };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        throwOnWrite: false
    };
}

function quotaStorage() {
    return {
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceededError'); }
    };
}

const parseJSON = (raw, fallback) => {
    if (typeof raw !== 'string') { return fallback; }
    try { return JSON.parse(raw); } catch { return fallback; }
};

function makeGeometry(overrides = {}) {
    const sent = [];
    const storage = overrides.storage || fakeStorage();
    const geo = createWindowGeometry({
        storageKey: 'widgetGeometry',
        baseSize: 250,
        channels: { move: 'widget-move', resize: 'widget-resize', position: 'widget-set-position' },
        send: (channel, payload) => sent.push({ channel, payload }),
        parseJSON,
        storage,
        getOuterWidth: overrides.getOuterWidth || (() => 250),
        getScreenPosition: overrides.getScreenPosition || (() => ({ x: 10, y: 20 }))
    });
    return { geo, sent, storage };
}

// --- восстановление --------------------------------------------------------

test('пустое или испорченное хранилище не трогает окно', () => {
    for (const stored of [undefined, 'не json', '"строка"', '42', 'null']) {
        const storage = fakeStorage(stored === undefined ? {} : { widgetGeometry: stored });
        const { geo, sent } = makeGeometry({ storage });
        geo.restore();
        assert.deepEqual(sent, [], `значение ${JSON.stringify(stored)} не должно двигать окно`);
    }
});

test('сохранённый масштаб превращается в размер окна', () => {
    const storage = fakeStorage({ widgetGeometry: JSON.stringify({ scalePct: 200, x: 5, y: 6 }) });
    const { geo, sent } = makeGeometry({ storage });
    geo.restore();

    assert.deepEqual(sent[0], { channel: 'widget-resize', payload: { width: 500, height: 500 } });
    assert.deepEqual(sent[1], { channel: 'widget-set-position', payload: { x: 5, y: 6 } });
    assert.equal(geo.scalePct, 200, 'текущий масштаб обязан запомниться');
});

test('масштаб вне границ ИГНОРИРУЕТСЯ, а не поджимается', () => {
    // Поджать испорченное значение — значит молча показать окно неожиданного
    // размера. Пропустить — оставить размер по умолчанию, что заметно и честно.
    for (const pct of [MIN_SCALE_PCT - 1, MAX_SCALE_PCT + 1, 0, -100, NaN, Infinity]) {
        const storage = fakeStorage({ widgetGeometry: JSON.stringify({ scalePct: pct, x: 1, y: 2 }) });
        const { geo, sent } = makeGeometry({ storage });
        geo.restore();

        const resizes = sent.filter(s => s.channel === 'widget-resize');
        assert.equal(resizes.length, 0, `масштаб ${pct} не должен менять размер`);
        // Позиция при этом восстанавливается: одно испорченное поле не должно
        // отменять другое, исправное.
        assert.equal(sent.filter(s => s.channel === 'widget-set-position').length, 1);
        assert.equal(geo.scalePct, undefined);
    }
});

test('нечисловая позиция не отправляется', () => {
    const storage = fakeStorage({ widgetGeometry: JSON.stringify({ scalePct: 150, x: 'левее', y: null }) });
    const { geo, sent } = makeGeometry({ storage });
    geo.restore();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'widget-resize');
});

test('границы масштаба включительные', () => {
    for (const pct of [MIN_SCALE_PCT, MAX_SCALE_PCT]) {
        const storage = fakeStorage({ widgetGeometry: JSON.stringify({ scalePct: pct }) });
        const { geo, sent } = makeGeometry({ storage });
        geo.restore();
        assert.equal(sent.length, 1, `масштаб ${pct} должен приниматься`);
        assert.equal(geo.scalePct, pct);
    }
});

// --- сохранение ------------------------------------------------------------

test('явный масштаб записывается как есть', () => {
    const { geo, storage } = makeGeometry();
    geo.save(175);

    assert.deepEqual(JSON.parse(storage.data.widgetGeometry), { scalePct: 175, x: 10, y: 20 });
    assert.equal(geo.scalePct, 175);
});

test('без явного масштаба берётся ФАКТИЧЕСКАЯ ширина окна', () => {
    // Так учитывается растягивание за край рамки, а не только Ctrl+колесо:
    // при нативном ресайзе никто явного значения не передаёт.
    const { geo, storage } = makeGeometry({ getOuterWidth: () => 500 });
    geo.save();

    assert.equal(JSON.parse(storage.data.widgetGeometry).scalePct, 200);
});

test('нулевая ширина откатывается к прошлому масштабу, потом к 100', () => {
    // Окно, свёрнутое в момент записи, даёт outerWidth === 0.
    const withPrev = makeGeometry({ getOuterWidth: () => 0 });
    withPrev.geo.scalePct = 300;
    withPrev.geo.save();
    assert.equal(JSON.parse(withPrev.storage.data.widgetGeometry).scalePct, 300);

    const withoutPrev = makeGeometry({ getOuterWidth: () => 0 });
    withoutPrev.geo.save();
    assert.equal(JSON.parse(withoutPrev.storage.data.widgetGeometry).scalePct, 100);
});

test('переполненное хранилище не роняет окно', () => {
    const geo = createWindowGeometry({
        storageKey: 'widgetGeometry',
        baseSize: 250,
        channels: { move: 'm', resize: 'r', position: 'p' },
        send: () => {},
        parseJSON,
        storage: quotaStorage(),
        getOuterWidth: () => 250,
        getScreenPosition: () => ({ x: 0, y: 0 })
    });

    assert.doesNotThrow(() => geo.save(120));
    assert.equal(geo.scalePct, 120, 'масштаб в памяти обновляется даже если запись не удалась');
});

test('часы и виджет считают размер от РАЗНОЙ базы', () => {
    // Базовый размер — одно из четырёх различий, ради которых клоны и жили
    // порознь. Если его перепутать, окно молча откроется чужого размера.
    const clock = createWindowGeometry({
        storageKey: 'clockGeometry',
        baseSize: 220,
        channels: { move: 'clock-widget-move', resize: 'clock-widget-resize', position: 'clock-widget-set-position' },
        send: () => {},
        parseJSON,
        storage: fakeStorage(),
        getOuterWidth: () => 220,
        getScreenPosition: () => ({ x: 0, y: 0 })
    });

    assert.equal(clock.sizeFor(100), 220);
    assert.equal(makeGeometry().geo.sizeFor(100), 250);
});

// --- цель перетаскивания ---------------------------------------------------

test('исключаются ИМЕННО интерактивные элементы, а не «что-то похожее»', () => {
    // Проверяем сам селектор, а не факт вызова closest(): тест вида «вернули
    // объект — значит не тащим» зелёный при любом, даже пустом, селекторе.
    let asked = null;
    isWindowDragTarget({ closest: (q) => { asked = q; return null; } });

    assert.ok(asked, 'closest() должен быть вызван');
    for (const sel of ['button', 'input', 'select', 'textarea', '[role="button"]', '[tabindex]']) {
        assert.ok(
            asked.split(',').map(s => s.trim()).includes(sel),
            `в списке исключений должен быть ${sel}; сейчас: ${asked}`
        );
    }
});

test('найденный интерактивный предок отменяет перетаскивание', () => {
    assert.equal(isWindowDragTarget({ closest: () => ({ tagName: 'BUTTON' }) }), false);
    assert.equal(isWindowDragTarget({ closest: () => null }), true, 'пустое место тащит окно');
});

test('без пригодной цели перетаскивание не начинается', () => {
    // Событие может прийти с target === null (синтетическое) или с объектом без
    // closest (текстовый узел). Оба случая обязаны читаться как «не тащим»,
    // а не ронять обработчик.
    assert.equal(isWindowDragTarget(null), false);
    assert.equal(isWindowDragTarget(undefined), false);
    assert.equal(isWindowDragTarget({}), false, 'без closest() решение принять нельзя');
    assert.equal(isWindowDragTarget({ closest: 'не функция' }), false);
});

// --- перетаскивание --------------------------------------------------------

function fakeNode() {
    const listeners = {};
    return {
        listeners,
        addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
        fire: (type, event) => (listeners[type] || []).forEach(fn => fn(event))
    };
}

function mouseEvent(extra = {}) {
    let prevented = false;
    return {
        button: 0,
        screenX: 100,
        screenY: 100,
        target: { closest: () => null },
        preventDefault: () => { prevented = true; },
        get prevented() { return prevented; },
        ...extra
    };
}

function setupDrag() {
    const container = fakeNode();
    const doc = fakeNode();
    const moves = [];
    let drops = 0;
    bindWindowDrag({
        container,
        doc,
        onMove: (p) => moves.push(p),
        onDrop: () => { drops++; },
        handlers: {}
    });
    return { container, doc, moves, drops: () => drops };
}

test('перетаскивание шлёт РАЗНИЦУ и сдвигает точку отсчёта', () => {
    const { container, doc, moves } = setupDrag();

    container.fire('mousedown', mouseEvent({ screenX: 100, screenY: 100 }));
    doc.fire('mousemove', mouseEvent({ screenX: 130, screenY: 120 }));
    doc.fire('mousemove', mouseEvent({ screenX: 140, screenY: 125 }));

    // Второе движение даёт разницу от ПЕРВОГО, а не от начала: главный процесс
    // складывает дельту с текущей позицией окна.
    assert.deepEqual(moves, [{ deltaX: 30, deltaY: 20 }, { deltaX: 10, deltaY: 5 }]);
});

test('движение без нажатия игнорируется', () => {
    const { doc, moves } = setupDrag();
    doc.fire('mousemove', mouseEvent({ screenX: 300, screenY: 300 }));
    assert.deepEqual(moves, []);
});

test('нулевое смещение не шлёт сообщения', () => {
    const { container, doc, moves } = setupDrag();
    container.fire('mousedown', mouseEvent({ screenX: 100, screenY: 100 }));
    doc.fire('mousemove', mouseEvent({ screenX: 100, screenY: 100 }));
    assert.deepEqual(moves, [], 'дрожание на месте не должно грузить канал');
});

test('модификаторы и правая кнопка перетаскивание не начинают', () => {
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
        const { container, doc, moves } = setupDrag();
        const down = mouseEvent({ [mod]: true });
        container.fire('mousedown', down);
        doc.fire('mousemove', mouseEvent({ screenX: 200, screenY: 200 }));
        assert.deepEqual(moves, [], `${mod} зарезервирован за другим жестом`);
        assert.equal(down.prevented, false, 'событие должно достаться странице');
    }

    const { container, doc, moves } = setupDrag();
    container.fire('mousedown', mouseEvent({ button: 2 }));
    doc.fire('mousemove', mouseEvent({ screenX: 200, screenY: 200 }));
    assert.deepEqual(moves, [], 'правая кнопка — это контекстное меню');
});

test('нажатие на кнопке не начинает перетаскивание', () => {
    const { container, doc, moves } = setupDrag();
    container.fire('mousedown', mouseEvent({ target: { closest: () => ({}) } }));
    doc.fire('mousemove', mouseEvent({ screenX: 200, screenY: 200 }));
    assert.deepEqual(moves, []);
});

test('геометрия записывается один раз, в конце перетаскивания', () => {
    const { container, doc, drops } = setupDrag();

    container.fire('mousedown', mouseEvent());
    doc.fire('mousemove', mouseEvent({ screenX: 150, screenY: 150 }));
    doc.fire('mouseup', mouseEvent());
    assert.equal(drops(), 1);

    // Отпускание без нажатия (кнопку отпустили над другим окном) записи не даёт.
    doc.fire('mouseup', mouseEvent());
    assert.equal(drops(), 1, 'лишняя запись затёрла бы позицию');
});

test('начало перетаскивания гасит событие', () => {
    // Без preventDefault браузер начинает выделение текста, и окно тащится
    // вместе с растущим выделением.
    const { container } = setupDrag();
    const down = mouseEvent();
    container.fire('mousedown', down);
    assert.equal(down.prevented, true);
});
