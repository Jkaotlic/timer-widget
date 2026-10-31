'use strict';

/**
 * Расписание («Начало»/«Окончание») — настройка, и всё, что из него выведено,
 * перерисовывается НА ПРИХОДЕ настроек, а не ближайшим тиком часов дисплея.
 *
 * Дефект 31.10.2026 (e2e-B5): «До завершения» считал только тик
 * `startCurrentTimeClock`. После смены расписания блок до секунды показывал
 * остаток по ПРЕЖНЕМУ: замер — `11:38:52` (до старого конца 12:00) вместо
 * ~`02:00`. Тот же класс, что docs/lessons.md#a-subtitle-is-a-report-and-it-must-not-wait-for-a-tick.
 * Тем же страдал герой в режимах «до начала»/«до конца»: его тоже
 * перерисовывал только тик.
 *
 * Логика живёт в классе `DisplayTimer` и в Node не импортируется — проверяется
 * ИСХОДНИК: и присутствие правильного, и отсутствие старого.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { codeOnly, balancedBlockAt, maskNonCode, afterBalanced } = require('./helpers/source-scan');

const SRC = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'display-script.js'), 'utf8'));

function methodBody(src, name) {
    const start = src.indexOf(`\n    ${name}(`);
    assert.notEqual(start, -1, `метода ${name} в display-script.js нет`);
    return balancedBlockAt(src, start, `метод ${name}`);
}

/** Срез `имя(...)` на каждое вхождение — по всему файлу. */
function callSites(src, calleeParen) {
    const mask = maskNonCode(src);
    const sites = [];
    let from = 0;
    for (;;) {
        const at = mask.indexOf(calleeParen, from);
        if (at === -1) { return sites; }
        const close = afterBalanced(mask, at + calleeParen.length - 1, '(', ')', calleeParen);
        sites.push({ at, text: src.slice(at, close) });
        from = close;
    }
}

/** Индекс начала тела метода в исходнике — чтобы спросить, ЧЕЙ это вызов. */
function methodRange(src, name) {
    const start = src.indexOf(`\n    ${name}(`);
    const body = balancedBlockAt(src, start, `метод ${name}`);
    const bodyAt = src.indexOf(body, start);
    return [bodyAt, bodyAt + body.length];
}

test('формулу «До завершения» знает ОДНО место — updateScheduleDerived()', () => {
    const owner = methodBody(SRC, 'updateScheduleDerived');
    assert.ok(owner.includes('RendererShared.secondsUntilEventEnd('),
        'updateScheduleDerived() не считает остаток до конца');
    assert.ok(owner.includes('this.timeLeftValueEl.textContent'),
        'updateScheduleDerived() не пишет текст блока');
    assert.ok(owner.includes('this.updateMiniClockHands(') && owner.includes('this.timeLeftBlock'),
        'updateScheduleDerived() не крутит стрелки циферблата блока');

    const sites = callSites(SRC, 'secondsUntilEventEnd(');
    assert.equal(sites.length, 1,
        `secondsUntilEventEnd( зовётся ${sites.length} раз — второй вызов это второй владелец формулы`);
    const [a, b] = methodRange(SRC, 'updateScheduleDerived');
    assert.ok(sites[0].at > a && sites[0].at < b,
        'единственный вызов secondsUntilEventEnd( стоит не в updateScheduleDerived()');
});

test('тик часов дисплея зовёт того же владельца, а не свою копию', () => {
    const tick = methodBody(SRC, 'startCurrentTimeClock');
    assert.ok(tick.includes('this.updateScheduleDerived('),
        'тик не зовёт updateScheduleDerived()');
    assert.ok(!tick.includes('secondsUntilEventEnd('),
        'в тике осталась своя формула остатка — второй владелец');
});

test('приход расписания перерисовывает выведенное из него СРАЗУ, а не ждёт тика', () => {
    const apply = methodBody(SRC, 'applyDisplaySettings');
    const endAssign = apply.indexOf('this.endTime = settings.endTime');
    const startAssign = apply.indexOf('this.eventTime = settings.eventTime');
    assert.ok(endAssign !== -1 && startAssign !== -1, 'присвоения расписания в applyDisplaySettings не найдены');

    const call = apply.indexOf('this.updateScheduleDerived(');
    assert.notEqual(call, -1,
        'applyDisplaySettings() не зовёт updateScheduleDerived(): «До завершения» ждёт тика — до секунды по ПРЕЖНЕМУ расписанию');
    assert.ok(call > endAssign && call > startAssign,
        'updateScheduleDerived() зовётся ДО присвоения расписания — считает по прежнему');
});

test('герой в режиме от расписания перерисовывается тем же владельцем, кэш кадра сброшен', () => {
    const owner = methodBody(SRC, 'updateScheduleDerived');
    assert.ok(/this\.heroMode !== HeroModes\.DEFAULT_MODE/.test(owner),
        'владелец не различает режим героя');
    assert.ok(owner.includes('this.updateDisplay()'),
        'герой в режиме «до начала»/«до конца» не перерисовывается владельцем');

    // На приходе расписания число героя может не измениться (сдвинули только
    // «Начало» в режиме «до конца»), а тотал — измениться: гейт updateDisplay()
    // по lastSeconds тогда оставил бы прежнюю полосу. Кэш сбрасывается явно.
    const apply = methodBody(SRC, 'applyDisplaySettings');
    const call = apply.indexOf('this.updateScheduleDerived(');
    const before = apply.slice(Math.max(0, call - 400), call);
    assert.ok(before.includes('this._forgetHeroFrame()'),
        'перед перерисовкой по новому расписанию кэш кадра героя не сброшен');
});

test('зонд проверяет себя: старая проводка (формула в тике) ловится', () => {
    const fake = '\nclass X {\n    startCurrentTimeClock() {\n'
        + '        const left = RendererShared.secondsUntilEventEnd(n, this.eventTime, this.endTime);\n'
        + '    }\n    applyDisplaySettings(settings) {\n'
        + '        this.eventTime = settings.eventTime;\n        this.endTime = settings.endTime;\n'
        + '    }\n}\n';
    assert.ok(methodBody(fake, 'startCurrentTimeClock').includes('secondsUntilEventEnd('),
        'зонд не видит формулу в тике заведомо плохого исходника');
    assert.equal(methodBody(fake, 'applyDisplaySettings').indexOf('this.updateScheduleDerived('), -1,
        'зонд сломан: в заведомо плохом исходнике «найден» вызов владельца');
});
