'use strict';

/**
 * modal-manager.js — открытие и закрытие модальных окон панели управления с
 * корректной доступностью: перевод фокуса внутрь, ловушка фокуса на Tab/Shift+Tab
 * и возврат фокуса туда, откуда модалку открыли.
 *
 * Вынесено из inline-скрипта electron-control.html. Модуль не знает, ЧТО за
 * модалка — работает с любым элементом, поэтому обслуживает и подтверждение
 * выхода, и FAQ, и сброс настроек.
 *
 * Кто откуда пришёл, помним в WeakMap, а не в атрибуте: элемент-источник может
 * быть удалён из DOM, и WeakMap не удержит его от сборки мусора.
 */

// Modal accessibility: initial focus + focus trap (Tab/Shift+Tab cycle)
const _modalFocusReturnMap = new WeakMap();
function _getFocusable(modal) {
    return Array.from(modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null || el === document.activeElement);
}
function _modalTrapHandler(modal) {
    return (e) => {
        if (e.key !== 'Tab') { return; }
        const focusable = _getFocusable(modal);
        if (focusable.length === 0) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
}
function openModal(modal, initialFocusEl) {
    _modalFocusReturnMap.set(modal, document.activeElement);
    modal.classList.add('show');
    const trap = _modalTrapHandler(modal);
    modal._focusTrap = trap;
    modal.addEventListener('keydown', trap);
    const target = initialFocusEl || _getFocusable(modal)[0];
    if (target) { setTimeout(() => target.focus(), 0); }
}
function closeModal(modal) {
    modal.classList.remove('show');
    if (modal._focusTrap) {
        modal.removeEventListener('keydown', modal._focusTrap);
        modal._focusTrap = null;
    }
    const prev = _modalFocusReturnMap.get(modal);
    if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch { /* ignore */ }
    }
}

if (typeof window !== 'undefined') {
    window.openModal = openModal;
    window.closeModal = closeModal;
}
