const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const { waitForWidget, panelRoundTrip, waitForPanelRemaining } = require('./window-ready');

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
    // Галочки пишутся синхронно в change; команды — дошли до main и их
    // состояние вернулось в панель.
    await panelRoundTrip(control);
}

const count = (list, type) => list.filter((t) => t === type).length;

/**
 * «Ровно один» — утверждение и об ОТСУТСТВИИ второго звука, поэтому здесь
 * ждут не появления звука, а ТОЧКИ отсчёта, до которой прежде досиживала
 * пауза (`waitForPanelRemaining`). Второй звук пошёл бы из тех же обработчиков
 * панели (timer-state / timer-minute / timer-reached-zero /
 * timer-overrun-minute — все синхронные, control-app.js), а все посылки main,
 * ушедшие до этой точки, круг панель → main → панель доставляет. Отрезок
 * наблюдения тот же, что давала пауза, но меряется таймером приложения.
 */
const runUntil = (control, to) => waitForPanelRemaining(control, to);

test('предупреждение за минуту звучит ровно один раз', async () => {
    const { app, control } = await launchApp();
    await armSounds(control);

    // 62 секунды: через ~2 с таймер пересечёт порог 60.
    await setup(control, { allowNegative: false, seconds: 62 });
    await clearSounds(control);
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    // Прежние 4,5 с от 62 — это 58: порог 60 и два тика после него.
    await runUntil(control, 58);

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
    // Без минуса таймер стоит на нуле: финиш — последнее, что main пришлёт,
    // после него посылок нет вовсе, и круг закрывает всё, что ушло.
    await expect.poll(() => control.evaluate(() => window.timerController.wasFinished),
        { message: 'таймер должен финишировать', timeout: 15000 }).toBe(true);
    await panelRoundTrip(control);
    const plain = await readSounds(control);
    expect(count(plain, 'end'), `обычный режим, журнал: ${JSON.stringify(plain)}`).toBe(1);

    // Режим «ниже нуля»: на нуле приходит timer-reached-zero, а `finished` НЕ
    // выставляется — иначе сработали бы оба обработчика и звук пошёл бы дважды.
    await setup(control, { allowNegative: true, seconds: 2 });
    await clearSounds(control);
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    // Прежние 4,5 с от 2 — это −2: ноль и два тика минуса после него.
    await runUntil(control, -2);
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
    // Прежние 5 с от −59 — это −64: порог −60 и четыре тика после него.
    await runUntil(control, -64);

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
    // Второй звук старта пошёл бы из перехода !isRunning → isRunning — он
    // один, в первой посылке состояния после старта. Прежние 2,5 с от 120 —
    // это 118.
    await runUntil(control, 118);

    const local = await readSounds(control);
    expect(count(local, 'start'), `локальный старт, журнал: ${JSON.stringify(local)}`).toBe(1);

    // Запуск ИЗ ДРУГОГО ОКНА: панель узнаёт о нём только по переходу состояния и
    // обязана сыграть ровно один раз.
    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    await panelRoundTrip(control);
    await clearSounds(control);
    // Шлёт НАСТОЯЩЕЕ другое окно: `timer-control` — канал клавиш виджета,
    // часов и дисплея, и с SEC-07 главный процесс принимает его только от них.
    // Посылка из панели здесь изображала «другое окно» и теперь отвергается.
    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    const widget = await waitForWidget(app);
    await widget.evaluate(() => window.ipcRenderer.send('timer-control', 'start'));
    // Старт пришёл от виджета, но отсчёт панель видит своим timer-state.
    await runUntil(control, 118);

    const remote = await readSounds(control);
    expect(count(remote, 'start'), `запуск из другого окна, журнал: ${JSON.stringify(remote)}`).toBe(1);
    await control.evaluate(() => window.ipcRenderer.send('close-widget'));

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
    // change синхронный: soundEnabled и хранилище записаны в обработчике.
    await clearSounds(control);

    await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
    // Прежние 4,5 с от 62 — это 58: порог минуты пройден.
    await runUntil(control, 58);

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
    await panelRoundTrip(control);
    await app.close();
});
