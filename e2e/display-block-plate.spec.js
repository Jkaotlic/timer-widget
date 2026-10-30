const { test, expect } = require('./fixtures');
const { launchApp } = require('./launch');
const {
    waitForDisplay, waitForDisplaySnapshot, waitForDisplaySettled, untilReceived, armReceived
} = require('./window-ready');

/**
 * Просьба 24.08.2026: «при градиенте у функциональных блоков белая подложка».
 *
 * Что было замерено до правки (фон `linear-gradient(135deg, #0a84ff, #30d158)`,
 * то есть НАСЫЩЕННЫЙ цветной, а не белый):
 *
 *   яркость стопов 0.238 и 0.500 → среднее 0.37 > порога 0.179, и страж тона
 *   ставит `on-light-bg` — правильно для ТЕКСТА (тёмные буквы на таком фоне
 *   дают 4.75:1 против 3.65:1 у белых). Но вместе с текстом светлеет и ПЛИТА:
 *
 *     • `body.style-flip .info-value` → белая пластина
 *       rgb(255,255,255) → rgb(236,236,243);
 *     • `body.style-flip .status-pill` → она же;
 *     • `body.style-analog .status-pill` → сплошной rgb(255,255,255).
 *
 * На синезелёном фоне это четыре белые карточки — то, что пользователь и
 * назвал «белой подложкой».
 *
 * Правило, которое из этого следует: ПЛИТА ПРИНАДЛЕЖИТ ТАЙМЕРУ. Блок повторяет
 * стиль тем, что от фона не зависит, — шрифтом и циферблатом, — а плита есть
 * только у того, кто ею и является: у карточки перекидыша. Ровно так уже была
 * снята задняя рамка самих блоков 19.08.2026; тогда пластину на ЗНАЧЕНИИ
 * оставили, и она пережила решение.
 *
 * Проверка отсутствия проверяет себя дважды: тем же зондом снимаются карточка
 * таймера (плита обязана остаться) и циферблат аналога (он тоже светлый на
 * светлом тоне). Позеленей зонд впустую — эти два замера станут красными.
 */

const setToggle = (control, id, value) => control.evaluate(([key, on]) => {
    const el = document.getElementById(key);
    if (!el) { return; }
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

const paint = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) { return null; }
    const cs = getComputedStyle(el);
    return {
        backgroundImage: cs.backgroundImage,
        backgroundColor: cs.backgroundColor,
        boxShadow: cs.boxShadow,
        // У псевдоэлементов снимается И заливка цветом: линия сгиба нарисована
        // именно ею, и зонд, смотрящий только на background-image, объявил бы
        // её снятой, пока она на месте.
        before: [getComputedStyle(el, '::before').backgroundImage, getComputedStyle(el, '::before').backgroundColor].join(' | '),
        after: [getComputedStyle(el, '::after').backgroundImage, getComputedStyle(el, '::after').backgroundColor].join(' | ')
    };
}, selector);

/** Заливка есть, если она не «none» и не полностью прозрачная. */
function painted(surface) {
    if (!surface) { return false; }
    const opaque = surface.backgroundColor
        && !/rgba\(0, 0, 0, 0\)/.test(surface.backgroundColor)
        && surface.backgroundColor !== 'transparent';
    return surface.backgroundImage !== 'none' || opaque;
}

test('на цветном градиенте у блоков и плашки нет плиты, а у карточки таймера — есть', async () => {
    test.setTimeout(180000);
    const { app, control } = await launchApp();
    let display = null;
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        display = await waitForDisplay(app);
        // Снимок main обработан, окно встало — было 2200 мс.
        await waitForDisplaySnapshot(app, display);
        await waitForDisplaySettled(app, display);

        await control.click('.tab-btn[data-tab="display"]');
        for (const key of ['showCurrentTime', 'showEventTime', 'showEndTime', 'showTimeLeft', 'showStatusPill']) {
            await setToggle(control, key, true);
        }

        // Тот самый фон из жалобы: цветной градиент, среднюю яркость которого
        // страж тона считает светлой.
        // Режим фона дошёл до дисплея — было 700 мс.
        await untilReceived(display, 'display-settings-update',
            () => control.click('.bg-mode-btn[data-mode="gradient"]'), { match: { bgMode: 'gradient' } });
        // Цвета — посылкой, несущей ОБА (input дебаунсится панелью).
        const colors = await armReceived(display, 'display-settings-update');
        await control.evaluate(() => {
            for (const [id, hex] of [['bgGrad1', '#0a84ff'], ['bgGrad2', '#30d158']]) {
                const el = document.getElementById(id);
                el.value = hex;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await colors({ match: { bgMode: 'gradient', bgGrad1: '#0a84ff', bgGrad2: '#30d158' } });
        // Настройки уезжают в дисплей с задержкой (панель их дебаунсит), а
        // тон ставит уже само окно — ждём его, а не «на всякий случай».
        await display.waitForFunction(
            () => document.documentElement.classList.contains('on-light-bg'),
            null, { timeout: 8000 }
        ).catch(() => {});

        const tone = await display.evaluate(() => document.documentElement.className);
        expect(tone, 'сценарий вырожден: страж тона не считает этот фон светлым').toContain('on-light-bg');

        // --- «Флип» ---
        // Стиль дошёл, окно утихло (переходы плиты) — было 800 мс.
        await untilReceived(display, 'display-settings-update',
            () => control.click('#displayTimerStyle button[data-val="flip"]'), { match: { displayTimerStyle: 'flip' } });

        const value = await paint(display, '#eventTimeBlock .info-value');
        expect(painted(value), `флип: у значения блока осталась плита (${JSON.stringify(value)})`).toBe(false);
        expect(value.boxShadow, 'флип: у значения блока осталась тень плиты').toBe('none');
        expect(value.before, 'флип: у значения блока осталась линия сгиба').toBe('none | rgba(0, 0, 0, 0)');
        expect(value.after, 'флип: у значения блока остался блик пластины').toBe('none | rgba(0, 0, 0, 0)');

        const flipPill = await paint(display, '.status-pill');
        expect(painted(flipPill) && flipPill.backgroundImage !== 'none',
            `флип: плашка состояния носит пластину табло (${JSON.stringify(flipPill)})`).toBe(false);

        // Зонд живой: у самой карточки перекидыша плита ОБЯЗАНА остаться.
        const card = await paint(display, '.flip-card-inner');
        expect(painted(card), 'флип: зонд не видит плиту даже на карточке таймера').toBe(true);

        // --- «Аналог» ---
        await untilReceived(display, 'display-settings-update',
            () => control.click('#displayTimerStyle button[data-val="analog"]'), { match: { displayTimerStyle: 'analog' } });

        const analogPill = await paint(display, '.status-pill');
        expect(analogPill.backgroundColor, 'аналог: плашка состояния залита белым').not.toBe('rgb(255, 255, 255)');

        // Зонд живой: циферблат блока — фигура стиля, он остаётся светлым.
        const dial = await paint(display, '#eventTimeBlock .mini-clock');
        expect(painted(dial), 'аналог: зонд не видит даже циферблата блока').toBe(true);
    } finally {
        // Профиль e2e ОБЩИЙ на весь прогон: цветной фон, оставленный здесь,
        // сделал бы «светлым» тон в соседних спеках, которые меряют умолчание.
        // Возвращаем и режим фона, и цвета, и стиль, и тумблеры.
        const restored = display ? await armReceived(display, 'display-settings-update').catch(() => null) : null;
        await control.evaluate(() => {
            for (const [id, hex] of [['bgGrad1', '#0f0c29'], ['bgGrad2', '#302b63']]) {
                const el = document.getElementById(id);
                if (!el) { continue; }
                el.value = hex;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }).catch(() => {});
        await control.click('.bg-mode-btn[data-mode="theme"]').catch(() => {});
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerStyle');
            if (el) { el.value = 'circle'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
        for (const key of ['showCurrentTime', 'showEventTime', 'showEndTime', 'showTimeLeft']) {
            await setToggle(control, key, false).catch(() => {});
        }
        // Возврат ДОШЁЛ до конца (было 500 мс): посылка, несущая все
        // возвращённые значения, — значит отложенный `input` цветов отработал,
        // хранилище панели записано, main запомнил. Не дошёл — уборка теста не
        // роняет, но говорит об этом.
        if (restored) {
            await restored({
                match: {
                    bgMode: 'theme', bgGrad1: '#0f0c29', bgGrad2: '#302b63', displayTimerStyle: 'circle',
                    showCurrentTime: false, showEventTime: false, showEndTime: false, showTimeLeft: false
                },
                timeout: 5000
            }).catch((e) => console.log(`   возврат профиля не подтверждён: ${e.message.split('\n')[0]}`));
        }
        await app.close();
    }
});
