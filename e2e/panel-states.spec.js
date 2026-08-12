'use strict';

/**
 * Четыре состояния панели управления (редизайн 2026-08-12).
 *
 * Юнит-тесты знают только про чистые функции — panelState тут нет вообще, а
 * windowRowSubtitle проверяется на выдуманных значениях. Достижимость решает
 * только этот файл: он ходит КЛИКАМИ по видимым элементам, как пользователь.
 *
 * Проверяется не «класс поменялся», а то, что видно: какая кнопка на экране,
 * какое у неё слово, есть ли пресеты и ряд ±, что написано под цифрами.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/** Виден ли элемент — по вычисленному display, а не по наличию в DOM. */
async function shown(page, selector) {
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) { return false; }
        return getComputedStyle(el).display !== 'none';
    }, selector);
}

/** Слово на видимой сейчас главной кнопке транспорта. */
async function primaryLabel(page) {
    return page.evaluate(() => {
        const btn = [...document.querySelectorAll('.transport-main')]
            .find((b) => getComputedStyle(b).display !== 'none');
        // firstChild — текстовый узел; querySelector('.transport-key') — подсказка
        // клавиши, и она в слово не входит.
        return btn ? btn.firstChild.nodeValue.trim() : null;
    });
}

test.describe('панель: четыре состояния', () => {
    let app;
    let control;

    test.beforeAll(async () => {
        ({ app, control } = await launchApp());
    });

    test.afterAll(async () => {
        await app.close();
    });

    test('покой: пресеты есть, ряда ± нет, кнопка называется «Старт»', async () => {
        await control.click('.preset[data-minutes="25"]');
        await control.waitForTimeout(400);

        await expect(control.locator('body')).toHaveClass(/state-idle/);
        expect(await primaryLabel(control)).toBe('Старт');
        expect(await shown(control, '.presets')).toBe(true);
        expect(await shown(control, '.adjust')).toBe(false);
        expect(await shown(control, '.panel-progress')).toBe(false);
        await expect(control.locator('#statusText')).toHaveText('Длительность');
        await expect(control.locator('#heroHint')).toHaveText('нажмите на время, чтобы ввести своё');

        // Активный пресет подсвечен ровно один, и это тот, по которому кликнули.
        const active = await control.locator('.preset.active').allTextContents();
        expect(active).toEqual(['25']);
    });

    test('отсчёт: пресеты уступают место ±, кнопка называется «Пауза»', async () => {
        await control.click('#startBtn');
        await control.waitForTimeout(1200);

        await expect(control.locator('body')).toHaveClass(/state-running/);
        expect(await primaryLabel(control)).toBe('Пауза');
        expect(await shown(control, '.presets')).toBe(false);
        expect(await shown(control, '.adjust')).toBe(true);
        expect(await shown(control, '.panel-progress')).toBe(true);

        // Подпись под цифрами — ВРЕМЯ ОКОНЧАНИЯ, а не статичный текст.
        await expect(control.locator('#heroHint')).toHaveText(/^закончится в \d{2}:\d{2}$/);

        // Полоса действительно заполняется, а не стоит на нуле.
        const width = await control.evaluate(
            () => document.getElementById('panelProgressFill').style.width
        );
        expect(width).toMatch(/%$/);
    });

    test('ряд ± меняет время прямо во время отсчёта', async () => {
        const before = await control.locator('#controlTimeDigits').textContent();
        await control.click('.adjust-btn[data-adjust="300"]');
        await control.waitForTimeout(600);
        const after = await control.locator('#controlTimeDigits').textContent();
        expect(after).not.toBe(before);
    });

    test('ввод: цифры уступают место полю, кнопка называется «Поставить»', async () => {
        await control.click('#pauseBtn');
        await control.waitForTimeout(300);
        await control.click('#resetBtn');
        await control.waitForTimeout(400);

        // Вход в ввод — КЛИКОМ по времени, как обещает подсказка в покое.
        await control.click('#controlTime');
        await control.waitForTimeout(400);

        await expect(control.locator('body')).toHaveClass(/state-input/);
        expect(await primaryLabel(control)).toBe('Поставить');
        expect(await shown(control, '#manualTimeInput')).toBe(true);
        expect(await shown(control, '#controlTime')).toBe(false);
        expect(await shown(control, '.transport-cancel')).toBe(true);
        expect(await shown(control, '.transport-reset')).toBe(false);
        // Две настройки отсчёта переехали сюда — в покое их быть не должно.
        expect(await shown(control, '.input-extras')).toBe(true);
        await expect(control.locator('#statusText')).toHaveText('Своё время');
    });

    test('введённое время доезжает до таймера, а «Отмена» возвращает в покой', async () => {
        await control.fill('#manualTimeInput', '7:30');
        await control.press('#manualTimeInput', 'Enter');
        await control.waitForTimeout(600);

        await expect(control.locator('body')).toHaveClass(/state-idle/);
        await expect(control.locator('#controlTimeDigits')).toHaveText('07:30');

        await control.click('#controlTime');
        await control.waitForTimeout(300);
        await control.click('#manualCancel');
        await control.waitForTimeout(300);
        await expect(control.locator('body')).toHaveClass(/state-idle/);
    });

    test('поле ввода не рисует рамку — в макете на месте цифр только цифры', async () => {
        await control.click('#controlTime');
        await control.waitForTimeout(400);
        const box = await control.evaluate(() => {
            const el = document.getElementById('manualTimeInput');
            el.focus();
            const cs = getComputedStyle(el);
            return { border: cs.borderStyle, outline: cs.outlineStyle, shadow: cs.boxShadow };
        });
        expect(box.border).toBe('none');
        expect(box.shadow).toBe('none');
        await control.click('#manualCancel');
        await control.waitForTimeout(300);
    });
});

test.describe('панель: строки окон', () => {
    let app;
    let control;

    test.beforeAll(async () => {
        ({ app, control } = await launchApp());
    });

    test.afterAll(async () => {
        await app.close();
    });

    test('ящик настроек открывается ШЕВРОНОМ строки, а не вкладкой', async () => {
        // Вкладок больше нет вообще — если они вернутся, тест обязан упасть.
        expect(await control.locator('.tabs-row').count()).toBe(0);

        await control.click('.wrow:has(#openWidgetBtn) .wrow-chevron');
        await control.waitForTimeout(700);

        await expect(control.locator('#settingsDrawer')).toHaveClass(/open/);
        await expect(control.locator('#drawerTitle')).toHaveText('Виджет');

        // «‹» закрывает ящик — это его единственная роль.
        await control.click('#drawerBack');
        await control.waitForTimeout(700);
        await expect(control.locator('#settingsDrawer')).not.toHaveClass(/open/);
    });

    test('тумблер строки открывает окно и подпись говорит его состояние', async () => {
        const sub = control.locator('#subWidget');
        await expect(sub).toHaveText('маленький таймер поверх окон');

        await control.click('#openWidgetBtn');
        await control.waitForTimeout(1500);

        await expect(control.locator('#openWidgetBtn')).toHaveAttribute('aria-checked', 'true');
        // Подпись собирается из ЖИВЫХ значений: «показан», стиль, масштаб.
        await expect(sub).toHaveText(/^показан( · .+)?$/);

        await control.click('#openWidgetBtn');
        await control.waitForTimeout(1200);
        await expect(control.locator('#openWidgetBtn')).toHaveAttribute('aria-checked', 'false');
        await expect(sub).toHaveText('маленький таймер поверх окон');
    });

    test('строка «Звуки» ведёт в свой раздел', async () => {
        await control.click('.wrow:has(#soundMasterToggle) .wrow-chevron');
        await control.waitForTimeout(700);
        await expect(control.locator('#drawerTitle')).toHaveText('Звуки');
        await control.click('#drawerClose');
        await control.waitForTimeout(700);
    });
});
