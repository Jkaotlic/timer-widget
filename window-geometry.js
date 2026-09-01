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

// Сколько ждать тишины, прежде чем записать геометрию по событию resize.
// Величина покрывает круг «главный процесс изменил окно → рендерер увидел
// новый размер». На этой машине к моменту события метрики окна УЖЕ свежие
// (замерено), то есть запас здесь на загруженную систему и на медленные
// машины, а не на известное отставание: величина лага не измерялась.
const SAVE_SETTLE_MS = 300;

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
 * @param {(pct: number) => void} [cfg.onScaleSettled] — вызывается, когда
 *        УСТОЯВШИЙСЯ размер оказался другим: окно узнало свой новый масштаб не
 *        от колеса, а от системы (растянули за край рамки, ползунок панели).
 *        Нужен, чтобы ползунок панели не остался на прежнем числе.
 */
function createWindowGeometry(cfg) {
    const { storageKey, baseSize, channels, send, parseJSON, storage, getOuterWidth, getScreenPosition, onScaleSettled } = cfg;

    // Текущий масштаб окна. Раньше жил в поле окна (_widgetScalePct /
    // _clockScalePct) и сравнивался СНАРУЖИ, в обработчике resize, ровно для
    // одной цели — не записать геометрию в ответ на СВОЙ же resize:
    // restore() сама вызывает resize при старте, и без проверки save() записал
    // бы позицию ДО того, как придёт *-set-position, затерев восстановленную.
    //
    // Цель прежняя, но снаружи это сравнение делать НЕЛЬЗЯ: в момент события
    // окно ещё прежнего размера, и проверка срабатывала наоборот — разрешала
    // запись и стирала восстановленное (см. saveSettled). Теперь сравнение
    // живёт внутри модуля и выполняется, когда размер устоялся.
    let scalePct;

    // Отложенная запись по событию resize. См. saveSettled() ниже.
    let settleTimer = null;

    // Последние границы окна, СООБЩЁННЫЕ главным процессом.
    //
    // Зачем: размер и позицию окна рендерер считал сам — outerWidth и
    // screenX/screenY. Владеет ими при этом главный процесс, он же их и задаёт.
    // Пока масштаб экрана 100 %, обе величины совпадают (замерено на 3440×1440:
    // outerWidth 250 при getBounds().width 250), и расхождению неоткуда взяться.
    // На мониторе с иным масштабом CSS-пиксель рендерера и DIP главного процесса
    // — разные единицы: окно записывает свой размер и свою точку в чужих
    // единицах, а восстановление читает их как свои. Отсюда и «виджет
    // самопроизвольно растёт», и «позиция не сохраняется» — у обоих один корень.
    //
    // Показания рендерера остаются запасным путём: до первого сообщения от
    // главного процесса других данных нет.
    let reported = null;

    /** Фактические границы окна: сообщённые главным процессом либо свои. */
    function currentBounds() {
        if (reported) { return reported; }
        const pos = getScreenPosition();
        return { x: pos.x, y: pos.y, width: getOuterWidth(), height: getOuterWidth() };
    }

    /**
     * Записывает размер и позицию.
     * @param {number} [explicitPct] — без него берётся ФАКТИЧЕСКАЯ ширина окна:
     *   она учитывает и растягивание за край рамки, а не только Ctrl+колесо.
     */
    function save(explicitPct) {
        const b = currentBounds();
        const pct = Number.isFinite(explicitPct)
            ? explicitPct
            : (Math.round(b.width / baseSize * 100) || scalePct || 100);
        scalePct = pct;
        try {
            storage.setItem(storageKey, JSON.stringify({ scalePct: pct, x: b.x, y: b.y }));
        } catch { /* хранилище переполнено — геометрия не критична */ }
    }

    return {
        get scalePct() { return scalePct; },
        set scalePct(v) { scalePct = v; },

        /**
         * Границы окна, как их видит ГЛАВНЫЙ процесс. Приходят каналом
         * `window-geometry` после каждой операции, которая двигает или меняет
         * размер окна. Мусор игнорируется: пропущенное сообщение оставит
         * прежние данные, а подмена их на undefined увела бы запись на
         * показания рендерера, то есть ровно туда, откуда мы уходим.
         */
        setWindowBounds(bounds) {
            if (!bounds || typeof bounds !== 'object') { return; }
            const { x, y, width, height } = bounds;
            if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) { return; }
            reported = { x, y, width, height };
        },

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

        save,

        /**
         * Запись по событию `resize` — ПОСЛЕ того, как размер устоялся.
         *
         * Решение «писать или не писать» нельзя принимать в самом обработчике.
         * Замеренный дефект: restore() выставляет scalePct сразу (иначе эхо его
         * собственного resize записало бы позицию ДО того, как её применит
         * *-set-position), но окно в этот момент ещё прежнего размера. Раннее
         * событие resize давало pct = 100 при scalePct = 400, сравнение
         * «не равно» пропускало запись — и восстановленная геометрия
         * затиралась позицией открытия по умолчанию. Окно выглядело правильно,
         * а следующее открытие показывало размер по умолчанию.
         *
         * Здесь getOuterWidth() читается в момент СРАБАТЫВАНИЯ таймера, когда
         * окно уже доехало, поэтому одного события достаточно, а серия событий
         * (растягивание за край рамки шлёт их десятками) даёт одну запись.
         *
         * Путь Ctrl+колеса этого не касается: он зовёт save() явно и сразу.
         */
        saveSettled(delayMs = SAVE_SETTLE_MS) {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
                settleTimer = null;
                const pct = Math.round(currentBounds().width / baseSize * 100) || scalePct || 100;
                // С ЧЕМ сравнивать, когда своего масштаба ещё нет. Пустой
                // scalePct означает не «неизвестно», а «окно открыто базового
                // размера», то есть 100 %: другого размера у него на старте не
                // бывает. Без этой подстановки открытие окна с чистой
                // геометрией выглядело как изменение масштаба со 100 на 100 —
                // и панель, получив отчёт, сохраняла ВЕСЬ свой набор настроек
                // поверх профиля, затирая то, что туда положили мимо неё.
                const known = Number.isFinite(scalePct) ? scalePct : 100;
                if (pct === known) { return; }
                save(pct);
                // О новом масштабе узнаёт и панель. Без этого путь Ctrl+колеса
                // был ЕДИНСТВЕННЫМ, который сообщал масштаб, — а окно можно
                // растянуть за край рамки. Замер: окно 500 px (200 %), в
                // хранилище 200, ползунок панели 100. Два источника правды
                // расходились на сто процентных пунктов, и следующее движение
                // ползунка возвращало окно назад.
                if (typeof onScaleSettled === 'function') { onScaleSettled(pct); }
            }, delayMs);
        },

        /** Снимает отложенную запись — для cleanup() при закрытии окна. */
        cancelPendingSave() {
            clearTimeout(settleTimer);
            settleTimer = null;
        },

        /** Размер окна в пикселях для заданного масштаба. */
        sizeFor(pct) {
            return Math.round(baseSize * pct / 100);
        }
    };
}

// ---------------------------------------------------------------------------
// Арифметики полосы LED здесь БОЛЬШЕ НЕТ.
//
// Она считала высоту окна и поля рамки по числу знакомест: у стиля LED окно
// превращалось в полосу под длину строки. Стиль слит с «Цифрами» 13.08.2026 —
// у объединённого стиля рамка обнимает цифры сама (см. FRAME_PAD_*_EM в
// digits-style.js), а окно остаётся квадратным при любом стиле. Вместе с
// арифметикой ушли ledStripHeight/ledStripMetrics, пол WIDGET_LED_MIN_HEIGHT и
// syncWindowShape в виджете: держать их «на всякий случай» значило бы держать
// код, до которого нет ни одного пути.


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
 * Границы окна при смене размера: центр сохраняется, прямоугольник целиком
 * укладывается в рабочую область.
 *
 * Зачем: размер менялся через `win.setSize()`, он оставляет неподвижным
 * ЛЕВЫЙ-ВЕРХНИЙ угол, а позицию после него не правил никто. Содержимое в этих
 * окнах отцентрировано, поэтому при увеличении циферблат уезжал вниз-вправо
 * ровно на половину прироста и вылезал за край экрана — замерено: виджет при
 * 400 % занимал x = 3170…4170 при ширине экрана 3440, часы — y = 1060…1940 при
 * высоте 1440.
 *
 * Здесь стояло, что вернуть окно вверх нельзя вовсе: «macOS не пускает окно выше
 * рабочей области НИ ПРИ КАКОМ уровне». Замер был неполон. Поджимает не уровень
 * окна, а `-[NSWindow constrainFrameRect:toScreen:]`; Electron отключает его
 * опцией конструктора `enableLargerThanScreen`, и с ней замерено y = 0 и даже
 * y = -60. Оба окна её теперь получают, а `area` для этой функции — ГРАНИЦЫ
 * экрана, а не рабочая область (см. electron-main.js и
 * e2e/window-top-edge.spec.js). Сохранение центра при этом остаётся: оно нужно
 * само по себе — циферблат не должен уезжать из-под курсора при Ctrl+колесе.
 *
 * Функция чистая — на входе только прямоугольники, ни одного обращения к
 * Electron, — поэтому вся арифметика проверяется в Node без запуска приложения.
 *
 * @param {{x:number,y:number,width:number,height:number}} current — текущие границы окна
 * @param {{width:*,height:*}} requested — запрошенный размер; приходит из IPC, то есть может быть мусором
 * @param {{x:number,y:number,width:number,height:number}} workArea — рабочая область ЕГО монитора
 * @param {{width:number,height:number}} min — минимальный размер окна
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function fitScaledBounds(current, requested, workArea, min) {
    // Размер по одной оси. Мусор ИГНОРИРУЕТСЯ, а не подменяется числом: раньше
    // здесь стояло `Number(width) || 220`, и нулевая или нечисловая ширина
    // молча делала окно 220 px независимо от его базового размера.
    const sideSize = (asked, currentSide, minSide, areaSide) => {
        const value = Number(asked);
        const wanted = Number.isFinite(value) && value > 0 ? value : currentSide;
        // Минимум окна побеждает рабочую область: на мониторе уже минимума окно
        // всё равно нельзя сделать меньше.
        return Math.round(Math.max(minSide, Math.min(wanted, Math.max(minSide, areaSide))));
    };

    // Позиция по одной оси. Нижняя граница побеждает верхнюю: если окно шире
    // монитора, верхняя оказывается меньше нижней, и окно прижимается к
    // левому/верхнему краю вместо неопределённого результата.
    const sidePos = (center, size, areaStart, areaSize) => Math.round(
        Math.max(areaStart, Math.min(center - size / 2, areaStart + areaSize - size))
    );

    const width = sideSize(requested.width, current.width, min.width, workArea.width);
    const height = sideSize(requested.height, current.height, min.height, workArea.height);

    return {
        x: sidePos(current.x + current.width / 2, width, workArea.x, workArea.width),
        y: sidePos(current.y + current.height / 2, height, workArea.y, workArea.height),
        width,
        height
    };
}

/**
 * Куда поставить окно при ВОССТАНОВЛЕНИИ сохранённой позиции.
 *
 * Правило здесь мягче, чем при масштабировании, и это осознанно. Восстановление
 * тоже укладывало окно ЦЕЛИКОМ внутрь экрана — тем же fitScaledBounds. Причина
 * была: испорченный профиль (наследие масштабирования до 2.4.2, оно росло
 * вниз-вправо) оставлял на экране 12 % окна. Но одно и то же поджатие отменяло и
 * НАМЕРЕННОЕ расположение: виджет, поставленный внахлёст с краем экрана, после
 * закрытия возвращался внутрь — замерено зондом на 3440×1440: сохранено
 * x = 3470, восстановлено x = 3190.
 *
 * Свисать за край разрешено. Неотменяемым остаётся ровно одно требование: окно
 * должно остаться ухватываемым мышью, то есть сохранить видимую полосу
 * `minVisible` по КАЖДОЙ оси (для окна тоньше полосы — сколько есть). Не
 * сохранило — значит это не «свисает», а «потеряно»: такое окно поджимается
 * прежним способом, и профили, испорченные старым масштабированием, лечатся
 * по-прежнему.
 *
 * Функция чистая: на входе прямоугольники, ни одного обращения к Electron.
 *
 * @param {{x:number,y:number,width:number,height:number}} target — прямоугольник, как он сохранён
 * @param {Array<{bounds:{x:number,y:number,width:number,height:number}}>} displays — РЕАЛЬНО подключённые мониторы
 * @param {number} minVisible — сколько пикселей окна обязано остаться видимым по каждой оси
 * @param {{x:number,y:number,width:number,height:number}} fallbackArea — куда поджимать потерянное окно
 * @param {{width:number,height:number}} min — минимальный размер окна
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function fitRestoredBounds(target, displays, minVisible, fallbackArea, min) {
    const rect = {
        x: Math.round(target.x),
        y: Math.round(target.y),
        width: Math.round(target.width),
        height: Math.round(target.height)
    };

    // Перекрытие по одной оси с одним монитором.
    const overlap = (start, size, areaStart, areaSize) =>
        Math.max(0, Math.min(start + size, areaStart + areaSize) - Math.max(start, areaStart));

    // Сколько обязано быть видно по оси: полоса `minVisible`, но не больше
    // ПОЛОВИНЫ окна. Верхняя граница нужна для окон тоньше полосы — требовать
    // 64 px видимой высоты от полосы LED высотой 44 значило бы поджимать её
    // всегда, то есть запретить ей свисать в принципе.
    const need = (size) => Math.min(minVisible, Math.round(size / 2));
    const needX = need(rect.width);
    const needY = need(rect.height);

    // Монитор выбирается по ЛУЧШЕМУ перекрытию, а не по попаданию угла: окно
    // может свисать с одного экрана на соседний, и «его» экран — тот, где окна
    // больше. Проверка идёт по каждому монитору целиком: полоса, набранная на
    // двух экранах сразу, видимой полосой не считается — между ними может не
    // быть общей границы.
    const visible = (displays || []).some(({ bounds }) =>
        overlap(rect.x, rect.width, bounds.x, bounds.width) >= needX
        && overlap(rect.y, rect.height, bounds.y, bounds.height) >= needY);

    if (visible) { return rect; }

    // Потеряно — прежнее поведение: поставить в точку и поджать целиком.
    return fitScaledBounds(rect, { width: rect.width, height: rect.height }, fallbackArea, min);
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
function bindWindowDrag({ container, doc, onMove, onDrop, handlers, isLocked }) {
    let isDragging = false;
    // Первое движение ЖЕСТА помечается флагом: по нему главный процесс
    // запоминает размер окна и держит его неизменным до конца перетаскивания.
    // Иначе границу жеста определить не из чего — канал несёт только дельты.
    let isFirstMove = true;
    let dragStartX = 0;
    let dragStartY = 0;

    handlers.onContainerMouseDown = (e) => {
        // Замок «Закрепить положение» (ui-lock.js) отменяет ЖЕСТ, а не
        // возможность двигать окно вообще: панель и главный процесс двигают
        // его по-прежнему. Предикат ВНЕДРЯЕТСЯ, потому что этот модуль
        // проверяется в Node на поддельных DOM и хранилище и не должен знать
        // ни про класс на документе, ни про localStorage.
        if (typeof isLocked === 'function' && isLocked()) { return; }
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
        isFirstMove = true;
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
            onMove({ deltaX: dx, deltaY: dy, first: isFirstMove });
            isFirstMove = false;
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
    fitScaledBounds,
    fitRestoredBounds,
    MIN_SCALE_PCT,
    MAX_SCALE_PCT,
    SAVE_SETTLE_MS
};

// Node (тесты)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WindowGeometry;
}

// Браузер (рендерер) — без сборщика доступ идёт через window.X
if (typeof window !== 'undefined') {
    window.WindowGeometry = WindowGeometry;
}
