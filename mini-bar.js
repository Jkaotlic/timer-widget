'use strict';

/**
 * Режим «полоса» окна управления.
 *
 * После того как таймер настроен, панель нужна не как панель, а как индикатор
 * с кнопкой паузы, поэтому окно схлопывается в строку 400×52: точка состояния,
 * время, пауза/старт/сброс, шеврон разворота. Полоса оправдана ровно
 * управлением — паузой и сбросом без разворота; будь нужно только «время
 * поверх окон», честнее было бы открыть виджет.
 *
 * Логика вынесена в отдельный файл не ради красоты: inline-скрипт
 * electron-control.html упирается в собственный потолок размера
 * (tests/control-decomposition.test.js), и держать её там нельзя. Зависимости
 * внедряются, поэтому модуль проверяется в Node на поддельных document/ipc —
 * так же устроен onboarding.js.
 *
 * Разметки и размеров модуль НЕ знает: он ставит класс на <body>, всё
 * остальное делает control.css. Размер окна меняет главный процесс — пол
 * minHeight снимается только там (канал control-collapse).
 */

// Высота полосы. Число живёт здесь, а CSS повторяет его в правиле
// `body.collapsed .mini-bar { height: 52px }`. Расхождение поймает
// e2e/mini-bar.spec.js: он меряет НАСТОЯЩЕЕ окно, а не эту константу.
const BAR_HEIGHT = 52;

function init(deps) {
    const doc = deps && deps.doc;
    const ipc = (deps && deps.ipc) || null;
    const onToggle = (deps && deps.onToggle) || null;
    if (!doc || !doc.body) { return null; }

    let collapsed = false;

    const api = {
        isCollapsed: () => collapsed,
        collapse: () => setState(true),
        expand: () => setState(false),
        toggle: () => setState(!collapsed),
        render
    };

    /**
     * Отрисовать состояние таймера в полосе.
     *
     * Панель отдаёт сюда ЗНАЧЕНИЯ (готовую строку времени и полосу срочности,
     * посчитанную общим RendererShared.timerColorBand), а не лезет в элементы
     * полосы: иначе её разметка размазана между двумя файлами, а inline-скрипт
     * панели упирается в собственный потолок размера.
     *
     * @param {{text: string, band: string, resume?: boolean}} state
     *        resume — таймер стоит на паузе, то есть кнопка запуска означает
     *        «продолжить», а не «начать». Панель знает ПРИЗНАК, полоса решает,
     *        каким словом его показать.
     */
    function render(state) {
        if (!state) { return api; }
        const time = doc.getElementById('miniBarTime');
        if (time) { time.textContent = state.text; }
        const start = doc.getElementById('miniBarStart');
        if (start) {
            const word = state.resume ? 'Продолжить' : 'Старт';
            start.textContent = word;
            if (start.setAttribute) {
                start.setAttribute('title', word + ' (Space)');
                start.setAttribute('aria-label', state.resume ? 'Продолжить отсчёт' : 'Запустить таймер');
            }
        }
        const dot = doc.getElementById('miniBarDot');
        if (dot) {
            // Всё, что не «тревога» и не «предупреждение», — спокойное
            // состояние. Незнакомое значение тоже: полоса не то место, где
            // стоит падать из-за неизвестного статуса.
            const band = (state.band === 'danger' || state.band === 'overtime') ? 'danger'
                : (state.band === 'warning' ? 'warning' : 'ok');
            dot.className = 'mini-dot ' + band;
        }
        return api;
    }

    function setState(next) {
        // Без дребезга: каждый лишний setSize на Windows округляет внешний
        // размер окна и копит дрейф — этим уже болел resize-control-window.
        if (next === collapsed) { return api; }
        collapsed = next;
        // Сначала внешний эффект (закрыть ящик настроек), потом отправка:
        // ящик расширяет окно вправо, и сжимать надо уже без него.
        if (onToggle) { onToggle(collapsed); }
        if (collapsed) {
            doc.body.classList.add('collapsed');
        } else {
            doc.body.classList.remove('collapsed');
        }
        syncAria();
        if (ipc && typeof ipc.send === 'function') {
            ipc.send('control-collapse', collapsed
                ? { collapsed: true, height: BAR_HEIGHT }
                : { collapsed: false });
        }
        return api;
    }

    function syncAria() {
        const btn = doc.getElementById('miniBarToggle');
        if (btn && btn.setAttribute) {
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        }
    }

    for (const id of ['miniBarToggle', 'miniBarExpand']) {
        const el = doc.getElementById(id);
        if (el && el.addEventListener) { el.addEventListener('click', () => api.toggle()); }
    }

    // Транспорт полосы ведёт в ТЕ ЖЕ действия, что и большие кнопки панели:
    // своего управления таймером у свёрнутого состояния нет. Действия
    // внедряются, поэтому проводка проверяется в Node.
    const actions = (deps && deps.actions) || {};
    for (const [id, name] of [['miniBarStart', 'start'], ['miniBarPause', 'pause'], ['miniBarReset', 'reset']]) {
        const el = doc.getElementById(id);
        if (el && el.addEventListener) {
            el.addEventListener('click', () => { if (typeof actions[name] === 'function') { actions[name](); } });
        }
    }

    // Двойной клик — по самой полосе и по титлбару панели. Клик по КНОПКЕ
    // исключён: двойное нажатие на «паузу» — это два нажатия на паузу, и
    // схлопывать по нему окно нельзя.
    const onDoubleClick = (e) => {
        if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('button')) { return; }
        api.toggle();
    };
    const bar = doc.getElementById('miniBar');
    if (bar && bar.addEventListener) { bar.addEventListener('dblclick', onDoubleClick); }
    const titlebar = typeof doc.querySelector === 'function' ? doc.querySelector('.custom-titlebar') : null;
    if (titlebar && titlebar.addEventListener) { titlebar.addEventListener('dblclick', onDoubleClick); }

    syncAria();

    return api;
}

const MiniBar = { init, BAR_HEIGHT };

// Экспорт для Node.js (тесты)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MiniBar;
}

// Экспорт для браузера (renderer process)
if (typeof window !== 'undefined') {
    window.MiniBar = MiniBar;
}
