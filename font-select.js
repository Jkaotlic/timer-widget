'use strict';

/**
 * font-select.js — список выбора шрифта стиля «Цифры»: div.font-select
 * притворяется форм-контролем с .value.
 *
 * Вынесено из inline-скрипта electron-control.html сразу при добавлении:
 * `tests/control-decomposition.test.js` держит панель под жёстким лимитом строк
 * именно затем, чтобы новая логика не оседала внутри HTML по умолчанию — а не
 * только затем, чтобы однажды вынести уже накопившееся. Функция не знает о
 * timerController — только об элементе, который ей передали, и о реестре
 * шрифтов `window.DigitsStyle`, поэтому переиспользуется тремя списками
 * (виджет/часы/дисплей) без единой строчки, завязанной на контроллер.
 *
 * КРИТИЧНО, тот же инвариант, что у _attachSegmented (тот пока остаётся
 * в панели рядом со своим контроллером): присваивание .value НЕ порождает
 * 'change'. Событие шлёт ТОЛЬКО клик пользователя. Нарушение этого правила у
 * сегментированного контрола убило синхронизацию стиля часов целиком —
 * восстановление значения при загрузке панели уничтожало сохранённую
 * настройку.
 *
 * Нативный <select> не годится: на macOS попап рисует система, и font-family
 * на <option> не применяется — превью, ради которого контрол и нужен, просто
 * не работало бы.
 */
function attachFontSelect(el) {
    if (!el || !el.classList || !el.classList.contains('font-select')) { return; }

    const fonts = window.DigitsStyle.DIGIT_FONTS;
    el.innerHTML = '';
    for (const font of fonts) {
        const option = document.createElement('div');
        option.className = 'font-option';
        option.setAttribute('role', 'option');
        option.dataset.val = font.id;
        option.tabIndex = -1;

        const name = document.createElement('span');
        name.className = 'font-option-name';
        name.textContent = font.label;

        const sample = document.createElement('span');
        sample.className = 'font-option-sample';
        sample.textContent = '12:34';
        sample.style.fontFamily = font.family;
        sample.style.fontWeight = String(font.weight);

        option.append(name, sample);
        el.appendChild(option);
    }

    const apply = (v) => {
        const font = window.DigitsStyle.resolveFont(v);
        el.dataset.value = font.id;
        el.querySelectorAll('.font-option').forEach((o) => {
            const on = o.dataset.val === font.id;
            o.classList.toggle('active', on);
            o.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    };

    if (!Object.getOwnPropertyDescriptor(el, 'value')) {
        Object.defineProperty(el, 'value', {
            get() { return this.dataset.value || window.DigitsStyle.DEFAULT_FONT_ID; },
            set(v) { apply(v); },
            configurable: true
        });
    }

    el.querySelectorAll('.font-option').forEach((option) => {
        option.addEventListener('click', () => {
            apply(option.dataset.val);
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return; }
        e.preventDefault();
        const ids = fonts.map((f) => f.id);
        const at = ids.indexOf(el.value);
        const next = e.key === 'ArrowDown'
            ? (at + 1) % ids.length
            : (at - 1 + ids.length) % ids.length;
        apply(ids[next]);
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    apply(el.dataset.value);
}

if (typeof window !== 'undefined') {
    window.attachFontSelect = attachFontSelect;
}
