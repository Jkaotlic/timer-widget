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
 * @param {{timeout?: number, selector?: string, name?: string}} [opts]
 *        selector — дополнительное условие внутри окна (например `#timerDigits.active`);
 *        name — как назвать окно в сообщении об ошибке
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
        await new Promise((r) => setTimeout(r, POLL_MS));
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
        await new Promise((r) => setTimeout(r, interval));
    }
}

/**
 * Перезагрузить панель и дождаться, что контроллер встал.
 *
 * Спеки делали `reload()` → `waitForTimeout(1200)`. `reload()` сам ждёт
 * события `load`; недоставало одного — конструктора `TimerController`
 * (control-app.js), после которого ячейки, ящик и тумблеры уже связаны.
 *
 * @param {import('@playwright/test').Page} control
 */
async function reloadPanel(control) {
    await control.reload();
    await control.waitForFunction(() => typeof window.timerController === 'object' && !!window.timerController);
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
 * может завести пересчёт, а тот — новый переход. Предел кругов — чтобы
 * бесконечно перезапускаемый переход упал на утверждении теста, а не повис.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{rounds?: number}} [opts]
 */
async function waitForQuiet(page, opts = {}) {
    await page.evaluate(async (rounds) => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        for (let i = 0; i < rounds; i++) {
            if (document.fonts && document.fonts.ready) { await document.fonts.ready; }
            await frame();
            await frame();
            const running = document.getAnimations().filter((a) => a instanceof CSSTransition);
            const fontsBusy = document.fonts && document.fonts.status === 'loading';
            if (!running.length && !fontsBusy) { return; }
            await Promise.all(running.map((a) => a.finished.catch(() => {})));
        }
    }, opts.rounds ?? 6);
}

/**
 * Взвести ожидание СЛЕДУЮЩЕГО сообщения канала в окне — ДО действия, которое
 * его вызовет. Возвращает функцию «дождаться»: сообщение пришло, обработчик
 * окна отработал, окно утихло (`waitForQuiet`).
 *
 * Почему это условие, а не ставка. Слушатель ставится через тот же мост
 * (`window.ipcRenderer.once`), что и слушатель приложения, на тот же
 * EventEmitter `ipcRenderer` в preload; приложение подписалось при загрузке,
 * значит раньше, а слушатели одного события вызываются в порядке подписки.
 * Наш флаг поднимается строго ПОСЛЕ синхронного обработчика приложения.
 * Порядок сообщений одного канала main → окно сохраняется, поэтому и все
 * предыдущие посылки уже отработаны.
 *
 * Пример: панель шлёт `display-settings-update`, затем `display-layout`;
 * взведя `display-layout`, тест дожидается обоих.
 *
 * @param {import('@playwright/test').Page} page — окно-ПОЛУЧАТЕЛЬ
 * @param {string} channel — канал, открытый мостом этого окна на приём
 * @returns {Promise<(opts?: {timeout?: number}) => Promise<any>>} ожидание; отдаёт payload
 */
async function armReceived(page, channel) {
    const key = `${channel}#${Date.now()}#${Math.random()}`;
    await page.evaluate(([ch, k]) => {
        const box = (window.__e2eReceived = window.__e2eReceived || {});
        box[k] = { seen: false, payload: null };
        window.ipcRenderer.once(ch, (_e, payload) => {
            box[k] = { seen: true, payload: payload === undefined ? null : payload };
        });
    }, [channel, key]);
    return async (opts = {}) => {
        const handle = await page.waitForFunction(
            (k) => window.__e2eReceived[k].seen && window.__e2eReceived[k],
            key, { timeout: opts.timeout ?? DEFAULT_TIMEOUT }
        ).catch((err) => {
            throw new Error(`окно не получило «${channel}»: ${err.message}`);
        });
        const got = await handle.jsonValue();
        await page.evaluate((k) => { delete window.__e2eReceived[k]; }, key);
        await waitForQuiet(page);
        return got.payload;
    };
}

/**
 * Выполнить действие и дождаться, что окно-получатель ПОЛУЧИЛО вызванную им
 * посылку канала и утихло. Обёртка над `armReceived`: взвести → действие →
 * дождаться. Действие обязано породить посылку, иначе ожидание упадёт по
 * таймауту с именем канала.
 *
 * @param {import('@playwright/test').Page} page — окно-ПОЛУЧАТЕЛЬ
 * @param {string} channel
 * @param {() => Promise<any>} action
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<any>} payload посылки
 */
async function untilReceived(page, channel, action, opts = {}) {
    const received = await armReceived(page, channel);
    await action();
    return received(opts);
}

/**
 * Дождаться, что открывшийся дисплей ВСТАЛ: документ загружен, размер окна
 * осел, отложенный пересчёт по последнему `resize` отработал, окно утихло.
 *
 * Спеки ждали это паузой 2200–2400 мс. Окно создаётся с `fullscreen: true`;
 * где вход в полноэкранный режим анимирован, размер доезжает серией `resize`,
 * а места карточек пересчитываются по `CONFIG.RESIZE_DEBOUNCE` — замер,
 * сделанный раньше, видит промежуточное окно.
 *
 * Признаком служит именно осевший РАЗМЕР, а не `isFullScreen()`: замер
 * 30.10.2026 (macOS, e2e) — флаг остаётся false все 4.7 с наблюдения и на
 * основном мониторе (окно сразу 3440×1440 = границы экрана), и на Sidecar
 * (1314×955 = рабочая область). Ожидание флага висело бы до таймаута на
 * исправном приложении.
 *
 * @param {import('@playwright/test').ElectronApplication} _app — для единообразия вызова
 * @param {import('@playwright/test').Page} display
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<import('@playwright/test').Page>} то же окно
 */
async function waitForDisplaySettled(_app, display, opts = {}) {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    await display.waitForLoadState('load');
    await waitForSteady(display, innerSize, { samples: 4, timeout, name: 'размер дисплея' });
    // Таймер длины debounce, взведённый ПОСЛЕ таймера приложения, — см.
    // waitForResizeHandled, п. 3.
    await display.evaluate(async (ms) => {
        await new Promise((r) => requestAnimationFrame(() => r()));
        await new Promise((r) => setTimeout(r, ms));
    }, CONFIG.RESIZE_DEBOUNCE);
    await waitForQuiet(display);
    return display;
}

module.exports = {
    openDisplay, closeDisplay, reopenDisplay,
    waitForDisplay, waitForWidget, waitForClock, waitForWindow,
    waitForWindowGone, waitForDisplayGone, waitForWidgetGone, waitForClockGone,
    findDisplay, findWindowBy, waitForSteady, reloadPanel, waitForTransitions,
    waitForResizeHandled, innerSize, waitForQuiet, armReceived, untilReceived, waitForDisplaySettled,
    DISPLAY_PROBE, WIDGET_PROBE, CLOCK_PROBE
};
