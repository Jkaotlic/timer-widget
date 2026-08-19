const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

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
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
        await control.waitForTimeout(2000);
        const display = await findDisplay(app);
        expect(display, 'полноэкранное окно должно открыться').not.toBeNull();

        // Профиль прогона общий, поэтому позиции от соседних спек стираем:
        // сдвинутая мышью карточка стоит по своим координатам, и место по
        // умолчанию — именно то, что здесь проверяется.
        await display.evaluate(() => {
            localStorage.removeItem('displayBlockPositions');
            localStorage.removeItem('displayBlockScales');
        });
        await setToggle(control, 'showCurrentTime', true);
        await setToggle(control, 'showHeroLabel', true);
        await display.waitForTimeout(600);

        for (const size of SIZES) {
            await app.evaluate(async ({ BrowserWindow }, s) => {
                const win = BrowserWindow.getAllWindows()
                    .find((w) => w.webContents.getURL().includes('display.html'));
                win.setFullScreen(false);
                await new Promise((r) => setTimeout(r, 600));
                win.setBounds({ x: 40, y: 40, width: s.w, height: s.h });
            }, size);
            await display.waitForTimeout(900);

            for (const style of STYLES) {
                await control.evaluate((st) => {
                    window.ipcRenderer.send('display-settings-update', { timerStyle: st });
                }, style);
                await display.waitForTimeout(700);

                const m = await display.evaluate(measure);
                const where = `${size.w}×${size.h}, ${m.style}`;
                console.log(`${where} →`, JSON.stringify(m));

                // --- проверка проверки ---
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
                    expect(m.columnH + m.shrink, `${where}: рама уступила, хотя колонка помещалась`)
                        .toBeGreaterThan(m.room);
                }
            }
        }

        // --- проверка проверки: на просторном окне не сработало НИЧЕГО ---
        // Без этой пары чисел зелёный цвет означал бы и «уступка по нужде», и
        // «уступка всегда»: перекрытия нет в обоих случаях.
        await app.evaluate(async ({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()
                .find((w) => w.webContents.getURL().includes('display.html'));
            win.setBounds({ x: 40, y: 40, width: 1920, height: 1080 });
        });
        await display.waitForTimeout(900);
        const roomy = await display.evaluate(measure);
        expect(roomy.shrink, 'на 1920×1080 рама уступать не должна').toBe(0);
        expect(roomy.band, 'на 1920×1080 сдвигать колонку не за чем').toBe('0px');

        // --- и идемпотентность: повторный пересчёт не сдвигает ничего ---
        // Обе величины считаются по ЗАМЕРУ живого окна, и обе меняют то, что
        // меряют. Стабильность при повторе — это и есть доказательство, что
        // замер приведён к общей точке отсчёта, а не подан себе на вход.
        await app.evaluate(async ({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()
                .find((w) => w.webContents.getURL().includes('display.html'));
            win.setBounds({ x: 40, y: 40, width: 1280, height: 720 });
        });
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
