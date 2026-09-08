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
 * режим в «Таймер», а время мероприятия — в 10:00 / 12:00 — и делает это в
 * `finally`, а не последней строкой: Playwright обрывает тест на первом
 * упавшем `expect`, и код после него не выполняется. Без `finally` одна
 * реальная регрессия оставляла бы грязный профиль всем СЛЕДУЮЩИМ тестам (в
 * этом файле и в следующих файлах прогона) и осиротевший процесс Electron
 * (`workers: 1` в playwright.config.js существует именно потому, что второй
 * экземпляр падает на едином замке блокировки) — то есть настоящий дефект
 * тонул бы под лавиной вторичных падений. См.
 * docs/lessons.md#the-e2e-profile-is-shared-so-a-test-that-flips-global-state
 * и уже готовый образец — e2e/digits-style.spec.js, `try { … } finally { … }`.
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

// ---------------------------------------------------------------------------
// Сброс общего профиля — вызывается ТОЛЬКО из `finally`, поэтому каждый шаг
// специально «глотает» свою ошибку: если контрол уже закрыт или один из
// сбросов не удался, это не должно съесть ни оставшиеся сбросы, ни
// завершающий app.close(). Тот же приём, что resetDisplayStyle() в
// e2e/digits-style.spec.js.
// ---------------------------------------------------------------------------

async function resetHeroMode(control) {
    if (!control || control.isClosed()) { return; }
    await pickMode(control, 'timer').catch(() => {});
}

async function resetEventTimes(control) {
    if (!control || control.isClosed()) { return; }
    await setEvent(control, '10:00', '12:00').catch(() => {});
}

async function resetDisplayStyle(control) {
    if (!control || control.isClosed()) { return; }
    await control.click('#displayTimerStyle button[data-val="circle"]').catch(() => {});
}

test.describe('режимы центрального времени', () => {
    test('четыре режима дают на экране четыре разных числа', async () => {
        const { app, control } = await launchApp();
        try {
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
        } finally {
            await resetHeroMode(control);
            await resetEventTimes(control);
            await app.close();
        }
    });

    test('вне режима таймера плашка состояния скрыта при включённом тумблере', async () => {
        const { app, control } = await launchApp();
        try {
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
        } finally {
            await resetHeroMode(control);
            await app.close();
        }
    });

    test('«до конца» на прошедшем конце показывает минус и красный', async () => {
        const { app, control } = await launchApp();
        try {
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
        } finally {
            await resetHeroMode(control);
            await resetEventTimes(control);
            await app.close();
        }
    });

    test('своя подпись героя доезжает и стирается в стандартную', async () => {
        const { app, control } = await launchApp();
        try {
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
        } finally {
            await resetHeroMode(control);
            await app.close();
        }
    });

    test('режим переживает переоткрытие окна дисплея', async () => {
        const { app, control } = await launchApp();
        try {
            await openDisplay(app, control);
            await openDisplayTab(control);

            await pickMode(control, 'current');
            await control.evaluate(() => window.ipcRenderer.send('close-display'));
            const reopened = await openDisplay(app, control);

            await expect.poll(() => reopened.evaluate(
                () => document.body.className.includes('hero-mode-current'))).toBe(true);
        } finally {
            await resetHeroMode(control);
            await app.close();
        }
    });

    test('аналоговая стрелка в режиме часов показывает ЧАС, а не долю от 12 часов', async () => {
        // Заложенный сюрприз: updateAnalogDisplay() раскладывает ДЛИТЕЛЬНОСТЬ
        // (час за 12 часов). Для настенных часов в 13:40 часовая стрелка
        // обязана встать по %12 — примерно на 50°, а не на 410°. Если замер
        // разойдётся, чинить арифметику стрелки, а не подгонять тест.
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            await control.click('#displayTimerStyle button[data-val="analog"]');
            // Стиль применяется в окне дисплея асинхронно (IPC), а сам блок
            // скрыт классом `.active` до прихода настроек — ждём УСЛОВИЯ, а не
            // сразу читаем transform: иначе замер попадает на кадр ДО первой
            // отрисовки стрелки и всегда возвращает `matrix(1,0,0,1,0,0)`.
            await display.waitForSelector('#timerAnalog.active');
            await pickMode(control, 'current');

            // «Отрисовалось» и «угол верный» — ДВА РАЗНЫХ вопроса, проверяемых
            // раздельно. До первого присваивания transform элемент даёт
            // computed matrix(1,0,0,1,0,0) — то же самое, что и НАСТОЯЩИЙ угол
            // 0°, который бывает у реальных часов дважды в сутки (00:00–00:12,
            // 12:00–12:12, при пороге 6°). Если бы «отрисовалось» проверялось
            // ТОЙ ЖЕ величиной (angle≈expected), settle-loop мог бы остановиться
            // на самой ПЕРВОЙ итерации ДО какой-либо реальной отрисовки — просто
            // потому что ожидаемый угол в этот момент тоже около нуля — и тест
            // прошёл бы зелёным, ничего не измерив. Поэтому «отрисовалось»
            // читается из INLINE `style.transform` (что реально написал JS), а
            // не из COMPUTED — computed совпадает с identity и у настоящего
            // rotate(0deg), а inline остаётся пустой строкой, пока
            // updateAnalogDisplay() ни разу не присвоил её.
            const readAngle = () => display.evaluate(() => {
                const hand = document.getElementById('analogHandHour');
                const inlineTransform = hand.style.transform;
                const rendered = inlineTransform !== '' && inlineTransform !== 'none';
                if (!rendered) { return { rendered: false, angle: null, expected: null }; }
                const m = getComputedStyle(hand).transform.match(/matrix\(([^)]+)\)/);
                if (!m) { return { rendered: false, angle: null, expected: null }; }
                const [a, b] = m[1].split(',').map(Number);
                const deg = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
                const d = new Date();
                return { rendered: true, angle: deg, expected: ((d.getHours() % 12) + d.getMinutes() / 60) * 30 };
            });

            // Ждём, пока рассылка timer-state долетит и стрелка встанет — та же
            // логика settle-loop, что в analog-hour-hand.spec.js. Условие
            // остановки требует ОБА признака разом: реальную отрисовку И
            // сходящийся угол.
            let last = { rendered: false, angle: null, expected: null };
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
                last = await readAngle();
                if (last.rendered && Math.abs(last.angle - last.expected) < 6) { break; }
                await display.waitForTimeout(120);
            }

            // Раздельные утверждения с раздельными сообщениями: «не двигалась
            // вовсе» (updateAnalogDisplay() ничего не пишет) — это ДРУГОЙ дефект,
            // чем «двигалась, но не туда» (арифметика формулы).
            expect(last.rendered,
                'часовая стрелка ни разу не получила inline transform — updateAnalogDisplay() не пишет style.transform'
            ).toBe(true);
            expect(Math.abs(last.angle - last.expected),
                `часовая стрелка на ${last.angle.toFixed(1)}°, ожидалось ${last.expected.toFixed(1)}°`
            ).toBeLessThan(6);
        } finally {
            await resetHeroMode(control);
            await resetDisplayStyle(control);
            await app.close();
        }
    });

    test('«Цифры» с заведомо двузначным часом не вылезают за рамку', async () => {
        // updateDigitsScale() выбирает эталон подгонки по ЧИСЛУ ГЕРОЯ (задача
        // 4: `hasHours = Math.abs(Math.floor(this._heroSeconds())) >= 3600`),
        // но у самого эталона PROBE_HOURS = '8:88:88' — семь знаков,
        // ОДНОЗНАЧНАЯ цифра часа. formatTimeShort() для часа 10–23 не добавляет
        // padStart и даёт «HH:MM:SS» — восемь знаков, на разряд шире эталона;
        // для часа 0–9 даёт «H:MM:SS» — семь знаков, СОВПАДАЕТ с эталоном и
        // регресс не ловит вовсе.
        //
        // Никакого часа машины прогона не подставляем: время читается у
        // САМОГО ОКНА (`display.evaluate(() => new Date())`), а режим «До
        // конца» переводится на отметку «сейчас + 10ч11м (по часам окна)».
        // Арифметика ниже — БЕЗ переноса через полночь в исходном коде
        // (signedSecondsUntilClock — прямое вычитание секунд-с-полуночи), а
        // `endClock` собран по модулю суток, поэтому есть ровно два случая:
        //   – без переноса через полночь: |Δ| ≈ 36660с → час 10 (двузначный);
        //   – с переносом (после mod 86400 отметка «сегодня» оказалась РАНЬШЕ
        //     текущего момента): |Δ| ≈ 49740с → час 13 (тоже двузначный).
        // Оба случая дают ≥8 знаков ЛЮБОЙ момент суток, когда бы тест ни
        // запускался — детерминировано без подмены Date.
        //
        // Почему НЕ через знак минуса (казалось бы более простой путь):
        // digits-стиль знак и цифры рисует РАЗНЫМИ узлами — `digitsSign`
        // (position: absolute, вне потока) и `digitsValue`
        // (`Math.abs(secs)` — уже БЕЗ знака). Мой замер сравнивает именно
        // `digitsValue` с рамкой `#timerDigits`, поэтому знак к его ширине не
        // имеет отношения вообще: «До начала»/«До конца» на прошедшей минус-
        // отметке дают ТОТ ЖЕ текст в digitsValue, что и «Текущее время» в тот
        // же час, — определённость даёт не минус, а выбор ВЕЛИЧИНЫ смещения.
        const { app, control } = await launchApp();
        try {
            const display = await openDisplay(app, control);
            await openDisplayTab(control);

            const nowSeconds = await display.evaluate(() => {
                const d = new Date();
                return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
            });
            const targetSeconds = (nowSeconds + 10 * 3600 + 11 * 60) % 86400;
            const hh = String(Math.floor(targetSeconds / 3600)).padStart(2, '0');
            const mm = String(Math.floor((targetSeconds % 3600) / 60)).padStart(2, '0');
            await control.locator('#endTimeInput').fill(`${hh}:${mm}`);
            await control.locator('#endTimeInput').blur();

            await control.click('#displayTimerStyle button[data-val="digits"]');
            await pickMode(control, 'to-end');
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

            // Утверждение о РЕЖИМЕ отдельно от утверждения о вписывании: если
            // конструкция когда-нибудь перестанет давать двузначный час
            // (например, кто-то «упростит» вычисление targetSeconds), тест
            // обязан упасть здесь понятным сообщением, а не молча измерить
            // короткую строку и пройти без всякого покрытия регресса.
            expect(overflow.text.length,
                `ожидался двузначный час (≥8 знаков вида HH:MM:SS), измерено «${overflow.text}»`
            ).toBeGreaterThanOrEqual(8);

            expect(overflow.overflowPx,
                `«${overflow.text}» (${overflow.inkWidth.toFixed(1)}px) шире рамки ` +
                `${overflow.boxWidth.toFixed(1)}px на ${overflow.overflowPx.toFixed(1)}px`
            ).toBeLessThanOrEqual(1);
        } finally {
            await resetHeroMode(control);
            await resetEventTimes(control);
            await resetDisplayStyle(control);
            await app.close();
        }
    });
});
