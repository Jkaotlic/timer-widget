const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const CONFIG = require('../constants.js');
const MIN_PANEL_HEIGHT = CONFIG.CONTROL_WINDOW_MIN_HEIGHT;

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

/**
 * НИЗКОЕ окно: панель прокручивается, а не теряет низ молча.
 *
 * Вторая половина жалобы 19.08.2026 («когда уменьшаю окно, всё съезжается»).
 * У панели стояло `overflow: hidden` с комментарием «панель не должна
 * перерастать окно». Верно, но неполно: когда окно ниже содержимого, скрытым
 * оказывается не лишнее поле, а ряд пресетов, список окон и подвал. Замер до
 * правки при окне 520px: содержимое 606px, за краем ряд «Вид» (482…554) и
 * подвал (554…606) — и добраться до них было нечем.
 *
 * Проверяется ПАРА условий, иначе половина проверки зеленела бы на любой
 * вёрстке: на обычном размере прокрутки НЕТ вовсе, на низком низ ДОСТИЖИМ.
 */
test('низкое окно: низ панели достижим прокруткой, на обычном размере прокрутки нет', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.waitForTimeout(1000);

        const setSize = (w, h) => app.evaluate(({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows()
                .find((x) => x.webContents.getURL().includes('electron-control.html'));
            // Минимум снимается намеренно: на маленьком экране главный процесс
            // и сам не может дать окну 660px, и это ровно тот случай, который
            // проверяется.
            win.setMinimumSize(320, 380);
            win.setBounds({ x: 40, y: 40, width: size[0], height: size[1] });
        }, [w, h]);

        const probe = () => control.evaluate(() => {
            const panel = document.querySelector('.control-panel');
            const footer = panel.querySelector('.panel-footer');
            const before = footer.getBoundingClientRect();
            panel.scrollTop = panel.scrollHeight;
            const after = footer.getBoundingClientRect();
            const reachable = after.bottom <= window.innerHeight + 1 && after.top >= -1;
            panel.scrollTop = 0;
            return {
                vh: window.innerHeight,
                client: panel.clientHeight,
                content: panel.scrollHeight,
                scrollable: panel.scrollHeight > panel.clientHeight + 1,
                footerVisibleWithoutScroll: before.bottom <= window.innerHeight + 1,
                reachable
            };
        });

        // Обычный размер: содержимое умещается, прокрутки нет.
        await setSize(400, 740);
        await control.waitForTimeout(700);
        const normal = await probe();
        console.log(`   обычное окно ${normal.vh}: содержимое ${normal.content} при ${normal.client}, прокрутка=${normal.scrollable}`);
        expect(normal.scrollable, 'на обычном размере панель зачем-то прокручивается').toBe(false);
        expect(normal.footerVisibleWithoutScroll, 'на обычном размере подвал не виден').toBe(true);

        // Низкое окно: прокрутка появилась, и низ достижим.
        for (const h of [600, 520, 440]) {
            await setSize(380, h);
            await control.waitForTimeout(700);
            const low = await probe();
            console.log(`   низкое окно ${low.vh}: содержимое ${low.content} при ${low.client}, `
                + `прокрутка=${low.scrollable}, низ достижим=${low.reachable}`);
            expect(low.scrollable, `${h}: содержимое не помещается, а прокрутки нет`).toBe(true);
            expect(low.reachable, `${h}: до подвала панели нельзя добраться — часть интерфейса потеряна`).toBe(true);
        }
    } finally {
        await app.close();
    }
});

/**
 * НИЗКОЕ окно: цифры не ложатся на кнопки пресетов.
 *
 * Жалоба 19.08.2026 с кадром: на окне ~376×650 крупное время нарисовано ПОВЕРХ
 * ряда «5 15 25 45». Причина — герой (`.hero`) отдавал высоту ниже своего
 * содержимого (`flex: 1 1 auto; min-height: 0`): кегль оставался 76px, коробка
 * сжималась, глифы вылезали из неё и накрывали соседей.
 *
 * Замер до правки, текст времени против ряда пресетов: 700 — наезд 3px, 660 —
 * 19px, 650 — 24px, 600 — 43px (и верх цифр уходил за окно на 2px).
 *
 * Меряется ПРЯМОУГОЛЬНИК ТЕКСТА, а не бокса: боксы секций при этом НЕ
 * пересекались вовсе — наезжал текст, вылезший из сжатой коробки. Проверка по
 * боксам была бы зелёной на сломанной вёрстке.
 */
test('низкое окно: время не наезжает на пресеты, а панель не прокручивается на своём минимуме', async () => {
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        await control.waitForTimeout(1000);

        const setSize = (w, h) => app.evaluate(({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows()
                .find((x) => x.webContents.getURL().includes('electron-control.html'));
            win.setMinimumSize(320, 380);
            win.setBounds({ x: 40, y: 40, width: size[0], height: size[1] });
        }, [w, h]);

        const probe = () => control.evaluate(() => {
            const panel = document.querySelector('.control-panel');
            const timeEl = document.getElementById('controlTime') || document.querySelector('.timer-display-main');
            const presets = document.getElementById('presetsRow');
            const range = document.createRange();
            range.selectNodeContents(timeEl);
            const t = range.getBoundingClientRect();
            const p = presets.getBoundingClientRect();
            return {
                vh: window.innerHeight,
                fontSize: getComputedStyle(timeEl).fontSize,
                textTop: Math.round(t.top),
                gapToPresets: Math.round(p.top - t.bottom),
                content: panel.scrollHeight,
                client: panel.clientHeight
            };
        });

        for (const [w, h] of [[400, 740], [380, 700], [380, 660], [376, 650]]) {
            await setSize(w, h);
            await control.waitForTimeout(700);
            const m = await probe();
            console.log(`   ${w}×${h}: кегль ${m.fontSize}, зазор до пресетов ${m.gapToPresets}px, содержимое ${m.content}/${m.client}`);

            expect(m.gapToPresets, `${h}: время наезжает на ряд пресетов`).toBeGreaterThan(0);
            expect(m.textTop, `${h}: верх цифр ушёл за окно`).toBeGreaterThanOrEqual(0);
            // Помещаться целиком панель обязана на размерах, КОТОРЫЕ ПРИЛОЖЕНИЕ
            // РАЗРЕШАЕТ: минимум окна — CONFIG.CONTROL_WINDOW_MIN_HEIGHT.
            // Ниже него (окно ужато системой на маленьком экране) прокрутка —
            // это аварийный выход, и его проверяет соседний тест. Порог берётся
            // из реестра, а не пишется числом: разъехавшись, они дали бы
            // проверку, которая требует поместиться туда, куда приложение и не
            // собиралось.
            if (h >= MIN_PANEL_HEIGHT) {
                expect(
                    m.content,
                    `${h}: панель прокручивается на размере, который приложение считает допустимым`
                ).toBeLessThanOrEqual(m.client + 1);
            }
        }
    } finally {
        await app.close();
    }
});
