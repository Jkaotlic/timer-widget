const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Оболочка окна управления — ОДНА.
 *
 * Жалоба пользователя: «окно выглядит как окно внутри окна и плохо вытянутое».
 *
 * Причина. У панели было ДВЕ оболочки. Первая — `.app-shell::before`: она
 * растянута на всё окно и несёт фон, скругление и тень, то есть рисует само окно.
 * Вторая включалась медиазапросом `@media (min-width: 620px)`, который на широком
 * окне выдавал `.control-panel` собственные фон, рамку 1px и тень. Две поверхности
 * со своими рамками, вложенные друг в друга, — это и есть «окно в окне», причём
 * по построению, а не по случайности.
 *
 * Вторая половина жалобы — вертикаль. Панель стояла `height: max-content` +
 * `align-self: center`, поэтому на окне высотой 1100px она занимала ~640px и
 * висела в середине: сверху и снизу оставалось по ~230px мёртвого поля.
 *
 * Тест МЕРЯЕТ вычисленные значения на живом окне, а не смотрит на картинку.
 *
 * Проверка на ОТСУТСТВИЕ (у панели нет своего фона/рамки/тени) обязана проверять
 * сама себя — иначе зелёный вердикт означает и «чисто», и «замер не работает».
 * Поэтому тем же замером снимается контрольный образец: `.app-shell::before`,
 * который фон и тень иметь ОБЯЗАН. Если контроль пуст — падает сам тест, а не
 * проверяемое условие.
 */

// Прозрачным считается только полностью прозрачный цвет. `rgba(x, y, z, 0)` —
// то, что возвращает getComputedStyle для `background: transparent`.
function isTransparent(color) {
    if (!color) { return true; }
    const c = color.replace(/\s/g, '');
    return c === 'transparent' || /^rgba?\(\d+,\d+,\d+,0\)$/.test(c);
}

function measureShell() {
    const panel = document.querySelector('.control-panel');
    const shell = document.querySelector('.app-shell');
    const cs = getComputedStyle(panel);
    // Контрольный образец: оболочка окна. У неё фон и тень ЕСТЬ, и если замер
    // их не видит — сломан замер, а не вёрстка.
    const probeCS = getComputedStyle(shell, '::before');
    const rect = panel.getBoundingClientRect();
    return {
        panel: {
            background: cs.backgroundColor,
            borderTopWidth: cs.borderTopWidth,
            borderLeftWidth: cs.borderLeftWidth,
            boxShadow: cs.boxShadow,
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            width: Math.round(rect.width)
        },
        probe: {
            background: probeCS.backgroundColor,
            boxShadow: probeCS.boxShadow
        },
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        maxWidthConfig: (window.CONFIG && window.CONFIG.CONTROL_WINDOW_MAX_WIDTH) || null
    };
}

async function resizeWindow(control, width, height) {
    await control.evaluate(({ width: w, height: h }) => {
        window.ipcRenderer.send('resize-control-window', { width: w, height: h });
    }, { width, height });
    await control.waitForTimeout(900);
}

test('на растянутом окне панель не отращивает вторую оболочку', async () => {
    const { app, control } = await launchApp();

    // Просим заведомо больше потолка: главный процесс обрежет сам. Дальше
    // считаем от ФАКТИЧЕСКОЙ высоты и ширины — экран раннера может быть меньше.
    await resizeWindow(control, 3000, 1000);
    const m = await control.evaluate(measureShell);

    console.log(
        `окно ${m.innerWidth}×${m.innerHeight}; панель ${m.panel.width}×${m.panel.height} `
        + `(top ${m.panel.top}, bottom ${m.panel.bottom}); фон панели ${m.panel.background}, `
        + `рамка ${m.panel.borderTopWidth}, тень ${m.panel.boxShadow}`
    );

    // --- самопроверка замера ---
    expect(
        isTransparent(m.probe.background),
        `контрольный образец пуст: у .app-shell::before фон ${m.probe.background}. `
        + 'Замер не видит фонов — проверка на отсутствие ничего не доказывает.'
    ).toBe(false);
    expect(
        m.probe.boxShadow,
        'контрольный образец пуст: у .app-shell::before нет тени — замер теней не работает'
    ).not.toBe('none');

    // --- собственно инвариант ---
    expect(
        isTransparent(m.panel.background),
        `панель отрастила собственный фон ${m.panel.background} — это вторая оболочка `
        + 'поверх .app-shell::before, то есть окно внутри окна'
    ).toBe(true);
    expect(
        m.panel.borderTopWidth,
        `панель отрастила рамку ${m.panel.borderTopWidth} — рамка принадлежит окну, а не панели`
    ).toBe('0px');
    expect(
        m.panel.borderLeftWidth,
        `панель отрастила боковую рамку ${m.panel.borderLeftWidth}`
    ).toBe('0px');
    expect(
        m.panel.boxShadow,
        `панель отрастила собственную тень ${m.panel.boxShadow} — тень принадлежит окну`
    ).toBe('none');

    // --- вертикаль: мёртвого поля быть не должно ---
    expect(
        m.panel.top,
        `над панелью ${m.panel.top}px пустоты — панель обязана растягиваться на высоту окна`
    ).toBeLessThanOrEqual(2);
    expect(
        m.innerHeight - m.panel.bottom,
        `под панелью ${m.innerHeight - m.panel.bottom}px пустоты — панель обязана `
        + 'растягиваться на высоту окна'
    ).toBeLessThanOrEqual(2);

    await app.close();
});

/**
 * Потолок ширины окна следует за содержимым.
 *
 * У панели нет ни одного контрола, которому нужна ширина 1200px: список окон,
 * транспорт и цифры укладываются в колонку контента. Прежний потолок позволял
 * растянуть окно так, что панель тонула в поле — ровно то состояние, в котором и
 * появилась вторая оболочка как попытка это поле оправдать.
 *
 * Потолок двухуровневый: при закрытом ящике он равен ширине панели с полями, при
 * открытом поднимается на ширину ящика. Переключает его сам обработчик
 * `resize-control-window` — по запрошенной ширине, потому что окно растёт и
 * сжимается ТОЛЬКО через него (мышью пользователь ограничен текущим потолком).
 */
test('при закрытом ящике окно не растягивается шире панели, а ящик потолок поднимает', async () => {
    const { app, control } = await launchApp();

    await resizeWindow(control, 3000, 900);
    const closed = await control.evaluate(measureShell);
    const availWidth = await control.evaluate(() => window.screen.availWidth);

    console.log(
        `закрытый ящик: окно ${closed.innerWidth}px при потолке ${closed.maxWidthConfig}px, `
        + `экран ${availWidth}px`
    );

    expect(
        closed.maxWidthConfig,
        'CONFIG.CONTROL_WINDOW_MAX_WIDTH не доехал до рендерера'
    ).toBeGreaterThan(0);
    expect(
        closed.innerWidth,
        `окно растянулось до ${closed.innerWidth}px при потолке ${closed.maxWidthConfig}px — `
        + 'потолок не действует'
    ).toBeLessThanOrEqual(closed.maxWidthConfig + 1);

    // Потолок обязан быть соразмерен содержимому, а не произволен: панель плюс
    // поля. Иначе «потолок есть» — правда, а «панель не тонет в поле» — нет.
    expect(
        closed.maxWidthConfig - closed.panel.width,
        `окно ${closed.innerWidth}px против панели ${closed.panel.width}px: `
        + `поля ${closed.maxWidthConfig - closed.panel.width}px — панель тонет в поле`
    ).toBeLessThanOrEqual(80);

    // --- ящик поднимает потолок ---
    // Только если экран раннера вообще позволяет окну стать шире: на узком
    // экране главный процесс режет по `screenWidth - 50` и проверять нечего.
    await control.click('.tab-btn[data-tab="clock"]');
    await control.waitForTimeout(1200);
    const opened = await control.evaluate(measureShell);

    console.log(`открытый ящик: окно ${opened.innerWidth}px`);

    if (availWidth - 50 > closed.innerWidth + 50) {
        expect(
            opened.innerWidth,
            `с открытым ящиком окно осталось ${opened.innerWidth}px — потолок не поднялся, `
            + 'ящик накроет панель'
        ).toBeGreaterThan(closed.innerWidth);
    } else {
        console.log(`экран ${availWidth}px слишком узок — рост окна под ящик не проверяется`);
    }

    await app.close();
});
