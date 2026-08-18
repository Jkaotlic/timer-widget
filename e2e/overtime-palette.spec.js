const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Палитра перерасхода: КРАСНЫЙ во всех трёх окнах, и свечение того же цвета,
 * что и цифры.
 *
 * CLAUDE.md объявляет это инвариантом («Status palette is fixed across all three
 * windows … overtime red (pulsing)»), но измерено оно не было. И действительно
 * разошлось: в display.html жил слой .overtime от прежнего ОРАНЖЕВОГО дизайна —
 * пять правил на кольцо, цифры круга, LED, флип и аналог. Четыре не проявлялись,
 * потому что JS ставит красный инлайном, а пятое протекало: у `.time-text.overtime`
 * перебивался только color, а `--text-glow` оставался оранжевым, и красные цифры
 * светились оранжевым.
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

test('перерасход красный и в дисплее, и в виджете — включая свечение', async () => {
    const { app, control } = await launchApp();

    await control.evaluate(() => {
        window.ipcRenderer.send('open-display', { displayIndex: 'auto' });
        window.ipcRenderer.send('open-widget');
    });
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
            glow: cs.getPropertyValue('--text-glow').trim(),
            pill: getComputedStyle(document.getElementById('statusPill')).color
        };
    });
    console.log('дисплей →', JSON.stringify(d));

    expect(d.classes, 'дисплей должен быть в перерасходе').toContain('overtime');
    expectRed(d.color, 'дисплей: цифры');
    expectRed(d.glow, 'дисплей: свечение цифр');
    expectRed(d.pill, 'дисплей: статус-плашка');

    // --- Виджет таймера ---
    const w = await widget.evaluate(() => {
        const t = document.getElementById('timeDisplay');
        const cs = getComputedStyle(t);
        return {
            status: t.dataset.status,
            color: cs.color,
            glow: cs.getPropertyValue('--glow-color').trim(),
            badge: getComputedStyle(document.getElementById('statusBadge')).color
        };
    });
    console.log('виджет →', JSON.stringify(w));

    expect(w.status, 'виджет должен быть в перерасходе').toBe('overtime');
    expectRed(w.color, 'виджет: цифры');
    expectRed(w.glow, 'виджет: свечение цифр');
    expectRed(w.badge, 'виджет: статус-плашка');

    await app.close();
});
