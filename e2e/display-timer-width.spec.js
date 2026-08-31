'use strict';

/**
 * Размер таймера дисплея слушается ЧИСЛА, а не порядка посылок.
 *
 * Жалоба 31.08.2026: «не могу нормально менять ширину таймера полноэкранного
 * режима». Замер на окне 3380×1313, стиль «Цифры», шрифт Bebas, посылки
 * масштаба одна за другой (100 → 150 → 100 → 150 → 150 → 100):
 *
 *   просили 100 % → кегль 358px, чернила  883×487
 *   просили 150 % → кегль 358px, чернила 1325×730
 *   просили 100 % → кегль 537px, чернила 1325×730   ← 100 % выглядит как 150 %
 *   просили 150 % → кегль 358px, чернила 1325×730   ← 150 % выглядит как 100 %
 *   просили 150 % → кегль 537px, чернила 1988×1095  ← то же число, размер +50 %
 *
 * Причина: `updateDigitsScale()` брал доступное место из
 * `timerDigits.getBoundingClientRect()`, а `applyTimerScale()` строкой выше
 * ставит на ЭТОТ ЖЕ элемент `transform: scale()`. Прямоугольник трансформацию
 * ВИДИТ — подгонка подавала собственный выход себе на вход, и видимый размер
 * зависел от порядка двух последних посылок. Ровно тот же грех уже чинили в
 * `display.css` (явная высота вместо `height: auto`), но закрыли только
 * раскладочную половину: замер брался у трансформированной рамы.
 *
 * Второе утверждение — про ПОТОЛОК. Он считается по свободной полосе, а полосу
 * блок занимал КВАДРАТНОЙ рамой `--timer-box` (55vh): чернил в ней 487px из
 * 722px, и в потолок упирался пустой воздух вокруг цифр. Отсюда «Таймер уже во
 * всю высоту» при цифрах в треть экрана.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { resizeDisplay } = require('./display-window');

const IS_DISPLAY = () => !!document.getElementById('timerDigits') && !!document.getElementById('progressRing');

async function findDisplay(app) {
    for (const w of app.windows()) {
        if (await w.evaluate(IS_DISPLAY).catch(() => false)) { return w; }
    }
    return null;
}

/**
 * Чернила стиля «Цифры» — то, что видно, а не рама вокруг.
 *
 * `getBoundingClientRect()` здесь УМЕСТЕН: спека мерит нарисованный кадр,
 * то есть как раз результат вместе с трансформацией. Запрещён он в
 * подгонке — там это замер собственного выхода.
 */
const measureInk = () => {
    const d = document.getElementById('digitsTime');
    const r = d.getBoundingClientRect();
    return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        font: Math.round(parseFloat(getComputedStyle(d).fontSize)),
        w: Math.round(r.width),
        h: Math.round(r.height)
    };
};

/** Поставить масштаб таймера дисплея ползунком панели — тем же путём, что пользователь. */
async function setScale(control, pct) {
    await control.evaluate((p) => {
        const el = document.getElementById('displayTimerScale');
        el.value = String(p);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, pct);
}

async function openDisplayWithDigits(app, control) {
    await control.evaluate(() => window.ipcRenderer.send('open-display', { displayIndex: 0 }));
    await control.waitForTimeout(1500);
    await control.click('.tab-btn[data-tab="display"]');
    await control.click('#displayTimerStyle button[data-val="digits"]');
    await control.waitForTimeout(900);

    const display = await findDisplay(app);
    expect(display, 'полноэкранное окно должно быть найдено').not.toBeNull();
    await display.waitForSelector('#timerDigits.active');

    // Размер окна берётся из рабочей области, а условия считаются по
    // ВЫДАННОМУ размеру: система обрезает молча.
    const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);
    await resizeDisplay(app, display, { w: Math.floor(area.width - 60), h: Math.floor(area.height - 60) });
    await display.waitForTimeout(1000);
    return display;
}

/** Профиль e2e общий: спека возвращает глобальное состояние. */
async function restore(control) {
    await control.evaluate(() => {
        const el = document.getElementById('displayTimerScale');
        el.value = '100';
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }).catch(() => {});
    await control.click('#displayTimerStyle button[data-val="circle"]').catch(() => {});
    await control.evaluate(() => window.ipcRenderer.send('close-display')).catch(() => {});
}

test('размер цифр — функция запрошенного процента, а не порядка посылок', async () => {
    test.setTimeout(240000);
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithDigits(app, control);

        const seen = [];
        for (const pct of [100, 150, 100, 150, 150, 100]) {
            await setScale(control, pct);
            await display.waitForTimeout(1100);
            const m = await display.evaluate(measureInk);
            console.log(`  просили ${pct}% → кегль ${m.font}px, чернила ${m.w}×${m.h} (окно ${m.vw}×${m.vh})`);
            seen.push({ pct, ...m });
        }

        const widths = (pct) => seen.filter((s) => s.pct === pct).map((s) => s.w);
        const base = widths(100)[0];
        const grown = widths(150)[0];

        // ГЛАВНОЕ утверждение, и оно проверяется на ЛЮБОМ экране: одно и то же
        // число даёт один и тот же размер, в какой бы последовательности его ни
        // прислали. Именно это и было сломано — размер зависел от порядка.
        // Обрезанный потолок проверку не ослабляет: до починки кегль умножался
        // на ПРИМЕНЁННЫЙ масштаб, поэтому расхождение внутри группы вылезало и
        // при потолке 104 % (замер на руннере: 911 против 947px — 36px при
        // допуске 2px).
        for (const pct of [100, 150]) {
            const w = widths(pct);
            expect(Math.max(...w) - Math.min(...w),
                `${pct} %: одно и то же число дало разную ширину — ${w.join(' → ')}px`)
                .toBeLessThanOrEqual(2);
        }

        // А вот «в полтора раза» — утверждение про экран, а не про код. На окне
        // руннера (1220×964 под xvfb, 964×677 на macOS) цифры уже занимают всю
        // доступную полосу, потолок выходит ~104 %, и 150 % честно обрезаются.
        // Спека НЕ делает вид, что проверила: говорит вслух и снимается.
        // Механизм закрыт unit-проверками, они идут везде.
        const room = grown / base;
        console.log(`  потолок этого экрана: 150 % дали ×${room.toFixed(2)}`);
        test.skip(room < 1.2,
            `экран прогона обрезал 150 % до ×${room.toFixed(2)} — расти цифрам некуда,`
            + ' доказывать кратность здесь нечем');

        // Число значит ровно то, что написано: 150 % шире 100 % в полтора раза.
        expect(room, `150 % дали ${grown}px при 100 % = ${base}px`).toBeCloseTo(1.5, 1);
    } finally {
        await restore(control);
        await app.close();
    }
});

test('потолок масштаба упирается в ЧЕРНИЛА, а не в пустую раму блока', async () => {
    test.setTimeout(240000);
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithDigits(app, control);

        await setScale(control, 100);
        await display.waitForTimeout(1100);
        const base = await display.evaluate(measureInk);
        console.log(`  100 % → чернила ${base.w}×${base.h} в окне ${base.vw}×${base.vh}`
            + ` (${(base.h / base.vh * 100).toFixed(1)} % высоты)`);

        // Экран прогона обязан ДАВАТЬ место для роста: если цифры и так занимают
        // две трети высоты, доказывать нечего, и спека не делает вид, что
        // проверила. Механизм закрыт unit-проверкой, она идёт везде.
        test.skip(base.h / base.vh >= 0.65,
            `цифры на этом экране уже занимают ${(base.h / base.vh * 100).toFixed(0)} % высоты — расти некуда`);

        await setScale(control, 300);
        await display.waitForTimeout(1200);
        const max = await display.evaluate(measureInk);
        console.log(`  300 % → чернила ${max.w}×${max.h} (${(max.h / max.vh * 100).toFixed(1)} % высоты)`);

        // Утверждение — про ОКНО, а не про конкретную ось: какая сторона упрётся
        // первой, зависит от пропорции экрана, и требовать высоты на
        // сверхшироком мониторе значило бы писать проверку под одну машину.
        //
        // Порог 0.7, а не 1.0: место под знак минуса резервируется С ДВУХ
        // сторон (он висит слева, а блок растёт от центра), поэтому сами цифры
        // до края окна не доходят никогда — на замере 31.08.2026 предел по
        // ширине 911/1211 = 0.75. До починки было 0.39 по обеим осям.
        const filled = Math.max(max.w / max.vw, max.h / max.vh);
        expect(filled,
            `на максимуме цифры заняли лишь ${(filled * 100).toFixed(0)} % окна:`
            + ' потолок считается по пустой раме, а не по цифрам')
            .toBeGreaterThanOrEqual(0.7);

        // И при этом НЕ вылезают за окно: потолок обязан оставаться потолком.
        expect(max.h, `цифры ${max.h}px выше окна ${max.vh}px`).toBeLessThanOrEqual(max.vh);
        expect(max.w, `цифры ${max.w}px шире окна ${max.vw}px`).toBeLessThanOrEqual(max.vw);
    } finally {
        await restore(control);
        await app.close();
    }
});

test('прозрачная рама «Цифр» не перехватывает нажатие на плашку состояния', async () => {
    // Плата за потолок по чернилам: рама блока (квадрат --timer-box) на большом
    // масштабе вылезает далеко за сами цифры и накрывает низ окна. Видно её не
    // будет — она пустая, — но события мыши элемент ловит по-настоящему, а на
    // колонке героя висит начало Alt-перетаскивания таймера.
    //
    // Замер 31.08.2026 говорит, что попасть по плашке всё-таки можно: она стоит
    // `position: fixed` и в порядке отрисовки идёт ПОЗЖЕ рамы, поэтому в
    // hit-тесте выигрывает. Проверка остаётся сторожем этого порядка: он
    // держится на разметке и стилях, которые никто не помечал как несущие.
    test.setTimeout(240000);
    const { app, control } = await launchApp();
    try {
        const display = await openDisplayWithDigits(app, control);
        await control.evaluate(() => {
            const el = document.getElementById('showStatusPill');
            if (el && !el.checked) { el.click(); }
        });
        await setScale(control, 300);
        await display.waitForTimeout(1200);

        const hit = await display.evaluate(() => {
            const pill = document.querySelector('.status-pill');
            const digits = document.getElementById('digitsTime');
            const at = (r) => {
                const el = document.elementFromPoint(
                    Math.round(r.left + r.width / 2),
                    Math.round(r.top + r.height / 2)
                );
                if (!el) { return null; }
                const owner = el.closest('#timerDigits, .status-pill') || el;
                return owner.id || owner.tagName;
            };
            const pillRect = pill.getBoundingClientRect();
            return {
                overPill: at(pillRect),
                overDigits: at(digits.getBoundingClientRect()),
                pillVisible: pillRect.height > 0
            };
        });
        console.log(`  под курсором над плашкой: ${hit.overPill}; над цифрами: ${hit.overDigits}`);

        expect(hit.pillVisible, 'плашка состояния выключена — проверка холостая').toBe(true);
        // Само-проверка зонда: над самими цифрами он обязан находить таймер.
        expect(hit.overDigits, 'зонд не видит таймер даже над цифрами — проверка холостая')
            .toBe('timerDigits');
        expect(hit.overPill, 'над плашкой состояния лежит пустая рама таймера')
            .toBe('statusPill');
    } finally {
        await restore(control);
        await app.close();
    }
});
