'use strict';

/**
 * Скрытый режим «47-й этаж»: проводка.
 *
 * Арифметику проверяют money-meter.test.js и event-overrun-store.test.js.
 * Здесь — то, что арифметику не видно: доехали ли каналы до обоих белых
 * списков, есть ли у каждого ОБА конца, объявлен ли накопитель там, где
 * рассылается состояние таймера.
 *
 * Правило проекта: белый список канала — это разрешение, а не доказательство
 * жизни. Канал, объявленный и никем не слушаемый, выглядит рабочим ровно до
 * мероприятия.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { codeOnly } = require('./helpers/source-scan');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const MAIN = codeOnly(read('electron-main.js'));
const VALIDATOR = read('channel-validator.js');
const PRELOAD = read('preload.js');

test('три канала объявлены в ОБОИХ белых списках', () => {
    const channels = ['event-finish', 'event-reset', 'event-overrun-state'];
    for (const ch of channels) {
        assert.ok(VALIDATOR.includes(`'${ch}'`), `channel-validator.js не знает канала ${ch}`);
        assert.ok(PRELOAD.includes(`'${ch}'`), `preload.js не знает канала ${ch}`);
    }
});

test('у каждого канала есть оба конца в главном процессе', () => {
    assert.ok(/ipcMain\.on\(\s*'event-finish'/.test(MAIN), 'некому принять event-finish');
    assert.ok(/ipcMain\.on\(\s*'event-reset'/.test(MAIN), 'некому принять event-reset');
    assert.ok(MAIN.includes("'event-overrun-state'"), 'никто не шлёт event-overrun-state');
});

test('накопитель живёт в главном процессе и берётся из своих модулей', () => {
    assert.ok(MAIN.includes("require('./event-overrun-store')"),
        'главный процесс не подключил модуль накопителя');
    assert.ok(MAIN.includes("require('./money-meter')"),
        'закрывать доклад надо той же арифметикой, что считает дисплей');
});

test('состояние накопителя снимается окну на ОТКРЫТИИ, а не только рассылается', () => {
    // Правило проекта: окно, загруженное вторым, обязано узнать текущее
    // состояние. Рассылка на изменение этого не даёт — изменения может не
    // случиться до самого мероприятия.
    const at = MAIN.indexOf("announceWindowOpened(displayWindow");
    assert.ok(at > 0, 'не найдена гидратация окна дисплея');
    const hydrate = MAIN.slice(at, at + 2500);
    assert.ok(hydrate.includes("'event-overrun-state'"),
        'дисплей при открытии не получает накопитель');

    // Само-проверка зонда: тот же срез обязан находить канал, который там
    // ТОЧНО есть. Иначе зелёный означал бы и «снимается», и «срез пуст».
    assert.ok(hydrate.includes("'timer-state'"),
        'зонд смотрит не туда — в гидратации дисплея нет даже timer-state');
});

test('таблица каналов в docs/ipc.md описывает все три', () => {
    const doc = read('docs/ipc.md');
    for (const ch of ['event-overrun-state', 'event-finish', 'event-reset']) {
        assert.ok(doc.includes(`\`${ch}\``), `docs/ipc.md не описывает канал ${ch}`);
    }
});

// ── Реестр, таблица настроек, разметка ────────────────────────────────────

const Layouts = require('../display-layouts');
const Schema = require('../settings-schema');

const SECRET = ['overrunCost', 'totalCost'];

test('реестр знает два денежных элемента и помечает их секретными', () => {
    for (const id of SECRET) {
        const row = Layouts.DISPLAY_ELEMENTS.find((el) => el.id === id);
        assert.ok(row, `в реестре нет элемента ${id}`);
        assert.equal(row.kind, 'block');
        assert.equal(row.secret, true, `${id}: не помечен секретным`);
        assert.ok(row.caption && row.caption.length > 0, `${id}: нет подписи по умолчанию`);
        assert.equal(row.labelKey, 'label' + id[0].toUpperCase() + id.slice(1));
    }
    assert.deepEqual(Layouts.SECRET_ELEMENTS.map((el) => el.id), SECRET);
});

test('раскладки денежных элементов НЕ трогают', () => {
    // Иначе оператор, выбравший раскладку посреди мероприятия, погасил бы
    // деньги на экране: ни в одной раскладке их координат нет, и общий
    // проход выключил бы им тумблеры.
    for (const layout of Layouts.LAYOUTS) {
        const toggles = Layouts.layoutToggles(layout);
        const scales = Layouts.layoutScales(layout);
        for (const id of SECRET) {
            const row = Layouts.DISPLAY_ELEMENTS.find((el) => el.id === id);
            assert.equal(toggles[row.toggle], undefined,
                `раскладка ${layout.id} трогает тумблер ${row.toggle}`);
            assert.equal(scales[id], undefined,
                `раскладка ${layout.id} трогает масштаб ${id}`);
        }
    }
});

test('семь несекретных элементов раскладка по-прежнему задаёт полностью', () => {
    // Само-проверка предыдущего теста: если бы layoutToggles вдруг перестал
    // возвращать что-либо, тот стал бы зелёным по ложной причине.
    const toggles = Layouts.layoutToggles(Layouts.layoutById('classic'));
    assert.equal(Object.keys(toggles).length, 7);
});

test('семь новых строк есть в таблице настроек и умолчания там ОДНИ', () => {
    const KEYS = {
        showOverrunCost: false,
        showTotalCost: false,
        labelOverrunCost: '',
        labelTotalCost: '',
        overrunPrice: '1000',
        overrunPeriod: '3',
        floor47Unlocked: false
    };
    for (const [key, def] of Object.entries(KEYS)) {
        const row = Schema.SETTINGS_DESCRIPTORS.find((d) => d.key === key);
        assert.ok(row, `в таблице настроек нет строки ${key}`);
        assert.equal(row.def, def, `${key}: умолчание в таблице не то`);
        assert.equal(row.el, key, `${key}: id контрола обязан совпадать с ключом`);
        assert.equal(row.owner, 'display');
    }
    assert.ok(Schema.DISPLAY_BLOCK_KEYS.includes('showOverrunCost'));
    assert.ok(Schema.DISPLAY_BLOCK_KEYS.includes('showTotalCost'));
});

test('разметка дисплея повторяет подписи из реестра слово в слово', () => {
    const html = read('display.html');
    const NODE = { overrunCost: 'overrunCostBlock', totalCost: 'totalCostBlock' };
    for (const id of SECRET) {
        const at = html.indexOf(`id="${NODE[id]}"`);
        assert.ok(at > 0, `в разметке нет блока ${NODE[id]}`);
        const chunk = html.slice(at, at + 400);
        const m = /<div class="info-label"[^>]*>([^<]*)<\/div>/.exec(chunk);
        assert.ok(m, `${id}: в блоке не найдена подпись`);
        const caption = Layouts.DISPLAY_ELEMENTS.find((el) => el.id === id).caption;
        assert.equal(m[1].trim(), caption, `${id}: разметка и реестр разошлись`);
    }
});

test('дисплей не рисует деньги, пока режим не разблокирован', () => {
    const src = codeOnly(read('display-script.js'));
    assert.ok(src.includes('floor47Unlocked'),
        'display-script не спрашивает про разблокировку — блоки покажутся всем');
    // Само-проверка зонда: если бы он искал строку, которой в файле нет
    // ВООБЩЕ, тест был бы зелёным по ложной причине.
    assert.ok(!src.includes('floor48Unlocked'), 'зонд ищет не то, что нужно');
});

// ── Скрытая секция панели ─────────────────────────────────────────────────

test('секцию и модалку строит МОДУЛЬ, а в панели только точка монтирования', () => {
    // Разметку строит panel-display.js по тому же правилу, что ряды подписей и
    // ряд «Фон»: вторая копия списка контролов в вёрстке разъезжается молча. У
    // этой секции есть и вторая причина — electron-control.html живёт под
    // храповиком, и полсотни строк статики подняли бы его потолок.
    const html = read('electron-control.html');
    assert.ok(html.includes('id="floor47Mount"'), 'в панели нет точки монтирования');
    assert.ok(!html.includes('id="floor47Section"'),
        'секция вернулась в вёрстку — это вторая копия и рост god-файла');

    const src = codeOnly(read('panel-display.js'));
    assert.ok(src.includes("section.id = 'floor47Section'"), 'модуль не строит секцию');
    assert.ok(/section\.hidden\s*=\s*true/.test(src), 'секция строится не скрытой');
    for (const id of ['overrunPrice', 'overrunPeriod', 'eventFinishBtn', 'eventResetBtn',
        'showOverrunCost', 'showTotalCost', 'floor47Unlocked']) {
        assert.ok(src.includes(`'${id}'`), `модуль не строит контрол ${id}`);
    }
});

test('разблокировка висит на подвале панели и считает три клика', () => {
    const src = codeOnly(read('panel-display.js'));
    assert.ok(src.includes('panelFooter'), 'разблокировка не привязана к подвалу');
    assert.ok(/detail\s*[<>=]=?\s*3/.test(src), 'тройной клик не считается');
});

test('ставка едет в окно ЕДИНСТВЕННОЙ сборкой payload', () => {
    const src = codeOnly(read('panel-display.js'));
    const sends = src.match(/send\('display-settings-update'/g) || [];
    assert.equal(sends.length, 1, 'сборок payload стало больше одной');
    assert.ok(src.includes('overrunPrice') && src.includes('overrunPeriod'),
        'ставка в payload не попадает');
});

test('ряды подписей денежных блоков строятся только при разблокировке', () => {
    const src = codeOnly(read('panel-display.js'));
    assert.ok(/el\.secret/.test(src),
        'bindBlockLabelRows не спрашивает про секретность — поля увидят все');
});

test('обнуление мероприятия спрашивает подтверждение модалкой проекта', () => {
    const src = codeOnly(read('panel-display.js'));
    // Смотреть надо на ПРИВЯЗКУ, а не на первое упоминание id: разметку кнопки
    // строит тот же модуль, и срез от неё до обработчика не достаёт.
    const at = src.indexOf('resetBtn.addEventListener');
    assert.ok(at > 0, 'у кнопки обнуления нет обработчика');
    const chunk = src.slice(at, at + 300);
    assert.ok(chunk.includes('openModal'), 'итог мероприятия стирается без подтверждения');
    // window.confirm в этом проекте не используется НИ РАЗУ: подтверждения
    // делаются модалкой с ловушкой фокуса (modal-manager.js). Вторая манера
    // спрашивать — это вторая манера выглядеть.
    assert.ok(!/window\.confirm|[^.\w]confirm\(/.test(src),
        'появился window.confirm — в проекте так не спрашивают');
    assert.ok(src.includes("modal.id = 'eventResetModal'"),
        'модуль не строит модалку подтверждения');
});

test('обе команды мероприятия уходят из панели', () => {
    const src = codeOnly(read('panel-display.js'));
    assert.ok(src.includes("send('event-finish')"), 'панель не шлёт event-finish');
    assert.ok(src.includes("send('event-reset')"), 'панель не шлёт event-reset');
});

test('тумблеры денег подписывает тот, кто их строит', () => {
    // Общий проход по ключам таблицы случается РАНЬШЕ, чем модуль строит
    // секцию: там этих контролов ещё нет. Симптом бесшумный — тумблер щёлкает,
    // галочка встаёт, а в окно не уходит ничего.
    const src = codeOnly(read('panel-display.js'));
    // Искать надо ОПРЕДЕЛЕНИЕ, а не первое упоминание имени: вызов метода
    // стоит выше по файлу, и срез от него охватил бы чужой код.
    const at = src.indexOf('\n    bindFloor47() {');
    assert.ok(at > 0, 'в модуле нет метода bindFloor47');
    const body = src.slice(at, src.indexOf('\n    renderFloor47() {', at));
    assert.ok(/SECRET_ELEMENTS/.test(body) && /addEventListener\('change'/.test(body),
        'построенные модулем тумблеры остались без обработчика');
});
