const test = require('node:test');
const assert = require('node:assert/strict');
const { DisplayTimer, validateBlockPositions, canSafelyStore } = require('../display-script');

test('validateBlockPositions returns null for non-objects', () => {
    assert.equal(validateBlockPositions(null), null);
    assert.equal(validateBlockPositions(undefined), null);
    assert.equal(validateBlockPositions('string'), null);
    assert.equal(validateBlockPositions(42), null);
    assert.equal(validateBlockPositions(true), null);
});

test('validateBlockPositions accepts valid position object', () => {
    const positions = {
        currentTime: { left: 100, top: 50 },
        eventTime: { left: 200, top: 100 }
    };
    const result = validateBlockPositions(positions);
    assert.deepEqual(result, {
        currentTime: { left: 100, top: 50 },
        eventTime: { left: 200, top: 100 }
    });
});

test('validateBlockPositions skips entries with non-finite coordinates', () => {
    const positions = {
        good: { left: 10, top: 20 },
        nan: { left: NaN, top: 30 },
        inf: { left: Infinity, top: 40 },
        missing: { top: 5 },
        nullLeft: { left: null, top: 10 }
    };
    const result = validateBlockPositions(positions);
    assert.deepEqual(result, { good: { left: 10, top: 20 } });
});

test('validateBlockPositions сохраняет пиксели широкого монитора и парные доли', () => {
    assert.deepEqual(validateBlockPositions({
        wide: { left: 7700, top: 10, cx: 0.8, cy: 0.2 },
        old: { left: 20, top: 11, cx: 0.1 }
    }), {
        wide: { left: 7700, top: 10, cx: 0.8, cy: 0.2 },
        old: { left: 20, top: 11 }
    });
});

test('validateBlockPositions skips null/non-object entries', () => {
    const positions = {
        good: { left: 0, top: 0 },
        nullEntry: null,
        arrEntry: [1, 2],      // array.left/top undefined → skipped
        primEntry: 42,         // primitive → skipped
        strEntry: 'nope'       // string → skipped (not an object per typeof... actually typeof 'x' === 'string', skipped)
    };
    const result = validateBlockPositions(positions);
    assert.deepEqual(Object.keys(result), ['good']);
    assert.equal(result.good.left, 0);
    assert.equal(result.good.top, 0);
});

test('validateBlockPositions handles empty object', () => {
    assert.deepEqual(validateBlockPositions({}), {});
});

test('canSafelyStore accepts small strings', () => {
    assert.equal(canSafelyStore('hello'), true);
    assert.equal(canSafelyStore(''), true);
    assert.equal(canSafelyStore(JSON.stringify({ a: 1, b: 2 })), true);
});

test('canSafelyStore rejects values over 1 MB', () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    assert.equal(canSafelyStore(big), false);
});

test('canSafelyStore accepts values exactly at 1 MB', () => {
    const exact = 'x'.repeat(1024 * 1024);
    assert.equal(canSafelyStore(exact), true);
});

test('canSafelyStore rejects non-string input', () => {
    assert.equal(canSafelyStore(null), false);
    assert.equal(canSafelyStore(undefined), false);
    assert.equal(canSafelyStore(123), false);
    assert.equal(canSafelyStore({}), false);
    assert.equal(canSafelyStore([]), false);
});

test('canSafelyStore respects custom limitBytes', () => {
    assert.equal(canSafelyStore('abcdef', 5), false);
    assert.equal(canSafelyStore('abc', 5), true);
});

test('validateBlockPositions: malformed JSON simulation (edge cases)', () => {
    // Simulate what happens when JSON.parse returns odd types
    assert.equal(validateBlockPositions(JSON.parse('null')), null);
    assert.deepEqual(validateBlockPositions(JSON.parse('{}')), {});
    assert.deepEqual(
        validateBlockPositions(JSON.parse('{"x":{"left":1,"top":2}}')),
        { x: { left: 1, top: 2 } }
    );
});

test('восстановление без записи возвращает карточку в угол и убирает её сохранённый центр', (t) => {
    t.after(() => { delete global.localStorage; });
    global.localStorage = { getItem: () => null };
    const classes = new Set(['custom-position']);
    const el = { style: { left: '200px', top: '140px' }, classList: {
        contains: (name) => classes.has(name), remove: (name) => classes.delete(name), add: (name) => classes.add(name)
    } };
    const display = Object.assign(Object.create(DisplayTimer.prototype), {
        movableElements: [{ el, id: 'currentTime', home: 'top-center' }],
        elementFractions: { currentTime: { cx: 0.8, cy: 0.3 } },
        restoreElementScales() {}, applyTimerScale() {}
    });
    display._restoreBlockPositionsPass();
    assert.deepEqual([...classes], ['top-center']);
    assert.deepEqual(display.elementFractions, {});
    assert.equal(el.style.left, '');
    assert.equal(el.style.top, '');
});

test('запись профиля проверяет байты до обращения к хранилищу', (t) => {
    const writes = [];
    global.localStorage = { setItem: (...args) => writes.push(args) };
    t.after(() => { delete global.localStorage; });
    assert.equal(DisplayTimer.prototype._safeSetItem('positions', 'я'.repeat(524289)), false);
    assert.equal(DisplayTimer.prototype._safeSetItem('positions', '{}'), true);
    assert.deepEqual(writes, [['positions', '{}']]);
});

function classList(...names) {
    const classes = new Set(names);
    return {
        contains: name => classes.has(name),
        add: (...added) => added.forEach(name => classes.add(name)),
        remove: (...removed) => removed.forEach(name => classes.delete(name)),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
    };
}

test('старый стиль digital активирует цифры, неизвестный стиль сохраняет текущий вид', (t) => {
    global.document = { body: { classList: classList('style-circle') } };
    t.after(() => { delete global.document; });
    const display = Object.assign(Object.create(DisplayTimer.prototype), {
        timerDigits: { classList: classList() }, timerRing: { classList: classList('active') },
        reflowElements() {}, reflowSoon() {}, updateDisplay() {}, updateDigitsScale() {}
    });
    display.setTimerStyle('digital');
    display.setTimerStyle('unknown');
    assert.equal(display.timerStyle, 'digits');
    assert.ok(document.body.classList.contains('style-digits'));
    assert.ok(display.timerDigits.classList.contains('active'));
    assert.ok(!display.timerRing.classList.contains('active'));
});

test('денежный блок пропускает запись текста и замер ширины при том же показании', () => {
    let writes = 0;
    let measurements = 0;
    let value = '';
    const display = Object.assign(Object.create(DisplayTimer.prototype), {
        floor47Unlocked: true, showTotalCost: true, overrunPrice: '1000', overrunPeriod: '3',
        remainingSeconds: 0, eventOverrunSeconds: 0,
        totalCostBlock: { classList: classList(), get offsetWidth() { measurements++; return 120; } },
        totalCostValueEl: {
            get textContent() { return value; },
            set textContent(next) { value = next; writes++; }
        }
    });
    display.updateMoneyBlocks();
    display.updateMoneyBlocks();
    assert.equal(measurements, 1);
    assert.equal(writes, 1);
    display.eventOverrunSeconds = 60;
    display.updateMoneyBlocks();
    assert.equal(measurements, 2);
    assert.equal(writes, 2);
});

test('карточка завершает перетаскивание при движении с отпущенной кнопкой', (t) => {
    global.window = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 });
    global.document = new EventTarget();
    global.requestAnimationFrame = () => 1;
    global.cancelAnimationFrame = () => {};
    t.after(() => {
        delete global.window;
        delete global.document;
        delete global.requestAnimationFrame;
        delete global.cancelAnimationFrame;
    });
    const block = Object.assign(new EventTarget(), {
        classList: classList('custom-position'), style: { left: '100px', top: '80px' },
        querySelector: () => null,
        getBoundingClientRect: () => ({ left: 100, top: 80, width: 50, height: 30 })
    });
    let saves = 0;
    const display = Object.assign(Object.create(DisplayTimer.prototype), {
        _handlers: {}, movableElements: [{ el: block }], saveElementPositions() { saves++; }, applyTimerScale() {}
    });
    display.setupBlockControls();
    const event = (type, screenX, buttons) => Object.assign(new Event(type), {
        altKey: true, button: 0, buttons, screenX, screenY: 80
    });
    block.dispatchEvent(event('mousedown', 100, 1));
    assert.ok(block.classList.contains('dragging-block'));
    document.dispatchEvent(event('mousemove', 160, 1));
    document.dispatchEvent(event('mousemove', 300, 0));
    document.dispatchEvent(event('mousemove', 350, 1));
    assert.ok(!block.classList.contains('dragging-block'));
    assert.equal(saves, 1);
    assert.equal(block.style.left, '160px');
});

test('флип подбирает масштаб после появления минуса и часовой группы', () => {
    const frames = [];
    const card = () => ({ querySelector: () => null, classList: classList() });
    const display = Object.assign(Object.create(DisplayTimer.prototype), {
        flipMin1: card(), flipMin2: card(), flipSec1: card(), flipSec2: card(),
        flipMinus: card(), timerFlip: { classList: classList('active') }, flipSeparators: [],
        _heroTotal: () => 0, _colorBand: () => 'normal',
        applyTimerScale() {
            frames.push([this.flipMinus.classList.contains('visible'), this.timerFlip.classList.contains('has-hours')]);
        }
    });
    for (const secs of [0, -1, -2, -3600, -3601, 0]) { display.updateFlipDisplay(secs); }
    assert.deepEqual(frames, [[true, false], [true, true], [false, false]]);
});
