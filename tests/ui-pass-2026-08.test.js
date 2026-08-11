'use strict';

/**
 * Регрессии UI-прохода от 07.08.2026.
 *
 * Проверки идут по исходникам: правила живут в inline-<style> окон и в
 * control.css, импортировать их нечем. По соглашению проекта каждая проверка
 * утверждает И наличие правильного поведения, И отсутствие старого сломанного —
 * иначе регрессия проскочит молча.
 *
 * Проверки отсутствия работают по копии БЕЗ комментариев (codeOnly): в этом
 * репозитории четыре assertion'а уже срабатывали на собственных объясняющих
 * комментариях.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./helpers/source-scan');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CSS = read('control.css');
const CSS_CODE = codeOnly(CSS);
const PANEL = read('electron-control.html');
const PANEL_CODE = codeOnly(PANEL);

/* ───────────────────────── панель: иерархия и геометрия ───────────────────── */

test('заголовок героя и заголовок секции — разные типографические уровни', () => {
    // Совпадали по ВСЕМ пяти свойствам (font-size, font-weight, color,
    // letter-spacing, text-transform), а компактный блок в конце файла сводил
    // их ещё и к одному кеглю: пять одинаковых серых микрополосок и ни одного
    // уровня, за который цепляется глаз.
    assert.match(CSS_CODE, /\.timer-header h1 \{[^}]*font-size:\s*11px/);
    assert.match(CSS_CODE, /\.timer-header h1 \{[^}]*letter-spacing:\s*1\.6px/);
    assert.match(CSS_CODE, /\.group-title \{[^}]*font-size:\s*10px/);
    assert.match(CSS_CODE, /\.group-title \{[^}]*font-weight:\s*700/);
});

test('линия --tw-divider разделяет секции, но НЕ строки внутри секции', () => {
    // Один и тот же токен стоял и между секциями, и между строками внутри
    // «ТОЧНОЙ НАСТРОЙКИ», поэтому «Точное время» и «Считать ниже нуля»
    // читались как самостоятельные разделы.
    for (const sel of ['.manual-time-row', '.timer-mode-row']) {
        const idx = CSS_CODE.indexOf(`${sel} {`);
        assert.ok(idx > 0, `правило ${sel} не найдено`);
        const rule = CSS_CODE.slice(idx, CSS_CODE.indexOf('}', idx));
        assert.ok(
            !/border-top:\s*1px solid var\(--tw-divider\)/.test(rule),
            `${sel} снова разделён секционной линией`
        );
    }
});

test('левый край панели набран ОДНОЙ ручкой', () => {
    // Было 12 / 14 / 16px в шести правилах: заголовок «НАСТРОЙКИ» и полоса
    // вкладок стояли на 2px правее панели, футер — на 2px левее.
    assert.match(CSS_CODE, /--panel-inset:\s*14px/);
    const uses = CSS_CODE.match(/var\(--panel-inset\)/g) || [];
    assert.ok(uses.length >= 6, `--panel-inset использован ${uses.length} раз, ожидалось ≥6`);
});

test('подложка героя рисуется, а не декларируется', () => {
    // 2% белого поверх #1e1e22 давало +4.5/255 в верхней точке и уходило в ноль
    // — ниже порога 8/255, который visual-diff.js вообще считает изменением.
    // Правило было, эффекта не было.
    assert.ok(
        !/\.timer-header \{[^}]*rgba\(255,\s*255,\s*255,\s*0\.02\)\s*0%/.test(CSS_CODE),
        'вернулся нерисуемый градиент 2%'
    );
    assert.match(CSS_CODE, /\.timer-header \{[^}]*rgba\(255,\s*255,\s*255,\s*0\.07\)\s*0%/);
});

test('подзаголовки внутри карточки не заданы инлайновым style', () => {
    // Инлайн бьёт любую тему и переживает любую правку CSS. Три уровня
    // заголовков выглядели одинаково, а разница держалась на style=.
    assert.ok(
        !/class="settings-group-title"\s+style=/.test(PANEL_CODE),
        'инлайновый style на .settings-group-title вернулся'
    );
    assert.match(CSS_CODE, /\.settings-subtitle \{/);
});

/* ────────────────────────── панель: состояния и мишени ───────────────────── */

test('«пуск» во время работы недоступен, а не сломан', () => {
    // Общее .main-btn:disabled даёт opacity .4 + grayscale .6 — зелёный круг
    // превращался в мутно-оливковый и читался как поломка, а не как «пуск
    // сейчас недоступен».
    assert.match(CSS_CODE, /\.main-btn\.start:disabled \{[^}]*filter:\s*none/);
    assert.match(CSS_CODE, /\.main-btn\.start:disabled \{[^}]*opacity:\s*1/);
});

test('плашка статуса панели красится состоянием, но БЕЗ анимации', () => {
    // Панель несла состояние одной 8-пиксельной точкой, тогда как полноэкранное
    // окно заливает плашку целиком: одно состояние в двух окнах показано
    // принципиально по-разному.
    for (const state of ['running', 'paused', 'finished', 'overtime']) {
        assert.match(
            CSS_CODE,
            new RegExp(`\\.timer-status:has\\(\\.status-dot\\.${state}\\)`),
            `нет заливки для состояния ${state}`
        );
    }
    // Пульсация точки — ЕДИНСТВЕННОЕ, что отличает «идёт перерасход» от «уже
    // завершено» при одном красном цвете. Анимация на самой плашке это
    // различие уничтожит.
    const rules = CSS_CODE.match(/\.timer-status:has\([^)]+\)[^{]*\{[^}]*\}/g) || [];
    assert.ok(rules.length > 0, 'правила заливки не найдены');
    for (const rule of rules) {
        assert.ok(!/animation/.test(rule), `анимация на плашке статуса: ${rule.slice(0, 80)}`);
    }
});

test('минус и плюс равнозначны — ни красного, ни синего в ряду', () => {
    // Минусы были покрашены --tw-red, то есть цветом перерасхода: уменьшение
    // времени читалось как опасное действие. Красить минус нейтральным, а плюс
    // синим — та же ошибка с другой стороны: «добавить» становится действием по
    // умолчанию. Направление несёт знак ±.
    assert.ok(
        !/\.adjust-main-btn\.minus \{[^}]*var\(--tw-red\)/.test(CSS_CODE),
        'минус снова покрашен цветом перерасхода'
    );
    assert.match(
        CSS_CODE,
        /\.adjust-main-btn\.minus,\s*\.adjust-main-btn\.plus \{[^}]*var\(--tw-fg-secondary\)/
    );
});

test('разделитель ряда — волосяная линия, а не синяя каретка', () => {
    const rule = CSS_CODE.match(/\.adjust-divider \{[^}]*\}/)[0];
    assert.ok(!/var\(--tw-blue\)|linear-gradient/.test(rule), 'вернулась синяя черта');
    assert.match(rule, /width:\s*1px/);
    assert.match(rule, /var\(--tw-border-strong\)/);
});

test('кружок под значком окна имеет габарит', () => {
    // Компактный блок обнулял width/height, оставляя фон и border-radius: 50%:
    // вместо кружка рисовалось тесное пятно по размеру глифа, и заливка
    // активного состояния почти не читалась.
    assert.ok(
        !/\.quick-window-btn \.qw-icon \{[^}]*width:\s*auto/.test(CSS_CODE),
        'габарит подложки значка снова обнулён'
    );
    assert.match(CSS_CODE, /\.quick-window-btn \.qw-icon \{[^}]*width:\s*18px/);
});

test('закрытое окно в ряду ОКНА не выглядит открытым', () => {
    // И покой, и активность были залиты синим одного семейства, различие несла
    // в основном альфа. Состояние должны нести только .active и индикатор.
    const idx = CSS_CODE.indexOf('.quick-window-btn {');
    const rule = CSS_CODE.slice(idx, CSS_CODE.indexOf('}', idx));
    assert.ok(!/var\(--tw-blue\)/.test(rule), 'покой снова залит акцентом');
});

test('мишени панели используют собственный токен проекта', () => {
    // --tw-hit-min: 32px объявлен в design-tokens.css и не был использован ни разу.
    const uses = CSS_CODE.match(/var\(--tw-hit-min\)/g) || [];
    assert.ok(uses.length >= 5, `--tw-hit-min использован ${uses.length} раз, ожидалось ≥5`);
});

test('зона попадания кнопок окна расширена псевдоэлементом, а не габаритом', () => {
    // Вариант с width: 24px + padding + background-clip: content-box рисует
    // скруглённые КВАДРАТЫ: border-radius: 50% считается по border-боксу 24px,
    // а заливка обрезается по контент-боксу 12×12. Проверено на превью.
    assert.ok(
        !/\.custom-titlebar \.win-btn \{[^}]*background-clip:\s*content-box/.test(CSS_CODE),
        'вернулся background-clip, рисующий квадраты'
    );
    assert.match(CSS_CODE, /\.custom-titlebar \.win-btn::after \{[^}]*inset:\s*-6px/);
});

/* ─────────────────────────────── ящик настроек ───────────────────────────── */

test('значки групп — inline SVG, а не эмодзи', () => {
    // Эмодзи рисуются системным emoji-шрифтом: не наследуют currentColor, не
    // участвуют ни в одной теме и выглядят по-разному на macOS, Windows и
    // Linux. В светлой теме ✨ у «ЦВЕТА ЧАСОВ» — почти невидимый бледно-жёлтый
    // глиф на белой карточке.
    // Плюс у .icon не было aria-hidden (в отличие от .hint-icon рядом), поэтому
    // скринридер зачитывал НАЗВАНИЯ эмодзи прямо внутри заголовка группы.
    const icons = PANEL_CODE.match(/<span class="icon"[^>]*>[\s\S]*?<\/span>/g) || [];
    assert.ok(icons.length >= 9, `значков ${icons.length}, ожидалось ≥9`);
    for (const icon of icons) {
        assert.match(icon, /aria-hidden="true"/, `значок без aria-hidden: ${icon.slice(0, 50)}`);
        assert.match(icon, /<svg/, `значок остался эмодзи: ${icon.slice(0, 50)}`);
        assert.match(icon, /stroke="currentColor"/, `значок не наследует цвет: ${icon.slice(0, 50)}`);
    }
    assert.ok(
        !/[\u{1F300}-\u{1FAFF}]/u.test(icons.join('')),
        'в значках остались эмодзи'
    );
});

test('подсветка эмодзи снята — штриховому значку она не нужна', () => {
    assert.ok(
        !/\.settings-group-title \.icon \{[^}]*filter:\s*brightness/.test(CSS_CODE),
        'brightness(1.3) вернулся'
    );
    assert.match(CSS_CODE, /\.settings-group-title \.icon[^{]*\{[^}]*width:\s*13px/);
});

test('свотчи цвета — группа радиокнопок, а не восемь безымянных кнопок', () => {
    // Состояние жило ТОЛЬКО в CSS-классе: скринридер видел восемь одинаковых
    // кнопок без текста и не мог сказать, какая выбрана. Правильный паттерн
    // (radiogroup / radio / aria-checked) уже применён в этом же файле у
    // сегментированных контролов.
    //
    // Режем именно buildThemeGrid, а не ищем по всему файлу: role="radio"
    // есть у сегментированных контролов (_attachSegmented), и проверка по
    // файлу прошла бы вхолостую, ничего не доказав про свотчи.
    // Блок уехал из inline-скрипта панели в theme-grid.js — страж
    // control-decomposition держит объём кода внутри HTML под 2000 строк и
    // сработал ровно на этом добавлении.
    const grid = codeOnly(read('theme-grid.js'));
    assert.match(grid, /setAttribute\('role',\s*'radio'\)/);
    assert.match(grid, /setAttribute\('aria-checked'/);
    assert.match(grid, /setAttribute\('aria-label',\s*theme\.name\)/);
    assert.match(grid, /setAttribute\('role',\s*'radiogroup'\)/);
});

test('пипетка — настоящая кнопка с состоянием', () => {
    // Была <div role="button"> среди настоящих <button>, открывала панель и
    // никогда не сообщала об этом: ни aria-expanded, ни визуального «нажата».
    // Правило .color-picker-toggle.active в CSS есть, а класс на неё не вешал
    // никто — состояние было описано и мертво.
    const code = codeOnly(read('color-picker.js'));
    assert.ok(!/createElement\('div'\)/.test(code), 'пипетка снова div');
    assert.match(code, /aria-expanded/);
    assert.match(code, /classList\.toggle\('active'/);
});

test('светлая тема доехала до шапки ящика', () => {
    // Крестик описан белыми литералами, а светлая тема перекрывала у него
    // только цвет текста: подложка и рамка исчезали целиком, оставался голый
    // символ без границ мишени.
    assert.match(CSS_CODE, /\[data-theme="light"\] \.drawer-close \{[^}]*var\(--tw-level-2\)/);
    assert.match(CSS_CODE, /\[data-theme="light"\] \.drawer-head \{[^}]*border-bottom-color/);
});

test('выбранный свотч выглядит выбраннее наведённого', () => {
    // Масштаб активного (1.1) был МЕНЬШЕ масштаба при наведении (1.18).
    const scale = (s) => Number((s.match(/scale\(([\d.]+)\)/) || [0, 0])[1]);
    // Якорим на начало строки: иначе `[data-theme="light"] .theme-btn.active`
    // выше по файлу перехватывает совпадение, и сравнивались бы не те правила.
    const hover = CSS_CODE.match(/^\.theme-btn:hover \{[^}]*\}/m)[0];
    const active = CSS_CODE.match(/^\.theme-btn\.active \{[^}]*\}/m)[0];
    assert.ok(
        scale(active) >= scale(hover),
        `активный ${scale(active)} меньше наведённого ${scale(hover)}`
    );
    // Белый ореол выбора на белой карточке светлой темы не существует.
    assert.match(CSS_CODE, /\[data-theme="light"\] \.theme-btn\.active \{[^}]*rgba\(0, 0, 0/);
});

test('геометрия ящика объявлена один раз и симметрично', () => {
    // Правила в начале файла были переобъявлены в конце без медиазапроса:
    // правка первых не давала эффекта, а читатель видел там мёртвые значения.
    const decls = CSS_CODE.match(/\.drawer-body \{[^}]*padding:[^;]+;/g) || [];
    assert.equal(decls.length, 1, `.drawer-body с padding объявлен ${decls.length} раз`);
    assert.ok(
        !/padding:\s*10px 10px 12px 14px/.test(CSS_CODE),
        'вернулся несимметричный отступ тела ящика'
    );
});

/* ──────────────────────────── имя полноэкранного окна ────────────────────── */

test('полноэкранное окно называется одинаково везде', () => {
    // Было ТРИ имени на одно окно: «Дисплей» в ряду ОКНА, «Полноэкр.» на
    // вкладке и «Полноэкранный» в шапке выехавшего ящика — то есть по клику на
    // вкладку «Полноэкр.» открывался ящик с третьим названием.
    assert.match(PANEL_CODE, /data-tab="display"[^>]*>Дисплей</);
    assert.match(PANEL_CODE, /display:\s*'Дисплей'/);
    assert.ok(!/>Полноэкр\.</.test(PANEL_CODE), 'вкладка снова называется «Полноэкр.»');
});

/* ─────────────────────── один владелец дефолтного цвета ──────────────────── */

test('дефолтный цвет таймера — один на все окна', () => {
    // Их было ТРИ: панель держала #667eea/#764ba2 (фиолетовая пара, которой нет
    // в токенах вообще), виджет #0a84ff/#30d158, а дисплей не применял ничего и
    // оставался на CSS-зелёном. Поэтому один и тот же стиль LED выглядел
    // зелёным на дисплее и синим в виджете — расхождение было не в CSS,
    // а в данных.
    const CONFIG = require(path.join(ROOT, 'constants.js'));
    assert.deepEqual(CONFIG.DEFAULT_TIMER_COLORS, { timer: '#0a84ff', progress: '#30d158' });
    assert.ok(Object.isFrozen(CONFIG.DEFAULT_TIMER_COLORS));

    // Токен читает ПАНЕЛЬ: он задаёт её стартовое состояние вместо
    // фиолетовой пары #667eea/#764ba2, которой нет в наборе токенов.
    assert.match(PANEL_CODE, /DEFAULT_TIMER_COLORS\.timer/);
    assert.ok(!/timer:\s*'#667eea'/.test(PANEL_CODE), 'фиолетовая пара вернулась в панель');

    // А ОКНА дефолт не подставляют: владельцем остаётся CSS, и каждый стиль
    // выглядит так, как описан. Виджет раньше писал #0a84ff инлайном, и это
    // било любое правило: зелёный --tw-led-green не срабатывал никогда.
    const widget = codeOnly(read('electron-widget.html'));
    assert.ok(!/timer:\s*'#0a84ff'/.test(widget), 'в виджете остался захардкоженный дефолт');
    assert.match(widget, /if \(!colors\) \{ return; \}/);

    const display = codeOnly(read('display-script.js'));
    assert.ok(!/DEFAULT_TIMER_COLORS/.test(display), 'дисплей снова подставляет дефолт');

    // Пятая палитра CONFIG.DEFAULT_COLORS была мертва — её не читал никто, — и
    // держала overtime: '#ff6b35', то есть запрещённый в проекте оранжевый.
    assert.equal(CONFIG.DEFAULT_COLORS, undefined, 'мёртвая палитра вернулась');
});

/* ────────────────────────────────── виджет ───────────────────────────────── */

const WIDGET = read('electron-widget.html');
const WIDGET_CODE = codeOnly(WIDGET);

test('трек кольца виджета — шкала, а не намёк', () => {
    // Было rgba(255,255,255,0.08) → ≈1.2:1 на циферблате: у прогресса не было
    // опорной шкалы, дуга висела в пустоте. Замер на измеренном фоне
    // rgb(22,20,44): 0.35 даёт rgb(104,102,118) → 3.18:1. 0.32 давало бы
    // 2.85:1 и порога не брало — компенсировать альфой ниже нельзя, только
    // толщиной.
    const rule = WIDGET_CODE.match(/^\s*\.progress-track \{[^}]*\}/m)[0];
    assert.ok(!/0\.08/.test(rule), 'вернулась невидимая альфа 0.08');
    assert.match(rule, /stroke:\s*var\(--tw-track\)/);
    // Окно светлую тему не принимает, поэтому токен обязан быть ПРИБИТ в его
    // собственном блоке — иначе он приедет из design-tokens.css со светлым
    // значением #949499 на тёмном циферблате.
    assert.match(WIDGET_CODE, /\[data-theme="light"\][^}]*--tw-track:\s*rgba\(255, 255, 255, 0\.35\)/);
});

test('карточки флипа — полупрозрачные, без внешних теней и без backdrop-filter', () => {
    // Якорим на НАЧАЛО правила: без этого регулярка цепляет составной селектор
    // `.widget-flip-card.flipping .widget-flip-inner { animation: … }` и
    // проверяет не то правило. Та же ловушка, что и с .theme-btn.active.
    const rule = WIDGET_CODE.match(/^\s*\.widget-flip-inner \{[^}]*\}/m)[0];
    assert.match(rule, /rgba\(42,\s*42,\s*53,\s*0\.85\)/);
    // Окно transparent + hasShadow: false — внешняя тень даёт видимый тёмный
    // прямоугольник вокруг окна.
    // \s+, а не \s*: при \s* регулярка отступает на ноль пробелов, проверяет
    // (?!inset) на самом пробеле — и матчит `box-shadow: inset …`, то есть
    // ровно то, что должна была пропустить.
    assert.ok(!/box-shadow:\s+(?!inset)[^;]*;/.test(rule), 'внешняя тень на прозрачном окне');
    // Родитель .widget-flip-card.flipping крутится по rotateX, а backdrop-filter
    // заводит собственный контекст композитинга и на 3D ведёт себя по-разному
    // на платформах: риск там, где нечего выигрывать.
    assert.ok(!/backdrop-filter/.test(rule), 'backdrop-filter на анимируемой карточке');
});

test('reduced-motion гасит движение, а не информацию', () => {
    // Сплошное animation-duration: 1ms убивало подсказку целиком: hintFade идёт
    // с forwards, поэтому мгновенно доезжала до последнего кадра (opacity 0 +
    // display none) и не появлялась вовсе. Движения в ней нет — анимируется
    // только opacity, а «reduce» требует убрать движение, не кросс-фейд.
    for (const [file, src] of [['виджет', WIDGET_CODE], ['часы', codeOnly(read('electron-clock-widget.html'))]]) {
        assert.match(
            src,
            /prefers-reduced-motion[\s\S]{0,800}\.widget-hint \{\s*animation-duration:\s*4s/,
            `${file}: подсказка снова гасится под reduced-motion`
        );
    }
});

/* ────────────────────── дисплей: три мёртвых правила ─────────────────────── */

const DISPLAY_JS = codeOnly(read('display-script.js'));
const DISPLAY_HTML = codeOnly(read('display.html') + '\n' + read('display.css'));

test('LED-«внимание» на дисплее совпадает с собственным CSS дисплея', () => {
    // Исходный дефект: JS писал #ffc107 инлайном, а CSS говорил
    // --tw-led-warn = #ffcc00. Правило .digital-time.warning не применялось
    // НИКОГДА, потому что инлайн бьёт класс, и пользователь видел цвет, которого
    // в стилях не было.
    //
    // Раньше тест требовал, чтобы в ветке LED стоял #ffcc00 (то есть чтобы две
    // копии значения совпадали). С 11.08.2026 копий нет: цвет полосы задаёт
    // ТОЛЬКО CSS, а JS ставит класс. Совпадать нечему — источник один.
    // Проверяем именно это, иначе тест требовал бы вернуть вторую копию.
    const from = DISPLAY_JS.indexOf('updateDigitalDisplay(secs, _formatted) {');
    const to = DISPLAY_JS.indexOf('updateFlipDisplay(secs) {');
    assert.ok(from > 0 && to > from, 'ветка LED не найдена');
    const led = DISPLAY_JS.slice(from, to);
    assert.ok(!/#ffc107|#ffcc00|#ff3333/.test(led),
        'в ветку LED вернулся цветовой литерал — цвет полосы принадлежит CSS');
    assert.match(led, /classList\.add\('warning'\)/, 'ветка LED обязана ставить класс полосы');

    // Единственный источник значения — правило CSS, и оно берёт токен.
    const css = fs.readFileSync(path.join(__dirname, '..', 'display.css'), 'utf8');
    assert.match(css, /\.digital-time\.warning \{[^}]*color: var\(--tw-led-warn\)/,
        '.digital-time.warning обязано красить токеном --tw-led-warn');
});

test('глиф статуса имеет ОДНОГО владельца', () => {
    // CSS гасит текст элемента font-size: 0 и рисует свой символ через
    // ::before, то есть присвоение textContent из JS было мертво — а списки
    // при этом разошлись содержимым (finished: JS '✓', CSS '×').
    assert.ok(!/glyph:\s*'/.test(DISPLAY_JS), 'поле glyph вернулось в объект CHIP');
    assert.ok(!/glyphEl/.test(DISPLAY_JS), 'JS снова пишет глиф');
    assert.match(DISPLAY_HTML, /class="status-glyph"[^>]*aria-hidden="true"><\/span>/);
});

test('режим «Заливка» действительно заливает', () => {
    // Три радиальных свечения из body::before рисовались ПОВЕРХ любого
    // пользовательского фона, а комментарий над правилом утверждал обратное.
    assert.match(DISPLAY_JS, /classList\.add\('custom-bg'\)/);
    assert.match(DISPLAY_JS, /classList\.remove\('custom-bg'\)/);
    assert.match(DISPLAY_HTML, /body\.custom-bg::before \{[^}]*display:\s*none/);
});
