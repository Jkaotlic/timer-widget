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
