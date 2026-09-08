'use strict';

/**
 * Проводка режимов героя в окне дисплея и в панели.
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
const HeroModes = require('../hero-modes.js');
const { PanelResetMixin } = require('../panel-reset.js');

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

// --- Финальное ревью ветки: `this.formatTime` в DisplayTimer — это
// TimeUtils.formatTimeShort, короткий форматтер ДЛИТЕЛЬНОСТИ. В режиме часов он
// в 00:30:15 выбрасывает нулевую группу часов и печатает залу «30:15», а в
// 09:05:07 теряет ведущий ноль. Ветка писалась в 15:xx, когда оба форматтера
// на показаниях часов совпадают, — дефекта не увидели ни шесть пофазовых
// ревью, ни e2e.

test('форматтер выбирается ПО РЕЖИМУ, и выбор этот ровно один', () => {
    const body = methodBody(SRC, 'formatTime');
    assert.ok(body.includes('window.HeroModes.isClockMode(this.heroMode)'),
        'formatTime() не спрашивает реестр, часы это или длительность');
    assert.ok(body.includes('window.TimeUtils.formatTime('),
        'часам не достаётся полный ЧЧ:ММ:СС — в 00:30:15 зал прочитает «30:15» как получасовой отсчёт');
    assert.ok(body.includes('window.TimeUtils.formatTimeShort('),
        'длительность перестала печататься коротким форматтером');

    // Второго решения о написании в файле быть не должно: короткий форматтер
    // зовётся ровно из одного места — из самого formatTime().
    const shortSites = callArgSites(SRC, 'formatTimeShort(');
    assert.equal(shortSites.length, 1,
        `formatTimeShort( зовётся ${shortSites.length} раз — вне formatTime() это второй владелец написания`);
    assert.ok(body.includes(shortSites[0]),
        'единственный вызов formatTimeShort( стоит НЕ в formatTime() — выбор написания уехал в другое место');
});

test('зонд форматтера проверяет себя: старая безусловная версия ловится', () => {
    const fakeSrc = '\nclass X {\n    formatTime(seconds) {\n'
        + '        return window.TimeUtils.formatTimeShort(seconds);\n'
        + '    }\n}\n';
    const body = methodBody(fakeSrc, 'formatTime');
    assert.ok(!body.includes('window.HeroModes.isClockMode(this.heroMode)'),
        'зонд не ловит заведомо плохой исходник — проверка на выбор по режиму не работает');
    assert.ok(!body.includes('window.TimeUtils.formatTime('),
        'зонд сломан: в заведомо плохом исходнике «найден» полный форматтер');
});

test('флип в режиме часов показывает ШЕСТЬ створок, а не четыре', () => {
    // flipCells() решает про часы правилом длительности: `hours > 0 ||
    // total >= 3600`. У показаний часов тотала нет вовсе (heroTotal → 0), и в
    // 00:30:15 флип показал бы «30:15» четырьмя карточками — тот же дефект,
    // что короткий форматтер, только выраженный числом створок.
    const body = methodBody(SRC, 'updateFlipDisplay');
    assert.ok(/isClockMode\(this\.heroMode\)[\s\S]{0,120}cells\.hasHours = true/.test(body),
        'updateFlipDisplay() не заставляет часы показывать группу часов');
});

test('проба «Цифр» знает про часы: группа часов у них есть ВСЕГДА', () => {
    // Иначе проба резервирует место под «88:88», а печатается «00:30:15» —
    // цифры вылезают за рамку ровно в тот час, когда никто не смотрит.
    const body = methodBody(SRC, '_heroHasHours');
    assert.ok(body.includes('window.HeroModes.isClockMode(this.heroMode)'),
        '_heroHasHours() не спрашивает реестр — у часов формат считается по правилу длительности');
    assert.ok(body.includes('Math.abs(secs) >= 3600'),
        '_heroHasHours() потерял правило для длительности');

    for (const method of ['updateDigitsScale', 'updateDigitsDisplay']) {
        assert.ok(methodBody(SRC, method).includes('this._heroHasHours('),
            `${method}() считает hasHours своей копией правила`);
    }
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

// --- Раунд 1 фикса Task 5 + финальное ревью ветки: ворота на `_heroTotal()`
// открыли ветку else в режимах current/to-start (heroTotal() там всегда 0 —
// hero-modes.js). Дважды выяснилось, что под воротами стояло лишнее:
//   • ветка else не сбрасывала общую полосу .display-progress-fill — красные
//     90 % оставались на весь перерыв;
//   • классы полосы срочности ставились ТОЛЬКО внутри ворот, из-за чего
//     круглый стиль (он же стиль по умолчанию) единственный не краснел на
//     отрицательном герое при тотале 0 — а это режим «до начала» после
//     прошедшей отметки, то есть каждый рабочий день мероприятия.

/**
 * Метод `updateProgress()`, разрезанный воротами `_heroTotal() > 0`: что стоит
 * ПОД воротами (обе ветки) и что снаружи них.
 *
 * Скобки балансируются общим `balancedBlockAt`, а не считаются рукой: своя
 * вторая балансировка разошлась бы с ней на первой же строке со скобкой в
 * литерале.
 */
function splitByTotalGate(body) {
    const gateAt = body.indexOf('if (this._heroTotal() > 0)');
    assert.notEqual(gateAt, -1,
        'в updateProgress() нет ворот на геройском тотале — тест ищет не то');

    const ifPart = balancedBlockAt(body, gateAt, 'ворота _heroTotal()');
    const afterIf = gateAt + ifPart.length;
    const elseMatch = /^\s*else\s*\{/.exec(body.slice(afterIf));
    if (!elseMatch) {
        return { gated: ifPart, outside: body.slice(0, gateAt) + body.slice(afterIf) };
    }
    const elseStart = afterIf + elseMatch.index;
    const elsePart = balancedBlockAt(body, elseStart, 'ветка else ворот');
    return {
        gated: ifPart + elsePart,
        outside: body.slice(0, gateAt) + body.slice(elseStart + elsePart.length)
    };
}

/**
 * Претензии к раскладу `updateProgress()` — списком, а не серией assert'ов:
 * ровно тот же список прогоняется по ЗАВЕДОМО ПЛОХОМУ исходнику в зонде ниже,
 * и пустой список там означал бы, что проверка не работает вовсе.
 */
function progressGateProblems(body) {
    const { gated, outside } = splitByTotalGate(body);
    const problems = [];

    if (!outside.includes('const band = this._colorBand(')) {
        problems.push('полоса срочности считается ПОД воротами на тотале');
    }
    for (const cls of ['overtime', 'warning', 'danger']) {
        if (!outside.includes(`document.body.classList.toggle('${cls}', band === '${cls}')`)) {
            problems.push(`класс ${cls} на <body> ставится не общим toggle() вне ворот`);
        }
    }
    if (!outside.includes("this.timeDisplay.classList.add('danger', 'overtime')")) {
        problems.push('красный на самом герое (timeDisplay) ставится только под воротами');
    }
    if (/classList\.(add|toggle)\('(warning|danger|overtime)'/.test(gated)) {
        problems.push('под воротами остался второй владелец классов полосы');
    }
    return problems;
}

test('полоса срочности красится ВНЕ ворот на геройском тотале', () => {
    // timerColorBand() отдаёт overtime при secs < 0 ДО обращения к тоталу
    // (renderer-shared.js), поэтому цифры, флип и аналог краснеют и при тотале
    // 0. Круг обязан краснеть там же — иначе одно состояние в одном режиме
    // даёт два ответа в зависимости от выбранного стиля.
    const problems = progressGateProblems(methodBody(SRC, 'updateProgress'));
    assert.deepEqual(problems, [], problems.join('; '));
});

test('зонд полосы проверяет себя: раскраска, запертая под воротами, ловится', () => {
    // Ровно тот дефект, что был до финального ревью: band и все классы стоят
    // ВНУТРИ if (this._heroTotal() > 0), а ветка else их только снимает.
    const fakeSrc = '\nclass X {\n    updateProgress() {\n'
        + '        if (this._heroTotal() > 0) {\n'
        + '            const band = this._colorBand(this._heroSeconds());\n'
        + "            document.body.classList.toggle('overtime', band === 'overtime');\n"
        + "            document.body.classList.toggle('warning', band === 'warning');\n"
        + "            document.body.classList.toggle('danger', band === 'danger');\n"
        + "            this.timeDisplay.classList.add('danger', 'overtime');\n"
        + '        } else {\n'
        + "            this.timeDisplay.classList.remove('warning', 'danger', 'overtime');\n"
        + '        }\n'
        + '    }\n}\n';
    const problems = progressGateProblems(methodBody(fakeSrc, 'updateProgress'));
    assert.ok(problems.length > 0, 'зонд не ловит заведомо плохой расклад ворот');
});

test('ветка else в updateProgress() стирает след таймера доклада, а не молчит', () => {
    // Полоса .display-progress-fill ОБЩАЯ для всех пяти стилей
    // (display.css:1754-1770). Классы полосы здесь не проверяются намеренно:
    // ими владеет общий блок вне ворот (тест выше), и требовать их снятия ещё
    // и тут значило бы требовать второго владельца.
    const { gated } = splitByTotalGate(methodBody(SRC, 'updateProgress'));
    const elseAt = gated.indexOf('} else {');
    assert.notEqual(elseAt, -1, 'у updateProgress() нет ветки else — тест ищет не то');
    const elseBody = gated.slice(elseAt);

    assert.ok(elseBody.includes("this.displayProgressFill.style.width = '0%'"),
        'ветка else не сбрасывает ширину .display-progress-fill — полоса застревает с прошлым процентом');
    assert.ok(elseBody.includes('this.progressRing.style.strokeDashoffset = this.circumference'),
        'ветка else не разряжает кольцо — оно застревает с прошлым процентом');
});

test('зонд ветки else проверяет себя: подделанный исходник без очистки ловится', () => {
    const fakeSrc = '\nclass X {\n    updateProgress() {\n'
        + '        if (this._heroTotal() > 0) {\n'
        + '            this.displayProgressFill.style.width = ratio + \'%\';\n'
        + '        } else {\n'
        + "            this.progressRing.classList.remove('warning', 'danger', 'overtime');\n"
        + '        }\n'
        + '    }\n}\n';
    const { gated } = splitByTotalGate(methodBody(fakeSrc, 'updateProgress'));
    const elseAt = gated.indexOf('} else {');
    assert.notEqual(elseAt, -1, 'зонд сломан: в заведомо плохом исходнике нет ветки else');
    const elseBody = gated.slice(elseAt);
    assert.ok(!elseBody.includes("this.displayProgressFill.style.width = '0%'"),
        'зонд не ловит заведомо плохой исходник — регулярка на .display-progress-fill не работает');
    assert.ok(!elseBody.includes('this.progressRing.style.strokeDashoffset = this.circumference'),
        'зонд не ловит заведомо плохой исходник — регулярка на кольце не работает');
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
    // Проверяется ГАРД, а не близость двух строк друг к другу. Прежняя версия
    // искала `heroMode === DEFAULT_MODE` и `triggerFinishEffect` в пределах 200
    // знаков ПО ВСЕМУ файлу: безобидная перестановка строк её роняла, а второй
    // вызов вспышки где-нибудь ниже по файлу проезжал мимо неё незамеченным.
    const body = methodBody(SRC, 'updateDisplay');
    const guardAt = body.indexOf('if (this.heroMode === window.HeroModes.DEFAULT_MODE)');
    assert.notEqual(guardAt, -1,
        'в updateDisplay() нет гарда по режиму вокруг вспышки — она бьёт по экрану, где крупно показано другое');
    const guarded = balancedBlockAt(body, guardAt, 'гард режима вокруг вспышки');
    assert.ok(guarded.includes('this.triggerFinishEffect()'),
        'вспышка вызывается не из-под гарда по режиму');

    // Ровно два вхождения на весь файл: объявление метода и ЭТОТ вызов. Третье
    // означает второй вызов где-то ещё — гард выше про него ничего не знает.
    const sites = callArgSites(SRC, 'triggerFinishEffect(');
    assert.equal(sites.length, 2,
        `triggerFinishEffect( встречается ${sites.length} раз вместо двух (объявление + один вызов из-под гарда)`);
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
    // Тест на ОТСУТСТВИЕ обязан проверить СВОЙ ЗОНД: без этого зелёный значит и
    // «отрицательного селектора нет», и «регулярка не ищет ничего».
    const NEGATIVE = /body:not\(\.hero-mode-timer\)/;
    assert.ok(NEGATIVE.test('body:not(.hero-mode-timer) #statusPill { display: none; }'),
        'зонд сломан: регулярка не ловит даже заведомо отрицательный селектор');
    assert.ok(!NEGATIVE.test(css),
        'плашка гасится отрицательным селектором — на чистом профиле она пропадёт и в режиме таймера');
    assert.ok(SRC.includes("'hero-mode-' + this.heroMode"),
        'класс режима не ставится на body');
});

test('«До завершения» гасится в режиме «до конца» — тем же положительным селектором', () => {
    // Плашка и герой в этом режиме — ОДНА величина, и на опоздавшем
    // мероприятии они расходятся: герой «−05:00», плашка «00:00:00» (её кламп
    // в ноль намеренный и верен для неё самой). Убирается вторая надпись, а не
    // кламп.
    const css = fs.readFileSync(path.join(__dirname, '..', 'display.css'), 'utf8');
    assert.ok(/body\.hero-mode-to-end\s+#timeLeftBlock/.test(css),
        'в display.css нет правила, гасящего «До завершения» в режиме «до конца»');

    // Гасится только в ЭТОМ режиме: в «текущем времени» и «до начала» плашка
    // говорит про другую величину, чем герой, и остаётся полезной.
    for (const mode of ['current', 'to-start']) {
        assert.ok(!new RegExp(`body\\.hero-mode-${mode}\\s+#timeLeftBlock`).test(css),
            `«До завершения» гасится и в режиме ${mode} — там она не дублирует героя`);
    }

    // Кламп плашки остаётся на месте: чинилось дублирование, а не арифметика.
    assert.ok(/secondsUntilClock\(nowSeconds, this\.endTime\)/.test(SRC),
        'плашка «До завершения» перестала считать через secondsUntilClock — кламп трогать было не нужно');
});

// ---------------------------------------------------------------------------
// Панель: «Сбросить всё» на вкладке «Дисплей».
// ---------------------------------------------------------------------------

/**
 * Прогнать resetWindowSettings() на поддельных window/document.
 *
 * Проверяется ПОВЕДЕНИЕ, а не текст файла: сброс — это порядок действий (режим
 * возвращается ДО записи в хранилище и до посылки в окно), и утверждение об
 * этом текстом исходника не выражается.
 */
function runReset(target, heroModeBefore) {
    const prevWindow = global.window;
    const prevDocument = global.document;
    const trace = [];
    global.document = { getElementById: () => null };
    global.window = {
        SettingsSchema: { resetOwnedSettings: () => trace.push('schema') },
        ClockSettingsSchema: { applyClockSettings: () => {} },
        PanelColorFields: [],
        HeroModes,
        ipcRenderer: { send: () => {} },
        Toast: null
    };
    try {
        const panel = Object.assign({
            heroMode: heroModeBefore,
            setHeroMode(id) { this.heroMode = HeroModes.modeById(id).id; trace.push('mode:' + this.heroMode); },
            updateColors: () => {},
            saveExtSettings() { trace.push('save:' + this.heroMode); },
            pushDisplaySettings() { trace.push('push:' + this.heroMode); },
            pushClockSettings: () => {},
            syncClockStyle: false,
            widgetStylePayload: () => ({}),
            clockShowTicksEl: null,
            timerStyleEl: { value: 'circle' },
            clockStyleEl: { value: 'circle' },
            updateStyleDependentRows: () => {},
            updateClockAnalogNumbersVisibility: () => {},
            highlightActiveThemes: () => {},
            renderSurfaceControls: () => {}
        }, PanelResetMixin);
        panel.resetWindowSettings(target);
        return { panel, trace };
    } finally {
        global.window = prevWindow;
        global.document = prevDocument;
    }
}

test('«Сбросить всё» возвращает режим героя в «Таймер»', () => {
    // heroMode — ручной ключ (MANUAL_KEYS): строки в таблице настроек у него
    // нет, значит resetOwnedSettings() его не трогает. Три поля заголовков —
    // обычные строки таблицы и сбрасывались; сам режим переживал сброс, и
    // pushDisplaySettings() отправлял его в окно заново.
    const { panel, trace } = runReset('display', 'to-end');
    assert.equal(panel.heroMode, HeroModes.DEFAULT_MODE,
        '«Сбросить всё» не вернула режим центрального времени к заводскому');

    // Порядок несущий: значение обязано смениться ДО записи в хранилище и до
    // посылки в окно, иначе кнопка «сбрасывает» то, что уже отправлено.
    assert.deepEqual(trace, ['schema', 'mode:timer', 'save:timer', 'push:timer'],
        'режим сброшен не до записи настроек: ' + trace.join(' → '));
});

test('«Сбросить всё» у виджета и часов режима героя не касается', () => {
    // Режим принадлежит полноэкранному окну; кнопка виджета, трогающая чужую
    // настройку, — ровно тот дефект, ради которого у настроек есть owner.
    for (const target of ['widget', 'clock']) {
        const { panel } = runReset(target, 'to-end');
        assert.equal(panel.heroMode, 'to-end',
            `сброс ${target} тронул режим центрального времени полноэкранного окна`);
    }
});
