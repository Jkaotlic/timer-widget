const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { codeOnly } = require('./helpers/source-scan');

const { mergeColors, PanelColorsMixin, SURFACE_TARGETS } = require('../panel-colors');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ───────────────────────────── сборка объекта цветов ─────────────────────── */

test('mergeColors: патч дополняет объект, а не замещает его', () => {
    // Тот самый дефект, ради которого сборка стала одна: тема и пипетка писали
    // `{ timer, progress }` целиком и вместе с цветом цифр уносили бы фон.
    const before = { timer: '#111111', surface: '#00ff00', surfaceAlpha: 0.5 };
    const after = mergeColors(before, { timer: '#222222', progress: '#333333' });
    assert.deepEqual(after, {
        timer: '#222222', progress: '#333333', surface: '#00ff00', surfaceAlpha: 0.5
    });
});

test('mergeColors: null УДАЛЯЕТ поле — это и есть сброс', () => {
    const after = mergeColors({ timer: '#111111', surface: '#00ff00', surfaceAlpha: 0 }, {
        surface: null, surfaceAlpha: null
    });
    assert.deepEqual(after, { timer: '#111111' });
    assert.ok(!('surface' in after), 'поле обязано исчезнуть, а не стать null');
});

test('mergeColors: прозрачность 0 сохраняется — это не «пусто»', () => {
    // Ноль и отсутствие ключа означают разное: погашенный фон и ненастроенный.
    const after = mergeColors({ surface: '#ffffff' }, { surfaceAlpha: 0 });
    assert.equal(after.surfaceAlpha, 0);
});

test('mergeColors: не мутирует исходный объект', () => {
    const before = { timer: '#111111' };
    mergeColors(before, { timer: '#222222' });
    assert.equal(before.timer, '#111111');
});

test('mergeColors: пустые аргументы дают пустой объект, а не падение', () => {
    assert.deepEqual(mergeColors(null, null), {});
    assert.deepEqual(mergeColors(undefined, { a: 1 }), { a: 1 });
});

/* ─────────────────────── updateColors на поддельном хосте ─────────────────── */

function fakeController(initial) {
    const saved = [];
    const host = Object.assign({
        currentColors: initial || null,
        clockColors: null,
        displayColors: null,
        saveColors: (target) => saved.push(target),
        renderSurfaceControls: () => {},
        saved
    }, PanelColorsMixin);
    return host;
}

test('updateColors: сохраняет ровно то окно, которое меняли', () => {
    const tc = fakeController({ timer: '#111111' });
    tc.updateColors('widget', { surface: '#00ff00' });
    assert.deepEqual(tc.currentColors, { timer: '#111111', surface: '#00ff00' });
    assert.deepEqual(tc.saved, ['widget']);
});

test('updateColors: неизвестное окно ничего не сохраняет', () => {
    const tc = fakeController({ timer: '#111111' });
    tc.updateColors('чужое', { surface: '#00ff00' });
    assert.deepEqual(tc.saved, [], 'сохранения быть не должно');
    assert.deepEqual(tc.currentColors, { timer: '#111111' });
});

test('updateColors: сброс фона у часов не трогает виджет', () => {
    const tc = fakeController({ surface: '#00ff00' });
    tc.clockColors = { surface: '#ff0000' };
    tc.updateColors('clock', { surface: null });
    assert.deepEqual(tc.clockColors, {});
    assert.deepEqual(tc.currentColors, { surface: '#00ff00' }, 'цвета виджета трогать нельзя');
});

/* ───────────────────────────── проводка в панели ──────────────────────────── */

const PANEL = read('electron-control.html');
const PANEL_CODE = codeOnly(PANEL);

test('панель подключает модуль и подмешивает его в прототип', () => {
    assert.match(PANEL, /<script src="panel-colors\.js"><\/script>/);
    assert.match(PANEL_CODE, /Object\.assign\(TimerController\.prototype, window\.PanelColorsMixin\)/);
    assert.match(PANEL_CODE, /initSurfaceControls\(\)/);
});

test('модуль попал в build.files — иначе он молча исчезнет из сборки', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.build.files.includes('panel-colors.js'));
});

test('точки монтирования есть у обоих окон', () => {
    SURFACE_TARGETS.forEach((target) => {
        assert.match(PANEL, new RegExp(`id="${target}SurfaceRow"`), `нет точки монтирования ${target}`);
    });
});

test('объект цветов больше НЕ пересобирается в панели и в сетке тем', () => {
    // Проверка на ОТСУТСТВИЕ, поэтому сначала убеждаемся, что регулярка вообще
    // что-то ловит: иначе зелёный значил бы и «чисто», и «шаблон не работает».
    // Ловится именно ЗАМЕЩЕНИЕ выбранным цветом (`= { timer: hex … }`), а не
    // стартовое состояние в конструкторе: там объект и должен создаваться, и
    // собирается он из токенов CONFIG, а не из значения контрола.
    const rebuild = /(currentColors|clockColors|displayColors)\s*=\s*\{\s*timer:\s*(hex|theme\.)/;
    assert.ok(rebuild.test('tc.currentColors = { timer: hex, progress: hex };'),
        'шаблон обязан ловить прежнюю запись');
    assert.ok(rebuild.test('this.clockColors = { timer: theme.t1, progress: theme.t2 };'),
        'шаблон обязан ловить и запись из сетки тем');
    assert.ok(!rebuild.test(PANEL_CODE), 'в панели вернулась пересборка объекта цветов');
    assert.ok(!rebuild.test(codeOnly(read('theme-grid.js'))), 'в сетке тем вернулась пересборка');
    assert.match(codeOnly(read('theme-grid.js')), /this\.updateColors\(/);
});

/* ──────────────────────────── подложка в самих окнах ──────────────────────── */

const WINDOWS = [
    { file: 'electron-widget.html', digits: '.widget-digits' },
    { file: 'electron-clock-widget.html', digits: '.clock-digits' }
];

test('подложка окна 1% снята в обоих окнах', () => {
    // Она и была «еле видным прямоугольником» у круга и «Цифр»: своего фона у
    // этих стилей нет, красилось только окно.
    const stale = /background:\s*rgba\(0,\s*0,\s*0,\s*0\.01\)/;
    assert.ok(stale.test('background: rgba(0, 0, 0, 0.01);'), 'шаблон обязан ловить прежнюю запись');
    WINDOWS.forEach(({ file }) => {
        assert.ok(!stale.test(read(file)), `подложка 1% вернулась в ${file}`);
    });
});

test('подложка КАЖДОГО стиля описана через var(--surface-paint, …)', () => {
    // Четыре стиля на окно: круг, флип, аналог и «Цифры» (LED слит с ними).
    // Пропущенный
    // означает стиль, у которого фон не настраивается и не сбрасывается, —
    // а увидеть это можно только переключившись именно на него.
    WINDOWS.forEach(({ file, digits }) => {
        const src = read(file);
        [
            /\.bg-circle\s*\{[^}]*var\(--surface-paint/,
            /\.widget-flip-inner\s*\{[^}]*var\(--surface-paint/,
            /\.widget-analog-clock\s*\{[^}]*var\(--surface-paint/,
            new RegExp(`\\${digits}-time\\s*\\{[^}]*var\\(--surface-paint`)
        ].forEach((rule, i) => {
            assert.match(src, rule, `${file}: подложка стиля #${i + 1} не читает --surface-paint`);
        });
        // И сама переменная ставится из общей арифметики, а не собирается на месте.
        assert.match(codeOnly(src), /RendererShared\.surfacePaint\(/, `${file}: свой расчёт фона`);
    });
});

test('цвета стопов градиента ушли в CSS — иначе их нечем сбросить', () => {
    // setAttribute('stop-color') — презентационный атрибут, removeProperty его
    // не видит: поставленный однажды цвет оставался бы навсегда.
    WINDOWS.forEach(({ file }) => {
        const src = read(file);
        assert.ok(!/setAttribute\('stop-color'/.test(codeOnly(src)), `${file}: вернулся setAttribute`);
        assert.match(src, /stop:first-child\s*\{\s*stop-color:\s*var\(/, `${file}: стопы не читают переменную`);
    });
});

/* ─────────────────── прозрачность работает БЕЗ выбранного цвета ───────────── */

test('подложка каждого стиля умножает свою альфу на --surface-alpha', () => {
    // Ползунок обязан гасить РОДНУЮ подложку стиля, а не только заливку
    // пользователя: иначе прозрачности LED, флипа и аналога нельзя добиться,
    // не выбрав сначала цвет, который не нужен.
    WINDOWS.forEach(({ file }) => {
        const src = read(file);
        // Якорим на НАЧАЛО правила: иначе регулярка цепляет и ::before, и
        // составной селектор `.widget-flip-card.flipping .widget-flip-inner`.
        ['widget-flip-inner', 'widget-analog-clock'].forEach((name) => {
            const rule = src.match(new RegExp(`^\\s*\\.${name} \\{[^}]*\\}`, 'm'));
            assert.ok(rule, `${file}: не нашлось правило .${name}`);
            assert.match(rule[0], /var\(--surface-alpha, 1\)/,
                `${file}: подложка .${name} не читает прозрачность`);
        });
    });
});

test('карточка минуса во флипе виджета красится вместе с цифрами', () => {
    // Она рисуется отдельным элементом, и при первой версии оставалась тёмной
    // рядом с перекрашенными карточками — «фон не меняется у минуса».
    const rule = read('electron-widget.html').match(/\.widget-flip-minus \{[^}]*\}/)[0];
    assert.match(rule, /var\(--surface-paint/);
    assert.match(rule, /var\(--surface-alpha, 1\)/);
});

test('двоеточие флипа в виджете читает цвет пользователя', () => {
    // Точки рисуют псевдоэлементы, поэтому `color` до них не доходит — и цвет
    // темы не доходил тоже: двоеточие всегда оставалось сине-зелёным.
    const rule = read('electron-widget.html')
        .match(/\.widget-flip-separator::before,\s*\.widget-flip-separator::after \{[^}]*\}/)[0];
    assert.match(rule, /background:\s*var\(--timer-color,/);
});

test('ползунок прозрачности не отключается из-за отсутствия цвета', () => {
    const src = read('panel-colors.js');
    assert.ok(/alpha\.disabled/.test('alpha.disabled = !hex;'), 'шаблон обязан ловить прежнюю запись');
    assert.ok(!/alpha\.disabled/.test(src), 'ползунок снова требует сначала выбрать цвет');
});

/* ─────────────── ряды настроек, применимых не ко всем стилям ──────────────── */

const PanelStateMixin = require('../panel-state');

// Поддельный документ: модулю нужны только getElementById и .style.display.
function fakeRowsDoc() {
    const rows = {};
    ['clockTicksRow', 'widgetStatusRow'].forEach((id) => { rows[id] = { style: {} }; });
    return {
        rows,
        getElementById: (id) => rows[id] || null
    };
}

function fakeRowsHost(widgetStyle, clockStyle, sync) {
    const doc = fakeRowsDoc();
    const host = Object.assign({
        timerStyleEl: { value: widgetStyle },
        clockStyleEl: { value: clockStyle },
        displayTimerStyleEl: { value: 'circle' },
        syncClockStyle: !!sync,
        widgetDigitsFontRowEl: { style: {} },
        clockDigitsFontRowEl: { style: {} },
        displayDigitsFontRowEl: { style: {} }
    }, PanelStateMixin);
    return { host, doc };
}

test('подпись состояния видна только у круга — у остальных её нет в разметке', () => {
    const shown = fakeRowsHost('circle', 'circle');
    global.document = shown.doc;
    shown.host.updateStyleDependentRows();
    assert.equal(shown.doc.rows.widgetStatusRow.style.display, 'flex');

    const hidden = fakeRowsHost('flip', 'flip');
    global.document = hidden.doc;
    hidden.host.updateStyleDependentRows();
    assert.equal(hidden.doc.rows.widgetStatusRow.style.display, 'none');
    delete global.document;
});

test('деления — настройка ЧАСОВ и видны только при их круглом циферблате', () => {
    // Раньше ряд жил во вкладке ВИДЖЕТА и правил оба циферблата сразу. У кольца
    // обратного отсчёта засечки не сообщали ничего, а до делений часов можно
    // было добраться только через чужую вкладку.
    const clockDial = fakeRowsHost('flip', 'circle');
    global.document = clockDial.doc;
    clockDial.host.updateStyleDependentRows();
    assert.equal(clockDial.doc.rows.clockTicksRow.style.display, 'flex',
        'у часов круг — ряд обязан быть виден');

    const noDial = fakeRowsHost('circle', 'digits');
    global.document = noDial.doc;
    noDial.host.updateStyleDependentRows();
    assert.equal(noDial.doc.rows.clockTicksRow.style.display, 'none',
        'стиль ВИДЖЕТА на этот ряд больше не влияет');
    delete global.document;
});

test('синхронизация стилей учитывается: стиль часов берётся от виджета', () => {
    const synced = fakeRowsHost('circle', 'digits', true);
    global.document = synced.doc;
    synced.host.updateStyleDependentRows();
    assert.equal(synced.doc.rows.clockTicksRow.style.display, 'flex');
    delete global.document;
});
