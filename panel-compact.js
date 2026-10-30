'use strict';

/**
 * panel-compact.js — панель сама решает, когда ей стать компактной.
 *
 * Жалоба 19.08.2026 с кадром: на широком окне подсказка внизу обрезана
 * наполовину. Компактный режим был привязан к ВЫСОТЕ окна (`@media
 * (max-height: 700px)`), а высота — не тот вопрос: помещается содержимое или
 * нет, зависит ещё и от ширины (перенос подсказок), от языка и от того, какие
 * строки сейчас показаны. Окно 761×737 в компактный порог не попадало, а
 * содержимое в него не влезало.
 *
 * Правильный признак — ЗАМЕР: содержимое выше окна → сжимаемся. Медиазапрос
 * этого знать не может в принципе.
 *
 * Решение принимается ЗАМЕРОМ В ТОМ СОСТОЯНИИ, в которое собираемся перейти:
 * панель растянута на всё окно (герой забирает свободную высоту), поэтому в
 * помещающемся состоянии `scrollHeight` РАВЕН высоте окна и «сколько нужно на
 * самом деле» по нему не узнать. Разжатие проверяется так же, как полоса
 * сверху в дисплее меряет уступку рамы: снять, пересчитать, померить.
 *
 * Логика решения — чистая функция на внедрённых замерах
 * (tests/panel-compact.test.js), проводка — отдельно.
 */

/**
 * Помещается ли содержимое.
 *
 * Запас в пиксель: содержимое РОВНО в окно — это «влезло», а не «почти».
 */
function fits(content, client) {
    if (!Number.isFinite(content) || !Number.isFinite(client) || client <= 0) { return true; }
    return content <= client + 1;
}

/**
 * Решение принимается ЗАМЕРОМ В ТОМ СОСТОЯНИИ, в которое собираемся перейти.
 *
 * Почему не «сжались — влезло — разожмёмся»: панель растянута на всё окно
 * (герой забирает свободную высоту), поэтому `scrollHeight` в помещающемся
 * состоянии РАВЕН высоте окна и «сколько нужно на самом деле» по нему не
 * узнать. Отсюда единственный честный способ проверить, пора ли разжиматься:
 * снять класс, дать браузеру пересчитать раскладку и померить снова — тот же
 * приём, что и «меряем при нулевой уступке» у полосы сверху в дисплее.
 *
 * @param {object} io  { isCompact(), setCompact(v), measure() } — всё, что
 *   нужно знать функции о внешнем мире; в тестах подставляется поддельное.
 * @returns {boolean} состояние после решения
 */
function decideCompact(io) {
    if (!io.isCompact()) {
        const cramped = !fits(...io.measure());
        if (cramped) { io.setCompact(true); }
        return cramped;
    }
    // Уже сжаты: снимаем сжатие и смотрим, помещается ли без него.
    io.setCompact(false);
    const roomy = fits(...io.measure());
    if (!roomy) { io.setCompact(true); }
    return !roomy;
}

/**
 * Предохранитель от петли ступеней.
 *
 * Жалоба 27.10.2026, видео с Windows 11 (Сбербук): в каждом кадре видны ДВЕ
 * ступени сразу — крупные и мелкие цифры, два ряда настроек. Ступень менялась
 * чаще кадра, пока пробел не запускал таймер (старт прячет пресеты, и
 * содержимое уходит от границы). На macOS петля не воспроизводится ни на одном
 * размере окна при масштабе 1 / 1.25 / 1.5: звено, которое её замыкает, живёт
 * в Windows (дробный масштаб, метрики шрифта, полоса прокрутки).
 *
 * Гистерезис «разжимайся только с запасом» тут не построить: растянутая панель
 * в помещающемся состоянии меряет `scrollHeight` РОВНО в окно, и запаса по
 * замеру не видно. Поэтому ловится сама петля: больше `limit` смен ступени за
 * `windowMs` пользователь не делает — это раскачка.
 *
 * @param {{now: () => number, limit?: number, windowMs?: number}} o
 * @returns {{record: (level: number) => boolean}} true — петля поймана
 */
function createFlipBreaker({ now, limit = 4, windowMs = 1000 }) {
    let stamps = [];
    return {
        record() {
            const t = now();
            stamps = stamps.filter((s) => t - s < windowMs);
            stamps.push(t);
            return stamps.length > limit;
        }
    };
}

// Насколько должно измениться окно, чтобы предохранитель отпустил: дробный
// масштаб Windows сам качает размер на пиксель, и это не новое окно.
const UNLOCK_DELTA_PX = 4;

/**
 * Повесить автоматический компактный режим на панель.
 *
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {string} [deps.selector]  что меряем
 * @param {string[]} [deps.classNames] классы ступеней сжатия на <body>
 * @param {() => number} [deps.now]  часы предохранителя (в тестах — поддельные)
 * @param {() => {w: number, h: number}} [deps.getViewport]  размер окна
 * @returns {{update: () => boolean, stop: () => void, locked: () => boolean}|null}
 */
function bindCompactMode({
    doc, selector = '.control-panel', classNames = ['compact-panel', 'compact-panel-2'],
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    getViewport = () => (typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 0, h: 0 })
}) {
    const panel = /** @type {HTMLElement|null} */ (doc && doc.querySelector ? doc.querySelector(selector) : null);
    if (!panel) { return null; }
    const body = doc.body;

    /**
     * Ступеней сжатия ДВЕ, и вторая нужна не для красоты.
     *
     * Первая убирает воздух и уменьшает цифры — этого хватает, пока настроек
     * на экране обычное количество. Но «Считать ниже нуля» показывает ещё две
     * строки, и на окне минимальной высоты содержимое остаётся выше окна даже
     * сжатым (замер 19.08.2026: 700px при окне 660). Вторая ступень убирает то,
     * без чего интерфейс остаётся понятным: подсказку под цифрами (её текст
     * дублирует само действие — по цифрам и так кликают), ещё немного кегля и
     * высоты транспорта.
     *
     * Дальше второй ступени не идём: панель прокручивается, и это честный
     * ответ на окно, в которое не помещается даже сжатое.
     */
    const setLevel = (n) => {
        classNames.forEach((c, i) => body.classList.toggle(c, i < n));
        // Чтение форсирует пересчёт раскладки: без него следующий замер вернул
        // бы высоту ПРЕЖНЕГО состояния.
        void panel.offsetHeight;
    };

    const currentLevel = () => classNames.filter((c) => body.classList.contains(c)).length;

    const breaker = createFlipBreaker({ now });
    let lockedAt = null; // размер окна, на котором петля поймана

    // Каждую ступень проверяем ЗАМЕРОМ в ней самой, начиная с нулевой: так
    // решение не зависит от того, с какой стороны мы в неё пришли.
    const measureLevel = () => {
        for (let n = 0; n <= classNames.length; n++) {
            setLevel(n);
            if (fits(panel.scrollHeight, panel.clientHeight)) { return n; }
        }
        return classNames.length;
    };

    const update = () => {
        const prev = currentLevel();
        if (lockedAt) {
            const vp = getViewport();
            const moved = Math.abs(vp.w - lockedAt.w) >= UNLOCK_DELTA_PX
                || Math.abs(vp.h - lockedAt.h) >= UNLOCK_DELTA_PX;
            // Замороженная ступень не пробуется заново: сам перебор ступеней и
            // есть то, что раскачивает панель.
            if (!moved) { return prev > 0; }
            lockedAt = null;
        }
        const next = measureLevel();
        if (next !== prev && breaker.record(next)) {
            // Петля: встаём на самую сжатую из двух. На ней содержимое
            // помещается в обоих состояниях, а лишний воздух лучше обрезанного.
            const safe = Math.max(next, prev);
            setLevel(safe);
            lockedAt = { ...getViewport() };
            console.warn(`[panel-compact] петля ступеней ${prev}↔${next}, ступень ${safe} заморожена до смены размера окна`
                + ` (окно ${lockedAt.w}×${lockedAt.h}, содержимое ${panel.scrollHeight} при ${panel.clientHeight})`);
            return safe > 0;
        }
        return next > 0;
    };

    let scheduled = false;
    const schedule = () => {
        if (scheduled) { return; }
        scheduled = true;
        const run = () => {
            scheduled = false;
            update();
        };
        if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(run); } else { run(); }
    };

    let observer = null;
    if (typeof ResizeObserver === 'function') {
        // Наблюдаем коробку панели И КАЖДУЮ ЕЁ СЕКЦИЮ.
        //
        // Первая версия смотрела на панель и её первого ребёнка — и пропускала
        // самый частый случай: тумблер «Считать ниже нуля» показывает две
        // строки настроек В СЕРЕДИНЕ панели. Высота самой панели при этом не
        // меняется (её задаёт окно), первый ребёнок тоже не меняется, а
        // содержимое вырастает на 46px и перестаёт помещаться. Замер
        // 19.08.2026: после тумблера содержимое 700 при окне 660, а пересчёт
        // не срабатывал вовсе — ручной вызов возвращал 660.
        observer = new ResizeObserver(schedule);
        observer.observe(panel);
        for (const child of panel.children) { observer.observe(child); }
    }
    const onResize = schedule;
    if (typeof window !== 'undefined') { window.addEventListener('resize', onResize); }

    update();

    return {
        update,
        locked: () => lockedAt !== null,
        stop() {
            if (observer) { observer.disconnect(); }
            if (typeof window !== 'undefined') { window.removeEventListener('resize', onResize); }
        }
    };
}

export { fits, decideCompact, createFlipBreaker, bindCompactMode };

if (typeof window !== 'undefined') {
    // мост до задачи 6: читатель — классический control-app.js
    /** @type {typeof import('./panel-compact.js')} */
    const PanelCompact = { fits, decideCompact, createFlipBreaker, bindCompactMode };
    window.PanelCompact = PanelCompact;
}
