const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForClock, waitForWidget } = require('./window-ready');

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

// Окна различаем по элементам, уникальным для каждого.
const MARKERS = {
    clock: () => !!document.getElementById('wFlipSecGroup'),
    widget: () => !!document.getElementById('wFlipHoursGroup')
};

async function findWindow(app, kind) {
    for (const w of app.windows()) {
        const hit = await w.evaluate(MARKERS[kind]).catch(() => false);
        if (hit) { return w; }
    }
    return null;
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
    await waitForClock(app);
    await control.waitForTimeout(1500);
    expect(await findWindow(app, 'clock'), 'часы должны открыться').not.toBeNull();

    // 2. Потом виджет — он загружается ПОСЛЕ часов.
    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    await waitForWidget(app);
    await control.waitForTimeout(1500);
    const widget = await findWindow(app, 'widget');
    expect(widget, 'виджет должен открыться').not.toBeNull();

    // 3. C в виджете обязана ЗАКРЫТЬ часы с первого нажатия.
    await pressCode(widget, 'KeyC');
    await control.waitForTimeout(1200);

    expect(
        await findWindow(app, 'clock'),
        'часы должны закрыться: виджет обязан знать, что они уже открыты'
    ).toBeNull();

    // 4. И обратно — повторное нажатие снова их открывает.
    await pressCode(widget, 'KeyC');
    await control.waitForTimeout(1500);
    expect(await findWindow(app, 'clock'), 'повторное нажатие снова открывает часы').not.toBeNull();

    await app.close();
});

test('панель управления после перезагрузки рендерера видит открытые окна', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => window.ipcRenderer.send('open-widget'));
    await waitForWidget(app);
    await control.waitForTimeout(1500);

    // Перезагрузка рендерера — именно это делает краш-обработчик
    // bindRenderCrashHandler(win.reload()) после падения окна.
    await control.reload();
    await control.waitForLoadState('domcontentloaded');
    await control.waitForTimeout(1500);

    const widgetBtnActive = await control.evaluate(
        () => document.getElementById('openWidgetBtn').classList.contains('active')
    );
    expect(widgetBtnActive, 'кнопка «Виджет» обязана быть отмечена: виджет открыт').toBe(true);

    await app.close();
});
