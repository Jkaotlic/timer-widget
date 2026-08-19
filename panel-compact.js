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
 * Повесить автоматический компактный режим на панель.
 *
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {string} [deps.selector]  что меряем
 * @param {string} [deps.className] класс на <body>
 * @returns {{update: () => boolean, stop: () => void}|null}
 */
function bindCompactMode({ doc, selector = '.control-panel', className = 'compact-panel' }) {
    const panel = doc && doc.querySelector ? doc.querySelector(selector) : null;
    if (!panel) { return null; }
    const body = doc.body;

    const update = () => decideCompact({
        isCompact: () => body.classList.contains(className),
        setCompact: (v) => {
            body.classList.toggle(className, v);
            // Чтение форсирует пересчёт раскладки: без него следующий замер
            // вернул бы высоту ПРЕЖНЕГО состояния.
            void panel.offsetHeight;
        },
        measure: () => [panel.scrollHeight, panel.clientHeight]
    });

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
        // Наблюдаем и КОРОБКУ панели, и её содержимое: меняется и то, и другое
        // — окно тянут мышью, а содержимое растёт от смены состояния таймера.
        observer = new ResizeObserver(schedule);
        observer.observe(panel);
        if (panel.firstElementChild) { observer.observe(panel.firstElementChild); }
    }
    const onResize = schedule;
    if (typeof window !== 'undefined') { window.addEventListener('resize', onResize); }

    update();

    return {
        update,
        stop() {
            if (observer) { observer.disconnect(); }
            if (typeof window !== 'undefined') { window.removeEventListener('resize', onResize); }
        }
    };
}

const PanelCompact = { fits, decideCompact, bindCompactMode };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PanelCompact;
}

if (typeof window !== 'undefined') {
    window.PanelCompact = PanelCompact;
}
