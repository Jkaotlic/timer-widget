const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');

/**
 * Управление фокусом в выезжающем ящике настроек.
 *
 * Ящик лежит в КОНЦЕ документа, а кнопки-табы — в начале панели. Фокус после
 * клика оставался на кнопке, поэтому до только что открытых настроек надо было
 * пройти Tab-ом всю панель. Модалки это давно умеют (modal-manager.js делает
 * начальный фокус, ловушку и возврат), а ящик — нет.
 *
 * Отдельно проверяется то, что оказалось УЖЕ правильным: содержимое закрытого
 * ящика из обхода Tab исключено. Гипотеза «90 контролов висят в порядке обхода,
 * пока aria-hidden врёт скринридеру» была ОПРОВЕРГНУТА замером — в CSS есть
 * `visibility: hidden`, и Chromium делает потомков нефокусируемыми. Тест закрепляет
 * это свойство: если кто-то заменит visibility на прозрачность или нулевую ширину,
 * появятся 90 фантомных остановок Tab, и упадёт вот здесь.
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]),'
    + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

test('закрытый ящик не даёт фантомных остановок Tab', async () => {
    const { app, control } = await launchApp();

    const r = await control.evaluate((sel) => {
        const drawer = document.getElementById('settingsDrawer');
        const inside = [...drawer.querySelectorAll(sel)];
        const first = inside[0];
        if (first) { first.focus(); }
        return {
            open: drawer.classList.contains('open'),
            visibility: getComputedStyle(drawer).visibility,
            count: inside.length,
            focusLanded: !!first && document.activeElement === first
        };
    }, FOCUSABLE);
    console.log('закрытый ящик →', JSON.stringify(r));

    expect(r.open).toBe(false);
    expect(r.count, 'внутри ящика должны быть контролы — иначе тест ничего не проверяет')
        .toBeGreaterThan(20);
    expect(r.visibility, 'скрывать ящик обязана visibility: hidden — она же убирает фокусируемость')
        .toBe('hidden');
    expect(r.focusLanded, 'фокус не имеет права попадать внутрь закрытого ящика').toBe(false);

    await app.close();
});

test('открытие ящика уводит фокус внутрь, закрытие возвращает на кнопку', async () => {
    const { app, control } = await launchApp();

    // Фокусируем кнопку-таб и открываем ящик её же кликом.
    const opened = await control.evaluate(async () => {
        const btn = document.querySelector('.tab-btn[data-tab="clock"]');
        btn.focus();
        const before = document.activeElement === btn;
        btn.click();
        // Ящик раскрывается синхронно в клике, фокус внутрь ставит
        // `_focusFirstInDrawer` таймером 0 мс (control-app.js). Было 700 мс.
        // пауза законна: таймер 0 мс взведён ПОСЛЕ таймера фокуса приложения —
        // равные задержки исполняются в порядке взвода
        await new Promise((r) => setTimeout(r, 0));
        const drawer = document.getElementById('settingsDrawer');
        const active = document.activeElement;
        return {
            focusWasOnButton: before,
            drawerOpen: drawer.classList.contains('open'),
            ariaExpanded: btn.getAttribute('aria-expanded'),
            focusInsideDrawer: drawer.contains(active),
            activeTag: active ? active.tagName.toLowerCase() : null,
            activeId: active ? (active.id || null) : null
        };
    });
    console.log('после открытия →', JSON.stringify(opened));

    expect(opened.focusWasOnButton).toBe(true);
    expect(opened.drawerOpen, 'ящик должен открыться').toBe(true);
    expect(opened.ariaExpanded, 'кнопка обязана сообщать раскрытое состояние').toBe('true');
    expect(
        opened.focusInsideDrawer,
        'фокус обязан уйти в ящик: иначе до открытых настроек идти Tab-ом через всю панель'
    ).toBe(true);

    // Закрытие через Esc — тот же путь, что у пользователя.
    const closed = await control.evaluate(async () => {
        // Закрытие и возврат фокуса синхронны (closeSettingsDrawer): класс,
        // aria-expanded и focus() — в обработчике клавиши. Было 700 мс.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        const btn = document.querySelector('.tab-btn[data-tab="clock"]');
        const drawer = document.getElementById('settingsDrawer');
        return {
            drawerOpen: drawer.classList.contains('open'),
            ariaExpanded: btn.getAttribute('aria-expanded'),
            focusBackOnButton: document.activeElement === btn,
            activeId: document.activeElement ? (document.activeElement.id || document.activeElement.className) : null
        };
    });
    console.log('после закрытия →', JSON.stringify(closed));

    expect(closed.drawerOpen, 'Esc обязан закрыть ящик').toBe(false);
    expect(closed.ariaExpanded, 'кнопка обязана вернуть aria-expanded=false').toBe('false');
    expect(
        closed.focusBackOnButton,
        'фокус обязан вернуться на кнопку: иначе он схлопывается на body и Tab начинается с начала'
    ).toBe(true);

    await app.close();
});

test('ящик объявлен областью, а не диалогом', async () => {
    // role="dialog" обещает модальность: ловушку фокуса и блокировку остального
    // интерфейса. Ящик не делает ни того, ни другого — панель за ним остаётся
    // рабочей, и это правильно. Честная роль для подписанной боковой панели —
    // region, а состояние раскрытия несут кнопки через aria-expanded/aria-controls.
    const { app, control } = await launchApp();

    const r = await control.evaluate(() => {
        const drawer = document.getElementById('settingsDrawer');
        const btns = [...document.querySelectorAll('.tab-btn')];
        return {
            role: drawer.getAttribute('role'),
            label: drawer.getAttribute('aria-label'),
            controlsAll: btns.every((b) => b.getAttribute('aria-controls') === 'settingsDrawer'),
            expandedAll: btns.every((b) => b.hasAttribute('aria-expanded')),
            count: btns.length
        };
    });
    console.log(JSON.stringify(r));

    expect(r.role).toBe('region');
    expect(r.label, 'region без имени бесполезен для скринридера').toBeTruthy();
    expect(r.count).toBe(4);
    expect(r.controlsAll, 'каждая кнопка обязана указывать на управляемую панель').toBe(true);
    expect(r.expandedAll, 'каждая кнопка обязана нести aria-expanded').toBe(true);

    await app.close();
});
