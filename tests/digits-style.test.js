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
const DigitsStyle = require('../digits-style');

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
// Поля рамки входят в габарит: цифры подгоняются ВМЕСТЕ с ней. При базовом
// кегле 100 это +2*0.34*100 по ширине и +2*0.18*100 по высоте.
const FRAME_X = 2 * DigitsStyle.FRAME_PAD_X_EM * PROBE_FONT_SIZE;
const FRAME_Y = 2 * DigitsStyle.FRAME_PAD_Y_EM * PROBE_FONT_SIZE;

test('fitScale: ограничение по ширине — с полями рамки', () => {
    // Эталон 200×50 плюс поля рамки при доступных 400×5000 → упираемся в ширину.
    assert.equal(fitScale({
        availableWidth: 400, availableHeight: 5000, probeWidth: 200, probeHeight: 50
    }), 400 / (200 + FRAME_X));
});

test('fitScale: ограничение по высоте — тоже с полями', () => {
    assert.equal(fitScale({
        availableWidth: 40000, availableHeight: 100, probeWidth: 200, probeHeight: 50
    }), 100 / (50 + FRAME_Y));
});

test('fitScale: запас под знак минуса сужает доступную ширину', () => {
    // Знак вынесен из потока и в ширину блока не входит, но за край вылезти может.
    assert.equal(fitScale({
        availableWidth: 400, availableHeight: 5000, probeWidth: 150, probeHeight: 50, signWidth: 50
    }), 400 / (150 + 50 + FRAME_X));
});

test('поля рамки в CSS совпадают с теми, по которым считается подгонка', () => {
    // Разойдутся — подогнанные цифры вылезут за собственную рамку, и увидеть
    // это можно будет только глазом на конкретном размере окна.
    const fs = require('node:fs');
    const path = require('node:path');
    const expected = `padding: ${DigitsStyle.FRAME_PAD_Y_EM}em ${DigitsStyle.FRAME_PAD_X_EM}em`;
    for (const [file, selector] of [
        ['electron-widget.html', '.widget-digits-time'],
        ['electron-clock-widget.html', '.clock-digits-time'],
        ['display.css', '.digits-time']
    ]) {
        const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const rule = src.match(new RegExp(`^\\s*\\${selector} \\{[^}]*\\}`, 'm'));
        assert.ok(rule, `${file}: не найдено правило ${selector}`);
        assert.ok(
            rule[0].includes(expected),
            `${file}: поля рамки ${selector} разошлись с подгонкой (${expected})`
        );
    }
});

// ---------------------------------------------------------------------------
// Вертикаль знака
// ---------------------------------------------------------------------------
// Знак центрируется по своему БОКСУ, а видно чернила. Насколько центр чернил
// отстоит от центра бокса, решает шрифт: у Playfair Display минус сидит высоко,
// и знак уезжал вверх на 0.119 кегля (замер 17.08.2026, жалоба пользователя).
// У остальных пяти шрифтов расхождение того же происхождения, только мельче:
// от −0.061 (Inter, знак НИЖЕ середины) до +0.027.
test('inkCenterOffset: центр чернил ниже центра бокса на полуразность метрик', () => {
    // Восходящая 80, нисходящая 20 → центр бокса на 30 ниже базовой линии.
    // Чернила от 70 над линией до 0 под ней → их центр на 35 ВЫШЕ линии.
    // Значит центр чернил на 65 выше центра бокса.
    const offset = DigitsStyle.inkCenterOffset({
        fontBoundingBoxAscent: 80, fontBoundingBoxDescent: 20,
        actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 0
    });
    assert.equal(offset, 30 - 35);
});

test('signShiftRatio: сдвиг — разность двух смещений, в долях кегля цифр', () => {
    const digits = {
        fontBoundingBoxAscent: 80, fontBoundingBoxDescent: 20,
        actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 0
    };
    // Тот же шрифт вдвое мельче: все метрики вдвое меньше.
    const sign = {
        fontBoundingBoxAscent: 40, fontBoundingBoxDescent: 10,
        actualBoundingBoxAscent: 35, actualBoundingBoxDescent: 0
    };
    // Смещения: −5 у цифр, −2.5 у знака. Знак надо опустить на 2.5.
    assert.equal(DigitsStyle.signShiftRatio(digits, sign, 100), -0.025);
});

test('signShiftRatio: мусор даёт 0, а не NaN — иначе знак уезжает из окна', () => {
    // Тот же закон, что у fitScale: NaN в transform не сдвигает, а ломает
    // раскладку молча.
    const ok = {
        fontBoundingBoxAscent: 80, fontBoundingBoxDescent: 20,
        actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 0
    };
    for (const [d, s, size] of [
        [null, ok, 100], [ok, null, 100], [ok, ok, 0], [ok, ok, NaN], [{}, ok, 100], [ok, {}, 100]
    ]) {
        const value = DigitsStyle.signShiftRatio(d, s, size);
        assert.equal(value, 0, `ожидался 0, получено ${value}`);
    }
});

test('посадка знака минуса в CSS совпадает с той, по которой считается запас', () => {
    // Знак стоит абсолютом от ПАДДИНГ-бокса рамки, поэтому к зазору
    // прибавляется её левое поле — его надо вычесть, иначе минус отъезжает от
    // числа на FRAME_PAD_X_EM (замер 17.08.2026: 0.40 кегля вместо 0.10, знак
    // целиком снаружи рамки и обрезан краем окна). Деление на SIGN_FONT_RATIO
    // переводит обе величины из кегля цифр в собственный кегль знака: `em` в
    // свойствах знака считается от него.
    const fs = require('node:fs');
    const path = require('node:path');
    const expected = `margin-right: calc((${DigitsStyle.SIGN_GAP_EM}em - ${DigitsStyle.FRAME_PAD_X_EM}em) / ${DigitsStyle.SIGN_FONT_RATIO})`;
    for (const [file, selector] of [
        ['electron-widget.html', '.widget-digits-sign'],
        ['display.css', '.digits-sign']
    ]) {
        const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const rule = src.match(new RegExp(`^\\s*\\${selector} \\{[^}]*\\}`, 'm'));
        assert.ok(rule, `${file}: не найдено правило ${selector}`);
        assert.ok(
            rule[0].includes(expected),
            `${file}: посадка знака ${selector} разошлась с подгонкой (${expected})`
        );
        // Старая запись возвращает свес: она НЕ вычитает поле рамки.
        const oldForm = /margin-right:\s*0\.1em/;
        // Проверка проверки: зелёное «чисто» и зелёное «регулярка не работает»
        // выглядят одинаково, поэтому регулярка обязана ловить образец.
        assert.ok(oldForm.test('margin-right: 0.1em;'), 'регулярка старой записи не ловит образец');
        assert.ok(
            !oldForm.test(rule[0]),
            `${file}: в ${selector} вернулся зазор без вычета поля рамки`
        );
    }
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
        availableWidth: 400, availableHeight: 5000, probeWidth: 200, probeHeight: 50
    }), PROBE_FONT_SIZE * (400 / (200 + FRAME_X)));
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

test('замер НЕ кэшируется, пока woff2 не доехал (CRITICAL)', () => {
    // Замер с ЗАПАСНОГО начертания неотличим от настоящего по «ширина > 0» —
    // именно так чужие метрики Georgia оседали в кэше на всю сессию, стоило
    // переключить шрифт после старта: `document.fonts.ready` разрешился один раз
    // и о новом шрифте не знал. Проверка проверяет и себя: сначала показывает,
    // что при загруженном шрифте кэш ЕСТЬ, иначе зелёный ничего не значил бы.
    const fakeDoc = (loaded) => ({
        fonts: { check: () => loaded },
        createElement: () => ({ getContext: () => null })
    });
    const original = global.document;
    try {
        global.document = fakeDoc(true);
        clearProbeCache();
        const probeLoaded = makeFakeProbe();
        measureDigits(probeLoaded, 'playfair', '88:88');
        const afterFirst = probeLoaded.rectCalls;
        measureDigits(probeLoaded, 'playfair', '88:88');
        assert.equal(probeLoaded.rectCalls, afterFirst, 'загруженный шрифт обязан кэшироваться');

        global.document = fakeDoc(false);
        clearProbeCache();
        const probeCold = makeFakeProbe();
        measureDigits(probeCold, 'playfair', '88:88');
        const coldFirst = probeCold.rectCalls;
        measureDigits(probeCold, 'playfair', '88:88');
        assert.ok(
            probeCold.rectCalls > coldFirst,
            'замер незагруженного шрифта обязан делаться заново, а не оседать в кэше'
        );
    } finally {
        if (original === undefined) { delete global.document; } else { global.document = original; }
        clearProbeCache();
    }
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
