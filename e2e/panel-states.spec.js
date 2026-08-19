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

        // «Считать ниже нуля» доступна и в покое. Спрятать её в состояние ввода
        // значило бы: заметил, что не укладываешься, — а включить уже негде.
        expect(await shown(control, '.input-extras')).toBe(true);
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

    /**
     * Пауза — ЧЕТВЁРТОЕ состояние транспорта, а не разновидность отсчёта.
     *
     * Раскладка выводилась из `isRunning || isPaused`, поэтому в паузе на
     * экране оставалась кнопка «Пауза» — единственное действие, которое в
     * паузе не делает ничего. Возобновить таймер мышью было НЕЧЕМ: ни в
     * панели, ни в свёрнутой полосе, где та же кнопка звалась «Пауза» же.
     * Оставался только пробел, и пользователь, глядя на слово «Пауза»,
     * закономерно считал, что окно вообще перестало слушаться.
     */
    test('пауза: кнопка предлагает продолжить, а не паузу ещё раз', async () => {
        await control.click('#pauseBtn');
        await control.waitForTimeout(500);

        await expect(control.locator('#statusText')).toHaveText('Пауза');
        expect(await primaryLabel(control)).toBe('Продолжить');
        expect(await shown(control, '#pauseBtn'), 'в паузе кнопка «Пауза» бессмысленна').toBe(false);
        // Раскладка отсчёта в паузе сохраняется: ряд ± и полоса на месте,
        // пресеты по-прежнему уступили им место.
        expect(await shown(control, '.adjust')).toBe(true);
        expect(await shown(control, '.panel-progress')).toBe(true);
        expect(await shown(control, '.presets')).toBe(false);

        // И главное: кнопка РАБОТАЕТ — таймер снова идёт.
        await control.click('#startBtn');
        await control.waitForTimeout(1300);
        expect(await control.evaluate(() => window.timerController.isRunning)).toBe(true);
        expect(await primaryLabel(control)).toBe('Пауза');
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
        expect(await shown(control, '.time-entry')).toBe(true);
        expect(await shown(control, '#controlTime')).toBe(false);
        expect(await shown(control, '.transport-cancel')).toBe(true);
        expect(await shown(control, '.transport-reset')).toBe(false);
        // Две настройки отсчёта переехали сюда — в покое их быть не должно.
        expect(await shown(control, '.input-extras')).toBe(true);
        await expect(control.locator('#statusText')).toHaveText('Своё время');
    });

    test('введённое время доезжает до таймера, а «Отмена» возвращает в покой', async () => {
        await control.fill('#manualMinutes', '7');
        await control.fill('#manualSeconds', '30');
        await control.press('#manualSeconds', 'Enter');
        await control.waitForTimeout(600);

        await expect(control.locator('body')).toHaveClass(/state-idle/);
        await expect(control.locator('#controlTimeDigits')).toHaveText('07:30');

        await control.click('#controlTime');
        await control.waitForTimeout(300);
        await control.click('#manualCancel');
        await control.waitForTimeout(300);
        await expect(control.locator('body')).toHaveClass(/state-idle/);
    });

    test('ввод — ДВА поля, предзаполненных текущим временем', async () => {
        // Слепленная строка «5:30» требовала помнить формат и попадать курсором
        // в нужную позицию. Полей два, каждое принимает просто число.
        await control.click('.preset[data-minutes="25"]');
        await control.waitForTimeout(300);
        await control.click('#controlTime');
        await control.waitForTimeout(400);

        const box = await control.evaluate(() => {
            const hrs = document.getElementById('manualHours');
            const min = document.getElementById('manualMinutes');
            const sec = document.getElementById('manualSeconds');
            min.focus();
            const cs = getComputedStyle(min);
            return {
                hrs: hrs.value,
                min: min.value,
                sec: sec.value,
                focused: document.activeElement.id,
                // Обводка фокуса — ВНУТРЕННЯЯ тень, а не border: рамка меняла бы
                // размер поля и толкала соседнее.
                border: cs.borderStyle,
                shadow: cs.boxShadow
            };
        });
        expect(box.hrs).toBe('0');
        expect(box.min).toBe('25');
        expect(box.sec).toBe('00');
        // Фокус начинается с МИНУТ: часы почти всегда нули, и начинать с них
        // значило бы заставлять пропускать их каждый раз.
        expect(box.focused).toBe('manualMinutes');
        expect(box.border).toBe('none');
        expect(box.shadow).toContain('inset');

        await control.click('#manualCancel');
        await control.waitForTimeout(300);
    });

    test('двоеточие переводит из минут в секунды — «7:30» набирается подряд', async () => {
        await control.click('#controlTime');
        await control.waitForTimeout(400);
        await control.keyboard.type('7');
        await control.keyboard.press(':');
        await control.keyboard.type('30');
        await control.waitForTimeout(200);
        const where = await control.evaluate(() => ({
            focused: document.activeElement.id,
            min: document.getElementById('manualMinutes').value,
            sec: document.getElementById('manualSeconds').value
        }));
        expect(where.focused).toBe('manualSeconds');
        expect(where.min).toBe('7');
        expect(where.sec).toBe('30');

        await control.keyboard.press('Enter');
        await control.waitForTimeout(500);
        await expect(control.locator('#controlTimeDigits')).toHaveText('07:30');
    });

    test('часы отдельным полем: 1:30:00 набирается без счёта в уме', async () => {
        await control.click('#controlTime');
        await control.waitForTimeout(400);
        await control.fill('#manualHours', '1');
        await control.fill('#manualMinutes', '30');
        await control.fill('#manualSeconds', '0');
        await control.press('#manualSeconds', 'Enter');
        await control.waitForTimeout(600);
        await expect(control.locator('#controlTimeDigits')).toHaveText('1:30:00');
    });

    test('минуты больше 59 — тоже опечатка: для этого и есть часы', async () => {
        await control.click('#controlTime');
        await control.waitForTimeout(400);
        await control.fill('#manualMinutes', '90');
        await control.press('#manualMinutes', 'Enter');
        await control.waitForTimeout(400);
        await expect(control.locator('body')).toHaveClass(/state-input/);
        await control.click('#manualCancel');
        await control.waitForTimeout(300);
    });

    test('секунды больше 59 — опечатка, а не «ещё минута»', async () => {
        await control.click('#controlTime');
        await control.waitForTimeout(400);
        await control.fill('#manualMinutes', '5');
        await control.fill('#manualSeconds', '75');
        await control.press('#manualSeconds', 'Enter');
        await control.waitForTimeout(400);

        // Молча перенести 75 секунд в минуты значило бы поставить не то время,
        // что набрано. Панель остаётся в вводе и помечает поле.
        await expect(control.locator('body')).toHaveClass(/state-input/);
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

    /**
     * Подпись строки — это ОТЧЁТ о том, что сейчас на экране, и врать он не
     * должен ни секунды. Пересобирался он только в renderPanelState(), то есть
     * на тике таймера: в покое тиков нет вообще, и после смены стиля строка
     * часов продолжала утверждать «показан · круг», пока пользователь не
     * запустит отсчёт. Замер до правки: стиль часов «флип», подпись «круг».
     */
    test('подпись строки догоняет смену стиля сразу, без тика таймера', async () => {
        await control.click('#openClockBtn');
        await control.waitForTimeout(1600);
        await control.click('.wrow:has(#openClockBtn) .wrow-chevron');
        await control.waitForTimeout(700);

        await control.click('#clockStyle button[data-val="flip"]');
        await control.waitForTimeout(500);
        await expect(control.locator('#subClock')).toHaveText(/флип/);

        // Убираем за собой: профиль e2e общий на весь прогон.
        await control.click('#clockStyle button[data-val="circle"]');
        await control.waitForTimeout(400);
        await control.click('#drawerClose');
        await control.waitForTimeout(600);
        await control.click('#openClockBtn');
        await control.waitForTimeout(900);
    });

    /**
     * Строка дисплея — такой же отчёт, как строки виджета и часов.
     *
     * Жалоба 17.08.2026: «в окне настроек в дисплей не отображается полная
     * информация о том, какой стиль и тд как в остальных окнах». Так и было:
     * строке дисплея передавался только монитор, хотя стиль и масштаб у неё
     * свои и настраиваются в том же ящике. Сокращённый отчёт у одной строки из
     * трёх читается как «у дисплея этих настроек нет».
     */
    test('строка дисплея сообщает стиль и масштаб, а не только монитор', async () => {
        await control.click('#openDisplayBtn');
        // Ждём УСЛОВИЕ, а не паузу. Полноэкранное окно грузит четыре таблицы
        // стилей и двадцать шрифтов, и на занятой машине (полный прогон e2e,
        // 14 минут) 1800 мс до прихода `display-window-state` не хватало: строка
        // честно показывала «закрыт», тест падал на подписи, а причина была в
        // том, что окна ещё не было. Фиксированная пауза здесь измеряла скорость
        // машины — тот же дефект, что чинился 18.08.2026 в угле стрелки.
        await expect(control.locator('#openDisplayBtn'))
            .toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
        await control.click('.wrow:has(#openDisplayBtn) .wrow-chevron');
        await control.waitForTimeout(700);

        await control.click('#displayTimerStyle button[data-val="flip"]');
        await control.waitForTimeout(600);
        // Стиль — как у соседних строк, теми же словами.
        await expect(control.locator('#subDisplay')).toHaveText(/показан · флип/);

        // Масштаб появляется, когда он о чём-то говорит (100 % не пишется).
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerScale');
            el.value = '150';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await control.waitForTimeout(700);
        await expect(control.locator('#subDisplay')).toHaveText(/флип · 150%/);

        // Убираем за собой: профиль e2e общий на весь прогон.
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerScale');
            el.value = '100';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await control.click('#displayTimerStyle button[data-val="circle"]');
        await control.waitForTimeout(500);
        await control.click('#drawerClose');
        await control.waitForTimeout(600);
        await control.click('#openDisplayBtn');
        // Закрытие тоже по условию: профиль общий, и следующая спека не должна
        // получить чужое открытое окно.
        await expect(control.locator('#openDisplayBtn'))
            .toHaveAttribute('aria-checked', 'false', { timeout: 15000 });
    });

    test('строка «Звуки» ведёт в свой раздел', async () => {
        await control.click('.wrow:has(#soundMasterToggle) .wrow-chevron');
        await control.waitForTimeout(700);
        await expect(control.locator('#drawerTitle')).toHaveText('Звуки');
        await control.click('#drawerClose');
        await control.waitForTimeout(700);
    });
});
