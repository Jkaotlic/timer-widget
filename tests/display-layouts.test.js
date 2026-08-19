'use strict';

/**
 * Раскладки полноэкранного окна и масштаб КАЖДОГО элемента.
 *
 * Что здесь проверяется и почему именно здесь:
 *
 *  - реестр подвижных элементов совпадает с таблицей настроек В ОБА КОНЦА:
 *    элемент, забытый в одном из списков, получает тумблер без раскладки или
 *    раскладку без тумблера — и то и другое видно только руками;
 *  - арифметика долей экрана: раскладка обязана давать один и тот же кадр на
 *    1280×720 и на 3840×2160, а поджатие к краям — не выпускать элемент за
 *    экран на маленьком окне;
 *  - НЕПЕРЕСЕЧЕНИЕ: обещание «чтобы всё вмещалось» — это утверждение о
 *    прямоугольниках, и здесь оно считается на НОМИНАЛЬНЫХ габаритах. Правду
 *    про живое окно меряет e2e/display-layouts.spec.js: настоящие размеры
 *    зависят от шрифта и стиля таймера, и подменять их выдумкой нельзя.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const DL = require('../display-layouts');
const Schema = require('../settings-schema');

test('реестр элементов совпадает с тумблерами таблицы настроек в оба конца', () => {
    const fromSchema = Schema.DISPLAY_BLOCK_KEYS.concat(Schema.DISPLAY_LABEL_KEYS).sort();
    const fromRegistry = DL.DISPLAY_ELEMENTS.map((el) => el.toggle).sort();
    assert.deepEqual(fromRegistry, fromSchema);
});

test('идентификаторы элементов и раскладок уникальны', () => {
    assert.equal(new Set(DL.ELEMENT_IDS).size, DL.ELEMENT_IDS.length);
    assert.equal(new Set(DL.LAYOUT_IDS).size, DL.LAYOUT_IDS.length);
    assert.ok(DL.LAYOUTS.length >= 4, 'раскладок должно быть несколько, иначе это не выбор');
});

test('каждая раскладка описана целиком и ссылается только на известные элементы', () => {
    for (const layout of DL.LAYOUTS) {
        assert.ok(layout.name && layout.name.length > 0, `${layout.id}: нет имени`);
        assert.ok(layout.hint && layout.hint.length > 0, `${layout.id}: нет подписи`);
        assert.ok(Number.isFinite(layout.timerScale), `${layout.id}: нет масштаба таймера`);
        assert.ok(layout.timerScale >= 30 && layout.timerScale <= 300, `${layout.id}: масштаб таймера вне границ`);
        for (const [id, entry] of Object.entries(layout.elements)) {
            assert.ok(DL.ELEMENT_IDS.includes(id), `${layout.id}: неизвестный элемент ${id}`);
            assert.ok(DL.clampScale(entry.scale) !== null, `${layout.id}/${id}: масштаб не число`);
            if (entry.flow) { continue; }
            assert.ok(entry.cx > 0 && entry.cx < 1, `${layout.id}/${id}: cx вне экрана`);
            assert.ok(entry.cy > 0 && entry.cy < 1, `${layout.id}/${id}: cy вне экрана`);
        }
    }
});

test('layoutToggles включает перечисленное и гасит остальное', () => {
    const minimal = DL.layoutById('minimal');
    const toggles = DL.layoutToggles(minimal);
    assert.equal(Object.keys(toggles).length, DL.DISPLAY_ELEMENTS.length);
    assert.ok(Object.values(toggles).every((v) => v === false), 'у «Минимума» не должно быть включённых элементов');

    const classic = DL.layoutToggles(DL.layoutById('classic'));
    assert.equal(classic.showCurrentTime, true);
    assert.equal(classic.showHeroLabel, true);
    assert.equal(classic.showTimeLeft, false);
    assert.equal(classic.showEventTitle, false);
});

test('layoutScales задаёт масштаб и выключенным элементам', () => {
    const scales = DL.layoutScales(DL.layoutById('stage'));
    assert.equal(Object.keys(scales).length, DL.DISPLAY_ELEMENTS.length);
    assert.equal(scales.heroLabel, 110);
    // Выключенный блок получает умолчание, а не значение прошлой раскладки.
    assert.equal(scales.currentTime, DL.DEFAULT_BLOCK_SCALE);
});

test('normalizeScales: умолчания по виду элемента', () => {
    const s = DL.normalizeScales(null, null);
    assert.equal(s.currentTime, DL.DEFAULT_BLOCK_SCALE);
    assert.equal(s.heroLabel, DL.DEFAULT_LABEL_SCALE);
    assert.equal(s.statusPill, DL.DEFAULT_LABEL_SCALE);
    assert.equal(Object.keys(s).length, DL.DISPLAY_ELEMENTS.length);
});

test('normalizeScales: старый общий масштаб достаётся только карточкам', () => {
    const s = DL.normalizeScales(null, 200);
    assert.equal(s.currentTime, 200);
    assert.equal(s.eventTime, 200);
    assert.equal(s.timeLeft, 200);
    // Подпись и плашка старым ключом никогда не управлялись — их он не трогает.
    assert.equal(s.heroLabel, DL.DEFAULT_LABEL_SCALE);
    assert.equal(s.statusPill, DL.DEFAULT_LABEL_SCALE);
});

test('normalizeScales: своё значение сильнее старого общего, мусор не проходит', () => {
    const s = DL.normalizeScales({ currentTime: 300, eventTime: 'abc', endTime: 9000, timeLeft: -5 }, 200);
    assert.equal(s.currentTime, 300);
    assert.equal(s.eventTime, 200, 'нечисловое значение откатывается к старому общему');
    assert.equal(s.endTime, DL.MAX_ELEMENT_SCALE);
    assert.equal(s.timeLeft, DL.MIN_ELEMENT_SCALE);
});

test('normalizeScales переживает не-объект в хранилище', () => {
    for (const junk of [undefined, 'строка', 42, []]) {
        const s = DL.normalizeScales(junk, null);
        assert.equal(s.currentTime, DL.DEFAULT_BLOCK_SCALE);
    }
});

test('placeElements: доля экрана — это ЦЕНТР элемента', () => {
    const layout = { elements: { currentTime: { cx: 0.5, cy: 0.5, scale: 100 } } };
    const pos = DL.placeElements(layout, { width: 1000, height: 800 }, { currentTime: { width: 200, height: 100 } });
    assert.deepEqual(pos.currentTime, { left: 400, top: 350, scale: 100 });
});

test('placeElements: масштаб раскладки участвует в габарите', () => {
    const layout = { elements: { currentTime: { cx: 0.5, cy: 0.5, scale: 200 } } };
    const pos = DL.placeElements(layout, { width: 1000, height: 800 }, { currentTime: { width: 200, height: 100 } });
    // 200 % от 200×100 — это 400×200, центр окна остаётся центром элемента.
    assert.deepEqual(pos.currentTime, { left: 300, top: 300, scale: 200 });
});

test('placeElements: одна и та же доля даёт один и тот же ЦЕНТР на любом экране', () => {
    // Габарит намеренно небольшой: у края поле в 20px перебивает долю (и обязано
    // это делать — см. следующий тест), а проверяется здесь именно пересчёт доли.
    const layout = DL.layoutById('classic');
    const sizes = { eventTime: { width: 180, height: 100 } };
    const center = (vw, vh) => {
        const pos = DL.placeElements(layout, { width: vw, height: vh }, sizes);
        return (pos.eventTime.left + 180 * pos.eventTime.scale / 100 / 2) / vw;
    };
    const small = center(1280, 720);
    const big = center(3840, 2160);
    assert.ok(Math.abs(small - 0.14) < 0.001, `1280×720: ${small}`);
    assert.ok(Math.abs(small - big) < 0.001, `${small} ≠ ${big}`);
});

test('на сверхшироком экране доли считаются от полосы 16:9, а не от всей ширины', () => {
    const layout = { elements: { currentTime: { cx: 0.14, cy: 0.1, scale: 100 } } };
    const sizes = { currentTime: { width: 250, height: 140 } };

    // 16:9 — полоса совпадает с окном, правило ничего не меняет.
    const wide = DL.placeElements(layout, { width: 1920, height: 1080 }, sizes);
    assert.equal(wide.currentTime.left + 125, Math.round(0.14 * 1920));

    // 21:9 — блок подтягивается к центру, иначе он висит в пустоте в полутора
    // экранах от таймера (замер на 3440×1440: 482px от края против 798px).
    const ultra = DL.placeElements(layout, { width: 3440, height: 1440 }, sizes);
    const center = ultra.currentTime.left + 125;
    assert.ok(center > 0.14 * 3440 + 200, `подтяжки не случилось: ${center}`);
    assert.ok(center < 3440 / 2, 'подтянуло слишком сильно — блок ушёл за середину');
});

test('placeElements поджимает к краям и не выпускает за экран', () => {
    const layout = {
        elements: {
            currentTime: { cx: 0.99, cy: 0.99, scale: 100 },
            endTime: { cx: 0.01, cy: 0.01, scale: 100 }
        }
    };
    const sizes = { currentTime: { width: 300, height: 140 }, endTime: { width: 300, height: 140 } };
    const pos = DL.placeElements(layout, { width: 800, height: 600 }, sizes);
    assert.equal(pos.currentTime.left, 800 - 300 - DL.EDGE_MARGIN);
    assert.equal(pos.currentTime.top, 600 - 140 - DL.EDGE_MARGIN);
    assert.equal(pos.endTime.left, DL.EDGE_MARGIN);
    assert.equal(pos.endTime.top, DL.EDGE_MARGIN);
});

test('placeElements ужимает элемент, не влезающий в полосу над таймером', () => {
    const layout = { elements: { currentTime: { cx: 0.5, cy: 0.1, scale: 200 } } };
    const timer = { left: 400, right: 1000, top: 240, bottom: 840 };
    const sizes = { currentTime: { width: 300, height: 140 } };
    const pos = DL.placeElements(layout, { width: 1400, height: 1080 }, sizes, { timer });
    // Полоса сверху: 240 − 20 поля − 8 зазора = 212. При 200 % высота 280 — не лезет.
    assert.ok(pos.currentTime.scale < 200, `масштаб не уменьшен: ${pos.currentTime.scale}`);
    const height = 140 * pos.currentTime.scale / 100;
    assert.ok(pos.currentTime.top + height <= timer.top - DL.TIMER_GAP,
        `нижний край ${pos.currentTime.top + height} заходит на таймер ${timer.top}`);
});

test('placeElements не трогает элемент, который таймер не пересекает по ширине', () => {
    const layout = { elements: { currentTime: { cx: 0.08, cy: 0.12, scale: 200 } } };
    const timer = { left: 600, right: 1200, top: 240, bottom: 840 };
    const sizes = { currentTime: { width: 200, height: 140 } };
    const pos = DL.placeElements(layout, { width: 1800, height: 1080 }, sizes, { timer });
    assert.equal(pos.currentTime.scale, 200, 'угловой блок ужимать не за что');
});

test('placeElements пропускает элементы в потоке и элементы без габарита', () => {
    const layout = DL.layoutById('classic');
    const pos = DL.placeElements(layout, { width: 1920, height: 1080 }, { currentTime: { width: 300, height: 140 } });
    assert.ok(pos.currentTime, 'замеренный элемент разложен');
    assert.equal(pos.heroLabel, undefined, 'подпись остаётся в потоке');
    assert.equal(pos.eventTime, undefined, 'незамеренный элемент пропускается, а не кладётся в ноль');
});

test('placeElements переживает нулевое и битое окно', () => {
    const layout = DL.layoutById('classic');
    const sizes = { currentTime: { width: 300, height: 140 } };
    assert.deepEqual(DL.placeElements(layout, { width: 0, height: 0 }, sizes), {});
    assert.deepEqual(DL.placeElements(layout, { width: NaN, height: 100 }, sizes), {});
    assert.deepEqual(DL.placeElements(null, { width: 100, height: 100 }, sizes), {});
});

test('доля и пиксели переводятся друг в друга без потерь', () => {
    const viewport = { width: 1600, height: 900 };
    const size = { width: 300, height: 140 };
    const rect = { left: 400, top: 200, width: 300, height: 140 };
    const f = DL.positionToFraction(rect, viewport);
    assert.ok(Math.abs(f.cx - (550 / 1600)) < 1e-9);
    assert.ok(Math.abs(f.cy - (270 / 900)) < 1e-9);
    assert.deepEqual(DL.fractionToPosition(f, viewport, size), { left: 400, top: 200 });
});

test('доля держит КОМПОЗИЦИЮ при смене размера окна', () => {
    // Ровно та жалоба: блоки разъезжались, потому что стояли в пикселях.
    const from = { width: 1600, height: 900 };
    const to = { width: 900, height: 600 };
    const size = { width: 200, height: 100 };
    const f = DL.positionToFraction({ left: 1200, top: 660, width: 200, height: 100 }, from);
    const after = DL.positionToFraction(
        Object.assign({}, DL.fractionToPosition(f, to, size), size),
        to
    );
    assert.ok(Math.abs(after.cx - f.cx) < 0.005, `${after.cx} ≠ ${f.cx}`);
    assert.ok(Math.abs(after.cy - f.cy) < 0.005, `${after.cy} ≠ ${f.cy}`);

    // Пиксель бы этого не пережил: 1200 в окне 900 — это уже за краем.
    assert.ok(1200 > to.width - size.width, 'проверка потеряла смысл: пиксель влезает и так');
});

test('доля НЕ выпускает элемент за край, даже если окно стало вдвое меньше', () => {
    // У самого края доля обязана уступить полю — композиция сохраняется
    // настолько, насколько позволяет окно, но за экран не выносится.
    const to = { width: 900, height: 600 };
    const size = { width: 200, height: 100 };
    const f = DL.positionToFraction({ left: 1340, top: 760, width: 200, height: 100 }, { width: 1600, height: 900 });
    const pos = DL.fractionToPosition(f, to, size);
    assert.ok(pos.left + size.width <= to.width - DL.EDGE_MARGIN + 1, `правый край: ${pos.left + size.width}`);
    assert.ok(pos.top + size.height <= to.height - DL.EDGE_MARGIN + 1, `нижний край: ${pos.top + size.height}`);
});

test('доля поджимается к краям, если окно стало меньше элемента', () => {
    const pos = DL.fractionToPosition({ cx: 0.95, cy: 0.95 }, { width: 400, height: 300 }, { width: 300, height: 200 });
    assert.equal(pos.left, 400 - 300 - DL.EDGE_MARGIN);
    assert.equal(pos.top, 300 - 200 - DL.EDGE_MARGIN);
});

test('перевод долей переживает мусор', () => {
    assert.equal(DL.positionToFraction(null, { width: 100, height: 100 }), null);
    assert.equal(DL.positionToFraction({ left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 0 }), null);
    assert.equal(DL.fractionToPosition({ cx: NaN, cy: 0.5 }, { width: 100, height: 100 }, { width: 10, height: 10 }), null);
    assert.equal(DL.fractionToPosition({ cx: 0.5, cy: 0.5 }, { width: 100, height: 100 }, null), null);
});

/**
 * Непересечение на номинальных габаритах.
 *
 * Габариты взяты С ЗАПАСОМ (карточка шире и выше настоящей): раскладка,
 * прошедшая с запасом, пройдёт и на настоящих размерах, а обратное неверно.
 * Коробка таймера — `min(60vw, 55vh, 1600px)` из display.css, умноженная на
 * масштаб раскладки: она центрирована в окне и заявлена одна на все стили.
 */
const NOMINAL = { width: 300, height: 146 };
const NOMINAL_TITLE = { width: 440, height: 108 };

function nominalSizes(layout) {
    const sizes = {};
    for (const id of Object.keys(layout.elements)) {
        sizes[id] = id === 'eventTitle' ? NOMINAL_TITLE : NOMINAL;
    }
    return sizes;
}

function rect(pos, natural) {
    const w = natural.width * pos.scale / 100;
    const h = natural.height * pos.scale / 100;
    return { left: pos.left, top: pos.top, right: pos.left + w, bottom: pos.top + h };
}

function overlap(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function timerRect(layout, vw, vh) {
    const box = Math.min(vw * 0.6, vh * 0.55, 1600) * (layout.timerScale / 100);
    return {
        left: vw / 2 - box / 2,
        right: vw / 2 + box / 2,
        top: vh / 2 - box / 2,
        bottom: vh / 2 + box / 2
    };
}

for (const [vw, vh] of [[1280, 720], [1920, 1080], [3840, 2160], [1440, 900], [3440, 1440], [1920, 1200]]) {
    test(`раскладки не накладываются друг на друга и на таймер (${vw}×${vh})`, () => {
        for (const layout of DL.LAYOUTS) {
            const sizes = nominalSizes(layout);
            const timer = timerRect(layout, vw, vh);
            const pos = DL.placeElements(layout, { width: vw, height: vh }, sizes, { timer });
            const placed = Object.keys(pos).map((id) => ({ id, r: rect(pos[id], sizes[id]) }));

            for (const { id, r } of placed) {
                assert.ok(!overlap(r, timer), `${layout.id}: ${id} накрывает таймер`);
            }
            for (let i = 0; i < placed.length; i++) {
                for (let j = i + 1; j < placed.length; j++) {
                    assert.ok(
                        !overlap(placed[i].r, placed[j].r),
                        `${layout.id}: ${placed[i].id} и ${placed[j].id} накладываются`
                    );
                }
            }
        }
    });
}

/**
 * Умолчание масштаба живёт в ДВУХ местах — и обязано совпадать.
 *
 * `--info-scale` в display.css работает до первой посылки настроек (чистый
 * профиль, окно открыто раньше панели), `DEFAULT_BLOCK_SCALE` — во всём
 * остальном. Комментарии в обоих файлах требовали равенства с самого начала,
 * но никто его не проверял: 19.08.2026 при подъёме размера блоков с 120 % до
 * 150 % разъехаться могли молча, и разница была бы видна только как «блоки
 * прыгнули, когда пришли настройки».
 */
test('умолчание масштаба блока в display.css и в реестре — одно число', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'display.css'), 'utf8');
    const m = /\.info-block\s*\{[\s\S]*?--info-scale:\s*([\d.]+)\s*;/.exec(css);
    assert.ok(m, 'в display.css не найдено объявление --info-scale у .info-block');
    assert.equal(
        Math.round(parseFloat(m[1]) * 100),
        DL.DEFAULT_BLOCK_SCALE,
        `--info-scale: ${m[1]} против DEFAULT_BLOCK_SCALE = ${DL.DEFAULT_BLOCK_SCALE}`
    );
});
