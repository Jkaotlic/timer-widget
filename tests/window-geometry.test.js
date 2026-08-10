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
    fitScaledBounds,
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

// --- отложенное сохранение после resize ------------------------------------

const RESTORED = JSON.stringify({ scalePct: 400, x: 2440, y: 30 });

test('раннее событие resize НЕ затирает восстановленную геометрию', (t) => {
    // Замеренный дефект: restore() выставляет scalePct = 400 сразу, а окно ещё
    // 250 px. Приходящее следом раннее событие resize давало pct = 100, оно не
    // равно 400 — и защита, написанная чтобы гасить эхо восстановления, вместо
    // этого РАЗРЕШАЛА запись и стирала восстановленные значения позицией
    // открытия по умолчанию. Следующее открытие показывало 250 px.
    t.mock.timers.enable({ apis: ['setTimeout'] });

    let outer = 250; // окно ещё не успело измениться
    const storage = fakeStorage({ widgetGeometry: RESTORED });
    const { geo } = makeGeometry({
        storage,
        getOuterWidth: () => outer,
        getScreenPosition: () => ({ x: 3170, y: 30 }) // позиция открытия по умолчанию
    });

    geo.restore();
    geo.saveSettled(); // раннее событие: размер ещё старый

    outer = 1000; // а теперь размер применился
    t.mock.timers.tick(1000);

    assert.equal(storage.data.widgetGeometry, RESTORED,
        'восстановленная геометрия обязана остаться нетронутой');
});

test('размер читается в момент СРАБАТЫВАНИЯ, а не в момент события', (t) => {
    // Одного события достаточно: к моменту, когда таймер срабатывает, окно уже
    // доехало. Именно поэтому решение нельзя принимать в обработчике.
    t.mock.timers.enable({ apis: ['setTimeout'] });

    let outer = 250;
    const storage = fakeStorage();
    const { geo } = makeGeometry({ storage, getOuterWidth: () => outer });

    geo.saveSettled();
    outer = 750;
    t.mock.timers.tick(1000);

    assert.deepEqual(JSON.parse(storage.data.widgetGeometry).scalePct, 300,
        'записан размер, который окно имеет ПОСЛЕ того, как устоялось');
});

test('настоящее изменение размера всё-таки сохраняется', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const storage = fakeStorage({ widgetGeometry: RESTORED });
    const { geo } = makeGeometry({
        storage,
        getOuterWidth: () => 750,
        getScreenPosition: () => ({ x: 100, y: 200 })
    });

    geo.restore();
    geo.saveSettled();
    t.mock.timers.tick(1000);

    assert.deepEqual(JSON.parse(storage.data.widgetGeometry), { scalePct: 300, x: 100, y: 200 });
});

test('серия событий даёт ОДНУ запись, а не по записи на событие', (t) => {
    // Растягивание за край рамки шлёт resize десятками; писать на каждое —
    // значит долбить localStorage во время жеста.
    t.mock.timers.enable({ apis: ['setTimeout'] });

    let writes = 0;
    const storage = fakeStorage();
    const inner = storage.setItem;
    storage.setItem = (k, v) => { writes++; inner(k, v); };
    const { geo } = makeGeometry({ storage, getOuterWidth: () => 500 });

    for (let i = 0; i < 20; i++) { geo.saveSettled(); }
    t.mock.timers.tick(1000);

    assert.equal(writes, 1, `ожидалась одна запись, случилось ${writes}`);
});

test('отменённое сохранение не срабатывает после закрытия окна', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const storage = fakeStorage();
    const { geo } = makeGeometry({ storage, getOuterWidth: () => 500 });

    geo.saveSettled();
    geo.cancelPendingSave();
    t.mock.timers.tick(1000);

    assert.equal(storage.data.widgetGeometry, undefined, 'записи быть не должно');
});

// --- границы при смене размера ---------------------------------------------

// Рабочая область как на настоящем мониторе, где дефект и замерен:
// 3440×1440 со строкой меню сверху.
const WORK_AREA = { x: 0, y: 30, width: 3440, height: 1320 };
const WIDGET_MIN = { width: 120, height: 140 };

function centerOf(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

test('увеличение сохраняет центр окна', () => {
    // Позиция выбрана так, чтобы выросшему окну хватало места со всех сторон:
    // центр 1000×1000 в этой рабочей области обязан лежать в x 500…2940,
    // y 530…850. Иначе сработает поджатие, и тест будет проверять уже его.
    const current = { x: 1000, y: 500, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 1000, height: 1000 }, WORK_AREA, WIDGET_MIN);

    assert.deepEqual(centerOf(next), centerOf(current),
        'центр обязан остаться на месте: содержимое в окне отцентрировано, ' +
        'и смещение центра — это и есть уехавший за край циферблат');
    assert.equal(next.width, 1000);
    assert.equal(next.height, 1000);
});

test('поджатие ПОБЕЖДАЕТ сохранение центра, когда они спорят', () => {
    // Найдено падением предыдущего теста на его первой фикстуре: центр окна
    // (1000, 400) 250×250 — это y = 525, а выросшему до 1000 px окну нужен
    // центр не выше 530, иначе верхняя кромка уходит выше рабочей области.
    // Приоритет тут не вкусовой: выше рабочей области macOS окно всё равно не
    // пускает (замерено), поэтому сохранённый центр был бы недостижим.
    const current = { x: 1000, y: 400, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 1000, height: 1000 }, WORK_AREA, WIDGET_MIN);

    assert.equal(next.y, WORK_AREA.y, 'окно прижато к верху рабочей области');
    assert.equal(centerOf(next).y, 530, 'центр сместился ровно на недостающие 5 px');
    assert.equal(centerOf(next).x, centerOf(current).x, 'по горизонтали спора нет — центр сохранён');
});

test('уменьшение тоже сохраняет центр', () => {
    const current = { x: 1000, y: 400, width: 1000, height: 1000 };
    const next = fitScaledBounds(current, { width: 250, height: 250 }, WORK_AREA, WIDGET_MIN);

    assert.deepEqual(centerOf(next), centerOf(current));
    assert.equal(next.width, 250);
});

test('окно у правого верхнего угла уезжает ВНУТРЬ, а не наружу', () => {
    // Ровно замеренный дефект: виджет стоит в правом верхнем углу
    // (3170, 30) 250×280, масштаб 400% давал x = 3170…4170 при экране 3440.
    const current = { x: 3170, y: 30, width: 250, height: 280 };
    const next = fitScaledBounds(current, { width: 1000, height: 1000 }, WORK_AREA, WIDGET_MIN);

    assert.deepEqual(next, { x: 2440, y: 30, width: 1000, height: 1000 });
    assert.ok(next.x + next.width <= WORK_AREA.x + WORK_AREA.width, 'правый край в кадре');
    assert.ok(next.y >= WORK_AREA.y, 'верх не выше рабочей области');
});

test('окно у нижнего края уезжает вверх на столько, на сколько нужно', () => {
    // Часы: (3200, 1060) 220×220, масштаб 400% давал y = 1060…1940 при экране 1440.
    const current = { x: 3200, y: 1060, width: 220, height: 220 };
    const next = fitScaledBounds(current, { width: 880, height: 880 }, WORK_AREA, { width: 120, height: 120 });

    assert.deepEqual(next, { x: 2560, y: 470, width: 880, height: 880 });
    assert.ok(next.y + next.height <= WORK_AREA.y + WORK_AREA.height, 'низ в кадре');
});

test('монитор с ненулевым началом координат считается по СВОИМ границам', () => {
    // Второй экран слева от главного: отрицательный x. Раньше поджатие шло по
    // getPrimaryDisplay(), то есть по чужим размерам.
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    const current = { x: -300, y: 900, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 900, height: 900 }, left, WIDGET_MIN);

    assert.ok(next.x >= left.x, `x=${next.x} не должен быть левее ${left.x}`);
    assert.ok(next.x + next.width <= left.x + left.width, 'правый край в пределах своего экрана');
    assert.ok(next.y + next.height <= left.y + left.height, 'нижний край в пределах своего экрана');
});

test('запрошенный размер больше рабочей области поджимается до неё', () => {
    const current = { x: 100, y: 100, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 9000, height: 9000 }, WORK_AREA, WIDGET_MIN);

    assert.equal(next.width, WORK_AREA.width);
    assert.equal(next.height, WORK_AREA.height);
    assert.equal(next.x, WORK_AREA.x);
    assert.equal(next.y, WORK_AREA.y);
});

test('мусор по одной оси ИГНОРИРУЕТСЯ, вторая ось применяется', () => {
    // Раньше здесь стояло `Number(width) || 220`: ширина 0/NaN/undefined
    // превращала окно в 220 px независимо от того, каким оно было. Подогнать
    // испорченное значение — значит молча показать окно неожиданного размера.
    const current = { x: 1000, y: 400, width: 250, height: 250 };

    for (const bad of [NaN, Infinity, -Infinity, 0, -5, undefined, null, 'много', {}]) {
        const next = fitScaledBounds(current, { width: bad, height: 600 }, WORK_AREA, WIDGET_MIN);
        assert.equal(next.width, 250, `ширина при мусоре ${String(bad)} обязана остаться прежней`);
        assert.equal(next.height, 600, 'высота при мусоре в ширине обязана примениться');
    }
});

test('минимум окна ПОБЕЖДАЕТ рабочую область, границы не инвертируются', () => {
    // Вырожденный случай: монитор уже минимального размера окна. Верхняя
    // граница поджатия оказывается меньше нижней — результат обязан быть
    // определён, а не «как получится».
    const tiny = { x: 0, y: 0, width: 80, height: 80 };
    const current = { x: 0, y: 0, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 250, height: 250 }, tiny, WIDGET_MIN);

    assert.equal(next.width, WIDGET_MIN.width);
    assert.equal(next.height, WIDGET_MIN.height);
    assert.equal(next.x, tiny.x, 'прижато к левому краю');
    assert.equal(next.y, tiny.y, 'прижато к верхнему краю');
});

test('результат — целые числа: setBounds не принимает дроби', () => {
    const current = { x: 101, y: 201, width: 251, height: 251 };
    const next = fitScaledBounds(current, { width: 333, height: 333 }, WORK_AREA, WIDGET_MIN);

    for (const [k, v] of Object.entries(next)) {
        assert.equal(Number.isInteger(v), true, `${k}=${v} обязано быть целым`);
    }
});
