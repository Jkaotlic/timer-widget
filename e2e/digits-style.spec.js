const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Стиль «Цифры» и выбор шрифта.
 *
 * Всё — КЛИКОМ по видимым элементам: зелёный тест не доказывает, что контрол
 * достижим. В этом проекте #syncClockStyle целый проход просидел внутри
 * display:none при полностью живой логике и зелёном тесте.
 *
 * Профиль e2e ОДИН на весь прогон, поэтому в конце стиль и шрифт возвращаются
 * обратно: спек, оставивший приложение в чужом состоянии, ронял соседний.
 */

async function findWindow(app, probe) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(probe).catch(() => false);
        if (hit) { return w; }
    }
    return null;
}

// Помечаем окно дисплея в ГЛАВНОМ процессе (тот же приём, что в
// e2e/window-drag-geometry.spec.js), чтобы дальше найти его через
// BrowserWindow.getAllWindows() и по-настоящему поменять размер РЕАЛЬНОГО окна —
// а не CSS-масштаб внутри него. Открывается оно в fullscreen (см.
// createDisplayWindow), поэтому сначала снимаем fullscreen, потом задаём размер.
async function tagDisplayWindow(app) {
    await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (win.webContents.getURL().includes('display.html')) { win.__ref = 'displayWindow'; }
        }
    });
}

async function resizeDisplayWindow(app, size) {
    await app.evaluate(({ BrowserWindow }, { width, height }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.__ref === 'displayWindow');
        if (!win) { throw new Error('displayWindow не помечено — забыт вызов tagDisplayWindow()'); }
        if (win.isFullScreen()) { win.setFullScreen(false); }
        win.setSize(width, height);
    }, size);
}

const IS_DISPLAY = () => !!document.getElementById('timerDigits') && !!document.getElementById('timerRing');

function measureDigits() {
    const time = document.getElementById('digitsTime');
    const value = document.getElementById('digitsValue');
    const block = document.getElementById('timerDigits');
    if (!time || !value || !block) { return null; }
    const v = value.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    const cs = getComputedStyle(time);

    // «Надпись целиком» — НЕ собственный CSS-бокс #digitsTime. У него
    // width: fit-content, а знак вынесен через position: absolute — он не
    // участвует в shrink-to-fit родителя вообще, поэтому getBoundingClientRect()
    // контейнера всегда равен getBoundingClientRect() одних только цифр,
    // рисован там знак или нет. Это ровно то же самое число, что и digitsCenter,
    // и сравнение с ним ничего не докажет — понадобилась бы разница, а её нет
    // ПО КОНСТРУКЦИИ, а не потому что знак учтён. Как и в уже работающем
    // e2e/overtime-centering.spec.js, «вся надпись» меряется Range: он
    // отражает РИСОВАННУЮ геометрию всего содержимого, включая абсолютно
    // спозиционированный знак, а не CSS-бокс контейнера.
    const range = document.createRange();
    range.selectNodeContents(time);
    const whole = range.getBoundingClientRect();
    if (range.detach) { range.detach(); }

    return {
        active: block.classList.contains('active'),
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        digitsCenter: v.left + v.width / 2,
        inscriptionCenter: whole.left + whole.width / 2,
        blockCenter: b.left + b.width / 2,
        blockWidth: b.width
    };
}

// Стиль дисплея хранится ТОЛЬКО внутри блока displayExtSettings (у него, в
// отличие от displayTimerScale, нет своего отдельного ключа) — pushDisplaySettings()
// пишет его через saveExtSettings() при каждом клике по сегменту. localStorage в
// этом приложении ОБЩИЙ для всех окон (все они file://), а профиль e2e ОДИН на
// весь прогон (см. e2e/launch.js) — не вернуть стиль к circle значит оставить
// соседнему спеку чужой стиль дисплея уже на первом кадре, молча.
async function resetDisplayStyle(page) {
    if (!page || page.isClosed()) { return; }
    await page.evaluate(() => {
        try {
            const prev = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
            prev.displayTimerStyle = 'circle';
            localStorage.setItem('displayExtSettings', JSON.stringify(prev));
        } catch { /* профиль грязный, но не по вине этого блока — не маскируем ошибку теста */ }
    }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Виджет
// ---------------------------------------------------------------------------

// Помечаем окно виджета в ГЛАВНОМ процессе — тот же приём, что для дисплея
// выше и что в e2e/window-drag-geometry.spec.js. В отличие от дисплея виджет
// НЕ fullscreen, поэтому setSize() можно звать сразу, без снятия fullscreen.
async function tagWidgetWindow(app) {
    await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (win.webContents.getURL().includes('electron-widget.html')) { win.__ref = 'widgetWindow'; }
        }
    });
}

async function resizeWidgetWindow(app, size) {
    await app.evaluate(({ BrowserWindow }, { width, height }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.__ref === 'widgetWindow');
        if (!win) { throw new Error('widgetWindow не помечено — забыт вызов tagWidgetWindow()'); }
        win.setSize(width, height);
    }, size);
}

// Опознаём окно виджета по паре элементов, которых нет в других трёх окнах —
// тот же приём, что IS_DISPLAY выше.
const IS_WIDGET = () => !!document.getElementById('widgetDigits') && !!document.getElementById('wFlipHoursGroup');

function measureWidgetDigits() {
    const time = document.getElementById('widgetDigitsTime');
    const value = document.getElementById('widgetDigitsValue');
    const block = document.getElementById('widgetDigits');
    if (!time || !value || !block) { return null; }
    const v = value.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    const cs = getComputedStyle(time);

    // Тот же приём, что measureDigits() для дисплея выше: #widgetDigitsTime
    // имеет width: fit-content и знак вне потока, поэтому его собственный
    // CSS-бокс всегда равен боксу одних цифр — измерять надо РИСОВАННУЮ
    // геометрию всего содержимого через Range, а не getBoundingClientRect()
    // контейнера.
    const range = document.createRange();
    range.selectNodeContents(time);
    const whole = range.getBoundingClientRect();
    if (range.detach) { range.detach(); }

    return {
        active: block.classList.contains('active'),
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        digitsCenter: v.left + v.width / 2,
        inscriptionCenter: whole.left + whole.width / 2,
        blockCenter: b.left + b.width / 2,
        blockWidth: b.width
    };
}

// Стиль виджета хранится в displayExtSettings ДВАЖДЫ: `widgetTimerStyle`
// (актуальное имя) и `timerStyle` (legacy-зеркало, которое пишет `alsoWrite`
// в settings-schema.js ради отката на предыдущую версию). Клик по сегменту
// пишет ОБА поля через saveExtSettings() — сбрасывать нужно тоже оба, иначе
// откат/легаси-fallback в следующем спеке молча подхватит 'digits'.
async function resetWidgetStyle(page) {
    if (!page || page.isClosed()) { return; }
    await page.evaluate(() => {
        try {
            const prev = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
            prev.widgetTimerStyle = 'circle';
            prev.timerStyle = 'circle';
            localStorage.setItem('displayExtSettings', JSON.stringify(prev));
        } catch { /* профиль грязный, но не по вине этого блока — не маскируем ошибку теста */ }
    }).catch(() => {});
}

// Изменение размера окна виджета (напрямую через BrowserWindow, как и ползунок
// «Масштаб» через IPC) проходит через тот же обработчик `resize` в рендерере,
// что и Ctrl+колесо, и ПЕРСИСТИТ новый scalePct в localStorage.widgetGeometry
// (см. saveGeometry() в electron-widget.html). Снимок/восстановление вместо
// записи фиксированного значения — единственный способ не затереть то, что
// туда уже мог положить другой спек (например, перетаскивание в
// window-drag-geometry.spec.js).
async function snapshotWidgetGeometry(page) {
    if (!page || page.isClosed()) { return null; }
    return page.evaluate(() => localStorage.getItem('widgetGeometry')).catch(() => null);
}

async function restoreWidgetGeometry(page, raw) {
    if (!page || page.isClosed()) { return; }
    await page.evaluate((value) => {
        try {
            if (value) { localStorage.setItem('widgetGeometry', value); }
            else { localStorage.removeItem('widgetGeometry'); }
        } catch { /* профиль грязный, но не по вине этого блока */ }
    }, raw).catch(() => {});
}

test('стиль «Цифры» доходит до полноэкранного окна кликом, и кегль реально подгоняется под окно', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');

        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);

        // Открыть вкладку «Дисплей» — только кликом.
        // Отдельной кнопки открытия ящика нет: вкладка сама его открывает
        // (у .tab-btn стоит aria-controls="settingsDrawer").
        await control.click('.tab-btn[data-tab="display"]');
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await control.waitForTimeout(700);

        const display = await findWindow(app, IS_DISPLAY);
        expect(display, 'полноэкранное окно должно быть найдено').not.toBeNull();

        const m = await display.evaluate(measureDigits);
        expect(m.active, 'блок «Цифры» должен стать активным').toBe(true);
        expect(m.fontSize, 'кегль должен быть подобран под окно').toBeGreaterThan(40);

        // Кольца в этом стиле нет.
        const ringVisible = await display.evaluate(
            () => document.getElementById('timerRing').classList.contains('active')
        );
        expect(ringVisible, 'кольцо в стиле «Цифры» показываться не должно').toBe(false);

        // ГЛАВНАЯ проверка. `m.fontSize > 40` сама по себе ловит только явные
        // провалы (0px), а не подмену подгонки CSS-фоллбэком: `.digits-time`
        // объявляет `font-size: var(--digits-font-size, 120px)`, и 120px тоже
        // проходит порог >40. Ровно это и было настоящим багом: `case 'digits':`
        // в setTimerStyle() не звал updateDigitsScale(), а обе точки, которые
        // звали его сами (document.fonts.ready, смена формата ЧЧ), почти всегда
        // срабатывают ДО того, как пользователь включит стиль, — так что
        // `--digits-font-size` оставалась НЕВЫСТАВЛЕННОЙ, и рисовался жёсткий
        // фоллбэк 120px независимо от окна. Три независимых утверждения ниже
        // ловят именно это: свойство обязано быть реально выставлено (не
        // пустая строка), а при РЕАЛЬНОМ изменении размера ОКНА (не CSS-масштаба
        // внутри него — это отдельно проверяет следующий test()) кегль обязан
        // меняться вместе с ним.
        const varBeforeResize = await display.evaluate(
            () => document.getElementById('digitsTime').style.getPropertyValue('--digits-font-size').trim()
        );
        expect(varBeforeResize, '--digits-font-size обязана быть реально выставлена, а не пуста').not.toBe('');

        await tagDisplayWindow(app);
        await resizeDisplayWindow(app, { width: 700, height: 520 });
        await display.waitForTimeout(700);
        const wide = await display.evaluate(measureDigits);

        await resizeDisplayWindow(app, { width: 420, height: 340 });
        await display.waitForTimeout(700);
        const narrow = await display.evaluate(measureDigits);

        expect(wide.fontSize, 'кегль на широком окне обязан быть подобран, а не нулевым').toBeGreaterThan(0);
        expect(narrow.fontSize, 'кегль на узком окне обязан быть подобран, а не нулевым').toBeGreaterThan(0);
        expect(
            narrow.fontSize,
            `кегль обязан меняться вместе с окном: широкое окно дало ${wide.fontSize}px, узкое — `
            + `${narrow.fontSize}px. Если оба совпадают (например, оба 120), значит рисуется `
            + 'CSS-фоллбэк, а не настоящая подгонка по эталону.'
        ).toBeLessThan(wide.fontSize);
    } finally {
        await resetDisplayStyle(control);
        await app.close();
    }
});

test('масштаб дисплея действует и на стиль «Цифры» — ползунком и колесом', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);

        // Отдельной кнопки открытия ящика нет: вкладка сама его открывает
        // (у .tab-btn стоит aria-controls="settingsDrawer").
        await control.click('.tab-btn[data-tab="display"]');
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await control.waitForTimeout(700);

        const display = await findWindow(app, IS_DISPLAY);
        const readTransform = () => document.getElementById('timerDigits').style.transform;

        const before = await display.evaluate(readTransform);

        // Ползунок «Масштаб таймера» во вкладке «Дисплей» (data-tab="display").
        await control.evaluate(() => {
            const slider = document.getElementById('displayTimerScale');
            slider.value = '150';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await display.waitForTimeout(500);
        const afterSlider = await display.evaluate(readTransform);
        expect(afterSlider).toContain('scale(1.5)');
        expect(afterSlider).not.toBe(before);

        // Ctrl+колесо.
        await display.evaluate(() => {
            document.body.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
            }));
        });
        await display.waitForTimeout(300);
        const afterWheel = await display.evaluate(readTransform);
        expect(afterWheel, 'колесо обязано менять масштаб').not.toBe(afterSlider);

        // Возвращаем масштаб дисплея к дефолту — тот же общий ключ, что чинит
        // e2e/display-timer-scale.spec.js, живёт в общем профиле.
        await control.evaluate(() => {
            localStorage.setItem('displayTimerScale', '100');
            try {
                const prev = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
                prev.displayTimerScale = 100;
                localStorage.setItem('displayExtSettings', JSON.stringify(prev));
            } catch { /* см. resetDisplayStyle выше */ }
        });
    } finally {
        await resetDisplayStyle(control);
        await app.close();
    }
});

test('в перерасходе ЦИФРЫ остаются на оси окна, а надпись — нет', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);

        // Отдельной кнопки открытия ящика нет: вкладка сама его открывает
        // (у .tab-btn стоит aria-controls="settingsDrawer").
        await control.click('.tab-btn[data-tab="display"]');
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await control.waitForTimeout(500);

        // Загнать таймер в перерасход.
        await control.evaluate(() => {
            window.ipcRenderer.send('timer-command', { type: 'set', seconds: 1, allowNegative: true });
            window.ipcRenderer.send('timer-command', { type: 'start' });
        });
        await control.waitForTimeout(3500);

        const display = await findWindow(app, IS_DISPLAY);
        const m = await display.evaluate(measureDigits);

        expect(Math.abs(m.digitsCenter - m.blockCenter),
            'цифры обязаны стоять на оси окна').toBeLessThan(1.5);
        expect(Math.abs(m.inscriptionCenter - m.blockCenter),
            'надпись целиком центрированной быть НЕ должна — это доказывает, что знак вне потока'
        ).toBeGreaterThan(1.5);

        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' }));
    } finally {
        await resetDisplayStyle(control);
        await app.close();
    }
});

test('стиль «Цифры» доходит до виджета кликом, и кегль реально подгоняется под окно', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    let widget = null;
    let geometryBefore = null;
    try {
        await control.waitForLoadState('domcontentloaded');

        // Достижимость — только кликом: сначала открыть окно кнопкой на панели,
        // затем переключить стиль сегментом на вкладке «Виджет». Открытие ждём
        // событием, а не findWindow() сразу после клика — окно ещё не
        // существует в момент возврата из click().
        await control.click('#openWidgetBtn');
        widget = await app.waitForEvent('window');
        await widget.waitForLoadState('domcontentloaded');
        expect(await widget.evaluate(IS_WIDGET), 'открывшееся окно должно быть виджетом').toBe(true);

        geometryBefore = await snapshotWidgetGeometry(widget);

        await control.click('.tab-btn[data-tab="timer"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#timerStyle button[data-val="digits"]');
        await control.waitForTimeout(500);

        const m = await widget.evaluate(measureWidgetDigits);
        expect(m, 'блок #widgetDigits должен существовать в разметке').not.toBeNull();
        expect(m.active, 'блок «Цифры» должен стать активным').toBe(true);
        expect(m.fontSize, 'кегль должен быть подобран под окно').toBeGreaterThan(10);

        // ГЛАВНАЯ проверка, тем же приёмом, что и для дисплея выше (см.
        // комментарий там). `.widget-digits-time` объявляет
        // `font-size: var(--digits-font-size, 40px)` — CSS-фоллбэк 40px тоже
        // проходит порог «> 10», поэтому одного значения кегля недостаточно:
        // нужно доказать, что переменная РЕАЛЬНО выставлена, а не что кегль
        // просто не нулевой, и что она меняется на РЕАЛЬНО разных размерах
        // ОКНА (не CSS-масштабе внутри — тот отдельно проверяет следующий
        // test()).
        const varBeforeResize = await widget.evaluate(
            () => document.getElementById('widgetDigitsTime').style.getPropertyValue('--digits-font-size').trim()
        );
        expect(varBeforeResize, '--digits-font-size обязана быть реально выставлена, а не пуста').not.toBe('');

        await tagWidgetWindow(app);
        await resizeWidgetWindow(app, { width: 500, height: 420 });
        await widget.waitForTimeout(500);
        const wide = await widget.evaluate(measureWidgetDigits);

        await resizeWidgetWindow(app, { width: 220, height: 180 });
        await widget.waitForTimeout(500);
        const narrow = await widget.evaluate(measureWidgetDigits);

        expect(wide.fontSize, 'кегль на широком окне обязан быть подобран, а не нулевым').toBeGreaterThan(0);
        expect(narrow.fontSize, 'кегль на узком окне обязан быть подобран, а не нулевым').toBeGreaterThan(0);
        expect(
            narrow.fontSize,
            `кегль обязан меняться вместе с окном: широкое окно дало ${wide.fontSize}px, узкое — `
            + `${narrow.fontSize}px. Если оба совпадают, значит рисуется CSS-фоллбэк 40px, а не `
            + 'настоящая подгонка по эталону.'
        ).toBeLessThan(wide.fontSize);
    } finally {
        await resetWidgetStyle(control);
        await restoreWidgetGeometry(widget, geometryBefore);
        await app.close();
    }
});

test('масштаб виджета действует и на стиль «Цифры» — ползунком', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    let widget = null;
    let geometryBefore = null;
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.click('#openWidgetBtn');
        widget = await app.waitForEvent('window');
        await widget.waitForLoadState('domcontentloaded');
        expect(await widget.evaluate(IS_WIDGET), 'открывшееся окно должно быть виджетом').toBe(true);

        geometryBefore = await snapshotWidgetGeometry(widget);

        await control.click('.tab-btn[data-tab="timer"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#timerStyle button[data-val="digits"]');
        await control.waitForTimeout(500);

        // Панель шлёт СВОЙ начальный widget-style-update (с текущим
        // timerScale) через 600мс после своей загрузки — независимо от того,
        // когда открылся виджет. Это гонка: если она успевает раньше строки
        // ниже, `_lastPushedTimerScale` в виджете уже определён; если нет —
        // ползунок ниже стал бы ПЕРВЫМ пришедшим значением, а первое значение
        // виджет только запоминает, не резайзя (иначе фоновая гидратация
        // задвигала бы масштаб, восстановленный Ctrl+колесом). Прайминг тем
        // же значением 100 детерминированно закрывает гонку в любом порядке:
        // ниже он либо совпадёт с уже пришедшим 100 и ничего не сделает, либо
        // станет тем самым «первым значением» сам — и тогда РЕАЛЬНОЕ
        // изменение на 250 будет уже вторым, для которого резайз применяется.
        await control.evaluate(() => {
            const slider = document.getElementById('timerScale');
            slider.value = '100';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await widget.waitForTimeout(300);

        const before = await widget.evaluate(measureWidgetDigits);

        // Ползунок «Масштаб» во вкладке «Виджет» реально меняет размер ОКНА
        // (widget-resize IPC), а не CSS-transform: scale — поэтому это тот же
        // самый механизм подгонки кегля, что и прямой resize выше, только
        // достигнутый кликом по видимому контролу, как того требует бриф.
        await control.evaluate(() => {
            const slider = document.getElementById('timerScale');
            slider.value = '250';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await widget.waitForTimeout(600);

        const after = await widget.evaluate(measureWidgetDigits);
        expect(after.fontSize, 'кегль обязан вырасти вместе с масштабом виджета')
            .toBeGreaterThan(before.fontSize);
    } finally {
        // Возвращаем ползунок и виджет к 100% — тот же общий ключ
        // displayExtSettings, что и стиль, живёт в общем e2e-профиле.
        await control.evaluate(() => {
            const slider = document.getElementById('timerScale');
            if (slider) {
                slider.value = '100';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
            try {
                const prev = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
                prev.widgetTimerScale = 100;
                prev.timerScale = 100;
                localStorage.setItem('displayExtSettings', JSON.stringify(prev));
            } catch { /* см. resetWidgetStyle выше */ }
        }).catch(() => {});
        await resetWidgetStyle(control);
        await restoreWidgetGeometry(widget, geometryBefore);
        await app.close();
    }
});

// ---------------------------------------------------------------------------
// Часы
// ---------------------------------------------------------------------------

// Тот же приём, что для дисплея/виджета выше.
async function tagClockWindow(app) {
    await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (win.webContents.getURL().includes('electron-clock-widget.html')) { win.__ref = 'clockWindow'; }
        }
    });
}

async function resizeClockWindow(app, size) {
    await app.evaluate(({ BrowserWindow }, { width, height }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.__ref === 'clockWindow');
        if (!win) { throw new Error('clockWindow не помечено — забыт вызов tagClockWindow()'); }
        win.setSize(width, height);
    }, size);
}

// Опознаём окно часов по паре элементов, которых нет в других трёх окнах.
// `wFlipHr1` тоже есть в виджете, поэтому дискриминатор — `clockAnalogHour`
// (у виджета аналоговая стрелка называется `widgetHandHour`).
const IS_CLOCK = () => !!document.getElementById('clockDigits') && !!document.getElementById('clockAnalogHour');

function measureClockDigits() {
    const time = document.getElementById('clockDigitsTime');
    const value = document.getElementById('clockDigitsValue');
    const block = document.getElementById('clockDigits');
    if (!time || !value || !block) { return null; }
    const v = value.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    const cs = getComputedStyle(time);

    // Знака у часов нет вообще (Step 1 брифа) — ни .clock-digits-sign, ни
    // абсолютного позиционирования, поэтому, в отличие от measureDigits()/
    // measureWidgetDigits() выше, нет смысла отдельно мерить «надпись целиком»
    // Range'ом: #clockDigitsTime и есть вся надпись. Зато есть смысл сравнить
    // ширину значения с шириной блока — именно эта пара ловит переполнение,
    // если эталон замера («88:88»/«8:88:88» из digits-style.js) окажется уже
    // реального времени (например, 12-часовой формат добавляет « AM»/« PM»,
    // которых ни один из двух эталонов не содержит).
    return {
        active: block.classList.contains('active'),
        fontFamily: cs.fontFamily,
        fontSize: parseFloat(cs.fontSize),
        text: value.textContent,
        valueWidth: v.width,
        blockWidth: b.width
    };
}

// Стиль часов хранится в ДВУХ местах: `displayExtSettings.clockStyle` (его
// восстанавливает ПАНЕЛЬ через settings-schema.js на своей загрузке) и
// `clockWidgetSettings.clockStyle` (его пишет и читает САМО окно часов через
// свои loadSettings()/saveSettings()). Клик по сегменту в панели пишет ОБА —
// сбрасывать нужно тоже оба, иначе соседний спек в этом же прогоне унаследует
// либо чужой выбор в панели, либо чужой выбор в самом окне.
async function resetClockStyle(page) {
    if (!page || page.isClosed()) { return; }
    await page.evaluate(() => {
        try {
            const prevExt = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
            prevExt.clockStyle = 'circle';
            localStorage.setItem('displayExtSettings', JSON.stringify(prevExt));
            const prevClock = JSON.parse(localStorage.getItem('clockWidgetSettings') || '{}');
            prevClock.clockStyle = 'circle';
            localStorage.setItem('clockWidgetSettings', JSON.stringify(prevClock));
        } catch { /* профиль грязный, но не по вине этого блока — не маскируем ошибку теста */ }
    }).catch(() => {});
}

async function snapshotClockGeometry(page) {
    if (!page || page.isClosed()) { return null; }
    return page.evaluate(() => localStorage.getItem('clockGeometry')).catch(() => null);
}

async function restoreClockGeometry(page, raw) {
    if (!page || page.isClosed()) { return; }
    await page.evaluate((value) => {
        try {
            if (value) { localStorage.setItem('clockGeometry', value); }
            else { localStorage.removeItem('clockGeometry'); }
        } catch { /* см. resetClockStyle выше */ }
    }, raw).catch(() => {});
}

test('стиль «Цифры» доходит до часов кликом, и кегль реально подгоняется под окно', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    let clock = null;
    let geometryBefore = null;
    try {
        await control.waitForLoadState('domcontentloaded');

        // Достижимость — только кликом: открыть часы кнопкой на панели, затем
        // переключить стиль сегментом на вкладке «Часы». Открытие ждём
        // событием, а не findWindow() сразу после клика — окно ещё не
        // существует в момент возврата из click().
        await control.click('#openClockBtn');
        clock = await app.waitForEvent('window');
        await clock.waitForLoadState('domcontentloaded');
        expect(await clock.evaluate(IS_CLOCK), 'открывшееся окно должно быть часами').toBe(true);

        geometryBefore = await snapshotClockGeometry(clock);

        await control.click('.tab-btn[data-tab="clock"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#clockStyle button[data-val="digits"]');
        await control.waitForTimeout(500);

        const m = await clock.evaluate(measureClockDigits);
        expect(m, 'блок #clockDigits должен существовать в разметке').not.toBeNull();
        expect(m.active, 'блок «Цифры» должен стать активным').toBe(true);
        expect(m.fontSize, 'кегль должен быть подобран под окно').toBeGreaterThan(10);

        // ГЛАВНАЯ проверка, тем же приёмом, что и для виджета/дисплея выше (см.
        // комментарии там). `.clock-digits-time` объявляет
        // `font-size: var(--digits-font-size, 40px)` — CSS-фоллбэк 40px тоже
        // проходит порог «> 10», поэтому одного значения кегля недостаточно:
        // нужно доказать, что переменная РЕАЛЬНО выставлена, а не что кегль
        // просто не нулевой, и что она меняется на РЕАЛЬНО разных размерах
        // ОКНА.
        const varBeforeResize = await clock.evaluate(
            () => document.getElementById('clockDigitsTime').style.getPropertyValue('--digits-font-size').trim()
        );
        expect(varBeforeResize, '--digits-font-size обязана быть реально выставлена, а не пуста').not.toBe('');

        await tagClockWindow(app);
        await resizeClockWindow(app, { width: 500, height: 420 });
        await clock.waitForTimeout(500);
        const wide = await clock.evaluate(measureClockDigits);

        await resizeClockWindow(app, { width: 220, height: 180 });
        await clock.waitForTimeout(500);
        const narrow = await clock.evaluate(measureClockDigits);

        expect(wide.fontSize, 'кегль на широком окне обязан быть подобран, а не нулевым').toBeGreaterThan(0);
        expect(narrow.fontSize, 'кегль на узком окне обязан быть подобран, а не нулевым').toBeGreaterThan(0);
        expect(
            narrow.fontSize,
            `кегль обязан меняться вместе с окном: широкое окно дало ${wide.fontSize}px, узкое — `
            + `${narrow.fontSize}px. Если оба совпадают, значит рисуется CSS-фоллбэк 40px, а не `
            + 'настоящая подгонка по эталону.'
        ).toBeLessThan(wide.fontSize);
    } finally {
        await resetClockStyle(control);
        await restoreClockGeometry(clock, geometryBefore);
        await app.close();
    }
});

test('часы «Цифры» не обрезаются в 12-часовом формате с секундами (AM/PM)', async () => {
    // Эталон замера в digits-style.js — «88:88» / «8:88:88» — смоделирован под
    // ТАЙМЕР (MM:SS / H:MM:SS) и ничего не знает про суффикс « AM»/« PM»: этот
    // суффикс существует только у часов. updateScaling() в часах передаёт
    // третьим аргументом measureDigits() showSeconds (ближайший по форме
    // аналог из двух готовых эталонов), но при 12-часовом формате реальная
    // строка («11:59:59 PM», 12 символов) заведомо шире обоих эталонов — риск
    // в том, что подобранный кегль отрежет часть текста за краем блока.
    // Не полагаемся на аналогию с виджетом/дисплеем (у них AM/PM не бывает
    // вообще) — меряем.
    const { app, control } = await launchApp();
    let clock = null;
    let geometryBefore = null;
    try {
        await control.waitForLoadState('domcontentloaded');

        await control.click('#openClockBtn');
        clock = await app.waitForEvent('window');
        await clock.waitForLoadState('domcontentloaded');
        expect(await clock.evaluate(IS_CLOCK), 'открывшееся окно должно быть часами').toBe(true);

        geometryBefore = await snapshotClockGeometry(clock);

        await control.click('.tab-btn[data-tab="clock"]');
        await control.waitForSelector('#settingsDrawer.open');

        // Секунды включены по умолчанию (showSeconds: true). 24-часовой формат
        // выключаем кликом по подписи — сам чекбокс визуально нулевого
        // размера (`.toggle-switch input { opacity: 0; width: 0; height: 0 }`),
        // клик по нему висит в ожидании actionability. `label[for="clockFormat24h"]`
        // — тот же путь достижимости, что уже используют reachable-controls.spec.js
        // и e2e/clock-style-sync.spec.js для однотипных тумблеров.
        const format24hChecked = await control.evaluate(
            () => document.getElementById('clockFormat24h').checked
        );
        if (format24hChecked) {
            await control.click('label[for="clockFormat24h"]');
        }
        await control.waitForTimeout(400);

        await control.click('#clockStyle button[data-val="digits"]');
        await control.waitForTimeout(500);

        // Небольшое окно — как и для основного теста, сжимаем: переполнение на
        // узком окне заметнее всего.
        await tagClockWindow(app);
        await resizeClockWindow(app, { width: 320, height: 260 });
        await clock.waitForTimeout(500);

        const m = await clock.evaluate(measureClockDigits);
        console.log('12h+секунды →', JSON.stringify(m));

        expect(m.active, 'блок «Цифры» должен быть активен').toBe(true);
        expect(m.text, 'должен присутствовать суффикс AM/PM').toMatch(/[AP]M$/);
        expect(
            m.valueWidth,
            `значение (${m.valueWidth}px, "${m.text}") не должно вылезать за блок (${m.blockWidth}px)`
        ).toBeLessThanOrEqual(m.blockWidth + 1);
    } finally {
        // Возвращаем 24-часовой формат.
        await control.evaluate(() => {
            const el = document.getElementById('clockFormat24h');
            if (el && !el.checked) { el.click(); }
        });
        await control.waitForTimeout(300);
        await resetClockStyle(control);
        await restoreClockGeometry(clock, geometryBefore);
        await app.close();
    }
});

test('выбор «Цифры» для часов не включает синхронизацию со стилем виджета', async () => {
    // Отдельное требование брифа: смена стиля ЧАСОВ (в отличие от смены стиля
    // ВИДЖЕТА при включённой синхронизации) не должна включать
    // #syncClockStyle. Существующий обработчик clockStyleEl уже гасит
    // синхронизацию при РУЧНОМ выборе, но никогда её не включает — проверяем
    // это поведение конкретно для нового пятого значения 'digits', а не
    // полагаемся на то, что оно «наверное» работает как остальные четыре.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.click('.tab-btn[data-tab="clock"]');
        await control.waitForSelector('#settingsDrawer.open');

        const before = await control.evaluate(() => document.getElementById('syncClockStyle').checked);
        expect(before, 'синхронизация обязана быть выключена по умолчанию').toBe(false);

        await control.click('#clockStyle button[data-val="digits"]');
        await control.waitForTimeout(400);

        const after = await control.evaluate(() => ({
            syncChecked: document.getElementById('syncClockStyle').checked,
            clockStyleValue: document.getElementById('clockStyle').value,
            rowVisible: document.getElementById('clockStyleRow').offsetParent !== null
        }));
        console.log('после выбора «Цифры» →', JSON.stringify(after));

        expect(after.syncChecked, '«Цифры» в часах не должны включать синхронизацию со стилем виджета').toBe(false);
        expect(after.clockStyleValue).toBe('digits');
        expect(after.rowVisible, 'строка выбора стиля часов должна остаться видимой').toBe(true);
    } finally {
        await resetClockStyle(control);
        await app.close();
    }
});

// ---------------------------------------------------------------------------
// Шрифт стиля «Цифры» (Task 7)
// ---------------------------------------------------------------------------

// Возвращает три шрифта к умолчанию 'inter' напрямую в localStorage — тот же
// приём, что resetWidgetStyle/resetClockStyle/resetDisplayStyle выше:
// профиль e2e ОДИН на весь прогон, и клик после теста был бы лишним источником
// гонок с уже закрывающимися окнами.
async function resetDigitsFonts(page) {
    if (!page || page.isClosed()) { return; }
    await page.evaluate(() => {
        try {
            const ext = JSON.parse(localStorage.getItem('displayExtSettings') || '{}');
            ext.widgetDigitsFont = 'inter';
            ext.displayDigitsFont = 'inter';
            ext.clockDigitsFont = 'inter';
            localStorage.setItem('displayExtSettings', JSON.stringify(ext));
            const clock = JSON.parse(localStorage.getItem('clockWidgetSettings') || '{}');
            clock.clockDigitsFont = 'inter';
            localStorage.setItem('clockWidgetSettings', JSON.stringify(clock));
        } catch { /* профиль грязный, но не по вине этого блока — не маскируем ошибку теста */ }
    }).catch(() => {});
}

test('font-select: присваивание .value молчит, событие шлёт только клик', async () => {
    // Прямая проверка инварианта из font-select.js/attachFontSelect (тот же,
    // что у _attachSegmented — см. подробный разбор в CLAUDE.md про
    // синхронизацию стиля часов). У сегментированного контрола инвариант
    // проверяется КОСВЕННО, через побочный эффект (синхронизация не гаснет
    // при restore). У font-select такого естественного побочного эффекта нет
    // — эта проверка прямая: слушатель считает события, присваивание не
    // должно его дёрнуть, клик — обязан.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');

        const result = await control.evaluate(() => {
            const el = document.getElementById('widgetDigitsFont');
            let changes = 0;
            const onChange = () => { changes += 1; };
            el.addEventListener('change', onChange);

            const activeId = () => el.getAttribute('aria-activedescendant');
            const selectedId = () => {
                const on = el.querySelector('.font-option[aria-selected="true"]');
                return on ? on.id : null;
            };

            el.value = 'oswald';
            const afterAssign = { changes, value: el.value, active: activeId(), selected: selectedId() };

            const opt = el.querySelector('.font-option[data-val="mono"]');
            opt.click();
            const afterClick = { changes, value: el.value, active: activeId(), selected: selectedId() };

            el.removeEventListener('change', onChange);
            return { afterAssign, afterClick };
        });

        expect(result.afterAssign.value, 'присваивание обязано долететь до .value').toBe('oswald');
        expect(result.afterAssign.changes, 'присваивание .value НЕ должно слать change').toBe(0);
        expect(result.afterClick.value, 'клик обязан долететь до .value').toBe('mono');
        expect(result.afterClick.changes, 'клик обязан прислать РОВНО одно change').toBe(1);

        // Фокус остаётся на КОНТЕЙНЕРЕ (у пунктов tabindex=-1), поэтому
        // единственный канал, которым ассистивная технология узнаёт выбранный
        // пункт, — aria-activedescendant. Он обязан указывать на тот же пункт,
        // что и aria-selected, ОБОИМИ путями: и присваиванием (восстановление
        // настройки при загрузке панели), и кликом. Идентификатор содержит id
        // контейнера — на панели три независимых списка в одном document.
        expect(result.afterAssign.active, 'после присваивания активный потомок = выбранный пункт')
            .toBe('widgetDigitsFont-option-oswald');
        expect(result.afterAssign.selected, 'aria-selected обязан совпасть с aria-activedescendant')
            .toBe(result.afterAssign.active);
        expect(result.afterClick.active, 'после клика активный потомок = выбранный пункт')
            .toBe('widgetDigitsFont-option-mono');
        expect(result.afterClick.selected, 'aria-selected обязан совпасть с aria-activedescendant')
            .toBe(result.afterClick.active);
    } finally {
        await resetDigitsFonts(control);
        await app.close();
    }
});

test('строка выбора шрифта видна только при стиле «Цифры» — во всех трёх вкладках', async () => {
    // launchApp() возвращает { app, control } — так её зовут все живые спеки
    // в e2e/. Вызов вида `const app = await launchApp()` падает TypeError.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');

        const cases = [
            { tab: 'timer', styleSel: '#timerStyle', row: '#widgetDigitsFontRow' },
            { tab: 'clock', styleSel: '#clockStyle', row: '#clockDigitsFontRow' },
            { tab: 'display', styleSel: '#displayTimerStyle', row: '#displayDigitsFontRow' }
        ];

        for (const c of cases) {
            await control.click(`.tab-btn[data-tab="${c.tab}"]`);
            await control.waitForSelector('#settingsDrawer.open');

            await expect(control.locator(c.row), `${c.row}: при circle обязана быть скрыта`).toBeHidden();

            await control.click(`${c.styleSel} button[data-val="digits"]`);
            await expect(control.locator(c.row), `${c.row}: при digits обязана стать видимой`).toBeVisible();

            await control.click(`${c.styleSel} button[data-val="circle"]`);
            await expect(control.locator(c.row), `${c.row}: возврат на circle обязан снова её скрыть`).toBeHidden();
        }
    } finally {
        await resetWidgetStyle(control);
        await resetClockStyle(control);
        await resetDisplayStyle(control);
        await app.close();
    }
});

test('выбор шрифта доходит до СВОЕГО окна кликом и не задевает два других', async () => {
    // Требование ревью прошлых задач: проводка шрифта (панель → IPC → реальное
    // начертание в окне) не была покрыта НИ ОДНИМ тестом. Здесь измеряется
    // getComputedStyle(...).fontFamily В ОКНЕ — не в панели — для ВСЕХ ТРЁХ
    // окон на каждом шаге, чтобы заодно доказать независимость: смена шрифта
    // в одной вкладке не переносится в два других открытых окна.
    const { app, control } = await launchApp();
    let widget = null;
    let clock = null;
    let widgetGeometryBefore = null;
    let clockGeometryBefore = null;
    try {
        await control.waitForLoadState('domcontentloaded');

        // Открыть виджет и часы кнопками панели (достижимость — только кликом).
        await control.click('#openWidgetBtn');
        widget = await app.waitForEvent('window');
        await widget.waitForLoadState('domcontentloaded');
        expect(await widget.evaluate(IS_WIDGET), 'открывшееся окно должно быть виджетом').toBe(true);
        widgetGeometryBefore = await snapshotWidgetGeometry(widget);

        await control.click('#openClockBtn');
        clock = await app.waitForEvent('window');
        await clock.waitForLoadState('domcontentloaded');
        expect(await clock.evaluate(IS_CLOCK), 'открывшееся окно должно быть часами').toBe(true);
        clockGeometryBefore = await snapshotClockGeometry(clock);

        // Дисплей открывается по IPC, как и в остальных тестах этого файла.
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1500);
        const display = await findWindow(app, IS_DISPLAY);
        expect(display, 'полноэкранное окно должно быть найдено').not.toBeNull();

        // Панель шлёт свой начальный widget-style-update ~600мс после загрузки
        // (см. loadSettings) — даём этой гонке отгреметь до первого замера.
        await control.waitForTimeout(900);

        const fontFamilyOf = (win, elId) => win.evaluate(
            (id) => getComputedStyle(document.getElementById(id)).fontFamily, elId
        );

        const baseline = {
            widget: await fontFamilyOf(widget, 'widgetDigitsTime'),
            clock: await fontFamilyOf(clock, 'clockDigitsTime'),
            display: await fontFamilyOf(display, 'digitsTime')
        };

        // --- Виджет: «Цифры» → Bebas Neue ---
        await control.click('.tab-btn[data-tab="timer"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#timerStyle button[data-val="digits"]');
        await expect(control.locator('#widgetDigitsFontRow')).toBeVisible();
        await control.click('#widgetDigitsFont .font-option[data-val="bebas"]');
        await widget.waitForTimeout(400);

        const afterWidget = {
            widget: await fontFamilyOf(widget, 'widgetDigitsTime'),
            clock: await fontFamilyOf(clock, 'clockDigitsTime'),
            display: await fontFamilyOf(display, 'digitsTime')
        };
        expect(afterWidget.widget, 'виджет обязан получить выбранный шрифт').toContain('Bebas Neue');
        expect(afterWidget.clock, 'часы не должны увидеть шрифт виджета').toBe(baseline.clock);
        expect(afterWidget.display, 'дисплей не должен увидеть шрифт виджета').toBe(baseline.display);

        // --- Часы: «Цифры» → Oswald ---
        await control.click('.tab-btn[data-tab="clock"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#clockStyle button[data-val="digits"]');
        await expect(control.locator('#clockDigitsFontRow')).toBeVisible();
        await control.click('#clockDigitsFont .font-option[data-val="oswald"]');
        await clock.waitForTimeout(400);

        const afterClock = {
            widget: await fontFamilyOf(widget, 'widgetDigitsTime'),
            clock: await fontFamilyOf(clock, 'clockDigitsTime'),
            display: await fontFamilyOf(display, 'digitsTime')
        };
        expect(afterClock.clock, 'часы обязаны получить выбранный шрифт').toContain('Oswald');
        expect(afterClock.widget, 'шрифт виджета не должен был отъехать').toContain('Bebas Neue');
        expect(afterClock.display, 'дисплей не должен увидеть шрифт часов').toBe(baseline.display);

        // --- Дисплей: «Цифры» → Orbitron ---
        await control.click('.tab-btn[data-tab="display"]');
        await control.waitForSelector('#settingsDrawer.open');
        await control.click('#displayTimerStyle button[data-val="digits"]');
        await expect(control.locator('#displayDigitsFontRow')).toBeVisible();
        await control.click('#displayDigitsFont .font-option[data-val="orbitron"]');
        await display.waitForTimeout(400);

        const afterDisplay = {
            widget: await fontFamilyOf(widget, 'widgetDigitsTime'),
            clock: await fontFamilyOf(clock, 'clockDigitsTime'),
            display: await fontFamilyOf(display, 'digitsTime')
        };
        expect(afterDisplay.display, 'дисплей обязан получить выбранный шрифт').toContain('Orbitron');
        expect(afterDisplay.widget, 'шрифт виджета не должен был отъехать').toContain('Bebas Neue');
        expect(afterDisplay.clock, 'шрифт часов не должен был отъехать').toContain('Oswald');

        // Санитарная проверка: три конечных значения действительно различны —
        // иначе «не задело другие окна» было бы доказано вырожденно.
        expect(new Set([afterDisplay.widget, afterDisplay.clock, afterDisplay.display]).size).toBe(3);
    } finally {
        await resetDigitsFonts(control);
        await resetWidgetStyle(control);
        await resetClockStyle(control);
        await resetDisplayStyle(control);
        await restoreWidgetGeometry(widget, widgetGeometryBefore);
        await restoreClockGeometry(clock, clockGeometryBefore);
        await app.close();
    }
});
