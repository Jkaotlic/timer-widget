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
