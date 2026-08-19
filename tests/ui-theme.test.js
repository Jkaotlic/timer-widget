'use strict';

/**
 * Тема интерфейса: чистая логика + проводка во всех четырёх окнах.
 *
 * Предыстория. Блоки `[data-theme="dark"|"light"|"hc-dark"]` лежали в
 * design-tokens.css с самого начала, но атрибут `data-theme` не выставлял НИКТО и
 * `prefers-color-scheme` не использовался. Две темы из трёх были недостижимы, и
 * именно поэтому их контраст никогда не настраивали — светлая давала 2.70:1 на
 * подписях. В 2.4.0 светлая удалена, а высокий контраст подключён кнопкой.
 *
 * Тест держит цепочку целиком: модуль → <head> каждого окна → IPC-канал в ОБОИХ
 * списках → рассылка в главном процессе → кнопка в панели. Разрыв в любом звене
 * даёт тему, которая переключается в одном окне и не переключается в остальных —
 * ровно тот класс дефекта, из-за которого в этом проекте появился
 * bindWindowStateSnapshot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const UITheme = require(path.join(ROOT, 'ui-theme.js'));
const CONFIG = require(path.join(ROOT, 'constants.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const WINDOWS = [
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html'
];

test('normalizeTheme: неизвестное значение — это тема по умолчанию, а не ошибка', () => {
    assert.equal(UITheme.normalizeTheme('light'), 'light');
    assert.equal(UITheme.normalizeTheme('dark'), 'dark');
    // В localStorage может лежать что угодно из прошлых версий — в том числе
    // 'hc-dark' от высококонтрастной темы, которая была второй до 2.4.1.
    for (const junk of ['hc-dark', '', null, undefined, 0, 'LIGHT', {}, []]) {
        assert.equal(UITheme.normalizeTheme(junk), 'light', `мусор ${JSON.stringify(junk)} обязан дать light`);
    }
});

test('темой по умолчанию является светлая', () => {
    // Макет редизайна объявляет светлую тему темой по умолчанию. Проверяется
    // САМА константа, а не только normalizeTheme: смена дефолта — продуктовое
    // решение, и оно обязано ломать тест, а не проезжать молча вместе с
    // рефакторингом normalizeTheme.
    assert.equal(UITheme.UI_THEME_DEFAULT, 'light');
});

test('nextTheme ходит по кругу и не залипает', () => {
    assert.equal(UITheme.nextTheme('dark'), 'light');
    assert.equal(UITheme.nextTheme('light'), 'dark');
    assert.equal(UITheme.nextTheme('чепуха'), 'dark', 'из мусора (это светлая по умолчанию) переключаемся в тёмную');
    // Двойное переключение возвращает в исходную — иначе кнопка была бы односторонней.
    assert.equal(UITheme.nextTheme(UITheme.nextTheme('dark')), 'dark');
});

test('themeLabel не пустой ни для одной темы', () => {
    for (const t of UITheme.UI_THEMES) {
        assert.match(UITheme.themeLabel(t), /\S/, `подпись для ${t} пустая`);
    }
    assert.notEqual(UITheme.themeLabel('dark'), UITheme.themeLabel('light'));
});

test('ключ хранения зарегистрирован в CONFIG.STORAGE_KEYS', () => {
    assert.equal(
        CONFIG.STORAGE_KEYS.UI_THEME,
        UITheme.UI_THEME_STORAGE_KEY,
        'ключ темы в реестре и в модуле расходятся'
    );
});

test('темы модуля совпадают с блоками в design-tokens.css', () => {
    const tokens = read('design-tokens.css');
    assert.deepEqual(UITheme.UI_THEMES, ['dark', 'light'], 'состав тем изменился');
    for (const theme of UITheme.UI_THEMES) {
        assert.ok(
            tokens.includes(`[data-theme="${theme}"]`),
            `тема ${theme} объявлена в модуле, но её блока нет в токенах — переключатель приведёт в никуда`
        );
    }
    // И обратное направление: блока без темы в модуле быть не должно. Смотрим
    // КОД без комментариев — шапка файла намеренно объясняет, почему светлая
    // тема удалена, и упоминает её селектор.
    const code = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
    const declared = [...code.matchAll(/\[data-theme="([a-z-]+)"\]/g)].map((m) => m[1]);
    for (const theme of new Set(declared)) {
        assert.ok(
            UITheme.UI_THEMES.includes(theme),
            `в токенах есть блок ${theme}, до которого нельзя дойти из UI — так и появилась недостижимая светлая тема`
        );
    }
});

test('все четыре окна применяют тему до первого кадра', () => {
    for (const file of WINDOWS) {
        const html = read(file);
        const headEnd = html.indexOf('</head>');
        const scriptAt = html.indexOf('ui-theme.js');
        assert.ok(scriptAt !== -1, `${file}: не подключён ui-theme.js`);
        assert.ok(
            scriptAt < headEnd,
            `${file}: ui-theme.js подключён после </head> — окно мигнёт тёмной темой перед применением контрастной`
        );
        assert.match(html, /window\.UITheme\.initTheme\(\)/, `${file}: тема не применяется при загрузке`);
        assert.match(
            html,
            /window\.UITheme\.bindThemeSync\(window\.ipcRenderer[,)]/,
            `${file}: окно не слушает смену темы — переключение в панели его не догонит`
        );
    }
});

test('канал темы есть в обоих списках и в обе стороны', () => {
    const validator = require(path.join(ROOT, 'channel-validator.js'));
    assert.ok(validator.isValidChannel('ui-theme-update', 'send'), 'канал не разрешён на отправку');
    assert.ok(validator.isValidChannel('ui-theme-update', 'receive'), 'канал не разрешён на приём');
    // preload.js дублирует список руками (sandbox запрещает require) — оба обязаны совпадать.
    const preload = read('preload.js');
    assert.equal(
        (preload.match(/'ui-theme-update'/g) || []).length,
        2,
        'в preload.js канал темы обязан быть и в send, и в receive'
    );
});

test('главный процесс рассылает тему во все окна и проверяет значение', () => {
    const main = read('electron-main.js');
    const handler = /ipcMain\.on\('ui-theme-update'[\s\S]*?\n\}\);/.exec(main);
    assert.ok(handler, 'в главном процессе нет обработчика ui-theme-update');
    const body = handler[0];
    assert.match(body, /isPayloadObject\(payload\)/, 'payload не проверяется на объект');
    assert.match(body, /UI_THEME_VALUES\.has\(theme\)/, 'значение темы не проверяется по белому списку');
    for (const win of ['controlWindow', 'widgetWindow', 'displayWindow', 'clockWidgetWindow']) {
        assert.ok(body.includes(win), `рассылка не доходит до ${win}`);
    }
    assert.match(body, /safelySendToWindow\(/, 'отправка без safelySendToWindow — окно может быть уже разрушено');
});

test('кнопка переключения темы в панели: состояние и рассылка', () => {
    const html = read('electron-control.html');
    const btn = /<button[^>]*id="contrastToggle"[^>]*>/.exec(html);
    assert.ok(btn, 'кнопки переключения темы нет в разметке');
    assert.match(btn[0], /aria-pressed="false"/, 'кнопке-переключателю нужен aria-pressed');
    assert.match(btn[0], /type="button"/, 'кнопка внутри титлбара обязана быть type="button"');
    assert.match(btn[0], /aria-label=/, 'у кнопки нет доступного имени: её содержимое — глиф');

    // Обработчик обязан делать все четыре вещи: применить, сохранить, обновить
    // состояние кнопки и разослать остальным окнам. С 19.08.2026 он живёт в
    // panel-titlebar.js — вместе с кнопкой замка, у которой ровно та же
    // природа: величина общая для всех окон, кнопка одна, в титлбаре. В
    // разметке панели осталась кнопка и один вызов проводки.
    assert.match(html, /<script src="panel-titlebar\.js"><\/script>/, 'панель не подключает panel-titlebar.js');
    assert.match(html, /window\.PanelTitlebar\.bindThemeToggle\(/, 'кнопка темы ни к чему не привязана');
    const titlebar = fs.readFileSync(path.join(ROOT, 'panel-titlebar.js'), 'utf8');
    assert.match(titlebar, /theme\.applyTheme\(value\)/, 'тема не применяется локально');
    assert.match(titlebar, /theme\.storeTheme\(value\)/, 'тема не сохраняется');
    assert.match(titlebar, /setAttribute\('aria-pressed', String\(isLight\)\)/, 'aria-pressed не обновляется');
    assert.match(titlebar, /send\('ui-theme-update', \{ theme: value \}\)/, 'смена темы не рассылается в другие окна');
});

test('светлая тема гасит декорации, заданные литералами', () => {
    // Токены задают палитру, но декоративные слои (сиреневые градиенты подложки,
    // шумовая текстура, неоновая тень цифр) заданы прямо в правилах — их
    // приходится гасить адресно, иначе на белом остаются тёмные украшения от
    // темы по умолчанию.
    const css = read('control.css');
    for (const sel of ['.app-shell::before', 'body::after', '.settings-drawer', '.timer-display-main']) {
        assert.ok(
            new RegExp(`\\[data-theme="light"\\][^{]*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(css),
            `в светлой теме не переопределён ${sel}`
        );
    }
});

test('окна без своего фона: палитру выбирает ТОН, и она одна на три окна', () => {
    // История. Виджет и дисплей красит настройка фона (у виджета — подложка
    // стиля), применяется она инлайном и бьёт любую тему; значение по умолчанию
    // тёмное. Когда светлая тема переворачивала здесь текстовые токены,
    // получались почти чёрные цифры на тёмно-синем — на проекторе не читалось.
    // Лечили это ПИНОМ: «светлое по тёмному в обеих темах».
    //
    // 18.08.2026 пользователь попросил обратного: «чтобы вид тёмной и светлой
    // темы отражался на виджет и на полноэкранный режим». Пин снят не в пользу
    // темы, а в пользу ТОНА — решает измеренная яркость фактического фона, а
    // тема выбирает фон по умолчанию. Обе палитры лежат в одном файле.
    const tones = read('surface-tones.css');
    assert.match(
        tones, /:root:not\(\.on-light-bg\)[^{]*\{[\s\S]*?--tw-fg:\s*#ffffff/,
        'на тёмном тоне текст обязан быть светлым'
    );
    assert.match(
        tones, /:root\.on-light-bg\s*\{[\s\S]*?--tw-fg:\s*#1d1d1f/,
        'на светлом тоне текст обязан быть тёмным'
    );

    // Ни одно из трёх окон не должно держать СВОЮ копию палитры: ровно этим
    // был пин, и ровно поэтому он полрелиза не перечислял акцентов.
    for (const file of ['electron-widget.html', 'electron-clock-widget.html', 'display.css']) {
        assert.doesNotMatch(
            read(file), /\[data-theme="light"\]\s*\{[\s\S]*?--tw-fg:\s*#ffffff/,
            `${file}: пин по ТЕМЕ вернулся — решать обязана яркость фона`
        );
        assert.doesNotMatch(
            read(file), /:root\.on-light-bg\s*\{[\s\S]*?--tw-fg:/,
            `${file}: вторая копия палитры тона — она обязана быть одна, в surface-tones.css`
        );
    }
});

test('тон пересчитывается на смену темы, а не только при открытии окна', () => {
    // Без этого переключатель темы менял атрибут и не менял ни одного пикселя:
    // тема выбирает фон ПО УМОЛЧАНИЮ, значит могла смениться и палитра.
    const uiTheme = read('ui-theme.js');
    assert.match(uiTheme, /function applyTone\(/, 'нет владельца класса тона');
    assert.match(uiTheme, /onThemeChange\(theme\)/, 'bindThemeSync не зовёт колбэк');

    assert.match(read('display.html'), /onThemeChanged\(\)/, 'дисплей не перекрашивается на смену темы');
    for (const file of ['electron-widget.html', 'electron-clock-widget.html']) {
        assert.match(read(file), /refreshTone\(\)/, `${file}: тон не пересчитывается на смену темы`);
    }
});

test('в разметке панели не осталось инлайновых цветов', () => {
    // Инлайн-стиль бьёт любую тему: пока цвет висел в style=, тема до него не
    // доставала. Восемь таких атрибутов было, должно остаться ноль.
    const html = read('electron-control.html');
    const markup = html.slice(0, html.indexOf('<script src="ipc-compat.js"'));
    const inline = markup.match(/style="[^"]*(?:rgba?\(|#[0-9a-fA-F]{3,6})[^"]*"/g) || [];
    assert.deepEqual(inline, [], `инлайновые цвета вернулись в разметку: ${inline.join(' | ')}`);
});

test('отмена неона в светлой теме достижима: общий :root не переобъявляет её токены', () => {
    // Специфичность [data-theme="light"] и :root ОДИНАКОВА (0,1,0) — оба
    // селектора весят как один класс. При равной специфичности побеждает то,
    // что стоит НИЖЕ. Общий блок лежал в конце файла и возвращал --tw-glow-*
    // и --tw-shadow-panel к тёмным значениям, то есть вся отмена неона в
    // светлой теме была мертва: на белом рисовалось синее свечение 30px.
    // Комментарий рядом с ней («глубина на светлом даётся тенью, а не
    // свечением: неон по белому выглядит грязью») описывал намерение, которое
    // ни разу не сработало.
    const css = read('design-tokens.css');
    const lightAt = css.indexOf('[data-theme="light"] {');
    const sharedAt = css.indexOf('/* ---------------- SHARED (theme-independent) ---------------- */');
    assert.ok(lightAt > 0, 'блок светлой темы не найден');
    assert.ok(sharedAt > lightAt, 'общий блок должен идти ниже светлой темы');

    const shared = css.slice(sharedAt);
    for (const token of ['--tw-shadow-panel', '--tw-glow-blue', '--tw-glow-green', '--tw-glow-red']) {
        assert.ok(
            !new RegExp(`^\\s*${token}\\s*:`, 'm').test(shared),
            `${token} объявлен в общем блоке НИЖЕ светлой темы и убивает её значение`
        );
    }
});

test('лестница поверхностей и шкала объявлены в ОБЕИХ темах', () => {
    // --tw-level-1/2/3 существовали ТОЛЬКО для светлой темы, поэтому в тёмной
    // все заливки панели написаны литералами — 33 разных значения альфы в одном
    // control.css. Иерархию было нечем выразить.
    // --tw-track: треки колец брались из --tw-border, то есть из токена для
    // РАМОК, и давали 1.23:1 на тёмном, 1.52:1 на белом.
    const css = read('design-tokens.css');
    const dark = css.slice(css.indexOf(':root,'), css.indexOf('[data-theme="light"] {'));
    const light = css.slice(
        css.indexOf('[data-theme="light"] {'),
        css.indexOf('/* ---------------- REDUCED MOTION ---------------- */')
    );
    for (const token of ['--tw-level-1', '--tw-level-2', '--tw-level-3', '--tw-track']) {
        assert.match(dark, new RegExp(`${token}\\s*:`), `${token} нет в тёмной теме`);
        assert.match(light, new RegExp(`${token}\\s*:`), `${token} нет в светлой теме`);
    }
});
