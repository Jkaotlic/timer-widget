'use strict';

// Dev-only: drives a scripted capture sequence across all 4 windows and
// 4 timer states. Called from electron-main.js when `--screenshot` is passed.
// Writes PNGs to <repo>/screenshots/.

const path = require('node:path');
const fs = require('node:fs');
const { diffBitmaps, isRegression, isTimeDependent } = require('../visual-diff');

/**
 * Смена стиля виджета — ЧЕРЕЗ главный процесс, а не прямой посылкой в окно.
 *
 * С 12.08.2026 на стиле висит не только отрисовка, но и форма окна: у LED это
 * полоса по размеру цифр, и пол высоты для неё снимает обработчик
 * `widget-style-update` в electron-main.js. Прямая посылка в webContents идёт
 * мимо него — окно остаётся с полом 140 px, полоса поджимается, и кадр
 * показывает состояние, которого у пользователя не бывает (замерено: 250×140
 * вместо 250×90). `ipcMain.emit` зовёт НАСТОЯЩИЙ обработчик тем же путём, каким
 * приходит сообщение из панели.
 */
function sendWidgetStyle(style) {
    require('electron').ipcMain.emit('widget-style-update', {}, { timerStyle: style });
}

const STATES = [
    { name: 'idle',     remaining: 300, total: 300, isRunning: false, finished: false },
    { name: 'running',  remaining: 183, total: 300, isRunning: true,  finished: false },
    { name: 'finished', remaining: 0,   total: 300, isRunning: false, finished: true  },
    { name: 'overtime', remaining: -47, total: 300, isRunning: true,  finished: true  },
    // ВАЖНО: идёт СРАЗУ после overtime и ловит «залипшие» цвета. Ветки danger и
    // overtime выставляют инлайновые красные стили, которые побеждают CSS-классы;
    // если ветка нормального времени их не снимает, время остаётся красным даже
    // после установки нового пресета. Именно так выглядел баг, который нашёл
    // пользователь. Порядок состояний тут — часть проверки, не переставлять.
    { name: 'recovered', remaining: 300, total: 300, isRunning: false, finished: false }
];

const WINDOWS = ['control', 'widget', 'clock', 'display'];

// Minimum sizes advertised by BrowserWindow options — used to catch layout
// overflow/clipping when the user resizes to the floor.
//
// Окно управления берёт свой минимум ИЗ РЕЕСТРА, а не литералом. Здесь стояло
// 360×640 — ниже объявленного минимума (380×660), который главный процесс
// держит через minWidth/minHeight. Стенд перед съёмкой сам опускает минимум
// (setMinimumSize ниже), поэтому расхождение не падало, а молча снимало
// состояние, в которое приложение попасть не может: на кадре control-minsize
// ряд вкладок настроек вылезал на 16px за нижний край своей секции, и дефект
// искали в раскладке панели. Проверяется tests/visual-source.test.js.
const CONFIG = require('../constants.js');

const MIN_SIZES = {
    control: { width: CONFIG.CONTROL_WINDOW_MIN_WIDTH, height: CONFIG.CONTROL_WINDOW_MIN_HEIGHT },
    widget:  { width: 120, height: 140 },
    clock:   { width: 120, height: 120 },
    display: { width: 1280, height: 720 } // display doesn't resize, but keep consistent
};

// Maximum sizes — control has a hard max (drawer + panel); widget/clock are
// scalable via Ctrl+wheel with no ceiling, so we pick a "big screen" size a
// user could realistically drag them to.
const MAX_SIZES = {
    control: { width: 1280, height: 1100 },
    widget:  { width: 800,  height: 800 },
    clock:   { width: 800,  height: 800 },
    display: { width: 1920, height: 1080 }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Заморозка анимаций на время съёмки.
//
// Без неё снимки недетерминированы: пульсация статуса (overtime-pulse,
// badge-pulse, pulse-dot) и вспышка завершения (body.flash-mode, brightness 1.5,
// переключается по интервалу из JS) попадают в кадр в случайной фазе. Первый же
// прогон сверки с эталоном показал 100% расхождения на display-overtime именно
// из-за вспышки. Цвета и раскладка при заморозке остаются настоящими — застывает
// только фаза анимации, поэтому регрессии всё так же видны.
const FREEZE_ANIMATIONS_CSS = `
    *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        /* Снимки обязаны не зависеть от того, где стоит курсор мыши.
           Окна снимаются в обычной оконной системе, поэтому реальный курсор
           попадал в кадр состоянием :hover: подсветка кнопки «+1 ч» давала
           2044 px расхождения в control-maxsize, подсветка строки в ящике —
           685 px в control-drawer-clock, причём стабильно между прогонами и
           «случайно чисто», если мышь стояла в стороне. pointer-events: none
           убирает hit-test целиком, поэтому :hover не срабатывает ни на чём;
           программные .click() из последовательности при этом работают. */
        pointer-events: none !important;
    }
    body.flash-mode { filter: none !important; }
    /* Подсказки управления живут по ТАЙМЕРУ: показываются при первом открытии
       окна и гаснут через 5 секунд, а скрываются сразу только если флаг
       (displayHintShown / widgetHintShown / clockHintShown) уже записан. То есть
       попадут они в кадр или нет — зависит от того, есть ли флаг в профиле и
       успел ли пройти таймер: полоса подсказки на дисплее — это 1280×30 px,
       3.66% кадра, ровно тот же класс недетерминизма, что курсор и анимации.
       Снимаем их из кадра всегда. */
    #controlsHint, #widgetHint, #clockHint { display: none !important; }
    /* Тосты — тот же класс недетерминизма, что подсказки выше, только заметнее.
       Подсказка первого запуска («F1 — список горячих клавиш») показывается
       один раз на профиль и гаснет через 3.5 секунды: попадёт она в кадр или
       нет, зависит от того, стоит ли флаг onboardingShown и как быстро прошла
       съёмка. На кадре control-collapsed.png она заняла ПОЛОВИНУ полосы — в
       окне 400×52 тост перекрывает почти всё. Размещение тостов проверяется
       замером в e2e (toast-placement, mini-bar), а не картинкой. */
    .toast-container { display: none !important; }
`;

async function freezeAnimations(ctx, log) {
    for (const name of WINDOWS) {
        const w = ctx()[name];
        if (!w || w.isDestroyed()) { continue; }
        try {
            await w.webContents.insertCSS(FREEZE_ANIMATIONS_CSS);
        } catch (e) {
            log.warn(`[screenshot] не смог заморозить анимации в ${name}: ${e.message}`);
        }
    }
}

/**
 * Замораживает СТЕННОЕ ВРЕМЯ в кадре.
 *
 * Панель печатает под цифрами «закончится в 21:28» — значение, посчитанное от
 * `new Date()`. Замер 18.08.2026: сразу после записи эталонов сверка давала 10
 * расхождений из 49, все на кадрах панели, все в одной полоске 104×10 px в
 * координатах подписи. То есть эталон устаревал через минуту после съёмки, а
 * «регрессия» означала только то, что сменилась минута.
 *
 * Ответ — не выкидывать кадры панели из сверки (это САМОЕ большое окно
 * приложения, и терять его коверидж ради одной строки нельзя) и не прятать
 * подпись (тогда из кадра уходит настоящий элемент), а сделать время
 * ПОСТОЯННЫМ. Заменяется ровно одна чистая функция, и подпись остаётся такой
 * же по форме и длине, какой её видит пользователь.
 *
 * То же правило с другой стороны: кадры, где стенное время показано ЦЕЛИКОМ
 * (виджет часов, блоки дисплея), из сверки исключены — см. isTimeDependent().
 */
const FROZEN_ENDS_AT = '12:34';

async function freezeWallClock(ctx, log) {
    for (const name of WINDOWS) {
        const w = ctx()[name];
        if (!w || w.isDestroyed()) { continue; }
        try {
            await w.webContents.executeJavaScript(`
                (() => {
                    const S = window.RendererShared;
                    if (S && typeof S.endsAt === 'function') { S.endsAt = () => '${FROZEN_ENDS_AT}'; }
                    return true;
                })();
            `);
        } catch (e) {
            log.warn(`[screenshot] не смог заморозить стенное время в ${name}: ${e.message}`);
        }
    }
}

async function waitForLoad(win, timeoutMs = 6000) {
    if (!win || win.isDestroyed()) { return; }
    if (!win.webContents.isLoading()) { return; }
    await new Promise((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        win.webContents.once('did-finish-load', () => { clearTimeout(t); resolve(); });
    });
}

// Ждём ФАКТИЧЕСКОЙ загрузки шрифтов, а не «на всякий случай столько-то мс».
//
// Все окна объявляют шрифты с `font-display: swap`: пока woff2 не загрузился,
// текст рисуется запасным шрифтом, а потом подменяется. Если первый снимок
// попадает в промежуток, он отличается от эталона на десятки тысяч пикселей —
// и это не регрессия, а гонка. Ровно так `visual:check` периодически падал на
// трёх снимках состояния idle (display-idle расходился на 2.43%), а повторный
// прогон тут же давал 0 расхождений. Слепого sleep(1500) под нагрузкой не хватало.
async function waitForFonts(win, timeoutMs = 5000) {
    if (!win || win.isDestroyed()) { return; }
    try {
        await win.webContents.executeJavaScript(`
            Promise.race([
                document.fonts.ready.then(() => true),
                new Promise((r) => setTimeout(() => r(false), ${timeoutMs}))
            ])
        `, true);
    } catch { /* окно могло закрыться — снимок всё равно будет сделан */ }
}

// Ждём, пока тема РЕАЛЬНО применена в окне, а не «столько-то мс после send».
//
// `ui-theme-update` — обычное IPC-сообщение: применяет его обработчик в
// рендерере, и до этого момента окно остаётся в прежней теме. Слепой sleep(500)
// после рассылки давал плавающий кадр: `light-control.png` расходился с
// эталоном на 99.72% — то есть был снят целиком в ТЁМНОЙ теме, — причём два
// прогона подряд перед этим прошли по нулям. Ровно тот же класс гонки, что уже
// описан выше про шрифты, и лечится так же: условием вместо задержки.
//
// Двойной requestAnimationFrame после совпадения атрибута обязателен: снимок
// берёт КОМПОЗИТОР, а не DOM, и без нового кадра capturePage вернёт прежнюю
// картинку при уже правильном data-theme.
async function waitForTheme(win, theme, timeoutMs = 3000) {
    if (!win || win.isDestroyed()) { return true; }
    try {
        return await win.webContents.executeJavaScript(`
            Promise.race([
                new Promise((resolve) => {
                    const want = ${JSON.stringify(theme)};
                    const check = () => {
                        if (document.documentElement.getAttribute('data-theme') === want) {
                            requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
                        } else {
                            setTimeout(check, 50);
                        }
                    };
                    check();
                }),
                new Promise((r) => setTimeout(() => r(false), ${timeoutMs}))
            ])
        `, true);
    } catch {
        return false; // окно могло закрыться — снимок всё равно будет сделан
    }
}

/**
 * Ждёт, пока окно ПОКАЖЕТ заданное время, а не «столько-то миллисекунд».
 *
 * Кадр `hours-hmax-digital-widget` расходился между прогонами на 49.6 %: на нём
 * оказывалось время предыдущего состояния (1:02:03 вместо 99:59:59). Причина не
 * в отрисовке — состояние просто не успевало доехать до окна за отведённый сон,
 * и никакой сон не превращает гонку в гарантию. Здесь опрашивается САМО окно.
 *
 * Возвращает false по истечении срока: съёмка продолжается, но в журнале
 * остаётся след — «кадр снят не тем, чем ожидали» лучше видеть, чем угадывать
 * по расхождению.
 */
async function waitForRemaining(win, seconds, log, timeoutMs = 3000) {
    if (!win || win.isDestroyed()) { return false; }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const ok = await win.webContents.executeJavaScript(
                `typeof widgetTimer !== 'undefined' && Math.floor(widgetTimer.remainingSeconds) === ${Math.floor(seconds)}`,
                true
            );
            if (ok) { return true; }
        } catch { /* окно перезагружается — пробуем дальше */ }
        await sleep(50);
    }
    log.warn(`[screenshot] окно не показало ${seconds} c за ${timeoutMs} мс — кадр может быть снят с прежним временем`);
    return false;
}

async function capture(win, filePath, log) {
    if (!win || win.isDestroyed()) {
        log.warn(`[screenshot] skip ${path.basename(filePath)} — window missing`);
        return;
    }
    // Transparent windows that were never shown don't allocate a compositor
    // surface -> capturePage returns UnknownVizError. Showing offscreen first
    // forces the surface to exist, but sometimes the first capture still races
    // the surface handshake. Retry up to 3 times with a short back-off.
    if (!win.isVisible()) { win.showInactive(); }

    // Прогревочный снимок, результат которого выбрасывается.
    //
    // Замерено: окно виджета в режиме съёмки стоит за краем экрана и его
    // страница отчитывается `document.visibilityState === 'hidden'`. Скрытая
    // страница не перерисовывается, поэтому capturePage отдаёт ПРОШЛЫЙ кадр
    // композитора — на hours-hmax-digital-widget в PNG попадало время
    // предыдущего шага (1:02:03 вместо 99:59:59) при том, что DOM в тот же
    // момент показывал правильное (проверено запросом к окну). Первый вызов
    // заставляет композитор собрать свежий кадр, второй его и забирает.
    // Никакой сон этого не заменяет: это не медленная отрисовка, а её
    // отсутствие до запроса.
    try {
        await win.webContents.capturePage();
        await sleep(120);
    } catch { /* прогрев не обязан удаться — дальше обычные попытки с ретраями */ }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const img = await win.webContents.capturePage();
            fs.writeFileSync(filePath, img.toPNG());
            log.info(`[screenshot] ${path.basename(filePath)}${attempt > 1 ? ` (retry ${attempt - 1})` : ''}`);
            return;
        } catch (err) {
            if (attempt === maxAttempts) {
                log.error(`[screenshot] ${path.basename(filePath)} failed after ${maxAttempts} attempts: ${err.message}`);
                return;
            }
            await sleep(250 * attempt);
        }
    }
}

// Сверяет снятые PNG с эталонами из tests/visual-baseline/.
// Декодирование делает Electron (nativeImage), арифметику — чистый visual-diff.js.
// Возвращает список регрессий; пустой список = всё совпало.
function compareWithBaseline({ nativeImage, outDir, baselineDir, log }) {
    if (!fs.existsSync(baselineDir)) {
        log.info('[visual] эталонов нет — пропускаю сверку (npm run visual:baseline)');
        return null;
    }
    const regressions = [];
    let compared = 0;
    let skipped = 0;

    for (const name of fs.readdirSync(outDir).filter(f => f.endsWith('.png')).sort()) {
        if (isTimeDependent(name)) { skipped++; continue; }
        const basePath = path.join(baselineDir, name);
        if (!fs.existsSync(basePath)) {
            log.warn(`[visual] нет эталона для ${name} — новый снимок`);
            continue;
        }
        try {
            const actual = nativeImage.createFromPath(path.join(outDir, name)).toBitmap();
            const expected = nativeImage.createFromPath(basePath).toBitmap();
            const result = diffBitmaps(actual, expected);
            compared++;
            if (isRegression(result)) {
                const pct = (result.ratio * 100).toFixed(2);
                regressions.push({ name, ...result });
                log.error(`[visual] РАСХОЖДЕНИЕ ${name}: ${result.diffPixels} px (${pct}%)`);
                // Дублируем на консоль: результат сверки уходил ТОЛЬКО в файл
                // лога, поэтому `npm run visual:check` со стороны выглядел
                // молчаливым — приходилось знать, где лежит лог, чтобы узнать
                // итог. Проверка, итог которой не видно, обесценивается: её
                // перестают читать (см. CLAUDE.md про шаг, падавший вхолостую).
                console.error(`[visual] РАСХОЖДЕНИЕ ${name}: ${result.diffPixels} px (${pct}%)`);
            }
        } catch (e) {
            log.warn(`[visual] не смог сравнить ${name}: ${e.message}`);
        }
    }

    const summary = `[visual] сверено ${compared}, пропущено по времени ${skipped}, расхождений ${regressions.length}`;
    log.info(summary);
    console.log(summary);
    return regressions;
}

async function run({ app, log, ctx, applyTimerState, openWidget, openClock, openDisplay, outDir, nativeImage }) {
    log.info('[screenshot] starting capture sequence');
    fs.mkdirSync(outDir, { recursive: true });

    // Hard exit guard — kill the process if the sequence hangs for any reason.
    // Это страховка от зависания, а не бюджет времени: последовательность выросла
    // (часовые форматы, контрастная тема, ящик настроек), и 90 с стали впритык.
    const hardTimeout = setTimeout(() => {
        log.error('[screenshot] hard timeout (180s) — forcing exit');
        app.exit(2);
    }, 180_000);
    hardTimeout.unref && hardTimeout.unref();

    // Объявлено ДО try, потому что восстанавливается в finally.
    const initialSizes = {};

    try {
        openWidget();
        openClock();
        openDisplay();

        await sleep(300);
        for (const name of WINDOWS) {
            try { await waitForLoad(ctx()[name]); } catch (e) {
                log.warn(`[screenshot] ${name} did-finish-load timeout: ${e.message}`);
            }
        }
        // Шрифты — по факту готовности, стекло и раскладка — коротким запасом.
        for (const name of WINDOWS) {
            await waitForFonts(ctx()[name]);
        }
        await sleep(600); // glass blur + первая раскладка

        // Заморозку ставим ДО первого снимка, иначе фаза пульсации попадает в кадр.
        await freezeAnimations(ctx, log);
        await freezeWallClock(ctx, log);
        await sleep(200);

        // КАНОНИЧЕСКИЕ размеры на входе — иначе прогон зависит от предыдущего.
        //
        // Виджет и часы сохраняют геометрию (см. CLAUDE.md), а последовательность их
        // многократно ресайзит и меняет им стиль; после смены стиля окно ещё и
        // доскейливается само через таймер. В итоге размер, с которым окно
        // открывалось в следующий раз, зависел от того, чем кончился предыдущий
        // прогон, и кадры расходились с эталонами НЕ по содержимому, а по размеру
        // (diff показывал «0 px (100%)» — несовпадение размеров). Плюс процент в
        // ползунке «Масштаб часов» в ящике настроек показывал сохранённое значение и
        // тоже плыл. Восстановления в конце не хватало: авто-скейл срабатывал после
        // него. Поэтому размеры задаются ЯВНО до первого снимка.
        const CANONICAL_SIZES = {
            control: [400, 700],
            widget: [250, 250],
            clock: [250, 250],
            display: [1280, 720]
        };
        for (const [name, size] of Object.entries(CANONICAL_SIZES)) {
            const w = ctx()[name];
            if (!w || w.isDestroyed()) { continue; }
            try { w.setSize(size[0], size[1]); } catch (e) {
                log.warn(`[screenshot] канонический размер ${name}: ${e.message}`);
            }
        }
        await sleep(600); // дать авто-скейлу отработать и записать геометрию

        // Запоминаем размеры окон, чтобы вернуть их в конце.
        //
        // Виджет и часы СОХРАНЯЮТ геометрию на событие resize (см. CLAUDE.md), а
        // последовательность их многократно ресайзит: прогоны минимального и
        // максимального размера, часовые форматы, контрастная тема. Поэтому размер,
        // с которым окно открылось в СЛЕДУЮЩИЙ раз, зависел от того, чем кончился
        // предыдущий прогон — и снимки расходились с эталонами не по содержимому, а
        // по размеру кадра (diff показывал «0 px (100%)», то есть несовпадение
        // размеров). Возврат в finally делает последовательность идемпотентной.
        for (const name of WINDOWS) {
            const w = ctx()[name];
            if (!w || w.isDestroyed()) { continue; }
            try { initialSizes[name] = w.getSize(); } catch { /* окно могло исчезнуть */ }
        }

        // Warm-up capture — first call on a freshly created window can throw
        // UnknownVizError while the compositor surface is being allocated.
        for (const name of WINDOWS) {
            const w = ctx()[name];
            if (!w || w.isDestroyed()) { continue; }
            try {
                if (!w.isVisible()) { w.showInactive(); }
                await w.webContents.capturePage();
            } catch { /* ignore — actual captures are in the state loop below */ }
        }
        await sleep(500);

        // Перечитать фон, когда панель уже отработала.
        //
        // Фон виджета и дисплея живёт в `displayExtSettings`, который пишет
        // панель. В режиме съёмки все четыре окна поднимаются ОДНОВРЕМЕННО,
        // поэтому окно успевает прочитать localStorage раньше, чем панель туда
        // пишет: `loadBackgroundSettings()` не находит ключа и уходит молча, а
        // `applyBackground()` так и не вызывается. Круг виджета остаётся с
        // CSS-дефолтом `rgba(15, 15, 25, 0.7)`, и поверх НЕПРОЗРАЧНОГО фона окна
        // режима съёмки (#1c1c1e) это даёт серый вместо `#0f0c29` — кадр
        // расходился с эталоном на половину площади при полностью исправном
        // приложении (в живом окне fill = rgb(15, 12, 41) сразу и стабильно).
        //
        // У пользователя гонки нет: окна открываются позже панели и читают уже
        // записанные настройки. Поэтому чиним съёмку, а не приложение —
        // повторяем ровно то, что делает штатное открытие окна.
        const REREAD_BACKGROUND = {
            widget: 'widgetTimer.loadBackgroundSettings()',
            display: 'displayTimer.loadBackgroundSettings()'
        };
        for (const [name, expr] of Object.entries(REREAD_BACKGROUND)) {
            const w = ctx()[name];
            if (!w || w.isDestroyed()) { continue; }
            try {
                await w.webContents.executeJavaScript(`(() => { ${expr}; return true; })()`);
            } catch (e) {
                log.warn(`[screenshot] перечитать фон (${name}): ${e.message}`);
            }
        }
        await sleep(400);

        for (const state of STATES) {
            try {
                applyTimerState({
                    totalSeconds: state.total,
                    presetSeconds: state.total,
                    remainingSeconds: state.remaining,
                    isRunning: state.isRunning,
                    isPaused: false,
                    finished: state.finished
                });
            } catch (e) {
                log.error(`[screenshot] applyTimerState(${state.name}) failed: ${e.message}`);
            }
            await sleep(500); // let renderers repaint

            const windows = ctx();
            for (const name of WINDOWS) {
                await capture(windows[name], path.join(outDir, `${name}-${state.name}.png`), log);
            }
        }

        // Полоса — состояние, которого нет ни на одном другом кадре: панели на
        // нём не видно вовсе. Любая ошибка в правиле `body.collapsed` (не
        // спрятанная секция, съехавшая кнопка, цвет точки не от той полосы)
        // видна сразу и целиком, потому что кадр всего 400×52.
        //
        // Снимается в состоянии running: у полосы есть точка состояния, и на
        // покое она ничего не покажет.
        try {
            applyTimerState({
                totalSeconds: 300, presetSeconds: 300, remainingSeconds: 183,
                isRunning: true, isPaused: false, finished: false
            });
            const c = ctx().control;
            if (c && !c.isDestroyed()) {
                // Возвращаем примитив: collapse() отдаёт объект API, а его
                // executeJavaScript пытается склонировать через structured clone
                // и падает с «An object could not be cloned».
                await c.webContents.executeJavaScript('!!(window.miniBar && window.miniBar.collapse())');
                await sleep(600);
                await capture(c, path.join(outDir, 'control-collapsed.png'), log);
                await c.webContents.executeJavaScript('!!(window.miniBar && window.miniBar.expand())');
                await sleep(600);
            }
        } catch (e) {
            log.warn(`[screenshot] кадр полосы: ${e.message}`);
        }

        // Stuck-colour sweep across all 4 timer styles.
        //
        // The danger/overtime bands write INLINE colours (inline beats the CSS
        // class), so every style needs a branch that clears them again. When one
        // is missing the timer just stays red forever — including after a fresh
        // preset is set. Circle is the default style and therefore the only one
        // the state loop above exercises, so drive the other three explicitly:
        // poison with overtime, then recover, then look.
        log.info('[screenshot] style sweep (stuck-colour check)');
        const STYLES = ['circle', 'flip', 'analog', 'digits'];
        const poison = { totalSeconds: 300, presetSeconds: 300, remainingSeconds: -47,
            isRunning: true, isPaused: false, finished: false };
        const recover = { totalSeconds: 300, presetSeconds: 300, remainingSeconds: 300,
            isRunning: false, isPaused: false, finished: false };

        for (const style of STYLES) {
            const w = ctx();
            try {
                if (w.display && !w.display.isDestroyed()) {
                    w.display.webContents.send('display-settings-update', { timerStyle: style });
                }
                if (w.widget && !w.widget.isDestroyed()) {
                    sendWidgetStyle(style);
                }
            } catch (e) {
                log.warn(`[screenshot] style ${style} switch failed: ${e.message}`);
            }
            await sleep(400);

            try { applyTimerState(poison); } catch { /* best effort */ }
            await sleep(450);
            try { applyTimerState(recover); } catch { /* best effort */ }
            await sleep(450);

            const now = ctx();
            await capture(now.display, path.join(outDir, `style-${style}-display-recovered.png`), log);
            await capture(now.widget, path.join(outDir, `style-${style}-widget-recovered.png`), log);
        }

        // Overtime-limit row: it only renders when «Считать ниже нуля» is on, so
        // flip the toggle from the outside and grab the control panel once.
        log.info('[screenshot] overtime limit row');
        try {
            const c = ctx().control;
            if (c && !c.isDestroyed()) {
                await c.webContents.executeJavaScript(`
                    (() => {
                        const t = document.getElementById('allowNegative');
                        if (t) { t.checked = true; t.dispatchEvent(new Event('change')); }
                        const l = document.getElementById('overrunLimit');
                        if (l) { l.value = '05:00'; l.dispatchEvent(new Event('input')); }
                    })();
                `);
                await sleep(350);
                await capture(c, path.join(outDir, 'control-overtime-limit.png'), log);
                await c.webContents.executeJavaScript(`
                    (() => {
                        const t = document.getElementById('allowNegative');
                        if (t) { t.checked = false; t.dispatchEvent(new Event('change')); }
                    })();
                `);
                await sleep(200);
            }
        } catch (e) {
            log.warn('[screenshot] overtime limit row failed: ' + e.message);
        }

        // Min-size sweep — resize each window to its advertised floor and grab
        // one snapshot. Uses the 'running' state so progress ring + status chip
        // are visible (worst case for cramped layouts).
        log.info('[screenshot] minsize sweep');
        try {
            applyTimerState({
                totalSeconds: 300, presetSeconds: 300, remainingSeconds: 183,
                isRunning: true, isPaused: false, finished: false
            });
        } catch (e) {
            log.warn(`[screenshot] minsize state set failed: ${e.message}`);
        }
        await sleep(200);

        const windowsNow = ctx();
        for (const name of WINDOWS) {
            const w = windowsNow[name];
            if (!w || w.isDestroyed()) { continue; }
            const target = MIN_SIZES[name];
            if (!target) { continue; }
            try {
                w.setMinimumSize(target.width, target.height);
                w.setSize(target.width, target.height);
            } catch (e) {
                log.warn(`[screenshot] ${name} resize failed: ${e.message}`);
            }
            await sleep(350); // let responsive CSS settle
            await capture(w, path.join(outDir, `${name}-minsize.png`), log);
        }

        // Max-size sweep — stress-test the ceiling (control hard max, widget/clock
        // big-screen scaling). Same 'running' state for visual parity with minsize.
        log.info('[screenshot] maxsize sweep');
        for (const name of WINDOWS) {
            const w = windowsNow[name];
            if (!w || w.isDestroyed()) { continue; }
            const target = MAX_SIZES[name];
            if (!target) { continue; }
            try {
                // Clear any minimum we just raised so the subsequent resize isn't blocked.
                w.setMinimumSize(1, 1);
                w.setSize(target.width, target.height);
            } catch (e) {
                log.warn(`[screenshot] ${name} resize(max) failed: ${e.message}`);
            }
            await sleep(400);
            await capture(w, path.join(outDir, `${name}-maxsize.png`), log);
        }

        // Часовые форматы (H:MM:SS).
        //
        // Все предыдущие снимки сняты на пресетах до часа, поэтому раскладка с
        // часами не проверялась картинками ВООБЩЕ — а именно там жил дефект
        // флип-разделителя в виджете (двоеточие-глиф поверх двух точек), который
        // нашёлся замером, а не сверкой. Гоняем все четыре стиля на 1:02:03 и
        // отдельно проверяем максимум 99:59:59, где ширина строки предельная.
        //
        // Размеры окон задаются ЯВНО: перед этим шли прогоны минимального и
        // максимального размера, и без сброса кадры унаследовали бы их геометрию.
        log.info('[screenshot] hour formats');
        const HOUR_STATES = [
            { name: 'h1', total: 7200, remaining: 3723 },      // 1:02:03
            { name: 'hmax', total: 359999, remaining: 359999 } // 99:59:59
        ];
        for (const style of STYLES) {
            const w = ctx();
            try {
                if (w.display && !w.display.isDestroyed()) {
                    w.display.setSize(1280, 720);
                    w.display.webContents.send('display-settings-update', { timerStyle: style });
                }
                if (w.widget && !w.widget.isDestroyed()) {
                    sendWidgetStyle(style);
                    // Размер задаётся ПОСЛЕ смены стиля, а не до неё: с 12.08.2026
                    // форму окна выбирает сам стиль (LED — полоса по размеру цифр,
                    // остальные — квадрат), и выставленная заранее геометрия
                    // перебивалась переходом ИЗ полосы в квадрат — кадры flip
                    // уезжали с 320×260 на 320×320 в зависимости от того, какой
                    // стиль снимался перед ним.
                    //
                    // Для LED размер не навязывается вовсе: полосу задаёт
                    // приложение, и подменять её здесь значило бы снимать не то,
                    // что видит пользователь.
                    if (style !== 'digital') {
                        setTimeout(() => {
                            if (!w.widget.isDestroyed()) { w.widget.setSize(320, 260); }
                        }, 120);
                    }
                }
            } catch (e) {
                log.warn(`[screenshot] hour formats: style ${style} failed: ${e.message}`);
                continue;
            }
            await sleep(450);

            for (const hs of HOUR_STATES) {
                // Максимум снимаем только для digital и flip: там строка длиннее
                // всего и есть чему не поместиться. Круг и аналог показывают то же
                // время внутри фиксированного циферблата.
                if (hs.name === 'hmax' && style !== 'digital' && style !== 'flip') { continue; }
                try {
                    applyTimerState({
                        totalSeconds: hs.total, presetSeconds: hs.total,
                        remainingSeconds: hs.remaining,
                        isRunning: true, isPaused: false, finished: false
                    });
                } catch (e) {
                    log.warn(`[screenshot] hour state ${hs.name} failed: ${e.message}`);
                    continue;
                }
                const now = ctx();
                // Ждём, пока состояние ДОЕДЕТ до окна, а не фиксированный сон:
                // именно здесь кадр hmax снимался с временем предыдущего шага.
                await waitForRemaining(now.widget, hs.remaining, log);
                await sleep(250);
                await capture(now.widget, path.join(outDir, `hours-${hs.name}-${style}-widget.png`), log);
                await capture(now.display, path.join(outDir, `hours-${hs.name}-${style}-display.png`), log);
            }
        }

        // Высококонтрастная тема.
        //
        // Появилась в 2.4.0 и в сверке не покрыта: все остальные кадры — тёмная
        // тема. Тема рассылается по IPC, а НЕ кликом по кнопке в титлбаре, и это
        // важно: клик пишет выбор в localStorage, и следующий прогон снимал бы
        // ВСЕ кадры в контрасте, разойдясь с эталонами. IPC только применяет.
        log.info('[screenshot] high contrast theme');
        const sendTheme = async (theme) => {
            const w = ctx();
            for (const name of WINDOWS) {
                const win = w[name];
                if (!win || win.isDestroyed()) { continue; }
                try {
                    win.webContents.send('ui-theme-update', { theme });
                } catch (e) {
                    log.warn(`[screenshot] тема ${theme} → ${name}: ${e.message}`);
                }
            }
            // Ждём подтверждения от КАЖДОГО окна, а не общей паузы: рассылка
            // асинхронная, и «в среднем успевает» здесь уже давало кадр в
            // чужой теме (см. waitForTheme).
            for (const name of WINDOWS) {
                const applied = await waitForTheme(w[name], theme);
                if (!applied) {
                    log.warn(`[screenshot] тема ${theme} не подтверждена окном ${name} — кадр может быть в чужой теме`);
                }
            }
        };

        try {
            const w = ctx();
            if (w.control && !w.control.isDestroyed()) { w.control.setSize(400, 700); }
            if (w.widget && !w.widget.isDestroyed()) { w.widget.setSize(250, 250); }
            if (w.clock && !w.clock.isDestroyed()) { w.clock.setSize(250, 250); }
            if (w.display && !w.display.isDestroyed()) {
                w.display.setSize(1280, 720);
                w.display.webContents.send('display-settings-update', { timerStyle: 'circle' });
            }
            if (w.widget && !w.widget.isDestroyed()) {
                sendWidgetStyle('circle');
            }
            applyTimerState({
                totalSeconds: 300, presetSeconds: 300, remainingSeconds: 183,
                isRunning: true, isPaused: false, finished: false
            });
        } catch (e) {
            log.warn(`[screenshot] подготовка hc-темы: ${e.message}`);
        }
        await sleep(500);

        await sendTheme('light');
        for (const name of WINDOWS) {
            await capture(ctx()[name], path.join(outDir, `light-${name}.png`), log);
        }

        // Ящик настроек В КОНТРАСТНОЙ теме.
        //
        // Половина правил темы касается именно его содержимого — карточек
        // настроек, списков звуков, переключателей, — а в сверке ящик снимался
        // только в тёмной. То есть у самой насыщенной части темы визуального
        // покрытия не было вообще: ровно та ситуация, из-за которой нечитаемые
        // подписи info-блоков прожили в проекте месяцами.
        try {
            const w = ctx();
            if (w.control && !w.control.isDestroyed()) {
                await w.control.webContents.executeJavaScript(
                    "document.querySelector('.tab-btn[data-tab=\"clock\"]').click()"
                );
                // Выезд ящика 240ms + смена размера окна главным процессом.
                await sleep(900);
                await capture(w.control, path.join(outDir, 'light-drawer-clock.png'), log);
                await w.control.webContents.executeJavaScript(
                    "document.getElementById('drawerClose').click()"
                );
                await sleep(700);
                w.control.setSize(400, 700);
                await sleep(300);
            }
        } catch (e) {
            log.warn(`[screenshot] ящик в контрастной теме: ${e.message}`);
        }

        // ОБЯЗАТЕЛЬНО возвращаем тёмную: остальные кадры и эталоны — в ней.
        await sendTheme('dark');

        // Info-блоки полноэкранного дисплея («Текущее время» / «Начало» / «Конец»).
        //
        // Они выключены по умолчанию, поэтому НИ В ОДИН из предыдущих снимков не
        // попадали — целая функция презентационного окна не имела визуального
        // покрытия вообще. Именно поэтому нечитаемые подписи (контраст 2.15:1 во
        // всех восьми темах) не могла поймать никакая сверка картинок.
        //
        // Идёт САМЫМ ПОСЛЕДНИМ намеренно: включение блоков меняет внутреннее
        // состояние дисплея (_lastPreset, позиции), и делать это раньше означало бы
        // подмешивать его во все предыдущие кадры. Снимаем два стиля: круг (базовая
        // раскладка карточек) и аналог (там у блоков свой круглый вид с мини-часами).
        log.info('[screenshot] info blocks');
        // Все ЧЕТЫРЕ стиля, а не два. С 18.08.2026 блок повторяет стиль
        // таймера: у флипа значение стало пластиной со сгибом, у «Цифр» оно
        // набирается выбранным шрифтом стиля. Снимать при этом только круг и
        // аналог означало бы не иметь визуального покрытия ровно у того, что и
        // менялось.
        const blockStyles = ['circle', 'flip', 'analog', 'digits'];
        const shootBlocks = async (suffix) => {
            for (const style of blockStyles) {
                const w = ctx();
                if (!w.display || w.display.isDestroyed()) { break; }
                try {
                    w.display.setSize(1280, 720);
                    w.display.webContents.send('display-settings-update', {
                        timerStyle: style,
                        // Фон — «По теме»: он и есть умолчание чистого профиля,
                        // и без явной посылки кадр зависел бы от того, что
                        // осталось в профиле съёмки от прошлых прогонов.
                        bgMode: 'theme',
                        // Тумблер на блок: общий «Показывать блоки» убран 17.08.2026.
                        // ВСЕ ПЯТЬ, а не три: «До завершения» и название
                        // мероприятия не попадали ни в один кадр, и ровно на
                        // них 18.08.2026 нашлась жалоба «название мероприятия в
                        // круге» — блок без циферблата получал круглую форму.
                        showCurrentTime: true,
                        showEventTime: true,
                        showEndTime: true,
                        showTimeLeft: true,
                        showEventTitle: true,
                        eventTime: '10:00',
                        endTime: '12:00',
                        eventTitle: 'Ежегодная конференция'
                    });
                } catch (e) {
                    log.warn(`[screenshot] info blocks (${style}) failed: ${e.message}`);
                    continue;
                }
                await sleep(600);
                await capture(ctx().display, path.join(outDir, `display-blocks-${suffix}${style}.png`), log);
            }
        };
        await shootBlocks('');

        // Те же четыре стиля на СВЕТЛОМ тоне. До 18.08.2026 такого кадра быть не
        // могло: фон дисплея по умолчанию был тёмным в любой теме.
        log.info('[screenshot] info blocks (light)');
        await sendTheme('light');
        await shootBlocks('light-');
        await sendTheme('dark');

        // Выдвижной ящик настроек.
        //
        // Он закрыт во всех предыдущих снимках, поэтому его содержимое — селекты,
        // поля времени, переключатели вкладок «Часы» и «Полноэкр.» — визуального
        // покрытия не имело вообще. Тот же случай, что был с info-блоками: пока
        // элемент не попал ни в один кадр, никакая сверка картинок про него ничего
        // сказать не может, и правки в нём приходится проверять на слово.
        //
        // Снимаем две вкладки: «Часы» (там четыре переключателя, вернувшиеся в UI)
        // и «Полноэкр.» (там селект монитора, пресет раскладки и поля времени,
        // переехавшие из инлайновых style= на токены).
        //
        // Идёт ПОСЛЕ info-блоков и последним в последовательности: открытие ящика
        // расширяет окно управления примерно до 716 px через resize-control-window,
        // и делать это раньше означало бы менять геометрию под всеми предыдущими
        // кадрами.
        log.info('[screenshot] settings drawer');
        // Возвращаем окно к штатному размеру: перед этим шёл прогон «максимальный
        // размер», и снимок ящика на растянутом окне показывал бы не то, что видит
        // пользователь при обычной работе.
        try {
            const c = ctx().control;
            if (c && !c.isDestroyed()) {
                c.setSize(400, 700);
                await sleep(400);
            }
        } catch (e) {
            log.warn(`[screenshot] drawer resize failed: ${e.message}`);
        }
        // Из четырёх вкладок ящика снимались только две: «Виджет» и «Звуки»
        // не попадали ни в один кадр — а там живут самая длинная карточка
        // приложения (список звуков с селектами) и вторая сетка свотчей.
        for (const tab of ['timer', 'clock', 'display', 'sound']) {
            const w = ctx();
            if (!w.control || w.control.isDestroyed()) { break; }
            try {
                await w.control.webContents.executeJavaScript(`
                    (() => {
                        const btn = document.querySelector('.tab-btn[data-tab="${tab}"]');
                        if (btn) { btn.click(); }
                        return !!btn;
                    })();
                `);
            } catch (e) {
                log.warn(`[screenshot] drawer (${tab}) failed: ${e.message}`);
                continue;
            }
            // Ящик выезжает 240 ms, плюс главный процесс меняет размер окна.
            await sleep(900);
            await capture(ctx().control, path.join(outDir, `control-drawer-${tab}.png`), log);
        }

        // Сверка с эталонами — только по запросу (--visual-check), чтобы обычный
        // прогон скриншотов оставался быстрым и не падал.
        if (process.argv.includes('--visual-check') && nativeImage) {
            const regressions = compareWithBaseline({
                nativeImage,
                outDir,
                baselineDir: path.join(__dirname, '..', 'tests', 'visual-baseline'),
                log
            });
            if (regressions && regressions.length > 0) {
                log.error(`[visual] регрессий: ${regressions.length}`);
                clearTimeout(hardTimeout);
                app.exit(3);
                return;
            }
        }
    } finally {
        // Возвращаем исходные размеры: иначе виджет и часы запомнят последний
        // ресайз последовательности, и следующий прогон снимет кадры другого
        // размера — сверка провалится не из-за регрессии, а из-за нас.
        for (const [name, size] of Object.entries(initialSizes)) {
            const w = ctx()[name];
            if (!w || w.isDestroyed() || !Array.isArray(size)) { continue; }
            try { w.setSize(size[0], size[1]); } catch { /* окно уже закрыто */ }
        }
        await sleep(400); // дать окнам записать восстановленную геометрию
        clearTimeout(hardTimeout);
        log.info('[screenshot] done');
        app.quit();
    }
}

module.exports = { run };
