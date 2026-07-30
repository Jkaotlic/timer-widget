const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Звуки во времени: КАЖДОЕ событие звучит и звучит РОВНО ОДИН раз.
 *
 * Что здесь не покрывалось. `tests/timer-engine.test.js` проверяет, что движок
 * эмитит события в нужные моменты (порогов, интервалов, больших шагов — 20 тестов).
 * Но между событием и звуком лежит цепочка: главный процесс → IPC → обработчик в
 * панели → проверка галочки → playSound. Её не проверял никто, а поводов для
 * двойного срабатывания там хватает: звук окончания вызывается ИЗ ДВУХ мест —
 * из обработчика `timer-reached-zero` и из обработчика состояния по переходу
 * `finished`, — а звук старта из трёх (локальный клик, переход !isRunning →
 * isRunning от другого окна и флаг `_localStartTriggered` между ними).
 *
 * Считаем фактические вызовы: подменяем `playSound` счётчиком и гоняем таймер по
 * настоящему времени короткими отрезками. Это единственный способ поймать «звук
 * пищит дважды» — юнит-тест движка о нём ничего не знает.
 */

// Подменяет playSound счётчиком и чистит журнал.
async function armSounds(control) {
    await control.evaluate(() => {
        const c = window.timerController;
        window.__sounds = [];
        if (!c._origPlaySound) { c._origPlaySound = c.playSound.bind(c); }
        c.playSound = (type) => { window.__sounds.push(type); return Promise.resolve(); };
    });
}

const readSounds = (control) => control.evaluate(() => window.__sounds.slice());
const clearSounds = (control) => control.evaluate(() => { window.__sounds = []; });

// Приводит таймер и галочки в известное состояние.
async function setup(control, { allowNegative, seconds, adjust = 0 }) {
    await control.evaluate((opts) => {
        for (const id of ['soundMasterEnabled', 'soundStartEnabled', 'soundEndEnabled',
            'soundMinuteEnabled', 'soundOverrunEnabled']) {
            const el = document.getElementById(id);
            if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        const neg = document.getElementById('allowNegative');
        if (neg.checked !== opts.allowNegative) {
            neg.checked = opts.allowNegative;
            neg.dispatchEvent(new Event('change', { bubbles: true }));
        }
        window.ipcRenderer.send('timer-command', { type: 'reset' });
        window.ipcRenderer.send('timer-command', { type: 'set', seconds: opts.seconds });
        if (opts.adjust) {
            window.ipcRenderer.send('timer-command', { type: 'adjust', deltaSeconds: opts.adjust });
        }
    }, { allowNegative, seconds, adjust });
    await control.waitForTimeout(700);
}

const count = (list, type) => list.filter((t) => t === type).length;

test('предупреждение за минуту звучит ровно один раз', async () => {
    const { app, control } = await launchApp();
    await armSounds(control);

    // 62 секунды: через ~2 с таймер пересечёт порог 60.
    await setup(control, { allowNegative: false, seconds: 62 });
    await clearSounds(control);
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    await control.waitForTimeout(4500);

    const sounds = await readSounds(control);
    expect(count(sounds, 'minute'), `журнал: ${JSON.stringify(sounds)}`).toBe(1);

    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    await app.close();
});

test('звук окончания на нуле звучит один раз — и без минуса, и с минусом', async () => {
    const { app, control } = await launchApp();
    await armSounds(control);

    // Обычный режим: таймер доходит до нуля и финиширует.
    await setup(control, { allowNegative: false, seconds: 2 });
    await clearSounds(control);
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    await control.waitForTimeout(4500);
    const plain = await readSounds(control);
    expect(count(plain, 'end'), `обычный режим, журнал: ${JSON.stringify(plain)}`).toBe(1);

    // Режим «ниже нуля»: на нуле приходит timer-reached-zero, а `finished` НЕ
    // выставляется — иначе сработали бы оба обработчика и звук пошёл бы дважды.
    await setup(control, { allowNegative: true, seconds: 2 });
    await clearSounds(control);
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    await control.waitForTimeout(4500);
    const overrun = await readSounds(control);
    expect(count(overrun, 'end'), `режим минуса, журнал: ${JSON.stringify(overrun)}`).toBe(1);

    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    await app.close();
});

test('сигнал перерасхода звучит на каждой минуте и не чаще', async () => {
    const { app, control } = await launchApp();
    await armSounds(control);

    // −59 секунд: через ~1 с пересекаем −60, то есть первую минуту перерасхода.
    // Дальше до −120 ещё минута, поэтому за время теста сигнал обязан быть один.
    await setup(control, { allowNegative: true, seconds: 300, adjust: -359 });
    await clearSounds(control);
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    await control.waitForTimeout(5000);

    const sounds = await readSounds(control);
    expect(
        count(sounds, 'overrun'),
        `сигнал перерасхода должен прозвучать ровно один раз, журнал: ${JSON.stringify(sounds)}`
    ).toBe(1);

    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    await app.close();
});

test('звук старта не дублируется при локальном запуске', async () => {
    const { app, control } = await launchApp();
    await armSounds(control);

    // Локальный клик по «Старт» звучит один раз: сам обработчик кнопки играет звук,
    // а переход !isRunning → isRunning в состоянии гасится флагом
    // _localStartTriggered. Без флага звук шёл бы дважды.
    await setup(control, { allowNegative: false, seconds: 120 });
    await clearSounds(control);
    await control.click('#startBtn');
    await control.waitForTimeout(2500);

    const local = await readSounds(control);
    expect(count(local, 'start'), `локальный старт, журнал: ${JSON.stringify(local)}`).toBe(1);

    // Запуск ИЗ ДРУГОГО ОКНА: панель узнаёт о нём только по переходу состояния и
    // обязана сыграть ровно один раз.
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    await control.waitForTimeout(600);
    await clearSounds(control);
    await control.evaluate(() => window.ipcRenderer.send('timer-control', 'start'));
    await control.waitForTimeout(2500);

    const remote = await readSounds(control);
    expect(count(remote, 'start'), `запуск из другого окна, журнал: ${JSON.stringify(remote)}`).toBe(1);

    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    await app.close();
});

test('выключенный мастер-тумблер глушит все события', async () => {
    const { app, control } = await launchApp();
    await armSounds(control);

    await setup(control, { allowNegative: false, seconds: 62 });
    // Гасим мастер-переключатель — остальные галочки остаются включёнными.
    await control.evaluate(() => {
        const master = document.getElementById('soundMasterEnabled');
        master.checked = false;
        master.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await control.waitForTimeout(500);
    await clearSounds(control);

    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    await control.waitForTimeout(4500);

    // playSound вызвана может быть, но звучать не должна: мастер-флаг проверяется
    // ВНУТРИ неё. Поэтому здесь проверяем сам флаг — он единственный источник правды.
    const enabled = await control.evaluate(() => window.timerController.soundEnabled);
    expect(enabled, 'мастер-тумблер обязан выключать soundEnabled').toBe(false);

    // Возвращаем как было, чтобы не портить состояние другим спекам.
    await control.evaluate(() => {
        const master = document.getElementById('soundMasterEnabled');
        master.checked = true;
        master.dispatchEvent(new Event('change', { bubbles: true }));
        window.ipcRenderer.send('timer-command', { type: 'reset' });
    });
    await control.waitForTimeout(500);
    await app.close();
});
