'use strict';

/**
 * Контраст текстовых токенов темы по WCAG 2.1.
 *
 * Зачем тест: палитру правят «на глаз», и полупрозрачный белый по тёмному стеклу
 * выглядит убедительно задолго до того, как становится читаемым. `--tw-fg-dim`
 * при alpha 0.42 давал 4.05:1 там, где для текста 11–12px нужно 4.5:1 — и красил
 * подписи в 13 местах панели управления. Заметить это чтением невозможно, только
 * счётом.
 *
 * КЛЮЧЕВОЙ МОМЕНТ РАСЧЁТА: полупрозрачный текст сначала смешивается с фоном
 * (alpha compositing) и только потом сравнивается с ним же. Если считать по
 * «чистому» цвету без смешивания, результат завышается в свою пользу и тест
 * становится бесполезным.
 *
 * Проверяется ТОЛЬКО тёмная тема: `[data-theme="light"]` и `[data-theme="hc-dark"]`
 * в приложении недостижимы — атрибут `data-theme` не выставляет никто, а
 * `prefers-color-scheme` в проекте не используется вовсе.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOKENS = fs.readFileSync(path.join(__dirname, '..', 'design-tokens.css'), 'utf8');

// --- WCAG 2.1 relative luminance + contrast ratio ---
function channelToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
    return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}
function contrast(fgRgb, bgRgb) {
    const a = luminance(fgRgb);
    const b = luminance(bgRgb);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function parseColor(value) {
    const v = String(value).trim();
    let m = /^#([0-9a-fA-F]{6})$/.exec(v);
    if (m) {
        const n = parseInt(m[1], 16);
        return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
    }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v);
    if (m) {
        return { rgb: [+m[1], +m[2], +m[3]], alpha: m[4] === undefined ? 1 : parseFloat(m[4]) };
    }
    throw new Error(`не разобран цвет: ${value}`);
}
// Накладывает (возможно полупрозрачный) слой на непрозрачную основу.
function composite(layer, baseRgb) {
    const { rgb, alpha } = parseColor(layer);
    return rgb.map((c, i) => Math.round(c * alpha + baseRgb[i] * (1 - alpha)));
}

// Границы блоков тем. Проверяются явно: раньше здесь стояло
// `indexOf('[data-theme="light"]')` без проверки, и после удаления светлой темы
// indexOf вернул бы −1, а slice(0, −1) — весь файл. Тест продолжил бы «работать»,
// читая токены не той темы. Любое переименование блока теперь падает сразу.
const HC_MARK = '[data-theme="hc-dark"]';
const SHARED_MARK = '/* ---------------- REDUCED MOTION ---------------- */';
assert.ok(TOKENS.includes(HC_MARK), 'блок высокого контраста не найден в design-tokens.css');
assert.ok(TOKENS.includes(SHARED_MARK), 'граница блока тем не найдена в design-tokens.css');

const DARK_BLOCK = TOKENS.slice(0, TOKENS.indexOf(HC_MARK));
const HC_BLOCK = TOKENS.slice(TOKENS.indexOf(HC_MARK), TOKENS.indexOf(SHARED_MARK));

// Достаёт значение токена из блока тёмной темы (`:root, [data-theme="dark"]`).
function darkToken(name) {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(DARK_BLOCK);
    assert.ok(m, `токен --${name} не найден в блоке тёмной темы`);
    return m[1].trim();
}

// То же для высокого контраста. Токен, который эта тема не переопределяет,
// наследуется из тёмной — так и считаем, иначе проверка врёт.
function hcToken(name) {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(HC_BLOCK);
    return m ? m[1].trim() : darkToken(name);
}

// Непрозрачные фоны, на которых реально лежит текст панели.
const BASE = parseColor(darkToken('tw-bg-dark')).rgb;
const SURFACE = composite(darkToken('tw-bg-surface'), BASE);
const GLASS = composite(darkToken('tw-bg-glass'), BASE);

// Порог 4.5:1 — обычный текст WCAG AA. Крупный (≥24px или ≥19px bold) допускает
// 3:1, но перечисленные ниже токены красят подписи 11–14px, поэтому порог полный.
const AA_NORMAL = 4.5;

const TEXT_TOKENS = [
    'tw-fg',
    'tw-fg-secondary',
    'tw-fg-muted',
    'tw-fg-dim'
];

test('текстовые токены тёмной темы проходят WCAG AA на обоих фонах', () => {
    const report = [];
    for (const token of TEXT_TOKENS) {
        const value = darkToken(token);
        for (const [bgName, bg] of [['surface', SURFACE], ['glass', GLASS]]) {
            const ratio = contrast(composite(value, bg), bg);
            report.push(`--${token} на ${bgName}: ${ratio.toFixed(2)}:1`);
            assert.ok(
                ratio >= AA_NORMAL,
                `--${token} (${value}) на --tw-bg-${bgName}: ${ratio.toFixed(2)}:1, `
                + `нужно ${AA_NORMAL}:1. Подписи этим токеном идут 11–12px — порог полный.`
            );
        }
    }
    console.log('   ' + report.join('\n   '));
});

test('высокий контраст: текстовые токены проходят AAA, а не только AA', () => {
    // Смысл темы — не «пройти порог», а дать запас. Порог AAA для обычного
    // текста 7:1. Тема стала достижимой в 2.4.0 (кнопка в титлбаре пишет
    // data-theme), до этого её контраст не проверялся вообще ни разу.
    const AAA_NORMAL = 7.0;
    const hcBase = parseColor(hcToken('tw-bg-dark')).rgb;
    const hcSurface = composite(hcToken('tw-bg-surface'), hcBase);
    const hcGlass = composite(hcToken('tw-bg-glass'), hcBase);
    const report = [];
    for (const token of TEXT_TOKENS) {
        const value = hcToken(token);
        for (const [bgName, bg] of [['surface', hcSurface], ['glass', hcGlass]]) {
            const ratio = contrast(composite(value, bg), bg);
            report.push(`--${token} на ${bgName}: ${ratio.toFixed(2)}:1`);
            assert.ok(
                ratio >= AAA_NORMAL,
                `высокий контраст: --${token} (${value}) на ${bgName} даёт `
                + `${ratio.toFixed(2)}:1, а тема обязана держать ${AAA_NORMAL}:1`
            );
        }
    }
    console.log('   [hc-dark] ' + report.join('\n   [hc-dark] '));
});

test('высокий контраст: лестница поверхностей держит AAA под белым текстом', () => {
    // Три ступени (--tw-level-*) введены, чтобы у контрастной темы появилась
    // структура: раньше окно, панели и контролы были одинаково чёрными, и тема
    // читалась как плоское поле. Ступени сплошные, поэтому проверяются напрямую.
    const AAA_NORMAL = 7.0;
    const white = hcToken('tw-fg');
    const report = [];
    for (const level of ['tw-level-1', 'tw-level-2', 'tw-level-3']) {
        const bg = parseColor(hcToken(level)).rgb;
        const ratio = contrast(composite(white, bg), bg);
        report.push(`${level}: ${ratio.toFixed(2)}:1`);
        assert.ok(
            ratio >= AAA_NORMAL,
            `--${level} (${hcToken(level)}) под белым текстом даёт ${ratio.toFixed(2)}:1, нужно ${AAA_NORMAL}:1`
        );
    }
    // Ступени обязаны РАЗЛИЧАТЬСЯ, иначе иерархии всё равно нет — ради этого всё
    // и затевалось. Порог 0.6 — заметная глазу разница яркости соседних ступеней.
    const lum = (name) => luminance(parseColor(hcToken(name)).rgb);
    const l1 = lum('tw-level-1');
    const l2 = lum('tw-level-2');
    const l3 = lum('tw-level-3');
    assert.ok(l2 / l1 >= 1.6 && l3 / l2 >= 1.6,
        `ступени слишком близки: ${l1.toFixed(4)} → ${l2.toFixed(4)} → ${l3.toFixed(4)}`);
    console.log('   [hc-dark] ' + report.join('\n   [hc-dark] '));
});

test('высокий контраст: надпись на заливке акцентом читаема', () => {
    // Кнопка старта и активный пресет заливаются акцентом. Белая надпись на
    // осветлённом зелёном даёт 1.9:1 — это была нечитаемая главная кнопка темы,
    // созданной ради читаемости. Отсюда --tw-on-accent: чёрный.
    const onAccent = hcToken('tw-on-accent');
    const report = [];
    for (const token of ['tw-green', 'tw-blue']) {
        const bg = parseColor(hcToken(token)).rgb;
        const ratio = contrast(composite(onAccent, bg), bg);
        const white = contrast(composite('#ffffff', bg), bg);
        report.push(`${onAccent} на --${token}: ${ratio.toFixed(2)}:1 (белым было бы ${white.toFixed(2)}:1)`);
        assert.ok(
            ratio >= 7.0,
            `--tw-on-accent (${onAccent}) на --${token}: ${ratio.toFixed(2)}:1, нужно 7:1`
        );
        assert.ok(
            ratio > white,
            `на --${token} белая надпись контрастнее выбранной — значит выбран не тот цвет`
        );
    }
    console.log('   [hc-dark] ' + report.join('\n   [hc-dark] '));
});

test('высокий контраст: акценты не темнее тёмной темы', () => {
    // Осветлённые акценты hc-темы обязаны быть контрастнее обычных, иначе
    // «высокий контраст» — только название.
    const hcBase = parseColor(hcToken('tw-bg-dark')).rgb;
    const hcSurface = composite(hcToken('tw-bg-surface'), hcBase);
    for (const token of ['tw-green', 'tw-red', 'tw-orange', 'tw-blue']) {
        const hcRatio = contrast(composite(hcToken(token), hcSurface), hcSurface);
        const darkRatio = contrast(composite(darkToken(token), SURFACE), SURFACE);
        assert.ok(
            hcRatio >= darkRatio,
            `--${token}: в hc-теме ${hcRatio.toFixed(2)}:1, в тёмной ${darkRatio.toFixed(2)}:1 — `
            + 'высокий контраст обязан быть не хуже обычного'
        );
        assert.ok(hcRatio >= AA_NORMAL, `--${token} в hc-теме: ${hcRatio.toFixed(2)}:1`);
    }
});

test('высокий контраст: стекло и свечение выключены', () => {
    // Размытие и неон — главные враги контраста. Тема обязана их снимать.
    for (const token of ['tw-blur', 'tw-blur-sm', 'tw-blur-xs']) {
        assert.equal(hcToken(token), 'none', `--${token} в hc-теме обязан быть none`);
    }
    for (const token of ['tw-glow-blue', 'tw-glow-green', 'tw-glow-red']) {
        assert.equal(hcToken(token), 'none', `--${token} в hc-теме обязан быть none`);
    }
});

test('светлой темы в токенах больше нет', () => {
    // Блок был недостижим (data-theme не выставлял никто) и поэтому никогда не
    // настраивался: подписи давали 2.70:1. Удалён вместе с упоминаниями.
    // По КОДУ без комментариев: шапка файла объясняет, почему тема удалена, и
    // не должна ронять тест сама по себе.
    const code = TOKENS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!code.includes('[data-theme="light"]'), 'вернулся недостижимый блок светлой темы');
    assert.ok(
        !/color-scheme:\s*light/.test(code),
        'вернулась светлая цветовая схема — её контраст никогда не проверялся'
    );
});

test('семантические цвета статусов читаемы на стекле', () => {
    // Зелёный/красный/оранжевый/жёлтый — подписи статуса и цифры таймера.
    for (const token of ['tw-green', 'tw-red', 'tw-orange', 'tw-yellow', 'tw-blue']) {
        const value = darkToken(token);
        const ratio = contrast(composite(value, GLASS), GLASS);
        assert.ok(
            ratio >= AA_NORMAL,
            `--${token} (${value}) на стекле: ${ratio.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
        );
    }
});

test('красный перерасхода читаем как крупный текст', () => {
    // #ff4444 — цифры таймера в перерасходе, они крупные (порог 3:1),
    // но проверить всё равно надо: этот цвет задан в коде, а не токеном.
    const ratio = contrast(composite('#ff4444', GLASS), GLASS);
    assert.ok(ratio >= 3.0, `#ff4444 на стекле: ${ratio.toFixed(2)}:1, нужно 3:1`);
});

test('faint используется только для заливок, но не для текста', () => {
    // --tw-fg-faint (10% белого) для текста непригоден в принципе. Тест
    // фиксирует, что им не начали красить color: иначе подпись станет невидимой.
    const control = fs.readFileSync(path.join(__dirname, '..', 'control.css'), 'utf8');
    const asColor = [...control.matchAll(/(^|[\s;{])color:\s*var\(--tw-fg-faint\)/gm)];
    assert.equal(
        asColor.length, 0,
        '--tw-fg-faint попал в color: 10% белого нечитаемы ни на каком фоне'
    );
});

// ---------------------------------------------------------------------------
// Подписи info-блоков полноэкранного дисплея во всех встроенных темах
// ---------------------------------------------------------------------------

// Восемь встроенных тем панели управления: [имя, цвет таймера, фон].
// Держится синхронно с массивом themes в electron-control.html — тест ниже
// это проверяет, чтобы список не разъехался молча.
const THEMES = [
    ['Синий', '#667eea', '#0f0c29'],
    ['Неон', '#39ff14', '#0b2b1d'],
    ['Закат', '#ff9966', '#1a0a1a'],
    ['Океан', '#36d1dc', '#0f2027'],
    ['Мята', '#3cd3ad', '#134e5e'],
    ['Лаванда', '#b993d6', '#190a33'],
    ['Солнце', '#f6d365', '#3b1d0f'],
    ['Норд', '#88c0d0', '#2e3440']
];

test('список тем в тесте совпадает с панелью управления', () => {
    const control = fs.readFileSync(path.join(__dirname, '..', 'electron-control.html'), 'utf8');
    const found = [...control.matchAll(/\{ name: '([^']+)', t1: '(#[0-9a-fA-F]{6})', t2: '#[0-9a-fA-F]{6}', bg: '(#[0-9a-fA-F]{6})' \}/g)]
        .map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(found, THEMES, 'темы в панели изменились — обнови список в тесте и перемерь контраст');
});

test('подписи info-блоков читаемы во всех темах (значение красится темой, подпись — нет)', () => {
    // Подпись .info-label идёт 12px uppercase 600 → порог 4.5:1.
    // Раньше она красилась в `${timerColor}80` и не проходила НИ В ОДНОЙ теме
    // (2.15:1 у «Синего»). Теперь тема красит только значение, а подпись берёт
    // нейтральный fallback своего стиля.
    const LABEL_FALLBACK = {
        'круг/аналог': darkToken('tw-fg-dim'),
        'флип': darkToken('tw-fg-muted')
    };

    const report = [];
    for (const [name, , themeBg] of THEMES) {
        // Фон info-блока: --tw-bg-surface поверх фона темы.
        const blockBg = composite(darkToken('tw-bg-surface'), parseColor(themeBg).rgb);
        for (const [styleName, color] of Object.entries(LABEL_FALLBACK)) {
            const r = contrast(composite(color, blockBg), blockBg);
            report.push(`${name}/${styleName}: ${r.toFixed(2)}:1`);
            assert.ok(
                r >= AA_NORMAL,
                `тема «${name}», стиль ${styleName}: подпись ${r.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
            );
        }
    }
    console.log('   ' + report.join('\n   '));
});

test('подпись LED-стиля читаема на своём тёмном фоне', () => {
    // Отдельный fallback: зелёный по --tw-bg-led. При alpha 0.55 давал 3.57:1.
    const display = fs.readFileSync(path.join(__dirname, '..', 'display.html'), 'utf8');
    const m = /body\.style-digital \.info-label \{[\s\S]*?color: var\(--info-color-dim, (rgba\([^)]+\))\)/.exec(display);
    assert.ok(m, 'не найден fallback подписи LED-стиля');

    const ledBg = composite(darkToken('tw-bg-led'), [0, 0, 0]);
    const r = contrast(composite(m[1], ledBg), ledBg);
    assert.ok(
        r >= AA_NORMAL,
        `подпись LED (${m[1]}) на --tw-bg-led: ${r.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
    );
});

test('тема красит ЗНАЧЕНИЕ info-блока, но не подпись', () => {
    // Защита от возврата: если --info-color-dim снова начнут задавать из темы,
    // подписи опять уедут ниже порога во всех темах разом.
    const script = fs.readFileSync(path.join(__dirname, '..', 'display-script.js'), 'utf8');
    const code = script.replace(/^[ \t]*\/\/.*$/gm, '');
    assert.match(code, /setProperty\('--info-color', timerColor\)/, 'значение обязано брать цвет темы');
    assert.match(
        code,
        /removeProperty\('--info-color-dim'\)/,
        'подпись обязана отдаваться нейтральному fallback — иначе контраст падает до 2.15:1'
    );
    assert.doesNotMatch(
        code,
        /setProperty\('--info-color-dim'/,
        '--info-color-dim снова красится из темы: подписи уйдут ниже WCAG AA'
    );
});

test('расчёт контраста сверен с эталонными парами WCAG', () => {
    // Защита от ошибки в самой математике: без этих опор тест мог бы уверенно
    // «проверять» палитру неверной формулой.
    assert.equal(contrast([255, 255, 255], [0, 0, 0]).toFixed(0), '21');
    assert.equal(contrast([0, 0, 0], [0, 0, 0]).toFixed(0), '1');
    // #767676 на белом — канонический порог 4.5:1 из спецификации WCAG.
    const ratio = contrast([0x76, 0x76, 0x76], [255, 255, 255]);
    assert.ok(ratio > 4.45 && ratio < 4.6, `#767676 на белом должен давать ≈4.5:1, вышло ${ratio.toFixed(2)}`);
});
