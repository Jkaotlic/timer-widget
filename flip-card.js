'use strict';

/**
 * flip-card.js — перекидывание цифры на «часах-перекидышах».
 *
 * Анимация была только в полноэкранном режиме: виджет таймера и виджет часов
 * просто присваивали textContent, и карточки менялись рывком. Здесь одна
 * реализация на все три окна — три копии этой логики уже однажды разъехались
 * (см. аудит 2026-07-29), повторять не будем.
 *
 * Ключевое правило: анимация запускается ТОЛЬКО когда цифра реально изменилась.
 * Секунды тикают раз в секунду, но минуты и часы стоят на месте — если дёргать
 * все карточки на каждый тик, «перекидывается» всё табло сразу, и эффект из
 * приятного превращается в мельтешение.
 *
 * Класс снимается по таймеру, а не по событию animationend: элемент может быть
 * скрыт сменой стиля прямо во время анимации, и тогда событие не придёт вовсе —
 * карточка навсегда осталась бы с классом и не анимировалась бы больше никогда.
 * Идентификатор таймера возвращается наружу, чтобы окно могло очистить его при
 * закрытии (в display-script.js для этого есть общий список _timeouts).
 *
 * Плавность выключается через prefers-reduced-motion в CSS каждого окна — здесь
 * только навешивание класса.
 */

const FLIP_CLASS = 'flipping';
// Две фазы разной длины: створка падает 200 мс с разгоном, затем 240 мс встаёт
// следующая — с проскоком за упор и возвратом. Разными они стали 14.08.2026:
// одинаковые 180 + 180 с жёсткой передачей эстафеты читались как рывок.
// Должно покрывать сумму длительностей в flip-card.css — по этому времени
// снимаются слои, и если разъедется, движение оборвётся на полукадре.
const FLIP_DURATION_MS = 460;
const FLIP_LAYERS_CLASS = 'fc-flip';

// Незавершённые таймеры снятия класса. Модуль ведёт их САМ и вычёркивает каждый
// по срабатыванию, поэтому набор всегда размером с число одновременно
// перекидывающихся карточек (единицы), а не с числом прошедших секунд.
//
// Раньше учёт был снаружи: окна складывали id в свои массивы (_flipTimeouts /
// _timeouts) и очищали их только при закрытии. Секунды тикают ежесекундно, так
// что за час презентации в массиве оседало несколько тысяч уже сработавших id —
// неограниченный рост, а в cleanup() потом впустую вызывался clearTimeout на
// мёртвых идентификаторах.
const _pending = new Set();

/**
 * Строит три временных слоя перекидыша поверх статичной цифры.
 *
 * Цифры не рисуются заново: каждый слой получает КЛОН существующего узла, то
 * есть автоматически те же шрифт, кегль, цвет и тень, что в этом окне. Три
 * окна отличаются размерами карточек и начертанием, и любая попытка описать
 * эти значения здесь была бы четвёртой копией того, что уже есть в CSS.
 *
 * Геометрия — в flip-card.css: слой обрезает половину карточки, а лежащая в
 * нём `.fc-face` вдвое выше слоя и прижата к его краю, поэтому глиф стоит
 * ровно там же, где в статичной карточке.
 *
 * @param {HTMLElement} digit — узел цифры (уже с НОВЫМ значением)
 * @param {string} prev — прежняя цифра
 * @param {string} next — новая цифра
 * @returns {HTMLElement|null} контейнер слоёв (его снимает вызывающий) или null
 */
function buildFlipLayers(digit, prev, next) {
    const host = digit.parentNode;
    if (!host || typeof document === 'undefined' || !document.createElement) { return null; }

    // «Меньше движения» — движения нет вовсе: слои не строятся, цифра просто
    // сменилась. Гасить их анимацию в CSS недостаточно, иначе на экране на
    // 380 мс зависал бы неподвижный слой со СТАРОЙ цифрой.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return null;
    }

    const stale = host.querySelector('.' + FLIP_LAYERS_CLASS);
    if (stale) { host.removeChild(stale); }

    const layer = (classes, text) => {
        const box = document.createElement('div');
        box.className = 'fc-layer ' + classes;
        const face = document.createElement('div');
        face.className = 'fc-face';
        const copy = digit.cloneNode(true);
        copy.textContent = text;
        copy.removeAttribute('id');
        face.appendChild(copy);
        box.appendChild(face);
        return box;
    };

    const wrap = document.createElement('div');
    wrap.className = FLIP_LAYERS_CLASS;
    wrap.setAttribute('aria-hidden', 'true');
    // Порядок = порядок наложения, снизу вверх. Слоёв ЧЕТЫРЕ: контейнер
    // непрозрачен и закрывает собой статичную цифру карточки, поэтому все
    // четыре половины табло обязаны быть представлены здесь.
    //
    // 1. НОВАЯ верхняя — та, что открывается из-под падающей створки. Её
    //    когда-то не было: пока слои были прозрачны, сквозь них просвечивала
    //    статичная цифра карточки и играла эту роль сама. Как только слои
    //    стали непрозрачными, из-под упавшей створки открылся ФОН карточки —
    //    «при перелистывании верхняя часть цифры тёмная».
    wrap.appendChild(layer('fc-top fc-static', next));
    // 2. СТАРАЯ нижняя — держит низ, пока не приедет поднимающаяся створка.
    wrap.appendChild(layer('fc-bottom fc-static', prev));
    // 3. СТАРАЯ верхняя — падает, открывая слой 1.
    wrap.appendChild(layer('fc-top fc-leaf-top', prev));
    // 4. НОВАЯ нижняя — поднимается, закрывая слой 2.
    wrap.appendChild(layer('fc-bottom fc-leaf-bottom', next));
    host.appendChild(wrap);
    return wrap;
}

/**
 * Ставит цифру в карточку и, если значение изменилось, запускает перекидывание.
 *
 * @param {HTMLElement} card — карточка (.flip-card / .widget-flip-card)
 * @param {string} digitSelector — селектор узла с цифрой внутри карточки
 * @param {string|number} value — новое значение
 * @param {{onTimeout?: (id:number)=>void}} [opts] — колбэк для учёта таймера
 * @returns {number|null} id таймера снятия класса или null, если ничего не менялось
 */
function flipCardTo(card, digitSelector, value, opts = {}) {
    if (!card) { return null; }
    const digit = card.querySelector(digitSelector);
    if (!digit) { return null; }

    const next = String(value);
    const prev = digit.textContent;
    if (prev === next) { return null; }

    // Статичная цифра становится новой СРАЗУ — она то, что останется на
    // карточке после снятия слоёв. Во время движения её не видно вовсе:
    // контейнер слоёв непрозрачен и закрывает её целиком, а обе половины
    // табло рисуют слои (см. buildFlipLayers).
    digit.textContent = next;
    const layers = buildFlipLayers(digit, prev, next);
    card.classList.add(FLIP_CLASS);

    const id = setTimeout(() => {
        _pending.delete(id);
        card.classList.remove(FLIP_CLASS);
        if (layers && layers.parentNode) { layers.parentNode.removeChild(layers); }
    }, FLIP_DURATION_MS);
    _pending.add(id);

    if (typeof opts.onTimeout === 'function') { opts.onTimeout(id); }
    return id;
}

/**
 * Гасит все незавершённые таймеры снятия класса. Зовётся окном при закрытии
 * (beforeunload → cleanup), чтобы не оставить висящих таймеров.
 *
 * @returns {number} сколько таймеров было погашено
 */
function cancelPending() {
    const count = _pending.size;
    for (const id of _pending) { clearTimeout(id); }
    _pending.clear();
    return count;
}

const FlipCard = { flipCardTo, cancelPending, FLIP_CLASS, FLIP_DURATION_MS, FLIP_LAYERS_CLASS };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FlipCard;
}
if (typeof window !== 'undefined') {
    window.FlipCard = FlipCard;
}
