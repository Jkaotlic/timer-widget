const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const { waitForClock, waitForClockSnapshot, waitForWindowSettled, untilReceived } = require('./window-ready');

/**
 * Испорченное значение стиля не должно ломать окно часов.
 *
 * `setClockStyle()` в часах клал класс конкатенацией — `classList.add('style-' +
 * style)` — в отличие от виджета и дисплея, где ветки switch кладут литералы.
 * Значение с пробелом или пустая строка роняют `classList.add` с DOMException:
 * обработчик обрывается на полпути, ни один из четырёх стилей не получает
 * `.active`, и часы остаются пустым прозрачным окном без единого способа
 * починить их из интерфейса.
 *
 * Путей для мусора было два: `clock-widget-set-style` (главный процесс с
 * 30.10.2026 пропускает только имена из CONFIG.TIMER_STYLES — мусор до окна не
 * доезжает, проверяется ниже) и `clockStyle` из localStorage при старте окна —
 * этот путь проверки не имеет, поэтому сторож окна проверяется прямым вызовом
 * `setClockStyle`, тем же, что делает чтение профиля.
 *
 * Замечание найдено security-обзором 03.08.2026 и оставалось ниже порога
 * находки; чинится вместе с раскладкой шильдиков.
 */

const BAD_STYLES = [
    'circle malicious',   // пробел — DOMException в classList.add
    '',                   // пустая строка — тоже DOMException
    'нет такого стиля',
    'style-flip; drop'
];

// Часы «живы», если ровно один из стилей отрисован и на body стоит
// ровно один класс style-*.
function measureStyleState() {
    const panes = {
        circle: document.querySelector('.circular-widget'),
        flip: document.getElementById('widgetFlip'),
        analog: document.getElementById('widgetAnalog')
    };
    const active = Object.entries(panes)
        .filter(([, el]) => el && el.classList.contains('active'))
        .map(([name]) => name);
    const bodyStyles = [...document.body.classList].filter((c) => c.startsWith('style-'));
    return { active, bodyStyles };
}

test('испорченный стиль часов откатывается на круговой, а не ломает окно', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => { window.ipcRenderer.send('open-clock-widget'); });
    // Окно найдено пробой (бросает, если не открылось), получило снимок main
    // и встало — раньше пауза 2000 мс.
    const clock = await waitForClock(app);
    await waitForClockSnapshot(app, clock);
    await waitForWindowSettled(app, clock, 'electron-clock-widget.html');

    // Заведомо валидный стиль — чтобы старт был из известного состояния.
    // Посылка дошла и отработана (было 600 мс).
    await untilReceived(clock, 'set-clock-style',
        () => control.evaluate(() => { window.ipcRenderer.send('clock-widget-set-style', 'flip'); }), { match: 'flip' });
    const before = await clock.evaluate(measureStyleState);
    console.log('до мусора:', JSON.stringify(before));
    expect(before.active, 'исходный стиль должен примениться').toEqual(['flip']);

    // Слой 1 — main: мусор по каналу до окна не доезжает. Шпион пишет КАЖДЫЙ
    // доехавший стиль: без него конечный analog был бы и при сломанном фильтре.
    await clock.evaluate(() => {
        const orig = window.clockWidget.setClockStyle.bind(window.clockWidget);
        window.__arrivedStyles = [];
        window.clockWidget.setClockStyle = (st) => { window.__arrivedStyles.push(st); orig(st); };
    });
    for (const bad of BAD_STYLES) {
        await control.evaluate((s) => {
            window.ipcRenderer.send('clock-widget-set-style', s);
        }, bad);
    }
    // Валидная посылка ПОСЛЕ мусора — метка того, что мусор уже обработан
    // (канал упорядочен): ждём её условием, а не паузой.
    await control.evaluate(() => { window.ipcRenderer.send('clock-widget-set-style', 'analog'); });
    await expect.poll(() => clock.evaluate(measureStyleState).then((st) => st.active),
        { message: 'метка analog после мусора' }).toEqual(['analog']);
    expect(await clock.evaluate(() => window.__arrivedStyles), 'до окна доехала только метка').toEqual(['analog']);

    // Слой 2 — окно: то же значение из профиля (setClockStyle — путь чтения
    // localStorage) откатывается на круг, а не ломает окно.
    for (const bad of BAD_STYLES) {
        await clock.evaluate((s) => { window.clockWidget.setClockStyle(s); }, bad);

        const state = await clock.evaluate(measureStyleState);
        console.log(`мусор ${JSON.stringify(bad)} →`, JSON.stringify(state));

        expect(state.active, `${JSON.stringify(bad)}: ровно один стиль должен остаться нарисованным`)
            .toHaveLength(1);
        expect(state.active[0], `${JSON.stringify(bad)}: должен быть откат на круговой`).toBe('circle');
        expect(state.bodyStyles, `${JSON.stringify(bad)}: на body ровно один класс style-*`)
            .toEqual(['style-circle']);
    }

    // Убираем за собой: стиль часов персистится в общем localStorage.
    // Стиль часы пишут в обработчике посылки — дождаться её (было 500 мс).
    await untilReceived(clock, 'set-clock-style',
        () => control.evaluate(() => { window.ipcRenderer.send('clock-widget-set-style', 'circle'); }), { match: 'circle' });
    await app.close();
});
