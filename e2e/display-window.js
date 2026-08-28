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

/** Дождаться выхода из полноэкранного режима по СОБЫТИЮ окна. */
async function leaveFullScreen(app) {
    await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().includes('display.html'));
        if (!win || !win.isFullScreen()) { return; }
        await new Promise((resolve) => {
            // Страховка по времени нужна: если система почему-то не пришлёт
            // событие, спека обязана продолжить и упасть на своём утверждении,
            // а не повиснуть до таймаута прогона.
            const done = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(done, 8000);
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
        const win = BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().includes('display.html'));
        win.setBounds({ x: 20, y: 20, width: s.w, height: s.h });
    }, size);

    let got = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        await apply();
        await display.waitForTimeout(600);
        got = await display.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
        if (Math.abs(got.w - size.w) <= 2 && Math.abs(got.h - size.h) <= 2) { return got; }
    }
    if (opts.strict) {
        throw new Error(`окно не приняло размер ${size.w}×${size.h}: сейчас ${got.w}×${got.h}`);
    }
    console.log(`   просили ${size.w}×${size.h}, система дала ${got.w}×${got.h} — считаем по выданному`);
    return got;
}

module.exports = { resizeDisplay, leaveFullScreen };
