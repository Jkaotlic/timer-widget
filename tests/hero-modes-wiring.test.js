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
const { codeOnly, balancedBlockAt } = require('./helpers/source-scan');

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
