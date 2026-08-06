'use strict';

/**
 * Структурные тесты декомпозиции окна управления.
 *
 * `electron-control.html` был god-файлом на 7300 строк (CSS + разметка + вся
 * логика в одном inline-скрипте) и служил главным источником багов вида
 * «одна логика в трёх копиях»: увидеть дубликат в таком файле физически нельзя.
 *
 * Эти тесты не дают ему собраться обратно: следят, что вынесенные модули
 * подключены, попадают в сборку и не утащили за собой зависимость от внутренностей
 * панели.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const controlHtml = read('electron-control.html');
const pkg = JSON.parse(read('package.json'));

// Модули, вынесенные из inline-скрипта панели.
const EXTRACTED = [
    'sound-bank.js',
    'ui-feedback.js',
    'scale-input.js',
    'color-picker.js',
    'modal-manager.js',
    'shortcuts-help.js',
    'custom-sounds.js',
    'local-background.js',
    'clock-settings-schema.js'
];

test('окно управления больше не god-файл', () => {
    const lines = controlHtml.split('\n').length;
    // Было 7300+. Порог с запасом: он не про красоту числа, а про то, чтобы
    // случайный возврат кода внутрь файла бросался в глаза на ревью.
    //
    // Поднят с 2800 до 2950 в 2.4.0: файл вырос за счёт СТАТИКИ, а не логики —
    // переписанное содержимое справки, четыре вернувшихся переключателя часов и
    // кнопка темы. Вынести эту разметку в отдельный файл нельзя: без сборщика
    // единственный способ — собирать DOM из JS-строк, а fetch по file:// в
    // Chromium запрещён. Поэтому ниже добавлена вторая, более узкая проверка:
    // растёт ли ЛОГИКА.
    assert.ok(lines < 2950, `electron-control.html разросся до ${lines} строк`);
});

test('inline-скрипт панели не разрастается', () => {
    // Именно объём КОДА внутри HTML был исходной проблемой (в нём не видно
    // дубликатов), а не длина файла как таковая. Проверка отдельно от общей:
    // статическая разметка справки может расти, скрипт — нет.
    const lines = controlHtml.split('\n');
    const start = lines.findIndex((l) => l.trim() === '<script>');
    const end = lines.reduce((acc, l, i) => (l.trim() === '</script>' ? i : acc), -1);
    assert.ok(start > 0 && end > start, 'не найден inline-<script> панели');
    const scriptLines = end - start;
    assert.ok(
        scriptLines < 2000,
        `inline-скрипт панели разросся до ${scriptLines} строк — выносите модуль, а не дописывайте здесь`
    );
});

test('стили вынесены в отдельный файл, инлайнового <style> не осталось', () => {
    assert.doesNotMatch(controlHtml, /<style>/);
    assert.match(controlHtml, /<link rel="stylesheet" href="control\.css">/);
});

test('таблицы стилей панели подключены в правильном порядке', () => {
    // Этот тест сторожил «control.css после design-tokens.css». Проверка была
    // верной по букве и пустой по смыслу: нагружен порядок был не этой парой, а
    // теми двумя файлами первой версии (styles.css / components.css), которые
    // стояли ПЕРЕД токенами и при равной специфичности проигрывали control.css
    // только позицией <link>. Их больше нет, и вместе с ними ушла возможность
    // сломать панель перестановкой строк в <head>.
    //
    // Осталось ДВА порядковых требования, и оба настоящие:
    //   1. fonts.css первым — @font-face обязан существовать до правил, которые
    //      этим шрифтом что-то рисуют; иначе первый кадр уйдёт в запасной шрифт;
    //   2. control.css последним — он единственный переопределяет значения
    //      токенов и тему (в нём живут блоки [data-theme="light"] .control-panel
    //      для литералов, до которых токены не достают).
    const order = [...controlHtml.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)]
        .map((m) => m[1]);
    assert.deepEqual(
        order,
        ['fonts.css', 'design-tokens.css', 'control.css'],
        'порядок таблиц стилей панели изменился — проверьте, что понимаете, зачем'
    );
});

test('каждый вынесенный модуль подключён в разметке', () => {
    for (const mod of EXTRACTED) {
        assert.match(
            controlHtml,
            new RegExp(`<script src="${mod.replace('.', '\\.')}"></script>`),
            `${mod} не подключён в electron-control.html`
        );
    }
});

test('каждый вынесенный модуль попадает в сборку', () => {
    // Иначе в packaged-релизе окно управления останется без половины логики —
    // ровно так уже терялся design-tokens.css (см. CHANGELOG 2.3.2).
    for (const asset of [...EXTRACTED, 'control.css']) {
        assert.ok(
            pkg.build.files.includes(asset),
            `${asset} отсутствует в package.json build.files`
        );
    }
});

test('вынесенные модули не тянут за собой внутренности панели', () => {
    // Модуль, обращающийся к timerController, — это не выделенный модуль, а
    // кусок панели, переехавший в другой файл.
    for (const mod of EXTRACTED) {
        const src = read(mod);
        assert.doesNotMatch(src, /timerController/, `${mod} не должен знать о timerController`);
    }
});

test('модули берут общие зависимости через window, а не через голые имена', () => {
    // В проекте нет сборщика: каждый файл — отдельный classic-script, поэтому
    // голое имя работает случайно (через глобальную область) и ломает статический
    // анализ. Конвенция проекта — window.X, как в renderer-shared/display-script.
    const colorPicker = read('color-picker.js');
    assert.match(colorPicker, /window\.ColorUtils\./);
    assert.doesNotMatch(colorPicker, /(?<![\w.])ColorUtils\./);

    const customSounds = read('custom-sounds.js');
    assert.match(customSounds, /window\.Toast\./);
    assert.doesNotMatch(customSounds, /(?<![\w.])Toast\./);
});

test('примесь пользовательских звуков применяется к прототипу', () => {
    // Без этой строки методы просто исчезнут, а падение будет не при загрузке,
    // а при первом клике по «добавить звук».
    assert.match(
        controlHtml,
        /Object\.assign\(TimerController\.prototype, window\.CustomSoundsMixin\)/
    );
    const mixin = read('custom-sounds.js');
    for (const method of ['showSoundUploadError', 'handleSoundFileUpload',
        'loadCustomSounds', 'playCustomSound', 'deleteCustomSound']) {
        assert.match(mixin, new RegExp(`${method}\\(`), `в примеси нет метода ${method}`);
    }
});

// Убирает комментарии, чтобы утверждения про КОД не срабатывали на пояснениях
// к нему: заголовок sound-bank.js сам упоминает localStorage, объясняя, почему
// его там нет.
const codeOnly = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('банк синтеза и пользовательские звуки разделены', () => {
    // Разные причины для изменения: осцилляторы против файлов и localStorage.
    const bank = codeOnly(read('sound-bank.js'));
    assert.doesNotMatch(bank, /localStorage/);
    assert.doesNotMatch(bank, /document\./);
    assert.match(codeOnly(read('custom-sounds.js')), /localStorage/);
});

test('у каждого модуля есть заголовочный комментарий с назначением', () => {
    for (const mod of EXTRACTED) {
        const src = read(mod);
        assert.match(src, /^'use strict';\s*\n\s*\n\/\*\*/, `${mod} должен начинаться с блока-описания`);
        assert.ok(src.includes(mod), `${mod} должен называть себя в заголовке`);
    }
});
