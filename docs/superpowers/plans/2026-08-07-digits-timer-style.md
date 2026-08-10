# Пятый стиль таймера «Цифры» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить пятый стиль таймера `digits` — только крупные цифры, без кольца, подложки и свечения — в виджет, часы и полноэкранный дисплей, с выбором шрифта из шести локальных семейств отдельно для каждого окна.

**Architecture:** Общий модуль `digits-style.js` владеет реестром шрифтов, белым списком `resolveFont()` и арифметикой подгонки размера; три окна получают по блоку разметки, по десятку правил CSS и по ветке в `switch` своего `setTimerStyle`. Размер цифр подбирается по замеру ЭТАЛОННОЙ строки (`88:88` / `8:88:88`) на базовом кегле 100px — не по живому тексту и не по константе ширины символа. Ни одного нового IPC-канала: значения едут полями в трёх уже существующих пакетах.

**Tech Stack:** Electron, ванильный JS без сборщика (кросс-модульные ссылки через `window.X`), `node --test`, Playwright, `@fontsource/*` для шрифтов.

## Global Constraints

- **Слой 2 (UI).** TDD обязателен на логику (модуль, схемы настроек), не обязателен на вёрстку. Проверка вёрстки — замером в e2e, не глазом.
- **Никакого сборщика.** Каждый файл — классический `<script>`; ссылки между модулями только через `window.X`. Голое имя ломает линтер.
- **Каждый новый JS-файл обязан попасть в `package.json` → `build.files`**, иначе он молча исчезает из собранного приложения. Глоб `fonts/**/*` там уже есть — новые woff2 добавлять в список не нужно.
- **Никаких новых IPC-каналов.** `preload.js` и `channel-validator.js` не трогаются.
- **Никогда не запускать `perl -pi` по файлам проекта** — они UTF-8 с кириллицей, Perl читает байты как latin-1 и превращает весь файл в мойибаке. Только Edit или Python с явным `encoding='utf-8'`.
- **Стиль кода:** 2 пробела, одинарные кавычки, camelCase, UPPER_CASE для констант; ESLint 9 требует `eqeqeq: always` и `curly: always`.
- **Значения идентификатора стиля:** `'digits'` в коде, «Цифры» в интерфейсе.
- **Идентификатор шрифта по умолчанию:** `'inter'`.
- **Знак минуса:** `font-size: 0.62em`, `margin-right: 0.1em`, `position: absolute; right: 100%; top: 50%; transform: translateY(-50%)`, ширины в потоке не занимает.
- **Цвета перерасхода:** `#ff4444` для круга/цифр, `#ffc107` для warning в круге, `#ffcc00` для warning в LED. Оранжевый в перерасходе запрещён во всех окнах.
- **Ветка сброса инлайнового цвета — только `|| ''`,** никогда `else if (this._baseTimerColor)`: на чистом профиле базового цвета нет, и красный не снимется.
- **Проверка перед словом «готово»:** `npm run ci` и `npx playwright test` с показанным выводом. «Посмотрел код» доказательством не является.

---

## Структура файлов

| Файл | Ответственность | Задача |
| --- | --- | --- |
| `digits-style.js` | **создать** — реестр шрифтов, `resolveFont`, `fitScale`, `fitFontSize`, замер эталона с кэшем, `applyFont` | 1 |
| `tests/digits-style.test.js` | **создать** — белый список, реестр против `fonts/` и `fonts.css`, арифметика | 1 |
| `fonts/*.woff2` | **добавить 4 файла** | 1 |
| `fonts.css` | **дополнить** — 4 объявления `@font-face` | 1 |
| `scripts/generate-notice.js` | **дополнить** — секция «Bundled fonts» из реестра | 2 |
| `tests/release-gates.test.js` | **править** — счётчик объявлений `@font-face` | 2 |
| `e2e/display-timer-scale.spec.js` | **создать** — характеризация масштаба дисплея | 3 |
| `display-script.js` | **править** — `applyTimerScale()`, ветка `digits`, отрисовка, цвета | 3, 4 |
| `display.html` | **править** — блок разметки, CSS, пин токенов светлой темы | 4 |
| `electron-widget.html` | **править** — то же для виджета | 5 |
| `electron-clock-widget.html` | **править** — то же для часов + белый список стилей | 6 |
| `electron-control.html` | **править** — пятая кнопка ×3, контрол выбора шрифта, проводка, видимость строки | 4, 5, 6, 7 |
| `control.css` | **править** — стили списка шрифтов | 7 |
| `settings-schema.js` | **править** — три строки таблицы | 7 |
| `clock-settings-schema.js` | **править** — поле `kind`, строка `clockDigitsFont` | 7 |
| `e2e/digits-style.spec.js` | **создать** — достижимость кликом, шрифт, масштаб, центрирование | 4–7 |
| `scripts/screenshot-runner.js`, `scripts/visual-audit.js` | **править** — список стилей | 8 |

---

### Task 1: Модуль `digits-style.js` и его шрифты

**Files:**
- Create: `fonts/bebas-neue-latin-400-normal.woff2`, `fonts/oswald-latin-500-normal.woff2`, `fonts/orbitron-latin-700-normal.woff2`, `fonts/playfair-display-latin-600-normal.woff2`
- Create: `digits-style.js`
- Modify: `fonts.css`
- Test: `tests/digits-style.test.js`
- Modify: `package.json` (`build.files`)

**Interfaces:**
- Consumes: ничего.
- Produces: `window.DigitsStyle` / `module.exports` со свойствами
  `DIGIT_FONTS` (массив), `DEFAULT_FONT_ID` (`'inter'`),
  `PROBE_FONT_SIZE` (`100`), `PROBE_MINUTES` (`'88:88'`), `PROBE_HOURS` (`'8:88:88'`),
  `resolveFont(id) → {id,label,family,weight,files,license,copyright}`,
  `fitScale({availableWidth, availableHeight, probeWidth, probeHeight, signWidth}) → number`,
  `fitFontSize(opts) → number`,
  `measureDigits(probeEl, fontId, hasHours) → {width, height, signWidth} | null`,
  `clearProbeCache() → void`,
  `applyFont(el, fontId) → font`.

- [ ] **Step 1: Скачать пакеты во временный каталог**

Скачиваем в scratchpad, а не в `node_modules`: шрифты нужны файлами, зависимостью приложения они не становятся.

```bash
SCRATCH="$(mktemp -d)"
cd "$SCRATCH"
npm pack @fontsource/bebas-neue@5.3.0 @fontsource/oswald@5.3.0 \
         @fontsource/orbitron@5.3.0 @fontsource/playfair-display@5.3.0
for f in *.tgz; do tar -xzf "$f"; mv package "${f%.tgz}"; done
ls */files/*latin-4*.woff2 */files/*latin-5*.woff2 */files/*latin-6*.woff2 */files/*latin-7*.woff2
echo "$SCRATCH"
```

- [ ] **Step 2: Проверить, что нужные веса есть, и скопировать**

Если веса из реестра в пакете нет — взять ближайший имеющийся и **поправить `weight` и `files` в `DIGIT_FONTS`**, а не подставлять несуществующий файл.

```bash
cd /Users/user/timer-widget
cp "$SCRATCH/fontsource-bebas-neue-5.3.0/files/bebas-neue-latin-400-normal.woff2"            fonts/
cp "$SCRATCH/fontsource-oswald-5.3.0/files/oswald-latin-500-normal.woff2"                    fonts/
cp "$SCRATCH/fontsource-orbitron-5.3.0/files/orbitron-latin-700-normal.woff2"                fonts/
cp "$SCRATCH/fontsource-playfair-display-5.3.0/files/playfair-display-latin-600-normal.woff2" fonts/
ls -la fonts/ | tail -5
```

- [ ] **Step 3: Объявить шрифты в `fonts.css`**

Дописать в конец `fonts.css` (кириллических подмножеств нет намеренно — стиль печатает только цифры, `:` и `−`):

```css

/* Шрифты стиля «Цифры». Только latin: стиль печатает цифры, двоеточие и минус.
   Реестр, который решает, какой файл какому идентификатору принадлежит, лежит
   в digits-style.js — там же лицензии для NOTICE. */
@font-face { font-family: 'Bebas Neue'; font-weight: 400; font-style: normal; font-display: swap; src: url('fonts/bebas-neue-latin-400-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Oswald'; font-weight: 500; font-style: normal; font-display: swap; src: url('fonts/oswald-latin-500-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Orbitron'; font-weight: 700; font-style: normal; font-display: swap; src: url('fonts/orbitron-latin-700-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Playfair Display'; font-weight: 600; font-style: normal; font-display: swap; src: url('fonts/playfair-display-latin-600-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
```

- [ ] **Step 4: Написать падающий тест**

Создать `tests/digits-style.test.js`:

```js
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
```

- [ ] **Step 5: Прогнать тест и убедиться, что он падает**

Run: `node --test tests/digits-style.test.js`
Expected: FAIL — `Cannot find module '../digits-style'`

- [ ] **Step 6: Написать модуль**

Создать `digits-style.js`:

```js
'use strict';

/**
 * digits-style.js — стиль таймера «Цифры»: реестр шрифтов, белый список и
 * арифметика подгонки размера.
 *
 * Зачем модуль. Стиль живёт в ТРЁХ окнах, и без общего владельца реестр из
 * шести шрифтов и замер эталона существовали бы в трёх копиях. В этом проекте
 * так уже было: window-geometry.js до извлечения был двумя дословными клонами,
 * различавшимися четырьмя значениями.
 *
 * Почему размер считается по ЭТАЛОНУ, а не по живому тексту. Существующий
 * updateScaling() в виджете подбирает кегль по формуле `charCount * 0.6`, то
 * есть предполагает моноширинный шрифт. Для Bebas Neue фактическое отношение
 * ~0.42, для Orbitron ~0.78: узкий шрифт рисовался бы заметно мельче доступного
 * места, широкий вылезал бы за край. Мерить надо, а не угадывать — но мерить
 * живой текст нельзя: цифры не у всех шести шрифтов одинаковой ширины, и кегль
 * пересчитывался бы каждую секунду, то есть цифры бы «дышали». Поэтому меряется
 * эталон «88:88» / «8:88:88» — один раз на пару (шрифт, формат), с кэшем.
 *
 * Двойной экспорт, как в window-geometry.js / renderer-shared.js:
 *   - Node (тесты):     module.exports
 *   - Браузер (окна):   window.DigitsStyle
 */

// ---------------------------------------------------------------------------
// Реестр
// ---------------------------------------------------------------------------
/**
 * Поля строки:
 *   id        — значение настройки, оно же ключ белого списка;
 *   label     — подпись в списке панели;
 *   family    — значение для CSS font-family, с запасным семейством;
 *   weight    — начертание, подобранное под крупные цифры;
 *   files     — имена woff2 в fonts/; по ним тест сверяет реестр с диском и с
 *               fonts.css, а генератор NOTICE понимает, что шрифт встроен;
 *   license,
 *   copyright — атрибуция. OFL требует прикладывать и то и другое, а
 *               scripts/generate-notice.js обходит node_modules и шрифтов,
 *               лежащих файлами, не видит.
 */
const DIGIT_FONTS = [
    {
        id: 'inter',
        label: 'Inter',
        family: "'Inter', -apple-system, sans-serif",
        weight: 300,
        files: ['inter-latin-300-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright (c) 2016 The Inter Project Authors'
    },
    {
        id: 'mono',
        label: 'JetBrains Mono',
        family: "'JetBrains Mono', 'SF Mono', monospace",
        weight: 400,
        files: ['jetbrains-mono-latin-400-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright (c) 2020 The JetBrains Mono Project Authors'
    },
    {
        id: 'bebas',
        label: 'Bebas Neue',
        family: "'Bebas Neue', Impact, sans-serif",
        weight: 400,
        files: ['bebas-neue-latin-400-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright (c) 2010 The Bebas Neue Project Authors'
    },
    {
        id: 'oswald',
        label: 'Oswald',
        family: "'Oswald', 'Arial Narrow', sans-serif",
        weight: 500,
        files: ['oswald-latin-500-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright (c) 2016 The Oswald Project Authors'
    },
    {
        id: 'orbitron',
        label: 'Orbitron',
        family: "'Orbitron', 'JetBrains Mono', monospace",
        weight: 700,
        files: ['orbitron-latin-700-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright (c) 2009 The Orbitron Project Authors'
    },
    {
        id: 'playfair',
        label: 'Playfair Display',
        family: "'Playfair Display', Georgia, serif",
        weight: 600,
        files: ['playfair-display-latin-600-normal.woff2'],
        license: 'SIL Open Font License 1.1',
        copyright: 'Copyright (c) 2017 The Playfair Display Project Authors'
    }
];

const DEFAULT_FONT_ID = 'inter';

// Базовый кегль замера. Кегль отрисовки = PROBE_FONT_SIZE * fitScale(...).
const PROBE_FONT_SIZE = 100;

// Эталоны. Восьмёрка, а не ноль: у пропорциональных шрифтов ноль не всегда
// самый широкий знак, а восьмёрка в цифровых начертаниях — почти всегда.
const PROBE_MINUTES = '88:88';
const PROBE_HOURS = '8:88:88';
const PROBE_SIGN = '−';

// Знак меньше цифр и отделён отступом — те же значения стоят в CSS всех трёх
// окон. Держим их здесь, потому что запас под знак считает эта арифметика.
const SIGN_FONT_RATIO = 0.62;
const SIGN_GAP_EM = 0.1;

// ---------------------------------------------------------------------------
// Белый список
// ---------------------------------------------------------------------------
/**
 * Строка реестра по идентификатору; неизвестное значение откатывается к
 * умолчанию.
 *
 * Значение приходит ДВУМЯ путями и оба без проверки: из localStorage при старте
 * и по IPC от панели. Дальше оно попадает прямо в style.fontFamily. У часов
 * такой же белый список уже стоит на стиле, и в комментарии рядом описано, чем
 * кончалось его отсутствие.
 */
function resolveFont(id) {
    if (typeof id === 'string') {
        const hit = DIGIT_FONTS.find((font) => font.id === id);
        if (hit) { return hit; }
    }
    return DIGIT_FONTS.find((font) => font.id === DEFAULT_FONT_ID);
}

// ---------------------------------------------------------------------------
// Арифметика подгонки
// ---------------------------------------------------------------------------
/**
 * Во сколько раз замеренный эталон нужно увеличить, чтобы он уложился в
 * доступный прямоугольник.
 *
 * `signWidth` вычитается из доступной ширины: знак минуса вынесен из потока
 * (`position: absolute; right: 100%`) и в ширину блока цифр не входит, но за
 * край окна вылезти может. Существующий код решает это грубее — прибавляет
 * один символ к длине строки.
 *
 * Мусор на входе даёт 0, а не Infinity и не NaN: и то и другое, попав в
 * font-size, схлопывает цифры до невидимых.
 */
function fitScale(options) {
    const opts = options || {};
    const availableWidth = Number(opts.availableWidth);
    const availableHeight = Number(opts.availableHeight);
    const probeWidth = Number(opts.probeWidth);
    const probeHeight = Number(opts.probeHeight);
    const signWidth = Number(opts.signWidth) || 0;

    if (!(availableWidth > 0) || !(availableHeight > 0)) { return 0; }
    if (!(probeWidth > 0) || !(probeHeight > 0)) { return 0; }

    const byWidth = availableWidth / (probeWidth + Math.max(0, signWidth));
    const byHeight = availableHeight / probeHeight;
    const scale = Math.min(byWidth, byHeight);
    return Number.isFinite(scale) && scale > 0 ? scale : 0;
}

/** Кегль отрисовки в пикселях. */
function fitFontSize(options) {
    return PROBE_FONT_SIZE * fitScale(options);
}

// ---------------------------------------------------------------------------
// Замер (DOM)
// ---------------------------------------------------------------------------
// Кэш живёт на модуль, а модуль — на окно: у каждого рендерера свой realm.
const probeCache = new Map();

/** Сбросить кэш замеров. Зовётся после document.fonts.ready и из тестов. */
function clearProbeCache() {
    probeCache.clear();
}

/**
 * Размеры эталона для пары (шрифт, формат) на базовом кегле.
 *
 * ВАЖНО: звать только после `document.fonts.ready`. С `font-display: swap`
 * замер до загрузки woff2 меряет запасное начертание и кэширует чужие цифры.
 * В этом проекте такая ошибка уже стоила фантомной регрессии 2.43% в
 * визуальной сверке.
 *
 * @param {HTMLElement} probeEl — скрытый span, живущий в том же окне
 * @param {string} fontId
 * @param {boolean} hasHours
 * @returns {{width: number, height: number, signWidth: number}|null}
 */
function measureDigits(probeEl, fontId, hasHours) {
    const font = resolveFont(fontId);
    const key = font.id + '|' + (hasHours ? 'h' : 'm');
    const cached = probeCache.get(key);
    if (cached) { return cached; }

    if (!probeEl || typeof probeEl.getBoundingClientRect !== 'function') { return null; }

    probeEl.style.fontFamily = font.family;
    probeEl.style.fontWeight = String(font.weight);
    probeEl.style.fontSize = PROBE_FONT_SIZE + 'px';

    probeEl.textContent = hasHours ? PROBE_HOURS : PROBE_MINUTES;
    const digitsRect = probeEl.getBoundingClientRect();

    probeEl.textContent = PROBE_SIGN;
    const signRect = probeEl.getBoundingClientRect();

    probeEl.textContent = '';

    const measured = {
        width: digitsRect.width,
        height: digitsRect.height,
        signWidth: signRect.width * SIGN_FONT_RATIO + PROBE_FONT_SIZE * SIGN_GAP_EM
    };

    // Нулевой замер не кэшируем: окно могло быть ещё не разложено.
    if (measured.width > 0 && measured.height > 0) { probeCache.set(key, measured); }
    return measured;
}

/**
 * Проставить элементу семейство и начертание выбранного шрифта.
 * Возвращает применённую строку реестра — вызывающему она нужна для эталона.
 */
function applyFont(el, fontId) {
    const font = resolveFont(fontId);
    if (el && el.style) {
        el.style.fontFamily = font.family;
        el.style.fontWeight = String(font.weight);
    }
    return font;
}

const DigitsStyle = {
    DIGIT_FONTS,
    DEFAULT_FONT_ID,
    PROBE_FONT_SIZE,
    PROBE_MINUTES,
    PROBE_HOURS,
    PROBE_SIGN,
    SIGN_FONT_RATIO,
    SIGN_GAP_EM,
    resolveFont,
    fitScale,
    fitFontSize,
    measureDigits,
    clearProbeCache,
    applyFont
};

// Node.js (тесты)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DigitsStyle;
}

// Браузер (все три окна и панель)
if (typeof window !== 'undefined') {
    window.DigitsStyle = DigitsStyle;
}
```

- [ ] **Step 7: Прогнать тест — теперь он обязан пройти ЦЕЛИКОМ**

Run: `node --test tests/digits-style.test.js`
Expected: PASS, все проверки. Шрифты уже на диске и объявлены (шаги 1–3), поэтому сверка реестра с `fonts/` и с `fonts.css` проходит здесь же. Красным эта задача не коммитится.

- [ ] **Step 8: Добавить модуль в `build.files`**

В `package.json`, в массив `build.files`, сразу после строки `"window-geometry.js",` добавить:

```json
    "digits-style.js",
```

- [ ] **Step 9: Прогнать тест упаковки**

Run: `node --test tests/packaging.test.js`
Expected: PASS

- [ ] **Step 10: Линтер**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 11: Коммит**

```bash
git add fonts/ fonts.css digits-style.js tests/digits-style.test.js package.json
git commit -m "feat(digits): модуль стиля «Цифры» и четыре шрифта к нему"
```

---

### Task 2: Атрибуция шрифтов и релизные гейты

**Files:**

**Interfaces:**
- Consumes: `DIGIT_FONTS` из Task 1 (поля `files`, `label`, `license`, `copyright`) и объявления `@font-face`, добавленные там же.
- Produces: секцию «Bundled fonts» в `NOTICE` и поднятый счётчик объявлений в релизных гейтах.

- [ ] **Step 1: Поправить счётчик `@font-face` в релизных гейтах**

Найти проверку количества объявлений:

Run: `grep -n "font-face" tests/release-gates.test.js`

Ожидаемое число объявлений было 20, стало 24. Поднять нижнюю границу в проверке до 24 и обновить комментарий рядом, чтобы он объяснял, откуда взялись четыре новых.

- [ ] **Step 2: Прогнать релизные гейты**

Run: `node --test tests/release-gates.test.js`
Expected: PASS. Если падает проверка «каждый font src начинается с `fonts/`» — значит в объявлении опечатка в пути, а не проблема теста.

- [ ] **Step 3: Дописать секцию шрифтов в генератор NOTICE**

В `scripts/generate-notice.js`, перед записью файла, добавить секцию из реестра — второго списка шрифтов не заводим:

```js
// Встроенные шрифты. generate-notice обходит node_modules, а шрифты лежат
// в fonts/ файлами и зависимостями не являются — то есть до этой секции
// Inter и JetBrains Mono не были атрибутированы вообще. OFL требует
// прикладывать копирайт и текст лицензии. Реестр один: digits-style.js.
const { DIGIT_FONTS } = require('../digits-style');

const fontsSection = [
    '',
    '='.repeat(80),
    '',
    'BUNDLED FONTS',
    '',
    'The following fonts are embedded in fonts/ and are not npm dependencies.',
    ''
].concat(DIGIT_FONTS.map((font) => [
    `=== ${font.label} ===`,
    `License: ${font.license}`,
    font.copyright,
    `Files: ${font.files.join(', ')}`,
    ''
].join('\n'))).join('\n');
```

и дописать `fontsSection` в содержимое, которое пишется в `OUT`.

- [ ] **Step 4: Перегенерировать NOTICE и проверить глазами, что секция на месте**

```bash
node scripts/generate-notice.js
grep -n -A 8 "BUNDLED FONTS" NOTICE
```
Expected: секция с шестью шрифтами, у каждого лицензия, копирайт и файлы

- [ ] **Step 5: Полный прогон**

Run: `npm run ci`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add scripts/generate-notice.js tests/release-gates.test.js NOTICE
git commit -m "docs(fonts): атрибуция встроенных шрифтов в NOTICE и счётчик в релизных гейтах"
```

---

### Task 3: Характеризация масштаба дисплея и `applyTimerScale()`

**Files:**
- Create: `e2e/display-timer-scale.spec.js`
- Modify: `display-script.js` (строки ~537–540, ~1620–1623, ~1817–1820, метод `updateRingSize` ~203)

**Interfaces:**
- Consumes: ничего.
- Produces: метод `DisplayTimer.prototype.applyTimerScale()` — применяет `this.timerScale` ко ВСЕМ блокам стилей. Task 4 добавит в него одну строку для нового блока.

- [ ] **Step 1: Написать характеризационный тест**

Тест фиксирует ТЕКУЩЕЕ поведение и обязан пройти ДО правки. Создать `e2e/display-timer-scale.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Характеризация: масштаб полноэкранного таймера применяется ко всем блокам
 * стилей из всех трёх точек входа.
 *
 * Написан ДО сворачивания четырёх строк (updateRingSize + три style.transform)
 * в applyTimerScale() и обязан пройти ПОСЛЕ него без единого изменения — ровно
 * так проверялось извлечение window-geometry.js.
 *
 * Почему это вообще стоит теста: блок был написан ТРИЖДЫ, и пятый стиль
 * означал бы пятую строку в трёх местах. Пропуск в одной из копий даёт
 * «масштаб работает, пока не тронешь колесо» — молча.
 */

const BLOCK_IDS = ['timerRing', 'timerDigital', 'timerFlip', 'timerAnalog'];

function readScales(ids) {
    const out = {};
    for (const id of ids) {
        const el = document.getElementById(id);
        out[id] = el ? el.style.transform : null;
    }
    return out;
}

async function findDisplay(app) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(() => !!document.getElementById('timerRing')).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

test('масштаб дисплея применяется ко всем блокам стилей', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');

        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);

        const display = await findDisplay(app);
        expect(display, 'полноэкранное окно должно открыться').not.toBeNull();

        // Точка входа 1: приход настроек от панели.
        await display.evaluate(() => window.ipcRenderer.send('get-timer-state'));
        await control.evaluate(() => {
            window.ipcRenderer.send('display-settings-update', { displayTimerScale: 150 });
        });
        await display.waitForTimeout(500);

        const afterPush = await display.evaluate(readScales, BLOCK_IDS);
        for (const id of BLOCK_IDS) {
            expect(afterPush[id], `${id} должен быть отмасштабирован приходом настроек`).toContain('scale(1.5)');
        }

        // Точка входа 2: Ctrl+колесо.
        await display.evaluate(() => {
            document.body.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
            }));
        });
        await display.waitForTimeout(300);

        const afterWheel = await display.evaluate(readScales, BLOCK_IDS);
        const wheelValues = new Set(Object.values(afterWheel));
        expect(wheelValues.size, 'все четыре блока должны получить ОДИН и тот же масштаб').toBe(1);
        expect(afterWheel.timerRing).not.toBe(afterPush.timerRing);

        // Точка входа 3: восстановление из localStorage при загрузке окна.
        const stored = await display.evaluate(() => localStorage.getItem('displayTimerScale'));
        expect(Number(stored), 'колесо обязано сохранить масштаб').toBeGreaterThan(0);
    } finally {
        await app.close();
    }
});
```

- [ ] **Step 2: Прогнать — тест должен ПРОЙТИ на текущем коде**

Run: `npx playwright test e2e/display-timer-scale.spec.js`
Expected: PASS. Если падает — сначала разобраться почему; характеризация обязана описывать реальность, иначе после рефакторинга сравнивать будет не с чем.

- [ ] **Step 3: Свернуть три копии в один метод**

В `display-script.js` заменить метод `updateRingSize()` (строка ~203) на:

```js
    /**
     * Применить this.timerScale ко ВСЕМ блокам стилей.
     *
     * Раньше эти четыре строки были написаны трижды — в applyDisplaySettings,
     * в обработчике Ctrl+колеса и в восстановлении из localStorage, — а метод
     * назывался updateRingSize и масштабировал ОДНО кольцо: остальные три
     * блока каждый раз масштабировал вызывающий. Добавление стиля означало
     * пятую строку в трёх местах, и пропуск в одном из них не виден ничем.
     */
    applyTimerScale() {
        const scale = (this.timerScale || 100) / 100;
        const blocks = [this.timerRing, this.timerDigital, this.timerFlip, this.timerAnalog];
        for (const block of blocks) {
            if (block) { block.style.transform = `scale(${scale})`; }
        }
    }
```

- [ ] **Step 4: Заменить три места вызова**

В каждом из трёх мест удалить четыре строки и оставить один вызов.

Место 1 — в `applyDisplaySettings` (было ~537–540):

```js
            this.applyTimerScale();
```

Место 2 — в обработчике Ctrl+колеса (было ~1620–1623): та же одна строка.

Место 3 — в восстановлении из localStorage (было ~1817–1820): та же одна строка.

Затем убедиться, что имя `updateRingSize` больше не встречается:

Run: `grep -n "updateRingSize" display-script.js display.html e2e/ tests/`
Expected: ни одного совпадения

- [ ] **Step 5: Прогнать характеризацию — она обязана пройти БЕЗ изменений в тесте**

Run: `npx playwright test e2e/display-timer-scale.spec.js`
Expected: PASS

- [ ] **Step 6: Прогнать остальные проверки дисплея**

```bash
npm run ci
npx playwright test e2e/overtime-centering.spec.js e2e/analog-hour-hand.spec.js e2e/overtime-palette.spec.js
```
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add display-script.js e2e/display-timer-scale.spec.js
git commit -m "refactor(display): масштаб таймера — один владелец applyTimerScale() вместо трёх копий"
```

---

### Task 4: Стиль «Цифры» в полноэкранном дисплее

**Files:**
- Modify: `display.html` (разметка блоков стилей ~1441, CSS, пин токенов светлой темы), `display-script.js` (`initElements`, `setTimerStyle`, `updateDisplay`, `_enforceOvertimeColors`, `applyDisplaySettings`, `applyTimerScale`), `electron-control.html` (`#displayTimerStyle` ~504)
- Create: `e2e/digits-style.spec.js`

**Interfaces:**
- Consumes: `window.DigitsStyle` (Task 1) — `resolveFont`, `applyFont`, `measureDigits`, `fitFontSize`, `clearProbeCache`, `PROBE_FONT_SIZE`; `applyTimerScale()` (Task 3).
- Produces: поле `displayDigitsFont` в пакете `display-settings-update`, читаемое дисплеем; блок `#timerDigits` с потомками `#digitsSign`, `#digitsValue`, `#digitsProbe`.

- [ ] **Step 1: Подключить модуль в окне**

В `display.html` рядом с остальными `<script src=...>` (перед `display-script.js`) добавить:

```html
    <script src="digits-style.js"></script>
```

- [ ] **Step 2: Добавить блок разметки**

В `display.html` после блока `<div class="timer-analog" id="timerAnalog">…</div>` добавить:

```html
        <!-- Стиль: Цифры — только время, без кольца, подложки и свечения -->
        <div class="timer-digits" id="timerDigits">
            <div class="digits-time" id="digitsTime"><span class="digits-sign" id="digitsSign"></span><span class="digits-value" id="digitsValue">00:00</span></div>
            <!-- Эталон замера. Скрыт от глаз и от чтения с экрана, но участвует
                 в раскладке: visibility:hidden оставляет размеры, display:none
                 обнулил бы их и замер вернул бы 0. -->
            <span class="digits-probe" id="digitsProbe" aria-hidden="true"></span>
        </div>
```

- [ ] **Step 3: Добавить CSS**

В `display.html`, в инлайновый `<style>`, после правил `.timer-analog`:

```css
        /* ============================================
           СТИЛЬ: ЦИФРЫ
           — только время; ни кольца, ни подложки, ни свечения
           ============================================ */
        .timer-digits {
            display: none;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
        }
        .timer-digits.active { display: flex !important; }

        /* ЦИФРЫ по центру окна, знак висит слева и ширины не занимает —
           тот же механизм, что у .time-text: контейнер сжимается по
           содержимому и центрируется, поэтому его левый край совпадает с
           левым краем ЦИФР, а знак позиционируется от него абсолютно.
           Центрировать надпись целиком нельзя: на дисплее это уводило цифры
           с оси на 54px (замерено). */
        .digits-time {
            position: relative;
            width: fit-content;
            margin-inline: auto;
            font-size: var(--digits-font-size, 120px);
            line-height: 1;
            white-space: nowrap;
            color: var(--tw-fg);
            font-variant-numeric: tabular-nums;
        }

        /* Знак МЕНЬШЕ цифр и по вертикали центрирован ОТНОСИТЕЛЬНО ЦИФР.
           Полноразмерный минус — отдельная клякса чернил, тянущая композицию
           влево; знак, привязанный к top: 0, при уменьшенном кегле читается
           как надстрочный индекс. */
        .digits-sign {
            position: absolute;
            right: 100%;
            top: 50%;
            transform: translateY(-50%);
            font-size: 0.62em;
            margin-right: 0.1em;
        }

        .digits-probe {
            position: absolute;
            visibility: hidden;
            white-space: nowrap;
            pointer-events: none;
            left: -9999px;
            top: 0;
        }
```

- [ ] **Step 4: Пин токенов светлой темы**

Найти в `display.html` блок `[data-theme="light"]`, где окно пинит светлый-на-тёмном набор (фон рисует пользователь инлайном, и он тёмный по умолчанию). Новый стиль использует `--tw-fg` — убедиться, что он в списке пина. Если его там нет, добавить.

Run: `grep -n -A 25 'data-theme="light"' display.html | grep -c "tw-fg:"`
Expected: не 0. Если 0 — добавить `--tw-fg: #ffffff;` в блок пина.

- [ ] **Step 5: Расширить `initElements` и `setTimerStyle`**

В `display-script.js`, в `initElements()`, рядом с остальными блоками стилей:

```js
        this.timerDigits = document.getElementById('timerDigits');
        this.digitsTime = document.getElementById('digitsTime');
        this.digitsSign = document.getElementById('digitsSign');
        this.digitsValue = document.getElementById('digitsValue');
        this.digitsProbe = document.getElementById('digitsProbe');
        this.digitsFont = window.DigitsStyle.DEFAULT_FONT_ID;
        this._digitsFontsReady = false;

        // Замер эталона до загрузки woff2 меряет ЗАПАСНОЕ начертание и кэширует
        // чужие цифры: у всех шрифтов проекта font-display: swap.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                this._digitsFontsReady = true;
                window.DigitsStyle.clearProbeCache();
                this.updateDigitsScale();
            });
        } else {
            this._digitsFontsReady = true;
        }
```

В `setTimerStyle(style)` — в снятие классов с `body` добавить `'style-digits'`, в снятие `active` добавить `this.timerDigits`, и добавить ветку:

```js
            case 'digits':
                if (this.timerDigits) {this.timerDigits.classList.add('active');}
                document.body.classList.add('style-digits');
                break;
```

В `applyTimerScale()` (Task 3) добавить `this.timerDigits` в массив `blocks`.

- [ ] **Step 6: Отрисовка и подгонка размера**

В `display-script.js` добавить два метода:

```js
    /**
     * Пересчитать кегль цифр под текущее окно.
     *
     * По эталону, а не по живому тексту: иначе цифры «дышат» каждую секунду
     * на шрифтах с непостоянной шириной знака. Запас 0.9 по обеим осям —
     * поля вокруг, как у остальных стилей окна.
     */
    updateDigitsScale() {
        if (!this.timerDigits || !this.digitsTime || !this._digitsFontsReady) { return; }

        const hasHours = Math.abs(Math.floor(this.remainingSeconds)) >= 3600;
        const probe = window.DigitsStyle.measureDigits(this.digitsProbe, this.digitsFont, hasHours);
        if (!probe) { return; }

        const box = this.timerDigits.getBoundingClientRect();
        const size = window.DigitsStyle.fitFontSize({
            availableWidth: box.width * 0.9,
            availableHeight: box.height * 0.9,
            probeWidth: probe.width,
            probeHeight: probe.height,
            signWidth: probe.signWidth
        });
        if (size > 0) { this.digitsTime.style.setProperty('--digits-font-size', size + 'px'); }
    }

    /**
     * Обновить текст стиля «Цифры».
     *
     * Знак и цифры — РАЗНЫЕ узлы: знак вынесен из потока, иначе центрируется
     * надпись целиком и цифры уезжают с оси кольца.
     */
    updateDigitsDisplay(secs) {
        if (!this.digitsValue) { return; }
        const wasHours = this._digitsHadHours;
        const hasHours = Math.abs(secs) >= 3600;

        this.digitsSign.textContent = secs < 0 ? '−' : '';
        this.digitsValue.textContent = this.formatTime(Math.abs(secs));

        // Кегль пересчитываем только когда сменился ФОРМАТ, а не каждый тик.
        if (wasHours !== hasHours) {
            this._digitsHadHours = hasHours;
            this.updateDigitsScale();
        }
    }
```

В `updateDisplay()` рядом с вызовами остальных стилей добавить `this.updateDigitsDisplay(secs);`.

- [ ] **Step 7: Цвета и полосы срочности**

В `_enforceOvertimeColors(secs)` после блока Digital добавить:

```js
        // Цифры
        if (this.digitsTime) {
            if (!this.digitsTime.classList.contains('danger')) {
                this.digitsTime.classList.add('danger', 'overtime');
            }
            this.digitsTime.style.color = '#ff4444';
        }
```

В `updateDisplay()`, там же где красятся остальные стили по `RendererShared.timerColorBand`, добавить ладдер со ВЕТКОЙ СБРОСА через `_normalColor()`:

```js
        if (this.digitsTime) {
            if (band === 'danger' || band === 'overtime') {
                this.digitsTime.style.color = '#ff4444';
            } else if (band === 'warning') {
                this.digitsTime.style.color = '#ffc107';
            } else {
                // Пустая строка СНИМАЕТ инлайн и возвращает цвет CSS. Ветка
                // `else if (this._baseTimerColor)` была бы багом: на чистом
                // профиле базового цвета нет, и красный не снялся бы никогда.
                this.digitsTime.style.color = this._normalColor();
            }
        }
```

- [ ] **Step 8: Применение шрифта из настроек**

В `applyDisplaySettings(settings)` добавить:

```js
        // Шрифт стиля «Цифры». Имя СВОЁ: общее имя в этом проекте уже означало
        // разные окна в разных наборах и стоило отдельного бага.
        if (settings.displayDigitsFont !== undefined) {
            const font = window.DigitsStyle.applyFont(this.digitsTime, settings.displayDigitsFont);
            if (font.id !== this.digitsFont) {
                this.digitsFont = font.id;
                this._safeSetItem('displayDigitsFont', font.id);
                this.updateDigitsScale();
            }
        }
```

Плюс в загрузке настроек из localStorage при старте окна прочитать `displayDigitsFont` и применить тем же путём.

- [ ] **Step 9: Пятая кнопка в панели**

В `electron-control.html`, в переключателе `#displayTimerStyle` (~504), добавить пятую кнопку и укоротить подписи:

```html
                                <button type="button" data-val="digits">Цифры</button>
```

- [ ] **Step 10: ЗАМЕРИТЬ ширину переключателя**

Пять кнопок могут не влезть в 400px. Меряем, а не смотрим:

```bash
npx playwright test e2e/drawer-layout.spec.js
```

и разово в консоли окна панели:

```js
const el = document.getElementById('displayTimerStyle');
console.log(el.scrollWidth, el.clientWidth, el.scrollWidth <= el.clientWidth);
```

Если `scrollWidth > clientWidth` — добавить в `control.css` правилу `.segmented` `flex-wrap: wrap;` и перепроверить. Уменьшать кегль подписей до нечитаемого запрещено.

- [ ] **Step 11: Написать e2e на дисплей**

Создать `e2e/digits-style.spec.js` с первым тестом:

```js
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Стиль «Цифры» и выбор шрифта.
 *
 * Всё — КЛИКОМ по видимым элементам: зелёный тест не доказывает, что контрол
 * достижим. В этом проекте #syncClockStyle целый проход просидел внутри
 * display:none при полностью живой логике и зелёном тесте.
 *
 * Профиль e2e ОДИН на весь прогон, поэтому в конце стиль и шрифт возвращаются
 * обратно: спек, оставивший приложение в чужом состоянии, ронял соседний.
 */

async function findWindow(app, probe) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(probe).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

const IS_DISPLAY = () => !!document.getElementById('timerDigits') && !!document.getElementById('timerRing');

function measureDigits() {
    const time = document.getElementById('digitsTime');
    const value = document.getElementById('digitsValue');
    const block = document.getElementById('timerDigits');
    if (!time || !value || !block) { return null; }
    const t = time.getBoundingClientRect();
    const v = value.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    const cs = getComputedStyle(time);
    return {
        active: block.classList.contains('active'),
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        digitsCenter: v.left + v.width / 2,
        inscriptionCenter: t.left + t.width / 2,
        blockCenter: b.left + b.width / 2,
        blockWidth: b.width
    };
}

test('стиль «Цифры» доходит до полноэкранного окна кликом', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');

        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);

        // Открыть вкладку «Дисплей» — только кликом.
        // Отдельной кнопки открытия ящика нет: вкладка сама его открывает
        // (у .tab-btn стоит aria-controls="settingsDrawer").
        await control.click('.tab-btn[data-tab="display"]');
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await control.waitForTimeout(700);

        const display = await findWindow(app, IS_DISPLAY);
        expect(display, 'полноэкранное окно должно быть найдено').not.toBeNull();

        const m = await display.evaluate(measureDigits);
        expect(m.active, 'блок «Цифры» должен стать активным').toBe(true);
        expect(m.fontSize, 'кегль должен быть подобран под окно').toBeGreaterThan(40);

        // Кольца в этом стиле нет.
        const ringVisible = await display.evaluate(
            () => document.getElementById('timerRing').classList.contains('active')
        );
        expect(ringVisible, 'кольцо в стиле «Цифры» показываться не должно').toBe(false);
    } finally {
        await app.close();
    }
});

test('масштаб дисплея действует и на стиль «Цифры» — ползунком и колесом', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);

        // Отдельной кнопки открытия ящика нет: вкладка сама его открывает
        // (у .tab-btn стоит aria-controls="settingsDrawer").
        await control.click('.tab-btn[data-tab="display"]');
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await control.waitForTimeout(700);

        const display = await findWindow(app, IS_DISPLAY);
        const readTransform = () => document.getElementById('timerDigits').style.transform;

        const before = await display.evaluate(readTransform);

        // Ползунок «Масштаб таймера» во вкладке «Дисплей» (data-tab="display").
        await control.evaluate(() => {
            const slider = document.getElementById('displayTimerScale');
            slider.value = '150';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await display.waitForTimeout(500);
        const afterSlider = await display.evaluate(readTransform);
        expect(afterSlider).toContain('scale(1.5)');
        expect(afterSlider).not.toBe(before);

        // Ctrl+колесо.
        await display.evaluate(() => {
            document.body.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
            }));
        });
        await display.waitForTimeout(300);
        const afterWheel = await display.evaluate(readTransform);
        expect(afterWheel, 'колесо обязано менять масштаб').not.toBe(afterSlider);
    } finally {
        await app.close();
    }
});

test('в перерасходе ЦИФРЫ остаются на оси окна, а надпись — нет', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);

        // Отдельной кнопки открытия ящика нет: вкладка сама его открывает
        // (у .tab-btn стоит aria-controls="settingsDrawer").
        await control.click('.tab-btn[data-tab="display"]');
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await control.waitForTimeout(500);

        // Загнать таймер в перерасход.
        await control.evaluate(() => {
            window.ipcRenderer.send('timer-command', { type: 'set', seconds: 1, allowNegative: true });
            window.ipcRenderer.send('timer-command', { type: 'start' });
        });
        await control.waitForTimeout(3500);

        const display = await findWindow(app, IS_DISPLAY);
        const m = await display.evaluate(measureDigits);

        expect(Math.abs(m.digitsCenter - m.blockCenter),
            'цифры обязаны стоять на оси окна').toBeLessThan(1.5);
        expect(Math.abs(m.inscriptionCenter - m.blockCenter),
            'надпись целиком центрированной быть НЕ должна — это доказывает, что знак вне потока'
        ).toBeGreaterThan(1.5);

        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    } finally {
        await app.close();
    }
});
```

- [ ] **Step 12: Прогнать e2e**

Run: `npx playwright test e2e/digits-style.spec.js e2e/display-timer-scale.spec.js`
Expected: PASS

- [ ] **Step 13: Прогнать полный набор**

Run: `npm run ci`
Expected: PASS

- [ ] **Step 14: Коммит**

```bash
git add display.html display-script.js electron-control.html e2e/digits-style.spec.js
git commit -m "feat(display): стиль «Цифры» в полноэкранном окне"
```

---

### Task 5: Стиль «Цифры» в виджете

**Files:**
- Modify: `electron-widget.html` (`<script>` подключение, разметка ~1017, CSS ~659, `initElements` ~1194, `updateScaling` ~1231, `setTimerStyle` ~1719, `updateDisplay` ~1754, `applyColors` ~1456, пин токенов светлой темы), `electron-control.html` (`#timerStyle` ~140)
- Test: `e2e/digits-style.spec.js` (дописать тесты)

**Interfaces:**
- Consumes: `window.DigitsStyle` (Task 1).
- Produces: поле `digitsFont` в пакете `widget-style-update`; блок `#widgetDigits` с потомками `#widgetDigitsSign`, `#widgetDigitsValue`, `#widgetDigitsProbe`; CSS-переменная `--digits-font-size` на контейнере.

- [ ] **Step 1: Подключить модуль**

В `electron-widget.html` перед инлайновым `<script>` с классом виджета добавить:

```html
    <script src="digits-style.js"></script>
```

- [ ] **Step 2: Добавить разметку**

После блока `<div class="widget-analog" id="widgetAnalog">…</div>`:

```html
        <!-- Стиль: Цифры -->
        <div class="widget-digits" id="widgetDigits">
            <div class="widget-digits-time" id="widgetDigitsTime"><span class="widget-digits-sign" id="widgetDigitsSign"></span><span class="widget-digits-value" id="widgetDigitsValue">00:00</span></div>
            <span class="widget-digits-probe" id="widgetDigitsProbe" aria-hidden="true"></span>
        </div>
```

- [ ] **Step 3: Добавить CSS**

Рядом с правилами `.widget-digital` / `.widget-flip` / `.widget-analog`. Обратить внимание: `.widget-digits` надо добавить в общее правило скрытия (строки ~659–669), где перечислены остальные блоки.

```css
        /* ============================================
           СТИЛЬ: ЦИФРЫ — только время, окно прозрачное
           ============================================ */
        .widget-digits {
            display: none;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
        }
        .widget-digits.active { display: flex !important; }

        /* Центрируются ЦИФРЫ, не надпись: см. .digits-time в display.html —
           там же история двух неудачных итераций. */
        .widget-digits-time {
            position: relative;
            width: fit-content;
            margin-inline: auto;
            font-size: var(--digits-font-size, 40px);
            line-height: 1;
            white-space: nowrap;
            color: var(--tw-fg);
            font-variant-numeric: tabular-nums;
        }

        .widget-digits-sign {
            position: absolute;
            right: 100%;
            top: 50%;
            transform: translateY(-50%);
            font-size: 0.62em;
            margin-right: 0.1em;
        }

        .widget-digits-probe {
            position: absolute;
            visibility: hidden;
            white-space: nowrap;
            pointer-events: none;
            left: -9999px;
            top: 0;
        }
```

Окно прозрачное и без тени — никаких `box-shadow`, `drop-shadow` и `filter: shadow`: они рисуют видимые тёмные прямоугольники.

- [ ] **Step 4: Пин токенов светлой темы**

Виджет рисует фон, который задаёт пользователь, инлайном, и потому пинит светлый-на-тёмном набор. Убедиться, что `--tw-fg` в пине есть:

Run: `grep -n -A 25 'data-theme="light"' electron-widget.html | grep -c "tw-fg:"`
Expected: не 0. Если 0 — добавить.

- [ ] **Step 5: `initElements` и готовность шрифтов**

В `initElements()` рядом с остальными блоками стилей:

```js
                this.widgetDigits = document.getElementById('widgetDigits');
                this.widgetDigitsTime = document.getElementById('widgetDigitsTime');
                this.widgetDigitsSign = document.getElementById('widgetDigitsSign');
                this.widgetDigitsValue = document.getElementById('widgetDigitsValue');
                this.widgetDigitsProbe = document.getElementById('widgetDigitsProbe');
                this.digitsFont = window.DigitsStyle.DEFAULT_FONT_ID;
                this._digitsFontsReady = false;
                if (document.fonts && document.fonts.ready) {
                    document.fonts.ready.then(() => {
                        this._digitsFontsReady = true;
                        window.DigitsStyle.clearProbeCache();
                        this.updateScaling();
                    });
                } else {
                    this._digitsFontsReady = true;
                }
```

- [ ] **Step 6: Подгонка размера в `updateScaling()`**

В конец `updateScaling()` добавить:

```js
                // Цифры: кегль по замеру ЭТАЛОНА. Формула charCount * 0.6 выше
                // предполагает моноширинный шрифт и на шести шрифтах стиля
                // «Цифры» врёт от 0.42 до 0.78 em — поэтому здесь меряем.
                if (this.widgetDigitsTime && this._digitsFontsReady) {
                    const hasDigitsHours = Math.abs(Math.floor(this.remainingSeconds)) >= 3600;
                    const probe = window.DigitsStyle.measureDigits(
                        this.widgetDigitsProbe, this.digitsFont, hasDigitsHours
                    );
                    if (probe) {
                        const size = window.DigitsStyle.fitFontSize({
                            availableWidth: containerWidth * 0.9,
                            availableHeight: containerHeight * 0.9,
                            probeWidth: probe.width,
                            probeHeight: probe.height,
                            signWidth: probe.signWidth
                        });
                        if (size > 0) {
                            this.widgetDigitsTime.style.setProperty('--digits-font-size', size + 'px');
                        }
                    }
                }
```

- [ ] **Step 7: Ветка в `setTimerStyle`**

Добавить `this.widgetDigits` в снятие `active` и ветку:

```js
                    case 'digits':
                        if (this.widgetDigits) {this.widgetDigits.classList.add('active');}
                        break;
```

- [ ] **Step 8: Отрисовка и цвет в `updateDisplay`**

В `updateDisplay(secs)` после обновления LED добавить:

```js
                // Цифры: знак и цифры — РАЗНЫЕ узлы, знак вне потока.
                if (this.widgetDigitsValue) {
                    this.widgetDigitsSign.textContent = secs < 0 ? '−' : '';
                    this.widgetDigitsValue.textContent = this.formatTime(Math.abs(secs));
                    const nowHours = Math.abs(secs) >= 3600;
                    if (this._digitsHadHours !== nowHours) {
                        this._digitsHadHours = nowHours;
                        this.updateScaling();
                    }
                }
```

и в ладдер полос срочности:

```js
                if (this.widgetDigitsTime) {
                    this.widgetDigitsTime.dataset.status = status;
                    if (status === 'danger' || status === 'overtime') {
                        this.widgetDigitsTime.style.color = '#ff4444';
                    } else if (status === 'warning') {
                        this.widgetDigitsTime.style.color = '#ffc107';
                    } else {
                        // `|| ''` — пустая строка снимает инлайн. Ветка
                        // `else if (this._baseTimerColor)` оставила бы красный
                        // навсегда на чистом профиле.
                        this.widgetDigitsTime.style.color = this._baseTimerColor || '';
                    }
                }
```

- [ ] **Step 9: Цвет темы в `applyColors`**

В `applyColors()` после блока Digital:

```js
                // Цифры — базовый цвет темы, кроме перерасхода (его держит
                // ладдер в updateDisplay).
                if (timerColor && this.widgetDigitsTime
                    && !this.widgetDigitsTime.dataset.status?.match(/danger|overtime/)) {
                    this.widgetDigitsTime.style.color = timerColor;
                }
```

- [ ] **Step 10: Приём шрифта по IPC**

В обработчике `widget-style-update` добавить:

```js
                    if (settings.digitsFont !== undefined) {
                        const font = window.DigitsStyle.applyFont(this.widgetDigitsTime, settings.digitsFont);
                        if (font.id !== this.digitsFont) {
                            this.digitsFont = font.id;
                            this.updateScaling();
                        }
                    }
```

и в чтении настроек из localStorage при старте — прочитать `widgetDigitsFont` из `displayExtSettings` и применить тем же путём.

- [ ] **Step 11: Пятая кнопка в панели**

В `electron-control.html`, в `#timerStyle` (~140):

```html
                                <button type="button" data-val="digits">Цифры</button>
```

- [ ] **Step 12: Дописать e2e**

В `e2e/digits-style.spec.js` добавить тест по образцу дисплейного: открыть виджет кликом по `#openWidgetBtn`, во вкладке «Виджет» (data-tab="timer") кликнуть `#timerStyle button[data-val="digits"]`, найти окно виджета по `#widgetDigits`, проверить `active`, `fontSize > 10`, и что ползунок `#timerScale` меняет измеренный `fontSize` цифр.

- [ ] **Step 13: Прогнать**

```bash
npm run ci
npx playwright test e2e/digits-style.spec.js
```
Expected: PASS

- [ ] **Step 14: Коммит**

```bash
git add electron-widget.html electron-control.html e2e/digits-style.spec.js
git commit -m "feat(widget): стиль «Цифры» в виджете таймера"
```

---

### Task 6: Стиль «Цифры» в виджете часов

**Files:**
- Modify: `electron-clock-widget.html` (подключение модуля, разметка ~955, CSS, `initElements` ~1156, `setClockStyle` ~1421 включая белый список ~1433, отрисовка ~1778, `applyColors` ~1260, `updateScaling`, пин темы НЕ нужен — часы владеют своим фоном и следуют теме), `electron-control.html` (`#clockStyle` ~411), `tests/visual-source.test.js:330`
- Test: `e2e/digits-style.spec.js` (дописать)

**Interfaces:**
- Consumes: `window.DigitsStyle` (Task 1).
- Produces: поле `clockDigitsFont` в пакете `clock-settings`; блок `#clockDigits` с потомками `#clockDigitsValue`, `#clockDigitsProbe`.

- [ ] **Step 1: Подключить модуль, добавить разметку и CSS**

Ровно как в Task 5, но с префиксом `clock-`: блок `.clock-digits` / `#clockDigits`, время `#clockDigitsTime`, значение `#clockDigitsValue`, эталон `#clockDigitsProbe`.

Знак минуса часам НЕ нужен — они показывают текущее время, оно не бывает отрицательным. Поэтому `<span class="clock-digits-sign">` не добавляем, а в замере передаём `signWidth: 0`.

Часы владеют своим фоном и в светлой теме белеют — пина токенов у них нет и добавлять его не надо. Правило `tests/ui-theme.test.js` проверяет ОБЕ половины: пин в виджете и дисплее и его ОТСУТСТВИЕ в часах.

- [ ] **Step 2: Расширить белый список стилей**

В `electron-clock-widget.html`, строка ~1433:

```js
                const safeStyle = ['circle', 'digital', 'flip', 'analog', 'digits'].includes(style) ? style : 'circle';
```

и в снятие классов с `body` добавить `'style-digits'`, в снятие `active` — `this.clockDigits`, плюс ветку `case 'digits':`.

- [ ] **Step 3: Обновить тест, который прибивает белый список литералом**

`tests/visual-source.test.js:330` содержит точный литерал списка. Привести к новому:

```js
    assert.match(JS_CODE, /const safeStyle = \['circle', 'digital', 'flip', 'analog', 'digits'\]\.includes\(style\)/);
```

- [ ] **Step 4: Отрисовка времени**

В методе, который пишет `this.widgetDigitalTime.textContent = timeStr` (~1778), рядом добавить:

```js
                if (this.clockDigitsValue) {
                    this.clockDigitsValue.textContent = timeStr;
                }
```

Формат берётся тот же, что у остальных стилей: `_uses24h()` и `showSeconds` уже учтены в `timeStr`. Ограничение флипа «всегда 24 часа» на «Цифры» НЕ распространяется — у цифр есть место под AM/PM.

- [ ] **Step 5: Подгонка, цвет, приём шрифта**

По образцу Task 5: `updateScaling()` считает `--digits-font-size` через `measureDigits` + `fitFontSize` с `signWidth: 0`; `applyColors()` красит `this.clockDigitsTime` в `timerColor`; обработчик `clock-settings` применяет `settings.clockDigitsFont` через `window.DigitsStyle.applyFont` и пересчитывает масштаб при смене; `saveSettings()` кладёт `clockDigitsFont` в `clockWidgetSettings`, `loadSettings()` читает.

- [ ] **Step 6: Пятая кнопка в панели**

В `electron-control.html`, в `#clockStyle` (~411):

```html
                                <button type="button" data-val="digits">Цифры</button>
```

- [ ] **Step 7: Дописать e2e**

Тест: открыть часы кликом `#openClockBtn`, вкладка «Часы» (data-tab="clock"), клик `#clockStyle button[data-val="digits"]`, найти окно по `#clockDigits`, проверить `active` и подобранный кегль. Отдельно — что «Цифры» в часах НЕ включают синхронизацию со стилем виджета: `#syncClockStyle` остаётся снятым.

- [ ] **Step 8: Прогнать**

```bash
npm run ci
npx playwright test e2e/digits-style.spec.js e2e/clock-style-sync.spec.js e2e/reachable-controls.spec.js
```
Expected: PASS

- [ ] **Step 9: Коммит**

```bash
git add electron-clock-widget.html electron-control.html tests/visual-source.test.js e2e/digits-style.spec.js
git commit -m "feat(clock): стиль «Цифры» в виджете часов"
```

---

### Task 7: Выбор шрифта в панели

**Files:**
- Modify: `electron-control.html` (три строки «Шрифт цифр», проводка, видимость), `control.css` (стили списка), `settings-schema.js`, `clock-settings-schema.js`
- Test: `tests/settings-schema.test.js`, `tests/clock-settings-schema.test.js`, `e2e/digits-style.spec.js`, `e2e/settings-roundtrip.spec.js`

**Interfaces:**
- Consumes: `window.DigitsStyle.DIGIT_FONTS` (Task 1); блоки стилей из Task 4–6.
- Produces: три контрола `#widgetDigitsFont`, `#clockDigitsFont`, `#displayDigitsFont` (каждый — `div.font-select` с `.value`, ведущий себя как форм-контрол: присваивание МОЛЧАЛИВО, событие `change` шлёт только клик); три блока-обёртки `#widgetDigitsFontRow`, `#clockDigitsFontRow`, `#displayDigitsFontRow` (класс `.setting-block` — подпись сверху, список во всю ширину под ней, а НЕ `.toggle-row`: шесть строк списка в правой половине flex-строки не помещаются).

- [ ] **Step 1: Написать падающий тест на схемы**

В `tests/settings-schema.test.js` добавить:

```js
test('шрифт цифр: три ключа, у каждого свой контрол и умолчание inter', () => {
    const rows = SETTINGS_DESCRIPTORS.filter((d) => d.key.endsWith('DigitsFont'));
    assert.deepEqual(
        rows.map((r) => r.key).sort(),
        ['clockDigitsFont', 'displayDigitsFont', 'widgetDigitsFont']
    );
    for (const row of rows) {
        assert.equal(row.kind, 'value');
        assert.equal(row.def, 'inter');
        assert.equal(row.el, row.key, 'id контрола совпадает с именем ключа');
        assert.ok(!row.legacy, 'общего устаревшего имени у новых ключей нет');
    }
});

test('шрифт цифр: круговой рейс через поддельный документ', () => {
    const doc = fakeDoc();  // помощник уже есть в этом файле, строка 26
    applyStoredSettings({ widgetDigitsFont: 'bebas', displayDigitsFont: 'orbitron' }, doc);
    assert.equal(doc._get('widgetDigitsFont').value, 'bebas');
    assert.equal(doc._get('displayDigitsFont').value, 'orbitron');
    assert.equal(doc._get('clockDigitsFont').value, 'inter', 'незаданный — умолчание');

    const out = collectSettings(doc);
    assert.equal(out.widgetDigitsFont, 'bebas');
    assert.equal(out.displayDigitsFont, 'orbitron');
    assert.equal(out.clockDigitsFont, 'inter');
});
```

В `tests/clock-settings-schema.test.js` добавить:

```js
test('таблица часов принимает строковое значение, а не только галочки', () => {
    const row = CLOCK_SETTINGS.find((r) => r.key === 'clockDigitsFont');
    assert.ok(row, 'строка clockDigitsFont должна быть в таблице');
    assert.equal(row.kind, 'value');
    assert.equal(row.def, 'inter');
});

test('строковая строка таблицы кладётся и читается через .value, а не .checked', () => {
    const els = { clockDigitsFontEl: { value: 'oswald' }, };
    assert.equal(collectClockSettings(els).clockDigitsFont, 'oswald');

    const target = { clockDigitsFontEl: { value: '' } };
    applyClockSettings(target, { clockDigitsFont: 'playfair' });
    assert.equal(target.clockDigitsFontEl.value, 'playfair');
});

test('строковая строка: сохранённая пустая строка НЕ подменяется умолчанием', () => {
    const target = { clockDigitsFontEl: { value: 'oswald' } };
    applyClockSettings(target, { clockDigitsFont: '' });
    assert.equal(target.clockDigitsFontEl.value, '');
});
```

- [ ] **Step 2: Прогнать — должны падать**

Run: `node --test tests/settings-schema.test.js tests/clock-settings-schema.test.js`
Expected: FAIL — строк в таблицах нет, `kind` в таблице часов не поддерживается

- [ ] **Step 3: Добавить строки в `settings-schema.js`**

В `SETTINGS_DESCRIPTORS`, в блок стилей:

```js
    // Шрифт стиля «Цифры». Три РАЗНЫХ имени с самого начала: общее имя
    // `timerStyle` в этом проекте уже означало разные окна в разных наборах
    // и стоило отдельного бага, где дисплей рисовал стиль виджета.
    { key: 'widgetDigitsFont', el: 'widgetDigitsFont', kind: 'value', def: 'inter' },
    { key: 'displayDigitsFont', el: 'displayDigitsFont', kind: 'value', def: 'inter' },
    { key: 'clockDigitsFont', el: 'clockDigitsFont', kind: 'value', def: 'inter' },
```

- [ ] **Step 4: Научить `clock-settings-schema.js` строковым значениям**

Заменить таблицу и обе функции:

```js
const CLOCK_SETTINGS = [
    { key: 'showDate', el: 'clockShowDateEl', kind: 'checkbox', def: false },
    { key: 'showTimezone', el: 'clockShowTimezoneEl', kind: 'checkbox', def: false },
    { key: 'showSeconds', el: 'clockShowSecondsEl', kind: 'checkbox', def: true },
    { key: 'format24h', el: 'clockFormat24hEl', kind: 'checkbox', def: true },
    { key: 'showNumbers', el: 'clockShowAnalogNumbersEl', kind: 'checkbox', def: false },
    // Первая нелогическая строка таблицы: шрифт стиля «Цифры».
    { key: 'clockDigitsFont', el: 'clockDigitsFontEl', kind: 'value', def: 'inter' }
];

function collectClockSettings(els) {
    const out = {};
    for (const row of CLOCK_SETTINGS) {
        const el = els[row.el];
        if (row.kind === 'value') {
            out[row.key] = el ? el.value : row.def;
        } else {
            out[row.key] = el ? !!el.checked : row.def;
        }
    }
    return out;
}

function applyClockSettings(els, stored) {
    const src = (stored && typeof stored === 'object') ? stored : {};
    for (const row of CLOCK_SETTINGS) {
        const el = els[row.el];
        if (!el) { continue; }
        // Проверка именно на undefined: сохранённые `false` и '' — это выбор
        // пользователя, подменять его умолчанием нельзя.
        const raw = src[row.key];
        if (row.kind === 'value') {
            el.value = raw === undefined ? row.def : raw;
        } else {
            el.checked = raw === undefined ? row.def : !!raw;
        }
    }
}
```

- [ ] **Step 5: Прогнать тесты схем**

Run: `node --test tests/settings-schema.test.js tests/clock-settings-schema.test.js`
Expected: PASS

- [ ] **Step 6: Разметка трёх строк выбора шрифта**

В `electron-control.html` добавить в каждую из трёх вкладок, сразу после строки со стилем. Пример для вкладки «Виджет» (остальные две — с заменой `widget` на `clock` / `display` и соответствующим `aria-label`):

```html
                        <!-- Видна только при стиле «Цифры»: у остальных четырёх
                             стилей начертание — часть самого стиля.
                             Блок, а не .toggle-row: список постоянно раскрыт
                             (шесть строк с образцами), и в правую половину
                             flex-строки он не помещается. Раскрытый список
                             выбран вместо всплывающего сознательно — Esc в
                             этом окне уже слоёный (ящик, модалки, глобальный
                             обработчик), и ещё один слой поверх ящика — это
                             ещё один способ его сломать.
                             id строки СТОИТ на элементе, который реально
                             оборачивает контрол: та же ошибка с #clockStyleRow
                             в прошлом означала, что скрывать было нечего. -->
                        <div class="setting-block" id="widgetDigitsFontRow" style="display: none;">
                            <span class="toggle-label">Шрифт цифр</span>
                            <div class="font-select" id="widgetDigitsFont" role="listbox"
                                 aria-label="Шрифт цифр виджета" data-value="inter"></div>
                        </div>
```

Пункты списка строятся из реестра в JS — второго списка шрифтов в разметке не заводим.

- [ ] **Step 7: Адаптер `_attachFontSelect`**

В `electron-control.html`, рядом с `_attachSegmented`, добавить:

```js
            /**
             * Адаптер: div.font-select притворяется форм-контролем с .value.
             *
             * КРИТИЧНО, тот же инвариант, что у _attachSegmented: присваивание
             * .value НЕ порождает 'change'. Событие шлёт ТОЛЬКО клик
             * пользователя. Нарушение этого правила у сегментированного
             * контрола убило синхронизацию стиля часов целиком — восстановление
             * значения при загрузке панели уничтожало сохранённую настройку.
             *
             * Нативный <select> не годится: на macOS попап рисует система, и
             * font-family на <option> не применяется — превью, ради которого
             * контрол и нужен, просто не работало бы.
             */
            _attachFontSelect(el) {
                if (!el || !el.classList || !el.classList.contains('font-select')) { return; }

                const fonts = window.DigitsStyle.DIGIT_FONTS;
                el.innerHTML = '';
                for (const font of fonts) {
                    const option = document.createElement('div');
                    option.className = 'font-option';
                    option.setAttribute('role', 'option');
                    option.dataset.val = font.id;
                    option.tabIndex = -1;

                    const name = document.createElement('span');
                    name.className = 'font-option-name';
                    name.textContent = font.label;

                    const sample = document.createElement('span');
                    sample.className = 'font-option-sample';
                    sample.textContent = '12:34';
                    sample.style.fontFamily = font.family;
                    sample.style.fontWeight = String(font.weight);

                    option.append(name, sample);
                    el.appendChild(option);
                }

                const apply = (v) => {
                    const font = window.DigitsStyle.resolveFont(v);
                    el.dataset.value = font.id;
                    el.querySelectorAll('.font-option').forEach((o) => {
                        const on = o.dataset.val === font.id;
                        o.classList.toggle('active', on);
                        o.setAttribute('aria-selected', on ? 'true' : 'false');
                    });
                };

                if (!Object.getOwnPropertyDescriptor(el, 'value')) {
                    Object.defineProperty(el, 'value', {
                        get() { return this.dataset.value || window.DigitsStyle.DEFAULT_FONT_ID; },
                        set(v) { apply(v); },
                        configurable: true
                    });
                }

                el.querySelectorAll('.font-option').forEach((option) => {
                    option.addEventListener('click', () => {
                        apply(option.dataset.val);
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                });

                el.setAttribute('tabindex', '0');
                el.addEventListener('keydown', (e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return; }
                    e.preventDefault();
                    const ids = fonts.map((f) => f.id);
                    const at = ids.indexOf(el.value);
                    const next = e.key === 'ArrowDown'
                        ? (at + 1) % ids.length
                        : (at - 1 + ids.length) % ids.length;
                    apply(ids[next]);
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });

                apply(el.dataset.value);
            }
```

- [ ] **Step 8: Стили списка**

В `control.css`:

```css
/* Список выбора шрифта цифр. Пункт слева — название, справа — образец,
   набранный ЭТИМ шрифтом: выбирать по названию вслепую бессмысленно. */
/* Подпись сверху, список во всю ширину под ней. */
.setting-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
}

.font-select {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--tw-level-2);
    border: 1px solid var(--tw-border);
    border-radius: 10px;
    padding: 4px;
    max-height: 190px;
    overflow-y: auto;
    min-width: 190px;
}

.font-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 7px;
    cursor: pointer;
    color: var(--tw-fg-secondary);
    transition: background var(--tw-dur-fast) var(--tw-ease-out);
}

.font-option:hover { background: var(--tw-level-3); color: var(--tw-fg); }
.font-option.active { background: var(--tw-accent-soft); color: var(--tw-fg); }
.font-option:focus-visible { outline: none; box-shadow: var(--tw-focus-ring); }

.font-option-name { font-size: 12px; }
.font-option-sample { font-size: 17px; line-height: 1; font-variant-numeric: tabular-nums; }
```

Проверить, что использованные токены существуют в `design-tokens.css`; если `--tw-accent-soft` там нет — взять существующий токен подсветки активного пункта из соседних правил `control.css`, а не вводить новый.

- [ ] **Step 9: Проводка в контроллере**

В `initElements()`:

```js
                this.widgetDigitsFontEl = document.getElementById('widgetDigitsFont');
                this.clockDigitsFontEl = document.getElementById('clockDigitsFont');
                this.displayDigitsFontEl = document.getElementById('displayDigitsFont');
                this._attachFontSelect(this.widgetDigitsFontEl);
                this._attachFontSelect(this.clockDigitsFontEl);
                this._attachFontSelect(this.displayDigitsFontEl);
                this.widgetDigitsFontRowEl = document.getElementById('widgetDigitsFontRow');
                this.clockDigitsFontRowEl = document.getElementById('clockDigitsFontRow');
                this.displayDigitsFontRowEl = document.getElementById('displayDigitsFontRow');
```

Метод видимости — по образцу существующего `updateClockAnalogNumbersVisibility()`:

```js
            updateDigitsFontRowsVisibility() {
                const clockStyle = this.syncClockStyle ? this.timerStyleEl.value : this.clockStyleEl.value;
                const rows = [
                    [this.widgetDigitsFontRowEl, this.timerStyleEl.value],
                    [this.clockDigitsFontRowEl, clockStyle],
                    [this.displayDigitsFontRowEl, this.displayTimerStyleEl ? this.displayTimerStyleEl.value : 'circle']
                ];
                for (const [row, style] of rows) {
                    if (row) { row.style.display = style === 'digits' ? 'flex' : 'none'; }
                }
            }
```

Звать его из всех трёх обработчиков `change` переключателей стиля, из обработчика `#syncClockStyle` и в конце `loadSettings()`.

Обработчики выбора шрифта:

```js
                if (this.widgetDigitsFontEl) {
                    this.widgetDigitsFontEl.addEventListener('change', () => {
                        ipcRenderer.send('widget-style-update', {
                            timerStyle: this.timerStyleEl.value,
                            digitsFont: this.widgetDigitsFontEl.value,
                            showTicks: this.widgetShowTicksEl?.checked ?? false
                        });
                        this.saveExtSettings();
                    });
                }
                if (this.clockDigitsFontEl) {
                    this.clockDigitsFontEl.addEventListener('change', () => {
                        this.pushClockSettings();
                        this.saveExtSettings();
                    });
                }
                if (this.displayDigitsFontEl) {
                    this.displayDigitsFontEl.addEventListener('change', () => {
                        this.pushDisplaySettings();
                    });
                }
```

- [ ] **Step 10: Добавить поле в три пакета**

В `pushDisplaySettings()` в объект `settings`:

```js
                    displayDigitsFont: this.displayDigitsFontEl ? this.displayDigitsFontEl.value : 'inter',
```

В начальной отправке стиля виджета (`setTimeout` ~600мс в `loadSettings`) и в обработчиках `#timerStyle` / `#timerScale` добавить в пакет `widget-style-update`:

```js
                        digitsFont: this.widgetDigitsFontEl ? this.widgetDigitsFontEl.value : 'inter',
```

`pushClockSettings()` подхватит `clockDigitsFont` автоматически — он собирает пакет через `ClockSettingsSchema.collectClockSettings(this)`, а строка в таблице уже есть (Step 4).

- [ ] **Step 11: Дописать e2e**

В `e2e/digits-style.spec.js` добавить два теста:

1. **Выбор шрифта доходит до окна.** Включить стиль «Цифры» во вкладке «Виджет» (data-tab="timer"), кликнуть `#widgetDigitsFont .font-option[data-val="bebas"]`, замерить `getComputedStyle(#widgetDigitsTime).fontFamily` в окне виджета — должен содержать `Bebas Neue`; кликнуть `playfair` — должен содержать `Playfair Display` и **отличаться** от первого замера.
2. **Строка видна только при «Цифрах».** При `circle` — `#widgetDigitsFontRow` имеет `display: none`; после клика по `digits` — виден; после возврата на `circle` — снова скрыт. Проверять через `toBeVisible()` / `toBeHidden()`, то есть по факту видимости, а не по значению атрибута.

В `e2e/settings-roundtrip.spec.js` добавить три настройки в список проверяемых: `widgetDigitsFont`, `clockDigitsFont`, `displayDigitsFont` — со значениями, отличными от умолчания, и с проверкой, что после перезагрузки окна они на месте.

В конце каждого теста вернуть стиль в `circle` и шрифт в `inter`: профиль e2e один на весь прогон.

- [ ] **Step 12: Прогнать всё**

```bash
npm run ci
npx playwright test
```
Expected: PASS

- [ ] **Step 13: Коммит**

```bash
git add electron-control.html control.css settings-schema.js clock-settings-schema.js tests/ e2e/
git commit -m "feat(control): выбор шрифта для стиля «Цифры» отдельно в каждом окне"
```

---

### Task 8: Съёмка и визуальная сверка

**Files:**
- Modify: `scripts/screenshot-runner.js` (~344), `scripts/visual-audit.js` (~9, ~181, ~192, ~203), `tests/audit-2026-07-fixes.test.js` (~420)

**Interfaces:**
- Consumes: стиль `digits` во всех трёх окнах (Task 4–6).
- Produces: три новых кадра в визуальной базе.

- [ ] **Step 1: Добавить стиль в список съёмки**

В `scripts/screenshot-runner.js`:

```js
        const STYLES = ['circle', 'digital', 'flip', 'analog', 'digits'];
```

В `scripts/visual-audit.js` — тот же список в строке 9 и `'style-digits'` в трёх местах снятия классов (~181, ~192, ~203).

- [ ] **Step 2: Обновить тест, прибивающий список литералом**

`tests/audit-2026-07-fixes.test.js:420`:

```js
    assert.match(runner, /const STYLES = \['circle', 'digital', 'flip', 'analog', 'digits'\]/);
```

- [ ] **Step 3: Прогнать юнит-тесты**

Run: `npm run ci`
Expected: PASS

- [ ] **Step 4: Снять кадры и посмотреть на них глазами**

```bash
npm run screenshot
ls screenshots/ | grep digits
```

Открыть новые кадры и убедиться, что цифры не обрезаны, стоят по центру и читаются. Это единственный шаг плана, где глаз уместен: он ловит то, для чего ещё нет замера.

- [ ] **Step 5: Переснять базу и сверить ТРИ раза подряд**

```bash
npm run visual:baseline
npm run visual:check && npm run visual:check && npm run visual:check
```
Expected: три прогона подряд по нулям. Один чистый прогон здесь ничего не доказывает — расхождения плавали 44 → 40 → 39 → 14 на одном и том же коде, пока не были починены детерминизм и профили.

- [ ] **Step 6: Коммит**

```bash
git add scripts/screenshot-runner.js scripts/visual-audit.js tests/audit-2026-07-fixes.test.js
git commit -m "test(visual): стиль «Цифры» попадает в съёмку и в визуальную сверку"
```

- [ ] **Step 7: Финальная проверка перед сдачей**

```bash
npm run ci
npx playwright test
```

Обе команды обязаны быть зелёными, вывод — показан. Слова «готово» до этого момента не употреблять.

---

## Самопроверка плана

**Покрытие спеки.** Пройдено по разделам: стиль в трёх окнах — задачи 4/5/6; выбор шрифта отдельно в каждом окне — 7; четыре шрифта — 2; модуль — 1; `applyTimerScale()` — 3; секция шрифтов в NOTICE — 2; замер ширины переключателя — задача 4, шаг 10; пин токенов светлой темы — задачи 4 и 5, отдельным шагом, и явное указание НЕ добавлять его часам — задача 6; e2e кликом — 4/5/6/7; круговой рейс — 7, шаг 11; съёмка и база — 8. Пробелов не осталось.

**Плейсхолдеры.** «Ближайший имеющийся вес» в задаче 2 — не заглушка, а явное указание что делать и что при этом поправить. Проверка `--tw-accent-soft` в задаче 7 сформулирована как конкретное действие с конкретной альтернативой.

**Согласованность имён.** `applyTimerScale()` определяется в задаче 3 и дополняется в задаче 4 — имя одно. `measureDigits` / `fitFontSize` / `clearProbeCache` / `applyFont` / `resolveFont` вызываются в задачах 4–7 ровно теми именами, которыми объявлены в задаче 1. Идентификаторы шрифтов (`inter`, `mono`, `bebas`, `oswald`, `orbitron`, `playfair`) совпадают в реестре, в тестах и в e2e. Ключи настроек (`widgetDigitsFont`, `clockDigitsFont`, `displayDigitsFont`) совпадают в схемах, в пакетах IPC и в e2e. Поле в пакете виджета названо `digitsFont`, а в пакете дисплея — `displayDigitsFont`: пакет `display-settings-update` слушают ДВА окна (дисплей и часы), поэтому там имя обязано быть однозначным, а `widget-style-update` адресован одному окну.
