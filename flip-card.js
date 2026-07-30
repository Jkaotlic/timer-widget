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
const FLIP_DURATION_MS = 300; // должно совпадать с длительностью анимации в CSS

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
    if (digit.textContent === next) { return null; }

    digit.textContent = next;
    card.classList.add(FLIP_CLASS);

    const id = setTimeout(() => {
        card.classList.remove(FLIP_CLASS);
    }, FLIP_DURATION_MS);

    if (typeof opts.onTimeout === 'function') { opts.onTimeout(id); }
    return id;
}

const FlipCard = { flipCardTo, FLIP_CLASS, FLIP_DURATION_MS };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FlipCard;
}
if (typeof window !== 'undefined') {
    window.FlipCard = FlipCard;
}
