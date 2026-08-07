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
    fitFontSize
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
