const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Ящик настроек не должен ложиться ПОВЕРХ панели — ни при какой ширине окна.
 *
 * Как нашли. Ящик закрыт во всех 36 снимках визуальной сверки, поэтому его
 * раскладка не проверялась вообще ничем. Добавили снимок с открытым ящиком — и на
 * первом же кадре (он снимался сразу после прогона «максимальный размер») пресеты
 * и кнопки панели оказались видны СКВОЗЬ карточки ящика.
 *
 * Причина. Окно управления ограничено сверху `CONTROL_WINDOW_MAX_WIDTH`. При
 * открытии ящик просил у главного процесса «текущая ширина + 336», а ширину своей
 * левой колонки выставлял равной ПРЕЖНЕЙ ширине окна. У окна, уже растянутого до
 * предела, запрос обрезался, окно не расширялось — а колонка оставалась во всю
 * ширину. Ящик спозиционирован absolute / right: 0, поэтому он просто накрыл её.
 *
 * Тест МЕРЯЕТ прямоугольники, а не смотрит на картинку: правый край панели не
 * должен заходить на левый край ящика. Проверяется и обычная ширина, и предельная.
 */

// Меряем то, что видит глаз: реальные прямоугольники двух колонок.
function measureColumns() {
    const panel = document.querySelector('.control-panel');
    const drawer = document.querySelector('.settings-drawer');
    const shell = document.querySelector('.app-shell');
    const rect = (el) => {
        if (!el) { return null; }
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    };
    return {
        panel: rect(panel),
        drawer: rect(drawer),
        drawerOpen: !!drawer && drawer.classList.contains('open'),
        shellHasClass: !!shell && shell.classList.contains('drawer-open'),
        panelWidthVar: shell ? getComputedStyle(shell).getPropertyValue('--control-panel-width').trim() : null,
        innerWidth: window.innerWidth
    };
}

async function openDrawer(control, tab) {
    await control.click(`.tab-btn[data-tab="${tab}"]`);
    await control.waitForTimeout(900);
}

async function closeDrawer(control) {
    await control.click('#drawerClose');
    await control.waitForTimeout(900);
}

test('ящик настроек не накрывает панель ни при обычной, ни при предельной ширине', async () => {
    const { app, control } = await launchApp();

    // --- обычная ширина ---
    await openDrawer(control, 'clock');
    const normal = await control.evaluate(measureColumns);

    expect(normal.drawerOpen, 'ящик должен быть открыт').toBe(true);
    expect(normal.shellHasClass, 'оболочка должна получить класс drawer-open').toBe(true);
    expect(normal.panel.width, 'панель не должна схлопнуться').toBeGreaterThan(300);
    expect(
        normal.panel.right,
        `панель (правый край ${normal.panel.right}) заходит на ящик (левый край ${normal.drawer.left})`
    ).toBeLessThanOrEqual(normal.drawer.left + 1);

    await closeDrawer(control);

    // --- узкое, но допустимое окно ---
    // Этот случай важнее предельного: именно он воспроизводит то, на чём упала
    // первая версия правки. Она вычитала ящик из КОНСТАНТЫ потолка (1200 − 336 =
    // 864) вместо фактической ширины, и при окне 800px колонка получалась 864 —
    // шире, чем всё окно. На macOS с большим экраном это не проявлялось: окно
    // расширялось до запрошенного. На Windows-раннере экран узкий, главный процесс
    // обрезает ширину по `screenWidth - 50`, и наложение вылезло только в CI.
    // Здесь оно ловится на любой машине.
    await control.evaluate(() => {
        window.ipcRenderer.send('resize-control-window', { width: 800, height: 700 });
    });
    await control.waitForTimeout(900);
    await openDrawer(control, 'clock');
    const narrow = await control.evaluate(measureColumns);

    expect(narrow.panel.width, 'панель не должна схлопнуться').toBeGreaterThan(300);
    expect(
        narrow.panel.right,
        `при окне ${narrow.innerWidth}px панель (правый край ${narrow.panel.right}) `
        + `накрывается ящиком (левый край ${narrow.drawer.left}); `
        + `--control-panel-width = ${narrow.panelWidthVar}`
    ).toBeLessThanOrEqual(narrow.drawer.left + 1);

    await closeDrawer(control);

    // --- предельная ширина ---
    // Просим у главного процесса заведомо больше потолка: он сам обрежет до
    // maxWidth (или до размеров экрана раннера — поэтому дальше считаем от
    // ФАКТИЧЕСКОЙ ширины, а не от ожидаемой).
    await control.evaluate(() => {
        window.ipcRenderer.send('resize-control-window', { width: 3000, height: 800 });
    });
    await control.waitForTimeout(900);
    const widthAtMax = await control.evaluate(() => window.innerWidth);

    await openDrawer(control, 'display');
    const atMax = await control.evaluate(measureColumns);

    expect(atMax.drawerOpen, 'ящик должен быть открыт и на предельной ширине').toBe(true);
    expect(atMax.panel.width, 'панель не должна схлопнуться').toBeGreaterThan(300);
    expect(
        atMax.panel.right,
        `на ширине окна ${widthAtMax}px панель (правый край ${atMax.panel.right}) `
        + `накрывается ящиком (левый край ${atMax.drawer.left}); `
        + `--control-panel-width = ${atMax.panelWidthVar}`
    ).toBeLessThanOrEqual(atMax.drawer.left + 1);

    // Колонка панели обязана быть меньше потолка на ширину ящика — именно этой
    // арифметики раньше не было.
    const panelVar = parseInt(atMax.panelWidthVar, 10);
    expect(Number.isFinite(panelVar), '--control-panel-width не выставлен').toBe(true);
    expect(
        panelVar + 336,
        `колонка ${panelVar}px + ящик 336px должны укладываться в ширину окна ${atMax.innerWidth}px`
    ).toBeLessThanOrEqual(atMax.innerWidth + 1);

    await app.close();
});

/**
 * Панель не должна ПРЫГАТЬ при открытии ящика.
 *
 * Жалоба пользователя: «бывает, что прыгает при открытии боковой панели».
 * Причина была ровно одна и видна в CSS: закрытый ящик — панель по центру окна
 * (`justify-self: center`), открытый — правило переставляло её на
 * `justify-self: start`. На окне шире панели это мгновенный скачок к левому
 * краю: justify-self не анимируется в принципе. На окне ширины по умолчанию
 * (400px) панель занимает всё окно, поэтому центр и край совпадают — оттого
 * «бывает» и оттого этого не было видно ни в одном снимке.
 *
 * Первая версия этого теста мерила ТОЛЬКО концы: положение до открытия и после,
 * порог 24px. Она была зелёной на широком экране и красной в CI — и оба вердикта
 * были неверны, потому что мерили не ту величину. Замер по кадрам показал, что
 * панель едет не по прямой:
 *
 *   потолок 1200 (широкий экран): 130 → 280 → 112  — рывок ВПРАВО на 150px
 *   потолок  974 (раннер CI):     130 → 167 →   0  — рывок ВПРАВО на 37px
 *
 * То есть на широком экране рывок БОЛЬШЕ, а тест по концам его не видел
 * (130 → 112 = 18px, порог пройден). Причина: окно растёт МГНОВЕННО, а колонка
 * под ящик резервируется с переходом 240ms. В промежутке между этими двумя
 * событиями панель успевает перецентроваться во всю новую ширину окна — отсюда
 * бросок вправо, а затем плавный возврат влево.
 *
 * Итоговое смещение экраном НЕ определяется свободно: на узком экране окну некуда
 * расти (главный процесс режет по `screenWidth - 50`), и панель обязана
 * подвинуться — 130 → 0 там физически вынуждено. Поэтому порог по концам
 * непереносим между машинами в принципе.
 *
 * Переносимый инвариант — МОНОТОННОСТЬ: куда бы панель ни ехала, она не должна
 * ехать в противоположную сторону, чтобы потом вернуться. Он не зависит ни от
 * ширины экрана, ни от потолка окна, и ловит рывок на любой машине.
 */
test('панель не прыгает горизонтально при открытии ящика', async () => {
    const { app, control } = await launchApp();

    // Растягиваем окно: на ширине по умолчанию дефекта не видно (панель занимает
    // всё окно, центр и край совпадают).
    await control.evaluate(() => {
        window.ipcRenderer.send('resize-control-window', { width: 900, height: 700 });
    });
    await control.waitForTimeout(900);

    // Пишем траекторию левого края покадрово, а не два её конца.
    await control.evaluate(() => {
        window.__panelTrack = [];
        const panel = document.querySelector('.control-panel');
        const t0 = performance.now();
        const tick = () => {
            const r = panel.getBoundingClientRect();
            window.__panelTrack.push({
                t: Math.round(performance.now() - t0),
                left: Math.round(r.left * 10) / 10,
                width: Math.round(r.width * 10) / 10,
                win: window.innerWidth
            });
            if (performance.now() - t0 < 1100) { requestAnimationFrame(tick); }
        };
        requestAnimationFrame(tick);
    });

    await control.click('.tab-btn[data-tab="clock"]');
    await control.waitForTimeout(1300);

    const track = await control.evaluate(() => window.__panelTrack);
    expect(track.length, 'траектория открытия не записалась').toBeGreaterThan(10);

    const first = track[0];
    const last = track[track.length - 1];
    const net = last.left - first.left;

    // «Откат» — суммарное движение против итогового направления. У честной
    // анимации он нулевой: панель едет в одну сторону и останавливается.
    let backtrack = 0;
    let peak = first.left;
    for (let i = 1; i < track.length; i++) {
        const step = track[i].left - track[i - 1].left;
        // Направление считаем от знака итогового перемещения. Если панель никуда
        // не уехала (net ≈ 0), любой ход в сторону — уже откат.
        const against = net === 0
            ? Math.abs(step)
            : (Math.sign(step) === Math.sign(net) ? 0 : Math.abs(step));
        backtrack += against;
        if (Math.abs(track[i].left - first.left) > Math.abs(peak - first.left)) { peak = track[i].left; }
    }

    console.log(
        `траектория панели: left ${first.left} → ${last.left} (итого ${Math.round(net)}px), `
        + `максимальный выброс ${peak}, откат ${Math.round(backtrack)}px, `
        + `окно ${first.win} → ${last.win}, кадров ${track.length}`
    );

    expect(
        Math.round(backtrack),
        `панель дёрнулась: уехала до ${peak}px и вернулась на ${last.left}px `
        + `(итоговое перемещение ${Math.round(net)}px, суммарный откат ${Math.round(backtrack)}px). `
        + 'Окно растёт мгновенно, колонка под ящик — за 240ms; между этими событиями панель '
        + 'не должна успевать перецентроваться во всю новую ширину окна.'
    ).toBeLessThanOrEqual(4);

    // Итоговое положение обязано совпадать с тем, что вынуждает раскладка:
    // колонка = ширина окна минус ящик, панель по центру колонки, но не шире 640.
    const expected = await control.evaluate(() => {
        const shell = document.querySelector('.app-shell');
        const drawer = parseInt(getComputedStyle(shell).getPropertyValue('--drawer-width'), 10) || 336;
        const minW = (window.CONFIG && window.CONFIG.CONTROL_WINDOW_MIN_WIDTH) || 380;
        const col = Math.max(minW, window.innerWidth - drawer);
        return Math.max(0, Math.round((col - Math.min(col, 640)) / 2));
    });
    expect(
        Math.abs(last.left - expected),
        `панель встала на ${last.left}px, а раскладка требует ${expected}px`
    ).toBeLessThanOrEqual(2);

    // --- ЗАКРЫТИЕ проверяется тем же инвариантом ---
    // Оно ломалось СВОИМ образом: снятие drawer-open возвращает первую дорожку к
    // 1fr, а 1fr = окно минус вторая дорожка. Пока резерв под ящик схлопывался
    // только вместе с классом, в этот кадр дорожка получалась не 900, а 771 —
    // панель отскакивала назад на 64px и ехала обратно (замер).
    await control.evaluate(() => {
        window.__panelTrack = [];
        const panel = document.querySelector('.control-panel');
        const t0 = performance.now();
        const tick = () => {
            const r = panel.getBoundingClientRect();
            window.__panelTrack.push({
                t: Math.round(performance.now() - t0),
                left: Math.round(r.left * 10) / 10,
                win: window.innerWidth
            });
            if (performance.now() - t0 < 1100) { requestAnimationFrame(tick); }
        };
        requestAnimationFrame(tick);
    });

    await control.click('#drawerClose');
    await control.waitForTimeout(1300);

    const closeTrack = await control.evaluate(() => window.__panelTrack);
    expect(closeTrack.length, 'траектория закрытия не записалась').toBeGreaterThan(10);

    const cFirst = closeTrack[0];
    const cLast = closeTrack[closeTrack.length - 1];
    const cNet = cLast.left - cFirst.left;
    let cBack = 0;
    let cPeak = cFirst.left;
    for (let i = 1; i < closeTrack.length; i++) {
        const step = closeTrack[i].left - closeTrack[i - 1].left;
        cBack += cNet === 0
            ? Math.abs(step)
            : (Math.sign(step) === Math.sign(cNet) ? 0 : Math.abs(step));
        if (Math.abs(closeTrack[i].left - cFirst.left) > Math.abs(cPeak - cFirst.left)) {
            cPeak = closeTrack[i].left;
        }
    }

    console.log(
        `траектория при закрытии: left ${cFirst.left} → ${cLast.left} (итого ${Math.round(cNet)}px), `
        + `максимальный выброс ${cPeak}, откат ${Math.round(cBack)}px, окно ${cFirst.win} → ${cLast.win}`
    );

    expect(
        Math.round(cBack),
        `панель дёрнулась при ЗАКРЫТИИ: уехала до ${cPeak}px и вернулась на ${cLast.left}px `
        + `(итоговое перемещение ${Math.round(cNet)}px, суммарный откат ${Math.round(cBack)}px). `
        + 'Резерв под ящик обязан схлопнуться ДО снятия drawer-open, иначе 1fr считается '
        + 'от ещё не схлопнутой второй дорожки.'
    ).toBeLessThanOrEqual(4);

    await app.close();
});
