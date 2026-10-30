'use strict';

/**
 * Зонд e2e `window.__startupPushed` обязан встать ПОСЛЕ всей стартовой
 * рассылки панели.
 *
 * e2e/launch.js (и `reloadPanel` в e2e/window-ready.js) ждут этот зонд вместо
 * паузы 900 мс: «стартовая рассылка ушла — можно командовать». Рассылку шлют
 * таймеры конструктора `TimerController` (control-app.js): подгонка 100 мс,
 * настройки 200 мс, стиль окнам 600 мс. Положение зонда ничем не держалось
 * (ревью e2e-B2, M1): новый `setTimeout(() => this.pushX(), 800)` в
 * конструкторе или строка зонда, поднятая выше `pushWindowStyles()`, вернули
 * бы `launchApp` раньше рассылки — и спеки читали бы промежуточное состояние.
 * Красным это стало бы не здесь, а флаком на медленной машине.
 *
 * Утверждение: в конструкторе зонд ставится ровно в одном таймере; ни один
 * другой таймер конструктора не срабатывает позже (больше задержка — или та
 * же, но взведён позже: равные задержки исполняются в порядке взвода); в теле
 * таймера зонд — ПОСЛЕДНИЙ оператор и стоит после `this.pushWindowStyles()`.
 * Задержка не литералом — неизвестна, это тоже отказ.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly, maskNonCode, balancedBlockAt, afterBalanced } = require('./helpers/source-scan');

const repoRoot = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8');

const PROBE = 'window.__startupPushed = true';

/**
 * Проблемы расположения зонда в исходнике контроллера. Пустой список — чисто.
 *
 * @param {string} source — исходник с классом TimerController
 * @returns {string[]}
 */
function probeProblems(source) {
    const src = codeOnly(source);
    const cls = src.indexOf('class TimerController');
    if (cls === -1) { return ['нет class TimerController']; }
    const ctorAt = src.indexOf('constructor(', cls);
    if (ctorAt === -1) { return ['нет конструктора TimerController']; }
    const ctor = balancedBlockAt(src, ctorAt, 'конструктор', src.indexOf(')', ctorAt));
    const mask = maskNonCode(ctor);

    const timers = [];
    for (const m of mask.matchAll(/\bsetTimeout\(/g)) {
        const open = m.index + m[0].length - 1;
        const end = afterBalanced(mask, open, '(', ')', 'setTimeout');
        const call = ctor.slice(m.index, end);
        const delay = /,\s*(\d+)\s*\)$/.exec(call);
        timers.push({ call, delay: delay ? Number(delay[1]) : null });
    }
    const problems = [];
    const withProbe = timers.filter((t) => t.call.includes(PROBE));
    if (withProbe.length !== 1) {
        problems.push(`зонд стоит в ${withProbe.length} таймерах конструктора, нужен ровно один`);
        return problems;
    }
    const probe = withProbe[0];
    const probeIdx = timers.indexOf(probe);
    for (const [i, t] of timers.entries()) {
        if (t.delay === null) { problems.push(`задержка таймера не литерал: ${t.call.slice(0, 60)}…`); continue; }
        if (t === probe) { continue; }
        if (t.delay > probe.delay || (t.delay === probe.delay && i > probeIdx)) {
            problems.push(`таймер ${t.delay} мс срабатывает позже зонда (${probe.delay} мс)`);
        }
    }
    // Тело таймера зонда: последний оператор — зонд, и он после рассылки стиля.
    const body = /^setTimeout\(\(\)\s*=>\s*\{([\s\S]*)\}\s*,\s*\d+\s*\)$/.exec(probe.call);
    if (!body) {
        problems.push('таймер зонда — не стрелка с блочным телом');
        return problems;
    }
    const statements = body[1].split(';').map((s) => s.trim()).filter(Boolean);
    if (statements[statements.length - 1] !== PROBE) {
        problems.push('зонд — не последний оператор своего таймера');
    }
    const push = body[1].indexOf('this.pushWindowStyles()');
    if (push === -1) {
        problems.push('в таймере зонда нет this.pushWindowStyles()');
    } else if (body[1].indexOf(PROBE) < push) {
        problems.push('зонд стоит раньше this.pushWindowStyles()');
    }
    return problems;
}

const fixture = (timers) => `
class TimerController {
    constructor() {
        this.init();
        ${timers}
    }
    other() { setTimeout(() => this.late(), 5000); }
}`;

test('самопроверка: верное расположение чисто, каждая поломка ловится', () => {
    const good = `setTimeout(() => this.fit(), 100);
        setTimeout(() => { this.a(); this.b(); }, 200);
        setTimeout(() => {
            this.pushWindowStyles();
            // комментарий не мешает
            ${PROBE};
        }, 600);`;
    assert.deepEqual(probeProblems(fixture(good)), [], 'верное расположение');

    // Таймер вне конструктора (метод other, 5000) не считается — выше он есть.
    const later = good + '\n        setTimeout(() => this.pushX(), 800);';
    assert.match(probeProblems(fixture(later)).join('\n'), /800 мс срабатывает позже/);

    const sameDelayAfter = good + '\n        setTimeout(() => this.pushX(), 600);';
    assert.match(probeProblems(fixture(sameDelayAfter)).join('\n'), /600 мс срабатывает позже/);

    const before = `setTimeout(() => {
            ${PROBE};
            this.pushWindowStyles();
        }, 600);`;
    const beforeProblems = probeProblems(fixture(before)).join('\n');
    assert.match(beforeProblems, /не последний оператор/);
    assert.match(beforeProblems, /раньше this\.pushWindowStyles/);

    const noPush = `setTimeout(() => { this.other(); ${PROBE}; }, 600);`;
    assert.match(probeProblems(fixture(noPush)).join('\n'), /нет this\.pushWindowStyles/);

    // Зонд, оставшийся только в комментарии, — не зонд (codeOnly).
    const commented = `setTimeout(() => {
            this.pushWindowStyles();
            // ${PROBE};
        }, 600);`;
    assert.match(probeProblems(fixture(commented)).join('\n'), /в 0 таймерах/);

    const named = good + '\n        setTimeout(() => this.x(), DELAY);';
    assert.match(probeProblems(fixture(named)).join('\n'), /не литерал/);
});

test('зонд __startupPushed ставится ПОСЛЕ всей стартовой рассылки конструктора панели', () => {
    assert.deepEqual(probeProblems(read('control-app.js')), []);
});

test('ожидания старта — по зонду, а не паузой: launchApp и reloadPanel', () => {
    const launch = codeOnly(read('e2e/launch.js'));
    assert.match(launch, /await waitForStartupPush\(control\)/, 'launchApp не ждёт зонд');
    assert.doesNotMatch(launch, /waitForTimeout|settleMs/, 'в launch.js вернулась пауза старта');

    const ready = codeOnly(read('e2e/window-ready.js'));
    const at = ready.indexOf('async function reloadPanel(');
    assert.notEqual(at, -1, 'нет reloadPanel (самопроверка)');
    const body = balancedBlockAt(ready, at, 'reloadPanel');
    assert.match(body, /await waitForStartupPush\(control\)/, 'reloadPanel не ждёт зонд новой страницы');
    assert.doesNotMatch(body, /waitForTimeout/);
});
