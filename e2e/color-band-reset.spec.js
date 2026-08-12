const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Возврат из цветовой полосы обязан снимать ВСЁ, что полоса нарисовала.
 *
 * CLAUDE.md объявляет это правило критическим, и два места в виджете по нему
 * уже починены (`this._baseTimerColor || ''`). Третье — свечение круга — нет:
 * ветка сброса написана как `if (this._baseTimerColor)` без завершающего
 * `else`, а `_baseTimerColor` заполняется только внутри applyColors(), которая
 * выходит раньше, если в localStorage нет ключа `timerColors`. То есть на
 * СВЕЖЕЙ УСТАНОВКЕ ветки сброса не существует вовсе.
 *
 * Замерено до правки: таймер уходит в danger → возвращается в норму →
 * data-status === 'normal', цвет цифр нормальный, а вокруг них
 * `rgba(255, 68, 68, 0.8) 0px 0px 20px` — красный ореол на обычных цифрах,
 * залипающий до перезапуска приложения либо до первого выбора цвета.
 *
 * Почему тест смотрит на computed text-shadow, а не на инлайновый стиль:
 * инлайн — это МЕХАНИЗМ, а он и меняется правкой (цвет уезжает в CSS-переменную
 * --timer-glow). Проверять надо то, что реально отрисовано, иначе тест сломается
 * от корректного рефакторинга — ровно та ловушка, о которой предупреждает
 * шапка status-and-colors.spec.js.
 *
 * Два сценария не заменяют друг друга:
 *   - на чистом профиле ловится сам залипший ореол;
 *   - с выбранным цветом ловится обратная ошибка «убрали инлайн и сломали
 *     красный в danger», потому что инлайновая переменная била бы правило
 *     [data-status="danger"].
 */

const RED_GLOW = /255,\s*68,\s*68/;
const USER_COLOR_GLOW = /48,\s*209,\s*88/;   // #30d158 в rgb
const USER_COLOR = '#30d158';

let app;
let control;
let widget;

async function sendCommand(cmd) {
    await control.evaluate((c) => { window.ipcRenderer.send('timer-command', c); }, cmd);
    await control.waitForTimeout(400);
}

// Полоса зависит от ОСТАТКА в процентах от общего, поэтому danger набирается
// через set + adjust, а не одним set: `set` переписывает и total, и remaining.
async function enterDanger() {
    await sendCommand({ type: 'set', seconds: 100 });
    await sendCommand({ type: 'adjust', deltaSeconds: -95 });
}

async function backToNormal() {
    await sendCommand({ type: 'set', seconds: 600 });
}

// Тень редизайна: серая, без цвета. Одна и та же во всех полосах.
const NEUTRAL_SHADOW = /rgba\(0,\s*0,\s*0/;

function readGlow() {
    const el = document.querySelector('.time-display');
    return {
        status: el.dataset.status,
        shadow: getComputedStyle(el).textShadow,
        color: getComputedStyle(el).color
    };
}

test.beforeAll(async () => {
    ({ app, control } = await launchApp());
    await control.evaluate(() => { window.ipcRenderer.send('open-widget'); });
    await control.waitForTimeout(1500);
    for (const page of app.windows()) {
        if ((await page.url()).includes('electron-widget')) { widget = page; }
    }
    expect(widget, 'окно виджета должно открыться').toBeTruthy();
});

test.afterAll(async () => {
    // Профиль e2e общий на весь прогон: тест, меняющий глобальное состояние,
    // обязан вернуть его назад, иначе следующая спека упадёт в одиночку зелёной.
    if (widget) {
        await widget.evaluate(() => { localStorage.removeItem('timerColors'); }).catch(() => {});
    }
    await app.close();
});

test('на чистом профиле выход из danger снимает ВСЁ, что нарисовала полоса', async () => {
    // Редизайн 2026-08-12 снял ореолы: состояние несёт ЦВЕТ ЦИФР, а тень стала
    // нейтральной и одинаковой во всех полосах. Смысл проверки прежний —
    // «выход из полосы снимает всё, что полоса нарисовала», — но улика теперь
    // цвет, а не свечение. Заодно проверяется, что ореол не вернулся: цветная
    // тень в любой полосе означала бы откат редизайна.
    await widget.evaluate(() => { localStorage.removeItem('timerColors'); });
    await widget.reload();
    await widget.waitForTimeout(900);

    await enterDanger();
    const danger = await widget.evaluate(readGlow);
    expect(danger.status).toBe('danger');
    expect(danger.color, 'в danger цифры должны быть красными').toMatch(RED_GLOW);
    expect(danger.shadow, 'тень обязана остаться нейтральной').toMatch(NEUTRAL_SHADOW);

    await backToNormal();
    const normal = await widget.evaluate(readGlow);
    expect(normal.status).toBe('normal');
    expect(normal.color, 'после выхода из danger красный обязан исчезнуть').not.toMatch(RED_GLOW);
    expect(normal.shadow, 'тень обязана остаться нейтральной').toMatch(NEUTRAL_SHADOW);
});

test('выбранный пользователем цвет виден в норме, но danger его перебивает', async () => {
    await widget.evaluate((color) => {
        window.ipcRenderer.send('widget-colors-update', { timer: color, progress: color });
    }, USER_COLOR);
    await widget.waitForTimeout(400);

    await backToNormal();
    const normal = await widget.evaluate(readGlow);
    expect(normal.status).toBe('normal');
    expect(normal.color, 'в норме цифры должны быть цвета пользователя').toMatch(USER_COLOR_GLOW);

    await enterDanger();
    const danger = await widget.evaluate(readGlow);
    expect(danger.status).toBe('danger');
    expect(danger.color, 'danger обязан перебивать пользовательский цвет').toMatch(RED_GLOW);
    expect(danger.color, 'в danger не должно остаться пользовательского цвета')
        .not.toMatch(USER_COLOR_GLOW);

    await backToNormal();
});
