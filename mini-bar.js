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
        toggle: () => setState(!collapsed)
    };

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
