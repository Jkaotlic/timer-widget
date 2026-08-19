const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Просьба 19.08.2026, три части — и все три про то, ЧТО НАРИСОВАНО:
 *
 *   1. «В дисплее флип — чтобы функциональные блоки повторяли стиль основного
 *      таймера, заднюю рамку убрать у функциональных блоков».
 *   2. «Полноэкранный, аналог — „До завершения“ без стиля аналога».
 *   3. «Полноэкранный, цифры — убрать заднюю рамку у всех функциональных
 *      блоков». И всё это в обеих темах.
 *
 * Почему замером, а не чтением правил. «Задняя рамка» — это НЕ одно свойство:
 * блок рисовал её заливкой, тенью И размытием фона, причём три стиля из
 * четырёх гасили только первые два. `background: none` не снимает
 * `backdrop-filter`, и размытый прямоугольник оставался виден — на светлом
 * тоне особенно. Источник сказал бы «фон снят», кадр показывал рамку.
 *
 * Проверка ОТСУТСТВИЯ обязана проверять сама себя (иначе зелёный значит и
 * «чисто», и «зонд ничего не меряет»), поэтому тем же зондом снимаются
 * поверхности, которые остаться ОБЯЗАНЫ: пластина флипа на значении и
 * циферблат аналога.
 */

const IS_DISPLAY = () => !!document.getElementById('progressRing');

async function findDisplay(app) {
    for (const w of app.windows()) {
        if (await w.evaluate(IS_DISPLAY).catch(() => false)) { return w; }
    }
    return null;
}

const setToggle = (control, id, value) => control.evaluate(([key, on]) => {
    const el = document.getElementById(key);
    if (!el) { return; }
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

const BLOCK_TOGGLES = ['showCurrentTime', 'showEventTime', 'showEndTime', 'showTimeLeft', 'showEventTitle'];

/** Всё, чем можно нарисовать плиту, — одним замером. */
const probeSurfaces = (page) => page.evaluate(() => {
    const paint = (el) => {
        const cs = getComputedStyle(el);
        return {
            backgroundImage: cs.backgroundImage,
            backgroundColor: cs.backgroundColor,
            boxShadow: cs.boxShadow,
            backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
            borderTopWidth: cs.borderTopWidth
        };
    };
    const out = { blocks: [], probes: {} };
    for (const el of document.querySelectorAll('.info-block')) {
        if (getComputedStyle(el).display === 'none') { continue; }
        out.blocks.push(Object.assign({ id: el.id }, paint(el)));
    }
    const value = document.querySelector('#eventTimeBlock .info-value');
    const dial = document.querySelector('#eventTimeBlock .mini-clock');
    out.probes.value = value ? paint(value) : null;
    out.probes.dial = dial ? paint(dial) : null;
    return out;
});

/** Заливка есть, если она не прозрачная и не отсутствует. */
function painted(surface) {
    if (!surface) { return false; }
    const opaqueColor = surface.backgroundColor
        && surface.backgroundColor !== 'transparent'
        && !/rgba\(0, 0, 0, 0\)/.test(surface.backgroundColor);
    return surface.backgroundImage !== 'none' || opaqueColor;
}

const STYLES = ['circle', 'flip', 'analog', 'digits'];

test('ни один блок не носит заднюю рамку — четыре стиля, обе темы', async () => {
    test.setTimeout(180000);
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        await control.click('.tab-btn[data-tab="display"]');
        for (const key of BLOCK_TOGGLES) { await setToggle(control, key, true); }
        await display.waitForTimeout(700);

        // Умолчание приложения — светлая тема; тёмную включает та же кнопка.
        for (const theme of ['светлая', 'тёмная']) {
            if (theme === 'тёмная') {
                await control.click('#contrastToggle');
                await control.waitForTimeout(900);
            }
            for (const style of STYLES) {
                await control.click(`#displayTimerStyle button[data-val="${style}"]`);
                await display.waitForTimeout(700);

                const seen = await probeSurfaces(display);
                expect(seen.blocks.length, `${theme}/${style}: блоки не показались`).toBeGreaterThanOrEqual(5);

                for (const b of seen.blocks) {
                    expect(
                        painted(b),
                        `${theme}/${style}/${b.id}: у блока осталась заливка `
                        + `(image ${b.backgroundImage}, color ${b.backgroundColor})`
                    ).toBe(false);
                    expect(b.boxShadow, `${theme}/${style}/${b.id}: у блока осталась тень`).toBe('none');
                    expect(
                        b.backdropFilter,
                        `${theme}/${style}/${b.id}: блок всё ещё размывает фон под собой`
                    ).toBe('none');
                    expect(
                        parseFloat(b.borderTopWidth),
                        `${theme}/${style}/${b.id}: у блока осталась кромка`
                    ).toBe(0);
                }

                // Проверка проверки: зонд обязан УМЕТЬ увидеть поверхность.
                if (style === 'flip') {
                    expect(
                        painted(seen.probes.value),
                        'флип: пластина под значением исчезла — либо стиль сломан, '
                        + 'либо зонд не видит заливок, и всё выше зеленеет впустую'
                    ).toBe(true);
                }
                if (style === 'analog') {
                    expect(
                        painted(seen.probes.dial),
                        'аналог: циферблат блока исчез — либо стиль сломан, либо зонд слеп'
                    ).toBe(true);
                }
            }
        }
    } finally {
        // Профиль e2e общий: возвращаем тему и стиль по умолчанию.
        await control.click('#contrastToggle').catch(() => {});
        // Стиль возвращается ЗНАЧЕНИЕМ, а не кликом: кнопка живёт в ящике
        // настроек, и если он закрылся, клик ждёт видимости и молча падает по
        // таймауту (в `finally` это ещё и незаметно). Соседние спеки открывают
        // дисплей заново и берут стиль ИЗ ПРОФИЛЯ — оставленный «аналог»
        // показал бы им окно вообще без кольца.
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerStyle');
            if (el) { el.value = 'circle'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
        for (const key of BLOCK_TOGGLES) { await setToggle(control, key, false).catch(() => {}); }
        await app.close();
    }
});

test('аналог: «До завершения» показывает ОСТАТОК стрелками, как большой циферблат', async () => {
    // До 19.08.2026 блок был единственным в стиле, набранным строкой: мини-часов
    // в разметке не было намеренно («длительность, а не момент»). Но большой
    // циферблат этого стиля крутит стрелки ровно длительностью, и блок обязан
    // повторять ЕГО арифметику, а не заводить свою.
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        await control.click('.tab-btn[data-tab="display"]');
        for (const key of BLOCK_TOGGLES) { await setToggle(control, key, true); }

        // Время окончания задаётся ОТНОСИТЕЛЬНО СЕЙЧАС, а не числом «12:00».
        // «До завершения» считает расстояние от системных часов до этого
        // момента, и прошедшее время даёт НОЛЬ (это осознанное поведение, см.
        // secondsUntilClock). Спека с прибитым «12:00» зеленела утром и падала
        // вечером: обе стрелки честно стояли на 12 при значении 00:00:00 —
        // ровно тот класс дефекта, что уже разбирался как «время — скрытый
        // параметр проверки».
        const endTime = await control.evaluate(() => {
            const now = new Date();
            // +2 часа, но не за полночь: после неё «завтра» снова означает ноль.
            const end = new Date(now.getTime() + 2 * 3600 * 1000);
            const value = end.getDate() === now.getDate()
                ? `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
                : '23:59';
            const el = document.getElementById('endTimeInput');
            el.value = value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return value;
        });
        console.log(`   время окончания на сегодня: ${endTime}`);

        await control.click('#displayTimerStyle button[data-val="analog"]');
        await display.waitForTimeout(1200);

        const seen = await display.evaluate(() => {
            const block = document.getElementById('timeLeftBlock');
            const dial = block.querySelector('.mini-clock');
            const angle = (el) => {
                if (!el) { return null; }
                const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
                const deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
                return (deg + 360) % 360;
            };
            // Значение и углы снимаются ОДНИМ кадром: секунда между двумя
            // чтениями сдвинула бы стрелку, и тест ловил бы собственную паузу.
            return {
                text: document.getElementById('timeLeftValue').textContent,
                hasDial: !!dial,
                dialRadius: dial ? getComputedStyle(dial).borderRadius : null,
                hour: angle(block.querySelector('.mini-hand-hour')),
                minute: angle(block.querySelector('.mini-hand-minute'))
            };
        });
        console.log(`   «До завершения» = ${seen.text}, стрелки: час ${seen.hour}°, минута ${seen.minute}°`);

        expect(seen.hasDial, '«До завершения» осталось без циферблата').toBe(true);
        expect(seen.dialRadius, 'циферблат блока не круглый').toBe('50%');

        const [h, m, s] = seen.text.split(':').map(Number);
        expect(Number.isFinite(h) && Number.isFinite(m), `значение не разобрано: ${seen.text}`).toBe(true);

        // Та же арифметика, что у updateAnalogDisplay: час — за 12 часов
        // ОСТАТКА, минута — за 60 минут, обе плавно.
        const wantHour = ((h % 12) * 30 + m * 0.5) % 360;
        const wantMinute = (m * 6 + s * 0.1) % 360;
        const diff = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
        expect(diff(seen.hour, wantHour), `часовая: ${seen.hour}° вместо ${wantHour}°`).toBeLessThanOrEqual(1.5);
        expect(diff(seen.minute, wantMinute), `минутная: ${seen.minute}° вместо ${wantMinute}°`).toBeLessThanOrEqual(1.5);

        // Проверка проверки: значение НЕ нулевое (иначе стрелки честно стоят
        // на 12 и совпадение вышло бы на любой разметке) и хотя бы одна
        // стрелка сдвинута.
        expect(h * 3600 + m * 60 + s, `«До завершения» = ${seen.text}: считать нечего`).toBeGreaterThan(60);
        expect(
            Math.max(seen.hour, seen.minute),
            'обе стрелки на 12 при ненулевом остатке — блок никто не крутит'
        ).toBeGreaterThan(0);
    } finally {
        // Профиль общий: возвращаем время окончания к умолчанию.
        await control.evaluate(() => {
            const el = document.getElementById('endTimeInput');
            if (el) { el.value = '12:00'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
        // Стиль возвращается ЗНАЧЕНИЕМ, а не кликом: кнопка живёт в ящике
        // настроек, и если он закрылся, клик ждёт видимости и молча падает по
        // таймауту (в `finally` это ещё и незаметно). Соседние спеки открывают
        // дисплей заново и берут стиль ИЗ ПРОФИЛЯ — оставленный «аналог»
        // показал бы им окно вообще без кольца.
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerStyle');
            if (el) { el.value = 'circle'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
        for (const key of BLOCK_TOGGLES) { await setToggle(control, key, false).catch(() => {}); }
        await app.close();
    }
});

test('верхний ряд блоков выровнен: подписи на одной линии, значения тоже', async () => {
    // «Подними размер всех функциональных блоков и выровняй их относительно
    // всех величин». Три верхних блока стоят на одном `top: 20px`, но у блока
    // названия подписи НЕТ — и его текст вставал выше значений соседей на всю
    // высоту их подписи. Теперь строка подписи там зарезервирована пустым
    // `.info-label` (правило `.info-label:empty::before`).
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        // Сохранённые в общем профиле позиции и масштабы сдвинули бы ряд —
        // меряем блоки на их домашних местах и в одном масштабе.
        await display.evaluate(() => {
            localStorage.removeItem('displayBlockPositions');
            localStorage.removeItem('displayBlockScales');
            localStorage.removeItem('displayBlockScale');
        });
        await control.evaluate(() => window.ipcRenderer.send('close-display'));
        await control.waitForTimeout(900);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2500);
        const disp = await findDisplay(app);

        await control.click('.tab-btn[data-tab="display"]');
        for (const key of BLOCK_TOGGLES) { await setToggle(control, key, true); }
        await control.evaluate(() => {
            const el = document.getElementById('eventTitleInput');
            if (el) { el.value = 'Ежегодная конференция'; el.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await disp.waitForTimeout(900);

        const TOP_ROW = ['timeLeftBlock', 'currentTimeBlock', 'eventTitleBlock'];

        // Аналог идёт в тот же список, но с одной оговоркой: значения там
        // живут ВНУТРИ циферблата у блоков с циферблатом и строкой у названия,
        // поэтому на одной линии обязаны стоять ПОДПИСИ — их и меряем.
        for (const style of ['circle', 'flip', 'digits', 'analog']) {
            await control.click(`#displayTimerStyle button[data-val="${style}"]`);
            await disp.waitForTimeout(700);

            const rows = await disp.evaluate((ids) => ids.map((id) => {
                const el = document.getElementById(id);
                const label = el.querySelector('.info-label');
                const value = el.querySelector('.info-value');
                const top = (node) => (node ? Math.round(node.getBoundingClientRect().top) : null);
                return { id, block: top(el), label: top(label), value: top(value) };
            }), TOP_ROW);
            console.log(`   ${style}: ${JSON.stringify(rows)}`);

            for (const r of rows) {
                expect(r.label, `${style}/${r.id}: строки подписи нет вовсе`).not.toBeNull();
            }
            const spread = (key) => Math.max(...rows.map((r) => r[key])) - Math.min(...rows.map((r) => r[key]));
            expect(spread('block'), `${style}: верхние блоки стоят на разной высоте`).toBeLessThanOrEqual(2);
            expect(spread('label'), `${style}: подписи верхнего ряда не на одной линии`).toBeLessThanOrEqual(2);
            if (style !== 'analog') {
                expect(spread('value'), `${style}: значения верхнего ряда не на одной линии`).toBeLessThanOrEqual(3);
            }
        }
    } finally {
        // Стиль возвращается ЗНАЧЕНИЕМ, а не кликом: кнопка живёт в ящике
        // настроек, и если он закрылся, клик ждёт видимости и молча падает по
        // таймауту (в `finally` это ещё и незаметно). Соседние спеки открывают
        // дисплей заново и берут стиль ИЗ ПРОФИЛЯ — оставленный «аналог»
        // показал бы им окно вообще без кольца.
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerStyle');
            if (el) { el.value = 'circle'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }).catch(() => {});
        for (const key of BLOCK_TOGGLES) { await setToggle(control, key, false).catch(() => {}); }
        await app.close();
    }
});
