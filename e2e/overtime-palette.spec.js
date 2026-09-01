const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForDisplay, waitForWidget } = require('./window-ready');

/**
 * Палитра перерасхода: КРАСНЫЙ во всех трёх окнах.
 *
 * Свечение отсюда ушло 18.08.2026 вместе с самими переменными: `--text-glow` и
 * `--glow-color` не читало ни одно правило CSS (внешние ореолы снял редизайн
 * 12.08.2026), то есть проверка мерила значение, которого никто не рисует.
 * Инвариант «цветных ореолов нет» держит tests/flat-surfaces.test.js — он
 * смотрит на то, что реально попадает в `box-shadow` и `text-shadow`.
 *
 * CLAUDE.md объявляет это инвариантом («Status palette is fixed across all three
 * windows … overtime red (pulsing)»), но измерено оно не было. И действительно
 * разошлось: в display.html жил слой .overtime от прежнего ОРАНЖЕВОГО дизайна —
 * пять правил на кольцо, цифры круга, LED, флип и аналог. Четыре не проявлялись,
 * потому что JS ставит красный инлайном, а пятое протекало: у `.time-text.overtime`
 * перебивался только color, а `--text-glow` оставался оранжевым, и красные цифры
 * светились оранжевым. (Самих ореолов с 12.08.2026 нет, и переменных тоже.)
 *
 * Проверяем именно ВЫЧИСЛЕННЫЕ значения: оранжевый в CSS невидим ровно до того
 * дня, когда кто-то уберёт инлайновую подстановку в JS «потому что это делает CSS».
 */

// Проверяется ОТТЕНОК, а не яркость, и это уточнение с историей.
//
// Было `r >= 200` — «яркий красный», под #ff4444 / #ff453a. С 18.08.2026 у
// дисплея два тона, и на СВЕТЛОМ статус-плашка берёт затемнённый красный
// светлой палитры (#b31025): яркий #ff453a на своей же бледно-розовой заливке
// даёт ~2.5:1, то есть состояние на проекторе не читается. Это ровно ловушка
// «акцент на заливке акцентом» из docs/lessons.md, и лечится она затемнением.
//
// Инвариант при этом не ослаблен, а сформулирован точнее: «перерасход КРАСНЫЙ,
// а не оранжевый и не жёлтый» — утверждение об оттенке. Цифры и свечение
// по-прежнему берут полосу (--tw-band-danger), она от тона не зависит вовсе, и
// проверка `r >= 150` их держит.
const RED_CHANNEL_MIN = 150;   // #b31025 → 179; #ff4444 → 255
const GREEN_CHANNEL_MAX = 120; // у оранжевого (#ff9f0a) зелёный ≈ 159 — отсечётся

function parseRgb(value) {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value || '');
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

/** '#b31025' → {r,g,b}; всё остальное — null. */
function hexToRgb(value) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(String(value).trim());
    if (!m) { return null; }
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function expectRed(value, what) {
    const c = parseRgb(value);
    expect(c, `${what}: не удалось разобрать цвет «${value}»`).not.toBeNull();
    expect(c.r, `${what}: красный канал слишком низкий (${value})`).toBeGreaterThanOrEqual(RED_CHANNEL_MIN);
    expect(c.g, `${what}: зелёный канал выдаёт оранжевый/жёлтый (${value})`).toBeLessThanOrEqual(GREEN_CHANNEL_MAX);
    // Красный обязан ДОМИНИРОВАТЬ: без этого порога «тёмно-серый» (120,120,120)
    // прошёл бы обе проверки выше. Коэффициенты взяты с запасом к обоим
    // законным значениям: #ff4444 даёт 3.75, #b31025 — 11.2 и 4.8.
    expect(c.r, `${what}: красный не доминирует над зелёным (${value})`).toBeGreaterThanOrEqual(c.g * 2.5);
    expect(c.r, `${what}: красный не доминирует над синим (${value})`).toBeGreaterThanOrEqual(c.b * 2.5);
}

async function findWindow(app, probe) {
    for (const w of app.windows()) {
        if (await w.evaluate(probe).catch(() => false)) { return w; }
    }
    return null;
}

test('перерасход красный и в дисплее, и в виджете — цифры и плашка', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => {
        window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
        window.ipcRenderer.send('open-widget');
    });
    await waitForDisplay(app);
    await waitForWidget(app);
    await waitForWidget(app);
    await control.waitForTimeout(2200);

    const display = await findWindow(app, () => !!document.getElementById('progressRing'));
    const widget = await findWindow(app, () => !!document.getElementById('wFlipHoursGroup'));
    expect(display, 'окно дисплея не найдено').not.toBeNull();
    expect(widget, 'окно виджета не найдено').not.toBeNull();

    // Уводим таймер в перерасход: 1 секунда с разрешённым минусом.
    await control.evaluate(() => {
        window.ipcRenderer.send('timer-command', { type: 'set', seconds: 1, allowNegative: true });
        window.ipcRenderer.send('timer-command', { type: 'start', allowNegative: true });
    });
    await control.waitForTimeout(3500);

    // --- Полноэкранный дисплей ---
    const d = await display.evaluate(() => {
        const t = document.getElementById('timeDisplay');
        const cs = getComputedStyle(t);
        return {
            classes: t.className,
            color: cs.color,
            pill: getComputedStyle(document.getElementById('statusPill')).color
        };
    });
    console.log('дисплей →', JSON.stringify(d));

    expect(d.classes, 'дисплей должен быть в перерасходе').toContain('overtime');
    expectRed(d.color, 'дисплей: цифры');
    expectRed(d.pill, 'дисплей: статус-плашка');

    // --- Виджет таймера ---
    const w = await widget.evaluate(() => {
        const t = document.getElementById('timeDisplay');
        const cs = getComputedStyle(t);
        return {
            status: t.dataset.status,
            color: cs.color,
            badge: getComputedStyle(document.getElementById('statusBadge')).color
        };
    });
    console.log('виджет →', JSON.stringify(w));

    expect(w.status, 'виджет должен быть в перерасходе').toBe('overtime');
    expectRed(w.color, 'виджет: цифры');
    expectRed(w.badge, 'виджет: статус-плашка');

    await app.close();
});

/**
 * Тот же перерасход на СВЕТЛОМ тоне: красный обязан быть затемнённым.
 *
 * Долг, оставшийся с 18.08.2026: полоса `--tw-band-danger` была литералом
 * #ff4444 в обоих тонах и на белом давала 3.41:1 — порог для КРУПНОГО текста и
 * ничего сверх. Полоса предупреждения такого дефекта не имела, потому что
 * объявлена ССЫЛКОЙ на жёлтый акцент и затемняется вместе с ним; разъехались
 * они ровно на этом — одна была ссылкой, вторая литералом.
 *
 * Почему e2e, а при уже написанном расчёте в tests/contrast.test.js. Расчёт
 * доказывает, что ТОКЕН читаем; он не доказывает, что токен доехал до цифр.
 * Здесь меряется вычисленный цвет живого элемента в живом окне после смены
 * темы по IPC — то есть вся цепочка «тема → тон → палитра → цифры».
 */
test('на светлом тоне перерасход берёт ЗАТЕМНЁННЫЙ красный, а не яркий', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => {
            window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
            window.ipcRenderer.send('open-widget');
        });
        await waitForDisplay(app);
        await waitForWidget(app);
        await waitForWidget(app);
        await control.waitForTimeout(2200);

        const display = await findWindow(app, () => !!document.getElementById('progressRing'));
        const widget = await findWindow(app, () => !!document.getElementById('wFlipHoursGroup'));
        expect(display, 'окно дисплея не найдено').not.toBeNull();
        expect(widget, 'окно виджета не найдено').not.toBeNull();

        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'set', seconds: 1, allowNegative: true }));
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'start', allowNegative: true }));
        await control.waitForTimeout(3500);

        const probe = (page) => page.evaluate(() => {
            const t = document.getElementById('timeDisplay');
            const root = getComputedStyle(document.documentElement);
            // Стопы ОБОИХ градиентов дуги. С 18.08.2026 они приходят из
            // токенов полос, а презентационные атрибуты `stop-color` сняты:
            // атрибут переменную не понимает, а два владельца одного значения
            // расходятся. Если правило вдруг не применится, стоп станет
            // ЧЁРНЫМ — то есть промах здесь виден числом, а не рассуждением.
            const stops = (id) => [...document.querySelectorAll(`#${id} stop`)]
                .map((el) => getComputedStyle(el).stopColor);
            return {
                status: t.dataset.status || t.className,
                color: getComputedStyle(t).color,
                band: root.getPropertyValue('--tw-band-danger').trim(),
                dangerStops: stops('dangerGradient'),
                warningStops: stops('warningGradient'),
                // Тон меряется чернилами, а не классом: класс может стоять, а
                // палитра не доехать (см. style-tone.spec.js).
                fg: root.getPropertyValue('--tw-fg').trim()
            };
        });

        // --- тёмный тон: полоса ЯРКАЯ ---
        await control.evaluate(() => window.ipcRenderer.send('ui-theme-update', { theme: 'dark' }));
        await display.waitForTimeout(700);
        const darkDisplay = await probe(display);
        const darkWidget = await probe(widget);
        console.log('тёмный тон →', JSON.stringify({ display: darkDisplay, widget: darkWidget }));

        // --- светлый тон: полоса ЗАТЕМНЁННАЯ ---
        await control.evaluate(() => window.ipcRenderer.send('ui-theme-update', { theme: 'light' }));
        await display.waitForTimeout(900);
        const lightDisplay = await probe(display);
        const lightWidget = await probe(widget);
        console.log('светлый тон →', JSON.stringify({ display: lightDisplay, widget: lightWidget }));

        for (const [where, dark, light] of [
            ['дисплей', darkDisplay, lightDisplay],
            ['виджет', darkWidget, lightWidget]
        ]) {
            // Проверка проверки: тон действительно сменился, иначе «цвета
            // разные» доказывалось бы двумя замерами одного и того же окна.
            expect(dark.fg, `${where}: тёмный тон не тёмный`).not.toBe(light.fg);
            // И перерасход всё ещё идёт: на сброшенном таймере цифры взяли бы
            // обычный цвет, и оба замера совпали бы «по-честному».
            expect(String(dark.status), `${where}: тёмный тон вышел из перерасхода`).toContain('overtime');
            expect(String(light.status), `${where}: светлый тон вышел из перерасхода`).toContain('overtime');

            // Сам предмет: цвет цифр РАЗНЫЙ, светлый тон темнее, и оба красные.
            expect(light.color, `${where}: на светлом тоне цифры того же цвета, что на тёмном`)
                .not.toBe(dark.color);
            expectRed(dark.color, `${where}: тёмный тон`);
            expectRed(light.color, `${where}: светлый тон`);
            const darkR = parseRgb(dark.color).r;
            const lightR = parseRgb(light.color).r;
            expect(lightR, `${where}: на светлом тоне красный не потемнел (${light.color})`)
                .toBeLessThan(darkR - 40);
            // Дуга кольца — та же полоса. Проверяются ОБЕ: жёлтая была хуже
            // красной (#ffc107 на белом — 1.63:1, дуга предупреждения в
            // светлом окне не читалась вовсе).
            for (const key of ['dangerStops', 'warningStops']) {
                expect(dark[key].length, `${where}: ${key} — стопов нет вовсе`).toBe(2);
                for (let i = 0; i < 2; i++) {
                    const d = parseRgb(dark[key][i]);
                    const l = parseRgb(light[key][i]);
                    expect(d, `${where}: тёмный ${key}[${i}] = ${dark[key][i]}`).not.toBeNull();
                    expect(l, `${where}: светлый ${key}[${i}] = ${light[key][i]}`).not.toBeNull();
                    // Чёрный стоп означает, что правило не применилось вовсе.
                    expect(d.r + d.g + d.b, `${where}: тёмный ${key}[${i}] чёрный — правило не доехало`)
                        .toBeGreaterThan(30);
                    expect(l.r + l.g + l.b, `${where}: светлый ${key}[${i}] чёрный — правило не доехало`)
                        .toBeGreaterThan(30);
                    // На светлом фоне тот же стоп обязан быть ТЕМНЕЕ.
                    expect(l.r + l.g + l.b, `${where}: светлый ${key}[${i}] не потемнел`)
                        .toBeLessThan(d.r + d.g + d.b);
                }
            }

            // Цифры красятся ПОЛОСОЙ, а не чем-то своим: без этого равенства
            // тест был бы зелёным и при случайном совпадении оттенка.
            // Значение переменной приезжает как оно записано в CSS — hex,
            // а не rgb(): это не вычисленный цвет элемента, а текст токена.
            const band = hexToRgb(light.band);
            expect(band, `${where}: полоса не разобралась (${light.band})`).not.toBeNull();
            expect(parseRgb(light.color).r, `${where}: цифры разошлись с полосой`).toBe(band.r);
        }
    } finally {
        // Тема — глобальное состояние, а профиль прогона общий.
        await control.evaluate(() => window.ipcRenderer.send('ui-theme-update', { theme: 'dark' })).catch(() => {});
        await control.evaluate(() => window.ipcRenderer.send('timer-command', { type: 'reset' })).catch(() => {});
        await app.close();
    }
});
