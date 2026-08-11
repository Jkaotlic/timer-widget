'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// Утверждение о НАЛИЧИИ обязано смотреть на код, а не на текст о коде:
// закомментированная строка удовлетворяет assert.match ровно так же, как живая,
// и тест остаётся зелёным на вырезанной вёрстке. Проверено мутацией. Обратные
// утверждения («старое сломанное ушло») от той же уборки только выигрывают —
// CLAUDE.md требует их ровно в таком виде, — поэтому все ИСХОДНИКИ читаются
// очищенными. Документация (.md) читается как есть: там комментариев в смысле
// кода нет, а утверждения о ней — про текст, а не про поведение.
//
// Реализация ОДНА на весь набор тестов: копий было три, и они разошлись.
const { codeOnly } = require('./helpers/source-scan');
const readCode = (file) => codeOnly(read(file));

// Стили окна управления живут в отдельном control.css (вынесены из inline-<style>),
// но проверки ниже описывают ОДНО окно как оно поставляется. Поэтому склеиваем
// разметку с её стилями: так утверждения остаются про поведение окна, а не про
// то, в каком файле физически лежит правило.
const readControlSource = () => readCode('electron-control.html') + '\n' + readCode('control.css');


test('control window keeps enough breathing room for rounded glass panel', () => {
    const constants = readCode('constants.js');
    const controlHtml = readControlSource();

    assert.match(constants, /CONTROL_WINDOW_WIDTH:\s*400/);
    assert.match(constants, /CONTROL_WINDOW_MIN_WIDTH:\s*380/);
    assert.match(controlHtml, /\.app-shell\s*\{[^}]*padding:\s*0;/s);
    assert.match(controlHtml, /\.app-shell::before\s*\{[^}]*inset:\s*0;/s);
    assert.match(controlHtml, /\.control-panel\s*\{[^}]*max-height:\s*100vh;/s);
    assert.match(controlHtml, /html,\s*body\s*\{[^}]*background:\s*transparent;/s);
    assert.match(controlHtml, /\.control-window\s*\{[^}]*background:\s*transparent;/s);
});

test('control settings use one outer shell instead of a nested window frame', () => {
    const controlHtml = readControlSource();

    assert.match(controlHtml, /\.app-shell::before\s*\{[^}]*background:[^}]*var\(--tw-bg-surface-solid\);[^}]*box-shadow:\s*var\(--tw-shadow-panel\);/s);
    assert.match(controlHtml, /\.control-panel\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
    // Разделитель между панелью и ящиком обязан существовать, но принадлежит он
    // ЯЩИКУ: линия проходит по его левому краю. Раньше её рисовала панель через
    // border-right — это работало, только пока панель была прижата к ящику. С
    // центрированием панели в своей колонке такая линия висела бы посреди пустого
    // места, поэтому граница переехала на сторону ящика.
    assert.match(controlHtml, /\.app-shell\.drawer-open \.settings-drawer\.open\s*\{[^}]*border-left:\s*1px solid var\(--tw-divider\);/s);
    assert.match(controlHtml, /\.settings-drawer\.open\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
    assert.match(controlHtml, /@media \(min-width: 500px\)\s*\{[^}]*\.control-panel\s*\{\s*margin:\s*0;\s*\}/s);
});

test('opening settings keeps control scale stable', () => {
    const controlHtml = readControlSource();

    assert.match(controlHtml, /\.app-shell\s*\{[^}]*--drawer-width:\s*336px;[^}]*--control-panel-width:\s*400px;/s);
    // Колонку под ящик задаёт ФИКСИРОВАННАЯ первая дорожка, которую ведёт JS.
    // Пока она была minmax(0, 1fr), переход стартовал от значения, которое
    // пересчитывается по ширине окна, — а окно растёт мгновенно. Панель успевала
    // перецентроваться во всю новую ширину: замер по кадрам давал бросок ВПРАВО
    // на 150px (потолок 1200) и 37px (потолок 974) с последующим возвратом влево.
    assert.match(
        controlHtml,
        /\.app-shell\.drawer-open\s*\{[^}]*grid-template-columns:\s*var\(--control-panel-width\) var\(--drawer-reserve, var\(--drawer-width\)\);/s,
        'колонка под ящик снова не фиксированная — панель будет ехать за ростом окна'
    );
    // Резерв под ящик схлопывается ОТДЕЛЬНО от снятия класса — иначе на закрытии
    // 1fr считается от ещё не схлопнутой второй дорожки (замер: отскок 64px).
    assert.match(
        controlHtml,
        /shell\.style\.setProperty\('--drawer-reserve', '0px'\)/,
        'резерв под ящик больше не схлопывается заранее — панель отскочит при закрытии'
    );
    // Ширина панели больше НЕ дублируется отдельным свойством: при фиксированной
    // колонке `width: var(...)` менялся бы мгновенно, пока колонка едет 240ms.
    // Проверка ОТСУТСТВИЯ идёт по копии без комментариев — пояснение к этой самой
    // правке содержит ту строку, которую мы здесь запрещаем.
    const cssCode = controlHtml.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(
        cssCode,
        /\.app-shell\.drawer-open \.control-panel\s*\{[^}]*width:\s*var\(--control-panel-width\);/s,
        'ширина панели снова задана переменной вместо 100% колонки'
    );
    assert.match(
        controlHtml,
        /\.app-shell\.drawer-open \.control-panel\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*640px;/s
    );
    assert.match(controlHtml, /\.settings-drawer\.open\s*\{[^}]*width:\s*var\(--drawer-width\);[^}]*max-width:\s*var\(--drawer-width\);/s);
    assert.doesNotMatch(controlHtml, /\.timer-display-main\s*\{[^}]*vw/s);
    // Переменную ширины колонки выставляет JS. Проверяем сам факт, а не форму
    // выражения: значение теперь считается от фактической ширины окна и
    // подставляется через Math.round прямо в шаблон (см. следующий тест).
    assert.match(controlHtml, /shell\.style\.setProperty\(\s*'--control-panel-width'/);
});

test('колонка панели при открытом ящике считается от потолка ширины окна', () => {
    // Баг: ширина колонки бралась равной ТЕКУЩЕЙ ширине окна. У окна, растянутого
    // до maxWidth, запрос «текущая + 336» обрезался главным процессом, окно не
    // расширялось, а колонка оставалась во всю ширину — ящик (absolute, right: 0)
    // накрывал пресеты и кнопки. Замер в e2e/drawer-layout.spec.js: правый край
    // панели 1200 против левого края ящика 864.
    const controlHtml = readCode('electron-control.html');
    const constants = readCode('constants.js');
    const main = readCode('electron-main.js');

    assert.match(constants, /CONTROL_WINDOW_MAX_WIDTH:\s*\d+/, 'потолок ширины не объявлен в CONFIG');
    // Потолок обязан быть ОДИН на главный процесс и панель, иначе они разъедутся.
    assert.match(
        main,
        /maxWidth:\s*CONFIG\.CONTROL_WINDOW_MAX_WIDTH/,
        'главный процесс задаёт maxWidth литералом вместо константы'
    );

    // Колонка считается от ФАКТИЧЕСКОЙ ширины окна, а не от константы потолка.
    // Первая версия правки вычитала ящик из CONTROL_WINDOW_MAX_WIDTH и падала на
    // Windows: там главный процесс обрезает ширину ещё и по размеру экрана
    // (`screenWidth - 50`), поэтому эффективный потолок ниже константы, и колонка
    // снова оказывалась шире доступного места. Предсказать это из рендерера нельзя.
    assert.match(
        controlHtml,
        /const available = \(window\.innerWidth \|\| baseDefault\) - this\._drawerExtraWidth/,
        'колонка панели снова считается не от фактической ширины окна'
    );
    assert.match(
        controlHtml,
        /window\.addEventListener\('resize', syncColumn\)/,
        'колонка не пересчитывается при изменении размера окна с открытым ящиком'
    );
    assert.match(
        controlHtml,
        /window\.removeEventListener\('resize', this\._syncDrawerColumn\)/,
        'слушатель пересчёта колонки не снимается при закрытии ящика'
    );
});

test('control window keeps a reliable drag region after frameless shell changes', () => {
    const controlHtml = readControlSource();

    assert.match(controlHtml, /\.custom-titlebar,\s*\n\s*\.timer-header\s*\{[^}]*app-region:\s*drag;[^}]*-webkit-app-region:\s*drag;[^}]*user-select:\s*none;/s);
    assert.match(controlHtml, /\.custom-titlebar \.titlebar-right\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(controlHtml, /\.custom-titlebar \.window-controls\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    // Кнопка справки лежит ВНУТРИ .titlebar-right, а его no-drag-прямоугольник
    // вычитается из зоны перетаскивания вместе со всеми потомками — своего правила
    // кнопке не нужно. Раньше здесь проверялось `.faq-btn { no-drag }`, но класса
    // .faq-btn нет ни на одном элементе (у кнопки класс .titlebar-help): тест
    // сторожил правило, которое никогда ни к чему не применялось, и оно так и
    // лежало мёртвым в control.css. Проверяем то, от чего защита реально зависит —
    // что кнопка остаётся внутри no-drag-контейнера.
    // Между открытием контейнера и первой кнопкой может стоять комментарий, а
    // кнопок теперь две (переключатель темы и справка) — проверяем, что ПЕРВЫЙ
    // элемент внутри контейнера именно кнопка титлбара, а не что-то ещё.
    assert.match(controlHtml, /<div class="titlebar-right">(?:\s*<!--[\s\S]*?-->)?\s*<button class="titlebar-help"/s);
    assert.match(controlHtml, /id="contrastToggle"[^>]*>[\s\S]{0,200}?id="faqBtn"/s);
    assert.match(controlHtml, /\.custom-titlebar \.titlebar-help\s*\{/);
});

test('перетаскивание окна начинается только с неинтерактивной поверхности', () => {
    // Виджет и часы делят общий механизм (window-geometry.js) — там же и гард.
    // Полноэкранный дисплей сюда НЕ входит намеренно: его перетаскивание
    // отличается по существу (нет preventDefault, есть эвристика полноэкранного
    // режима, геометрия не хранится), поэтому у него свой экземпляр гарда.
    const shared = readCode('window-geometry.js');
    const displayScript = readCode('display-script.js');

    [shared, displayScript].forEach(source => {
        assert.match(source, /isWindowDragTarget\(target\)\s*\{[^}]*typeof target\.closest === 'function'/s);
        assert.match(source, /button, input, select, textarea, \[role="button"\], \[tabindex\]/);
        assert.match(source, /e\.button !== 0[^;]+e\.altKey[^;]+e\.ctrlKey[^;]+e\.metaKey[^;]+e\.shiftKey/s);
    });

    // Оба окна обязаны брать механизм из модуля, а не заводить свой заново:
    // это были два дословных клона, различавшихся ОДНОЙ строкой — именем канала.
    for (const file of ['electron-widget.html', 'electron-clock-widget.html']) {
        const src = readCode(file);
        assert.match(src, /WindowGeometry\.bindWindowDrag\(\{/, `${file}: перетаскивание должно идти через модуль`);
        assert.doesNotMatch(src, /isWindowDragTarget\(target\)\s*\{/, `${file}: копия гарда вернулась`);
        assert.doesNotMatch(src, /let isDragging = false/, `${file}: копия механики вернулась`);
    }
});

test('в окне часов нет внутренних контролов — ни разметки, ни стилей под них', () => {
    // Раньше этот тест проверял, что оверлейные кнопки часов отказываются от
    // drag-region (app-region: no-drag). Проверял он СТИЛИ ПОД ЭЛЕМЕНТЫ, КОТОРЫХ
    // НЕТ: внутренние контролы уехали в панель управления ещё когда окно стало
    // «только отображением», а ~290 строк CSS под них (.controls-overlay,
    // .ctrl-btn, .settings-panel, .size-btn, .style-btn, .toggle-*, стилизация
    // range-инпутов) остались висеть с комментарием «сохранено на будущее».
    //
    // Теперь тест держит инвариант, который реально важен: окно часов не содержит
    // интерактивных элементов. Пока это так, вопрос drag-region к нему не
    // относится вовсе, а мёртвый CSS не может вернуться незамеченным.
    // Комментарии вырезаем: они намеренно называют удалённые селекторы, чтобы
    // правка не вернулась «по незнанию», и без вырезания тест ловил бы сам себя.
    const clockHtml = readCode('electron-clock-widget.html')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');

    for (const tag of ['<button', '<input', '<select', '<textarea']) {
        assert.equal(
            clockHtml.includes(tag), false,
            `в окне часов появился ${tag} — вернись к вопросу drag-region и no-drag`
        );
    }

    for (const cls of ['.controls-overlay', '.ctrl-btn', '.settings-panel', '.style-btn', '.size-btn']) {
        assert.equal(
            clockHtml.includes(cls), false,
            `${cls}: стили внутренних контролов часов вернулись без самих контролов`
        );
    }
});

test('минус вне потока: по центру стоят ЦИФРЫ', () => {
    // Держать по центру ОДНОВРЕМЕННО цифры и всю надпись математически нельзя:
    // надпись = [минус][цифры], и центры отличаются ровно на половину знака.
    //
    // Три итерации, все замерены в e2e:
    //   1) знак резервировал ширину 0.6ch — цифры уезжали вправо на 15px;
    //   2) знак в потоке, центрируется надпись — цифры уехали от центра КОЛЬЦА на
    //      +26px (панель), +16px (виджет), +54px (полноэкранный). Пользователь
    //      сообщил, что это «режет глаза», и был прав: внутри круга точка отсчёта
    //      для глаза — центр кольца, а в панели — общая ось со плашкой статуса;
    //   3) знак вне потока, по центру цифры — но полноразмерный минус с зазором
    //      0.2em выглядел отдельным пятном и тянул композицию влево.
    //
    // Итог: контейнер сжат по содержимому и центрирован (его левый край = левый
    // край цифр), знак абсолютный от этого края, МЕЛЬЧЕ цифр и по их средней линии.
    // Замерено: цифры 0px от опоры, знак 0–0.4px по вертикали, надпись −8.8…−29.9px,
    // минус внутри кольца с запасом 43px (виджет) и 80.9px (дисплей).
    // Живой замер держит e2e/overtime-centering.spec.js.
    const controlHtml = readControlSource();
    const widgetHtml = readCode('electron-widget.html');
    const displayHtml = readCode('display.html') + '\n' + readCode('display.css');
    const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

    for (const [name, src, signSel, boxSel] of [
        ['control', controlHtml, '\\.timer-display-main \\.tm-sign', '\\.timer-display-main'],
        ['widget', widgetHtml, '\\.time-display \\.tm-sign', '\\.time-display']
    ]) {
        const base = src.match(new RegExp(`${signSel}\\s*\\{[^}]*\\}`, 's'));
        assert.ok(base, `${name}: правило .tm-sign не найдено`);
        const baseCss = stripComments(base[0]);
        assert.match(baseCss, /position:\s*absolute;/, `${name}: знак обязан быть вне потока`);
        assert.match(baseCss, /right:\s*100%;/, `${name}: знак крепится к левому краю цифр`);
        assert.match(baseCss, /top:\s*50%;/, `${name}: знак центрируется по вертикали`);
        assert.match(baseCss, /translateY\(-50%\)/, `${name}: без сдвига знак висит надстрочно`);
        assert.match(baseCss, /font-size:\s*0\.62em;/, `${name}: знак мельче цифр`);
        // Возврат знака в поток — это возврат сдвига цифр.
        assert.doesNotMatch(baseCss, /display:\s*inline-block;/, `${name}: знак снова в потоке`);

        // Контейнер обязан сжиматься по содержимому и центрироваться — иначе его
        // левый край не совпадёт с левым краем цифр и right: 100% уедет.
        const boxRules = [...src.matchAll(new RegExp(`${boxSel}\\s*\\{[^}]*\\}`, 'gs'))]
            .map((m) => stripComments(m[0])).join('\n');
        assert.match(boxRules, /width:\s*fit-content;/, `${name}: контейнер не сжат по содержимому`);
        assert.match(boxRules, /position:\s*relative;/, `${name}: контейнеру нужен position: relative`);
        assert.match(boxRules, /margin-left:\s*auto;/, `${name}: контейнер не центрирован`);
    }

    // Полноэкранный режим — и круг, и аналоговый цифровой отсчёт.
    const displayRule = stripComments(
        displayHtml.match(/\.time-minus,\s*\n\s*\.analog-time-minus\s*\{[^}]*\}/s)[0]
    );
    assert.match(displayRule, /position:\s*absolute;/);
    assert.match(displayRule, /right:\s*100%;/);
    assert.match(displayRule, /font-size:\s*0\.62em;/);
    assert.doesNotMatch(displayRule, /margin-left:\s*-/, 'вылет влево — прежний костыль');
    const displayBox = stripComments(
        displayHtml.match(/\.time-text,\s*\n\s*\.analog-digital-time\s*\{[^}]*\}/s)[0]
    );
    assert.match(displayBox, /width:\s*fit-content;/);
    assert.match(displayBox, /position:\s*relative;/);
});

test('circular widget centers the digits independently from the status chip', () => {
    const widgetHtml = readCode('electron-widget.html');

    assert.match(widgetHtml, /\.center-content\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*1fr auto 1fr;/s);
    assert.match(widgetHtml, /\.center-content\s*\{[^}]*width:\s*72%;/s);
    assert.match(widgetHtml, /\.time-display\s*\{[^}]*grid-row:\s*2;/s);
    assert.match(widgetHtml, /\.status-badge\s*\{[^}]*grid-row:\s*3;/s);
});

test('circular clock keeps the time fixed at the ring center', () => {
    const clockHtml = readCode('electron-clock-widget.html');

    assert.match(clockHtml, /\.center-content\s*\{[^}]*width:\s*72%;[^}]*height:\s*72%;/s);
    assert.match(clockHtml, /\.time-display\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\);/s);
    // Шильдики висят абсолютно — ОДНОЙ колонкой — и потому не двигают время.
    assert.match(clockHtml, /\.center-badges\s*\{[^}]*position:\s*absolute;[^}]*transform:\s*translateX\(-50%\);/s);
});

test('дата и часовой пояс круглых часов разложены потоком, а не двумя смещениями', () => {
    // Раньше каждый шильдик имел собственное `top: calc(50% + clamp(...))`:
    // расстояние между ними росло как 5vh, а высота даты — как ~8.4vh
    // (font-size 4.5vh × line-height, padding 1.5vh сверху и снизу, рамка).
    // Высота обгоняла зазор, и дата наезжала на пояс — впритык уже на дефолтных
    // 220px и −15px на 400px. Замерено в e2e/clock-badges-layout.spec.js.
    // Снимками не ловилось: `clock-*` исключены из визуальной сверки.
    const clockHtml = readCode('electron-clock-widget.html');
    // Комментарии вырезаем: пояснение к правилу само описывает прежнюю
    // раскладку и иначе роняет проверки на её отсутствие.
    const CSS_CODE = clockHtml.replace(/\/\*[\s\S]*?\*\//g, '');

    const column = CSS_CODE.match(/\.center-badges\s*\{[^}]*\}/s);
    assert.ok(column, 'правило .center-badges не найдено');
    assert.match(column[0], /flex-direction:\s*column;/, 'шильдики должны идти колонкой');
    assert.match(column[0], /gap:/, 'расстояние задаёт gap, а не второе абсолютное смещение');

    // Прежняя раскладка не должна вернуться ни для одного из двух шильдиков.
    assert.doesNotMatch(CSS_CODE, /\.center-content\s*>\s*\.date-badge/);
    assert.doesNotMatch(CSS_CODE, /\.center-content\s*>\s*\.timezone-badge/);
});

test('стиль часов приводится к белому списку перед подстановкой в класс', () => {
    // `classList.add('style-' + style)` роняет DOMException на строке с пробелом
    // или на пустой. Обработчик обрывался ПОСЛЕ снятия прежних классов, поэтому
    // body оставался вообще без `style-*`. Значение приходит из localStorage и
    // из `clock-widget-set-style`, который главный процесс ретранслирует без
    // проверки. Замерено в e2e/clock-style-hardening.spec.js.
    const clockHtml = readCode('electron-clock-widget.html');
    const JS_CODE = clockHtml.replace(/\/\/[^\n]*/g, '');

    assert.match(JS_CODE, /const safeStyle = \['circle', 'digital', 'flip', 'analog', 'digits'\]\.includes\(style\)/);
    assert.match(JS_CODE, /classList\.add\('style-' \+ safeStyle\)/);
    // Сырое значение больше не должно доходить ни до класса, ни до поля.
    assert.doesNotMatch(JS_CODE, /classList\.add\('style-' \+ style\)/);
    assert.doesNotMatch(JS_CODE, /this\.clockStyle = style;/);
});

test('вторичные секунды не сдвигают главное время круглых часов', () => {
    // Секунды рисуются надстрочно справа от HH:MM. Пока они занимали ширину,
    // центрировался ВЕСЬ блок, а само «21:06» стояло на ~9.5px левее центра
    // кольца — и переключение секунд в настройках дёргало время туда-сюда.
    // Замерено в e2e: было hhmm_dx = -9.5, стало 0.
    const clockHtml = readCode('electron-clock-widget.html');
    const found = clockHtml.match(/\.time-display \.clock-seconds\s*\{[^}]*\}/s);
    assert.ok(found, 'правило .clock-seconds не найдено');
    // Комментарии вырезаем: пояснение внутри правила само упоминает margin,
    // объясняя, почему его там нет, и иначе роняет проверку ниже.
    const rule = found[0].replace(/\/\*[\s\S]*?\*\//g, '');

    assert.match(rule, /width:\s*0;/, 'секунды не должны занимать ширину');
    assert.match(rule, /overflow:\s*visible;/);
    // Зазор и подъём — только transform-ом, margin снова добавил бы ширину.
    assert.doesNotMatch(rule, /margin/, 'margin вернул бы сдвиг главного времени');
    assert.match(rule, /transform:\s*translate\(/);
});

test('release-facing docs do not point back to Electron 41 or production DevTools edits', () => {
    const readmeRu = read('README.md');
    const readmeEn = read('README.en.md');
    const performance = read('docs/PERFORMANCE.md');

    assert.doesNotMatch(readmeRu, /Electron_41/);
    assert.doesNotMatch(readmeEn, /Electron_41/);
    assert.doesNotMatch(performance, /devTools:\s*true/);
    assert.match(performance, /npm run dev/);
});
