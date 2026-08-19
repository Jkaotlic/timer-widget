const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Блоки дисплея: у каждого свой тумблер, каждый тащится и закрывается крестиком.
 *
 * Просьба 17.08.2026, четыре части:
 *   1. Выключать верхнюю подпись («Осталось» / «Сверх времени») и плашку
 *      состояния («Перерасход времени»).
 *   2. Закрывать блоки «Начало» и «Окончание» прямо в окне, и то же самое —
 *      тумблером в настройках.
 *   3. Добавить «До завершения» и название мероприятия — тоже опциональными,
 *      перетаскиваемыми и закрываемыми.
 *   4. Убрать поле «Расположение».
 *
 * Что здесь проверяется в первую очередь: КАЖДЫЙ тумблер гасит СВОЙ блок и
 * крестик снимает СВОЙ тумблер. Пять блоков плюс две подписи — это семь пар
 * «элемент ↔ ключ», и перепутанная пара выглядит как работающая функция:
 * что-то скрылось, что-то показалось.
 */

const BLOCKS = [
    { toggle: 'showCurrentTime', block: 'currentTimeBlock', name: 'текущее время' },
    { toggle: 'showEventTime', block: 'eventTimeBlock', name: 'начало' },
    { toggle: 'showEndTime', block: 'endTimeBlock', name: 'окончание' },
    { toggle: 'showTimeLeft', block: 'timeLeftBlock', name: 'до завершения' },
    { toggle: 'showEventTitle', block: 'eventTitleBlock', name: 'название' }
];

async function findDisplay(app) {
    for (const w of app.windows()) {
        if (await w.evaluate(() => !!document.getElementById('progressRing')).catch(() => false)) { return w; }
    }
    return null;
}

const setToggle = (control, id, value) => control.evaluate(([key, on]) => {
    const el = document.getElementById(key);
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

const visibleIds = (page) => page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('.info-block')) {
        out[el.id] = el.classList.contains('visible');
    }
    return out;
});

test('каждый тумблер гасит СВОЙ блок и ничего кроме него', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        // Включаем все пять.
        for (const b of BLOCKS) { await setToggle(control, b.toggle, true); }
        await display.waitForTimeout(700);
        const all = await visibleIds(display);
        for (const b of BLOCKS) {
            expect(all[b.block], `${b.name}: тумблер включён, блока нет`).toBe(true);
        }

        // Гасим по одному и проверяем, что гаснет РОВНО он.
        for (const b of BLOCKS) {
            await setToggle(control, b.toggle, false);
            await display.waitForTimeout(400);
            const state = await visibleIds(display);
            for (const other of BLOCKS) {
                const expected = other.toggle !== b.toggle;
                expect(state[other.block], `выключили «${b.name}», а «${other.name}» ${expected ? 'исчез' : 'остался'}`)
                    .toBe(expected);
            }
            await setToggle(control, b.toggle, true);
            await display.waitForTimeout(300);
        }
    } finally {
        for (const b of BLOCKS) { await setToggle(control, b.toggle, false).catch(() => {}); }
        await app.close();
    }
});

test('крестик на блоке снимает ИМЕННО его тумблер в панели', async () => {
    // Дисплей гасит блок у себя сразу, но состояние принадлежит панели: без
    // сообщения обратно блок вернулся бы при следующем пуше настроек, а после
    // переоткрытия окна — тем более.
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);

        for (const b of BLOCKS) { await setToggle(control, b.toggle, true); }
        await display.waitForTimeout(700);

        const target = BLOCKS[1]; // «Начало»
        await display.evaluate((id) => {
            document.getElementById(id).querySelector('.info-close').click();
        }, target.block);
        await display.waitForTimeout(900);

        const toggles = await control.evaluate((list) => {
            const out = {};
            for (const key of list) { out[key] = document.getElementById(key).checked; }
            return out;
        }, BLOCKS.map((b) => b.toggle));
        console.log('тумблеры после крестика →', JSON.stringify(toggles));

        expect(toggles[target.toggle], 'крестик не снял тумблер своего блока').toBe(false);
        for (const b of BLOCKS) {
            if (b.toggle === target.toggle) { continue; }
            expect(toggles[b.toggle], `крестик «${target.name}» погасил чужой тумблер «${b.name}»`).toBe(true);
        }

        // И блок не возвращается после следующего пуша настроек.
        await control.evaluate(() => {
            const el = document.getElementById('showCurrentTime');
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await display.waitForTimeout(700);
        const after = await visibleIds(display);
        expect(after[target.block], 'закрытый блок вернулся при следующем пуше настроек').toBe(false);
    } finally {
        for (const b of BLOCKS) { await setToggle(control, b.toggle, false).catch(() => {}); }
        await app.close();
    }
});

test('подпись над таймером и плашка состояния: выключаются, тащатся и не двигают таймер', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2200);
        let display = await findDisplay(app);

        const geometry = () => {
            const box = (sel) => {
                const el = document.querySelector(sel);
                const r = el.getBoundingClientRect();
                return {
                    x: Math.round(r.left),
                    y: Math.round(r.top),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                    // Центр — то, что приложение и обещает хранить: позиция
                    // элемента дисплея это ДОЛЯ окна для его ЦЕНТРА.
                    cx: Math.round(r.left + r.width / 2),
                    cy: Math.round(r.top + r.height / 2)
                };
            };
            return {
                label: box('#heroLabel'),
                pill: box('#statusPill'),
                ring: box('#timerRing'),
                labelText: document.getElementById('heroLabelText').textContent,
                labelShown: getComputedStyle(document.getElementById('heroLabel')).display !== 'none',
                pillShown: getComputedStyle(document.querySelector('.status-container')).display !== 'none'
            };
        };

        // 1. Выключаются.
        await setToggle(control, 'showHeroLabel', false);
        await setToggle(control, 'showStatusPill', false);
        await display.waitForTimeout(700);
        let g = await display.evaluate(geometry);
        expect(g.labelShown, 'подпись не выключилась').toBe(false);
        expect(g.pillShown, 'плашка не выключилась').toBe(false);

        await setToggle(control, 'showHeroLabel', true);
        await setToggle(control, 'showStatusPill', true);
        await display.waitForTimeout(700);
        const before = await display.evaluate(geometry);
        expect(before.labelShown && before.pillShown, 'подпись и плашка должны вернуться').toBe(true);

        // 2. Тащатся. Замер сдвига — по РАЗНИЦЕ координат: она и есть предмет.
        //
        // Дельта считается ОТ ОКНА, а не прибита числом. Прежние −600 px были
        // безобидны на здешнем экране (3440 в ширину) и невозможны под xvfb на
        // CI (1280): подпись стоит по центру, слева от неё ~520 px, и жест
        // упирался в поле у края — сдвиг выходил 539 вместо 600, тест падал с
        // разницей 61. Это проверка на разрешение монитора, а не на
        // перетаскивание.
        const view = await display.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
        const DX = -Math.round(view.w * 0.12), DY = Math.round(view.h * 0.06);
        await display.evaluate(([id, dx, dy]) => {
            const el = document.getElementById(id);
            const r = el.getBoundingClientRect();
            const opts = (x, y) => ({
                bubbles: true, cancelable: true, button: 0, altKey: true,
                screenX: x, screenY: y, clientX: x, clientY: y
            });
            el.dispatchEvent(new MouseEvent('mousedown', opts(r.left + 5, r.top + 5)));
            for (let i = 1; i <= 4; i++) {
                document.dispatchEvent(new MouseEvent('mousemove', opts(r.left + 5 + (dx * i) / 4, r.top + 5 + (dy * i) / 4)));
            }
            document.dispatchEvent(new MouseEvent('mouseup', opts(r.left + 5 + dx, r.top + 5 + dy)));
        }, ['heroLabel', DX, DY]);
        await display.waitForTimeout(600);

        g = await display.evaluate(geometry);
        console.log(`подпись ${before.label.x},${before.label.y} → ${g.label.x},${g.label.y}`);
        // Допуск в пиксель: начальное `left` берётся из дробного
        // getBoundingClientRect через parseInt, а замер — округлением, поэтому
        // сдвиг может отличаться на единицу. Предмет проверки — что блок
        // проехал именно на заданную дельту, а не «куда-то сдвинулся».
        expect(Math.abs((g.label.x - before.label.x) - DX), 'подпись не сдвинулась по горизонтали').toBeLessThanOrEqual(1);
        expect(Math.abs((g.label.y - before.label.y) - DY), 'подпись не сдвинулась по вертикали').toBeLessThanOrEqual(1);

        // 3. Таймер при этом остаётся на месте: подпись ушла из потока, и
        //    компенсирующий отступ колонки обязан уйти вместе с ней.
        expect(g.ring.y, `кольцо съехало: ${before.ring.y} → ${g.ring.y}`).toBe(before.ring.y);

        // 4. Текст подписи цел — он в своём span, иначе его перезапись стёрла бы
        //    крестик (так уже ломался знак минуса в «Цифрах»).
        expect(g.labelText, 'текст подписи потерялся').toBe(before.labelText);

        // 5. Позиция переживает переоткрытие окна.
        await control.evaluate(() => window.ipcRenderer.send('close-display'));
        await control.waitForTimeout(900);
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2500);
        display = await findDisplay(app);
        const reopened = await display.evaluate(geometry);
        console.log(`после переоткрытия: центр ${reopened.label.cx},${reopened.label.cy} `
            + `(было ${g.label.cx},${g.label.cy}); ширина ${g.label.w} → ${reopened.label.w}`);
        // Сверяется ЦЕНТР, а не левый край, и это не послабление, а предмет
        // договора: в хранилище лежит доля окна для ЦЕНТРА элемента
        // (positionToFraction / fractionToPosition). Ширина подписи между
        // сессиями может отличаться на пиксель-другой — метрики шрифта на
        // Windows не совпадают с macOS, а текст подписи зависит от состояния
        // таймера, — и тогда левый край честно уезжает на половину разницы,
        // хотя элемент стоит там же. Замер на раннере Windows 19.08.2026:
        // левый край 4px, из-за чего проверка и покраснела.
        expect(Math.abs(reopened.label.cx - g.label.cx), 'центр подписи не восстановился по горизонтали')
            .toBeLessThanOrEqual(2);
        expect(Math.abs(reopened.label.cy - g.label.cy), 'центр подписи не восстановился по вертикали')
            .toBeLessThanOrEqual(2);
    } finally {
        // Профиль e2e общий на весь прогон — возвращаем расположение.
        await control.evaluate(() => localStorage.removeItem('displayBlockPositions')).catch(() => {});
        await app.close();
    }
});

test('Alt не двигает НИ ОДИН элемент, и жест не прыгает под курсором', async () => {
    // Две жалобы «с перетаскиванием полная беда» — обе про сдвиг, которого
    // пользователь не просил.
    //
    // 1. Нажатие Alt. Правило подсветки давало перетаскиваемым
    //    `position: relative` (крестику нужен позиционированный предок) и этим
    //    перебивало `position: fixed` у блоков: по нажатию клавиши все пять
    //    срывались с мест и сваливались в поток. Замер: «Окончание»
    //    3269,1241 → 337,571. Проверка «ничего не сдвинулось» тут сильнее
    //    проверки конкретного значения `position`: она переживёт любую
    //    переделку подсветки.
    //
    // 2. Начало жеста. `left/top` задают НЕотмасштабированную коробку, а
    //    видимая увеличена на `--info-scale`, и расходятся они по-разному в
    //    зависимости от `transform-origin` (у правых углов он `top right`, у
    //    свободного положения `center`). Блок названия прыгал на 32px влево
    //    ещё до первого движения мыши.
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);

        await control.evaluate(() => localStorage.removeItem('displayBlockPositions'));
        for (const b of BLOCKS) { await setToggle(control, b.toggle, true); }
        await setToggle(control, 'showHeroLabel', true);
        await setToggle(control, 'showStatusPill', true);
        await display.waitForTimeout(900);

        const boxes = () => {
            const out = {};
            for (const el of document.querySelectorAll('.display-movable')) {
                const r = el.getBoundingClientRect();
                out[el.id] = { x: Math.round(r.left), y: Math.round(r.top) };
            }
            return out;
        };

        const before = await display.evaluate(boxes);
        await display.evaluate(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
        });
        await display.waitForTimeout(400);
        const after = await display.evaluate(boxes);

        for (const id of Object.keys(before)) {
            expect(after[id], `${id} уехал по нажатию Alt: ${JSON.stringify(before[id])} → ${JSON.stringify(after[id])}`)
                .toEqual(before[id]);
        }

        // Жест: тащим ВНУТРЬ экрана, чтобы не упереться в границу (она своя
        // проверка), и меряем и прыжок на нажатии, и пройденный путь.
        for (const id of ['eventTitleBlock', 'heroLabel', 'statusPill']) {
            const res = await display.evaluate(async (target) => {
                const el = document.getElementById(target);
                const box = () => {
                    const r = el.getBoundingClientRect();
                    return { x: Math.round(r.left), y: Math.round(r.top) };
                };
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const o = (x, y) => ({
                    bubbles: true, cancelable: true, button: 0, altKey: true,
                    screenX: x, screenY: y, clientX: x, clientY: y
                });
                // Тащим К ЦЕНТРУ окна: у края любой жест упрётся в границу, и
                // тест мерил бы её, а не движение (плашка стоит внизу и вниз
                // проезжала 59px из 150 — это работает поджатие, а не дефект).
                const start = box();
                const DX = Math.sign(window.innerWidth / 2 - start.x) * 200;
                const DY = Math.sign(window.innerHeight / 2 - start.y) * 120;
                const px = start.x + 10, py = start.y + 10;

                el.dispatchEvent(new MouseEvent('mousedown', o(px, py)));
                await wait(60);
                const afterDown = box();
                for (let i = 1; i <= 6; i++) {
                    document.dispatchEvent(new MouseEvent('mousemove', o(px + (DX * i) / 6, py + (DY * i) / 6)));
                    await wait(30);
                }
                document.dispatchEvent(new MouseEvent('mouseup', o(px + DX, py + DY)));
                await wait(120);
                const afterUp = box();
                return {
                    jump: { dx: afterDown.x - start.x, dy: afterDown.y - start.y },
                    travel: { dx: afterUp.x - start.x, dy: afterUp.y - start.y },
                    want: { dx: DX, dy: DY }
                };
            }, id);
            console.log(`${id}: прыжок ${JSON.stringify(res.jump)}, проехал ${JSON.stringify(res.travel)}`);

            expect(Math.abs(res.jump.dx), `${id} прыгнул по горизонтали в момент нажатия`).toBeLessThanOrEqual(1);
            expect(Math.abs(res.jump.dy), `${id} прыгнул по вертикали в момент нажатия`).toBeLessThanOrEqual(1);
            expect(Math.abs(res.travel.dx - res.want.dx), `${id} проехал не на ту дистанцию по X`).toBeLessThanOrEqual(1);
            expect(Math.abs(res.travel.dy - res.want.dy), `${id} проехал не на ту дистанцию по Y`).toBeLessThanOrEqual(1);
        }
    } finally {
        await control.evaluate(() => localStorage.removeItem('displayBlockPositions')).catch(() => {});
        for (const b of BLOCKS) { await setToggle(control, b.toggle, false).catch(() => {}); }
        await app.close();
    }
});

test('«До завершения» считает до времени окончания, а не по таймеру', async () => {
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 'auto' }));
        await control.waitForTimeout(2200);
        const display = await findDisplay(app);

        // Ставим «Конец» на 40 минут вперёд от системного времени.
        const target = await control.evaluate(() => {
            const now = new Date();
            const then = new Date(now.getTime() + 40 * 60 * 1000);
            const hh = String(then.getHours()).padStart(2, '0');
            const mm = String(then.getMinutes()).padStart(2, '0');
            const el = document.getElementById('endTimeInput');
            el.value = `${hh}:${mm}`;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            document.getElementById('showTimeLeft').checked = true;
            document.getElementById('showTimeLeft').dispatchEvent(new Event('change', { bubbles: true }));
            return `${hh}:${mm}`;
        });
        await display.waitForTimeout(1500);

        const shown = await display.evaluate(() => document.getElementById('timeLeftValue').textContent);
        console.log(`«Конец» ${target} → до завершения ${shown}`);

        const parts = shown.split(':').map(Number);
        const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        // 40 минут минус доли минуты на округление вниз до целой минуты.
        expect(seconds, `ожидалось около 40 минут, показано ${shown}`).toBeGreaterThan(38 * 60);
        expect(seconds, `ожидалось около 40 минут, показано ${shown}`).toBeLessThanOrEqual(40 * 60);
    } finally {
        await setToggle(control, 'showTimeLeft', false).catch(() => {});
        await control.evaluate(() => {
            const el = document.getElementById('endTimeInput');
            el.value = '12:00';
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => {});
        await app.close();
    }
});

test('в настройках дисплея больше нет ни общего тумблера блоков, ни пресета расположения', async () => {
    // Оба убраны 17.08.2026: общий тумблер поверх личных давал два уровня
    // состояния, а пресет спорил с перетаскиванием. Проверяется ОТСУТСТВИЕ
    // элементов, а не их скрытость: спрятанный контрол оставил бы мёртвую
    // проводку, и это ровно тот случай, который в этом проекте уже был с
    // тумблером делений.
    const { app, control } = await launchApp();
    try {
        const gone = await control.evaluate(() => ({
            showTimeBlocks: !!document.getElementById('showTimeBlocks'),
            timeLayoutPreset: !!document.getElementById('timeLayoutPreset'),
            // Проверка проверки: новые контролы на месте, то есть искали в
            // живой панели.
            showEventTime: !!document.getElementById('showEventTime'),
            eventTitleInput: !!document.getElementById('eventTitleInput')
        }));
        console.log('панель →', JSON.stringify(gone));
        expect(gone.showTimeBlocks, 'общий тумблер «Показывать блоки» обязан исчезнуть').toBe(false);
        expect(gone.timeLayoutPreset, 'пресет «Расположение» обязан исчезнуть').toBe(false);
        expect(gone.showEventTime, 'тумблер «Начало» должен быть в панели').toBe(true);
        expect(gone.eventTitleInput, 'поле названия должно быть в панели').toBe(true);
    } finally {
        await app.close();
    }
});

test('аналог: круг — у циферблата, подписи не вылезают, название идёт строкой', async () => {
    // Жалоба 18.08.2026: «надписи выезжают из функциональных блоков и название
    // мероприятия в круге, зачем?».
    //
    // Причина была одна на оба симптома: правило висело на `.info-block`, то
    // есть делало кругом ЛЮБОЙ блок — включая те, у которых циферблата нет
    // вовсе («До завершения» показывает длительность, название мероприятия —
    // это текст). А подпись стояла внутри круга абсолютом, и у абсолютного
    // бокса нет обязательства поместиться.
    //
    // Замер до правки (блок 120×120): «Текущее время» 115.6px и «До
    // завершения» 117.6px против ХОРДЫ круга ≈96px на высоте подписи;
    // «Ежегодная конференция» — 216.2px в круге 120px.
    const { app, control } = await launchApp();
    try {
        const display = await findDisplay(app);
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1800);
        const disp = display || await findDisplay(app);
        expect(disp, 'окно дисплея не найдено').not.toBeNull();

        await control.click('.tab-btn[data-tab="display"]');
        for (const b of BLOCKS) { await setToggle(control, b.toggle, true); }
        await control.evaluate(() => {
            const el = document.getElementById('eventTitleInput');
            if (el) { el.value = 'Ежегодная конференция'; el.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await control.click('#displayTimerStyle button[data-val="analog"]');
        await disp.waitForTimeout(1000);

        const seen = await disp.evaluate(() => {
            const out = [];
            for (const el of document.querySelectorAll('.info-block')) {
                if (getComputedStyle(el).display === 'none') { continue; }
                const box = el.getBoundingClientRect();
                const dial = el.querySelector('.mini-clock');
                const parts = [];
                for (const sel of ['.info-label', '.info-value']) {
                    const node = el.querySelector(sel);
                    if (!node) { continue; }
                    const r = node.getBoundingClientRect();
                    parts.push({ sel, text: node.textContent, overflow: Math.round(r.width - box.width) });
                }
                out.push({
                    id: el.id,
                    hasDial: !!dial,
                    blockRadius: getComputedStyle(el).borderRadius,
                    dialRadius: dial ? getComputedStyle(dial).borderRadius : null,
                    parts
                });
            }
            return out;
        });
        console.log('   ' + JSON.stringify(seen, null, 1).split('\n').join('\n   '));

        expect(seen.length, 'блоки не показались').toBeGreaterThanOrEqual(5);
        for (const b of seen) {
            // 1. Ничего не вылезает за свой блок — ни подпись, ни значение.
            for (const part of b.parts) {
                expect(
                    part.overflow,
                    `${b.id}: «${part.text}» шире своего блока на ${part.overflow}px`
                ).toBeLessThanOrEqual(0);
            }
            // 2. Круг — ТОЛЬКО у того, у кого есть циферблат, и круг этот
            //    принадлежит самому циферблату, а не блоку-обёртке.
            if (b.hasDial) {
                expect(b.dialRadius, `${b.id}: циферблат перестал быть круглым`).toBe('50%');
            } else {
                expect(
                    b.blockRadius,
                    `${b.id}: блок без циферблата снова стал кругом (${b.blockRadius})`
                ).not.toBe('50%');
            }
            expect(
                b.blockRadius,
                `${b.id}: круг вернулся на блок-обёртку вместо циферблата`
            ).not.toBe('50%');
        }

        // 3. Проверка проверки: сам циферблат в этом стиле обязан существовать.
        //    Без неё всё выше зеленело бы и на разметке вообще без мини-часов.
        expect(seen.filter((b) => b.hasDial).length, 'мини-циферблатов не осталось вовсе').toBeGreaterThanOrEqual(3);

        await control.click('#displayTimerStyle button[data-val="circle"]');
        await disp.waitForTimeout(400);
    } finally {
        await app.close();
    }
});

test('длинное название мероприятия переносится, а не обрезается и не уходит за край', async () => {
    // Жалоба 18.08.2026: «название вылезает за блок сзади и не продолжается».
    //
    // Причина — один класс на две разные вещи. `.info-value` несёт
    // `white-space: nowrap` ради ВРЕМЕНИ («12:00» ломать по двоеточию нельзя),
    // а название вводит пользователь, и длина его ничем не ограничена.
    //
    // Замер до правки на 3440px, название в 58 знаков: в круге и «Цифрах»
    // строка 1341px против клиентских 1043 — обрезана; у флипа 1421px в блоке
    // 1314, то есть вылезала и за блок, и за правый край ОКНА.
    const LONG = 'Ежегодная конференция разработчиков и партнёров компании 2026';
    const { app, control } = await launchApp();
    try {
        await control.waitForLoadState('domcontentloaded');
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(1800);
        const display = await findDisplay(app);
        expect(display, 'окно дисплея не найдено').not.toBeNull();

        await control.click('.tab-btn[data-tab="display"]');
        await setToggle(control, 'showEventTitle', true);
        await control.evaluate((t) => {
            const el = document.getElementById('eventTitleInput');
            el.value = t;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, LONG);

        for (const style of ['circle', 'analog', 'flip', 'digits']) {
            await control.click(`#displayTimerStyle button[data-val="${style}"]`);
            await display.waitForTimeout(700);
            const m = await display.evaluate(() => {
                const block = document.getElementById('eventTitleBlock');
                const value = document.getElementById('eventTitleValue');
                const b = block.getBoundingClientRect();
                const r = value.getBoundingClientRect();
                return {
                    scrollW: value.scrollWidth, clientW: value.clientWidth,
                    valueRight: r.right, valueLeft: r.left,
                    blockRight: b.right, blockLeft: b.left,
                    vw: window.innerWidth, lines: Math.round(r.height)
                };
            });
            console.log(`   ${style}: scroll=${m.scrollW}/${m.clientW} блок ${Math.round(m.blockLeft)}..${Math.round(m.blockRight)} `
                + `значение ${Math.round(m.valueLeft)}..${Math.round(m.valueRight)} окно ${m.vw}`);

            // 1. Не обрезано: строка целиком помещается в свою коробку.
            expect(m.scrollW, `${style}: название обрезано (${m.scrollW} > ${m.clientW})`)
                .toBeLessThanOrEqual(m.clientW + 1);
            // 2. Не вылезает за свой блок.
            expect(m.valueRight, `${style}: название вылезло за правый край блока`).toBeLessThanOrEqual(m.blockRight + 1);
            expect(m.valueLeft, `${style}: название вылезло за левый край блока`).toBeGreaterThanOrEqual(m.blockLeft - 1);
            // 3. И за край окна — то самое «за краем».
            expect(m.valueRight, `${style}: название ушло за правый край окна`).toBeLessThanOrEqual(m.vw + 1);
        }

        // Проверка проверки: этот текст ОБЯЗАН был не поместиться в одну
        // строку — иначе всё выше зеленело бы и на коротком названии.
        // Число СТРОК меряется прямоугольниками диапазона, а не делением высоты
        // на line-height: вычисленный line-height здесь `normal`, parseFloat от
        // него даёт NaN, и первая версия этой проверки насчитала одну строку
        // там, где их две.
        const lines = await display.evaluate(() => {
            const v = document.getElementById('eventTitleValue');
            const range = document.createRange();
            range.selectNodeContents(v);
            return range.getClientRects().length;
        });
        expect(lines, 'название уместилось в одну строку — тест перестал что-либо проверять').toBeGreaterThanOrEqual(2);

        await control.evaluate(() => {
            const el = document.getElementById('eventTitleInput');
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await setToggle(control, 'showEventTitle', false);
        await control.click('#displayTimerStyle button[data-val="circle"]');
        await display.waitForTimeout(400);
    } finally {
        await app.close();
    }
});
