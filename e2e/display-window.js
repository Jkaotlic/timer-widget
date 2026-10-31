'use strict';

/**
 * Перевод окна дисплея в заданный размер — ОДНА реализация на все спеки.
 *
 * Копий было две (display-top-band и display-proportions), и обе несли одну
 * мину: `setFullScreen(false)`, пауза 800 мс, `setBounds`. Анимация выхода из
 * полноэкранного режима на macOS длится дольше под нагрузкой, и `setBounds`
 * прилетал в середину перехода. Электрон при этом падал НАСМЕРТЬ —
 * EXC_BREAKPOINT в браузерном процессе, стек:
 *
 *   _doSucceededToExitFullScreen → -[NSWindow _didExitFullScreen]
 *     → makeKeyAndOrderFront: → becomeKeyWindow → NSNotificationCenter
 *       → Electron → JS-колбэк → V8
 *
 * Снаружи это выглядело как «нестабильный тест»: падал не тот тест, который
 * трогал полноэкранный режим, а СЛЕДУЮЩИЙ — на `launchApp()`, и Playwright
 * писал «1 error was not a part of any test». Один раз примерно на шесть
 * прогонов.
 *
 * Отсюда правило, которое и так записано в проекте: перехода ждут ПО СОБЫТИЮ,
 * а не паузой. Пауза — это ставка на скорость машины, и она проигрывает на
 * загруженной.
 */

const CONFIG = require('../constants.js');
const {
    waitForSteady, innerSize, settleAfterResize, settleFullScreenEntry, reportFullScreenEntry, DEFAULT_TIMEOUT
} = require('./window-ready');

/**
 * Дождаться выхода из полноэкранного режима по СОБЫТИЮ окна.
 *
 * Окно — самое новое окно дисплея (ревью B3, N2: первое по адресу могло быть
 * закрывающимся прежним). Сначала — заказанный при создании ВХОД
 * (`settleFullScreenEntry`): фокус, полученный посреди теста (клик,
 * `bringToFront`), запускает его позже `waitForDisplaySettled`, и `setBounds`
 * пришёлся бы в переход. Выведенное нами окно помечается в main
 * (`__e2eWindowedDisplays`), чтобы следующий вызов не ждал входа, которого не
 * будет.
 */
async function leaveFullScreen(app) {
    const entry = await settleFullScreenEntry(app, DEFAULT_TIMEOUT);
    // Окно без фокуса здесь — норма (вход не начнётся, выводить нечего);
    // печатаем только расхождение: фокус есть, а события нет.
    if (entry.state === 'timeout') { reportFullScreenEntry('leaveFullScreen', entry, DEFAULT_TIMEOUT); }
    await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()
            .filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('display.html'))
            .sort((a, b) => b.webContents.id - a.webContents.id)[0];
        if (!win || !win.isFullScreen()) { return; }
        // Помечаем только то, что вывели САМИ: окно, не входившее вовсе, ещё
        // может войти позже (фокус), и следующий вызов обязан это ждать.
        globalThis.__e2eWindowedDisplays = globalThis.__e2eWindowedDisplays || new Set();
        globalThis.__e2eWindowedDisplays.add(win.webContents.id);
        await new Promise((resolve) => {
            // Страховка по времени нужна: если система почему-то не пришлёт
            // событие, спека обязана продолжить и упасть на своём утверждении,
            // а не повиснуть до таймаута прогона.
            const done = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(done, 8000);
            // 150 мс после события — выйти из нативного стека выхода
            // (_doSucceededToExitFullScreen, см. шапку): setBounds из него и
            // ронял Electron. Меньше не проверено на воспроизведённом краше,
            // поэтому не трогаем: это не ожидание размера, а уход со стека.
            win.once('leave-full-screen', () => setTimeout(done, 150));
            win.setFullScreen(false);
        });
    });
}

/**
 * Задать размер и вернуть ФАКТИЧЕСКИЙ, а не требовать совпадения.
 *
 * Система размер обрезает молча: окно дисплея может стоять на другом экране,
 * чем тот, из чьей рабочей области размер выведен. Условия считаются по
 * выданному, расхождение печатается.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {import('@playwright/test').Page} display
 * @param {{w:number,h:number}} size
 * @param {{strict?:boolean}} [opts] strict — бросить, если размер не выдан
 * @returns {Promise<{w:number,h:number}>} фактический размер окна
 */
async function resizeDisplay(app, display, size, opts = {}) {
    await leaveFullScreen(app);

    const apply = () => app.evaluate(({ BrowserWindow }, s) => {
        // Самое новое окно дисплея — то же, что вывел из полноэкранного leaveFullScreen.
        const win = BrowserWindow.getAllWindows()
            .filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('display.html'))
            .sort((a, b) => b.webContents.id - a.webContents.id)[0];
        win.setBounds({ x: 20, y: 20, width: s.w, height: s.h });
    }, size);

    // Пауза 600 мс после setBounds была ставкой на две скорости сразу: что
    // страница успеет получить размер и что отложенный пересчёт дисплея
    // (`CONFIG.RESIZE_DEBOUNCE`) успеет отработать — спеки меряют сразу после
    // возврата. Теперь оба — условием: размер дошёл до страницы и ОСЕЛ, затем
    // кадр и таймер той же длины, что debounce (как в waitForResizeHandled).
    const fits = (got) => Math.abs(got.w - size.w) <= 2 && Math.abs(got.h - size.h) <= 2;
    let got = await display.evaluate(innerSize);
    for (let attempt = 0; attempt < 5; attempt++) {
        const before = got;
        await apply();
        // Дошёл запрошенный размер — или система выдала другой (обрезала):
        // тогда размер просто отличается от прежнего. Ни того ни другого за
        // секунду — окно команду не приняло, повторяем.
        await display.waitForFunction(([s, b]) => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            return (Math.abs(w - s.w) <= 2 && Math.abs(h - s.h) <= 2) || w !== b.w || h !== b.h;
        }, [size, before], { timeout: 1000 }).catch(() => {});
        got = await display.evaluate(innerSize);
        if (fits(got)) { break; }
        // Не тот размер — дать ему осесть (система вправе поправить следом)
        // и решать по осевшему.
        got = await waitForSteady(display, innerSize, { name: 'размер дисплея' });
        if (fits(got)) { break; }
    }
    // Осадка и в ветке «размер совпал сразу» (ревью e2e-B2, M3): система вправе
    // поправить рамку уже ПОСЛЕ совпадения (constrainFrameRect, второй монитор),
    // и поздний `resize` перевзведёт debounce приложения позже нашего таймера.
    // Поэтому после таймера размер сверяется ещё раз; сдвинулся — осесть и
    // пройти таймер заново. Не осел за три круга — бросить, а не мерить
    // промежуточное окно.
    for (let round = 0; ; round++) {
        // Кадр + таймер длины RESIZE_DEBOUNCE после таймера приложения.
        await settleAfterResize(display, CONFIG.RESIZE_DEBOUNCE);
        const now = await display.evaluate(innerSize);
        if (now.w === got.w && now.h === got.h) { break; }
        if (round >= 2) {
            throw new Error(`размер дисплея не осел после setBounds: был ${got.w}×${got.h}, стал ${now.w}×${now.h}`);
        }
        console.log(`   размер дисплея сдвинулся после совпадения: ${got.w}×${got.h} → ${now.w}×${now.h}, оседаем заново`);
        got = await waitForSteady(display, innerSize, { name: 'размер дисплея' });
    }
    if (fits(got)) { return got; }
    if (opts.strict) {
        throw new Error(`окно не приняло размер ${size.w}×${size.h}: сейчас ${got.w}×${got.h}`);
    }
    console.log(`   просили ${size.w}×${size.h}, система дала ${got.w}×${got.h} — считаем по выданному`);
    return got;
}

module.exports = { resizeDisplay, leaveFullScreen };
