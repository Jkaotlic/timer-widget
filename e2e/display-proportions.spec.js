'use strict';

/**
 * Карточка дисплея занимает ОДНУ И ТУ ЖЕ долю экрана на экранах разной
 * пропорции.
 *
 * Жалоба 28.08.2026: «раскладка ведёт себя по-разному на разных дисплеях».
 * Причина была не в раскладке. У дисплея жили ДВЕ системы размеров:
 *
 *   место элемента — доля окна (переносится между экранами точь-в-точь);
 *   размер элемента — CSS-пиксели с ПОТОЛКОМ (`clamp(13px, 1.4vmin, 18px)`).
 *
 * Замер на мониторах жалобщика (3440×1440 и 1366×1024) при одной раскладке:
 * одна и та же карточка занимала 8,3 % ширины на широком и 20,9 % на узком —
 * в два с половиной раза шире. А раз она шире, её край упирается в поле у
 * границы, и поджатие толкает карточку внутрь: центры разъезжались на 25 %
 * против 17 %. Кривые координаты были СЛЕДСТВИЕМ габарита.
 *
 * Мера здесь — «полоса содержимого» `min(vw, vh × 16/9)`, ТА ЖЕ величина, от
 * которой раскладка считает координату X (CONTENT_ASPECT в display-layouts.js).
 * Совпадать обязана доля именно от неё: доля от ширины окна и доля от его
 * высоты на 21:9 и 4:3 одновременно совпасть не могут, и требовать этого
 * значило бы написать заведомо невыполнимую проверку.
 *
 * Таймер сюда НЕ входит намеренно: он квадратный и обязан влезать по
 * вертикали, поэтому привязан к высоте окна, а не к полосе. Это записано в
 * display.css рядом с `--timer-box`.
 */

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');
const { waitForDisplay } = require('./window-ready');
const { resizeDisplay } = require('./display-window');

async function workArea(app) {
    return app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);
}

/**
 * Пара окон, у которых ПОЛОСА СОДЕРЖИМОГО различается по-настоящему.
 *
 * Первая версия брала 1280×720 и 1200×900 и была зелёной ДО правки: полосы
 * 1280 и 1200 отличаются на 6 %, а кегль на обоих упирался в нижний порог
 * `clamp(13px, …)`. Совпадение долей там не значило ничего — это ровно тот
 * случай, когда «проверка не выполнена» выглядит как «проверка прошла».
 *
 * Поэтому: широкое окно — во всю рабочую область (полоса максимальна), узкое —
 * 4:3 у самого пола, при котором таймер ещё помещается. Если машина не даёт
 * даже полуторного разброса полос, спека НЕ делает вид, что проверила: она
 * говорит об этом вслух и снимается. Дефект физически невоспроизводим на
 * экране, где оба конца лежат на пороге кегля.
 */
const MIN_BAND_RATIO = 1.6;

function pickPair(area) {
    const wide = { w: Math.floor(area.width - 60), h: Math.floor(area.height - 60) };
    // Узкий случай — размер настоящего ВТОРОГО МОНИТОРА (4:3), а не крошечное
    // окно. В окне 840px нижние пороги кегля включаются намеренно — 6,6px
    // подпись нечитаема, — и мерить там пропорцию значило бы требовать, чтобы
    // порога читаемости не было вовсе. Жалоба же про мониторы.
    const narrow = { w: 1366, h: 1024 };
    if (narrow.w > area.width - 60 || narrow.h > area.height - 60) {
        return [wide, { w: Math.floor(area.width - 60), h: Math.floor((area.width - 60) * 3 / 4) }];
    }
    return [wide, narrow];
}

/** Доля полосы содержимого, которую занимает карточка по ширине. */
const measure = () => {
    const band = Math.min(window.innerWidth, window.innerHeight * 16 / 9);
    const out = { vw: window.innerWidth, vh: window.innerHeight, band: Math.round(band), blocks: {} };
    for (const id of ['currentTimeBlock', 'eventTimeBlock', 'endTimeBlock']) {
        const el = document.getElementById(id);
        if (!el || !el.classList.contains('visible')) { continue; }
        const r = el.getBoundingClientRect();
        out.blocks[id] = { pct: +(r.width / band * 100).toFixed(2), w: Math.round(r.width) };
    }
    return out;
};

test('карточка занимает одну долю полосы содержимого на 16:9 и на 4:3', async () => {
    test.setTimeout(200000);
    const { app, control } = await launchApp();
    try {
        await control.evaluate(() => {
            window.ipcRenderer.send('display-settings-update', {
                showCurrentTime: true, showEventTime: true, showEndTime: true, timerStyle: 'circle'
            });
            window.ipcRenderer.send('open-display', { displayIndex: 0 });
        });
        const display = await waitForDisplay(app);
        await control.waitForTimeout(2600);
        await display.waitForSelector('#currentTimeBlock');
        await display.waitForTimeout(800);

        const area = await workArea(app);
        const [wide, narrow] = pickPair(area);
        console.log(`рабочая область ${area.width}×${area.height}: просим ${wide.w}×${wide.h} и ${narrow.w}×${narrow.h}`);

        const seen = [];
        for (const size of [wide, narrow]) {
            await resizeDisplay(app, display, size);
            await display.waitForTimeout(900);
            // Размер берётся из ОКНА, вместе с замером: тогда доли заведомо
            // относятся к тому кадру, в котором посчитаны.
            const m = await display.evaluate(measure);
            console.log(`  ${m.vw}×${m.vh} (полоса ${m.band}) →`, JSON.stringify(m.blocks));
            expect(Object.keys(m.blocks).length, 'карточек на экране нет — проверка холостая')
                .toBeGreaterThanOrEqual(3);
            seen.push(m);
        }

        // Условия считаются по ВЫДАННОМУ размеру. Разброс полос меньше
        // полуторного означает, что оба конца лежат на пороге читаемости
        // кегля: совпадение долей там ничего не доказывает, и спека НЕ делает
        // вид, что проверила, — говорит вслух и снимается. Механизм закрыт
        // unit-проверкой tests/display-proportions.test.js, она идёт везде.
        const ratio = Math.max(seen[0].band, seen[1].band) / Math.min(seen[0].band, seen[1].band);
        console.log(`  разброс полос ×${ratio.toFixed(2)} (нужен ×${MIN_BAND_RATIO})`);
        test.skip(ratio < MIN_BAND_RATIO,
            `экран прогона дал разброс полос всего ×${ratio.toFixed(2)}: оба конца на пороге кегля`);

        // Само-проверка: пропорции обязаны РАЗЛИЧАТЬСЯ, иначе совпадение долей
        // не значит ничего.
        const aspect = (m) => m.vw / m.vh;
        expect(Math.abs(aspect(seen[0]) - aspect(seen[1])),
            'оба окна одной пропорции — спека ничего не проверила').toBeGreaterThan(0.15);

        for (const id of Object.keys(seen[0].blocks)) {
            const a = seen[0].blocks[id].pct;
            const b = seen[1].blocks[id].pct;
            const drift = Math.abs(a - b);
            console.log(`  ${id}: ${a}% против ${b}% полосы — расхождение ${drift.toFixed(2)} п.п.`);
            expect(drift,
                `${id}: карточка занимает ${a}% полосы на одном экране и ${b}% на другом`)
                .toBeLessThanOrEqual(1.5);
        }
    } finally {
        await control.evaluate(() => window.ipcRenderer.send('close-display')).catch(() => {});
        await app.close();
    }
});
