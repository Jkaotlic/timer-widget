# Якорь масштабирования виджета и часов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Изменение размера виджета и часов сохраняет центр окна и оставляет окно целиком в рабочей области своего монитора, чтобы после увеличения масштаба таймер не уезжал за край экрана.

**Architecture:** Арифметика уходит в чистую функцию `fitScaledBounds()` в `window-geometry.js` — на входе только прямоугольники, никакого Electron, поэтому она проверяется в Node без запуска приложения. `resizeWindowClamped()` в главном процессе сжимается до «взять границы → найти дисплей → позвать функцию → `setBounds()`». Рендереры не трогаются, новых IPC-каналов не добавляется.

**Tech Stack:** Electron 43, ванильный JS без сборщика, `node --test` для юнитов, `@playwright/test` для e2e.

**Спека:** `docs/superpowers/specs/2026-08-10-window-scale-anchor-design.md`

## Global Constraints

- **Ни одного нового IPC-канала.** Ни в `preload.js`, ни в `channel-validator.js`.
- **Рендереры виджета и часов не трогаются** — кроме запасного плана в задаче 4, и только если его потребует замер.
- **Стиль:** отступ 2 пробела, одинарные кавычки, camelCase для переменных и функций, UPPER_CASE для констант. ESLint 9 держит `eqeqeq: always` и `curly: always`.
- **Комментарии — на русском**, в тоне остального проекта: объяснять ПОЧЕМУ, а не пересказывать код.
- **Никогда не запускать `perl -pi` по этим файлам** — они UTF-8 с кириллицей, Perl читает байты как latin-1 и превращает весь файл в мохнатицу. Только Edit или Python с явным `encoding='utf-8'`.
- **Новых поставляемых файлов нет**, поэтому `package.json` `build.files` не меняется: `window-geometry.js` там уже перечислен, e2e-спеки не поставляются.
- **«Готово» = прогнанная команда с показанным выводом.** «Посмотрел код» доказательством не является.

**Не входит в этот план** (замечено попутно, отдельной задачей): `CLOCK_WIDGET_MIN_SIZE: 100` в `constants.js` разошёлся с настоящим `minWidth: 120` окна часов — та же болезнь мёртвого реестра, что и у `WIDGET_DEFAULT_*`, но чинить её здесь значило бы расширять диff.

---

### Task 1: Чистая функция `fitScaledBounds()`

**Files:**
- Modify: `window-geometry.js` (добавить функцию и внести её в экспорт `WindowGeometry`)
- Test: `tests/window-geometry.test.js` (дописать блок тестов в конец)

**Interfaces:**
- Consumes: ничего (первая задача).
- Produces: `fitScaledBounds(current, requested, workArea, min) -> {x, y, width, height}`, где `current` и `workArea` — `{x, y, width, height}`, `requested` — `{width, height}` (значения могут быть любым мусором из IPC), `min` — `{width, height}`. Экспортируется через `module.exports = WindowGeometry` и через `window.WindowGeometry`. Задача 2 берёт её из `require('./window-geometry')`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в конец `tests/window-geometry.test.js`:

```js
// --- границы при смене размера ---------------------------------------------

// Рабочая область как на настоящем мониторе, где дефект и замерен:
// 3440×1440 со строкой меню сверху.
const WORK_AREA = { x: 0, y: 30, width: 3440, height: 1320 };
const WIDGET_MIN = { width: 120, height: 140 };

function centerOf(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

test('увеличение сохраняет центр окна', () => {
    // Позиция выбрана так, чтобы выросшему окну хватало места со всех сторон:
    // центр 1000×1000 в этой рабочей области обязан лежать в x 500…2940,
    // y 530…850. Иначе сработает поджатие, и тест будет проверять уже его.
    const current = { x: 1000, y: 500, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 1000, height: 1000 }, WORK_AREA, WIDGET_MIN);

    assert.deepEqual(centerOf(next), centerOf(current),
        'центр обязан остаться на месте: содержимое в окне отцентрировано, ' +
        'и смещение центра — это и есть уехавший за край циферблат');
    assert.equal(next.width, 1000);
    assert.equal(next.height, 1000);
});

test('поджатие ПОБЕЖДАЕТ сохранение центра, когда они спорят', () => {
    // Центр окна (1000, 400) 250×250 — это y = 525, а выросшему до 1000 px
    // окну нужен центр не выше 530, иначе верхняя кромка уходит выше рабочей
    // области. Приоритет не вкусовой: выше рабочей области macOS окно всё равно
    // не пускает, поэтому сохранённый центр был бы недостижим.
    const current = { x: 1000, y: 400, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 1000, height: 1000 }, WORK_AREA, WIDGET_MIN);

    assert.equal(next.y, WORK_AREA.y, 'окно прижато к верху рабочей области');
    assert.equal(centerOf(next).y, 530, 'центр сместился ровно на недостающие 5 px');
    assert.equal(centerOf(next).x, centerOf(current).x, 'по горизонтали спора нет — центр сохранён');
});

test('уменьшение тоже сохраняет центр', () => {
    const current = { x: 1000, y: 400, width: 1000, height: 1000 };
    const next = fitScaledBounds(current, { width: 250, height: 250 }, WORK_AREA, WIDGET_MIN);

    assert.deepEqual(centerOf(next), centerOf(current));
    assert.equal(next.width, 250);
});

test('окно у правого верхнего угла уезжает ВНУТРЬ, а не наружу', () => {
    // Ровно замеренный дефект: виджет стоит в правом верхнем углу
    // (3170, 30) 250×280, масштаб 400% давал x = 3170…4170 при экране 3440.
    const current = { x: 3170, y: 30, width: 250, height: 280 };
    const next = fitScaledBounds(current, { width: 1000, height: 1000 }, WORK_AREA, WIDGET_MIN);

    assert.deepEqual(next, { x: 2440, y: 30, width: 1000, height: 1000 });
    assert.ok(next.x + next.width <= WORK_AREA.x + WORK_AREA.width, 'правый край в кадре');
    assert.ok(next.y >= WORK_AREA.y, 'верх не выше рабочей области');
});

test('окно у нижнего края уезжает вверх на столько, на сколько нужно', () => {
    // Часы: (3200, 1060) 220×220, масштаб 400% давал y = 1060…1940 при экране 1440.
    const current = { x: 3200, y: 1060, width: 220, height: 220 };
    const next = fitScaledBounds(current, { width: 880, height: 880 }, WORK_AREA, { width: 120, height: 120 });

    assert.deepEqual(next, { x: 2560, y: 470, width: 880, height: 880 });
    assert.ok(next.y + next.height <= WORK_AREA.y + WORK_AREA.height, 'низ в кадре');
});

test('монитор с ненулевым началом координат считается по СВОИМ границам', () => {
    // Второй экран слева от главного: отрицательный x. Раньше поджатие шло по
    // getPrimaryDisplay(), то есть по чужим размерам.
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    const current = { x: -300, y: 900, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 900, height: 900 }, left, WIDGET_MIN);

    assert.ok(next.x >= left.x, `x=${next.x} не должен быть левее ${left.x}`);
    assert.ok(next.x + next.width <= left.x + left.width, 'правый край в пределах своего экрана');
    assert.ok(next.y + next.height <= left.y + left.height, 'нижний край в пределах своего экрана');
});

test('запрошенный размер больше рабочей области поджимается до неё', () => {
    const current = { x: 100, y: 100, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 9000, height: 9000 }, WORK_AREA, WIDGET_MIN);

    assert.equal(next.width, WORK_AREA.width);
    assert.equal(next.height, WORK_AREA.height);
    assert.equal(next.x, WORK_AREA.x);
    assert.equal(next.y, WORK_AREA.y);
});

test('мусор по одной оси ИГНОРИРУЕТСЯ, вторая ось применяется', () => {
    // Раньше здесь стояло `Number(width) || 220`: ширина 0/NaN/undefined
    // превращала окно в 220 px независимо от того, каким оно было. Подогнать
    // испорченное значение — значит молча показать окно неожиданного размера.
    const current = { x: 1000, y: 400, width: 250, height: 250 };

    for (const bad of [NaN, Infinity, -Infinity, 0, -5, undefined, null, 'много', {}]) {
        const next = fitScaledBounds(current, { width: bad, height: 600 }, WORK_AREA, WIDGET_MIN);
        assert.equal(next.width, 250, `ширина при мусоре ${String(bad)} обязана остаться прежней`);
        assert.equal(next.height, 600, `высота при мусоре в ширине обязана примениться`);
    }
});

test('минимум окна ПОБЕЖДАЕТ рабочую область, границы не инвертируются', () => {
    // Вырожденный случай: монитор уже минимального размера окна. Верхняя
    // граница поджатия оказывается меньше нижней — результат обязан быть
    // определён, а не «как получится».
    const tiny = { x: 0, y: 0, width: 80, height: 80 };
    const current = { x: 0, y: 0, width: 250, height: 250 };
    const next = fitScaledBounds(current, { width: 250, height: 250 }, tiny, WIDGET_MIN);

    assert.equal(next.width, WIDGET_MIN.width);
    assert.equal(next.height, WIDGET_MIN.height);
    assert.equal(next.x, tiny.x, 'прижато к левому краю');
    assert.equal(next.y, tiny.y, 'прижато к верхнему краю');
});

test('результат — целые числа: setBounds не принимает дроби', () => {
    const current = { x: 101, y: 201, width: 251, height: 251 };
    const next = fitScaledBounds(current, { width: 333, height: 333 }, WORK_AREA, WIDGET_MIN);

    for (const [k, v] of Object.entries(next)) {
        assert.equal(Number.isInteger(v), true, `${k}=${v} обязано быть целым`);
    }
});
```

Добавить `fitScaledBounds` в деструктуризацию `require` в начале файла:

```js
const {
    createWindowGeometry,
    isWindowDragTarget,
    bindWindowDrag,
    fitScaledBounds,
    MIN_SCALE_PCT,
    MAX_SCALE_PCT
} = require('../window-geometry');
```

- [ ] **Step 2: Прогнать и убедиться, что падают**

Run: `node --test tests/window-geometry.test.js`
Expected: FAIL — `TypeError: fitScaledBounds is not a function` во всех девяти новых тестах. Старые тесты файла обязаны остаться зелёными.

- [ ] **Step 3: Написать функцию**

В `window-geometry.js`, после `isWindowDragTarget` и перед `bindWindowDrag`:

```js
/**
 * Границы окна при смене размера: центр сохраняется, прямоугольник целиком
 * укладывается в рабочую область.
 *
 * Зачем: размер менялся через `win.setSize()`, то есть с неподвижным
 * ЛЕВЫМ-ВЕРХНИМ углом, а позицию после этого не правил никто. Содержимое в
 * этих окнах отцентрировано, поэтому при увеличении циферблат уезжал
 * вниз-вправо ровно на половину прироста и вылезал за край экрана (замер:
 * виджет при 400% занимал x = 3170…4170 при ширине экрана 3440). Вернуть его
 * перетаскиванием мешал потолок macOS: выше рабочей области окно не
 * поднимается НИ ПРИ КАКОМ уровне — floating, screen-saver и pop-up-menu,
 * setPosition и setBounds все дают y рабочей области. Значит чинить надо так,
 * чтобы наверх не требовалось двигать.
 *
 * Функция чистая — на входе только прямоугольники, ни одного обращения к
 * Electron, — поэтому вся арифметика проверяется в Node без запуска
 * приложения.
 *
 * @param {{x:number,y:number,width:number,height:number}} current — текущие границы окна
 * @param {{width:*,height:*}} requested — запрошенный размер; приходит из IPC, то есть может быть мусором
 * @param {{x:number,y:number,width:number,height:number}} workArea — рабочая область ЕГО монитора
 * @param {{width:number,height:number}} min — минимальный размер окна
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function fitScaledBounds(current, requested, workArea, min) {
    // Размер по одной оси. Мусор ИГНОРИРУЕТСЯ, а не подменяется числом: раньше
    // здесь стояло `Number(width) || 220`, и нулевая или нечисловая ширина
    // молча делала окно 220 px независимо от его базового размера.
    const sideSize = (asked, currentSide, minSide, areaSide) => {
        const value = Number(asked);
        const wanted = Number.isFinite(value) && value > 0 ? value : currentSide;
        // Минимум окна побеждает рабочую область: на мониторе уже минимума
        // окно всё равно нельзя сделать меньше.
        return Math.round(Math.max(minSide, Math.min(wanted, Math.max(minSide, areaSide))));
    };

    // Позиция по одной оси. Нижняя граница побеждает верхнюю: если окно шире
    // монитора, верхняя оказывается меньше нижней, и окно прижимается к
    // левому/верхнему краю вместо неопределённого результата.
    const sidePos = (center, size, areaStart, areaSize) => Math.round(
        Math.max(areaStart, Math.min(center - size / 2, areaStart + areaSize - size))
    );

    const width = sideSize(requested.width, current.width, min.width, workArea.width);
    const height = sideSize(requested.height, current.height, min.height, workArea.height);

    return {
        x: sidePos(current.x + current.width / 2, width, workArea.x, workArea.width),
        y: sidePos(current.y + current.height / 2, height, workArea.y, workArea.height),
        width,
        height
    };
}
```

И внести в объект экспорта:

```js
const WindowGeometry = {
    createWindowGeometry,
    isWindowDragTarget,
    bindWindowDrag,
    fitScaledBounds,
    MIN_SCALE_PCT,
    MAX_SCALE_PCT
};
```

- [ ] **Step 4: Прогнать и убедиться, что зелено**

Run: `node --test tests/window-geometry.test.js`
Expected: PASS, все тесты файла — и новые девять, и старые.

- [ ] **Step 5: Линт и коммит**

```bash
npm run lint
git add window-geometry.js tests/window-geometry.test.js
git commit -m "feat(geometry): fitScaledBounds — масштаб от центра с поджатием в рабочую область"
```

---

### Task 2: e2e доказывает дефект, главный процесс его чинит

**Files:**
- Create: `e2e/window-scale-fit.spec.js`
- Modify: `electron-main.js` (импорт вверху файла; функция `resizeWindowClamped`, строки 172-183)

**Interfaces:**
- Consumes: `fitScaledBounds(current, requested, workArea, min)` из задачи 1.
- Produces: изменённое поведение каналов `widget-resize` и `clock-widget-resize`. Задача 3 дописывает второй сценарий в тот же файл спека и переиспользует его вспомогательные функции `findWindow(app, urlPart)`, `boundsOf(app, urlPart)`, `workAreaOf(app, urlPart)` и константу `WINDOWS`.

- [ ] **Step 1: Написать падающий e2e-спек**

Создать `e2e/window-scale-fit.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Масштабирование окна не должно выбрасывать его за край экрана.
 *
 * Что здесь красное до исправления (замерено зондом на 3440×1440): виджет при
 * 400% занимал x = 3170…4170, то есть 730 px за правым краем; часы —
 * y = 1060…1940 при высоте экрана 1440. Вернуть окно наверх нельзя: macOS не
 * пускает его выше рабочей области ни при каком уровне окна.
 *
 * Мерится настоящий BrowserWindow.getBounds(), а не DOM: дефект был именно в
 * геометрии окна, и вся отрисовка внутри него была безупречна.
 */

const WINDOWS = [
    {
        name: 'виджет',
        open: 'open-widget',
        close: 'close-widget',
        url: 'electron-widget.html',
        resize: 'widget-resize',
        base: 250
    },
    {
        name: 'часы',
        open: 'open-clock-widget',
        close: 'close-clock-widget',
        url: 'electron-clock-widget.html',
        resize: 'clock-widget-resize',
        base: 220
    }
];

async function findWindow(app, urlPart) {
    for (let attempt = 0; attempt < 40; attempt++) {
        for (const w of app.windows()) {
            const href = await w.evaluate(() => location.href).catch(() => '');
            if (href.includes(urlPart)) { return w; }
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`окно ${urlPart} не появилось`);
}

function boundsOf(app, urlPart) {
    return app.evaluate(({ BrowserWindow }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        return win ? win.getBounds() : null;
    }, urlPart);
}

function workAreaOf(app, urlPart) {
    return app.evaluate(({ BrowserWindow, screen }, part) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(part));
        return win ? screen.getDisplayMatching(win.getBounds()).workArea : null;
    }, urlPart);
}

for (const target of WINDOWS) {
    test(`${target.name}: после увеличения масштаба окно целиком в рабочей области`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const win = await findWindow(app, target.url);
            await win.waitForLoadState('domcontentloaded');
            await win.waitForTimeout(800);

            // 400% ТЕМ ЖЕ каналом, которым это делает Ctrl+колесо и ползунок
            // «Масштаб» в панели, — иначе тест проверял бы обходной путь.
            const size = target.base * 4;
            await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
                { ch: target.resize, size });
            await win.waitForTimeout(700);

            const bounds = await boundsOf(app, target.url);
            const area = await workAreaOf(app, target.url);

            expect(bounds, 'границы окна должны читаться').toBeTruthy();
            expect(bounds.x, `левый край ${bounds.x} левее рабочей области ${area.x}`)
                .toBeGreaterThanOrEqual(area.x);
            expect(bounds.y, `верх ${bounds.y} выше рабочей области ${area.y}`)
                .toBeGreaterThanOrEqual(area.y);
            expect(bounds.x + bounds.width, 'правый край за пределами экрана')
                .toBeLessThanOrEqual(area.x + area.width);
            expect(bounds.y + bounds.height, 'нижний край за пределами экрана')
                .toBeLessThanOrEqual(area.y + area.height);
        } finally {
            await app.close();
        }
    });
}
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test e2e/window-scale-fit.spec.js`
Expected: FAIL в обоих тестах на правом крае.

**Отступление от плана, сделанное при исполнении:** окно паркуется в правый верхний угол рабочей области ДО масштабирования — вспомогательной функцией `parkAtTopRight(app, urlPart)` в том же спеке. Без неё тест зависел бы от того, где окно открылось на конкретной машине, и мог бы вхолостую зеленеть на другом экране. Фактический вывод до исправления: виджет и часы оба вылезли за правый край, у часов `правый край 4100 за пределами 3440`.

- [ ] **Step 3: Переписать `resizeWindowClamped`**

В `electron-main.js` дописать импорт рядом с остальными (после `const { createTimerController } = require('./timer-controller');`):

```js
const { fitScaledBounds } = require('./window-geometry');
```

Заменить функцию целиком:

```js
// Изменение размера безрамочного окна. Держит неподвижным ЦЕНТР окна и
// укладывает результат в рабочую область ТОГО монитора, где окно находится.
//
// Раньше здесь был `win.setSize()`: он оставляет неподвижным левый-верхний
// угол, а позицию не правит никто, — поэтому окно росло вниз-вправо и уезжало
// за край экрана, унося с собой отцентрированный внутри циферблат. Поджатие
// шло вдобавок по getPrimaryDisplay(), то есть на втором мониторе по чужим
// размерам.
//
// setBounds, а не setSize + setPosition: два вызова дают промежуточный кадр
// «уже большое, ещё не сдвинутое».
//
// Вся арифметика — в чистой fitScaledBounds() из window-geometry.js, чтобы
// проверяться в Node без запуска Electron.
function resizeWindowClamped(win, payload) {
    if (!isPayloadObject(payload)) { return; }
    if (!win || win.isDestroyed()) { return; }

    const current = win.getBounds();
    // Минимум берётся у самого окна, а не из литерала: у виджета minHeight 140,
    // и посчитанный по литералу центр промахнулся бы мимо настоящего.
    const [minWidth, minHeight] = win.getMinimumSize();
    const { workArea } = screen.getDisplayMatching(current);

    win.setBounds(fitScaledBounds(current, payload, workArea, { width: minWidth, height: minHeight }));
}
```

- [ ] **Step 4: Прогнать e2e и юниты**

Run: `npx playwright test e2e/window-scale-fit.spec.js`
Expected: PASS в обоих тестах.

Run: `node --test`
Expected: PASS целиком. Особое внимание — `tests/electron-main-source.test.js` (он проверяет, что обработчики не разбирают payload в параметрах; сигнатура `(_event, payload)` сохранена) и `tests/window-open-ownership.test.js`.

- [ ] **Step 5: Линт и коммит**

```bash
npm run lint
git add electron-main.js e2e/window-scale-fit.spec.js
git commit -m "fix(geometry): масштаб виджета и часов держит центр и не выносит окно за экран"
```

---

### Task 3: Замерить, переживает ли геометрия переоткрытие

Это задача-вопрос: она либо подтверждает, что всё уже работает, либо вскрывает вторую половину дефекта. Ответ даёт только замер — читать код бесполезно, потому что он лежит в порядке синхронизации визуальных свойств внутри Chromium.

**Files:**
- Modify: `e2e/window-scale-fit.spec.js` (дописать второй сценарий)
- Modify (ТОЛЬКО если замер потребует): `electron-widget.html`, `electron-clock-widget.html`

**Interfaces:**
- Consumes: `findWindow`, `boundsOf`, `WINDOWS` из задачи 2.
- Produces: ничего для следующих задач.

- [ ] **Step 1: Дописать сценарий переоткрытия**

В конец `e2e/window-scale-fit.spec.js`:

```js
for (const target of WINDOWS) {
    test(`${target.name}: масштаб и позиция переживают переоткрытие`, async () => {
        const { app, control } = await launchApp();
        try {
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const win = await findWindow(app, target.url);
            await win.waitForLoadState('domcontentloaded');
            await win.waitForTimeout(800);

            const size = target.base * 3;
            await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
                { ch: target.resize, size });
            // Ждём дольше обычного: setBounds вызывает в рендерере resize,
            // тот пишет геометрию в localStorage, и записи надо дать случиться.
            await win.waitForTimeout(1200);
            const before = await boundsOf(app, target.url);

            await control.evaluate((ch) => window.electronAPI.send(ch), target.close);
            await control.waitForTimeout(700);
            await control.evaluate((ch) => window.electronAPI.send(ch), target.open);
            const reopened = await findWindow(app, target.url);
            await reopened.waitForLoadState('domcontentloaded');
            await reopened.waitForTimeout(1400);

            const after = await boundsOf(app, target.url);

            // Допуск в 2 px: округление процента масштаба туда-обратно
            // (outerWidth → pct → размер) законно даёт единицу.
            expect(Math.abs(after.width - before.width), `ширина ${before.width} → ${after.width}`)
                .toBeLessThanOrEqual(2);
            expect(Math.abs(after.x - before.x), `позиция по x ${before.x} → ${after.x}`)
                .toBeLessThanOrEqual(2);
            expect(Math.abs(after.y - before.y), `позиция по y ${before.y} → ${after.y}`)
                .toBeLessThanOrEqual(2);
        } finally {
            await app.close();
        }
    });
}
```

- [ ] **Step 2: Прогнать и ПРОЧИТАТЬ вывод**

Run: `npx playwright test e2e/window-scale-fit.spec.js`

Здесь две законные развязки, и выбор делается по выводу, а не по ожиданию:

- **Зелено** — `window.screenX` успевает обновиться к моменту `resize`. Шаги 3 и 4 пропускаются, сразу шаг 5.
- **Красно по `x`/`y`** — рендерер сохраняет позицию ДО того, как окно доехало. Это вторая половина дефекта, и её надо чинить: шаги 3 и 4.

---

**ЧТО ЗАМЕР ПОКАЗАЛ НА ДЕЛЕ (вписано при исполнении).** Ни одна из двух развязок не случилась, и запасной план оказался лекарством не от той болезни.

Гипотеза «`window.screenX` устарел» **опровергнута**: зонд повесил слушателя на `resize` и получил `{outerWidth: 750, screenX: 2690}` — всё свежее, гонки нет. `requestAnimationFrame` был бы не нужен.

Красным оказалось **не** `x`/`y`, а **ширина**: `750 → 250` у виджета и `660 → 880` у часов. Воспроизведение последовательности полного прогона дало прямое противоречие:

```text
[1] storage  : {"scalePct":400,"x":2440,"y":30}          ← запуск 1 записал 400 %
[2] storage на старте : {"scalePct":100,"x":3170,"y":30} ← а прочиталось 100 %
[2] границы на старте : {"x":2440,"y":30,"width":1000,"height":1000}  ← окно при этом 400 %
```

Окно восстановилось верно, а хранилище оказалось затёрто значениями **до** восстановления (`x: 3170` — позиция открытия по умолчанию). Причина: `restore()` выставляет `scalePct = 400` сразу (иначе эхо его же `resize` запишет позицию до того, как её применит `*-set-position`), но окно в этот момент ещё 250 px. Раннее событие `resize` даёт `pct = 100`, оно `!== 400` — и защита, написанная чтобы гасить эхо, вместо этого **разрешает запись** и стирает восстановленное. Следующее открытие показывает 250 px.

Дефект **пре-существующий**: откат `electron-main.js` на предыдущий коммит и тот же изолированный прогон дали виджет красным и на старом коде, тогда как на новом оба теста прошли, — то есть правка масштабирования сохранение геометрии улучшила, а не сломала.

**Исправление** (вместо шага 3): решение «писать или не писать» переехало в `window-geometry.js` — метод `saveSettled()` откладывает запись на `SAVE_SETTLE_MS` (300 мс) и читает `getOuterWidth()` **в момент срабатывания, а не в момент события**. Одного события достаточно, а серия событий при растягивании за край рамки даёт одну запись. Путь `Ctrl`+колеса не затронут: он зовёт `save()` явно и сразу. `cleanup()` в обоих окнах зовёт `cancelPendingSave()` — тот же принцип, что у `FlipCard.cancelPending()`. Пять новых юнит-тестов; два исходно-уровневых теста июльского аудита проверяли ФОРМУ кода и перенацелены на нового владельца с сохранением намерения.

- [ ] **Step 3 (только если красно): отложить сохранение на кадр**

В `electron-widget.html`, в обработчике `this._handlers.onResizeScalePct`, обернуть вызов сохранения:

```js
this._handlers.onResizeScalePct = () => {
    widgetScalePct = Math.round(window.outerWidth / WIDGET_BASE_SIZE * 100);
    if (widgetScalePct !== this._geometry.scalePct) {
        // Откладываем на кадр: главный процесс меняет размер и позицию одним
        // setBounds(), и на момент события resize window.screenX ещё хранит
        // ПРЕЖНЮЮ точку — сохранив её, мы бы записали позицию до переезда и
        // при следующем открытии вернули окно не туда. Замерено
        // e2e/window-scale-fit.spec.js.
        requestAnimationFrame(() => this.saveGeometry(widgetScalePct));
    }
};
```

В `electron-clock-widget.html` — то же самое, но переменная называется иначе, поэтому код приведён целиком, а не отсылкой (существующий комментарий внутри обработчика **сохранить**, ниже показан только изменяемый хвост):

```js
                    if (clockScalePct !== this._geometry.scalePct) {
                        // Откладываем на кадр: главный процесс меняет размер и
                        // позицию одним setBounds(), и на момент события resize
                        // window.screenX ещё хранит ПРЕЖНЮЮ точку — сохранив её,
                        // мы бы записали позицию до переезда и при следующем
                        // открытии вернули окно не туда. Замерено
                        // e2e/window-scale-fit.spec.js.
                        requestAnimationFrame(() => this.saveGeometry(clockScalePct));
                    }
```

**Сравнение `!== this._geometry.scalePct` не убирать ни в одном из двух окон.** Оно было несущим и раньше (`restoreGeometry()` сама вызывает resize при старте), а после этой правки стало несущим сильнее: теперь изменение размера ещё и ДВИГАЕТ окно, поэтому сохранение, случившееся между посылкой размера и посылкой позиции при восстановлении, записало бы промежуточную точку поверх восстановленной.

- [ ] **Step 4 (только если делался шаг 3): прогнать заново**

Run: `npx playwright test e2e/window-scale-fit.spec.js`
Expected: PASS во всех четырёх тестах файла.

Run: `npx playwright test e2e/window-drag-geometry.spec.js`
Expected: PASS — это характеризующий тест перетаскивания и сохранения геометрии, он обязан остаться зелёным без единой правки.

- [ ] **Step 5: Коммит**

```bash
npm run lint
git add -A
git commit -m "test(geometry): геометрия переживает переоткрытие после масштабирования"
```

---

### Task 4: Стартовая высота виджета и владелец у двух мёртвых констант

**Files:**
- Modify: `constants.js:22-23`
- Modify: `electron-main.js` (конструктор `widgetWindow`, строки 412-417)
- Test: `tests/constants.test.js` (дописать один тест)

**Interfaces:**
- Consumes: ничего.
- Produces: ничего для следующих задач.

Виджет создаётся `250×280`, но `WIDGET_BASE_SIZE = 250` в рендерере делает окно квадратным при любом масштабировании — первый же щелчок `Ctrl`+колеса молча съедает 30 px высоты, и стартовый вид больше не воспроизводится за всю сессию. При этом `WIDGET_DEFAULT_WIDTH` и `WIDGET_DEFAULT_HEIGHT` в `constants.js` **не читает ни один файл** — конструктор зашивает те же числа литералами. Это тот же класс гнили, что проект уже лечил у `CONFIG.STORAGE_KEYS` («реестр, а не точка доступа»). Поэтому правка — не «поменять число в двух местах», а дать значению единственного владельца.

- [ ] **Step 1: Написать падающий тест**

Дописать в `tests/constants.test.js`:

```js
test('размеры виджета по умолчанию имеют ЧИТАТЕЛЯ, а не только объявление', () => {
    // WIDGET_DEFAULT_WIDTH/HEIGHT лежали в реестре, но конструктор окна
    // зашивал те же числа литералами — то есть значение существовало в двух
    // местах и разошлось молча (реестр говорил 280, окно создавалось 280, а
    // первое же масштабирование делало его 250). Тест требует читателя.
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron-main.js'), 'utf8');

    assert.match(source, /width:\s*CONFIG\.WIDGET_DEFAULT_WIDTH/,
        'конструктор окна виджета обязан читать CONFIG.WIDGET_DEFAULT_WIDTH');
    assert.match(source, /height:\s*CONFIG\.WIDGET_DEFAULT_HEIGHT/,
        'конструктор окна виджета обязан читать CONFIG.WIDGET_DEFAULT_HEIGHT');
    assert.equal(CONFIG.WIDGET_DEFAULT_HEIGHT, CONFIG.WIDGET_DEFAULT_WIDTH,
        'окно виджета квадратное при любом масштабе — стартовый размер обязан быть таким же');
});
```

`CONFIG` уже импортирован в начале этого файла (`const CONFIG = require('../constants');`), а `fs` и `path` — нет, поэтому они берутся внутри теста, как показано выше.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/constants.test.js`
Expected: FAIL на первом же `assert.match` — конструктор содержит литерал `width: 250`, а не `CONFIG.WIDGET_DEFAULT_WIDTH`.

- [ ] **Step 3: Дать константам владельца**

В `constants.js`:

```js
    // Timer Widget. Окно КВАДРАТНОЕ: WIDGET_BASE_SIZE в рендерере считает и
    // ширину, и высоту от одного числа, поэтому высота 280 жила ровно до
    // первого масштабирования, а потом навсегда становилась 250.
    WIDGET_DEFAULT_WIDTH: 250,
    WIDGET_DEFAULT_HEIGHT: 250,
```

В `electron-main.js`, в конструкторе `widgetWindow`:

```js
    widgetWindow = new BrowserWindow({
        width: CONFIG.WIDGET_DEFAULT_WIDTH,
        height: CONFIG.WIDGET_DEFAULT_HEIGHT,
```

- [ ] **Step 4: Прогнать юниты**

Run: `node --test`
Expected: PASS целиком.

- [ ] **Step 5: Линт и коммит**

```bash
npm run lint
git add constants.js electron-main.js tests/constants.test.js
git commit -m "fix(widget): стартовый размер 250x250 и читатель у WIDGET_DEFAULT_*"
```

---

### Task 5: Полная проверка регрессий

**Files:**
- Modify: `CLAUDE.md` (дописать пункт в раздел Gotchas и строку в таблицу e2e)

**Interfaces:**
- Consumes: всё из задач 1-4.
- Produces: ничего.

- [ ] **Step 1: Прогнать весь конвейер и ПОКАЗАТЬ вывод**

```bash
npm run ci
npx playwright test
```

Expected: PASS целиком. Три спека меняют размер окон и потому теперь будут их ещё и двигать — им нужно отдельное внимание в выводе: `e2e/window-drag-geometry.spec.js`, `e2e/clock-badges-layout.spec.js`, `e2e/digits-style.spec.js`.

- [ ] **Step 2: Проверить, что тест не оставляет за собой чужую геометрию**

`e2e/launch.js` держит ОДИН профиль на весь прогон, и спек, меняющий глобальное состояние, обязан его вернуть — иначе следующий спек получает виджет чужого размера. Прогнать дважды подряд и сравнить:

```bash
npx playwright test && npx playwright test
```

Expected: оба прогона зелёные с одинаковым числом тестов. Если второй прогон падает там, где первый был зелёным, — дописать в `e2e/window-scale-fit.spec.js` возврат масштаба к 100% перед `app.close()`:

```js
await control.evaluate(({ ch, size }) => window.electronAPI.send(ch, { width: size, height: size }),
    { ch: target.resize, size: target.base });
await control.waitForTimeout(500);
```

- [ ] **Step 3: Визуальная сверка ТРИЖДЫ подряд**

```bash
npm run visual:check && npm run visual:check && npm run visual:check
```

Expected: три нуля подряд. Один чистый прогон здесь ничего не доказывает — гарнитуры, тема и `:hover` дают перемежающиеся расхождения, и это записано в `CLAUDE.md` отдельным правилом.

Ожидание по стартовой высоте виджета: `CANONICAL_SIZES.widget` в `scripts/screenshot-runner.js` уже `[250, 250]`, поэтому изменение из задачи 4 не должно тронуть ни одного эталона. **Это предсказание, а не факт.** Если расхождения появились — сравнить картинки глазами и только потом решать, обновлять ли эталон через `npm run visual:baseline`.

- [ ] **Step 4: Дописать `CLAUDE.md`**

В раздел **Gotchas** добавить пункт:

```markdown
- **Изменение размера окна обязано держать ЦЕНТР, а не левый-верхний угол (CRITICAL)**: `win.setSize()` оставляет неподвижным левый-верхний угол, а позицию после него не правит никто. Содержимое виджета и часов отцентрировано, поэтому при увеличении масштаба циферблат уезжал вниз-вправо ровно на половину прироста и вылезал за край экрана — замерено: виджет при 400% занимал `x = 3170…4170` при ширине экрана 3440, часы `y = 1060…1940` при высоте 1440. Вернуть окно перетаскиванием можно во все стороны, кроме ВВЕРХ: macOS не пускает окно выше рабочей области ни при каком уровне окна (замерено на `floating`, `screen-saver`, `pop-up-menu`, через `setPosition` и через `setBounds` — все дают `y` рабочей области). Пользователь сообщил это как «нет возможности двинуть наверх» — то есть жалоба указывала на перетаскивание, а сломано было масштабирование. Арифметика живёт в чистой `fitScaledBounds()` в `window-geometry.js`; поджатие идёт по рабочей области `screen.getDisplayMatching()`, а НЕ `getPrimaryDisplay()` — на втором мониторе поджимать по размерам главного экрана неверно. Мусор во входном размере игнорируется (прежнее `Number(width) || 220` молча делало окно 220 px), минимум берётся из `win.getMinimumSize()`, а не из литерала.
```

В таблицу e2e-спеков добавить строку:

```markdown
| `window-scale-fit.spec.js` | Прямоугольник виджета и часов после масштабирования целиком в рабочей области своего монитора; масштаб и позиция переживают переоткрытие |
```

`AGENTS.md` в этом репозитории нет, зеркалить правку некуда.

- [ ] **Step 5: Коммит**

```bash
npm run lint
git add CLAUDE.md
git commit -m "docs: якорь масштабирования окна в CLAUDE.md"
```

---

## Итог

После всех пяти задач: масштабирование виджета и часов держит центр окна и не выносит его за край экрана; арифметика проверяется в Node девятью юнит-тестами, поведение — четырьмя e2e на настоящем `BrowserWindow`; новых IPC-каналов ноль, новых контролов ноль; стартовый размер виджета согласован с тем, каким окно становится после первого масштабирования, и у двух констант появился читатель.
