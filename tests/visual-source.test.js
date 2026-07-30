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
    assert.match(controlHtml, /\.app-shell\.drawer-open \.control-panel\s*\{[^}]*border-right:\s*1px solid var\(--tw-divider\);/s);
    assert.match(controlHtml, /\.settings-drawer\.open\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
    assert.match(controlHtml, /@media \(min-width: 500px\)\s*\{[^}]*\.control-panel\s*\{\s*margin:\s*0;\s*\}/s);
});

test('opening settings keeps control scale stable', () => {
    const controlHtml = readControlSource();

    assert.match(controlHtml, /\.app-shell\s*\{[^}]*--drawer-width:\s*336px;[^}]*--control-panel-width:\s*400px;/s);
    assert.match(controlHtml, /\.app-shell\.drawer-open \.control-panel\s*\{[^}]*width:\s*var\(--control-panel-width\);[^}]*max-width:\s*var\(--control-panel-width\);/s);
    assert.match(controlHtml, /\.settings-drawer\.open\s*\{[^}]*width:\s*var\(--drawer-width\);[^}]*max-width:\s*var\(--drawer-width\);/s);
    assert.doesNotMatch(controlHtml, /\.timer-display-main\s*\{[^}]*vw/s);
    assert.match(controlHtml, /shell\.style\.setProperty\('--control-panel-width', `\$\{panelWidth\}px`\)/);
});

test('control window keeps a reliable drag region after frameless shell changes', () => {
    const controlHtml = readControlSource();

    assert.match(controlHtml, /\.custom-titlebar,\s*\n\s*\.timer-header\s*\{[^}]*app-region:\s*drag;[^}]*-webkit-app-region:\s*drag;[^}]*user-select:\s*none;/s);
    assert.match(controlHtml, /\.custom-titlebar \.titlebar-right\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(controlHtml, /\.custom-titlebar \.window-controls\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(controlHtml, /\.faq-btn\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
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

test('clock overlay controls opt out of Electron drag regions with standard and prefixed CSS', () => {
    const clockHtml = read('electron-clock-widget.html');

    assert.match(clockHtml, /\.controls-overlay\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(clockHtml, /\.ctrl-btn\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
    assert.match(clockHtml, /\.settings-panel\s*\{[^}]*app-region:\s*no-drag;[^}]*-webkit-app-region:\s*no-drag;/s);
});

test('минус в потоке: центрируется вся надпись, а не одни цифры', () => {
    // Держать по центру ОДНОВРЕМЕННО цифры и всю надпись математически нельзя:
    // надпись = [минус][цифры], и если центр цифр совпал с центром кольца, то
    // центр надписи неизбежно левее ровно на половину знака.
    //
    // Две итерации, обе замерены в e2e:
    //   1) знак резервировал ширину 0.6ch — цифры уезжали вправо на 15px (панель);
    //   2) знак с width:0 и сдвигом через transform — цифры встали ровно, но вся
    //      надпись съехала влево на 16-26px, и минус читался как висящий отдельно
    //      (в полноэкранном режиме этот перекос доходил до 45px).
    //
    // Итог: знак участвует в раскладке обычным образом, центрируется надпись
    // целиком. Технический сдвиг цифр при переходе через ноль незаметен — глаз
    // видит центрированный блок и до, и после, а появление самого минуса этот
    // сдвиг маскирует. Замерено: центр надписи = 0 во всех трёх окнах.
    const controlHtml = readControlSource();
    const widgetHtml = read('electron-widget.html');
    const displayHtml = read('display.html');
    const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

    for (const [name, src, sel] of [
        ['control', controlHtml, '\\.timer-display-main \\.tm-sign'],
        ['widget', widgetHtml, '\\.time-display \\.tm-sign']
    ]) {
        const base = src.match(new RegExp(`${sel}\\s*\\{[^}]*\\}`, 's'));
        assert.ok(base, `${name}: базовое правило .tm-sign не найдено`);
        const baseCss = stripComments(base[0]);
        // Никакой нулевой ширины и никаких transform-костылей: знак — обычный
        // inline-block, его ширину задаёт сам глиф.
        assert.match(baseCss, /display:\s*inline-block;/, `${name}: знак должен быть inline-block`);
        assert.doesNotMatch(baseCss, /width:\s*0;/, `${name}: нулевая ширина уводит надпись из центра`);
        assert.doesNotMatch(baseCss, /transform:/, `${name}: сдвиг глифа больше не нужен`);

        const filled = stripComments(
            src.match(new RegExp(`${sel}:not\\(:empty\\)\\s*\\{[^}]*\\}`, 's'))[0]
        );
        assert.match(filled, /margin-right:\s*0\.2em;/, `${name}: зазор до цифр — 0.2em`);
        assert.doesNotMatch(filled, /width:/, `${name}: ширину задаёт глиф, а не правило`);
    }

    // Полноэкранный режим: отрицательный вылет убран по той же причине.
    const displayRule = stripComments(
        displayHtml.match(/\.time-minus,\s*\n\s*\.analog-time-minus\s*\{[^}]*\}/s)[0]
    );
    assert.doesNotMatch(displayRule, /margin-left:\s*-/, 'вылет влево уводил надпись из центра');
    assert.match(displayRule, /margin-right:\s*0\.2em;/);
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
