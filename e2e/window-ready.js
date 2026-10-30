'use strict';

/**
 * Ожидание окна — ОДНА реализация на все спеки.
 *
 * Было так: `send('open-display')` → `waitForTimeout(1500…2600)` → перебор
 * `app.windows()`. Пауза — это ставка на скорость машины, и она проигрывает на
 * загруженной. В проекте это правило уже записано (переход ждут СОБЫТИЕМ, а не
 * паузой), но записано оно было про ВЫХОД из полноэкранного режима, и на
 * открытие окна его не распространили: двадцать одна спека продолжала ждать
 * числом.
 *
 * 31.08.2026 ставка перестала выигрывать. Четыре прогона подряд на macOS-руннере
 * дали четыре РАЗНЫХ падения, три из них одного семейства — «окно дисплея не
 * найдено» / `Cannot read properties of null`. Диагноз подтверждён на заведомо
 * чистом коммите: та же работа, перезапущенная на `a03a8e6` (последний зелёный,
 * ни одной новой строки), упала на macOS точно так же. Значит дело не в коде
 * приложения и не в конкретной правке, а в том, что руннер стал медленнее
 * паузы, зашитой в спеки.
 *
 * Здесь ждут УСЛОВИЯ с дедлайном: окно появилось, документ загрузился, разметка
 * дисплея на месте. На быстрой машине это возвращается через десятки
 * миллисекунд вместо зашитых двух секунд — то есть набор ещё и ускоряется.
 *
 * ПОЧЕМУ НЕ `app.waitForEvent('window')`: событие приходит только на НОВОЕ окно.
 * Часть спек открывает дисплей повторно, часть — когда он уже открыт; там
 * ожидание события повисло бы до таймаута на полностью исправном приложении.
 * Опрос с дедлайном одинаково верен в обоих случаях.
 *
 * НЕ ВОЗВРАЩАЕТ null. Прежний `findDisplay()` отдавал null, и спека падала
 * дальше по тексту с `Cannot read properties of null (reading 'evaluate')` —
 * сообщение, по которому не видно ни что ждали, ни сколько. Здесь бросается
 * ошибка, называющая условие и сколько окон было в наличии.
 */

// Пробы — по идентификатору, КОТОРЫЙ ЕСТЬ ТОЛЬКО В СВОЁМ окне (проверено по
// всем четырём HTML): перепутать окна проба не может.
const DISPLAY_PROBE = () => !!document.getElementById('progressRing');
const WIDGET_PROBE = () => !!document.getElementById('wFlipHoursGroup');
const CLOCK_PROBE = () => !!document.getElementById('clockGradient');

const CONFIG = require('../constants.js');
const { SAVE_SETTLE_MS } = require('../window-geometry.js');
const { waitForStartupPush } = require('./launch');

const DEFAULT_TIMEOUT = 20000;
const POLL_MS = 100;

/**
 * Окно по пробе среди открытых — или null, если его нет ПРЯМО СЕЙЧАС.
 *
 * Именно для вопроса «а оно закрыто?», а не для ожидания: ждать надо
 * `waitForWindow` и его обёртки.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {Function} probe — выполняется В ОКНЕ, отвечает true/false
 * @returns {Promise<import('@playwright/test').Page|null>}
 */
async function findWindowBy(app, probe) {
    for (const w of app.windows()) {
        if (await w.evaluate(probe).catch(() => false)) { return w; }
    }
    return null;
}

/** Окно дисплея среди открытых — или null. */
function findDisplay(app) { return findWindowBy(app, DISPLAY_PROBE); }

/**
 * Дождаться окна по УСЛОВИЮ, а не по паузе.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {Function} probe — выполняется В ОКНЕ, отвечает true/false
 * @param {{timeout?: number, selector?: string, name?: string, interval?: number}} [opts]
 *        selector — дополнительное условие внутри окна (например `#timerDigits.active`);
 *        name — как назвать окно в сообщении об ошибке;
 *        interval — шаг опроса, мс (по умолчанию `POLL_MS`)
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function waitForWindow(app, probe, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const name = opts.name || 'окно';
    const deadline = Date.now() + timeout;

    for (;;) {
        const seen = app.windows().length;
        const page = await findWindowBy(app, probe);
        if (page) {
            await page.waitForLoadState('domcontentloaded');
            if (opts.selector) {
                await page.waitForSelector(opts.selector, { timeout: Math.max(1000, deadline - Date.now()) });
            }
            return page;
        }
        if (Date.now() >= deadline) {
            throw new Error(`${name} не появилось за ${timeout} мс: открытых окон ${seen}, проба не сошлась ни в одном`);
        }
        // шаг опроса: окно с пробой появилось
        await new Promise((r) => setTimeout(r, opts.interval ?? POLL_MS));
    }
}

/**
 * Дождаться, пока окно ИСЧЕЗНЕТ.
 *
 * Обратная сторона `waitForWindow`, и нужна она ровно так же часто: закрытие
 * окна дисплея не мгновенно. Оно полноэкранное, и `closeDisplayWindow()` в
 * главном процессе сначала выходит из полноэкранного режима, ждёт события
 * `leave-full-screen` и только потом закрывает — иначе macOS роняет всё
 * приложение (разбор — в electron-main.js). Пока идёт этот переход, окно
 * отвечает на пробу как живое.
 *
 * Спеки ждали здесь паузой (`waitForTimeout(800)`), и это та же ставка на
 * скорость машины, что и при открытии: на загруженном раннере следующая
 * команда «открыть» приходила в середину закрытия. Ошибка называет, сколько
 * окон осталось, — «не закрылось за N мс» без числа диагностировать нечем.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {Function} probe — выполняется В ОКНЕ, отвечает true/false
 * @param {{timeout?: number, name?: string}} [opts]
 * @returns {Promise<void>}
 */
async function waitForWindowGone(app, probe, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const name = opts.name || 'окно';
    const deadline = Date.now() + timeout;

    for (;;) {
        const page = await findWindowBy(app, probe);
        if (!page) { return; }
        if (Date.now() >= deadline) {
            throw new Error(`${name} не закрылось за ${timeout} мс: окон открыто ${app.windows().length}`);
        }
        // шаг опроса: окно с пробой исчезло
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
}

/** Дождаться закрытия окна дисплея. */
function waitForDisplayGone(app, opts = {}) {
    return waitForWindowGone(app, DISPLAY_PROBE, Object.assign({ name: 'окно дисплея' }, opts));
}

/** Дождаться закрытия окна виджета. */
function waitForWidgetGone(app, opts = {}) {
    return waitForWindowGone(app, WIDGET_PROBE, Object.assign({ name: 'окно виджета' }, opts));
}

/** Дождаться закрытия окна часов. */
function waitForClockGone(app, opts = {}) {
    return waitForWindowGone(app, CLOCK_PROBE, Object.assign({ name: 'окно часов' }, opts));
}

/** @returns {Promise<import('@playwright/test').Page>} окно дисплея */
function waitForDisplay(app, opts = {}) {
    return waitForWindow(app, DISPLAY_PROBE, Object.assign({ name: 'окно дисплея' }, opts));
}

/** @returns {Promise<import('@playwright/test').Page>} окно виджета */
function waitForWidget(app, opts = {}) {
    return waitForWindow(app, WIDGET_PROBE, Object.assign({ name: 'окно виджета' }, opts));
}

/** @returns {Promise<import('@playwright/test').Page>} окно часов */
function waitForClock(app, opts = {}) {
    return waitForWindow(app, CLOCK_PROBE, Object.assign({ name: 'окно часов' }, opts));
}

/**
 * Открыть дисплей и вернуть его окно, дождавшись готовности.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} control — окно панели
 * @param {{displayIndex?: number|string, timeout?: number, selector?: string}} [opts]
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function openDisplay(app, control, opts = {}) {
    const displayIndex = opts.displayIndex ?? 'auto';
    await control.evaluate(
        (idx) => window.ipcRenderer.send('open-display', { displayIndex: idx }),
        displayIndex
    );
    return waitForDisplay(app, opts);
}

/**
 * Закрыть дисплей и ДОЖДАТЬСЯ, что он закрылся.
 *
 * Пара к `openDisplay`, и без неё переоткрытие ненадёжно с обеих сторон:
 * `waitForDisplay`, позванный сразу после команды «закрыть», находит СТАРОЕ
 * окно — проба в нём ещё сходится, — и спека продолжает работать со ссылкой на
 * окно, которое вот-вот исчезнет («Target page, context or browser has been
 * closed» в середине следующего замера).
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} control — окно панели
 * @param {{timeout?: number}} [opts]
 */
async function closeDisplay(app, control, opts = {}) {
    await control.evaluate(() => window.ipcRenderer.send('close-display'));
    await waitForDisplayGone(app, opts);
}

/**
 * Переоткрыть дисплей: закрыть, дождаться закрытия, открыть, дождаться готовности.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} control — окно панели
 * @param {{displayIndex?: number|string, timeout?: number, selector?: string}} [opts]
 * @returns {Promise<import('@playwright/test').Page>} новое окно дисплея
 */
async function reopenDisplay(app, control, opts = {}) {
    await closeDisplay(app, control, opts);
    return openDisplay(app, control, opts);
}

/**
 * Дождаться, что величина в окне ОСЕЛА: `read` вернул одно и то же
 * `samples` раз подряд с шагом `interval`.
 *
 * Для того, что приходит не событием, а серией: полноэкранный переход,
 * раскладка после открытия, сохранённое место после переоткрытия. Пауза
 * «2400 мс хватит» — ставка на скорость машины; здесь ждут, пока перестанет
 * меняться, и не дольше.
 *
 * Годится и `ElectronApplication`: тогда `read` выполняется в ГЛАВНОМ
 * процессе и получает модуль electron (границы окна, которые меняет main).
 *
 * @param {import('@playwright/test').Page|import('@playwright/test').ElectronApplication} page
 * @param {Function} read — выполняется В ОКНЕ (или в main), возвращает сериализуемое значение
 * @param {{samples?: number, interval?: number, timeout?: number, name?: string}} [opts]
 * @returns {Promise<any>} осевшее значение
 */
async function waitForSteady(page, read, opts = {}) {
    const samples = opts.samples ?? 3;
    const interval = opts.interval ?? 150;
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const deadline = Date.now() + timeout;
    let last;
    let same = 0;
    for (;;) {
        const value = await page.evaluate(read);
        const key = JSON.stringify(value);
        same = key === last ? same + 1 : 1;
        last = key;
        if (same >= samples) { return value; }
        if (Date.now() > deadline) {
            throw new Error(`${opts.name || 'величина'} не осела за ${timeout} мс; последнее: ${key}`);
        }
        // шаг опроса: величина повторилась `samples` раз подряд (интервал —
        // это и есть определение «осела»)
        await new Promise((r) => setTimeout(r, interval));
    }
}

/**
 * Перезагрузить панель и дождаться, что контроллер встал.
 *
 * Спеки делали `reload()` → `waitForTimeout(1200)`. `reload()` сам ждёт
 * события `load`; недоставало одного — конструктора `TimerController`
 * (control-app.js), после которого ячейки, ящик и тумблеры уже связаны, и
 * его стартовой рассылки (зонд `__startupPushed`, как в `launchApp`).
 *
 * @param {import('@playwright/test').Page} control
 * @param {{awaitStartup?: boolean}} [opts]
 */
async function reloadPanel(control, opts = {}) {
    await control.reload();
    await control.waitForFunction(() => typeof window.timerController === 'object' && !!window.timerController);
    // Конструктор новой страницы снова заводит стартовую рассылку (таймеры
    // 100/200/600 мс) — та же гонка, что у запуска (ревью e2e-B2, M4). Зонд
    // сбрасывается сам: страница новая, `window` новое. `awaitStartup: false` —
    // тесту, которому нужно успеть ДО рассылки (как у launchApp; mini-bar:
    // свёртка в первые 100 мс).
    if (opts.awaitStartup !== false) { await waitForStartupPush(control); }
}

/**
 * Дождаться конца всех CSS-переходов документа.
 *
 * Для утверждений о ВЫЧИСЛЕННОМ цвете: заливка, цвет и рамка меняются
 * переходом (`--tw-dur-base`), и снимок сразу после смены класса ловит
 * середину. `document.getAnimations()` сам досчитывает отложенный стиль,
 * поэтому переход, только что запущенный сменой класса, уже в списке.
 * Бесконечные анимации не ждём — только `CSSTransition`.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForTransitions(page) {
    await page.evaluate(async () => {
        const running = document.getAnimations().filter((a) => a instanceof CSSTransition);
        await Promise.all(running.map((a) => a.finished.catch(() => {})));
    });
}

/**
 * Дождаться, что окно ПОЛУЧИЛО новый размер и его обработчики `resize` отработали.
 *
 * Размер окна меняет главный процесс (`setSize`, ползунок масштаба через IPC),
 * а кегль «Цифр», масштаб и раскладку пересчитывает рендерер — в обработчике
 * `resize`, у дисплея ещё и через debounce (`CONFIG.RESIZE_DEBOUNCE`). Спеки
 * ждали это паузой 500–700 мс; здесь три условия по порядку:
 *
 * 1. размер в рендерере отличается от `before` — окно дошло до страницы;
 *    затем он ОСЕЛ (`waitForSteady`): система вправе поправить запрошенный
 *    размер следом (запрошенный ≠ выданный);
 * 2. кадр (`requestAnimationFrame`): событие `resize` рассылается в шаге
 *    отрисовки ДО колбэков кадра, то есть прямые обработчики уже отработали;
 * 3. `debounceMs` — таймер той же длины, взведённый ПОСЛЕ таймера приложения.
 *    Это не ставка на скорость: таймеры с равной задержкой исполняются в
 *    порядке взвода (HTML, timer initialisation steps), поэтому наш
 *    срабатывает строго после отложенного пересчёта.
 *
 * @param {import('@playwright/test').Page} page
 * `before` обязан быть ОСЕВШИМ (`waitForSteady(page, innerSize)`): если окно ещё
 * доезжает после прошлой команды, помощник вернётся на ЧУЖОМ ресайзе.
 *
 * @param {{w: number, h: number}} before — осевший размер ДО команды
 * @param {{debounceMs?: number, timeout?: number}} [opts]
 * @returns {Promise<{w: number, h: number}>} выданный размер
 */
async function waitForResizeHandled(page, before, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    await page.waitForFunction(
        (b) => window.innerWidth !== b.w || window.innerHeight !== b.h,
        before, { timeout }
    );
    const size = await waitForSteady(page, innerSize, { timeout, name: 'размер окна' });
    await page.evaluate(async (ms) => {
        await new Promise((r) => requestAnimationFrame(() => r()));
        // пауза законна: таймер ТОЙ ЖЕ длины, что debounce приложения, взведён
        // после него — исполнится строго следом (п. 3 выше)
        if (ms > 0) { await new Promise((r) => setTimeout(r, ms)); }
    }, opts.debounceMs || 0);
    return size;
}

/** Размер окна глазами страницы — вход для `waitForResizeHandled`. */
function innerSize() { return { w: window.innerWidth, h: window.innerHeight }; }

/**
 * Дождаться, что окно УТИХЛО: шрифты доехали, CSS-переходов нет, отложенные
 * на кадр пересчёты отработали.
 *
 * Для замеров коробок после команды, которая уже ДОШЛА до окна (см.
 * `armReceived`): обработчик сообщения синхронный, но за ним идут хвосты —
 * `reflowSoon()` на следующем кадре, `transform`/`opacity` переходом 300–400 мс,
 * перерасчёт по приехавшему woff2. Спеки ждали это паузой 600–1200 мс.
 *
 * Круг: шрифты (`document.fonts.ready`) → два кадра (кадровые колбэки
 * приложения, взведённые до нас, уже отработали) → все идущие CSSTransition
 * (`finished`). Круг повторяется, пока не выйдет чистым: переход, доехав,
 * может завести пересчёт, а тот — новый переход.
 *
 * Переходы ТИКА не ждутся (`TICK_TRANSITIONS`): при идущем таймере кольцо
 * (`stroke-dashoffset`) и полоса прогресса (`width` у `.display-progress-fill`)
 * заводят переход каждую секунду, и круг не вышел бы чистым никогда. Оба
 * только красят и коробок соседей не двигают.
 *
 * Предел кругов исчерпан — это НЕ «тихо»: печатается, что ещё ехало, чтобы
 * следующее падение утверждения было с диагнозом.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{rounds?: number}} [opts]
 */
async function waitForQuiet(page, opts = {}) {
    const left = await page.evaluate(async ([rounds, tick]) => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        const isTick = (a) => tick.some(([sel, prop]) => a.transitionProperty === prop
            && (sel === '*' || (a.effect && a.effect.target && a.effect.target.matches && a.effect.target.matches(sel))));
        const describe = (a) => {
            const t = a.effect && a.effect.target;
            const name = t ? (t.id ? '#' + t.id : (t.getAttribute && t.getAttribute('class')) || t.nodeName) : '?';
            return `${name}:${a.transitionProperty}`;
        };
        let running = [];
        for (let i = 0; i < rounds; i++) {
            if (document.fonts && document.fonts.ready) { await document.fonts.ready; }
            await frame();
            await frame();
            running = document.getAnimations().filter((a) => a instanceof CSSTransition && !isTick(a));
            const fontsBusy = document.fonts && document.fonts.status === 'loading';
            if (!running.length && !fontsBusy) { return null; }
            await Promise.all(running.map((a) => a.finished.catch(() => {})));
        }
        return running.map(describe).join(', ') || 'шрифты ещё грузятся';
    }, [opts.rounds ?? 6, TICK_TRANSITIONS]);
    if (left) {
        console.warn(`[waitForQuiet] окно не утихло за ${opts.rounds ?? 6} кругов, ещё едет: ${left}`);
    }
}

/** Переходы, которые заводит каждый тик таймера: [селектор, свойство]. */
const TICK_TRANSITIONS = [['*', 'stroke-dashoffset'], ['.display-progress-fill', 'width']];

/**
 * Взвести приёмник посылок канала в окне — ДО действия, которое их вызовет.
 * Возвращает функцию «дождаться»: пришла посылка, НЕСУЩАЯ ожидаемое
 * состояние, обработчик окна её отработал, окно утихло (`waitForQuiet`).
 *
 * Почему это условие, а не ставка. Слушатель ставится через тот же мост
 * (`window.ipcRenderer.on`), что и слушатель приложения, на тот же
 * EventEmitter `ipcRenderer` в preload; приложение подписалось при загрузке,
 * значит раньше, а слушатели одного события вызываются в порядке подписки.
 * Наша запись появляется строго ПОСЛЕ синхронного обработчика приложения.
 *
 * Почему НЕ «первая посылка после взвода» (ревью B3, I1). Действие теста
 * возвращается сразу после `send`, а посылка идёт панель → main → окно;
 * взвод же — отдельный вызов по CDP. Посылка ПРЕДЫДУЩЕГО действия может
 * быть ещё в пути и прийти после взвода — её payload собран без последнего
 * действия. Поэтому ожидание узнаёт СВОЮ посылку:
 *  - `match` — поля, которые обязана нести посылка (сравнение по значению;
 *    `null` — «поля нет или оно null»). Посылку-примитив (строку, число)
 *    `match`-примитив сравнивает целиком. Настройки — полный снимок, поэтому
 *    посылка, несущая все ожидаемые поля, и даёт окну нужное состояние, даже
 *    если она чужая. Может быть функцией (выполняется ПОСЛЕ действия), когда
 *    ожидаемое значение видно только после него — например hex пипетки;
 *  - `count` — сколько посылок обязано прийти (для действий, чьи посылки
 *    неотличимы по содержимому: взвести ДО первого и ждать N-ю).
 * Без обоих — первая посылка после взвода; так можно, только когда у
 * действия посылка одна, а предыдущая уже дождана.
 *
 * Приёмник снимается и при успехе, и по таймауту.
 *
 * @param {import('@playwright/test').Page} page — окно-ПОЛУЧАТЕЛЬ
 * @param {string} channel — канал, открытый мостом этого окна на приём
 * @returns {Promise<(opts?: ReceiveOpts) => Promise<any>>} ожидание; отдаёт payload
 *
 * @typedef {{timeout?: number, match?: object|(() => Promise<object>|object), count?: number}} ReceiveOpts
 */
async function armReceived(page, channel) {
    const key = `${channel}#${Date.now()}#${Math.random()}`;
    await page.evaluate(([ch, k]) => {
        const box = (window.__e2eReceived = window.__e2eReceived || {});
        const rec = { list: [], listener: null, channel: ch };
        rec.listener = (_e, payload) => { rec.list.push(payload === undefined ? null : payload); };
        window.ipcRenderer.on(ch, rec.listener);
        box[k] = rec;
    }, [channel, key]);
    const release = () => page.evaluate((k) => {
        const rec = window.__e2eReceived && window.__e2eReceived[k];
        if (!rec) { return; }
        window.ipcRenderer.removeListener(rec.channel, rec.listener);
        delete window.__e2eReceived[k];
    }, key).catch(() => {});
    return async (opts = {}) => {
        const match = typeof opts.match === 'function' ? await opts.match() : (opts.match || null);
        const count = opts.count || 1;
        let handle;
        try {
            handle = await page.waitForFunction(([k, m, n]) => {
                const rec = window.__e2eReceived[k];
                // Посылка-примитив (`set-clock-style` несёт строку) — сравнение
                // целиком; посылка-объект — по полям.
                const fits = (p) => !m || (typeof m !== 'object'
                    ? JSON.stringify(p) === JSON.stringify(m)
                    : !!p && typeof p === 'object' && Object.keys(m).every((f) => (m[f] === null
                    ? p[f] === null || p[f] === undefined
                    : JSON.stringify(p[f]) === JSON.stringify(m[f]))));
                if (rec.list.length < n) { return false; }
                const hit = rec.list.slice(n - 1).find(fits);
                return hit === undefined ? false : { payload: hit };
            }, [key, match, count], { timeout: opts.timeout ?? DEFAULT_TIMEOUT });
        } catch (err) {
            // Что пришло на самом деле — по тем же полям, что ждали.
            const seen = await page.evaluate(([k, m]) => {
                const rec = window.__e2eReceived && window.__e2eReceived[k];
                if (!rec) { return { n: -1, last: null }; }
                const p = rec.list[rec.list.length - 1];
                const last = p && m && typeof p === 'object'
                    ? Object.fromEntries(Object.keys(m).map((f) => [f, p[f] === undefined ? null : p[f]]))
                    : null;
                return { n: rec.list.length, last };
            }, [key, match]).catch(() => ({ n: -1, last: null }));
            await release();
            const want = match ? ` с ${JSON.stringify(match)}` : '';
            const last = seen.last ? `; последняя: ${JSON.stringify(seen.last)}` : '';
            throw new Error(`окно не получило «${channel}»${want} (нужно ${count}, пришло ${seen.n}${last}): ${err.message}`,
                { cause: err });
        }
        const got = await handle.jsonValue();
        await release();
        await waitForQuiet(page);
        return got.payload;
    };
}

/**
 * Выполнить действие и дождаться, что окно-получатель ПОЛУЧИЛО вызванную им
 * посылку канала и утихло. Обёртка над `armReceived`: взвести → действие →
 * дождаться. Действие обязано породить посылку, иначе ожидание упадёт по
 * таймауту с именем канала и ожидаемыми полями.
 *
 * @param {import('@playwright/test').Page} page — окно-ПОЛУЧАТЕЛЬ
 * @param {string} channel
 * @param {() => Promise<any>} action
 * @param {ReceiveOpts} [opts] — см. `armReceived`
 * @returns {Promise<any>} payload посылки
 */
async function untilReceived(page, channel, action, opts = {}) {
    const received = await armReceived(page, channel);
    await action();
    return received(opts);
}

/**
 * Круг панель → main → панель: всё, что панель ОТПРАВИЛА до вызова, главный
 * процесс обработал, и всё, что он в ответ прислал панели (`timer-state`
 * команд), панель уже отработала.
 *
 * Для команд таймера (ревью B4, M5): прежнее «ждать значение, которого не было
 * до последней команды» зависело от того, что оставил ПРЕДЫДУЩИЙ тест. Здесь
 * независимый от соседей признак: панель шлёт `get-displays`, на который main
 * отвечает `displays-list` — и ТОЛЬКО ответом (main-window-ipc.js; сам он этот
 * канал не рассылает, так что чужой ответ в пути — лишь от чужого
 * `get-displays`, а стартовый давно дошёл). Посылки одного окна main
 * обрабатывает по порядку, `timer-command` рассылает состояние синхронно в
 * своём обработчике, а посылки main → панель идут по одной трубе в порядке
 * отправки. Значит, ответ приходит ПОСЛЕ состояния последней команды.
 *
 * Ответы `displays-list` неотличимы, поэтому круг верен, только пока в пути
 * нет ЧУЖОГО `get-displays`. Стартовый (setupIPC, при каждой загрузке
 * панели) исключён условием: `launchApp` и `reloadPanel` ждут его ИТОГ в
 * `waitForStartupPush` (ревью B5, M1). Вызов с `awaitStartup: false` этой
 * гарантии не имеет — первый круг там может закрыть стартовый ответ.
 *
 * @param {import('@playwright/test').Page} control — окно панели
 * @param {{timeout?: number}} [opts]
 */
async function panelRoundTrip(control, opts = {}) {
    await untilReceived(control, 'displays-list',
        () => control.evaluate(() => window.ipcRenderer.send('get-displays')), opts);
}

/**
 * Отсчёт дошёл до `to` (панель показала `remaining ≤ to`), и всё, что main
 * разослал до этой точки (`timer-state`, звуковые события, накопитель
 * перелимита), панель отработала (`panelRoundTrip`).
 *
 * Замена паузы «подождать N секунд, пока таймер идёт»: отрезок меряется
 * таймером приложения, а не часами машины, и на медленной машине не
 * становится короче.
 *
 * @param {import('@playwright/test').Page} control
 * @param {number} to — секунды на табло (в минусе — отрицательные)
 * @param {{timeout?: number}} [opts]
 */
async function waitForPanelRemaining(control, to, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    await control.waitForFunction((t) => window.timerController
        && window.timerController.remainingSeconds <= t, to, { timeout })
        .catch(async (err) => {
            const now = await control.evaluate(() => window.timerController.remainingSeconds).catch(() => '?');
            throw new Error(`таймер не дошёл до ${to} за ${timeout} мс (на табло ${now}): ${err.message}`, { cause: err });
        });
    await panelRoundTrip(control, { timeout });
}

/**
 * Окно панели получило размер, который ему дал main, и утихло.
 *
 * Размер панели меняет main — по её же запросу (`resize-control-window` из
 * ящика, полосы, автоподгонки) или сам (`setBounds` из спеки). Условие точное,
 * а не «перестало меняться»:
 *  1. круг панель → main → панель (`panelRoundTrip`): всё, что панель успела
 *     попросить, main уже применил — его обработчики синхронны;
 *  2. `innerWidth/innerHeight` страницы = `getContentSize()` окна в main —
 *     размер дошёл до страницы;
 *  3. кадр (прямые обработчики `resize` отработали, см. waitForResizeHandled)
 *     и `waitForQuiet` — переходы раскладки доехали.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} control
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<{w: number, h: number}>} размер страницы
 */
async function waitForPanelSized(app, control, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    await panelRoundTrip(control, { timeout });
    const deadline = Date.now() + timeout;
    let main;
    let page;
    for (;;) {
        main = await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()
                .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('electron-control.html'));
            if (!win) { return null; }
            const [w, h] = win.getContentSize();
            return { w, h };
        });
        page = await control.evaluate(innerSize);
        // ≤ 1 px, а не равенство (ревью B5, M2): на дробном масштабе Windows
        // (125/150 %) CSS-размер страницы и DIP-размер окна расходятся на
        // пиксель округления — точное равенство ждало бы до таймаута на
        // исправном приложении. Допуск — только в УСЛОВИИ ожидания;
        // утверждения спек меряют выданное сами.
        if (main && Math.abs(main.w - page.w) <= 1 && Math.abs(main.h - page.h) <= 1) { break; }
        if (Date.now() > deadline) {
            throw new Error(`размер панели не дошёл до страницы за ${timeout} мс: main ${JSON.stringify(main)}, страница ${JSON.stringify(page)}`);
        }
        // шаг опроса: размер main дошёл до страницы
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    await control.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await waitForQuiet(control);
    return page;
}

/**
 * Дождаться, что `read` вернул одно и то же `frames` КАДРОВ подряд.
 *
 * Для того, что пересчитывается по кадрам, а не по таймеру: ступени
 * компактного режима панели (panel-compact.js) — ResizeObserver → rAF →
 * смена класса на `<body>` → снова ResizeObserver. Каскад из нескольких
 * ступеней длиннее двух кадров `waitForQuiet`, а `waitForSteady` с шагом
 * 150 мс мерил бы часы, а не кадры. Между замерами — кадр страницы.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Function} read — выполняется В ОКНЕ, возвращает сериализуемое значение
 * @param {{frames?: number, timeout?: number, name?: string}} [opts]
 * @returns {Promise<any>} осевшее значение
 */
async function waitForFrameSteady(page, read, opts = {}) {
    const frames = opts.frames ?? 4;
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const deadline = Date.now() + timeout;
    let last;
    let same = 0;
    for (;;) {
        const value = await page.evaluate(read);
        const key = JSON.stringify(value);
        same = key === last ? same + 1 : 1;
        last = key;
        if (same >= frames) { return value; }
        if (Date.now() > deadline) {
            throw new Error(`${opts.name || 'величина'} не осела за ${timeout} мс; последнее: ${key}`);
        }
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    }
}

/** Что пересчитывает раскладка панели по кадрам: ступени компакта, коробка, колонка ящика. */
function panelLayoutState() {
    const panel = document.querySelector('.control-panel');
    const shell = document.querySelector('.app-shell');
    return {
        body: document.body.className,
        shell: shell ? shell.className : null,
        scroll: panel ? panel.scrollHeight : null,
        client: panel ? panel.clientHeight : null,
        column: shell ? getComputedStyle(shell).getPropertyValue('--control-panel-width').trim() : null
    };
}

/**
 * Панель ВСТАЛА после смены размера окна или содержимого: размер дошёл
 * (`waitForPanelSized`); при открытом ящике колонка пересчитана по
 * ФАКТИЧЕСКОЙ ширине окна; ступени компактного режима отработали
 * (`waitForFrameSteady`), окно утихло.
 *
 * Колонка — отдельное условие: если окно упёрлось в потолок, resize не
 * придёт, и колонку пересчитывает сторож по времени (control-app.js,
 * settleColumn, 400 мс). Ждём его ИТОГ — `columnFromWindow(innerWidth)`, ту же
 * функцию, что зовёт панель, — а не его срок.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} control
 * @param {{timeout?: number}} [opts]
 */
async function waitForPanelSettled(app, control, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    await waitForPanelSized(app, control, { timeout });
    const drawer = await control.evaluate(() => {
        const el = document.querySelector('.settings-drawer');
        return el && el.classList.contains('open')
            ? { inner: window.innerWidth, extra: window.timerController._drawerExtraWidth }
            : null;
    });
    // Что видно сейчас — для сообщения при таймауте (ревью B5, M5): числа, а
    // не голое «waitForFunction: Timeout».
    const actual = () => control.evaluate(() => {
        const shell = document.querySelector('.app-shell');
        return {
            inner: window.innerWidth,
            column: shell ? getComputedStyle(shell).getPropertyValue('--control-panel-width').trim() : null,
            shellDrawerOpen: !!shell && shell.classList.contains('drawer-open'),
            drawerOpen: !!document.querySelector('.settings-drawer.open')
        };
    }).catch(() => '?');
    if (drawer) {
        const { columnFromWindow } = require('../panel-drawer.js');
        const want = `${columnFromWindow(drawer.inner, drawer.extra)}px`;
        await control.waitForFunction((w) => {
            const shell = document.querySelector('.app-shell');
            const col = shell && getComputedStyle(shell).getPropertyValue('--control-panel-width').trim();
            return col === w;
        }, want, { timeout }).catch(async (err) => {
            throw new Error(`колонка панели при открытом ящике не стала ${want} `
                + `(columnFromWindow(${drawer.inner}, ${drawer.extra})) за ${timeout} мс: `
                + `сейчас ${JSON.stringify(await actual())}`, { cause: err });
        });
    } else {
        // Ящик закрыт — ждём ИТОГ finishClose (control-app.js): `.app-shell`
        // теряет `drawer-open`, колонку и резерв не раньше 260 мс от закрытия,
        // а если окно не вернулось к прежней ширине — через 700 мс (ревью B5,
        // I1). Без этого «встала» могло вернуться, пока панель ещё в раскладке
        // ящика: при reduced-motion переходов нет, и тишина наступает сразу.
        await control.waitForFunction(() => {
            const shell = document.querySelector('.app-shell');
            return !shell || !shell.classList.contains('drawer-open');
        }, null, { timeout }).catch(async (err) => {
            throw new Error(`после закрытия ящика .app-shell не снял drawer-open за ${timeout} мс: `
                + `сейчас ${JSON.stringify(await actual())}`, { cause: err });
        });
    }
    await waitForFrameSteady(control, panelLayoutState, { timeout, name: 'раскладка панели' });
    await waitForPanelSized(app, control, { timeout });
}

/**
 * Ящик настроек встал КОЛОНКОЙ рядом с главной, а не накладкой поверх неё:
 * окно панели выросло хотя бы до суммы минимумов (панель
 * `CONFIG.CONTROL_WINDOW_MIN_WIDTH` + ящик `_drawerExtraWidth`, порог
 * `@media (max-width: 715px)` в control.css), затем панель осела
 * (`waitForPanelSettled`).
 *
 * Ждать нужно ФАКТ, а не срок: ящик просит окно шире (`resize-control-window`),
 * и система вправе не выдать (диагноз CI 30.10.2026: на macOS ящик, открытый
 * посреди входа дисплея в полноэкранный режим, оставил окно 400 px, и клик в
 * главную колонку 30 с перехватывала накладка). Не выросло — падаем сразу с
 * числами: окно, просьба, экран, состояние дисплея.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} control
 * @param {{timeout?: number}} [opts]
 */
async function waitForDrawerBeside(app, control, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const ok = await control.waitForFunction((min) => {
        const drawer = document.querySelector('.settings-drawer');
        const extra = window.timerController._drawerExtraWidth;
        return !!drawer && drawer.classList.contains('open') && window.innerWidth >= min + extra;
    }, CONFIG.CONTROL_WINDOW_MIN_WIDTH, { timeout }).then(() => true, () => false);
    if (!ok) {
        const page = await control.evaluate(() => ({
            inner: window.innerWidth,
            asked: window.timerController._baseWidthBeforeDrawer + window.timerController._drawerExtraWidth,
            availWidth: window.screen.availWidth,
            open: !!document.querySelector('.settings-drawer.open')
        }));
        const main = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
            .filter((w) => !w.isDestroyed())
            .map((w) => ({
                url: w.webContents.getURL().replace(/^.*\//, ''),
                bounds: w.getBounds(), max: w.getMaximumSize(),
                fullScreen: w.isFullScreen(), focused: w.isFocused()
            })));
        throw new Error(`ящик не встал колонкой за ${timeout} мс: окно панели ${page.inner} px, `
            + `нужно ≥ ${CONFIG.CONTROL_WINDOW_MIN_WIDTH} + ящик, ящик просил ${page.asked}, `
            + `экран ${page.availWidth}, ящик открыт ${page.open}; окна: ${JSON.stringify(main)}`);
    }
    await waitForPanelSettled(app, control, { timeout });
}

/**
 * Канал-метка для каждого окна: посылка, которую main шлёт окну и сам, а
 * обработчик окна только запоминает (флаг «открыто ли соседнее окно»). Метка
 * несёт НАСТОЯЩЕЕ состояние соседа, так что для окна это не новость.
 *
 * «Настоящее» — в смысле приложения, а не адреса (ревью B3, N1). Main считает
 * соседа открытым по реестру (`!!windows.clockWidgetWindow`,
 * main-window-hooks.js, sendWindowStatesTo): слот занят с `new BrowserWindow`
 * и пуст после `closed`. У только что созданного окна `getURL()` ещё пуст
 * (замер 31.10.2026: часы сразу после `open-clock-widget` — `url: ""`,
 * `isLoading: true`), и подсчёт «по адресу» сказал бы «закрыто», затерев
 * верное `isOpen: true` от `announceWindowOpened`. Поэтому метка не уходит,
 * пока в приложении есть окно без адреса: когда адреса у всех, «живое окно с
 * адресом соседа» и «слот реестра занят» совпадают (`closed` = `isDestroyed`).
 */
const SNAPSHOT_MARK = {
    'display.html': { channel: 'clock-window-state', neighbour: 'electron-clock-widget.html' },
    'electron-widget.html': { channel: 'clock-window-state', neighbour: 'electron-clock-widget.html' },
    'electron-clock-widget.html': { channel: 'widget-window-state', neighbour: 'electron-widget.html' }
};

/**
 * Окно ПОЛУЧИЛО снимок главного процесса (`announceWindowOpened` шлёт его на
 * `did-finish-load`): состояние таймера, накопитель, настройки, цвета, тему.
 *
 * `load` в окне этого не доказывает: `did-finish-load` в главном процессе
 * приходит ПОСЛЕ `load` рендерера. Два шага:
 *
 * 1. главный процесс видит `!webContents.isLoading()` у ВСЕХ окон с этим
 *    адресом — `did-stop-loading` идёт после `did-finish-load`, значит
 *    слушатель снимка отработал и его посылки ушли;
 * 2. СРАЗУ ЖЕ, в том же вызове main, окну уходит метка (`SNAPSHOT_MARK`) с
 *    уникальным полем `e2eMarker`, и окно ждёт ИМЕННО её. Посылки main → окно
 *    идут по одной трубе в порядке отправки, так что метка обработана после
 *    снимка.
 *
 * Прежде (B3, B4) шагом 2 была повторная посылка панели и ожидание «первой
 * посылки канала после взвода». Ревью B3 (I1) показало дыру: посылка,
 * отправленная main ДО снимка, могла прийти после взвода и сойти за нашу. У
 * метки уникальное содержимое — перепутать её не с чем. И окно выбирается не
 * первым по адресу (ревью B3, M4): метку получают все окна с этим адресом,
 * ждёт её только `page`, так что закрывающееся соседнее окно ничего не решает.
 *
 * СНИМОК ЭТО НЕ ДОКАЗЫВАЕТ (ревью B4, M1). Помощник — ожидание, а не проверка:
 * он знает только, что снимок УШЁЛ раньше метки, и ничего — о том, что в нём
 * было. Больше того, сам он шлёт окну посылку, которую в жизни шлёт main:
 * флаг соседа (`*-window-state`) после него — значение МЕТКИ, а не снимка, а
 * до 8d70a3d шаг 2 и вовсе заново рассылал стили панели. Регрессия «main
 * перестал класть X в снимок» в спеке на этом помощнике останется зелёной
 * всякий раз, когда X приносит потом что-то ещё. Поэтому спеки, которые
 * утверждают сам снимок при загрузке (`window-state-sync`, `relay-persist`),
 * его не используют — это держит tests/e2e-fixtures.test.js.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} page
 * @param {string} urlPart — ключ `SNAPSHOT_MARK`
 * @param {string} name — для сообщения об ошибке
 * @param {{timeout?: number}} [opts]
 */
async function waitForMainSnapshot(app, page, urlPart, name, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const mark = SNAPSHOT_MARK[urlPart];
    await page.waitForLoadState('load');
    const marker = `e2e-${Date.now()}-${Math.random()}`;
    const received = await armReceived(page, mark.channel);
    const deadline = Date.now() + timeout;
    for (;;) {
        const sent = await app.evaluate(({ BrowserWindow }, [part, m, mk]) => {
            const live = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
            const own = live.filter((w) => w.webContents.getURL().includes(part));
            if (!own.length || own.some((w) => w.webContents.isLoading())) { return false; }
            // Окно без адреса — сосед, которого реестр main уже считает
            // открытым, а адрес ещё нет (см. SNAPSHOT_MARK). Ждём адреса.
            if (live.some((w) => !w.webContents.getURL())) { return false; }
            const isOpen = live.some((w) => w.webContents.getURL().includes(m.neighbour));
            for (const w of own) { w.webContents.send(m.channel, { isOpen, e2eMarker: mk }); }
            return true;
        }, [urlPart, mark, marker]);
        if (sent) { break; }
        if (Date.now() > deadline) {
            await received({ timeout: 1 }).catch(() => {});
            throw new Error(`окно ${name} не закончило загрузку за ${timeout} мс (или у соседнего окна так и не появился адрес)`);
        }
        // шаг опроса: окно загружено, метка снимка отправлена
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    await received({ match: { e2eMarker: marker }, timeout: Math.max(1000, deadline - Date.now()) });
    return page;
}

/**
 * Всё, что панель ПОСЛАЛА до вызова, дошло до окон `pages` и отработано.
 *
 * Для действий панели, которые расходятся сразу по нескольким окнам (стили
 * трёх окон одним проходом, сброс профиля в `finally`), где ждать посылку
 * каждого окна по `match` нельзя: что именно и куда уйдёт, решает панель
 * (синхронизация стиля часов, повторный клик по выбранному варианту).
 *
 * Два звена, оба — порядок одной трубы:
 * 1. `panelRoundTrip`: main обработал всё посланное панелью; пересылка окну
 *    идёт синхронно в обработчике main, значит, она уже в трубе main → окно;
 * 2. метка main окну (`waitForMainSnapshot`): посылки main → окно приходят в
 *    порядке отправки, метка — после пересылок. Ожидание метки включает
 *    `waitForQuiet` (переходы, шрифты).
 *
 * Не годится для отложенных посылок ПАНЕЛИ (debounce `input` цветов фона):
 * их на момент вызова ещё нет в трубе. Метка — флаг соседа на канале
 * `*-window-state` с НАСТОЯЩИМ значением (см. SNAPSHOT_MARK); спеки, которые
 * утверждают снимок при загрузке, барьер не зовут (tests/e2e-fixtures.test.js).
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} control
 * @param {import('@playwright/test').Page[]} pages — окна виджета, часов, дисплея
 * @param {{timeout?: number}} [opts]
 */
async function relayBarrier(app, control, pages, opts = {}) {
    await panelRoundTrip(control, opts);
    for (const page of pages) {
        const urlPart = Object.keys(SNAPSHOT_MARK).find((u) => page.url().includes(u));
        if (!urlPart) { throw new Error(`relayBarrier: окно ${page.url()} не виджет, не часы и не дисплей`); }
        await waitForMainSnapshot(app, page, urlPart, urlPart, opts);
    }
}

/**
 * Поставить стиль открытым окнам ПРЯМЫМИ посылками панели (как спеки делали
 * всегда: `widget-style-update`, `clock-widget-set-style`,
 * `display-settings-update` с одним `timerStyle`) и дождаться, что каждое окно
 * ПОЛУЧИЛО свой стиль, а виджет и часы под новый стиль ВСТАЛИ (размер окна
 * зависит от стиля). Спеки ждали это паузой 1200–2000 мс.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} control
 * @param {{widget?: import('@playwright/test').Page, clock?: import('@playwright/test').Page, display?: import('@playwright/test').Page}} pages
 * @param {string} style
 * @param {{displayField?: string}} [opts] displayField — поле стиля в посылке
 *        дисплею (`timerStyle` по умолчанию; `displayTimerStyle` — своё имя
 *        дисплея, его панель шлёт рядом с общим)
 */
async function setWindowStyles(app, control, pages, style, opts = {}) {
    const field = opts.displayField || 'timerStyle';
    const waits = [];
    if (pages.widget) { waits.push([await armReceived(pages.widget, 'widget-style-update'), { timerStyle: style }]); }
    if (pages.clock) { waits.push([await armReceived(pages.clock, 'set-clock-style'), style]); }
    if (pages.display) { waits.push([await armReceived(pages.display, 'display-settings-update'), { [field]: style }]); }
    await control.evaluate(([st, f, w, c, d]) => {
        if (w) { window.ipcRenderer.send('widget-style-update', { timerStyle: st }); }
        if (c) { window.ipcRenderer.send('clock-widget-set-style', st); }
        if (d) { window.ipcRenderer.send('display-settings-update', { [f]: st }); }
    }, [style, field, !!pages.widget, !!pages.clock, !!pages.display]);
    for (const [received, match] of waits) { await received({ match }); }
    if (pages.widget) {
        await waitForWindowSettled(app, pages.widget, 'electron-widget.html');
        await waitForQuiet(pages.widget);
    }
    if (pages.clock) {
        await waitForWindowSettled(app, pages.clock, 'electron-clock-widget.html');
        await waitForQuiet(pages.clock);
    }
}

/** Дисплей получил снимок main. `_control` — прежняя сигнатура (шаг 2 был через панель). */
function waitForDisplaySnapshot(app, display, _control, opts = {}) {
    return waitForMainSnapshot(app, display, 'display.html', 'дисплея', opts);
}

/** Виджет получил снимок main. */
function waitForWidgetSnapshot(app, widget, _control, opts = {}) {
    return waitForMainSnapshot(app, widget, 'electron-widget.html', 'виджета', opts);
}

/** Часы получили снимок main. */
function waitForClockSnapshot(app, clock, _control, opts = {}) {
    return waitForMainSnapshot(app, clock, 'electron-clock-widget.html', 'часов', opts);
}

/**
 * Заказанный при создании полноэкранный режим дисплея — УСЛОВИЕ состояния, а
 * не срок (ревью B3, I2). Решает главный процесс по самому новому окну
 * дисплея (id у webContents растёт с созданием — тот же выбор, что ревью B3,
 * M4). Опора — журнал входов `globalThis.__e2eEnteredDisplays`: `launchApp`
 * вешает `enter-full-screen` на КАЖДОЕ окно с момента создания
 * (`browser-window-created`), поэтому событие не теряется, даже если вход
 * закончился раньше, чем спросили (ревью CI-правки, R1).
 *
 *  - `full` — вход ОКОНЧЕН: флаг поднят и событие в журнале (или флаг поднят
 *    не на macOS — там перехода нет, см. ниже);
 *  - `entered` — флаг поднят, а события ещё не было: на macOS
 *    `isFullScreen()` смотрит на `NSWindowStyleMaskFullScreen`, а маска
 *    ставится в НАЧАЛЕ анимированного перехода. Ждём событие до `timeout`
 *    (`timeout` — расхождение, печатает вызывающий). Раньше «флаг поднят»
 *    считался концом, и ящик, открытый следом, мог попасть в переход;
 *  - `windowed` — из полноэкранного его вывели мы сами (`leaveFullScreen`)
 *    или он вошёл и вышел сам (событие в журнале, флага нет): входа больше не
 *    будет;
 *  - `no-transition` — не macOS, флага нет: ждать нечего, 0 мс. Довод не в
 *    том, что «вход синхронный» (ревью CI-правки, R2): на Linux вход идёт
 *    через оконный менеджер асинхронно, а на Windows флага нет вовсе. Довод —
 *    эмпирика CI и природа краша:
 *      · Windows (run 41126739982): у всех 19 открытий окно в фокусе, флага и
 *        события нет ни за 1.5 с — Electron там фактически оконный, перехода
 *        не будет, ожидание стоило бы таймаута на КАЖДОЕ открытие;
 *      · Linux CI: флаг поднят уже к `load` (строк «не включился» ноль);
 *      · краш `setBounds` посреди перехода (стек `_doSucceededToExitFullScreen`)
 *        — класс AppKit, только macOS;
 *  - `no-focus` — macOS, окно без фокуса и флага: вход не начнётся, ждать
 *    нечего (0 мс). Опыт 31.10.2026 на локальном mac: `CGSSessionScreenIsLocked
 *    = true`, ни у одного окна нет фокуса — ни после `win.focus()`, ни после
 *    `app.focus({ steal: true })`, — и входа нет все 8 с наблюдения даже
 *    после явного `setFullScreen(true)`. На macOS CI окно дисплея в фокусе и
 *    полноэкранное (before-close-main.json, 30.10.2026). Поздний вход после
 *    фокуса ловит `leaveFullScreen` перед каждым `setBounds`;
 *  - macOS, окно в фокусе, флага нет — ждём СОБЫТИЕ `enter-full-screen` до
 *    `timeout`: `entered` или `timeout`.
 *
 * Журнала нет (окно открыто не через `launchApp`) — прежнее поведение:
 * поднятый флаг считается концом.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {number} timeout
 * @returns {Promise<{state: string, focused?: boolean, bounds?: object}>}
 */
function settleFullScreenEntry(app, timeout) {
    return app.evaluate(async ({ BrowserWindow }, ms) => {
        const win = BrowserWindow.getAllWindows()
            .filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('display.html'))
            .sort((a, b) => b.webContents.id - a.webContents.id)[0];
        if (!win) { return { state: 'нет окна' }; }
        const id = win.webContents.id;
        const info = () => ({ focused: win.isFocused(), bounds: win.getBounds() });
        const journal = globalThis.__e2eEnteredDisplays;
        const entered = !!journal && journal.has(id);
        const waitEnter = () => new Promise((resolve) => {
            const onEnter = () => { clearTimeout(timer); resolve('entered'); };
            const timer = setTimeout(() => { win.removeListener('enter-full-screen', onEnter); resolve('timeout'); }, ms);
            win.once('enter-full-screen', onEnter);
        });
        if (win.isFullScreen()) {
            if (!journal || entered || process.platform !== 'darwin') { return { state: 'full' }; }
            // Флаг поднят в начале перехода — ждём его конец.
            return { state: await waitEnter(), ...info() };
        }
        const windowed = globalThis.__e2eWindowedDisplays;
        if ((windowed && windowed.has(id)) || entered) { return { state: 'windowed' }; }
        if (process.platform !== 'darwin') { return { state: 'no-transition', ...info() }; }
        if (!win.isFocused()) { return { state: 'no-focus', ...info() }; }
        return { state: await waitEnter(), ...info() };
    }, timeout);
}

/** Строка в лог, если полноэкранный режим не включился: где и почему. */
function reportFullScreenEntry(who, fs, timeout) {
    if (fs.state === 'full' || fs.state === 'entered' || fs.state === 'windowed') { return; }
    const why = fs.state === 'no-focus'
        ? 'окно без фокуса — вход не начнётся, не ждём'
        : fs.state === 'no-transition'
            ? `${process.platform}: флага нет, перехода AppKit нет — входа не будет, не ждём`
        : fs.state === 'timeout'
            ? `окно в фокусе, но события нет за ${timeout} мс — РАСХОЖДЕНИЕ`
            : fs.state;
    console.log(`   [${who}] полноэкранный режим не включился: ${why} `
        + `(фокус ${fs.focused}; границы ${JSON.stringify(fs.bounds)}) — окно мерится оконным`);
}

/**
 * Дождаться, что открывшийся дисплей ВСТАЛ: полноэкранный режим включился
 * (или по состоянию окна включиться не может — `settleFullScreenEntry`),
 * размер окна осел, отложенный пересчёт по последнему `resize` отработал,
 * окно утихло.
 *
 * Спеки ждали это паузой 2200–2400 мс, затем (B3) льготой 1.5 с на событие —
 * на машине без фокуса это была та же пауза. Окно создаётся с
 * `fullscreen: true`, и на macOS вход анимирован около секунды; `setBounds`
 * посреди перехода роняет Electron
 * (разбор a-fullscreen-transition-is-a-condition-not-a-duration).
 *
 * Затем — осевший `innerSize` (4×150 мс), кадр и таймер длины debounce,
 * взведённый после таймера приложения (как в `waitForResizeHandled`).
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} display
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<import('@playwright/test').Page>} то же окно
 */
async function waitForDisplaySettled(app, display, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    await display.waitForLoadState('load');
    reportFullScreenEntry('waitForDisplaySettled', await settleFullScreenEntry(app, timeout), timeout);
    await waitForSteady(display, innerSize, { samples: 4, timeout, name: 'размер дисплея' });
    // Таймер длины debounce, взведённый ПОСЛЕ таймера приложения, — см.
    // waitForResizeHandled, п. 3.
    await display.evaluate(async (ms) => {
        await new Promise((r) => requestAnimationFrame(() => r()));
        // пауза законна: таймер той же длины, что debounce приложения, взведён
        // после него (waitForResizeHandled, п. 3)
        await new Promise((r) => setTimeout(r, ms));
    }, CONFIG.RESIZE_DEBOUNCE);
    await waitForQuiet(display);
    return display;
}

/**
 * id (`webContents.id`) самого нового живого окна с адресом `urlPart` в
 * главном процессе, или null.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {string} urlPart
 * @returns {Promise<number|null>}
 */
function newestWindowId(app, urlPart) {
    return app.evaluate(({ BrowserWindow }, part) => {
        const ids = BrowserWindow.getAllWindows()
            .filter((w) => !w.isDestroyed() && w.webContents.getURL().includes(part))
            .map((w) => w.webContents.id);
        return ids.length ? Math.max(...ids) : null;
    }, urlPart);
}

/**
 * Окно с этим id в главном процессе РАЗРУШЕНО (закрытие доведено до конца,
 * включая выход из полноэкранного режима). Для гонок «закрыть и сразу
 * открыть», где Playwright-страница старого окна ещё отвечает на пробу, а
 * вопрос — что останется ПОСЛЕ закрытия (window-reopen-race).
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {number} id
 * @param {{timeout?: number, name?: string}} [opts]
 */
async function waitForMainWindowGone(app, id, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const deadline = Date.now() + timeout;
    for (;;) {
        const alive = await app.evaluate(({ BrowserWindow }, wid) => BrowserWindow.getAllWindows()
            .some((w) => !w.isDestroyed() && w.webContents.id === wid), id);
        if (!alive) { return; }
        if (Date.now() > deadline) {
            throw new Error(`${opts.name || 'окно'} (id ${id}) не закрылось в main за ${timeout} мс`);
        }
        // шаг опроса: окно разрушено в main
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
}

/**
 * Границы окна по адресу — как их видит ГЛАВНЫЙ процесс (владелец геометрии
 * виджета и часов), или null, если такого живого окна нет.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {string} urlPart — часть адреса страницы окна
 * @returns {Promise<{x: number, y: number, width: number, height: number}|null>}
 */
function mainBoundsOf(app, urlPart) {
    return app.evaluate(({ BrowserWindow }, part) => {
        // Самое новое окно по id (ревью B6, M2; тот же выбор, что ревью B3,
        // M4): после переоткрытия прежнее окно может ещё не быть
        // `isDestroyed()` и стоять в списке первым — его границы сошли бы за
        // границы нового.
        const win = BrowserWindow.getAllWindows()
            .filter((w) => !w.isDestroyed() && w.webContents.getURL().includes(part))
            .sort((a, b) => b.webContents.id - a.webContents.id)[0];
        return win ? win.getBounds() : null;
    }, urlPart);
}

/**
 * Границы окна в main ОСЕЛИ: на открытии виджет и часы сами доезжают —
 * восстановление геометрии шлёт размер и позицию (`restore()`), система
 * вправе поправить следом.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {string} urlPart
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<{x: number, y: number, width: number, height: number}>}
 */
function waitForBoundsSettled(app, urlPart, opts = {}) {
    // waitForSteady зовёт `evaluate(read)`; читатель исполняется в main, а не в
    // странице, поэтому подставляется объект с готовым `evaluate`. Окна нет —
    // это не «осело» (ревью B6, M2): null подменяется уникальным значением,
    // которое не повторится ни разу подряд, и ожидание кончится ошибкой с
    // именем окна, а не тихим null.
    let miss = 0;
    return waitForSteady({
        evaluate: async () => (await mainBoundsOf(app, urlPart)) || { missing: ++miss }
    }, null, { timeout: opts.timeout ?? DEFAULT_TIMEOUT, name: `границы ${urlPart} (окно есть?)` });
}

/**
 * Виджет или часы ВСТАЛИ: страница загружена, границы в main осели
 * (`waitForBoundsSettled`), и отложенная запись геометрии по последнему
 * `resize` окна (`saveSettled`, window-geometry.js, `SAVE_SETTLE_MS`)
 * отработала.
 *
 * Спеки ждали это паузой 800–1600 мс. Запись важна в обе стороны: тест,
 * кладущий свою геометрию в хранилище, проиграл бы опоздавшей записи окна, а
 * тест «пережило переоткрытие» закрыл бы окно раньше, чем оно записало.
 * Последнее — таймер той же длины, взведённый ПОСЛЕ таймера окна (см.
 * waitForResizeHandled, п. 3): `resize` страница получает раньше, чем main
 * перестаёт менять границы, а осевшими они считаются не раньше чем через
 * 300 мс.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} page — окно виджета или часов
 * @param {string} urlPart
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<{x: number, y: number, width: number, height: number}>} осевшие границы
 */
async function waitForWindowSettled(app, page, urlPart, opts = {}) {
    await page.waitForLoadState('load');
    const bounds = await waitForBoundsSettled(app, urlPart, opts);
    await page.evaluate(async (ms) => {
        await new Promise((r) => requestAnimationFrame(() => r()));
        // пауза законна: таймер длины SAVE_SETTLE_MS взведён после таймера
        // saveSettled окна (см. JSDoc выше) — исполнится строго следом
        await new Promise((r) => setTimeout(r, ms));
    }, SAVE_SETTLE_MS);
    return bounds;
}

/**
 * Виджет или часы сами просят свой размер (`widget-resize` /
 * `clock-widget-resize` — тем же каналом, что Ctrl+колесо; главный процесс
 * принимает его только от самого окна, ipc-senders.js) — и окно ВСТАЛО.
 *
 * Условие, что main размер применил: окно получило `window-geometry`.
 * `resizeWindowClamped` шлёт его ВСЕГДА, синхронно после `setBounds`, даже
 * если размер не изменился. Принимается первая посылка после взвода: чужой
 * в пути нет — вызывать только на ВСТАВШЕМ окне (`waitForWindowSettled`),
 * где последняя посылка ушла не меньше чем 300 мс назад.
 *
 * Затем `waitForWindowSettled`, и его таймер `SAVE_SETTLE_MS` опирается на
 * ПОРЯДОК таймеров: наш взведён после таймера `saveSettled` окна, только если
 * `resize` рендерера пришёл ДО нашего взвода. Гарантирует это не порядок
 * событий, а запас стоящих границ (≥ 3 × 150 мс в `waitForBoundsSettled`) —
 * ревью B6, M1(а).
 *
 * Самопроверка (ревью B6, M1(б)): принятая посылка сверяется с осевшими
 * границами; расхождение печатается — так виден приём ЧУЖОЙ посылки (или
 * поправка системы после `setBounds`), а решение остаётся утверждениям спеки.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} page
 * @param {{channel: string, urlPart: string, size: number, timeout?: number}} req
 * @returns {Promise<{x: number, y: number, width: number, height: number}>} осевшие границы
 */
async function resizeOwnWindow(app, page, req) {
    const got = await untilReceived(page, 'window-geometry',
        () => page.evaluate(([ch, s]) => window.electronAPI.send(ch, { width: s, height: s }), [req.channel, req.size]),
        { timeout: req.timeout });
    const bounds = await waitForWindowSettled(app, page, req.urlPart, { timeout: req.timeout });
    const keys = ['x', 'y', 'width', 'height'];
    if (!got || keys.some((k) => got[k] !== bounds[k])) {
        console.log(`   [resizeOwnWindow] РАСХОЖДЕНИЕ: принятая window-geometry ${JSON.stringify(got)}, `
            + `осевшие границы ${JSON.stringify(bounds)} (просили ${req.size}) — чужая посылка или поправка системы`);
    }
    return bounds;
}

/**
 * Барьер окна виджета или часов: всё, что окно ПОСЛАЛО в main до вызова,
 * main уже обработал.
 *
 * Окно шлёт своим каналом перемещения (`widget-move` / `clock-widget-move`)
 * нулевой сдвиг с `first: true` и ждёт `window-geometry`: `moveWindowBy`
 * шлёт её всегда, синхронно после `setBounds` (main-geometry.js), а нулевой
 * сдвиг с началом жеста не меняет ни места, ни размера. Посылки одного окна
 * main обрабатывает по порядку, значит, всё посланное раньше барьера уже
 * применено.
 *
 * Для утверждений ОТСУТСТВИЯ («перетаскивание с Ctrl не сдвинуло окно»):
 * обработчик жеста синхронный (window-geometry.js, bindWindowDrag), и
 * посылка, если бы она была, ушла раньше барьера. Пауза доказывала бы то же
 * только на быстрой машине.
 *
 * Принимается первая посылка после взвода — вызывать на ВСТАВШЕМ окне. Если
 * перед барьером всё же ушёл сдвиг (дефект), его `window-geometry` закроет
 * ожидание раньше, но и тогда сдвиг уже применён — утверждение его увидит.
 *
 * @param {import('@playwright/test').Page} page — окно виджета или часов
 * @param {string} moveChannel — `widget-move` или `clock-widget-move`
 * @param {{timeout?: number}} [opts]
 */
async function moveBarrier(page, moveChannel, opts = {}) {
    await untilReceived(page, 'window-geometry',
        () => page.evaluate((ch) => window.electronAPI.send(ch, { deltaX: 0, deltaY: 0, first: true }), moveChannel),
        { timeout: opts.timeout });
}

/**
 * Выполнить действие и дождаться, что ГЛАВНЫЙ процесс обработал `count`
 * посылок канала: в main ставится свой слушатель на настоящий `ipcMain`
 * (`app.evaluate` получает модуль electron, а не обвязку ipc-senders.js).
 * Он подписан позже слушателя приложения, а слушатели одного события
 * вызываются в порядке подписки — счётчик растёт строго ПОСЛЕ синхронного
 * обработчика приложения (`setBounds` в `resizeWindowClamped` и т. п.).
 *
 * Для действий, у которых ответа окну нет или он неотличим от соседних
 * (лестница размеров: `window-geometry` от прошлой ступени может прийти
 * после взвода). Счётчик считает только посылки ПОСЛЕ взвода — чужих нет.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {string} channel
 * @param {() => Promise<any>} action
 * @param {{count?: number, timeout?: number}} [opts]
 */
async function untilMainHandled(app, channel, action, opts = {}) {
    const key = `${channel}#${Date.now()}#${Math.random()}`;
    const count = opts.count || 1;
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    await app.evaluate(({ ipcMain }, [ch, k]) => {
        const box = (globalThis.__e2eHandled = globalThis.__e2eHandled || {});
        const rec = { n: 0, channel: ch };
        rec.listener = () => { rec.n++; };
        ipcMain.on(ch, rec.listener);
        box[k] = rec;
    }, [channel, key]);
    const seen = () => app.evaluate((_e, k) => globalThis.__e2eHandled[k].n, key);
    try {
        await action();
        const deadline = Date.now() + timeout;
        for (;;) {
            const n = await seen();
            if (n >= count) { return; }
            if (Date.now() > deadline) {
                throw new Error(`main не обработал «${channel}» ×${count} за ${timeout} мс (обработано ${n})`);
            }
            // шаг опроса: счётчик обработанных main посылок дорос до count
            await new Promise((r) => setTimeout(r, 20));
        }
    } finally {
        await app.evaluate(({ ipcMain }, k) => {
            const rec = globalThis.__e2eHandled && globalThis.__e2eHandled[k];
            if (!rec) { return; }
            ipcMain.removeListener(rec.channel, rec.listener);
            delete globalThis.__e2eHandled[k];
        }, key).catch(() => {});
    }
}

module.exports = {
    relayBarrier, setWindowStyles, newestWindowId, waitForMainWindowGone, mainBoundsOf, waitForBoundsSettled, waitForWindowSettled, resizeOwnWindow, moveBarrier, untilMainHandled,
    openDisplay, closeDisplay, reopenDisplay,
    waitForDisplay, waitForWidget, waitForClock, waitForWindow,
    waitForWindowGone, waitForDisplayGone, waitForWidgetGone, waitForClockGone,
    findDisplay, findWindowBy, waitForSteady, reloadPanel, waitForTransitions,
    waitForResizeHandled, innerSize, waitForQuiet, armReceived, untilReceived, waitForDisplaySettled, waitForDisplaySnapshot,
    waitForWidgetSnapshot, waitForClockSnapshot, panelRoundTrip, waitForPanelSized, waitForPanelSettled,
    waitForFrameSteady, waitForPanelRemaining, settleFullScreenEntry, reportFullScreenEntry, waitForDrawerBeside, DEFAULT_TIMEOUT,
    DISPLAY_PROBE, WIDGET_PROBE, CLOCK_PROBE
};
