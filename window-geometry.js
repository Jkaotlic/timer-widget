'use strict';

/**
 * window-geometry.js — перетаскивание безрамочного окна и его геометрия.
 *
 * Виджет и часы держали два ДОСЛОВНЫХ клона этого кода. Замер диффом: блок
 * перетаскивания различался РОВНО одной содержательной строкой — именем канала
 * (`widget-move` против `clock-widget-move`); блок геометрии — четырьмя
 * значениями: ключ хранилища, пара каналов, базовый размер (250 против 220) и
 * имя поля с текущим масштабом. Всё остальное совпадало посимвольно, включая
 * комментарии о том, почему сравнение с прошлым масштабом обязательно.
 *
 * Полноэкранный дисплей сюда НЕ входит намеренно: его перетаскивание отличается
 * по существу — нет preventDefault, есть эвристика полноэкранного режима, и
 * геометрии он не хранит вовсе. Сводить его к общему виду значило бы менять
 * поведение, а не убирать дублирование.
 *
 * Почему перетаскивание вообще написано на JS, а не через
 * `-webkit-app-region: drag`: на Windows прозрачное безрамочное окно с `drag` на
 * родительском элементе перехватывает ВСЕ события мыши раньше детей с
 * `no-drag`. Механизм существует ради платформы, на которой он в этой машине не
 * проверяется, — поэтому его поведение закреплено замером в
 * e2e/window-drag-geometry.spec.js, а не чтением кода.
 *
 * Зависимости внедряются (хранилище, разбор JSON, отправка в главный процесс,
 * доступ к размерам окна) — так модуль проверяется в Node без DOM, чего про его
 * прежние копии внутри inline-<script> сказать было нельзя.
 */

// Границы допустимого масштаба. Значение вне них при восстановлении
// ИГНОРИРУЕТСЯ, а не поджимается: поджать испорченное значение — значит молча
// показать окно неожиданного размера; пропустить — оставить размер по умолчанию.
const MIN_SCALE_PCT = 30;
const MAX_SCALE_PCT = 600;

/**
 * @param {object} cfg
 * @param {string} cfg.storageKey — ключ в localStorage ('widgetGeometry' / 'clockGeometry')
 * @param {number} cfg.baseSize — размер окна при 100% (250 / 220)
 * @param {{move: string, resize: string, position: string}} cfg.channels
 * @param {(channel: string, payload: object) => void} cfg.send
 * @param {(raw: string, fallback: unknown) => unknown} cfg.parseJSON — безопасный разбор
 * @param {Storage} cfg.storage
 * @param {() => number} cfg.getOuterWidth
 * @param {() => {x: number, y: number}} cfg.getScreenPosition
 */
function createWindowGeometry(cfg) {
    const { storageKey, baseSize, channels, send, parseJSON, storage, getOuterWidth, getScreenPosition } = cfg;

    // Текущий масштаб окна. Раньше жил в поле окна (_widgetScalePct /
    // _clockScalePct) и читался снаружи ровно для одной цели — сравнить с
    // пришедшим значением, чтобы не записать геометрию в ответ на СВОЙ же
    // resize. Эта проверка несущая: restoreGeometry() сама вызывает resize при
    // старте, и без неё save() записал бы позицию ДО того, как придёт
    // *-set-position, затерев восстановленную.
    let scalePct;

    return {
        get scalePct() { return scalePct; },
        set scalePct(v) { scalePct = v; },

        /** Восстанавливает размер и позицию прошлой сессии. */
        restore() {
            const geo = parseJSON(storage.getItem(storageKey), null);
            if (!geo || typeof geo !== 'object') { return; }

            const pct = Number(geo.scalePct);
            if (Number.isFinite(pct) && pct >= MIN_SCALE_PCT && pct <= MAX_SCALE_PCT) {
                scalePct = pct;
                const size = Math.round(baseSize * pct / 100);
                send(channels.resize, { width: size, height: size });
            }

            // Точку проверяет главный процесс: сохранённая позиция может
            // указывать на монитор, которого больше нет, — он подожмёт её в
            // рабочую область живого экрана.
            if (Number.isFinite(geo.x) && Number.isFinite(geo.y)) {
                send(channels.position, { x: geo.x, y: geo.y });
            }
        },

        /**
         * Записывает размер и позицию.
         * @param {number} [explicitPct] — без него берётся ФАКТИЧЕСКАЯ ширина окна:
         *   она учитывает и растягивание за край рамки, а не только Ctrl+колесо.
         */
        save(explicitPct) {
            const pct = Number.isFinite(explicitPct)
                ? explicitPct
                : (Math.round(getOuterWidth() / baseSize * 100) || scalePct || 100);
            scalePct = pct;
            const pos = getScreenPosition();
            try {
                storage.setItem(storageKey, JSON.stringify({ scalePct: pct, x: pos.x, y: pos.y }));
            } catch { /* хранилище переполнено — геометрия не критична */ }
        },

        /** Размер окна в пикселях для заданного масштаба. */
        sizeFor(pct) {
            return Math.round(baseSize * pct / 100);
        }
    };
}

/**
 * Является ли элемент «пустым местом окна», за которое его можно тащить.
 * Всё интерактивное исключено: нажатие на кнопке — работа с кнопкой, а не с окном.
 */
function isWindowDragTarget(target) {
    return !!(
        target
        && typeof target.closest === 'function'
        && !target.closest('button, input, select, textarea, [role="button"], [tabindex]')
    );
}

/**
 * Вешает перетаскивание окна на контейнер.
 *
 * @param {object} cfg
 * @param {Element} cfg.container — элемент, за который тащат
 * @param {Document} cfg.doc — сюда вешаются mousemove/mouseup: кнопку отпускают и за пределами окна
 * @param {(payload: {deltaX: number, deltaY: number}) => void} cfg.onMove
 * @param {() => void} cfg.onDrop — вызывается один раз в конце перетаскивания
 * @param {object} cfg.handlers — сюда складываются ссылки на обработчики для cleanup()
 * @returns {object} тот же объект handlers
 */
function bindWindowDrag({ container, doc, onMove, onDrop, handlers }) {
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    handlers.onContainerMouseDown = (e) => {
        // Модификаторы зарезервированы за другими жестами (Ctrl+колесо —
        // масштаб), поэтому перетаскивание с ними обязано молчать, иначе окно
        // дёргается при попытке отмасштабировать.
        if (
            e.button !== 0
            || e.altKey
            || e.ctrlKey
            || e.metaKey
            || e.shiftKey
            || !isWindowDragTarget(e.target)
        ) {
            return;
        }
        isDragging = true;
        dragStartX = e.screenX;
        dragStartY = e.screenY;
        e.preventDefault();
    };
    container.addEventListener('mousedown', handlers.onContainerMouseDown);

    handlers.onMouseMove = (e) => {
        if (!isDragging) { return; }
        const dx = e.screenX - dragStartX;
        const dy = e.screenY - dragStartY;
        if (dx !== 0 || dy !== 0) {
            onMove({ deltaX: dx, deltaY: dy });
            // Точку отсчёта сдвигаем каждый раз: главный процесс складывает
            // РАЗНИЦУ с текущей позицией окна, а не ставит абсолютную.
            dragStartX = e.screenX;
            dragStartY = e.screenY;
        }
    };
    doc.addEventListener('mousemove', handlers.onMouseMove);

    handlers.onMouseUp = () => {
        if (isDragging) { onDrop(); }
        isDragging = false;
    };
    doc.addEventListener('mouseup', handlers.onMouseUp);

    return handlers;
}

const WindowGeometry = {
    createWindowGeometry,
    isWindowDragTarget,
    bindWindowDrag,
    MIN_SCALE_PCT,
    MAX_SCALE_PCT
};

// Node (тесты)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WindowGeometry;
}

// Браузер (рендерер) — без сборщика доступ идёт через window.X
if (typeof window !== 'undefined') {
    window.WindowGeometry = WindowGeometry;
}
