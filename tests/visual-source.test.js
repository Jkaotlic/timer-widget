'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// Стили окна управления живут в отдельном control.css (вынесены из inline-<style>),
// но проверки ниже описывают ОДНО окно как оно поставляется. Поэтому склеиваем
// разметку с её стилями: так утверждения остаются про поведение окна, а не про
// то, в каком файле физически лежит правило.
const readControlSource = () => read('electron-control.html') + '\n' + read('control.css');


test('control window keeps enough breathing room for rounded glass panel', () => {
    const constants = read('constants.js');
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
    // Ширину колонки задаёт переменная, а предел — та же ширина контента, что и у
    // закрытого ящика. Без второго условия панель при стыковке растягивалась с 640
    // до всей колонки (замер: 640 → 864 на окне 1200px), её левый край уезжал на
    // 130px, и это читалось как прыжок. Держит e2e/drawer-layout.spec.js.
    assert.match(controlHtml, /\.app-shell\.drawer-open \.control-panel\s*\{[^}]*width:\s*var\(--control-panel-width\);[^}]*max-width:\s*min\(var\(--control-panel-width\), 640px\);/s);
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
    const controlHtml = read('electron-control.html');
    const constants = read('constants.js');
    const main = read('electron-main.js');

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

test('widget windows only start JS drag from non-interactive surfaces', () => {
    const widgetHtml = read('electron-widget.html');
    const clockHtml = read('electron-clock-widget.html');
    const displayScript = read('display-script.js');

    [widgetHtml, clockHtml, displayScript].forEach(source => {
        assert.match(source, /isWindowDragTarget\(target\)\s*\{[^}]*typeof target\.closest === 'function'/s);
        assert.match(source, /button, input, select, textarea, \[role="button"\], \[tabindex\]/);
        assert.match(source, /e\.button !== 0[^;]+e\.altKey[^;]+e\.ctrlKey[^;]+e\.metaKey[^;]+e\.shiftKey/s);
        assert.match(source, /!\s*this\.isWindowDragTarget\(e\.target\)/);
    });
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
    const clockHtml = read('electron-clock-widget.html')
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
    const widgetHtml = read('electron-widget.html');
    const displayHtml = read('display.html');
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
    const widgetHtml = read('electron-widget.html');

    assert.match(widgetHtml, /\.center-content\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*1fr auto 1fr;/s);
    assert.match(widgetHtml, /\.center-content\s*\{[^}]*width:\s*72%;/s);
    assert.match(widgetHtml, /\.time-display\s*\{[^}]*grid-row:\s*2;/s);
    assert.match(widgetHtml, /\.status-badge\s*\{[^}]*grid-row:\s*3;/s);
});

test('circular clock keeps the time fixed at the ring center', () => {
    const clockHtml = read('electron-clock-widget.html');

    assert.match(clockHtml, /\.center-content\s*\{[^}]*width:\s*72%;[^}]*height:\s*72%;/s);
    assert.match(clockHtml, /\.time-display\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\);/s);
    assert.match(clockHtml, /\.center-content > \.date-badge\s*\{[^}]*position:\s*absolute;[^}]*transform:\s*translateX\(-50%\);/s);
    assert.match(clockHtml, /\.center-content > \.timezone-badge\s*\{[^}]*position:\s*absolute;[^}]*transform:\s*translateX\(-50%\);/s);
});

test('вторичные секунды не сдвигают главное время круглых часов', () => {
    // Секунды рисуются надстрочно справа от HH:MM. Пока они занимали ширину,
    // центрировался ВЕСЬ блок, а само «21:06» стояло на ~9.5px левее центра
    // кольца — и переключение секунд в настройках дёргало время туда-сюда.
    // Замерено в e2e: было hhmm_dx = -9.5, стало 0.
    const clockHtml = read('electron-clock-widget.html');
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
