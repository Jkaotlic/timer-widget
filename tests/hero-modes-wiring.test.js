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
