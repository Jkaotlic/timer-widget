'use strict';

/**
 * panel-drawer.js — арифметика ширины при открытии ящика настроек.
 *
 * Зачем отдельный модуль ради одной функции. Она нужна ДО того, как окно
 * выросло, то есть предсказывает результат чужого решения (главного процесса), и
 * проверить её можно только числами: в e2e эта ветка воспроизводится лишь на
 * экране, который уже мал, а на широком мониторе ограничение не срабатывает
 * вовсе. Писать её в inline-скрипте панели значило бы завести логику там, где её
 * никто не увидит, — ровно то, против чего стоит потолок в
 * tests/control-decomposition.test.js.
 *
 * Двойной экспорт, как у renderer-shared.js:
 *   - Node (тесты):     module.exports
 *   - Браузер (панель): window.PanelDrawer
 */

const CFG = (typeof window !== 'undefined' && window.CONFIG)
    ? window.CONFIG
    : (typeof require === 'function' ? require('./constants.js') : null);

// Поле до края экрана. Тем же числом режет главный процесс (`screenWidth - 50`),
// и разойтись им нельзя: предсказание перестанет совпадать с фактом.
const SCREEN_MARGIN = 50;

const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/**
 * Ширина колонки содержимого, которая получится ПОСЛЕ открытия ящика.
 *
 * Что здесь происходит и почему это не «лишняя предусмотрительность». Окно
 * растёт мгновенно, а колонка под ящик резервируется переходом 240 мс. Пока
 * колонка не встала, панель центруется по тому, что есть; если «то, что есть»
 * не финальное — она успевает уехать и вернуться. Пользователь описал это как
 * «бывает, что прыгает при открытии боковой панели».
 *
 * Прежняя версия прибивала колонку к ширине окна ДО роста, исходя из «окно
 * вырастет ровно на ширину ящика». Это верно, пока экран позволяет. Замер на
 * раннере CI (экран 1024): окно просило 1096, получило 974 — колонка вышла на
 * 122px шире правды, панель прыгнула вправо на 40px и вернулась.
 *
 * Ошибиться предсказание может (например, на втором мониторе с другим рабочим
 * столом), и это не страшно: `syncColumn` на событии `resize` всё равно ставит
 * колонку по факту. Цена ошибки — сегодняшнее поведение, а не худшее.
 *
 * @param {object} o
 * @param {number} o.innerWidth   ширина окна ДО открытия
 * @param {number} o.drawerWidth  ширина ящика (колонка справа)
 * @param {number} [o.availWidth] рабочая ширина экрана; мусор = «экран не мешает»
 * @param {number} [o.maxWindowWidth]
 * @param {number} [o.minWindowWidth]
 * @param {number} [o.screenMargin]
 * @returns {number} ширина колонки в пикселях
 */
function drawerColumnWidth(o) {
    const opts = o || {};
    const drawer = num(opts.drawerWidth, 336);
    const maxW = num(opts.maxWindowWidth, CFG ? CFG.CONTROL_WINDOW_MAX_WIDTH_WITH_DRAWER : 1096);
    const minW = num(opts.minWindowWidth, CFG ? CFG.CONTROL_WINDOW_MIN_WIDTH : 380);
    const margin = num(opts.screenMargin, SCREEN_MARGIN);

    // Мусор вместо ширины окна — это не повод вернуть NaN: панель всё равно
    // что-то нарисует, и пусть это будет минимум окна, а не пустая колонка.
    const inner = Math.max(minW, num(opts.innerWidth, minW));

    // Экран ограничивает, только если про него известно что-то осмысленное.
    // Infinity сюда попадает законно (ограничения нет) и обязан вести себя как
    // отсутствие данных, иначе Math.min вернёт Infinity дальше по цепочке.
    const avail = num(opts.availWidth, 0);
    const screenCap = (Number.isFinite(avail) && avail > margin) ? avail - margin : Infinity;

    const finalWindow = Math.max(minW, Math.min(inner + drawer, maxW, screenCap));
    return Math.max(minW, Math.round(finalWindow - drawer));
}

/**
 * Ширина колонки по УЖЕ известной ширине окна — то, что считает `syncColumn` на
 * каждом `resize`, пока ящик открыт.
 *
 * Живёт рядом с предсказанием не для симметрии: пол у них общий
 * (CONTROL_WINDOW_MIN_WIDTH), и разъехаться ему нельзя. Пока копий было две,
 * предсказанная и фактическая колонка могли по-разному упереться в минимум.
 *
 * @param {number} innerWidth
 * @param {number} drawerWidth
 * @param {number} [minWindowWidth]
 * @returns {number}
 */
function columnFromWindow(innerWidth, drawerWidth, minWindowWidth) {
    const minW = num(minWindowWidth, CFG ? CFG.CONTROL_WINDOW_MIN_WIDTH : 380);
    const inner = num(innerWidth, minW);
    return Math.max(minW, Math.round(inner - num(drawerWidth, 336)));
}

const PanelDrawer = { SCREEN_MARGIN, drawerColumnWidth, columnFromWindow };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PanelDrawer;
}

if (typeof window !== 'undefined') {
    window.PanelDrawer = PanelDrawer;
}
