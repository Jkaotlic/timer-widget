'use strict';

/**
 * main-geometry.js — перемещение, размер и позиция безрамочных окон.
 *
 * Владелец геометрии — главный процесс (docs/lessons.md, «Window geometry is
 * owned by the main process»): он двигает окна и сообщает им их НАСТОЯЩИЕ
 * границы каналом `window-geometry`. Вся арифметика — в чистом
 * window-geometry.js (проверяется в Node); здесь — её применение к окну.
 *
 * Модуль не требует electron: `screen` передаёт точка входа.
 */

const { fitScaledBounds, fitRestoredBounds } = require('./window-geometry');
const { isPayloadObject } = require('./relay-payload');

/**
 * @param {object} deps
 * @param {object} deps.screen — electron.screen
 * @param {object} deps.CONFIG — constants.js
 * @param {Function} deps.safelySendToWindow — utils.js
 */
function createWindowGeometry({ screen, CONFIG, safelySendToWindow }) {
    // Shared delta-move for a frameless window. Reads deltaX/deltaY from the payload
    // INSIDE the body (never destructured in the IPC handler params — see
    // tests/electron-main-source.test.js). Validates the payload object + finite deltas.
    // Сообщает окну его НАСТОЯЩИЕ границы. Виджет и часы записывают в localStorage
    // то, что пришло сюда, а не то, что насчитали сами по outerWidth/screenX:
    // владелец геометрии — главный процесс, и на мониторе с масштабом ≠ 100 % его
    // DIP и CSS-пиксели рендерера — разные единицы (см. window-geometry.js).
    function reportGeometry(win) {
        if (!win || win.isDestroyed()) { return; }
        safelySendToWindow(win, 'window-geometry', win.getBounds());
    }

    /**
     * Окно сообщает СВОИ границы и тогда, когда двигало его не приложение.
     *
     * Раньше `window-geometry` уходил только из трёх обработчиков IPC
     * (moveWindowBy / resizeWindowClamped / positionWindowClamped), то есть
     * рендерер узнавал о размере лишь тогда, когда сам же его и попросил. Окна при
     * этом `resizable: true` — их тянут за край рамки, их двигает и меняет система
     * (WM_DPICHANGED, перенос на другой монитор). Всё это проходило мимо, и
     * запомненные рендерером границы устаревали НАВСЕГДА.
     *
     * Замер 01.09.2026: первый запуск на чистом профиле — окно растянуто до 500 px,
     * в widgetGeometry записалось 200 % ✔; второй запуск — растянуто до 750 px, а в
     * хранилище так и осталось 200 %. Дефект прятался за тем, что на чистом
     * профиле `reported` ещё пуст и работает запасной путь (outerWidth): со второго
     * запуска восстановление позиции заполняло `reported`, и он больше не менялся.
     *
     * Петли здесь нет: рендерер по этому каналу только ЗАПОМИНАЕТ границы
     * (setWindowBounds), обратно ничего не шлёт.
     */
    function bindGeometryReports(win) {
        if (!win) { return; }
        const send = () => reportGeometry(win);
        win.on('resize', send);
        win.on('move', send);
    }

    // Перемещение окна за время ОДНОГО жеста не меняет его размер.
    //
    // Размер здесь не просто «не трогается» — он ЗАДАЁТСЯ на каждом шаге, тем
    // самым, что был у окна в начале жеста. Разница принципиальная: прежний
    // setPosition оставлял размер на усмотрение системы, а система вправе его
    // менять — при переходе на монитор с другим масштабом Windows присылает
    // WM_DPICHANGED с новым прямоугольником, и окно, которое просто тащат мышью,
    // растёт само. Это и есть жалоба «при перемещении по экрану виджет
    // самопроизвольно увеличивается». Здесь такой рост отменяется следующим же
    // движением мыши, а размер за границами жеста по-прежнему свободен — тянуть
    // окно за край рамки можно.
    function moveWindowBy(win, payload) {
        if (!isPayloadObject(payload)) { return; }
        const { deltaX, deltaY, first } = payload;
        if (!win || win.isDestroyed() || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) { return; }

        const bounds = win.getBounds();
        // Начало жеста помечает рендерер (bindWindowDrag): иначе границу жеста
        // определить не из чего — канал несёт только дельты.
        if (first || !win.__dragSize) {
            win.__dragSize = { width: bounds.width, height: bounds.height };
        }

        win.setBounds({
            x: Math.round(bounds.x + deltaX),
            y: Math.round(bounds.y + deltaY),
            width: win.__dragSize.width,
            height: win.__dragSize.height
        });
        reportGeometry(win);
    }

    // Изменение размера безрамочного окна. Держит неподвижным ЦЕНТР окна и
    // укладывает результат в рабочую область ТОГО монитора, где окно находится.
    //
    // Раньше здесь был `win.setSize()`: он оставляет неподвижным левый-верхний
    // угол, а позицию после него не правил никто, — поэтому окно росло вниз-вправо
    // и уезжало за край экрана, унося с собой отцентрированный внутри циферблат
    // (замерено: виджет при 400 % занимал x = 3170…4170 при ширине экрана 3440).
    // Поджатие шло вдобавок по getPrimaryDisplay(), то есть на втором мониторе по
    // чужим размерам.
    //
    // setBounds, а не setSize + setPosition: два вызова дают промежуточный кадр
    // «уже большое, ещё не сдвинутое».
    //
    // Вся арифметика — в чистой fitScaledBounds() из window-geometry.js, чтобы
    // проверяться в Node без запуска Electron.
    function resizeWindowClamped(win, payload) {
        if (!isPayloadObject(payload)) { return; }
        if (!win || win.isDestroyed()) { return; }

        const current = win.getBounds();
        // Минимум берётся у самого окна, а не из литерала: у виджета minHeight 140,
        // и посчитанный по литералу центр промахнулся бы мимо настоящего.
        const [minWidth, minHeight] = win.getMinimumSize();
        // Область укладки — ГРАНИЦЫ экрана, а не рабочая область: виджет и часы
        // держатся выше полоски меню (WINDOW_LEVEL_ABOVE_MENU_BAR) и вправе занимать
        // её полосу. По рабочей области увеличенное окно отжималось вниз, и вернуть
        // его к краю было нечем.
        const { bounds: screenBounds } = screen.getDisplayMatching(current);

        win.setBounds(fitScaledBounds(current, payload, screenBounds, { width: minWidth, height: minHeight }));
        reportGeometry(win);
    }

    // Shared position restore for a frameless widget window. Reads x/y from the
    // payload INSIDE the body (never destructured in the IPC handler params — see
    // tests/electron-main-source.test.js).
    //
    // Positions are persisted by the renderers across sessions, so a saved point can
    // reference a monitor that is no longer attached (docked laptop, unplugged TV).
    // Restoring it verbatim would drop the widget somewhere invisible with no way to
    // drag it back, so the window has to keep a grabbable strip on a REAL display —
    // see fitRestoredBounds() in window-geometry.js for what that means and why
    // hanging over the edge is deliberately allowed.
    function positionWindowClamped(win, payload) {
        if (!isPayloadObject(payload)) { return; }
        const { x, y } = payload;
        if (!win || win.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) { return; }

        const [width, height] = win.getSize();
        const [minWidth, minHeight] = win.getMinimumSize();
        const targetX = Math.round(x);
        const targetY = Math.round(y);

        // Какому монитору принадлежит сохранённая точка. Если ни одному — монитор
        // отключили — берём главный.
        const host = screen.getAllDisplays().find(({ bounds }) =>
            targetX >= bounds.x && targetX < bounds.x + bounds.width
            && targetY >= bounds.y && targetY < bounds.y + bounds.height)
            || screen.getPrimaryDisplay();

        // Проверяется ВИДИМАЯ ПОЛОСА, а не попадание угла и не полная укладка.
        //
        // Прежних редакций было две, и обе ошибались в разные стороны. Первая
        // считала окно видимым, если на дисплее лежал его левый-верхний угол:
        // размер в проверке не участвовал вовсе, и сохранённая точка (3320, 70) при
        // размере 1000 px оставляла на экране 12 % окна. Вторая поджимала
        // прямоугольник целиком — и вместе с испорченными профилями отменяла
        // НАМЕРЕННОЕ расположение внахлёст с краем: замерено зондом на 3440×1440,
        // сохранено x = 3470, восстановлено x = 3190.
        //
        // Область укладки для потерянного окна — границы экрана, а не рабочая
        // область: иначе окно, намеренно поставленное к верхнему краю, после
        // перезапуска съезжало вниз на высоту полоски меню.
        win.setBounds(fitRestoredBounds(
            { x: targetX, y: targetY, width, height },
            screen.getAllDisplays(),
            CONFIG.WINDOW_MIN_VISIBLE_PX,
            host.bounds,
            { width: minWidth, height: minHeight }
        ));
        reportGeometry(win);
    }

    return { reportGeometry, bindGeometryReports, moveWindowBy, resizeWindowClamped, positionWindowClamped };
}

module.exports = { createWindowGeometry };
