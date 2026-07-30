'use strict';

/**
 * Регрессии по аудиту от 29.07.2026.
 *
 * Всё исправленное здесь живёт в inline-скриптах HTML-окон и в display-script.js,
 * поэтому проверки — исходникового уровня, как в electron-main-source.test.js и
 * visual-source.test.js. Задача каждого теста — не дать конкретному багу молча
 * вернуться, поэтому проверяется и наличие правильного поведения, и отсутствие
 * старого (сломанного).
 */

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

const controlHtml = readControlSource();
const widgetHtml = read('electron-widget.html');
const clockHtml = read('electron-clock-widget.html');
const displayScript = read('display-script.js');
const mainSource = read('electron-main.js');

// ---------------------------------------------------------------------------
// Звук
// ---------------------------------------------------------------------------

test('пресет «— без звука —» не проигрывает запасной beep', () => {
    // Баг: playSound() на preset === 'none' вызывал beep(880, 0.15), из-за чего
    // опцию «без звука» невозможно было использовать по назначению.
    const playSound = controlHtml.match(/async playSound\(type\)\s*\{[\s\S]*?\n {12}\}/);
    assert.ok(playSound, 'playSound() должен существовать');
    assert.match(playSound[0], /if \(preset === 'none'\) \{ return; \}/);
    assert.doesNotMatch(playSound[0], /preset === 'none'[\s\S]*?this\.beep\(/);
});

test('превью звука для пресета «none» молчит и объясняет почему', () => {
    const preview = controlHtml.match(/async previewSound\(type\)\s*\{[\s\S]*?\n {12}\}/);
    assert.ok(preview, 'previewSound() должен существовать');
    assert.match(preview[0], /Toast\.show\(/);
    assert.doesNotMatch(preview[0], /preset === 'none'[\s\S]*?await this\.beep\(/);
});

test('мастер-чекбокс звука ведёт за собой флаг soundEnabled', () => {
    // Баг: soundEnabled жил отдельно от чекбокса и грузился из localStorage.
    // Сохранённое soundEnabled=false навсегда глушило playSound(), при этом
    // чекбокс показывал «включено», а единственный переключатель был скрыт.
    assert.match(controlHtml, /setSoundEnabled\(enabled\)\s*\{/);
    const masterHandler = controlHtml.match(
        /this\.soundMasterEl\.addEventListener\('change',[\s\S]*?\}\);/
    );
    assert.ok(masterHandler, 'обработчик мастер-чекбокса должен существовать');
    assert.match(masterHandler[0], /this\.setSoundEnabled\(this\.soundMasterEl\.checked\)/);

    // loadSettings() тоже обязан синхронизировать флаг с чекбоксом.
    assert.match(
        controlHtml,
        /this\.soundMasterEl\.checked = ext\.soundMasterEnabled !== false;[\s\S]{0,300}?this\.setSoundEnabled\(this\.soundMasterEl\.checked\)/
    );
});

// ---------------------------------------------------------------------------
// Клавиатура
// ---------------------------------------------------------------------------

test('Escape не закрывает окна поверх открытой модалки или панели настроек', () => {
    // Баг: глобальный обработчик Esc закрывал дисплей/виджет/часы одновременно
    // с закрытием модалки или drawer — все три слушателя висят на document.
    assert.match(controlHtml, /function _isEscapeConsumedByOverlay\(\)/);
    const escBranch = controlHtml.match(
        /else if \(event\.code === 'Escape'\) \{[\s\S]*?\n {12}\}/
    );
    assert.ok(escBranch, 'ветка Escape должна существовать');
    assert.match(escBranch[0], /if \(_isEscapeConsumedByOverlay\(\)\) \{ return; \}/);

    // Проверяем, что охранник учитывает все три слоя.
    const guard = controlHtml.match(/function _isEscapeConsumedByOverlay\(\)[\s\S]*?\n {8}\}/);
    assert.match(guard[0], /keyboard-shortcuts-overlay/);
    assert.match(guard[0], /classList\.contains\('show'\)/);
    assert.match(guard[0], /settingsDrawer/);
});

test('справка по F1 описывает реальные пресеты 1—8, а не выдуманные 1-5', () => {
    // Баг: в справке значилось «1-5 — пресеты (1, 5, 10, 15, 30 мин)», хотя
    // обработчик слушает Digit1..Digit8 и раскладывает 5..60 минут.
    // Оверлей справки переехал в shortcuts-help.js при декомпозиции панели, а
    // обработчик остался в electron-control.html — тест держит их согласованными.
    const help = read('shortcuts-help.js');
    assert.doesNotMatch(help, /'1-5', 'Быстрые пресеты/);
    assert.match(help, /\['1—8', 'Пресеты: 5, 10, 15, 20, 25, 30, 45, 60 мин'\]/);

    // Набор пресетов в справке обязан совпадать с обработчиком.
    const handlerPresets = controlHtml.match(
        /const presets = \[300, 600, 900, 1200, 1500, 1800, 2700, 3600\]/
    );
    assert.ok(handlerPresets, 'обработчик Digit1..8 должен раскладывать 8 пресетов');
});

test('оверлей справки нарисован в тёмной теме приложения', () => {
    // Баг: панель была `background: white` поверх тёмного стеклянного UI.
    const overlay = read('shortcuts-help.js');
    assert.match(overlay, /function showKeyboardShortcuts\(\)/);
    assert.doesNotMatch(overlay, /background:\s*white/);
    assert.match(overlay, /background: rgba\(28, 28, 30/);
});

test('переключатель палитры доступен с клавиатуры', () => {
    // У элемента role="button" + tabindex="0", но обработчика keydown не было —
    // сфокусироваться можно, активировать нельзя.
    // addPickerToggle переехал в color-picker.js при декомпозиции панели.
    const addToggle = read('color-picker.js').match(/function addPickerToggle\([\s\S]*?\n\}/);
    assert.ok(addToggle, 'addPickerToggle() должен существовать');
    assert.match(addToggle[0], /toggle\.setAttribute\('role', 'button'\)/);
    assert.match(addToggle[0], /toggle\.addEventListener\('keydown'/);
    assert.match(addToggle[0], /e\.key === 'Enter' \|\| e\.key === ' '/);
});

// ---------------------------------------------------------------------------
// Масштабы
// ---------------------------------------------------------------------------

test('ползунки масштаба совпадают по диапазону с Ctrl/Shift+колесом', () => {
    // Баг: слайдер дисплея допускал 30..600, а колесо и восстановление из
    // localStorage — только 30..300; блоки: слайдер 50..400 против 50..600.
    // Значение вне общего диапазона молча терялось при перезапуске.
    assert.match(controlHtml, /id="displayTimerScale" min="30" max="300"/);
    assert.match(controlHtml, /id="timeBlocksScale" min="50" max="600"/);
    assert.match(controlHtml, /getElementById\('displayTimerScale'\),\s*\n\s*30, 300, 100,/);
    assert.match(controlHtml, /getElementById\('timeBlocksScale'\),\s*\n\s*50, 600, 100,/);

    // Источник истины на стороне дисплея.
    assert.match(displayScript, /const TIMER_MIN_SCALE = 30;/);
    assert.match(displayScript, /const TIMER_MAX_SCALE = 300;/);
    assert.match(displayScript, /const BLOCK_MIN_SCALE = 50;/);
    assert.match(displayScript, /const BLOCK_MAX_SCALE = 600;/);
});

test('масштаб дисплея применяется только при реальном движении ползунка', () => {
    // Баг: localStorage имел безусловный приоритет над settings, поэтому после
    // первого же Ctrl+колеса ползунок в панели становился мёртвым навсегда.
    assert.doesNotMatch(
        displayScript,
        /this\.timerScale = localScale \|\| settings\.timerScale/
    );
    assert.match(displayScript, /incoming !== this\._lastPushedTimerScale/);
    assert.match(displayScript, /incoming !== this\._lastPushedBlockScale/);
    // Первая посылка после открытия окна не должна перебивать локальный масштаб.
    assert.match(displayScript, /this\._lastPushedTimerScale === undefined/);
});

// ---------------------------------------------------------------------------
// Геометрия виджетов
// ---------------------------------------------------------------------------

test('виджет таймера запоминает масштаб и позицию между запусками', () => {
    // Баг: Ctrl+колесо нигде не сохранялось, а loadSettings() безусловно звал
    // setSize('medium') — окно каждый раз возвращалось к 250×250 в угол экрана.
    assert.match(widgetHtml, /restoreGeometry\(\)\s*\{/);
    assert.match(widgetHtml, /saveGeometry\(scalePct\)\s*\{/);
    assert.match(widgetHtml, /localStorage\.setItem\('widgetGeometry'/);
    assert.match(widgetHtml, /ipcRenderer\.send\('widget-set-position', \{ x: geo\.x, y: geo\.y \}\)/);
    // Мёртвый пресетный setSize() убран вместе с его localStorage-ключом.
    assert.doesNotMatch(widgetHtml, /this\.setSize\(savedSize\)/);
    assert.doesNotMatch(widgetHtml, /localStorage\.setItem\('widgetSize'/);
});

test('виджет часов запоминает масштаб и позицию между запусками', () => {
    assert.match(clockHtml, /restoreGeometry\(\)\s*\{/);
    assert.match(clockHtml, /saveGeometry\(scalePct\)\s*\{/);
    assert.match(clockHtml, /localStorage\.setItem\('clockGeometry'/);
    assert.match(clockHtml, /ipcRenderer\.send\('clock-widget-set-position', \{ x: geo\.x, y: geo\.y \}\)/);
    assert.doesNotMatch(clockHtml, /this\.setSize\(savedSize\)/);
    assert.doesNotMatch(clockHtml, /localStorage\.setItem\('clockWidgetSize'/);
});

test('сохранённая позиция восстанавливается только на реально подключённый монитор', () => {
    // Позиция переживает перезапуск, поэтому может указывать на отключённый
    // монитор. Без проверки виджет уезжал бы за пределы видимой области, и
    // вернуть его мышью было бы невозможно.
    assert.match(mainSource, /function positionWindowClamped\(win, payload\)/);
    assert.match(mainSource, /screen\.getAllDisplays\(\)\.some/);
    assert.match(mainSource, /screen\.getPrimaryDisplay\(\)\.workArea/);
    // Оба окна ходят через общий помощник.
    assert.match(mainSource, /ipcMain\.on\('widget-set-position',[\s\S]{0,120}?positionWindowClamped\(widgetWindow, payload\)/);
    assert.match(mainSource, /ipcMain\.on\('clock-widget-set-position',[\s\S]{0,120}?positionWindowClamped\(clockWidgetWindow, payload\)/);
});

test('масштаб из панели не затирает масштаб, выставленный на самом виджете', () => {
    // Панель повторно шлёт timerScale при смене стиля и один раз при загрузке.
    const handler = widgetHtml.match(
        /this\.widgetStyleUpdateHandler = \(event, settings\) => \{[\s\S]*?\n {16}\};/
    );
    assert.ok(handler, 'widgetStyleUpdateHandler должен существовать');
    assert.match(handler[0], /incoming !== this\._lastPushedTimerScale/);
});

// ---------------------------------------------------------------------------
// Мёртвый код
// ---------------------------------------------------------------------------

test('лимит перерасхода реально доходит до движка', () => {
    // Раньше #overrunLimit лежал в display:none-блоке, а getConfig() и
    // saveExtSettings() жёстко подставляли 0 — пользователь мог задать лимит,
    // и ничего бы не произошло. Движок timer-engine поддерживал его всегда.
    assert.doesNotMatch(controlHtml, /overrunLimitSeconds: 0/);
    assert.match(controlHtml, /overrunLimitSeconds: this\.readOverrunLimit\(\)/);
    assert.match(controlHtml, /readOverrunLimit\(\)\s*\{/);
    // Значение сохраняется, а не обнуляется на каждом сохранении настроек.
    assert.doesNotMatch(controlHtml, /const overrunSecs = 0;/);
    assert.match(controlHtml, /const overrunSecs = this\.readOverrunLimit\(\);/);

    // Поле видимое и живёт в строке, которая показывается вместе с минусом.
    assert.match(controlHtml, /<div class="manual-time-row" id="overrunRow"/);
    assert.match(controlHtml, /id="overrunLimit"/);
    // Лимит досылается сразу, не дожидаясь следующей команды таймера.
    assert.match(controlHtml, /pushOverrunLimit\(\)\s*\{/);
});

// ---------------------------------------------------------------------------
// Залипшие цвета: ветки danger/overtime пишут ИНЛАЙНОВЫЕ стили (инлайн бьёт
// CSS-класс), поэтому ветка нормального времени обязана их снимать. Раньше
// восстановление было записано как `else if (this._baseTimerColor)` без
// завершающего else — без пользовательской темы `_baseTimerColor` не определён,
// ветка не срабатывала, и время оставалось красным навсегда, в том числе после
// установки нового пресета.
// ---------------------------------------------------------------------------

test('восстановление цвета не зависит от наличия пользовательской темы', () => {
    // Ни одного «условного» восстановления не должно остаться в КОДЕ дисплея.
    // Шаблон `} else if (...) {` намеренно требует закрывающую скобку — иначе
    // регулярка ловит собственный поясняющий комментарий к _normalColor().
    assert.doesNotMatch(displayScript, /\} else if \(this\._baseTimerColor\) \{/);
    assert.doesNotMatch(displayScript, /if \(digit && this\._baseTimerColor\)/);

    // Ветка цифр flip в виджете обязана иметь завершающий else со сбросом.
    assert.match(
        widgetHtml,
        /digit\.style\.color = '#ffc107';\s*\n\s*\} else \{[\s\S]{0,400}?digit\.style\.color = this\._baseTimerColor \|\| ''/
    );

    // Вместо условных веток — помощники, которые при отсутствии темы отдают
    // пустую строку, то есть УДАЛЯЮТ инлайновый стиль и возвращают управление CSS.
    assert.match(displayScript, /_normalColor\(\)\s*\{\s*return this\._baseTimerColor \|\| '';/);
    assert.match(displayScript, /_normalGlow\(\)\s*\{\s*return this\._baseTimerColor \?/);
});

test('цифровой стиль дисплея сбрасывает красный при возврате в норму', () => {
    const digital = displayScript.match(/updateDigitalDisplay\(secs, _formatted\)\s*\{[\s\S]*?\n {4}\}/);
    assert.ok(digital, 'updateDigitalDisplay должен существовать');
    // Лесенка полос заканчивается безусловным else, который сбрасывает и цвет,
    // и свечение — без него инлайновый красный переживал возврат в норму.
    assert.match(
        digital[0],
        /\} else \{\s*\n\s*this\.digitalTime\.style\.color = this\._normalColor\(\);\s*\n\s*this\.digitalTime\.style\.textShadow = this\._normalGlow\(\);/
    );
});

test('flip-стиль дисплея сбрасывает цвет цифр и разделителей', () => {
    const flip = displayScript.match(/updateFlipDisplay\(secs\)\s*\{[\s\S]*?\n {4}\}\n/);
    assert.ok(flip, 'updateFlipDisplay должен существовать');
    // Цвет считается один раз и применяется БЕЗУСЛОВНО и к цифрам, и к
    // разделителям: для нормальной полосы это _normalColor(), то есть сброс инлайна.
    assert.match(flip[0], /const digitColor = BAND_COLOR\[band\] \|\| this\._normalColor\(\)/);
    assert.match(flip[0], /if \(digit\) \{ digit\.style\.color = digitColor; \}/);
    assert.match(flip[0], /flipSeparators\.forEach\(el => \{ el\.style\.color = digitColor; \}\)/);
});

test('аналоговый стиль дисплея снимает инлайновые красные стрелки и центр', () => {
    // Ветка перерасхода красит стрелку/центр инлайном; без обратного сброса они
    // оставались красными до следующей смены темы.
    const analog = displayScript.match(/updateAnalogDisplay\(secs\)\s*\{[\s\S]*?\n {4}\}\n/);
    assert.ok(analog, 'updateAnalogDisplay должен существовать');
    assert.match(analog[0], /this\.analogHandSecond\.style\.background = this\._baseSecondHandBg \|\| ''/);
    assert.match(analog[0], /clockCenter\.style\.background = this\._baseCenterBg \|\| ''/);
    assert.match(analog[0], /this\.analogDigitalTime\.style\.color = this\._baseAnalogDigitalColor \|\| ''/);
    // Базовые значения должны запоминаться в applyColors ВСЕГДА, иначе восстанавливать нечем.
    assert.match(displayScript, /this\._baseSecondHandBg =\s*\n?\s*`linear-gradient/);
    assert.match(displayScript, /this\._baseCenterBg = `linear-gradient/);
});

test('круглый стиль дисплея сбрасывает цвет и без пресета', () => {
    const progress = displayScript.match(/updateProgress\(\)\s*\{[\s\S]*?\n {4}\}\n/);
    assert.ok(progress, 'updateProgress должен существовать');
    // Ветка totalSeconds === 0 раньше не снимала ни классы, ни инлайновый цвет.
    assert.match(progress[0], /this\.progressRing\.style\.strokeDashoffset = this\.circumference;[\s\S]*?this\.timeDisplay\.classList\.remove\('warning', 'danger', 'overtime'\)/);
});

// ---------------------------------------------------------------------------
// Единый статус
// ---------------------------------------------------------------------------

test('все три окна берут приоритеты статуса из общего модуля', () => {
    // Раньше условие было скопировано трижды и копии разошлись: виджет красил
    // перерасход зелёным классом running, полноэкранный проверял finished первым.
    for (const [name, src] of [['control', controlHtml], ['widget', widgetHtml], ['display', displayScript]]) {
        assert.match(
            src,
            /RendererShared\.timerLifecycleStatus\(/,
            `${name} должен использовать общий timerLifecycleStatus()`
        );
    }
    // Панель управления обязана подключать модуль, иначе вызов упадёт.
    assert.match(controlHtml, /<script src="renderer-shared\.js"><\/script>/);
});

test('виджет читает finished из состояния таймера', () => {
    assert.match(widgetHtml, /this\.finished = !!state\.finished/);
});

test('у виджета есть собственный красный класс перерасхода', () => {
    // Перерасход переиспользовал .running и красился в ЗЕЛЁНЫЙ при красных цифрах.
    assert.match(widgetHtml, /\.status-badge\.overtime\s*\{/);
    assert.doesNotMatch(widgetHtml, /textContent = 'Перерасход';\s*\n\s*this\.statusBadge\.classList\.add\('running'\)/);
});

test('скриншот-прогон проверяет выход из перерасхода и все 4 стиля', () => {
    const runner = read('scripts/screenshot-runner.js');
    // Состояние recovered обязано идти СРАЗУ после overtime — иначе оно не ловит
    // залипшие инлайновые цвета.
    assert.match(runner, /name: 'overtime'[\s\S]{0,600}?name: 'recovered'/);
    assert.match(runner, /const STYLES = \['circle', 'digital', 'flip', 'analog'\]/);
});

// ---------------------------------------------------------------------------
// Второй проход аудита: расхождения «UI показывает не то, что в состоянии»
// ---------------------------------------------------------------------------

test('ноль на таймере попадает в красную полосу, а не в жёлтую', () => {
    // Условие danger было записано как `percentLeft <= 10 && percentLeft > 0`,
    // поэтому ровно на 00:00 процент 0 проваливался в warning: цифры желтели,
    // хотя рядом горел красный статус «Завершено».
    for (const src of [controlHtml, widgetHtml, displayScript]) {
        assert.doesNotMatch(src, /percentLeft <= \w+ && percentLeft > 0/);
        assert.doesNotMatch(src, /percentLeft <= 10 && percentLeft > 0/);
    }
    assert.match(read('renderer-shared.js'), /Ноль ВХОДИТ в danger/);
});

test('цветовая полоса считается в одном месте для всех окон', () => {
    for (const [name, src] of [['control', controlHtml], ['widget', widgetHtml], ['display', displayScript]]) {
        assert.match(src, /timerColorBand\(/, `${name} должен использовать общий timerColorBand()`);
    }
    // Пороги больше не захардкожены по окнам.
    for (const src of [controlHtml, widgetHtml, displayScript]) {
        assert.doesNotMatch(src, /percentLeft <= 25/);
    }
});

test('плашка статуса дисплея не красится двумя конкурирующими системами классов', () => {
    // .is-success / .is-attention объявлены в CSS ниже семантических классов и
    // выигрывали каскад: «ВРЕМЯ ВЫШЛО!» становилось зелёным поверх красной .finished.
    assert.doesNotMatch(read('display.html'), /\.status-pill\.is-success\s*\{/);
    assert.doesNotMatch(read('display.html'), /\.status-pill\.is-attention\s*\{/);
    assert.doesNotMatch(displayScript, /tone: 'is-success'/);
    assert.doesNotMatch(displayScript, /tone: 'is-attention'/);
});

test('подсветка быстрого выбора выводится из состояния, а не из клика', () => {
    // Класс active вешался в обработчике клика и не снимался ничем — после
    // ручного ввода, кнопок ± или горячих клавиш подсвечена была не та кнопка.
    assert.match(controlHtml, /syncPresetHighlight\(\)\s*\{/);
    assert.match(controlHtml, /this\.syncPresetHighlight\(\)/);
    assert.match(controlHtml, /this\.presetSeconds = Number\(state\.presetSeconds\) \|\| 0/);

    const presetHandler = controlHtml.match(
        /document\.querySelectorAll\('\.quick-preset'\)\.forEach\(btn => \{\s*\n\s*btn\.addEventListener\('click'[\s\S]*?\n {16}\}\);/
    );
    assert.ok(presetHandler, 'обработчик клика по пресету должен существовать');
    assert.doesNotMatch(presetHandler[0], /classList\.add\('active'\)/);
});

// ---------------------------------------------------------------------------
// Единая палитра статусов на все три окна.
// Раньше три состояния из четырёх выглядели в разных окнах по-разному:
// пауза жёлтая/розовая/розовая, завершено красное/жёлтое/красное,
// перерасход красный/красный/оранжевый.
// ---------------------------------------------------------------------------

test('пауза во всех окнах оранжевая', () => {
    assert.match(controlHtml, /\.status-dot\.paused \{[^}]*background: var\(--tw-orange\)/s);
    assert.match(widgetHtml, /\.status-badge\.paused \{[^}]*color: var\(--tw-orange\)/s);
    assert.match(read('display.html'), /\.status-pill\.paused \{[^}]*color: var\(--tw-orange\)/s);
});

test('завершено во всех окнах красное и БЕЗ пульсации', () => {
    const controlFinished = controlHtml.match(/\.status-dot\.finished \{[^}]*\}/s)[0];
    assert.match(controlFinished, /background: var\(--tw-red\)/);
    assert.doesNotMatch(controlFinished, /animation:/);

    const widgetFinished = widgetHtml.match(/\.status-badge\.finished \{[^}]*\}/s)[0];
    assert.match(widgetFinished, /color: var\(--tw-red\)/);
    assert.doesNotMatch(widgetFinished, /animation:/);

    const displayFinished = read('display.html').match(/\.status-pill\.finished \{[^}]*\}/s)[0];
    assert.match(displayFinished, /color: var\(--tw-red\)/);
    assert.doesNotMatch(displayFinished, /animation:/);
});

test('перерасход во всех окнах красный и С пульсацией', () => {
    const controlOvertime = controlHtml.match(/\.status-dot\.overtime \{[^}]*\}/s)[0];
    assert.match(controlOvertime, /background: var\(--tw-red\)/);
    assert.match(controlOvertime, /animation: pulse-dot/);

    const widgetOvertime = widgetHtml.match(/\.status-badge\.overtime \{[^}]*\}/s)[0];
    assert.match(widgetOvertime, /color: var\(--tw-red\)/);
    assert.match(widgetOvertime, /animation: badge-pulse/);

    const displayOvertime = read('display.html').match(/\.status-pill\.overtime \{[^}]*\}/s)[0];
    assert.match(displayOvertime, /color: var\(--tw-red\)/);
    assert.match(displayOvertime, /animation: overtime-pulse/);
});

test('розовый из палитры статусов убран во всех окнах', () => {
    // --tw-pink не входит в задекларированную палитру приложения (blue/green/red/orange).
    for (const src of [controlHtml, widgetHtml, read('display.html')]) {
        assert.doesNotMatch(src, /\.status-(dot|badge|pill)\.\w+ \{[^}]*--tw-pink/s);
    }
});

// ---------------------------------------------------------------------------
// Обратный канал масштаба: окно → панель управления.
// Раньше поток был односторонним, и Ctrl+колесо на окне оставляло ползунок
// в панели на старом значении — два источника правды расходились.
// ---------------------------------------------------------------------------

test('канал report-scale объявлен в обоих вайтлистах', () => {
    const validator = read('channel-validator.js');
    const preload = read('preload.js');
    for (const src of [validator, preload]) {
        assert.match(src, /'report-scale'/);
        assert.match(src, /'scale-report'/);
    }
});

test('главный процесс валидирует источник и шлёт отчёт ТОЛЬКО в панель', () => {
    assert.match(mainSource, /SCALE_REPORT_SOURCES = new Set\(\['widget', 'clock', 'display', 'display-blocks'\]\)/);
    const handler = mainSource.match(/ipcMain\.on\('report-scale',[\s\S]*?\n\}\);/);
    assert.ok(handler, 'обработчик report-scale должен существовать');
    assert.match(handler[0], /if \(!SCALE_REPORT_SOURCES\.has\(source\)\) \{ return; \}/);
    assert.match(handler[0], /Number\.isFinite\(scalePct\)/);
    // Широковещание вернуло бы значение отправителю и могло закольцеваться.
    assert.match(handler[0], /safelySendToWindow\(controlWindow, 'scale-report'/);
    assert.doesNotMatch(handler[0], /broadcast/);
});

test('все три окна сообщают о своём масштабе', () => {
    assert.match(widgetHtml, /'report-scale', \{ source: 'widget'/);
    assert.match(clockHtml, /'report-scale', \{ source: 'clock'/);
    assert.match(displayScript, /'report-scale', \{ source: 'display'/);
    assert.match(displayScript, /'report-scale', \{ source: 'display-blocks'/);
});

test('панель подтягивает ползунок и не отвечает обратно (нет петли)', () => {
    const handler = controlHtml.match(/this\._onScaleReport = \(event, data\) => \{[\s\S]*?\n {16}\};/);
    assert.ok(handler, 'обработчик scale-report должен существовать');
    // Присваивание .value не порождает 'input', поэтому обратной отправки быть не должно.
    assert.doesNotMatch(handler[0], /ipcRenderer\.send/);
    assert.match(handler[0], /slider\.value = clamped/);
    assert.match(handler[0], /this\.saveExtSettings\(\)/);
    // И слушатель обязан сниматься при закрытии окна.
    assert.match(controlHtml, /removeListener\('scale-report', this\._onScaleReport\)/);
});

// ---------------------------------------------------------------------------
// Виджет часов
// ---------------------------------------------------------------------------

test('смена стиля часов не затирает настройки пользователя', () => {
    // Регрессия: setClockStyle() принудительно ставил showSeconds = true и
    // format24h = true для digital/flip, а затем вызывал saveSettings() —
    // выбор пользователя молча подменялся и СОХРАНЯЛСЯ, при этом чекбоксы в
    // панели управления продолжали показывать старое значение.
    const setStyle = clockHtml.match(/setClockStyle\(style\)\s*\{[\s\S]*?\n {12}\}/);
    assert.ok(setStyle, 'setClockStyle должен существовать');
    // Требуем именно форму ОПЕРАТОРА (отступ в начале строки + точка с запятой),
    // иначе регулярка ловит поясняющий комментарий, где эти строки процитированы.
    assert.doesNotMatch(setStyle[0], /^\s+this\.showSeconds = true;/m);
    assert.doesNotMatch(setStyle[0], /^\s+this\.format24h = true;/m);
});

test('ограничение 24ч для flip — решение отрисовки, а не мутация настройки', () => {
    // У расщеплённых карточек нет ячейки AM/PM, поэтому flip всегда 24-часовой,
    // но сохранённый формат пользователя при этом не портится.
    assert.match(clockHtml, /_uses24h\(\)\s*\{\s*\n\s*return this\.clockStyle === 'flip' \? true : this\.format24h;/);
    assert.match(clockHtml, /if \(!this\._uses24h\(\)\)/);
});

test('оба писателя clockWidgetSettings сливают, а не перезаписывают', () => {
    // Ключ пишут панель управления (showTicks и др.) и сам виджет часов
    // (opacity, clockStyle). Прямая перезапись стирала чужие поля.
    for (const [name, src] of [['control', controlHtml], ['clock', clockHtml]]) {
        const write = src.match(/localStorage\.setItem\('clockWidgetSettings'[^\n]*/);
        assert.ok(write, `${name} должен писать clockWidgetSettings`);
        assert.match(write[0], /\.\.\./, `${name} обязан сливать предыдущее значение`);
    }
});
