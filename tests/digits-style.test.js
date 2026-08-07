const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    DIGIT_FONTS,
    DEFAULT_FONT_ID,
    PROBE_FONT_SIZE,
    PROBE_MINUTES,
    PROBE_HOURS,
    resolveFont,
    fitScale,
    fitFontSize,
    measureDigits,
    clearProbeCache
} = require('../digits-style');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Реестр
// ---------------------------------------------------------------------------
test('реестр: шесть семейств, идентификаторы уникальны', () => {
    assert.equal(DIGIT_FONTS.length, 6);
    const ids = DIGIT_FONTS.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, 'идентификаторы должны быть уникальны');
});

test('реестр: у каждой строки заполнены все поля', () => {
    for (const font of DIGIT_FONTS) {
        assert.ok(font.id && font.label && font.family, `${font.id}: id/label/family`);
        assert.ok(Number.isInteger(font.weight), `${font.id}: weight — целое`);
        assert.ok(Array.isArray(font.files) && font.files.length > 0, `${font.id}: files не пуст`);
        assert.ok(font.license && font.copyright, `${font.id}: лицензия и копирайт`);
    }
});

test('реестр: каждый файл лежит в fonts/', () => {
    for (const font of DIGIT_FONTS) {
        for (const file of font.files) {
            assert.ok(
                fs.existsSync(path.join(ROOT, 'fonts', file)),
                `${font.id}: fonts/${file} не найден`
            );
        }
    }
});

test('реестр: каждый файл объявлен в fonts.css', () => {
    const css = fs.readFileSync(path.join(ROOT, 'fonts.css'), 'utf8');
    for (const font of DIGIT_FONTS) {
        for (const file of font.files) {
            assert.ok(css.includes(`fonts/${file}`), `${font.id}: fonts/${file} нет в fonts.css`);
        }
    }
});

// ---------------------------------------------------------------------------
// Белый список
// ---------------------------------------------------------------------------
test('resolveFont: известный идентификатор возвращает свою строку', () => {
    assert.equal(resolveFont('mono').id, 'mono');
});

test('resolveFont: мусор откатывается к умолчанию, а не подставляется в CSS', () => {
    // Значение приходит из localStorage и по IPC, оба пути без проверки.
    for (const junk of [undefined, null, '', 0, 'inter; }', '../evil', {}, []]) {
        assert.equal(resolveFont(junk).id, DEFAULT_FONT_ID);
    }
});

// ---------------------------------------------------------------------------
// Арифметика подгонки
// ---------------------------------------------------------------------------
test('fitScale: ограничение по ширине', () => {
    // Эталон 200×50 при доступных 400×500 → упираемся в ширину: 400/200 = 2.
    assert.equal(fitScale({
        availableWidth: 400, availableHeight: 500, probeWidth: 200, probeHeight: 50
    }), 2);
});

test('fitScale: ограничение по высоте', () => {
    assert.equal(fitScale({
        availableWidth: 4000, availableHeight: 100, probeWidth: 200, probeHeight: 50
    }), 2);
});

test('fitScale: запас под знак минуса сужает доступную ширину', () => {
    // Знак вынесен из потока и в ширину блока не входит, но за край вылезти может.
    assert.equal(fitScale({
        availableWidth: 400, availableHeight: 5000, probeWidth: 150, probeHeight: 50, signWidth: 50
    }), 2);
});

test('fitScale: нулевые и мусорные размеры дают 0, а не Infinity и не NaN', () => {
    const bad = [
        { availableWidth: 0, availableHeight: 100, probeWidth: 10, probeHeight: 10 },
        { availableWidth: 100, availableHeight: 100, probeWidth: 0, probeHeight: 10 },
        { availableWidth: 100, availableHeight: 100, probeWidth: 10, probeHeight: 0 },
        { availableWidth: NaN, availableHeight: 100, probeWidth: 10, probeHeight: 10 },
        {}
    ];
    for (const opts of bad) {
        assert.equal(fitScale(opts), 0, JSON.stringify(opts));
    }
});

test('fitFontSize: кегль — это базовый кегль эталона, умноженный на масштаб', () => {
    assert.equal(PROBE_FONT_SIZE, 100);
    assert.equal(fitFontSize({
        availableWidth: 400, availableHeight: 500, probeWidth: 200, probeHeight: 50
    }), 200);
});

test('эталонные строки: минуты и часы — самые широкие комбинации цифр', () => {
    // Не «00:00»: у пропорциональных шрифтов ноль не всегда самый широкий знак,
    // а восьмёрка в цифровых начертаниях — почти всегда.
    assert.equal(PROBE_MINUTES, '88:88');
    assert.equal(PROBE_HOURS, '8:88:88');
});

// ---------------------------------------------------------------------------
// measureDigits: замер (DOM), сигнатура и кэш
// ---------------------------------------------------------------------------
/**
 * Фальшивый DOM-элемент. Node не рисует layout, поэтому геометрия здесь
 * ДЕТЕРМИНИРОВАННАЯ и завязана на текущий `textContent`/`fontSize` в момент
 * вызова `getBoundingClientRect()`: этого достаточно, чтобы отличить
 * «замерили заново» от «отдали из кэша» и «замерили НЕ ТУ строку» — не нужен
 * настоящий layout, нужна только воспроизводимая связь текст → ширина.
 * `rectCalls` считает обращения к DOM, чтобы доказывать кэш-попадания без
 * подглядывания во внутренний Map модуля.
 */
function makeFakeProbe() {
    let text = '';
    let rectCalls = 0;
    return {
        style: {},
        get textContent() { return text; },
        set textContent(v) { text = v; },
        get rectCalls() { return rectCalls; },
        getBoundingClientRect() {
            rectCalls += 1;
            const fontSize = parseFloat(this.style.fontSize) || 0;
            return { width: text.length * fontSize * 0.5, height: fontSize };
        }
    };
}

test('measureDigits: явная эталонная строка определяет ширину замера', () => {
    // Часы (Task 6) передают ЯВНЫЙ эталонный текст третьим аргументом, а не
    // булев hasHours — таймерные окна (виджет/дисплей) выбирают между
    // PROBE_MINUTES/PROBE_HOURS сами и передают ту же строку.
    clearProbeCache();
    const short = measureDigits(makeFakeProbe(), 'mono', '88:88');
    clearProbeCache();
    const long = measureDigits(makeFakeProbe(), 'mono', '88:88:88 PM');

    assert.ok(short.width > 0 && long.width > 0, 'оба замера обязаны дать положительную ширину');
    assert.ok(long.width > short.width, 'более длинный эталон обязан замеряться шире');
});

test('measureDigits: без эталонной строки — тот же результат, что PROBE_MINUTES явно', () => {
    clearProbeCache();
    const withDefault = measureDigits(makeFakeProbe(), 'mono');
    clearProbeCache();
    const withExplicit = measureDigits(makeFakeProbe(), 'mono', PROBE_MINUTES);
    assert.deepEqual(withDefault, withExplicit);
});

test('measureDigits: повторный вызов с тем же (шрифт, эталон) берётся из кэша, а не мерит заново', () => {
    clearProbeCache();
    const probe = makeFakeProbe();

    measureDigits(probe, 'mono', '88:88');
    const callsAfterFirst = probe.rectCalls;
    assert.ok(callsAfterFirst > 0, 'первый вызов обязан измерить DOM хотя бы раз');

    measureDigits(probe, 'mono', '88:88');
    assert.equal(
        probe.rectCalls, callsAfterFirst,
        'повторный вызов с тем же (шрифт, эталон) не должен трогать DOM — обязан быть кэш-хит'
    );
});

test('measureDigits: кэш различает эталоны по ТЕКСТУ, а не только по шрифту (CRITICAL)', () => {
    // Ключ кэша обязан включать саму эталонную строку, не только font.id.
    // Ровно это было находкой ревью Task 6: до обобщения сигнатуры часы были
    // вынуждены обходить этот модуль отдельным инлайновым замером МИМО кэша,
    // потому что PROBE_MINUTES/PROBE_HOURS не знают про суффикс « AM»/« PM».
    // Если бы ключ строился только по шрифту, второй вызов с ДРУГИМ текстом
    // того же шрифта тихо вернул бы результат замера ПЕРВОГО текста.
    clearProbeCache();
    const probe = makeFakeProbe();

    const shortText = '88:88';
    const longText = '88:88:88 PM';
    const first = measureDigits(probe, 'mono', shortText);
    const second = measureDigits(probe, 'mono', longText);

    assert.notEqual(first.width, second.width, 'разные эталонные строки обязаны давать разную ширину');
    // Доказываем, что second посчитан ПО ВТОРОМУ тексту, а не выдан по ошибке
    // из кэша первого: геометрия фальшивого probe детерминированно завязана
    // на длину текста в момент замера, поэтому неверный кэш-хит дал бы здесь
    // ширину shortText, а не longText.
    assert.equal(second.width, longText.length * PROBE_FONT_SIZE * 0.5);
});

test('measureDigits: разные шрифты не делят кэш даже с одинаковым эталоном', () => {
    clearProbeCache();
    const probeMono = makeFakeProbe();
    const probeBebas = makeFakeProbe();

    measureDigits(probeMono, 'mono', '88:88');
    measureDigits(probeBebas, 'bebas', '88:88');

    assert.equal(probeMono.rectCalls, 2, 'первый шрифт обязан замерить DOM (цифры + знак)');
    assert.equal(probeBebas.rectCalls, 2, 'второй шрифт — другой ключ кэша, тоже обязан замерить DOM');
});

test('measureDigits: неживой probeEl без getBoundingClientRect не роняет вызов', () => {
    clearProbeCache();
    assert.equal(measureDigits(null, 'mono', '88:88'), null);
    assert.equal(measureDigits({}, 'mono', '88:88'), null);
});
