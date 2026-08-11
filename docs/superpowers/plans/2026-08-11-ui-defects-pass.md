# Проход по дефектам интерфейса — план реализации

> **Для агентов:** используйте `superpowers:subagent-driven-development` или
> `superpowers:executing-plans`. Шаги помечены чекбоксами (`- [ ]`).

**Цель.** Закрыть семь находок осмотра 64 кадров: три измеренных цветовых и
геометрических дефекта, срезанный ряд вкладок, два разных контрола для одного
смысла, подпись сегментов в две строки и радиус дуги прогресса на дисплее.

**Подход.** Каждая правка идёт от красного теста. Для цветов тест считает
контраст ПАРЫ «цвет × фон, на котором он окажется» и проверяет обе темы; для
геометрии — меряет прямоугольники в живом окне через Playwright, потому что
уроки проекта прямо запрещают решать вопросы выравнивания осмотром. Порядок
задач — от «одна строка CSS» к «меняет эталонные кадры».

**Стек.** Electron, ванильный JS без сборщика, `node --test`, Playwright.
Спека: `docs/superpowers/specs/2026-08-11-ui-defects-pass.md`.

## Общие ограничения

- **Без сборщика.** Каждый файл — классический `<script>`; межмодульные ссылки
  идут через `window.X`. Голое имя ломает lint.
- **Новый модуль обязан попасть в `package.json` → `build.files`**, иначе он
  молча исчезнет из собранного приложения.
- **Порядок таблиц стилей несущий:** `fonts.css → design-tokens.css →
  control.css`. Закреплён `tests/control-decomposition.test.js`.
- **`design-tokens.css` держит токены, а не рецепты.** Правила компонентов
  живут в `control.css` и `display.css`.
- **Цвет — переменная, состояние — класс, инлайн не используется.**
- **Тесты уровня исходника обязаны срезать комментарии** через
  `tests/helpers/source-scan.js` (`codeOnly()`), иначе упоминание старого
  значения в комментарии пройдёт как реальный код.
- **Виджет и часы остаются тёмными в обеих темах** — фон там красит
  пользователь.
- **`npm run ci` (lint + unit) обязан быть зелёным перед каждым коммитом.**
- Порог контраста: текст — AA 4.5:1 в тёмной и AAA 7:1 в светлой;
  нетекстовый индикатор — 3:1.

---

### Задача 1: Фон выпадающих списков берётся из токена

**Файлы:**
- Изменить: `control.css:1868-1873` (правило `select option`)
- Изменить: `tests/contrast.test.js` (добавить проверку в конец)

**Интерфейсы:**
- Потребляет: `--tw-bg-surface-solid`, `--tw-fg`, `--tw-level-2` из
  `design-tokens.css`
- Отдаёт: ничего (правка внутри одного правила)

- [ ] **Шаг 1: Написать падающий тест**

В конец `tests/contrast.test.js`:

```js
// --- Фоны, вписанные в control.css литералом ---
// Тест контраста читал ТОЛЬКО design-tokens.css, поэтому цвет, вписанный
// литералом в компонентный файл, был для него невидим. Правило
// `select option { background: #1c1c1e; color: var(--tw-fg) }` задавало фон
// литералом, а текст токеном: в тёмной теме 17.01:1, в светлой 1.01:1 —
// списка всех восьми <select> панели в светлой теме не существовало.
// На macOS попап рисует система и дефекта не видно; Chromium на Windows и
// Linux применяет правило буквально.
const CONTROL_CSS = fs.readFileSync(path.join(__dirname, '..', 'control.css'), 'utf8');
const { codeOnly } = require('./helpers/source-scan.js');

test('фон выпадающего списка не задан литералом и читаем в обеих темах', () => {
    const css = codeOnly(CONTROL_CSS);
    assert.ok(
        !/#1c1c1e/i.test(css),
        'литерал #1c1c1e вернулся в control.css: в светлой теме он даёт 1.01:1 под --tw-fg'
    );

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
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запустить: `node --test tests/contrast.test.js`
Ожидание: FAIL — «литерал #1c1c1e вернулся в control.css».

- [ ] **Шаг 3: Починить правило**

В `control.css` заменить блок на:

```css
/* Фон пункта списка берётся из токена ПОВЕРХНОСТИ, а не литералом.
   Литерал #1c1c1e работал только в тёмной теме: в светлой --tw-fg
   становится #1d1d1f, и текст ложился на почти такой же фон — 1.01:1.
   Проверяется tests/contrast.test.js. */
select option,
.sound-select option {
    background: var(--tw-bg-surface-solid);
    color: var(--tw-fg);
}
```

- [ ] **Шаг 4: Убедиться, что тест проходит**

Запустить: `node --test tests/contrast.test.js`
Ожидание: PASS, в выводе `[option/тёмная] 16.61:1` и `[option/светлая] 15.08:1`.

- [ ] **Шаг 5: Коммит**

```bash
npm run ci
git add control.css tests/contrast.test.js
git commit -m "fix(theme): фон выпадающего списка берётся из токена, а не литералом"
```

---

### Задача 2: Индикатор открытого окна виден в обеих темах

**Файлы:**
- Изменить: `control.css:2831-2856` (`.quick-window-btn.active` и её `::after`)
- Изменить: `control.css:695-704` (переопределение светлой темы)
- Изменить: `tests/contrast.test.js`
- Изменить: `e2e/reachable-controls.spec.js` (добавить тест в конец)

**Интерфейсы:**
- Потребляет: `--tw-green`, `--tw-level-2`, `--tw-border` из токенов
- Отдаёт: класс `.quick-window-btn.active` продолжает означать «окно
  открыто» — контракт с `window-open-ownership` не меняется

- [ ] **Шаг 1: Написать падающий тест контраста**

В конец `tests/contrast.test.js`:

```js
test('индикатор открытого окна виден в обеих темах', () => {
    // Точка «окно открыто» брала --tw-green и лежала на заливке --tw-blue.
    // Оба токена в светлой теме тёмные (акценты Apple на белом не читаются,
    // поэтому у светлой темы свои, затемнённые): 1.03:1 — индикатора нет.
    // Порог 3:1 — нетекстовая графика.
    const NON_TEXT = 3.0;
    for (const [themeName, token] of [['тёмная', darkToken], ['светлая', hcToken]]) {
        const bg = parseColor(token('tw-level-2')).rgb;
        const ratio = contrast(composite(token('tw-green'), bg), bg);
        assert.ok(
            ratio >= NON_TEXT,
            `${themeName}: точка --tw-green на --tw-level-2 даёт ${ratio.toFixed(2)}:1, нужно ${NON_TEXT}:1`
        );
        console.log(`   [индикатор/${themeName}] ${ratio.toFixed(2)}:1`);
    }

    // И встречная проверка: заливка синим у активной кнопки не должна
    // вернуться — именно она делала точку невидимой.
    const css = codeOnly(CONTROL_CSS);
    const lightActive = /\[data-theme="light"\]\s*\.quick-window-btn\.active\s*\{[^}]*\}/.exec(css);
    if (lightActive) {
        assert.ok(
            !/background:\s*var\(--tw-blue\)/.test(lightActive[0]),
            'активная кнопка окна снова заливается --tw-blue: точка --tw-green на ней даёт 1.03:1'
        );
    }
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запустить: `node --test tests/contrast.test.js`
Ожидание: FAIL — «активная кнопка окна снова заливается --tw-blue».

- [ ] **Шаг 3: Переписать состояние кнопки**

В `control.css` заменить `.quick-window-btn.active` и её `::after` на:

```css
/* Открытое окно помечается ФОРМОЙ, а не только цветом: засечка слева плюс
   живая точка у подписи. Раньше состояние несла заливка, и в светлой теме
   она была синей (--tw-blue), а точка — зелёной (--tw-green): оба токена в
   этой теме тёмные, контраст 1.03:1, индикатора не существовало.
   Заодно с экрана уходит третий акцент — до правки одновременно светились
   зелёный активный пресет, зелёная галочка подтверждения и синяя заливка
   этих кнопок. Проверяется tests/contrast.test.js. */
.quick-window-btn.active {
    background: var(--tw-level-2);
    border-color: var(--tw-border-strong);
    color: var(--tw-fg);
    box-shadow: inset 2px 0 0 var(--tw-green);
}
.quick-window-btn.active .qw-icon {
    background: transparent;
    color: var(--tw-green);
}
.quick-window-btn { position: relative; }
.quick-window-btn.active::after {
    content: "";
    position: absolute;
    top: 6px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tw-green);
}
.quick-window-btn.active:hover {
    background: var(--tw-level-3);
}
```

Удалить переопределения светлой темы `[data-theme="light"]
.quick-window-btn.active` и `[data-theme="light"] .quick-window-btn.active
.qw-icon` целиком: правило выше работает в обеих темах через токены.

- [ ] **Шаг 4: Убедиться, что тест проходит**

Запустить: `node --test tests/contrast.test.js`
Ожидание: PASS, `[индикатор/тёмная] 8.22:1`, `[индикатор/светлая] 6.04:1`.

- [ ] **Шаг 5: Написать e2e — состояние отличимо не только цветом**

В конец `e2e/reachable-controls.spec.js`:

```js
test('открытое окно помечено формой, а не только цветом', async () => {
    const { app, control } = await launchApp();
    try {
        const probe = () => {
            const btn = document.getElementById('openWidgetBtn');
            const cs = getComputedStyle(btn);
            return { active: btn.classList.contains('active'), shadow: cs.boxShadow };
        };

        const before = await control.evaluate(probe);
        expect(before.active).toBe(false);

        await control.click('#openWidgetBtn');
        await control.waitForTimeout(600);

        const after = await control.evaluate(probe);
        expect(after.active).toBe(true);
        // Засечка — это inset-тень. Признак состояния, который переживает
        // смену темы: тень описана токеном, а не литералом.
        expect(after.shadow).toContain('inset');
        expect(after.shadow).not.toBe(before.shadow);

        // Вернуть профиль в исходное состояние: профиль e2e общий, и тест,
        // меняющий глобальное состояние, обязан его вернуть.
        await control.click('#openWidgetBtn');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});
```

- [ ] **Шаг 6: Прогнать e2e**

Запустить: `npx playwright test e2e/reachable-controls.spec.js`
Ожидание: PASS.

- [ ] **Шаг 7: Коммит**

```bash
npm run ci
git add control.css tests/contrast.test.js e2e/reachable-controls.spec.js
git commit -m "fix(theme): индикатор открытого окна виден в обеих темах"
```

---

### Задача 3: Тосты не ложатся на герой-время

**Файлы:**
- Изменить: `control.css:3353-3383` (`.toast-container`, `.toast`)
- Создать: `e2e/toast-placement.spec.js`

**Интерфейсы:**
- Потребляет: разметку `.toast-container`, создаваемую `ui-feedback.js`
- Отдаёт: ничего — API `Toast` не меняется

- [ ] **Шаг 1: Написать падающий e2e**

Создать `e2e/toast-placement.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Тост не имеет права закрывать герой-время.
 *
 * Контейнер тостов был прибит к `top: 40px`, а цифры героя по CSS начинаются
 * с 59px — пересечение 22px из 41. Это не только подсказка первого запуска:
 * так же приходят сообщение о восстановлении после падения и любые ошибки,
 * то есть сообщение закрывало ровно то, ради чего окно открыто.
 *
 * Проверяется ЗАМЕРОМ прямоугольников, а не осмотром: уроки проекта прямо
 * запрещают решать вопросы выравнивания на глаз.
 */
test('тост не пересекается с герой-временем', async () => {
    const { app, control } = await launchApp();
    try {
        const rects = await control.evaluate(async () => {
            window.Toast.show('Проверка размещения тоста');
            await new Promise(r => setTimeout(r, 400));
            const toast = document.querySelector('.toast');
            const hero = document.querySelector('.timer-display-main');
            if (!toast || !hero) { return null; }
            const t = toast.getBoundingClientRect();
            const h = hero.getBoundingClientRect();
            return {
                toast: { top: t.top, bottom: t.bottom },
                hero: { top: h.top, bottom: h.bottom }
            };
        });

        expect(rects).not.toBeNull();
        const overlap = Math.min(rects.toast.bottom, rects.hero.bottom)
                      - Math.max(rects.toast.top, rects.hero.top);
        expect(overlap, `тост перекрывает цифры на ${overlap.toFixed(1)}px`).toBeLessThanOrEqual(0);
    } finally {
        await app.close();
    }
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запустить: `npx playwright test e2e/toast-placement.spec.js`
Ожидание: FAIL — «тост перекрывает цифры на ~22px».

Если `window.Toast` окажется недоступен из `evaluate` (модуль мог не попасть
в `window`), проверить это ДО правки CSS: тест должен падать по перекрытию, а
не по `null`. При недоступности — заменить вызов на клик, порождающий тост, и
записать причину в комментарий теста.

- [ ] **Шаг 3: Опустить контейнер вниз**

В `control.css`:

```css
.toast-container {
    position: fixed;
    /* ВНИЗУ, а не сверху. При `top: 40px` контейнер стоял ровно на цифрах
       героя (они начинаются с 59px), и каждый тост — подсказка первого
       запуска, сообщение о восстановлении, ошибка загрузки звука — закрывал
       главное, что есть в окне. Замеряется e2e/toast-placement.spec.js. */
    bottom: var(--tw-s-10);
    left: 50%;
    transform: translateX(-50%);
    z-index: 10001;
    display: flex;
    /* Новый тост появляется ближе к краю и отталкивает предыдущие вверх, а
       не наоборот. */
    flex-direction: column-reverse;
    align-items: center;
    gap: var(--tw-s-2);
    pointer-events: none;
}
```

И в `.toast` заменить `transform: translateY(-10px)` на
`transform: translateY(10px)` — выезд снизу вверх.

- [ ] **Шаг 4: Убедиться, что тест проходит**

Запустить: `npx playwright test e2e/toast-placement.spec.js`
Ожидание: PASS.

- [ ] **Шаг 5: Коммит**

```bash
npm run ci
git add control.css e2e/toast-placement.spec.js
git commit -m "fix(panel): тосты уходят вниз и больше не закрывают герой-время"
```

---

### Задача 4: Подпись сегментированного контрола стоит над ним

**Файлы:**
- Изменить: `electron-control.html` (ряды со стилем виджета, часов, дисплея)
- Создать: `e2e/segmented-label.spec.js`

**Интерфейсы:**
- Потребляет: класс `.setting-block` из `control.css:1159` — уже существует и
  уже применён к «Шрифту цифр» ровно по этой причине
- Отдаёт: ничего; id контролов не меняются, поэтому
  `settings-schema.js` не трогается

- [ ] **Шаг 1: Найти все ряды с пятью сегментами**

Запустить: `grep -n 'class="segmented"' electron-control.html`
Записать список id. Ожидание: `timerStyle`, стиль часов, стиль дисплея.
Ряды с ДВУМЯ-ТРЕМЯ сегментами не трогаем — они в строку помещаются.

- [ ] **Шаг 2: Написать падающий e2e**

Создать `e2e/segmented-label.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Подпись контрола выбора стиля не ломается на две строки.
 *
 * Ящик настроек — 320px. В схеме «подпись слева — контрол справа» подпись
 * «Стиль таймера» вставала в две строки, а пять сегментов жались до касания
 * краёв. Схема `.setting-block` (подпись НАД контролом) уже применена к
 * «Шрифту цифр» — правка распространяет имеющийся приём, а не вводит новый.
 */
test('подпись стиля виджета занимает одну строку', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('.tab-btn[data-tab="timer"]');
        await control.waitForTimeout(500);

        const m = await control.evaluate(() => {
            const seg = document.getElementById('timerStyle');
            const block = seg.closest('.setting-block, .toggle-row');
            const label = block.querySelector('.toggle-label, .setting-label');
            const lh = parseFloat(getComputedStyle(label).lineHeight) || 0;
            return {
                labelHeight: label.getBoundingClientRect().height,
                lineHeight: lh,
                blockClass: block.className
            };
        });

        // Одна строка: высота подписи не превышает полутора интерлиньяжей.
        expect(m.labelHeight).toBeLessThanOrEqual(m.lineHeight * 1.5);
        expect(m.blockClass).toContain('setting-block');
    } finally {
        await app.close();
    }
});
```

- [ ] **Шаг 3: Убедиться, что тест падает**

Запустить: `npx playwright test e2e/segmented-label.spec.js`
Ожидание: FAIL — высота подписи вдвое больше интерлиньяжа.

- [ ] **Шаг 4: Перевести ряды на `.setting-block`**

Для каждого найденного на шаге 1 ряда заменить разметку вида

```html
<div class="toggle-row">
    <span class="toggle-label">Стиль таймера</span>
    <div class="segmented" id="timerStyle" role="radiogroup" aria-label="Стиль виджета" data-value="circle">
```

на

```html
<!-- .setting-block, а не .toggle-row: пять сегментов не помещаются в правую
     половину flex-строки ни при какой ширине ящика — подпись вставала в две
     строки. Тот же приём уже применён к «Шрифту цифр». -->
<div class="setting-block">
    <span class="toggle-label">Стиль таймера</span>
    <div class="segmented" id="timerStyle" role="radiogroup" aria-label="Стиль виджета" data-value="circle">
```

Атрибуты контрола (`id`, `role`, `aria-label`, `data-value`) не трогать: по
ним его находят `settings-schema.js` и существующие e2e.

- [ ] **Шаг 5: Дать сегментам равную долю**

В `control.css` рядом с правилами `.segmented`:

```css
/* Внутри .setting-block контрол занимает всю ширину, а сегменты делят её
   поровну: в строке они жались к краям и «Аналог» с «Цифры» почти касались
   границ. */
.setting-block .segmented { width: 100%; }
.setting-block .segmented button { flex: 1; }
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Запустить: `npx playwright test e2e/segmented-label.spec.js e2e/digits-style.spec.js e2e/settings-roundtrip.spec.js`
Ожидание: PASS во всех трёх. `digits-style` и `settings-roundtrip` здесь —
страховка: они ходят по этим же контролам кликами.

- [ ] **Шаг 7: Коммит**

```bash
npm run ci
git add electron-control.html control.css e2e/segmented-label.spec.js
git commit -m "fix(panel): подпись выбора стиля встала над сегментами"
```

---

### Задача 5: Вкладки настроек целиком в окне на минимальной высоте

**Файлы:**
- Создать: `e2e/min-size-layout.spec.js`
- Изменить: `control.css` (после диагностики)

**Интерфейсы:**
- Потребляет: `CONFIG.CONTROL_WINDOW_MIN_WIDTH` (380),
  `CONFIG.CONTROL_WINDOW_MIN_HEIGHT` (660) из `constants.js`
- Отдаёт: ничего

**Причина дефекта НЕ УСТАНОВЛЕНА.** Это единственная задача плана, где сначала
идёт диагностика. Гипотезы: сумма фиксированных высот секций превышает 660;
`max-height: 100vh` на `.control-panel` без прокрутки. Проверять по правилу
«диагностика до мутации».

- [ ] **Шаг 1: Написать падающий e2e**

Создать `e2e/min-size-layout.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * На минимальном размере окна панель помещается в окно целиком.
 *
 * При 380×660 — это и есть заявленный минимум — ряд вкладок настроек уходил
 * под нижний край: видно было около двух третей высоты кнопок.
 * tests/faq-and-hidden-controls.test.js это пропускает, потому что проверяет
 * «элемент не display:none», а не «элемент внутри окна»: кнопки оставались
 * кликабельными и формально достижимыми.
 */
test('при 380×660 ряд вкладок целиком внутри окна', async () => {
    const { app, control } = await launchApp();
    try {
        await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.setMinimumSize(380, 660);
            win.setSize(380, 660);
        });
        await control.waitForTimeout(600);

        const m = await control.evaluate(() => {
            const row = document.querySelector('.tabs-row');
            const r = row.getBoundingClientRect();
            return { bottom: r.bottom, top: r.top, viewport: window.innerHeight };
        });

        expect(m.bottom, `низ вкладок ${m.bottom.toFixed(1)} при высоте окна ${m.viewport}`)
            .toBeLessThanOrEqual(m.viewport);
    } finally {
        await app.close();
    }
});
```

- [ ] **Шаг 2: Убедиться, что тест падает, и записать число**

Запустить: `npx playwright test e2e/min-size-layout.spec.js`
Ожидание: FAIL. **Записать фактическое `bottom` и `viewport` из сообщения** —
это исходные данные диагностики, без них дальше идти нельзя.

- [ ] **Шаг 3: Диагностика — найти, что не помещается**

Запустить в том же окне и записать вывод:

```js
// Разовый замер, не тест: сумма высот детей панели против высоты окна.
await control.evaluate(() => {
    const panel = document.querySelector('.control-panel');
    const rows = [...panel.children].map(el => ({
        cls: el.className,
        h: +el.getBoundingClientRect().height.toFixed(1)
    }));
    const sum = rows.reduce((a, r) => a + r.h, 0);
    return { rows, sum, viewport: window.innerHeight, panelH: panel.getBoundingClientRect().height };
});
```

Вывод покажет, что именно переполняет окно. Правку выбирать ПО НЕМУ, а не по
гипотезе. Если сумма высот больше окна — ужимать секции в блоке
`@media (max-height: 700px)`; если сумма помещается, а панель всё равно выше —
искать `max-height`/`overflow` на `.control-panel`.

- [ ] **Шаг 4: Внести правку по результату диагностики**

Правка пишется здесь по факту шага 3. Требования к ней:
неизменны id и классы контролов; порог мишени `--tw-hit-min: 32px` не
нарушается; правка живёт в `control.css`, а не инлайном.

- [ ] **Шаг 5: Убедиться, что тест проходит**

Запустить: `npx playwright test e2e/min-size-layout.spec.js e2e/drawer-layout.spec.js`
Ожидание: PASS в обоих. `drawer-layout` — страховка: он меряет панель на
нормальной и максимальной ширине, и правка раскладки не имеет права его
сломать.

- [ ] **Шаг 6: Коммит**

```bash
npm run ci
git add control.css e2e/min-size-layout.spec.js
git commit -m "fix(panel): вкладки настроек помещаются в окно на минимальной высоте"
```

---

### Задача 6: Один вид контрола для одного смысла во вкладке «Звуки»

**Файлы:**
- Изменить: `electron-control.html` (пять рядов `.sound-item`)
- Изменить: `control.css:1311-1335` (`.sound-check`), `.sound-preview`
- Изменить: `tests/faq-and-hidden-controls.test.js` (доступное имя у нового
  контрола)

**Интерфейсы:**
- Потребляет: `.toggle-switch` + `.toggle-slider` — существующая разметка
  переключателя, та же, что у «Считать ниже нуля»
- Отдаёт: id чекбоксов НЕ меняются (`soundStartEnabled`, `soundEndEnabled`,
  `soundMinuteEnabled`, `soundOverrunEnabled`) — `settings-schema.js` их
  читает по id, и роундтрип обязан пройти без правки ожиданий

**Нативные `<select>` остаются нативными.** `attachFontSelect` завязан на
реестр `window.DigitsStyle.DIGIT_FONTS` и строит превью начертаний —
переиспользовать его нельзя, а писать универсальный список ради единообразия в
этот проход не входит. Дефект «нечитаемый список в светлой теме» закрыт
задачей 1.

- [ ] **Шаг 1: Зафиксировать текущее поведение — прогнать роундтрип ДО правки**

Запустить: `npx playwright test e2e/settings-roundtrip.spec.js`
Ожидание: PASS. Это опорная точка: после правки он обязан пройти **без
изменения ожидаемых значений**. Если ожидания придётся править — поменялось
поведение, а не оформление, и это повод остановиться.

- [ ] **Шаг 2: Заменить чекбокс на переключатель в первом ряду**

В `electron-control.html`, ряд `data-kind="start"`:

```html
<div class="sound-item" data-kind="start">
    <!-- Переключатель, а не нативный чекбокс: смысл тот же, что у общего
         выключателя звука над списком, и контрол обязан быть тем же. Плюс
         чекбокс был 14×14 при собственном минимуме мишени 32px
         (--tw-hit-min). id НЕ меняется: по нему настройку читает
         settings-schema.js. -->
    <label class="toggle-switch sound-toggle" title="Включить звук старта">
        <input type="checkbox" id="soundStartEnabled" aria-label="Звук старта включён">
        <span class="toggle-slider"></span>
    </label>
    <span class="sound-name">Старт</span>
    <div class="select-wrap">
```

`</label>` от старого `.sound-check` убрать, `<span class="sound-name">`
вынести из него.

- [ ] **Шаг 3: Прогнать роундтрип на одном ряду**

Запустить: `npx playwright test e2e/settings-roundtrip.spec.js`
Ожидание: PASS без правки ожиданий. Если упал — откатить шаг 2 и разбираться,
а не подгонять тест.

- [ ] **Шаг 4: Повторить для четырёх оставшихся рядов**

Ряды `end`, `minute`, `overrun` — та же замена, id сохраняются:
`soundEndEnabled`, `soundMinuteEnabled`, `soundOverrunEnabled`.

- [ ] **Шаг 5: Стили ряда и приглушённой кнопки**

В `control.css` заменить `.sound-check`-правила на:

```css
/* Ряд звука: переключатель — название — список — «прослушать».
   Выключенный ряд гасит и НАЗВАНИЕ: состояние читается по строке целиком, а
   не по одному контролу слева. */
.sound-item .sound-toggle { flex: 0 0 auto; }
.sound-item .sound-name {
    flex: 0 0 84px;
    font-size: 12px;
    font-weight: 500;
    color: var(--tw-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sound-item:has(input:not(:checked)) .sound-name { color: var(--tw-fg-dim); }

/* «Прослушать» — призрачная, а не залитая акцентом: четыре ярких квадрата
   подряд тянули внимание сильнее, чем настройки, ради которых пришли. */
.sound-preview {
    background: transparent;
    border: 1px solid var(--tw-border);
    color: var(--tw-fg-muted);
}
.sound-preview:hover { background: var(--tw-level-2); color: var(--tw-fg); }
```

- [ ] **Шаг 6: Прогнать всё, что ходит по звукам**

Запустить: `node --test tests/faq-and-hidden-controls.test.js && npx playwright test e2e/sound-events.spec.js e2e/settings-roundtrip.spec.js`
Ожидание: PASS. `faq-and-hidden-controls` проверяет, что у каждого чекбокса
есть доступное имя — новый `aria-label` его удовлетворяет.

- [ ] **Шаг 7: Коммит**

```bash
npm run ci
git add electron-control.html control.css tests/faq-and-hidden-controls.test.js
git commit -m "fix(sound): один вид переключателя на всю вкладку звуков"
```

---

### Задача 7: Радиус дуги прогресса на дисплее

**Файлы:**
- Изменить: `display.html:138` (`#progressRing`), `display.html:135`
  (`.ring-track`)
- Изменить: `display-script.js` (константа радиуса в расчёте длины дуги)
- Создать: `e2e/display-ring-proportion.spec.js`
- Пересъёмка: `tests/visual-baseline`

**Интерфейсы:**
- Потребляет: `--timer-box: min(60vw, 55vh, 1600px)` из `display.css:143` —
  **НЕ ТРОГАЕТСЯ**
- Отдаёт: длина окружности в `display-script.js` пересчитывается под новый
  радиус; формула `2πr` остаётся той же

**Замер, на котором основана задача** (живое окно 3440×1440):

```text
.timer-ring (бокс)            792 × 792     = 55,0% высоты  ← как задумано
дуга прогресса r=160 из 400   634px         = 44,0% высоты
внешняя окружность r=185      792 × 0,925   = 50,9% высоты
```

Между дугой и декоративной окружностью — пустая полоса 25 единиц из 400.
Первоначальный диагноз «кольцо маленькое, увеличить `--timer-box`» ОШИБОЧЕН:
эта величина настроена осознанно, рядом в CSS лежит разбор про 4K.

- [ ] **Шаг 1: Написать падающий e2e**

Создать `e2e/display-ring-proportion.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Дуга прогресса занимает долю высоты окна, а не пиксели.
 *
 * Порог задан ДОЛЕЙ намеренно: пиксельный сломался бы на другом разрешении, а
 * доля переносится между машинами. Замер до правки на 3440×1440: бокс кольца
 * 55,0% высоты, а сама дуга — 44,0%, потому что радиус дуги 160 из вьюбокса
 * 400. Разница уходила в пустую полосу между дугой и декоративной внешней
 * окружностью (r=185).
 */
test('дуга прогресса занимает не менее половины высоты окна', async () => {
    const { app, control } = await launchApp();
    try {
        await control.click('#openDisplayBtn');
        await control.waitForTimeout(1500);

        let display = null;
        for (const w of app.windows()) {
            const hit = await w.evaluate(() => !!document.querySelector('#progressRing')).catch(() => false);
            if (hit) { display = w; }
        }
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        const m = await display.evaluate(() => {
            const ring = document.querySelector('.timer-ring');
            const svg = document.querySelector('.timer-svg');
            const arc = document.querySelector('#progressRing');
            const box = ring.getBoundingClientRect().height;
            const viewBox = svg.viewBox.baseVal.width;   // 400
            const r = parseFloat(arc.getAttribute('r'));
            return {
                arcShare: (box * (2 * r) / viewBox) / window.innerHeight,
                boxShare: box / window.innerHeight,
                r
            };
        });

        expect(m.arcShare, `дуга занимает ${(m.arcShare * 100).toFixed(1)}% высоты`)
            .toBeGreaterThanOrEqual(0.48);
        // Дуга обязана остаться ВНУТРИ декоративной окружности r=185:
        // радиус плюс половина обводки (stroke-width 12) не больше 185.
        expect(m.r + 6).toBeLessThanOrEqual(185);

        await control.click('#openDisplayBtn');
        await control.waitForTimeout(400);
    } finally {
        await app.close();
    }
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запустить: `npx playwright test e2e/display-ring-proportion.spec.js`
Ожидание: FAIL — «дуга занимает 44.0% высоты».

- [ ] **Шаг 3: Найти все места, где зашит радиус 160**

Запустить: `grep -rn 'r="160"\|160\b.*радиус\|2 \* Math.PI \* 160\|circumference' display.html display-script.js`
Записать список. Длина окружности считается из радиуса — если она вписана
литералом, её придётся править вместе с радиусом, иначе дуга станет неверной
длины при том же значении прогресса.

- [ ] **Шаг 4: Поднять радиус до 176**

В `display.html` заменить `r="160"` на `r="176"` у `.ring-track` и у
`#progressRing`. Рядом — комментарий:

```html
<!-- r=176, а не 160: при stroke-width 12 внешний край дуги встаёт на 182 и
     остаётся внутри декоративной окружности r=185. Замер до правки: дуга
     занимала 44,0% высоты окна при боксе 55,0% — 11 процентных пунктов
     уходило в пустую полосу. --timer-box НЕ трогаем, он настроен осознанно
     (см. разбор про 4K в display.css). -->
```

В `display-script.js` пересчитать длину окружности под новый радиус по
найденным на шаге 3 местам.

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Запустить: `npx playwright test e2e/display-ring-proportion.spec.js e2e/display-timer-scale.spec.js e2e/overtime-palette.spec.js e2e/color-band-reset.spec.js`
Ожидание: PASS во всех четырёх. Последние три ходят по этой же дуге: масштаб,
палитра перерасхода и снятие полосы.

- [ ] **Шаг 6: Пересъёмка эталонов**

```bash
npm run screenshot && npm run visual:baseline
```

Просмотреть глазами кадры `display-*.png` и `style-*-display-*.png` перед
принятием: `visual:baseline` принимает ТЕКУЩИЙ вид за эталон, поэтому принять
можно и поломку.

- [ ] **Шаг 7: Коммит**

```bash
npm run ci
git add display.html display-script.js e2e/display-ring-proportion.spec.js tests/visual-baseline
git commit -m "fix(display): дуга прогресса занимает доступный ей радиус"
```

---

### Задача 8: Записать урок и обновить документацию

**Файлы:**
- Изменить: `docs/lessons.md` (новый разбор)
- Изменить: `CLAUDE.md` (строка-правило со ссылкой на разбор)
- Изменить: `AGENTS.md`, если он существует (правило зеркалится)

**Интерфейсы:**
- Потребляет: формат ссылок `CLAUDE.md` ↔ `docs/lessons.md`, который держит
  `tests/docs-integrity.test.js`

- [ ] **Шаг 1: Написать разбор в `docs/lessons.md`**

Заголовок: «Индикатор состояния — тоже цвет, и у него тоже есть владелец».
Содержание: тест контраста проверял только текстовые токены и только
`design-tokens.css`, поэтому оба цветовых дефекта прохода прошли мимо него —
один цвет был вписан литералом в `control.css`, второй был честным токеном, но
ложился на фон из другой темы. Проверять надо ПАРУ «цвет × фон, на котором он
окажется». Числа: 1.03:1 у индикатора окна, 1.01:1 у списка.

- [ ] **Шаг 2: Добавить строку-правило в `CLAUDE.md`**

В раздел «Gotchas», в том же формате, что и соседние строки, со ссылкой на
якорь нового разбора.

- [ ] **Шаг 3: Проверить связность документации**

Запустить: `node --test tests/docs-integrity.test.js`
Ожидание: PASS. Тест держит и потолок размера самого `CLAUDE.md` — он
попадает в контекст каждого разговора целиком.

- [ ] **Шаг 4: Полный прогон**

```bash
npm run ci && npx playwright test
```
Ожидание: PASS. Число тестов не фиксировать нигде — ни в коде, ни в
документации.

- [ ] **Шаг 5: Коммит**

```bash
git add docs/lessons.md CLAUDE.md
git commit -m "docs: урок про владельца цвета у индикаторов состояния"
```

---

## Самопроверка плана

**Покрытие спеки.** Семь пунктов спеки → задачи 1–7 по порядку; раздел «Что
записать в уроки» → задача 8. Раздел «Границы» задач не порождает: полосы
состояния, тёмные виджет и часы, свёрнутая полоса — всё вынесено за периметр
явно.

**Плейсхолдеры.** Шаг 4 задачи 5 намеренно не содержит кода: причина дефекта
не установлена, и написать правку до диагностики значило бы угадать. Требования
к правке при этом заданы. Все остальные шаги содержат код целиком.

**Согласованность имён.** `--tw-level-2`, `--tw-green`, `--tw-fg`,
`--tw-bg-surface-solid` — из `design-tokens.css`. `codeOnly` — из
`tests/helpers/source-scan.js`. `launchApp` — из `e2e/launch.js`. id контролов
звука в задаче 6 совпадают с теми, что читает `settings-schema.js`.

**Порядок.** Задачи 1–4 независимы. Задача 5 трогает раскладку панели и идёт
после 4, чтобы диагностика шла по уже выправленной разметке. Задача 6
независима. Задача 7 последняя: она одна меняет эталонные кадры.
