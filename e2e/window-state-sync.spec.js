const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const { waitForClock, waitForWidget, waitForWindowSettled, reloadPanel, untilReceived, findWindowBy } = require('./window-ready');

/**
 * Синхронизация состояния окон с окном, которое загрузилось ПОЗЖЕ остальных.
 *
 * Клавиши W/C/D в каждом окне решают «открыть или закрыть» по локальному флагу,
 * который обновляется только сообщениями `*-window-state`. Рассылались они лишь в
 * момент открытия/закрытия, поэтому окно, поднятое вторым, о ранее открытых окнах
 * не узнавало никогда: флаг оставался false, и первое нажатие срабатывало наоборот.
 *
 * Сценарий ниже — из обычной работы, а не искусственный: сначала часы, потом
 * виджет, затем C в виджете. Ожидание — часы закрылись. До правки главный процесс
 * получал open-clock-widget и лишь фокусировал уже открытое окно.
 */

// Часы — по элементу, которого нет в остальных окнах. Разовый поиск
// (`findWindowBy`) — только для вопроса «открыты ли ПРЯМО СЕЙЧАС» внутри
// опроса; открытое окно берётся из ожидания (`waitForClock`/`waitForWidget`).
const IS_CLOCK = () => !!document.getElementById('wFlipSecGroup');

/**
 * Окно ПОЛУЧИЛО свой снимок состояний окон при загрузке (did-finish-load →
 * sendWindowStatesTo, main-window-hooks.js) и обработало его.
 *
 * Помощник `waitFor*Snapshot` здесь запрещён (tests/e2e-fixtures.test.js):
 * его метка идёт каналом флага соседа и подменила бы именно тот снимок,
 * который спека утверждает. Поэтому метка — на ДРУГОМ канале снимка,
 * `display-window-state`, с НАСТОЯЩИМ значением (дисплей в этой спеке не
 * открывается — false), а проверяемые флаги (часы, виджет) не трогает
 * никто, кроме снимка.
 *
 * Шаги: main видит, что окно догрузилось (`!isLoading()` — did-stop-loading
 * идёт после did-finish-load, значит посылки снимка ушли), и в том же
 * вызове шлёт метку; посылки main → окно идут по одной трубе по порядку,
 * значит метка обработана после снимка. Раньше — пауза 1500 мс.
 */
async function waitForLoadSnapshot(app, page, urlPart) {
    await page.waitForLoadState('load');
    const marker = `e2e-${Date.now()}-${Math.random()}`;
    await untilReceived(page, 'display-window-state', async () => {
        await expect.poll(() => app.evaluate(({ BrowserWindow }, [part, mk]) => {
            const live = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
            const own = live.filter((w) => w.webContents.getURL().includes(part));
            if (!own.length || own.some((w) => w.webContents.isLoading())) { return false; }
            // Окно без адреса — только что созданное: подсчёт «по адресу» счёл
            // бы его закрытым (охрана N1 ревью B3, как в waitForMainSnapshot;
            // ревью B7a, M5). Ждём адреса у всех.
            if (live.some((w) => !w.webContents.getURL())) { return false; }
            const isOpen = live.some((w) => w.webContents.getURL().includes('display.html'));
            for (const w of own) { w.webContents.send('display-window-state', { isOpen, e2eMarker: mk }); }
            return true;
        }, [urlPart, marker]), { message: `окно ${urlPart} не догрузилось` }).toBe(true);
    }, { match: { e2eMarker: marker } });
}

async function pressCode(win, code) {
    await win.evaluate((c) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true, cancelable: true }));
    }, code);
}

test('окно, открытое вторым, знает про уже открытые окна (тоггл C работает сразу)', async () => {
    const { app, control } = await launchApp();

    // 1. Сначала часы.
    await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
    const clock = await waitForClock(app);
    // Часы ВСТАЛИ: восстановление геометрии и её отложенная запись позади.
    await waitForWindowSettled(app, clock, 'electron-clock-widget.html');

    // 2. Потом виджет — он загружается ПОСЛЕ часов.
    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    const widget = await waitForWidget(app);
    await waitForLoadSnapshot(app, widget, 'electron-widget.html');

    // 3. C в виджете обязана ЗАКРЫТЬ часы с первого нажатия.
    await pressCode(widget, 'KeyC');

    // Опрос, а не пауза 1200 мс: закрытие идёт через main и не мгновенно.
    // Ложно-зелёным это не станет — без снимка виджет слал бы open, и часы
    // остались бы открытыми до таймаута.
    await expect.poll(
        () => findWindowBy(app, IS_CLOCK),
        { message: 'часы должны закрыться: виджет обязан знать, что они уже открыты' }
    ).toBeNull();

    // 4. И обратно — повторное нажатие снова их открывает.
    await pressCode(widget, 'KeyC');
    await expect.poll(() => findWindowBy(app, IS_CLOCK), { message: 'повторное нажатие снова открывает часы' })
        .not.toBeNull();

    await app.close();
});

test('панель управления после перезагрузки рендерера видит открытые окна', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    const widget = await waitForWidget(app);
    await waitForWindowSettled(app, widget, 'electron-widget.html');

    // Перезагрузка рендерера — именно это делает краш-обработчик
    // bindRenderCrashHandler(win.reload()) после падения окна.
    // Контроллер встал и стартовая рассылка ушла (было: пауза 1500 мс).
    await reloadPanel(control);

    // Снимок окон приходит панели на did-finish-load — опрос самого признака.
    // Другого источника `widget-window-state: true` после перезагрузки нет
    // (виджет открыт ДО неё), поэтому опрос не станет ложно-зелёным.
    await expect.poll(
        () => control.evaluate(() => document.getElementById('openWidgetBtn').classList.contains('active')),
        { message: 'кнопка «Виджет» обязана быть отмечена: виджет открыт' }
    ).toBe(true);

    await app.close();
});

// Состояние таймера глазами панели: просим снимок и ловим ответ.
async function timerStateOf(control) {
    return control.evaluate(() => new Promise((resolve) => {
        const handler = (_e, state) => {
            window.ipcRenderer.removeListener('timer-state', handler);
            resolve({ isRunning: state.isRunning, isPaused: state.isPaused });
        };
        window.ipcRenderer.on('timer-state', handler);
        window.ipcRenderer.send('get-timer-state');
    }));
}

test('BUG-01: Space в часах ставит идущий таймер на паузу, а не только запускает', async () => {
    // Часы решают «старт или пауза» по isRunning из timer-state, а его им не
    // слали вовсе: пробел запускал таймер и больше ничего не умел.
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'set', seconds: 300 }));
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start' }));
        // Часы открываются ПОСЛЕ старта — проверяется и снимок при загрузке.
        await control.evaluate(() => window.ipcRenderer.send('open-clock-widget'));
        const clock = await waitForClock(app);
        await expect.poll(() => timerStateOf(control)).toMatchObject({ isRunning: true });

        await pressCode(clock, 'Space');
        await expect.poll(() => timerStateOf(control), {
            message: 'Space в часах обязан поставить идущий таймер на паузу'
        }).toMatchObject({ isRunning: false, isPaused: true });

        await pressCode(clock, 'Space');
        await expect.poll(() => timerStateOf(control)).toMatchObject({ isRunning: true });
    } finally {
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' })).catch(() => {});
        await app.close();
    }
});
