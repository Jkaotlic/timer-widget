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
 * Проверяются ОБЕ темы приложения: `dark` и `light`. Светлая — вторая тема с
 * 2.4.1; она заменила высококонтрастную и держится на тех же порогах, потому что
 * порог задаёт не название темы, а кегль подписей: 11–12px, то есть полный AA, а
 * для основных текстовых токенов — AAA.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./helpers/source-scan.js');

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
const HC_MARK = '[data-theme="light"]';
const SHARED_MARK = '/* ---------------- REDUCED MOTION ---------------- */';
assert.ok(TOKENS.includes(HC_MARK), 'блок светлой темы не найден в design-tokens.css');
assert.ok(TOKENS.includes(SHARED_MARK), 'граница блока тем не найдена в design-tokens.css');

const DARK_BLOCK = TOKENS.slice(0, TOKENS.indexOf(HC_MARK));
const HC_BLOCK = TOKENS.slice(TOKENS.indexOf(HC_MARK), TOKENS.indexOf(SHARED_MARK));

// Достаёт значение токена из блока тёмной темы (`:root, [data-theme="dark"]`).
function darkToken(name) {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(DARK_BLOCK);
    assert.ok(m, `токен --${name} не найден в блоке тёмной темы`);
    return m[1].trim();
}

// То же для светлой темы. Токен, который эта тема не переопределяет,
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

test('светлая тема: текстовые токены проходят AAA, а не только AA', () => {
    // Смысл проверки — не «пройти порог», а дать запас: порог AAA 7:1. Светлая
    // тема в этом проекте уже была и была удалена как недостижимая — её контраст
    // никогда не настраивали, подписи давали 2.70:1. Возвращена она вместе с этой
    // проверкой, чтобы история не повторилась.
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
                `светлая тема: --${token} (${value}) на ${bgName} даёт `
                + `${ratio.toFixed(2)}:1, а тема обязана держать ${AAA_NORMAL}:1`
            );
        }
    }
    console.log('   [hc-dark] ' + report.join('\n   [hc-dark] '));
});

test('светлая тема: лестница поверхностей держит AAA под основным текстом', () => {
    // Три ступени (--tw-level-*) введены, чтобы у контрастной темы появилась
    // структура: раньше окно, панели и контролы были одинаково чёрными, и тема
    // читалась как плоское поле. Ступени сплошные, поэтому проверяются напрямую.
    const AAA_NORMAL = 7.0;
    const fg = hcToken('tw-fg');
    const report = [];
    for (const level of ['tw-level-1', 'tw-level-2', 'tw-level-3']) {
        const bg = parseColor(hcToken(level)).rgb;
        const ratio = contrast(composite(fg, bg), bg);
        report.push(`${level}: ${ratio.toFixed(2)}:1`);
        assert.ok(
            ratio >= AAA_NORMAL,
            `--${level} (${hcToken(level)}) под основным текстом даёт ${ratio.toFixed(2)}:1, нужно ${AAA_NORMAL}:1`
        );
    }
    // Ступени обязаны РАЗЛИЧАТЬСЯ, иначе иерархии всё равно нет — ради этого всё
    // и затевалось. Считаем КОНТРАСТ соседних ступеней, а не отношение яркостей:
    // в тёмной теме лестница идёт вверх, в светлой вниз, и отношение яркостей
    // осмысленно только в одну сторону.
    const step = (a, b) => contrast(parseColor(hcToken(a)).rgb, parseColor(hcToken(b)).rgb);
    const s12 = step('tw-level-1', 'tw-level-2');
    const s23 = step('tw-level-2', 'tw-level-3');
    assert.ok(s12 >= 1.1 && s23 >= 1.1,
        `ступени слишком близки: 1→2 ${s12.toFixed(3)}:1, 2→3 ${s23.toFixed(3)}:1`);
    report.push(`шаг ступеней: 1→2 ${s12.toFixed(3)}:1, 2→3 ${s23.toFixed(3)}:1`);
    console.log('   [light] ' + report.join('\n   [light] '));
});

test('светлая тема: надпись на заливке акцентом читаема', () => {
    // Кнопка старта, активный пресет и кнопка подтверждения времени заливаются
    // акцентом. Акценты Apple рассчитаны на тёмный фон: на белом #30d158 даёт
    // 1.9:1, поэтому в светлой теме они затемнены, а надпись на них белая.
    const onAccent = hcToken('tw-on-accent');
    const report = [];
    for (const token of ['tw-green', 'tw-blue']) {
        const bg = parseColor(hcToken(token)).rgb;
        const ratio = contrast(composite(onAccent, bg), bg);
        const black = contrast(composite('#000000', bg), bg);
        report.push(`${onAccent} на --${token}: ${ratio.toFixed(2)}:1 (чёрным было бы ${black.toFixed(2)}:1)`);
        assert.ok(
            ratio >= 7.0,
            `--tw-on-accent (${onAccent}) на --${token}: ${ratio.toFixed(2)}:1, нужно 7:1`
        );
        assert.ok(
            ratio >= contrast(composite('#000000', bg), bg),
            `на --${token} чёрная надпись контрастнее выбранной — значит выбран не тот цвет`
        );
    }
    console.log('   [light] ' + report.join('\n   [light] '));
});

test('светлая тема: акценты пересчитаны под белый фон, а не унаследованы', () => {
    // Палитра Apple рассчитана на тёмный фон: #30d158 на белом даёт 1.9:1,
    // #ff9f0a — 2.0:1. Унаследовать их в светлой теме значило бы получить
    // нечитаемые подписи «+1 м» и невидимые точки статуса. Проверяем ОБА
    // свойства: значения свои (не равны тёмным) и проходят порог на белом.
    const lightBase = parseColor(hcToken('tw-bg-dark')).rgb;
    const lightSurface = composite(hcToken('tw-bg-surface'), lightBase);
    const report = [];
    for (const token of ['tw-green', 'tw-red', 'tw-orange', 'tw-yellow', 'tw-blue']) {
        const value = hcToken(token);
        assert.notEqual(
            value, darkToken(token),
            `--${token} в светлой теме не переопределён — унаследован тёмный акцент`
        );
        const ratio = contrast(composite(value, lightSurface), lightSurface);
        report.push(`--${token} (${value}): ${ratio.toFixed(2)}:1`);
        assert.ok(
            ratio >= AA_NORMAL,
            `--${token} (${value}) на светлой поверхности: ${ratio.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
        );
    }
    console.log('   [light] ' + report.join('\n   [light] '));
});

test('светлая тема: свечение и стекло сняты оба', () => {
    // Неоновое свечение по белому читается как грязь и режет контраст цифр.
    // Стекло раньше здесь ОСТАВАЛОСЬ — «на светлом оно уместно, но мягче».
    // Редизайн 2026-08-12 снял и его: поверхности разделяют расстояние и
    // заливка, а не размытие, и правило это общее для обеих тем.
    for (const token of ['tw-glow-blue', 'tw-glow-green', 'tw-glow-red']) {
        assert.equal(hcToken(token), 'none', `--${token} в светлой теме обязан быть none`);
    }
    for (const token of ['tw-blur', 'tw-blur-sm', 'tw-blur-xs']) {
        assert.equal(hcToken(token), 'none', `--${token} в светлой теме обязан быть none`);
    }
});

test('высококонтрастной темы в токенах больше нет', () => {
    // Тема hc-dark была второй до 2.4.1 и заменена светлой. Блока быть не должно:
    // недостижимый блок — это блок, контраст которого никто не настраивает, и
    // ровно так в этом проекте уже завелась светлая тема с подписями 2.70:1.
    const code = TOKENS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!code.includes('[data-theme="hc-dark"]'), 'остался блок высококонтрастной темы');
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

test('.font-option.active (список шрифтов) проходит порог в ОБЕИХ темах, посчитано по реальным правилам control.css', () => {
    // Регресс, найденный ревью пикселем, а не формулой: первая версия красила
    // выбранный пункт списка var(--tw-blue) поверх rgba(10,132,255,0.14) —
    // синий текст на голубоватой заливке того же тона систематически даёт
    // низкий контраст (не невезение с конкретными числами, а закономерность:
    // текст и подложка тянут luminance в одну сторону). Реальный отрисованный
    // пиксель (скриншот → canvas → getImageData, тот же метод, что здесь
    // ниже применяется к --tw-led-green и другим акцентам) дал 2.46:1 в
    // тёмной теме и 5.36:1 в светлой — при порогах 4.5:1 и 7:1 соответственно.
    //
    // Фикс красит выбранный пункт ТЕМ ЖЕ приёмом, что .tab-btn.active и
    // .segmented button.active чуть выше в этом файле: нейтральная
    // приподнятая поверхность + --tw-fg, без акцентного текста на акцентной
    // заливке. Тест читает ПРАВИЛА ИЗ control.css регуляркой (а не дублирует
    // литералы руками), чтобы правка кнопки в CSS без обновления этого теста
    // проверялась на РЕАЛЬНОМ значении, а не на переписанной вручную копии.
    const control = fs.readFileSync(path.join(__dirname, '..', 'control.css'), 'utf8');

    // Тёмная: собственное правило `.font-option.active { ... }`, НЕ внутри
    // [data-theme="light"] — оно начинается с начала строки без префикса.
    const darkRule = /^\.font-option\.active\s*\{([^}]*)\}/m.exec(control);
    assert.ok(darkRule, 'не найдено правило .font-option.active (тёмная тема)');
    const darkBg = /background:\s*([^;]+);/.exec(darkRule[1]);
    const darkFgTok = /color:\s*var\(--([a-z0-9-]+)\)/.exec(darkRule[1]);
    assert.ok(darkBg && darkFgTok, '.font-option.active: не разобраны background/color (тёмная)');

    // Реальная подложка — .font-select (--tw-level-2) поверх панели (SURFACE),
    // а поверх него сама полупрозрачная заливка активного пункта: та же
    // цепочка компоновки, что рисует браузер.
    const level2Dark = composite(darkToken('tw-level-2'), SURFACE);
    const activeDark = composite(darkBg[1].trim(), level2Dark);
    const ratioDark = contrast(composite(darkToken(darkFgTok[1]), activeDark), activeDark);
    assert.ok(
        ratioDark >= AA_NORMAL,
        `.font-option.active тёмная тема: ${ratioDark.toFixed(2)}:1, нужно ${AA_NORMAL}:1 `
        + `(фон ${darkBg[1].trim()} на --tw-level-2/SURFACE, текст --${darkFgTok[1]})`
    );
    console.log(`   .font-option.active тёмная (расчёт): ${ratioDark.toFixed(2)}:1 (нужно ${AA_NORMAL}:1)`);

    // Светлая: делит правило с .tab-btn.active / .segmented button.active —
    // ищем блок под [data-theme="light"], содержащий .font-option.active в
    // списке селекторов (до 220 символов между маркером темы и селектором
    // хватает на три строки списка селекторов из реальной разметки файла).
    const lightRule = /\[data-theme="light"\][\s\S]{0,220}?\.font-option\.active\s*\{([^}]*)\}/.exec(control);
    assert.ok(lightRule, 'не найдено правило .font-option.active под [data-theme="light"]');
    const lightBg = /background:\s*([^;]+);/.exec(lightRule[1]);
    const lightFgTok = /color:\s*var\(--([a-z0-9-]+)\)/.exec(lightRule[1]);
    assert.ok(lightBg && lightFgTok, '.font-option.active: не разобраны background/color (светлая)');

    const AAA_NORMAL = 7.0;
    // Фон светлой темы здесь — сплошной цвет (#ffffff), поэтому цепочка
    // подложек ниже не имеет значения: верхний непрозрачный слой перекрывает
    // всё. composite() с alpha=1 у сплошного цвета просто возвращает его же.
    const activeLight = composite(lightBg[1].trim(), parseColor(hcToken('tw-level-2')).rgb);
    const ratioLight = contrast(composite(hcToken(lightFgTok[1]), activeLight), activeLight);
    assert.ok(
        ratioLight >= AAA_NORMAL,
        `.font-option.active светлая тема: ${ratioLight.toFixed(2)}:1, нужно ${AAA_NORMAL}:1 `
        + `(фон ${lightBg[1].trim()}, текст --${lightFgTok[1]})`
    );
    console.log(`   .font-option.active светлая (расчёт): ${ratioLight.toFixed(2)}:1 (нужно ${AAA_NORMAL}:1)`);
});

test('.bg-mode-btn.active — предсуществующий дефект контраста, ЗАФИКСИРОВАН числом, не исправляется здесь', () => {
    // Найден тем же ревью пикселем, что и .font-option.active выше (тот же
    // паттерн: var(--tw-blue) на rgba(10,132,255,·) заливке того же тона), но
    // это код, который эта задача не трогает — кнопки режима фона существовали
    // до неё. Тест не проваливает сборку: он документирует масштаб дефекта
    // числом, чтобы следующий проход (или явное решение «чиним/не чиним») не
    // начинался с нуля. Если однажды кто-то поднимет контраст выше порога —
    // этот тест немедленно потребует поднять и здесь заявленный порог, а не
    // останется тихо устаревшим утверждением «менее X:1».
    const control = fs.readFileSync(path.join(__dirname, '..', 'control.css'), 'utf8');
    const rule = /^\.bg-mode-btn\.active\s*\{([^}]*)\}/m.exec(control);
    assert.ok(rule, 'не найдено правило .bg-mode-btn.active — если оно переименовано, замер контраста тоже надо перенести');

    const bg = /background:\s*([^;]+);/.exec(rule[1]);
    const fgTok = /color:\s*var\(--([a-z0-9-]+)\)/.exec(rule[1]);
    assert.ok(bg && fgTok, '.bg-mode-btn.active: не разобраны background/color');

    const level2Dark = composite(darkToken('tw-level-2'), SURFACE);
    const activeDark = composite(bg[1].trim(), level2Dark);
    const ratioDark = contrast(composite(darkToken(fgTok[1]), activeDark), activeDark);
    // Порог здесь НЕ WCAG (4.5), а «не стало хуже измеренного»: реальный
    // пиксель на момент ревью 2026-08-07 — 2.12:1 (скриншот → canvas →
    // getImageData, тот же метод, что и для .font-option.active выше);
    // упрощённая аналитическая цепочка подложки этого теста (SURFACE →
    // --tw-level-2 → заливка) даёт 3.37:1 — выше, чем реальный пиксель,
    // потому что настоящий фон панели в этом месте светлее, чем предполагает
    // упрощённая модель (та же разница, что и у .font-option.active: там
    // аналитика дала 10.31:1 при реальном пикселе 7.56:1). Оба числа — и
    // реальное, и расчётное — ниже порога WCAG AA (4.5:1), поэтому тест как
    // «известный дефект» отражает действительность в любом случае.
    assert.ok(
        ratioDark < AA_NORMAL,
        `.bg-mode-btn.active внезапно прошёл WCAG AA (${ratioDark.toFixed(2)}:1) — обнови комментарий, `
        + 'дефект, видимо, устранили, но не в этой задаче'
    );
    assert.ok(
        ratioDark >= 2.5,
        `.bg-mode-btn.active стал ЕЩЁ темнее: ${ratioDark.toFixed(2)}:1 — это уже регресс контраста, не только известный дефект`
    );
    console.log(`   [известный дефект, не чинится здесь] .bg-mode-btn.active тёмная: ${ratioDark.toFixed(2)}:1 (нужно ${AA_NORMAL}:1)`);
});

// ---------------------------------------------------------------------------
// Окна, не владеющие своим фоном: виджет и полноэкранный дисплей
// ---------------------------------------------------------------------------

/*
 * Эти два окна фон себе НЕ красят — его красит настройка «Фон» вкладки
 * «Полноэкранный», причём ИНЛАЙНОМ, то есть поверх любой темы, и по умолчанию
 * тёмным (#0f0c29). Поэтому оба прибивают светлую палитру назад в тёмную блоком
 * `[data-theme="light"]` внутри собственного <style>.
 *
 * Пин — перечисление, и в 2.4.1 он перечислял только ТЕКСТОВЫЕ токены. Акценты
 * приходили из design-tokens.css, где светлая тема специально затемняет их под
 * БЕЛЫЙ фон (--tw-green: #12652f), и ложились на прибитый тёмный: статус «идёт»
 * в LED-стиле давал 2.73:1 вместо 9.69:1 — на проекторе не читается вообще.
 *
 * Проверка считает КАЖДЫЙ акцент, реально используемый в файле, на КАЖДОЙ
 * подложке из его же пина. Список используемых токенов берётся из самого файла,
 * поэтому новое `var(--tw-...)` без пина роняет тест, а не тихо чернеет.
 */

// Дефолт настройки «Фон» — то, что лежит под полупрозрачными подложками пина.
const USER_BG = parseColor('#0f0c29').rgb;

// Акценты: всё, чем красятся цифры, статусы, стрелки и точки-разделители.
const ACCENT_NAMES = [
    'tw-blue', 'tw-green', 'tw-red', 'tw-orange', 'tw-yellow', 'tw-pink',
    'tw-led-green', 'tw-led-warn', 'tw-led-danger',
    // `tw-ring-warning` / `tw-ring-danger` удалены 18.08.2026 вместе с самими
    // токенами: их не читал никто, а хранили они последнюю копию литералов
    // полос. Мёртвый токен в списке проверок — это проверка, которой нечего
    // проверять.
    'tw-ring',
    // Полосы состояния. Их тут не было, и это была не мелочь: полосой красятся
    // САМЫЕ КРУПНЫЕ цифры в окне, минус перерасхода и точки разделителя, а
    // проверялись только «обычные» акценты. Замер 18.08.2026: #ff4444 на белом
    // даёт 3.41:1 — предел для крупного текста и ничего сверх; предупреждение
    // при этом было в порядке само собой (`--tw-band-warning: var(--tw-yellow)`
    // подставляется на месте использования и на светлом тоне вычисляется в
    // #7a5600). Разъехались они именно потому, что один был ссылкой, а второй —
    // литералом; проверка теперь не даёт этому повториться.
    'tw-band-warning', 'tw-band-danger'
    // `tw-band-danger-deep` здесь НЕТ намеренно: это нижний стоп градиента
    // стрелки и кольца, то есть графика (порог WCAG 3:1), а не текст. Ставить
    // ему текстовый порог значило бы требовать доказательства не того
    // утверждения.
];

// Подложки, объявленные в самом пине: SVG-круг, LED-панель, карточки блоков.
const PINNED_BACKDROPS = ['tw-bg-timer', 'tw-bg-led', 'tw-bg-surface'];

function readWindowCss(file) {
    // Комментарии снимаем до разбора: в шапке пина прозой перечислено, чего в
    // нём не хватало, и без чистки эти слова попали бы в список «использованных».
    return fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}


// Значение токена так, как его вычислит браузер В ЭТОМ окне: пин перекрывает
// design-tokens.css, непокрытое наследуется оттуда, а var(--x) внутри значения
// подставляется из ТОЙ ЖЕ области — именно поэтому --tw-led-green: var(--tw-green)
// чинится пином зелёного и отдельного пина не требует.
function makeResolver(base) {
    return function resolve(name, seen = new Set()) {
        assert.ok(!seen.has(name), `циклическая ссылка на --${name}`);
        seen.add(name);
        const value = base(name);
        return value.replace(/var\(--([a-z0-9-]+)\)/g, (_, dep) => resolve(dep, new Set(seen)));
    };
}

// Градиент проверяется по остановкам: у кольца и точек-разделителей нет одного
// «своего» цвета, а нечитаемым его делает любая из них.
function colorStops(value) {
    return value.startsWith('linear-gradient')
        ? [...value.matchAll(/#[0-9a-fA-F]{6}|rgba?\([^)]+\)/g)].map((m) => m[0])
        : [value];
}

// Три окна, чей фон принадлежит пользователю, а не теме. Палитра у них ОДНА и
// лежит в surface-tones.css — до 18.08.2026 она была тремя копиями, и одна из
// них (пин виджета) целый релиз не перечисляла ни одного акцента.
const OWNS_NO_BACKGROUND = ['electron-widget.html', 'electron-clock-widget.html', 'display.css'];
const TONES_CSS = readWindowCss('surface-tones.css');

// Токены одного ТОНА. Блок режется по селектору, а не по порядку: перепутать
// два блока местами — ровно та ошибка, на которой в этом файле уже спотыкались
// (см. шапку про срез по подстроке).
function readTone(selector) {
    const at = TONES_CSS.indexOf(selector);
    assert.ok(at !== -1, `surface-tones.css: не найден блок ${selector}`);
    const body = TONES_CSS.slice(TONES_CSS.indexOf('{', at) + 1, TONES_CSS.indexOf('\n}', at));
    const map = new Map();
    for (const decl of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
        map.set(decl[1], decl[2].trim());
    }
    assert.ok(map.size > 10, `surface-tones.css: блок ${selector} подозрительно пуст`);
    return map;
}

const DARK_TONE = readTone(':root:not(.on-light-bg)');
const LIGHT_TONE = readTone(':root.on-light-bg');
// Срез по подстроке обязан проверить сам себя: `:root.on-light-bg` встречается
// в этом файле и прозой, и один такой промах уже случился в helpers/source-scan
// (светлый токен возвращался тёмным). Две палитры, совпавшие целиком, — это не
// «одинаковые темы», а срез, уехавший на один и тот же блок.
assert.notEqual(DARK_TONE.get('tw-fg'), LIGHT_TONE.get('tw-fg'), 'срез тонов уехал на один блок');

// Какие акценты эти три окна реально используют. Список берётся ИЗ ФАЙЛОВ:
// новое var(--tw-...), которое никто не объявил в обоих тонах, обязано ронять
// тест, а не тихо приезжать из design-tokens.css в чужой палитре.
const USED_ACCENTS = ACCENT_NAMES.filter((name) =>
    OWNS_NO_BACKGROUND.some((file) => readWindowCss(file).includes(`var(--${name})`)));

test('окна без своего фона: на ТЁМНОМ тоне акценты читаемы на своих подложках', () => {
    // Непокрытое тоном наследуется из ТЁМНОЙ темы, а не из светлой. Раньше
    // здесь стоял hcToken, и это было незаметно ровно до первого токена,
    // который светлая тема переопределяет, а тёмный тон — нет: полоса
    // перерасхода (18.08.2026) поехала бы в отчёт значением светлой темы.
    const resolve = makeResolver((name) => (DARK_TONE.has(name) ? DARK_TONE.get(name) : darkToken(name)));
    const backdrops = PINNED_BACKDROPS
        .filter((name) => DARK_TONE.has(name))
        .map((name) => [name, composite(DARK_TONE.get(name), USER_BG)]);
    assert.ok(backdrops.length, 'в тёмном тоне нет ни одной подложки');
    assert.ok(USED_ACCENTS.length, 'не найдено ни одного акцента — регулярка разошлась с разметкой');

    const report = [];
    for (const token of USED_ACCENTS) {
        for (const stop of colorStops(resolve(token))) {
            for (const [bgName, bg] of backdrops) {
                const ratio = contrast(composite(stop, bg), bg);
                report.push(`тёмный тон --${token} (${stop}) на --${bgName}: ${ratio.toFixed(2)}:1`);
                assert.ok(
                    ratio >= AA_NORMAL,
                    `--${token} (${stop}) на --${bgName} даёт ${ratio.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
                );
            }
        }
    }
    console.log('   ' + report.join('\n   '));
});

test('окна без своего фона: на СВЕТЛОМ тоне акценты читаемы на белом', () => {
    // Светлый тон — не «тёмный наоборот»: акценты Apple посчитаны под тёмный
    // фон, и #30d158 на белом даёт 1.9:1. Здесь считается их затемнённый набор.
    const resolve = makeResolver((name) => (LIGHT_TONE.has(name) ? LIGHT_TONE.get(name) : hcToken(name)));
    const backdrops = PINNED_BACKDROPS
        .filter((name) => LIGHT_TONE.has(name))
        .map((name) => [name, composite(LIGHT_TONE.get(name), [255, 255, 255])]);
    assert.ok(backdrops.length, 'в светлом тоне нет ни одной подложки');

    const report = [];
    for (const token of USED_ACCENTS) {
        for (const stop of colorStops(resolve(token))) {
            for (const [bgName, bg] of backdrops) {
                const ratio = contrast(composite(stop, bg), bg);
                report.push(`светлый тон --${token} (${stop}) на --${bgName}: ${ratio.toFixed(2)}:1`);
                assert.ok(
                    ratio >= AA_NORMAL,
                    `--${token} (${stop}) на --${bgName} даёт ${ratio.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
                );
            }
        }
    }
    console.log('   ' + report.join('\n   '));
});

test('тон не изобретает третью палитру: тёмный совпадает с dark, светлый — с light', () => {
    // Контраст можно вытянуть и собственным набором цветов — и тогда одно и то
    // же состояние таймера будет разного цвета в панели и в дисплее. Инвариант
    // жёстче: тон ВЫБИРАЕТ одну из двух тем приложения, а не пишет свою.
    const dark = makeResolver(darkToken);
    const light = makeResolver(hcToken);
    const fromDarkTone = makeResolver((name) => (DARK_TONE.has(name) ? DARK_TONE.get(name) : darkToken(name)));
    const fromLightTone = makeResolver((name) => (LIGHT_TONE.has(name) ? LIGHT_TONE.get(name) : hcToken(name)));
    for (const token of USED_ACCENTS) {
        assert.equal(fromDarkTone(token), dark(token), `--${token}: тёмный тон разошёлся с тёмной темой`);
        assert.equal(fromLightTone(token), light(token), `--${token}: светлый тон разошёлся со светлой темой`);
    }
});

test('текстовые токены светлого тона держат AAA на белом', () => {
    // Тот же счёт, что и для светлой темы панели: тон обязан быть не просто
    // «другим», а измеренно читаемым. Раньше эта проверка смотрела в display.css
    // — единственное окно, у которого светлая палитра тогда была.
    const report = [];
    for (const token of TEXT_TOKENS) {
        assert.ok(LIGHT_TONE.has(token), `--${token} не объявлен для светлого тона`);
        const value = LIGHT_TONE.get(token);
        const ratio = contrast(composite(value, [255, 255, 255]), [255, 255, 255]);
        report.push(`--${token} (${value}): ${ratio.toFixed(2)}:1`);
        assert.ok(ratio >= AA_NORMAL, `светлый тон: --${token} (${value}) на белом даёт ${ratio.toFixed(2)}:1`);
    }
    console.log('   [светлый тон] ' + report.join('\n   [светлый тон] '));
});

test('каждое из трёх окон подключает surface-tones.css', () => {
    // Гейт считает ОКНА, а не совпадения: файл, потерявший ссылку, тихо
    // получил бы палитру панели — светлый текст на светлом или наоборот.
    for (const file of ['electron-widget.html', 'electron-clock-widget.html', 'display.html']) {
        const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(html, /<link rel="stylesheet" href="surface-tones\.css">/, `${file}: нет surface-tones.css`);
    }
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
    // Сетки свотчей уехали из inline-скрипта панели в theme-grid.js: страж
    // control-decomposition сработал на объёме кода внутри HTML.
    const control = fs.readFileSync(path.join(__dirname, '..', 'theme-grid.js'), 'utf8');
    const found = [...control.matchAll(/\{ name: '([^']+)', t1: '(#[0-9a-fA-F]{6})', t2: '#[0-9a-fA-F]{6}', bg: '(#[0-9a-fA-F]{6})' \}/g)]
        .map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(found, THEMES, 'темы в панели изменились — обнови список в тесте и перемерь контраст');
});

// Холст полноэкранного окна — то, НА ЧЁМ теперь лежат подписи блоков.
//
// С 19.08.2026 плиты под блоком нет ни в одном стиле (просьба «убрать заднюю
// рамку у функциональных блоков»), поэтому подпись стоит прямо на фоне окна.
// До этого модель считала контраст к --tw-bg-timer (круг/флип/аналог) и к
// --tw-bg-led («Цифры») — поверхностям, которых больше не существует. Такой
// тест зеленеет всегда: он меряет то, чего нет.
//
// Режим «По теме» — умолчание чистого профиля, его стопы зашиты в
// applyBackground(); режим «Градиент» даёт фон выбранной темы панели. Берём
// СВЕТЛЕЙШИЙ стоп каждого фона: подпись светлая, и худший случай для неё —
// самое светлое место холста.
const DISPLAY_CANVAS_DARK = ['#0f0c29', '#302b63'];
const DISPLAY_CANVAS_LIGHT = ['#ffffff', '#ececf3'];

test('стопы холста дисплея в тесте совпадают с applyBackground()', () => {
    // Пин — предсказание, и считать его надо по подтверждающей стороне: если
    // стопы в display-script поменяются, модель обязана упасть, а не тихо
    // мерить прошлогодний фон.
    const code = fs.readFileSync(path.join(__dirname, '..', 'display-script.js'), 'utf8');
    for (const stop of [...DISPLAY_CANVAS_DARK, ...DISPLAY_CANVAS_LIGHT]) {
        assert.ok(
            code.includes(stop),
            `стоп ${stop} исчез из display-script.js — холст дисплея изменился, перемерь контраст подписей`
        );
    }
});

test('подписи info-блоков читаемы во всех темах (значение красится темой, подпись — нет)', () => {
    // Подпись .info-label идёт clamp(13…18)px uppercase 600 → порог 4.5:1.
    // Раньше она красилась в `${timerColor}80` и не проходила НИ В ОДНОЙ теме
    // (2.15:1 у «Синего»). Теперь тема красит только значение, а подпись берёт
    // нейтральный fallback своего стиля.
    // Тон один на все четыре стиля: --tw-fg-secondary. Прежде их было два —
    // --tw-fg-dim в базе (им не красился ни один стиль) и --tw-fg-muted у трёх
    // стилей; на самом светлом встроенном фоне («Мята») они давали 3,43:1 и
    // 4,27:1. Плита, которая раньше их вытягивала, снята.
    const LABEL_FALLBACK = {
        'все стили (--tw-fg-secondary)': darkToken('tw-fg-secondary')
    };

    // Проверка проверки: модель обязана читать ТУ ЖЕ краску, что и правило.
    const displayCss = fs.readFileSync(path.join(__dirname, '..', 'display.css'), 'utf8');
    assert.match(
        displayCss,
        /\.info-label \{[\s\S]*?color: var\(--info-color-dim, var\(--tw-fg-secondary\)\)/,
        'базовая подпись блока красится не --tw-fg-secondary — перемерь контраст'
    );

    // Холсты: фон каждой встроенной темы плюс оба стопа режима «По теме».
    const CANVASES = THEMES.map(([name, , themeBg]) => [name, parseColor(themeBg).rgb])
        .concat(DISPLAY_CANVAS_DARK.map((c) => [`по теме ${c}`, parseColor(c).rgb]));

    const report = [];
    for (const [name, canvas] of CANVASES) {
        for (const [styleName, color] of Object.entries(LABEL_FALLBACK)) {
            const r = contrast(composite(color, canvas), canvas);
            report.push(`${name}/${styleName}: ${r.toFixed(2)}:1`);
            assert.ok(
                r >= AA_NORMAL,
                `фон «${name}», подпись ${styleName}: ${r.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
            );
        }
    }
    console.log('   ' + report.join('\n   '));
});

test('подпись стиля «Цифры» читаема на холсте дисплея в ОБОИХ тонах', () => {
    // Отдельный fallback: зелёный цвет табло. При alpha 0.55 давал 3.57:1 ещё
    // на тёмной карточке блока; карточки больше нет, и считать надо к ФОНУ
    // ОКНА — он светлее, то есть требование строже.
    // Литерал стал токеном --style-led-label, потому что на светлой панели
    // #30d158 при любой альфе нечитаем — и считать теперь надо оба тона.
    const display = fs.readFileSync(path.join(__dirname, '..', 'display.css'), 'utf8');
    assert.match(
        display,
        /body\.style-digits \.info-label \{[\s\S]*?color: var\(--info-color-dim, var\(--style-led-label\)\)/,
        'подпись «Цифр» перестала читать --style-led-label'
    );

    const report = [];
    const cases = [
        ['тёмный', DARK_TONE, DISPLAY_CANVAS_DARK.concat(THEMES.map(([, , bg]) => bg))],
        ['светлый', LIGHT_TONE, DISPLAY_CANVAS_LIGHT]
    ];
    for (const [name, tone, canvases] of cases) {
        const label = tone.get('style-led-label');
        assert.ok(label, `${name} тон: нет --style-led-label`);
        for (const canvas of canvases) {
            const bg = parseColor(canvas).rgb;
            const r = contrast(composite(label, bg), bg);
            report.push(`${name}/${canvas}: ${r.toFixed(2)}:1`);
            assert.ok(
                r >= AA_NORMAL,
                `${name} тон: подпись «Цифр» (${label}) на ${canvas} даёт ${r.toFixed(2)}:1, нужно ${AA_NORMAL}:1`
            );
        }
    }
    console.log('   ' + report.join('\n   '));
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

/* ============================================================
   ЦВЕТА, ВПИСАННЫЕ В КОМПОНЕНТНЫЙ ФАЙЛ ЛИТЕРАЛОМ

   До 11.08.2026 этот тест читал ТОЛЬКО design-tokens.css и сверял токены
   между собой. Цвет, вписанный литералом в control.css, был для него
   невидим — и ровно так прошли мимо два дефекта светлой темы, найденные
   осмотром 64 кадров:

     фон пункта списка   #1d1d1f на #1c1c1e  =  1.01:1
     индикатор окна      #12652f на #0053ae  =  1.03:1

   Первый — литерал в фоне при токене в тексте. Второй — ЧЕСТНЫЙ токен,
   но упавший на фон из другой роли. Отсюда правило: проверять ПАРУ
   «цвет × фон, на котором он окажется», а не токен сам по себе.
   ============================================================ */

test('фон выпадающего списка не задан литералом и читаем в обеих темах', () => {
    const control = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'control.css'), 'utf8'));
    assert.ok(
        !/#1c1c1e/i.test(control),
        'литерал #1c1c1e вернулся в control.css: в светлой теме он даёт 1.01:1 под --tw-fg'
    );

    // Порог AAA: список читают так же, как подписи, и кегль там тот же 12–13px.
    const AAA_NORMAL = 7.0;
    for (const [themeName, token] of [['тёмная', darkToken], ['светлая', hcToken]]) {
        const bg = parseColor(token('tw-bg-surface-solid')).rgb;
        const ratio = contrast(composite(token('tw-fg'), bg), bg);
        assert.ok(
            ratio >= AAA_NORMAL,
            `${themeName}: текст пункта списка на --tw-bg-surface-solid даёт `
            + `${ratio.toFixed(2)}:1, нужно ${AAA_NORMAL}:1`
        );
        console.log(`   [option/${themeName}] ${ratio.toFixed(2)}:1`);
    }
});

test('индикатор открытого окна виден в обеих темах', () => {
    // Точка «окно открыто» брала --tw-green и лежала на заливке --tw-blue.
    // Оба токена в СВЕТЛОЙ теме тёмные — светлые акценты Apple на белом не
    // читаются, поэтому у светлой темы свои, затемнённые, — и точка на
    // заливке давала 1.03:1. Индикатора просто не было.
    // Порог 3:1 — нетекстовая графика по WCAG 1.4.11.
    const NON_TEXT = 3.0;
    for (const [themeName, token] of [['тёмная', darkToken], ['светлая', hcToken]]) {
        // Фон кнопки строится ПОСЛОЙНО, а не берётся из токена ступени
        // напрямую: в тёмной теме --tw-level-2 это плёнка
        // rgba(255,255,255,0.075), и сравнение с ней как с непрозрачным
        // цветом занижает результат втрое (2.02:1 вместо настоящего). В
        // светлой ступени сплошные, и наложение — пустая операция.
        const base = parseColor(token('tw-bg-dark')).rgb;
        const surface = composite(token('tw-bg-surface'), base);
        const bg = composite(token('tw-level-2'), surface);
        const ratio = contrast(composite(token('tw-green'), bg), bg);
        assert.ok(
            ratio >= NON_TEXT,
            `${themeName}: точка --tw-green на --tw-level-2 даёт ${ratio.toFixed(2)}:1, нужно ${NON_TEXT}:1`
        );
        console.log(`   [индикатор/${themeName}] ${ratio.toFixed(2)}:1`);
    }

    // Встречная проверка: заливка активной кнопки акцентом не должна
    // вернуться — именно она делала точку невидимой. Проверяется ОТСУТСТВИЕ
    // старого поведения, а не только наличие нового: иначе регрессия
    // проскользнёт молча.
    const control = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'control.css'), 'utf8'));
    const lightActive = /\[data-theme="light"\]\s*\.quick-window-btn\.active\s*\{[^}]*\}/.exec(control);
    if (lightActive) {
        assert.ok(
            !/background:\s*var\(--tw-blue\)/.test(lightActive[0]),
            'активная кнопка окна снова заливается --tw-blue: точка --tw-green на ней даёт 1.03:1'
        );
    }
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

