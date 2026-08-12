# Редизайн, этап A: тема и стекло — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Погасить стекло и свечения во всех окнах и сделать светлую тему темой по умолчанию — так, чтобы приложение приблизилось к макету без единой правки разметки.

**Architecture:** Правки идут через токены `design-tokens.css`, потому что 46 из 53 объявлений `backdrop-filter` уже читают `var(--tw-blur*)`. Порядок внутри этапа обязателен: сначала тёмные поверхности становятся непрозрачными, и только потом снимается блюр — иначе панель на шаг превращается в полупрозрачную дыру на рабочий стол. Системный инвариант «плоско» получает своего владельца — новый `tests/flat-surfaces.test.js`, который читает исходники и падает на возврате стекла.

**Tech Stack:** Vanilla JS, CSS custom properties, `node --test` (без фреймворка), Playwright для e2e. Сборщика нет.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-12-redesign-all-windows-design.md`.
- Макет: `docs/redesign-2026-08-12.dc.html`. Числа берутся оттуда, не выдумываются.
- 2 пробела, одинарные кавычки, `eqeqeq: always`, `curly: always` (ESLint 9 flat config).
- Ни один канал IPC на этом этапе не добавляется и не удаляется.
- Разметка (`*.html`) на этом этапе **не трогается**, кроме inline-`<style>` в окнах виджета и часов.
- Каждый новый файл, попадающий в рантайм, обязан быть в `package.json` `build.files`. Тестовые файлы туда не идут.
- Комментарии в проекте русские, объясняют ПОЧЕМУ. Сохранять этот стиль.
- Готово = проверено: ни один шаг не считается сделанным без показанного вывода команды.

---

### Task 1: Светлая тема становится темой по умолчанию

**Files:**
- Modify: `ui-theme.js:18`
- Test: `tests/ui-theme.test.js:40-43`

**Interfaces:**
- Consumes: ничего.
- Produces: `UITheme.UI_THEME_DEFAULT === 'light'`. Задачи 2–4 сверяют контраст именно светлой темы как основной.

- [ ] **Step 1: Переписать тест на новый дефолт**

В `tests/ui-theme.test.js` найти блок, который сейчас читает так:

```js
    assert.equal(UITheme.normalizeTheme(junk), 'dark', `мусор ${JSON.stringify(junk)} обязан дать dark`);
```

Заменить на:

```js
    assert.equal(UITheme.normalizeTheme(junk), 'light', `мусор ${JSON.stringify(junk)} обязан дать light`);
```

В том же файле добавить отдельный тест — он прибивает НАМЕРЕНИЕ, а не только поведение функции:

```js
test('темой по умолчанию является светлая', () => {
    // Макет редизайна объявляет светлую тему темой по умолчанию. Проверяется
    // сама константа, а не только normalizeTheme: подмена дефолта — это
    // продуктовое решение, и оно обязано ломать тест, а не проезжать молча.
    assert.equal(UITheme.UI_THEME_DEFAULT, 'light');
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test tests/ui-theme.test.js`
Expected: FAIL — `Expected values to be strictly equal: 'dark' !== 'light'`.

- [ ] **Step 3: Поменять константу**

В `ui-theme.js:18`:

```js
const UI_THEME_DEFAULT = 'light';
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `node --test tests/ui-theme.test.js`
Expected: PASS.

- [ ] **Step 5: Прогнать весь набор — дефолт темы задевает многое**

Run: `node --test`
Expected: PASS. Если падает `tests/contrast.test.js` — не чинить здесь, записать имена упавших проверок и перейти к задаче 2: она меняет ровно те токены, на которых контраст считается.

- [ ] **Step 6: Коммит**

```bash
git add ui-theme.js tests/ui-theme.test.js
git commit -m "feat(theme): светлая тема по умолчанию"
```

---

### Task 2: Владелец инварианта «плоско» + непрозрачные тёмные поверхности

**Files:**
- Create: `tests/flat-surfaces.test.js`
- Modify: `design-tokens.css:49-52`

**Interfaces:**
- Consumes: ничего.
- Produces: `tests/flat-surfaces.test.js` с четырьмя проверками. Задачи 3 и 4 включают в нём по одной уже написанной, но пока пропущенной проверке — снимают `{ skip: true }`.

**Почему эта задача идёт ПЕРЕД снятием блюра.** Тёмные поверхности сейчас
полупрозрачны (`rgba(28,28,30,0.72)`) и читаемы только потому, что под ними
работает `backdrop-filter`. Снять блюр раньше, чем сделать их плотными, —
значит на один коммит превратить панель в полупрозрачную дыру на рабочий стол.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/flat-surfaces.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/**
 * Тело блока темы из design-tokens.css.
 * Светлая тема живёт в `[data-theme="light"]`, тёмная — в общем `:root`,
 * и порядок блоков в файле нарушать нельзя (см. docs/lessons.md, «A theme
 * block must sit BELOW the shared :root»). Поэтому тёмные значения берутся
 * из куска ДО первого `[data-theme="light"]`.
 */
function darkBlock(css) {
    const cut = css.indexOf('[data-theme="light"]');
    assert.ok(cut > 0, 'блок светлой темы исчез из design-tokens.css');
    return css.slice(0, cut);
}

test('тёмные поверхности непрозрачны: без блюра полупрозрачность станет дырой', () => {
    const dark = darkBlock(read('design-tokens.css'));
    const SURFACES = ['--tw-bg-surface', '--tw-bg-glass', '--tw-bg-timer', '--tw-bg-led'];

    for (const token of SURFACES) {
        const m = dark.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
        assert.ok(m, `токен ${token} исчез из тёмной темы`);
        const value = m[1].trim();
        assert.ok(
            !/rgba\s*\(/.test(value),
            `${token} в тёмной теме полупрозрачен (${value}). Редизайн снял blur, ` +
            'а значит под поверхностью больше нечему размывать фон.'
        );
    }
});

test('токены блюра погашены в обеих темах', { skip: 'включается задачей 3' }, () => {
    const css = read('design-tokens.css');
    const declarations = css.match(/--tw-blur[a-z-]*\s*:\s*[^;]+;/g) || [];
    assert.ok(declarations.length >= 6, 'объявления блюра пропали целиком — ожидались none');
    for (const d of declarations) {
        assert.match(d, /:\s*none\s*;/, `блюр вернулся: ${d.trim()}`);
    }
});

test('хардкодного backdrop-filter не осталось', { skip: 'включается задачей 3' }, () => {
    const FILES = ['control.css', 'display.css', 'electron-widget.html', 'electron-clock-widget.html'];
    for (const file of FILES) {
        const lines = read(file).split('\n');
        lines.forEach((line, i) => {
            if (!/backdrop-filter\s*:/.test(line)) { return; }
            if (/:\s*none/.test(line)) { return; }
            assert.fail(`${file}:${i + 1} — стекло вернулось: ${line.trim()}`);
        });
    }
});

test('внешних цветных свечений не осталось', { skip: 'включается задачей 4' }, () => {
    const FILES = ['control.css', 'display.css', 'electron-widget.html', 'electron-clock-widget.html'];
    // Ищем ТОЛЬКО внешнюю тень с ненулевым размытием и цветом. Не трогаем:
    //   `0 0 0 Npx` — это кольцо фокуса, формой а не свечением;
    //   `inset ...` — внутренняя тень, макет её сохраняет;
    //   `0 1px 3px` — подъём ручки тумблера, макет её сохраняет.
    const GLOW = /box-shadow\s*:\s*(?!.*inset)[^;]*?\b0\s+0\s+([1-9]\d*)px/;
    for (const file of FILES) {
        const lines = read(file).split('\n');
        lines.forEach((line, i) => {
            const m = line.match(GLOW);
            if (!m) { return; }
            assert.fail(`${file}:${i + 1} — свечение вернулось: ${line.trim()}`);
        });
    }
});
```

- [ ] **Step 2: Убедиться, что первый тест падает, а три пропускаются**

Run: `node --test tests/flat-surfaces.test.js`
Expected: FAIL на «тёмные поверхности непрозрачны» с текстом про `--tw-bg-surface`; три остальных — `skipped`.

- [ ] **Step 3: Сделать тёмные поверхности плотными**

В `design-tokens.css` заменить строки 49–52 на значения макета (тёмная панель макета — `#17171a`):

```css
  /* Плотные, а не полупрозрачные: редизайн снял backdrop-filter, и размывать
     под поверхностью стало нечего. Полупрозрачная поверхность без блюра —
     это дыра на рабочий стол, а не «стекло». */
  --tw-bg-surface:  #1e1e22;
  --tw-bg-glass:    #17171a;
  --tw-bg-timer:    #17171a;
  --tw-bg-led:      #0f0f12;
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `node --test tests/flat-surfaces.test.js`
Expected: PASS (1 passed, 3 skipped).

- [ ] **Step 5: Пересчитать контраст — он считался С учётом альфы**

Run: `node --test tests/contrast.test.js`
Expected: PASS. `tests/contrast.test.js` композитит альфу поверх фона; плотные поверхности убирают композитинг и контраст может только вырасти. Если он всё же упал — значит подобранное значение темнее прежнего результата композитинга; поднять `--tw-bg-surface` до `#212125` и прогнать снова.

- [ ] **Step 6: Прогнать весь набор**

Run: `node --test`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add design-tokens.css tests/flat-surfaces.test.js
git commit -m "feat(tokens): плотные тёмные поверхности + владелец инварианта «плоско»"
```

---

### Task 3: Снять стекло

**Files:**
- Modify: `design-tokens.css:143-145`, `design-tokens.css:236-238`
- Modify: `control.css:234-235`, `control.css:948-949`, `control.css:2948-2949`, `control.css:3029-3030`
- Modify: `control.css:124-139` (заливка панели)
- Test: `tests/flat-surfaces.test.js`

**Interfaces:**
- Consumes: плотные поверхности из задачи 2.
- Produces: ни одного действующего `backdrop-filter` в проекте.

- [ ] **Step 1: Включить две отложенные проверки**

В `tests/flat-surfaces.test.js` убрать `{ skip: 'включается задачей 3' }` у тестов
«токены блюра погашены в обеих темах» и «хардкодного backdrop-filter не осталось»,
оставив сигнатуру `test('...', () => {`.

- [ ] **Step 2: Убедиться, что они падают**

Run: `node --test tests/flat-surfaces.test.js`
Expected: FAIL дважды — на `--tw-blur: blur(40px) saturate(180%);` и на `control.css:234`.

- [ ] **Step 3: Погасить токены блюра в обеих темах**

`design-tokens.css:143-145` (тёмная тема):

```css
  /* Редизайн снял стекло целиком. Токены оставлены объявленными, а не удалены:
     их читают 46 объявлений в четырёх файлах, и удаление превратило бы каждое
     в невалидное `backdrop-filter: ;`. */
  --tw-blur:    none;
  --tw-blur-sm: none;
  --tw-blur-xs: none;
```

`design-tokens.css:236-238` (светлая тема) — теми же тремя строками `none`.

- [ ] **Step 4: Погасить четыре хардкодных места в control.css**

В каждой из четырёх пар строк (`234-235`, `948-949`, `2948-2949`, `3029-3030`)
заменить значение на `none`, сохранив обе строки — префиксную и обычную:

```css
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
```

- [ ] **Step 5: Убрать со дна панели градиенты, рамку и стекло**

`control.css:124-139`, блок `.app-shell::before`. Заменить `background`, `border`
и обе строки `backdrop-filter` так:

```css
.app-shell::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: var(--tw-r-2xl);
    /* Одна плоская заливка. Два радиальных градиента (фиолетовый и синий)
       и рамка 1px сняты: макет редизайна не имеет ни подцветки, ни рамок —
       поверхности разделяет расстояние. */
    background: var(--tw-bg-surface);
    border: 0;
    box-shadow: var(--tw-shadow-panel);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    pointer-events: none;
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `node --test tests/flat-surfaces.test.js`
Expected: PASS (3 passed, 1 skipped).

- [ ] **Step 7: Прогнать линт и весь набор**

Run: `npm run ci`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add design-tokens.css control.css tests/flat-surfaces.test.js
git commit -m "feat(ui): снять стекло — blur погашен во всех окнах"
```

---

### Task 4: Снять свечения

**Files:**
- Modify: `display.css:669`, `:679`, `:683-684`, `:727`, `:1022`, `:1083`, `:1291`, `:1302`, `:1310-1311`
- Modify: `control.css:962`, `:980`
- Test: `tests/flat-surfaces.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces: ни одного внешнего цветного свечения. Кольца фокуса, внутренние тени и подъём ручки тумблера сохраняются.

**Что НЕ трогать.** `0 0 0 Npx` — это кольцо, форма, а не свечение
(`control.css:622`, `:1716`). `inset 0 0 Npx` — внутренняя тень
(`electron-clock-widget.html:254`, `:301`). `0 1px 3px` и `0 2px 8px` — подъём,
макет их сохраняет (`control.css:695`, `:2452`). Регулярка теста уже написана
так, чтобы их пропускать; если она начнёт на них падать — сломана регулярка,
а не CSS.

- [ ] **Step 1: Включить последнюю отложенную проверку**

В `tests/flat-surfaces.test.js` убрать `{ skip: 'включается задачей 4' }` у теста
«внешних цветных свечений не осталось».

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test tests/flat-surfaces.test.js`
Expected: FAIL на `display.css:669`.

- [ ] **Step 3: Снять свечения в display.css**

Одиннадцать мест. В строках `669`, `679`, `1022`, `1083`, `1291`, `1302`, `727`
удалить объявление `box-shadow` целиком вместе со строкой. В четырёх кадрах
анимаций (`683`, `684`, `1310`, `1311`) удалить только часть `box-shadow: …;`,
сохранив `opacity`, иначе пульсация исчезнет вместе с правилом:

```css
@keyframes overtime-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.85; }
}
```

- [ ] **Step 4: Снять два свечения точки состояния в control.css**

`control.css:962` и `control.css:980` — удалить строки `box-shadow` целиком.
Цвет самой точки остаётся: состояние помечается цветом и формой, а не ореолом.

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `node --test tests/flat-surfaces.test.js`
Expected: PASS (4 passed, 0 skipped).

- [ ] **Step 6: Прогнать набор и e2e окраски**

Run: `npm run ci`
Expected: PASS.

Run: `npx playwright test e2e/color-ownership.spec.js e2e/color-band-reset.spec.js`
Expected: FAIL — оба спека сверяют ВЫЧИСЛЕННУЮ тень с эталоном, а тень мы только что убрали. Это ожидаемо: они прибивают старый вид.

- [ ] **Step 7: Обновить эталоны окраски в двух спеках**

В `e2e/color-ownership.spec.js` и `e2e/color-band-reset.spec.js` заменить ожидаемые
значения `boxShadow`/`textShadow` на `'none'` там, где они относятся к ореолу
состояния. Сверку ЦВЕТА не трогать — она остаётся, и именно она доказывает, что
состояние по-прежнему различимо без свечения.

Run: `npx playwright test e2e/color-ownership.spec.js e2e/color-band-reset.spec.js`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add display.css control.css tests/flat-surfaces.test.js e2e/color-ownership.spec.js e2e/color-band-reset.spec.js
git commit -m "feat(ui): снять свечения — состояние несут цвет и форма"
```

---

### Task 5: Верификация этапа и эталоны

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md` (строка про `tests/flat-surfaces.test.js` в таблице тестов)
- Modify: эталоны съёмки (перезапись `npm run screenshot`)

**Interfaces:**
- Consumes: результат задач 1–4.
- Produces: зелёный этап A, готовый к мержу.

- [ ] **Step 1: Полный прогон**

Run: `npm run ci`
Expected: PASS. Показать вывод целиком, включая число тестов.

- [ ] **Step 2: e2e на своей ОС**

Run: `npx playwright test`
Expected: PASS. Любое падение здесь — это поведение, а не вёрстка: `e2e` этого
проекта проверяют достижимость и поведение, а не пиксели.

- [ ] **Step 3: Пересъёмка эталонов**

Run: `npm run screenshot`
Expected: кадры сняты без ошибок. Просмотреть глазами четыре кадра: панель
светлая и плоская, у неё нет рамки и подцветки, у точки состояния нет ореола.

- [ ] **Step 4: Сверка**

Run: `npm run visual:check`
Expected: расхождения ЕСТЬ и они ожидаемы — этап специально менял вид. Убедиться,
что расхождения только по цвету и тени, а не по геометрии: сдвиг рамок означал
бы, что снятие `border: 1px` съело пиксель раскладки.

- [ ] **Step 5: Дописать CLAUDE.md**

В таблицу тестов добавить строку:

```markdown
| `flat-surfaces.test.js` | Инвариант «плоско»: блюр погашен в обеих темах, тёмные поверхности непрозрачны, хардкодного `backdrop-filter` нет, внешних цветных свечений нет. Кольца фокуса, внутренние тени и подъём ручки тумблера намеренно пропускаются — они форма и подъём, а не стекло |
```

- [ ] **Step 6: Дописать CHANGELOG.md**

Раздел этапа A: светлая тема по умолчанию, стекло и свечения сняты, тёмные
поверхности стали плотными.

- [ ] **Step 7: Коммит и мерж**

```bash
git add CLAUDE.md CHANGELOG.md screenshots
git commit -m "docs: этап A редизайна — тема, стекло, свечения"
```

Мержить в `main` только после зелёного `npm run ci` и `npx playwright test`.

---

## Что этот этап НЕ делает

Разметка панели, строки окон, полоса прогресса, состояния A–D, плоский виджет,
полоса дисплея и чип mini-bar — этапы B, C и D. Их планы пишутся после мержа
этого, потому что их задачи зависят от того, как лягут токены.
