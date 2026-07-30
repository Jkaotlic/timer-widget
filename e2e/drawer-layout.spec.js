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
