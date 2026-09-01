const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForDisplay } = require('./window-ready');
const { pickWindowSizes } = require('./window-sizes');
const { resizeDisplay } = require('./display-window');

/**
 * Карточка, прижатая к верху окна, не ложится на подпись «Осталось».
 *
 * Жалоба 18.08.2026: «блок „Текущее время“ в позиции по умолчанию перекрывает
 * подпись „Осталось“». Дефект не про стиль и не про аналоговый циферблат — он
 * про ДВА независимых способа сказать, где стоит элемент: карточки прижаты
 * `position: fixed` к верхнему краю, а подпись с таймером центрируются по окну.
 * На высоком окне они расходятся, на низком сходятся. Замер ДО правки, позиция
 * по умолчанию, «Текущее время» включено:
 *
 *   3440×1440 — зазор 78…108px (перекрытия нет);
 *   1600×900  — «Аналог» +21px;
 *   1280×720  — «Круг» +14, «Аналог» +58, «Цифры» +15;
 *   1100×620  — +28 / +2 / +81 / +29 во ВСЕХ четырёх стилях.
 *
 * Поэтому меряются РАЗНЫЕ размеры окна: на мониторе разработчика дефект не
 * виден вовсе, и тест, снятый только на нём, был бы зелёным по случайности.
 *
 * Тест проверяет САМ СЕБЯ тремя утверждениями до главного: карточка видима,
 * подпись видима и по горизонтали они ПЕРЕСЕКАЮТСЯ. Без них зелёный цвет
 * означал бы и «не перекрывает», и «карточку никто не показал».
 */

const SIZES = [
    { w: 1920, h: 1080 },
    { w: 1600, h: 900 },
    { w: 1280, h: 720 },
    { w: 1100, h: 620 }
];

const STYLES = ['circle', 'flip', 'analog', 'digits'];

async function findDisplay(app) {
    for (const w of app.windows()) {
        if (await w.evaluate(() => !!document.getElementById('progressRing')).catch(() => false)) { return w; }
    }
    return null;
}

const setToggle = (control, id, value) => control.evaluate(([key, on]) => {
    const el = document.getElementById(key);
    if (!el) { return; }
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, value]);

const HERO_GAP = 8;

/**
 * Ставит окну РОВНО запрошенный размер и ждёт, пока окно это подтвердит.
 *
 * Выход из полноэкранного режима на macOS анимирован: `setBounds`, поданный
 * посреди анимации, молча не доезжает, и окно остаётся во весь монитор. Пауза
 * фиксированной длины это не лечит — она лечится ожиданием УСЛОВИЯ, а условие
 * здесь одно: окно САМО сообщает свой размер.
 */
/**
 * Рабочая область экрана, на котором идёт прогон.
 *
 * Размер окна больше экрана поставить нельзя: система обрежет его молча, и
 * спека будет подписывать кадр «1920×1080», меряя на самом деле 1440×877.
 * Именно так регрессия 19.08.2026 доехала до CI: на macOS-раннере экран
 * 1440×900, все четыре «размера» сходились в один, а на мониторе разработчика
 * (3440×1440) все четыре были настоящими.
 */
async function workArea(app) {
    return app.evaluate(({ screen }) => {
        const wa = screen.getPrimaryDisplay().workAreaSize;
        return { width: wa.width, height: wa.height };
    });
}

const measure = () => {
    const block = document.getElementById('currentTimeBlock').getBoundingClientRect();
    const label = document.getElementById('heroLabel').getBoundingClientRect();
    const pillEl = document.querySelector('.status-pill');
    const pillRect = pillEl ? pillEl.getBoundingClientRect() : null;
    const pill = pillRect && pillRect.height > 0 ? pillRect : null;
    const active = ['timerRing', 'timerFlip', 'timerAnalog', 'timerDigits']
        .map((id) => document.getElementById(id))
        .find((el) => el && el.classList.contains('active'));
    const timer = active.getBoundingClientRect();
    const columnTop = Math.min(label.top, timer.top);
    const floor = pill ? pill.top : window.innerHeight;
    return {
        style: active.id,
        // Размер ОКНА, а не запрошенный: величина, ради которой тест и
        // существует, зависит от него целиком. Без этих двух чисел спека
        // подписывала кадр «1920×1080», меряя на самом деле монитор
        // разработчика (3440×1440 — выход из полноэкранного режима на macOS
        // анимирован, и setBounds посреди анимации не доезжает). Регрессия
        // 19.08.2026 была видна на CI и невидима локально ровно поэтому.
        vw: window.innerWidth,
        vh: window.innerHeight,
        band: getComputedStyle(document.body).getPropertyValue('--top-band').trim(),
        // Уступка рамы героя: срабатывает, только когда колонка не помещается
        // между карточкой и плашкой ВООБЩЕ.
        shrink: parseFloat(getComputedStyle(document.body).getPropertyValue('--timer-shrink')) || 0,
        blockH: Math.round(block.height),
        labelH: Math.round(label.height),
        // Пересечение по горизонтали: положительное — колонка и карточка
        // стоят в одном столбце, то есть вертикальная проверка не холостая.
        overlapX: Math.round(Math.min(block.right, label.right) - Math.max(block.left, label.left)),
        // Главное число: положительное — карточка легла на подпись.
        overlapY: Math.round(block.bottom - label.top),
        // Полоса не должна чинить верх ценой низа.
        pillGap: pill ? Math.round(floor - timer.bottom) : null,
        outBottom: Math.round(timer.bottom - window.innerHeight),
        // Помещается ли колонка между карточкой и плашкой ВООБЩЕ. Число не
        // зависит от того, куда её сдвинули: и высота колонки, и полоса под
        // карточкой от сдвига не меняются.
        columnH: Math.round(timer.bottom - columnTop),
        room: Math.round(floor - (block.bottom + HERO_GAP))
    };
};

test('карточка сверху не ложится на подпись «Осталось» ни в одном стиле', async () => {
    // Спека длинная по существу (замер 01.09.2026: 22.1 с на быстрой машине
    // при потолке Playwright 30 с). На руннере, который медленнее, она
    // упиралась бы в потолок и падала по времени, ничего не проверив.
    test.setTimeout(120000);
    const { app, control } = await launchApp();
    try {
        // Позиции от соседних спек стираем ДО открытия окна, а не после.
        //
        // Профиль прогона общий, и сдвинутая мышью карточка лежит в нём своими
        // координатами. Стереть их в уже ОТКРЫТОМ окне мало: оно восстановило
        // их при загрузке, элемент помечен `custom-position` и остаётся стоять
        // где стоял — а спека проверяет место ПО УМОЛЧАНИЮ. Ловится это не
        // главной проверкой, а проверкой проверки: «карточка и подпись не в
        // одном столбце — проверка холостая».
        await control.evaluate(() => {
            localStorage.removeItem('displayBlockPositions');
            localStorage.removeItem('displayBlockScales');
        });
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await waitForDisplay(app);
        await control.waitForTimeout(2000);
        const display = await findDisplay(app);
        expect(display, 'полноэкранное окно должно открыться').not.toBeNull();
        // И масштаб таймера — тоже к умолчанию. Профиль общий на весь прогон, а
        // соседняя спека (display-timer-scale) оставляет его увеличенным: при
        // 150 % колонка героя выше, и «карточка легла на подпись» означает не
        // дефект полосы, а чужой масштаб. Проверка здесь — про КОМПОЗИЦИЮ ПО
        // УМОЛЧАНИЮ, и начинать её надо от умолчания.
        await control.evaluate(() => {
            const el = document.getElementById('displayTimerScale');
            if (!el) { return; }
            el.value = '100';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await setToggle(control, 'showCurrentTime', true);
        await setToggle(control, 'showHeroLabel', true);
        await display.waitForTimeout(900);

        // Экран может не вместить крупные размеры. Тогда они не подменяются
        // молча тем, что влезло: список либо сокращается до помещающихся, либо
        // ВЫВОДИТСЯ из рабочей области (см. pickWindowSizes) — на раннерах CI
        // экран 1024×720…1280×1024, и фиксированный список не проверял бы там
        // ничего. Что именно проверяется, печатается перед прогоном.
        const area = await workArea(app);
        const sizes = pickWindowSizes(area, SIZES);
        console.log(`рабочая область ${area.width}×${area.height}: проверяем ${JSON.stringify(sizes)}`);
        expect(sizes.length, 'экран прогона мал даже для выведенных размеров — проверка не выполнена')
            .toBeGreaterThan(0);

        for (const size of sizes) {
            await resizeDisplay(app, display, size, { strict: true });

            for (const style of STYLES) {
                await control.evaluate((st) => {
                    window.ipcRenderer.send('display-settings-update', { timerStyle: st });
                }, style);
                await display.waitForTimeout(700);

                const m = await display.evaluate(measure);
                const where = `${size.w}×${size.h}, ${m.style}`;
                console.log(`${where} →`, JSON.stringify(m));

                // --- проверка проверки ---
                expect(
                    `${m.vw}×${m.vh}`,
                    `${where}: окно другого размера — замер относится не к тому кадру`
                ).toBe(`${size.w}×${size.h}`);
                expect(m.blockH, `${where}: карточку никто не показал`).toBeGreaterThan(0);
                expect(m.labelH, `${where}: подписи «Осталось» нет`).toBeGreaterThan(0);
                expect(m.overlapX, `${where}: карточка и подпись не в одном столбце — проверка холостая`)
                    .toBeGreaterThan(0);

                // --- сам инвариант, без оговорок ---
                expect(m.overlapY, `${where}: карточка легла на подпись`).toBeLessThanOrEqual(0);
                if (m.pillGap !== null) {
                    expect(m.pillGap, `${where}: таймер уехал вниз на плашку состояния`).toBeGreaterThanOrEqual(0);
                }
                expect(m.outBottom, `${where}: таймер вышел за нижний край окна`).toBeLessThanOrEqual(0);

                // Уступка рамы — только по нужде. Без этой проверки инвариант
                // выше можно было бы «выполнить», ужав героя всегда и на
                // сколько угодно.
                if (m.shrink > 0) {
                    console.log(`${where}: рама уступила ${m.shrink}px (колонка ${m.columnH} в полосе ${m.room})`);
                    // Допуск 12px, и он не косметический. Слагаемые меряются в
                    // РАЗНЫЕ моменты: уступка считается по натуральной колонке
                    // ДО сдвига полосы, а `columnH` и `room` снимаются после —
                    // когда карточка уже переставлена, а высоты округлены до
                    // целых. На просторном окне разница нулевая, на тесном
                    // (944×657 у macOS-раннера) выходила в 10px, и проверка
                    // «уступила по нужде» падала там, где главный инвариант —
                    // перекрытия нет — держался.
                    expect(m.columnH + m.shrink + 12, `${where}: рама уступила, хотя колонка помещалась с запасом`)
                        .toBeGreaterThan(m.room);
                }
            }
        }

        // --- проверка проверки: на просторном окне не сработало НИЧЕГО ---
        // Без этой пары чисел зелёный цвет означал бы и «уступка по нужде», и
        // «уступка всегда»: перекрытия нет в обоих случаях.
        // Просторным считается окно от 1600×900: на меньшем карточка и колонка
        // сходятся по делу, и «ничего не сработало» там означало бы не запас, а
        // сломанный механизм. Экран, который такого окна не вмещает (например
        // macOS-раннер 1440×900), эту пару чисел не проверяет — и говорит об
        // этом вслух, а не молчит.
        const roomySize = sizes.find((s) => s.w >= 1600 && s.h >= 900);
        if (!roomySize) {
            console.log(`ПРОПУЩЕНО: экран ${area.width}×${area.height} не вмещает просторное окно (от 1600×900) — `
                + 'проверка «уступка только по нужде» здесь не выполняется');
        } else {
            await resizeDisplay(app, display, roomySize);
            const roomy = await display.evaluate(measure);
            console.log('просторное окно →', JSON.stringify(roomy));
            expect(`${roomy.vw}×${roomy.vh}`, 'окно другого размера — проверка не о том')
                .toBe(`${roomySize.w}×${roomySize.h}`);
            expect(roomy.shrink, `на ${roomySize.w}×${roomySize.h} рама уступать не должна`).toBe(0);
            expect(roomy.band, `на ${roomySize.w}×${roomySize.h} сдвигать колонку не за чем`).toBe('0px');
        }

        // --- и идемпотентность: повторный пересчёт не сдвигает ничего ---
        // Обе величины считаются по ЗАМЕРУ живого окна, и обе меняют то, что
        // меряют. Стабильность при повторе — это и есть доказательство, что
        // замер приведён к общей точке отсчёта, а не подан себе на вход.
        await resizeDisplay(app, display, sizes[sizes.length - 1]);
        await control.evaluate(() => {
            window.ipcRenderer.send('display-settings-update', { timerStyle: 'analog' });
        });
        await display.waitForTimeout(900);
        const first = await display.evaluate(measure);
        for (let i = 0; i < 3; i++) {
            await control.evaluate(() => {
                window.ipcRenderer.send('display-settings-update', { timerStyle: 'analog' });
            });
            await display.waitForTimeout(500);
        }
        const again = await display.evaluate(measure);
        console.log(`идемпотентность: ${first.shrink}/${first.band} → ${again.shrink}/${again.band}`);
        expect(again.shrink, 'уступка рамы поехала при повторном пересчёте').toBe(first.shrink);
        expect(again.band, 'полоса поехала при повторном пересчёте').toBe(first.band);
        expect(again.overlapY, 'перекрытие вернулось при повторном пересчёте').toBeLessThanOrEqual(0);
    } finally {
        // Спека возвращает глобальное состояние: профиль прогона общий.
        await setToggle(control, 'showCurrentTime', false).catch(() => {});
        await control.evaluate(() => {
            window.ipcRenderer.send('display-settings-update', { timerStyle: 'circle' });
        }).catch(() => {});
        await app.close();
    }
});
