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

module.exports = {
    openDisplay, waitForDisplay, waitForWidget, waitForClock, waitForWindow,
    findDisplay, findWindowBy,
    DISPLAY_PROBE, WIDGET_PROBE, CLOCK_PROBE
};
