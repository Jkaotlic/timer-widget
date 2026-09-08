'use strict';

/**
 * Проводка режимов героя в окне дисплея.
 *
 * Логика этих строк живёт внутри класса `DisplayTimer` и в Node не
 * импортируется, поэтому здесь проверяется ИСХОДНИК. Утверждается и
 * присутствие правильного, и отсутствие старого — иначе регрессия проедет
 * молча.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { codeOnly, balancedBlockAt, maskNonCode, afterBalanced } = require('./helpers/source-scan');

const SRC = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'display-script.js'), 'utf8'));

/**
 * Тело МЕТОДА класса по имени.
 *
 * Общий `functionBody()` из хелпера ищет `function имя(` и методов класса не
 * находит — поэтому здесь свой поиск заголовка. Но считать скобки своей рукой
 * нельзя: это ровно тот кусок, у которого в проекте ОДНА реализация
 * (`balancedBlockAt`), и вторая разошлась бы с ней на первой же строке со
 * скобкой внутри строкового литерала.
 */
function methodBody(src, name) {
    const start = src.indexOf(`\n    ${name}(`);
    assert.notEqual(start, -1, `метода ${name} в display-script.js нет`);
    return balancedBlockAt(src, start, `метод ${name}`);
}

/**
 * АРГУМЕНТЫ каждого вызова `имя(` по всему файлу — а не тело функции.
 *
 * Раунд 1 показал, зачем это отдельная проверка: `_colorBand()` сама честно
 * считала от `_heroTotal()` (тело — правильное), а звали её с сырым
 * `Math.floor(this.remainingSeconds)` тремя строками выше в ДРУГОМ методе.
 * Тело функции ловит один класс регрессии, точки вызова — другой; нужны оба.
 *
 * Круглые скобки балансируются не вручную: `afterBalanced` — тот же приём на
 * `(`/`)`, что `balancedBlockAt` уже применяет к `{`/`}`, и он один на
 * проект. Вторая ручная балансировка здесь разошлась бы с ним на первом же
 * вызове с вложенными скобками (что и произошло бы на `this._colorBand(this._heroSeconds())`).
 *
 * @param {string} src
 * @param {string} calleeParen — например `'_colorBand('`, СО скобкой
 * @returns {string[]} срез `имя(...)` целиком на каждое вхождение
 */
function callArgSites(src, calleeParen) {
    const mask = maskNonCode(src);
    const sites = [];
    let from = 0;
    for (;;) {
        const openIdx = mask.indexOf(calleeParen, from);
        if (openIdx === -1) { return sites; }
        const parenAt = openIdx + calleeParen.length - 1;
        const closeAt = afterBalanced(mask, parenAt, '(', ')', calleeParen);
        sites.push(src.slice(openIdx, closeAt));
        from = closeAt;
    }
}

test('герой берётся из _heroSeconds(), а не напрямую из remainingSeconds', () => {
    const body = methodBody(SRC, 'updateDisplay');
    assert.ok(body.includes('this._heroSeconds()'),
        'updateDisplay() не спрашивает _heroSeconds()');
    assert.ok(!/const secs = Math\.floor\(this\.remainingSeconds\)/.test(body),
        'в updateDisplay() осталось прямое чтение remainingSeconds — это второй источник героя');
});

test('зонд проверяет себя: подделанный исходник ловится', () => {
    // Тест на ОТСУТСТВИЕ обязан доказать, что его регулярка вообще работает:
    // иначе зелёный значит и «чисто», и «искали не то».
    const fake = '\n    updateDisplay() {\n        const secs = Math.floor(this.remainingSeconds);\n    }';
    assert.ok(/const secs = Math\.floor\(this\.remainingSeconds\)/.test(fake),
        'регулярка не ловит даже заведомо плохой исходник');
});

test('полоса срочности считается от геройского тотала', () => {
    const body = methodBody(SRC, '_colorBand');
    assert.ok(body.includes('this._heroTotal()'), '_colorBand() считает от тотала таймера');
    assert.ok(!body.includes('this.totalSeconds'), 'в _colorBand() остался тотал таймера');
});

test('в не-таймерных режимах тикают системные часы, а не IPC', () => {
    const body = methodBody(SRC, 'startCurrentTimeClock');
    assert.ok(body.includes('this.updateDisplay()'),
        'тик системных часов не перерисовывает героя — режимы «часы» и «до…» замрут');
});

test('деньги 47-го этажа продолжают читать СЫРОЙ остаток таймера', () => {
    // Подмени их на геройское число — и в режиме «до конца» перелимит доклада
    // начнёт считаться от расписания мероприятия.
    assert.ok(/liveOverrun\(this\.remainingSeconds/.test(SRC),
        'деньги перешли на геройское число — счёт перелимита сломан');
});

test('внешние ворота updateProgress() читают геройский тотал, а не сырой', () => {
    // Тело метода уже честно считает calculateProgressValue()/_colorBand() от
    // _heroTotal(), но внешние ворота гасили кольцо и полосу целиком, когда
    // this.totalSeconds === 0 — а в режиме «до конца» тотал есть (длина
    // мероприятия) даже без пресета у таймера доклада.
    const body = methodBody(SRC, 'updateProgress');
    assert.ok(body.includes('this._heroTotal() > 0'),
        'updateProgress() не спрашивает _heroTotal() воротами — тот же класс дефекта, что и в точках вызова _colorBand()/flipCells()');
    assert.ok(!/if \(this\.totalSeconds > 0\)/.test(body),
        'в updateProgress() остались сырые ворота this.totalSeconds > 0');
});

test('зонд updateProgress проверяет себя: подделанный исходник ловится', () => {
    const fakeSrc = '\nclass X {\n    updateProgress() {\n'
        + '        if (this.totalSeconds > 0) {\n        }\n    }\n}\n';
    const body = methodBody(fakeSrc, 'updateProgress');
    assert.ok(/if \(this\.totalSeconds > 0\)/.test(body),
        'methodBody не ловит даже заведомо плохой исходник');
});

// --- Раунд 1 фикса Task 5: гейт на _heroTotal() открыл ветку else в режимах
// current/to-start (heroTotal() там всегда 0 — hero-modes.js), а она снимала
// классы только с progressRing/timeDisplay. Полоса .display-progress-fill и
// классы overtime/warning/danger на <body> общие для ВСЕХ пяти стилей
// (display.css:1754-1770), и без явной очистки застревали: оператор
// переключает heroMode посреди перерасхода доклада — красная полоса на 90%
// и body.danger остаются на экране всю смену режима.

test('ветка else в updateProgress() стирает след таймера доклада, а не молчит', () => {
    const body = methodBody(SRC, 'updateProgress');
    const elseAt = body.indexOf('} else {');
    assert.notEqual(elseAt, -1, 'у updateProgress() нет ветки else — тест ищет не то');
    const elseBody = body.slice(elseAt);

    assert.ok(elseBody.includes("document.body.classList.remove('overtime', 'warning', 'danger')"),
        'ветка else не снимает overtime/warning/danger с <body> — полоса и подсветка застревают при переключении режима');
    assert.ok(elseBody.includes("this.displayProgressFill.style.width = '0%'"),
        'ветка else не сбрасывает ширину .display-progress-fill — полоса застревает с прошлым процентом');
});

test('зонд ветки else проверяет себя: подделанный исходник без очистки ловится', () => {
    // Тот же дефект, что был до фикса: ветка else снимает классы только с
    // progressRing/timeDisplay, про <body> и .display-progress-fill молчит.
    const fakeSrc = '\nclass X {\n    updateProgress() {\n'
        + '        if (this._heroTotal() > 0) {\n'
        + '            this.displayProgressFill.style.width = ratio + \'%\';\n'
        + '            document.body.classList.toggle(\'danger\', band === \'danger\');\n'
        + '        } else {\n'
        + '            this.progressRing.classList.remove(\'warning\', \'danger\', \'overtime\');\n'
        + '            this.timeDisplay.classList.remove(\'warning\', \'danger\', \'overtime\');\n'
        + '        }\n'
        + '    }\n}\n';
    const body = methodBody(fakeSrc, 'updateProgress');
    const elseAt = body.indexOf('} else {');
    assert.notEqual(elseAt, -1, 'зонд сломан: в заведомо плохом исходнике нет ветки else');
    const elseBody = body.slice(elseAt);
    assert.ok(!elseBody.includes("document.body.classList.remove('overtime', 'warning', 'danger')"),
        'зонд не ловит заведомо плохой исходник — регулярка на <body> не работает');
    assert.ok(!elseBody.includes("this.displayProgressFill.style.width = '0%'"),
        'зонд не ловит заведомо плохой исходник — регулярка на .display-progress-fill не работает');
});

// --- Раунд 1 code review: три точки ВЫЗОВА читали сырые поля таймера мимо
// _heroSeconds()/_heroTotal(), хотя тела вызываемых функций были правильными.
// Тесты выше проверяли ТЕЛО (_colorBand, updateDisplay) — этого недостаточно:
// звонящий может передать что угодно. Ниже — проверка точек ВЫЗОВА.

test('_colorBand() никогда не зовётся с сырым остатком таймера', () => {
    const sites = callArgSites(SRC, '_colorBand(');
    // Живых вызовов несколько (digitsTime-полоса, аналог, круг) плюс само
    // объявление метода — точное число не фиксируем, но пустой список значит
    // «искали не то».
    assert.ok(sites.length > 0, 'вызовов _colorBand( в файле не нашлось — тест ищет не то');
    for (const site of sites) {
        assert.ok(!site.includes('this.remainingSeconds'),
            `_colorBand() позвана с сырым this.remainingSeconds: ${site}`);
    }
});

test('зонд _colorBand проверяет себя: подделанный ВЫЗОВ ловится', () => {
    // Раунд 1: именно этот случай — тело функции чистое, а звонящий передал
    // сырое поле. Проверяем через ТУ ЖЕ функцию извлечения аргументов, а не
    // отдельной регуляркой — иначе самопроверка ничего не доказывает про
    // реальный тест выше.
    const fake = 'x = this._colorBand(Math.floor(this.remainingSeconds));';
    const sites = callArgSites(fake, '_colorBand(');
    assert.equal(sites.length, 1, 'callArgSites не нашла заведомо плохой вызов');
    assert.ok(sites[0].includes('this.remainingSeconds'),
        'callArgSites не видит this.remainingSeconds внутри заведомо плохого вызова');
});

test('flipCells() никогда не зовётся с сырым тоталом доклада', () => {
    const sites = callArgSites(SRC, 'flipCells(');
    assert.ok(sites.length > 0, 'вызовов flipCells( в файле не нашлось — тест ищет не то');
    for (const site of sites) {
        assert.ok(!site.includes('this.totalSeconds'),
            `flipCells() позвана с сырым this.totalSeconds: ${site}`);
    }
});

test('зонд flipCells проверяет себя: подделанный вызов ловится', () => {
    const fake = 'cells = window.RendererShared.flipCells(secs, this.totalSeconds);';
    const sites = callArgSites(fake, 'flipCells(');
    assert.equal(sites.length, 1, 'callArgSites не нашла заведомо плохой вызов');
    assert.ok(sites[0].includes('this.totalSeconds'),
        'callArgSites не видит this.totalSeconds внутри заведомо плохого вызова');
});

test('проба «Цифр» меряется от геройского числа, а не от сырого остатка', () => {
    const body = methodBody(SRC, 'updateDigitsScale');
    assert.ok(body.includes('this._heroSeconds()'),
        'updateDigitsScale() не спрашивает _heroSeconds() для hasHours');
    assert.ok(!body.includes('this.remainingSeconds'),
        'в updateDigitsScale() осталось прямое чтение remainingSeconds — проба посчитана для другого числа');
});

test('зонд updateDigitsScale проверяет себя: подделанный исходник ловится', () => {
    const fakeSrc = '\nclass X {\n    updateDigitsScale() {\n'
        + '        const hasHours = Math.abs(Math.floor(this.remainingSeconds)) >= 3600;\n    }\n}\n';
    const body = methodBody(fakeSrc, 'updateDigitsScale');
    assert.ok(body.includes('this.remainingSeconds'),
        'methodBody не ловит даже заведомо плохой исходник');
});

test('подпись героя имеет ОДНОГО владельца, выбираемого режимом', () => {
    const chip = methodBody(SRC, 'updateChipState');
    // В не-таймерных режимах отчёт о состоянии подпись не трогает ВОВСЕ —
    // ранним выходом, а не перезаписью после. Перезапись означала бы двух
    // владельцев, дерущихся за один узел на каждом тике.
    assert.ok(/this\.heroMode !== window\.HeroModes\.DEFAULT_MODE/.test(chip),
        'updateChipState() пишет подпись во всех режимах — это второй владелец');

    const label = methodBody(SRC, 'updateHeroLabel');
    assert.ok(label.includes('window.HeroModes.heroCaption'),
        'updateHeroLabel() не спрашивает реестр, значит завёл свою копию слова');
});

test('вспышка завершения не запускается вне режима таймера', () => {
    assert.ok(/heroMode === window\.HeroModes\.DEFAULT_MODE[\s\S]{0,200}triggerFinishEffect/.test(SRC),
        'вспышка «время вышло» бьёт по экрану, где крупно показано другое');
});

test('плашка состояния гасится классом режима, а не инлайном', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'display.css'), 'utf8');
    for (const mode of ['current', 'to-start', 'to-end']) {
        assert.ok(new RegExp(`body\\.hero-mode-${mode}\\s+#statusPill`).test(css),
            `в display.css нет правила, гасящего плашку в режиме ${mode}`);
    }
    // Отрицательного селектора быть не должно: до первой посылки настроек на
    // <body> нет ни одного класса режима, и он погасил бы плашку в режиме
    // таймера на чистом профиле.
    assert.ok(!/body:not\(\.hero-mode-timer\)/.test(css),
        'плашка гасится отрицательным селектором — на чистом профиле она пропадёт и в режиме таймера');
    assert.ok(SRC.includes("'hero-mode-' + this.heroMode"),
        'класс режима не ставится на body');
});
