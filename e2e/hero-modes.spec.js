'use strict';

/**
 * Режимы центрального времени ПО КЛИКУ.
 *
 * Unit-тесты знают арифметику и проводку; здесь проверяется то, чего они
 * увидеть не могут: доезжает ли режим до НАСТОЯЩЕГО окна дисплея и тем ли
 * числом.
 *
 * Числа берутся ИЗ ОКНА (его системные часы, его вычисленные стили), а не с
 * монитора проверяющего. Профиль e2e общий, поэтому каждый тест возвращает
 * режим в «Таймер», а время мероприятия — в 10:00 / 12:00.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { openDisplay } = require('./window-ready');

/**
 * Открыть ящик настроек на вкладке «Дисплей» — там и живут кнопки режима,
 * заголовки и время мероприятия. Без этого шага `.hero-mode-btn` остаётся
 * скрытым (ящик закрыт по умолчанию), и клик виснет до таймаута теста, а не
 * падает с понятной причиной.
 */
async function openDisplayTab(control) {
    await control.click('.tab-btn[data-tab="display"]');
    await control.waitForSelector('#settingsDrawer.open');
}

async function pickMode(control, mode) {
    await control.locator(`.hero-mode-btn[data-mode="${mode}"]`).click();
    await expect(control.locator(`.hero-mode-btn[data-mode="${mode}"]`)).toHaveClass(/active/);
}

async function setEvent(control, start, end) {
    await control.locator('#eventTimeInput').fill(start);
    await control.locator('#endTimeInput').fill(end);
    await control.locator('#endTimeInput').blur();
}

/** Крупное число окна дисплея — текстом, без пробелов. */
async function heroText(display) {
    return display.evaluate(() => {
        const el = document.getElementById('timeDisplay');
        return (el.textContent || '').replace(/\s+/g, '');
    });
}

test.describe('режимы центрального времени', () => {
    test('четыре режима дают на экране четыре разных числа', async () => {
        const { app, control } = await launchApp();
        const display = await openDisplay(app, control);
        await openDisplayTab(control);

        // Режим «Таймер» — как было до 08.09.2026.
        await pickMode(control, 'timer');
        await control.locator('.preset[data-minutes="5"]').click();
        await expect.poll(() => heroText(display)).toMatch(/^05:00$/);

        // Мероприятие с 00:01 до 23:59: начало заведомо прошло, конец заведомо
        // впереди — числа предсказуемы в любой час прогона.
        await setEvent(control, '00:01', '23:59');

        // «Текущее время» — сверяем с часами САМОГО ОКНА, а не проверяющего.
        await pickMode(control, 'current');
        await expect.poll(async () => {
            const shown = await heroText(display);
            const own = await display.evaluate(() => {
                const d = new Date();
                const p = (v) => String(v).padStart(2, '0');
                return `${p(d.getHours())}:${p(d.getMinutes())}`;
            });
            return shown.startsWith(own);
        }).toBe(true);

        // «До начала» — начало прошло, значит минус.
        await pickMode(control, 'to-start');
        await expect.poll(() => heroText(display)).toMatch(/^[−-]/);

        // «До конца» — конец впереди, значит без минуса и не равно таймеру.
        await pickMode(control, 'to-end');
        await expect.poll(() => heroText(display)).not.toMatch(/^[−-]/);
        expect(await heroText(display)).not.toBe('05:00');

        await pickMode(control, 'timer');
        await setEvent(control, '10:00', '12:00');
        await app.close();
    });

    test('вне режима таймера плашка состояния скрыта при включённом тумблере', async () => {
        const { app, control } = await launchApp();
        const display = await openDisplay(app, control);
        await openDisplayTab(control);

        const pillVisible = () => display.evaluate(() => {
            const el = document.getElementById('statusPill');
            return el ? getComputedStyle(el).display !== 'none' : false;
        });

        await pickMode(control, 'timer');
        expect(await pillVisible()).toBe(true);

        for (const mode of ['current', 'to-start', 'to-end']) {
            await pickMode(control, mode);
            await expect.poll(pillVisible, { message: `плашка видна в режиме ${mode}` }).toBe(false);
        }

        await pickMode(control, 'timer');
        await app.close();
    });

    test('«до конца» на прошедшем конце показывает минус и красный', async () => {
        const { app, control } = await launchApp();
        const display = await openDisplay(app, control);
        await openDisplayTab(control);

        await setEvent(control, '00:00', '00:01');
        await pickMode(control, 'to-end');

        await expect.poll(() => heroText(display)).toMatch(/^[−-]/);

        // Цвет ВЫЧИСЛЕННЫЙ, а не имя класса: класс мог остаться от прошлого
        // состояния, а краска — нет.
        const rgb = await display.evaluate(() => getComputedStyle(
            document.getElementById('timeDisplay')).color);
        const [r, g, b] = rgb.match(/\d+/g).map(Number);
        expect(r, `перерасход мероприятия не красный: ${rgb}`).toBeGreaterThan(g + 40);
        expect(r).toBeGreaterThan(b + 40);

        await pickMode(control, 'timer');
        await setEvent(control, '10:00', '12:00');
        await app.close();
    });

    test('своя подпись героя доезжает и стирается в стандартную', async () => {
        const { app, control } = await launchApp();
        const display = await openDisplay(app, control);
        await openDisplayTab(control);

        const caption = () => display.locator('#heroLabelText').textContent();

        await pickMode(control, 'to-end');
        await expect.poll(caption).toBe('До конца мероприятия');

        await control.locator('#labelHeroToEnd').fill('Финиш');
        await expect.poll(caption).toBe('Финиш');

        await control.locator('#labelHeroToEnd').fill('');
        await expect.poll(caption).toBe('До конца мероприятия');

        // В режиме таймера подпись снова отчёт о состоянии.
        await pickMode(control, 'timer');
        await expect.poll(caption).toBe('Осталось');

        await app.close();
    });

    test('режим переживает переоткрытие окна дисплея', async () => {
        const { app, control } = await launchApp();
        await openDisplay(app, control);
        await openDisplayTab(control);

        await pickMode(control, 'current');
        await control.evaluate(() => window.ipcRenderer.send('close-display'));
        const reopened = await openDisplay(app, control);

        await expect.poll(() => reopened.evaluate(
            () => document.body.className.includes('hero-mode-current'))).toBe(true);

        await pickMode(control, 'timer');
        await app.close();
    });

    test('аналоговая стрелка в режиме часов показывает ЧАС, а не долю от 12 часов', async () => {
        // Заложенный сюрприз: updateAnalogDisplay() раскладывает ДЛИТЕЛЬНОСТЬ
        // (час за 12 часов). Для настенных часов в 13:40 часовая стрелка
        // обязана встать по %12 — примерно на 50°, а не на 410°. Если замер
        // разойдётся, чинить арифметику стрелки, а не подгонять тест.
        const { app, control } = await launchApp();
        const display = await openDisplay(app, control);
        await openDisplayTab(control);

        await control.click('#displayTimerStyle button[data-val="analog"]');
        // Стиль применяется в окне дисплея асинхронно (IPC), а сам блок
        // скрыт классом `.active` до прихода настроек — ждём УСЛОВИЯ, а не
        // сразу читаем transform: иначе замер попадает на кадр ДО первой
        // отрисовки стрелки и всегда возвращает `matrix(1,0,0,1,0,0)`.
        await display.waitForSelector('#timerAnalog.active');
        await pickMode(control, 'current');

        const readAngle = () => display.evaluate(() => {
            const hand = document.getElementById('analogHandHour');
            const m = getComputedStyle(hand).transform.match(/matrix\(([^)]+)\)/);
            if (!m) { return { angle: null, expected: null }; }
            const [a, b] = m[1].split(',').map(Number);
            const deg = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
            const d = new Date();
            return { angle: deg, expected: ((d.getHours() % 12) + d.getMinutes() / 60) * 30 };
        });

        // Ждём, пока рассылка timer-state долетит и стрелка встанет — та же
        // логика settle-loop, что в analog-hour-hand.spec.js.
        let last = { angle: null, expected: null };
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            last = await readAngle();
            if (last.angle !== null && Math.abs(last.angle - last.expected) < 6) { break; }
            await display.waitForTimeout(120);
        }

        expect(last.angle, 'часовая стрелка ни разу не сдвинулась с matrix(1,0,0,1,0,0)').not.toBeNull();
        expect(Math.abs(last.angle - last.expected),
            `часовая стрелка на ${last.angle.toFixed(1)}°, ожидалось ${last.expected.toFixed(1)}°`
        ).toBeLessThan(6);

        await pickMode(control, 'timer');
        await control.click('#displayTimerStyle button[data-val="circle"]');
        await app.close();
    });

    test('«Цифры» в режиме «Текущее время» не вылезают за рамку', async () => {
        // updateDigitsScale() выбирает эталон подгонки по ЧИСЛУ ГЕРОЯ
        // (задача 4), но у самого эталона PROBE_HOURS = '8:88:88' — семь
        // знаков, однозначная цифра часа. У настенных часов часовая часть
        // двузначна с 10 до 23 («13:40:07» — восемь знаков), и тогда живой
        // текст на один разряд шире эталона, которым мерили рамку. Проверка
        // не подставляет свой час: чем бы он ни оказался у машины прогона,
        // чернила не имеют права вылезать за рамку блока.
        const { app, control } = await launchApp();
        const display = await openDisplay(app, control);
        await openDisplayTab(control);

        await control.click('#displayTimerStyle button[data-val="digits"]');
        await pickMode(control, 'current');
        await display.waitForSelector('#timerDigits.active');

        const overflow = await display.evaluate(() => new Promise((resolve) => {
            // Кегль пересчитывается только когда меняется формат (часы
            // появляются/пропадают), а не на каждый тик — ждём кадра после
            // смены режима, а не фиксированную паузу.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const box = document.getElementById('timerDigits').getBoundingClientRect();
                const ink = document.getElementById('digitsValue').getBoundingClientRect();
                resolve({
                    overflowPx: ink.right - box.right,
                    boxWidth: box.width,
                    inkWidth: ink.width,
                    text: document.getElementById('digitsValue').textContent
                });
            }));
        }));

        expect(overflow.overflowPx,
            `«${overflow.text}» (${overflow.inkWidth.toFixed(1)}px) шире рамки ` +
            `${overflow.boxWidth.toFixed(1)}px на ${overflow.overflowPx.toFixed(1)}px`
        ).toBeLessThanOrEqual(1);

        await pickMode(control, 'timer');
        await control.click('#displayTimerStyle button[data-val="circle"]');
        await app.close();
    });
});
