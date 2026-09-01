'use strict';

/**
 * scale-input.js — превращение подписи «120%» рядом с ползунком в поле ввода.
 *
 * Клик — ввести значение вручную, двойной клик — сброс к значению по умолчанию.
 * Задержка в 250 мс нужна, чтобы отличить одиночный клик от двойного: без неё
 * первый клик двойного успевал открыть редактор.
 *
 * Вынесено из inline-скрипта electron-control.html. Функция ничего не знает о
 * таймере — работает с парой (подпись, ползунок) и колбэком применения, поэтому
 * переиспользуется всеми четырьмя ползунками масштаба.
 */

/**
 * @param {HTMLElement} spanEl      подпись «120%»
 * @param {HTMLInputElement} sliderEl  ползунок; ЕГО `min`/`max` и есть границы
 * @param {number} defaultVal       значение двойного клика (сброс)
 * @param {(val:number)=>void} onApply
 *
 * Границы НЕ передаются отдельно: раньше их дублировали четыре вызова
 * (30/600, 30/600, 30/300, 50/600) при тех же числах в атрибутах разметки, то
 * есть у каждой границы было по два владельца, и разъехаться они могли молча —
 * ползунок пустил бы значение, которое ввод отверг бы, и наоборот.
 */
function setupScaleValueEdit(spanEl, sliderEl, defaultVal, onApply) {
    if (!spanEl || !sliderEl) { return; }
    const minVal = Number(sliderEl.min);
    const maxVal = Number(sliderEl.max);
    spanEl.className = 'scale-value-text';
    spanEl.title = 'Клик — ввести значение · Двойной клик — сброс к ' + defaultVal + '%';
    // Remove inline styles that conflict
    spanEl.style.minWidth = '';
    spanEl.style.fontSize = '';
    spanEl.style.color = '';

    let clickTimer = null;

    spanEl.addEventListener('click', (e) => {
        e.preventDefault();
        // Delay to distinguish from dblclick
        if (clickTimer) { return; }
        clickTimer = setTimeout(() => {
            clickTimer = null;
            // Enter edit mode
            const currentVal = parseInt(sliderEl.value) || defaultVal;
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'scale-value-input';
            input.value = currentVal;
            input.min = minVal;
            input.max = maxVal;
            spanEl.style.display = 'none';
            spanEl.parentNode.insertBefore(input, spanEl.nextSibling);
            input.focus();
            input.select();

            // Ввод закрывается ровно один раз — либо применением, либо отменой.
            //
            // Без этого флага Escape не был настоящей отменой: узел удалялся из
            // DOM, а браузер в зависимости от движка мог дослать blur, и тогда
            // applyValue применял отменённое значение (input.value читается и у
            // отсоединённого узла). Тот же флаг защищает от двойного применения,
            // когда blur приходит после Enter.
            let settled = false;

            const applyValue = () => {
                if (settled) { return; }
                settled = true;
                let val = parseInt(input.value);
                if (isNaN(val)) { val = defaultVal; }
                val = Math.max(minVal, Math.min(maxVal, val));
                sliderEl.value = val;
                spanEl.textContent = val + '%';
                spanEl.style.display = '';
                if (input.parentNode) { input.remove(); }
                onApply(val);
            };

            input.addEventListener('blur', applyValue);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    settled = true;
                    spanEl.style.display = '';
                    if (input.parentNode) { input.remove(); }
                }
            });
        }, 250);
    });

    spanEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        // Reset to default
        sliderEl.value = defaultVal;
        spanEl.textContent = defaultVal + '%';
        onApply(defaultVal);
    });
}

if (typeof window !== 'undefined') {
    window.setupScaleValueEdit = setupScaleValueEdit;
}
