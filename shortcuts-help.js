'use strict';

/**
 * shortcuts-help.js — оверлей со списком горячих клавиш (F1).
 *
 * Вынесено из inline-скрипта electron-control.html.
 *
 * ВАЖНО: список в этом файле обязан совпадать с реальным обработчиком
 * _onGlobalShortcutsKeydown в electron-control.html. Он уже расходился —
 * справка обещала «1-5 — пресеты (1, 5, 10, 15, 30 мин)», когда обработчик
 * слушал Digit1..Digit8 и раскладывал 5..60 минут. Это проверяется тестом
 * в tests/audit-2026-07-fixes.test.js.
 */

// Show keyboard shortcuts help
function showKeyboardShortcuts() {
    // Prevent stacking multiple overlays. Повторный F1 = закрыть.
    //
    // Раньше здесь стоял голый existing.remove(), и document-слушатель Escape
    // этого оверлея оставался висеть: каждый цикл F1→F1 добавлял ещё один мёртвый
    // слушатель, ссылающийся на уже удалённый узел. Убирались они только при
    // следующем нажатии Escape (тогда каждый снимал сам себя).
    const existing = document.getElementById('keyboard-shortcuts-overlay');
    if (existing) {
        if (typeof existing._closeOverlay === 'function') { existing._closeOverlay(); }
        else { existing.remove(); }
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'keyboard-shortcuts-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'keyboard-shortcuts-title');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0;' +
        'background: rgba(0,0,0,0.7); display: flex; align-items: center;' +
        'justify-content: center; z-index: 10000;';

    // Centralized teardown: remove overlay AND its document keydown listener
    const closeOverlay = () => {
        overlay.remove();
        document.removeEventListener('keydown', _onOverlayKey);
    };
    // Отдаём закрытие наружу, чтобы повторный вызов showKeyboardShortcuts()
    // (второй F1) снял и узел, и слушатель, а не только узел.
    overlay._closeOverlay = closeOverlay;

    // Тёмное стекло в тон остальному приложению — раньше эта панель
    // была белой и била по глазам поверх тёмного UI.
    const panel = document.createElement('div');
    panel.style.cssText = 'background: rgba(28, 28, 30, 0.96); padding: 22px 24px;' +
        'border-radius: 18px; max-width: 420px; border: 1px solid rgba(255,255,255,0.12);' +
        'backdrop-filter: blur(40px) saturate(180%);';

    const title = document.createElement('h3');
    title.id = 'keyboard-shortcuts-title';
    title.style.cssText = 'margin: 0 0 14px; color: rgba(255,255,255,0.95); font-weight: 500;';
    title.textContent = '⌨️ Горячие клавиши';
    panel.appendChild(title);

    const list = document.createElement('div');
    list.style.cssText = 'color: rgba(255,255,255,0.72); line-height: 1.9; font-size: 13px;';
    // Список обязан совпадать с _onGlobalShortcutsKeydown выше.
    const items = [
        ['Space', 'Старт / пауза таймера'],
        ['R', 'Сброс таймера'],
        ['S', 'Остановить таймер'],
        ['W', 'Виджет таймера (открыть/закрыть)'],
        ['C', 'Виджет часов (открыть/закрыть)'],
        ['D', 'Полноэкранный дисплей (открыть/закрыть)'],
        ['M', 'Свернуть окно в полосу и развернуть обратно'],
        ['Z', 'Звук включить / выключить'],
        ['1—4', 'Пресеты: 5, 15, 25, 45 мин'],
        ['5', 'Своё время'],
        ['Ctrl + колесо', 'Масштаб виджета / часов / дисплея'],
        ['Esc', 'Закрыть настройки, модалку или справку'],
        ['F1', 'Показать эту справку']
    ];
    items.forEach(([key, desc]) => {
        const b = document.createElement('b');
        b.style.cssText = 'color: rgba(255,255,255,0.95);';
        b.textContent = key;
        list.appendChild(b);
        list.appendChild(document.createTextNode(' — ' + desc));
        list.appendChild(document.createElement('br'));
    });
    panel.appendChild(list);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Закрыть';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.style.cssText = 'margin-top: 18px; padding: 9px 22px; background: #0a84ff;' +
        'color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 13px;';
    closeBtn.addEventListener('click', () => closeOverlay());
    panel.appendChild(closeBtn);

    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { closeOverlay(); }
    });
    const _onOverlayKey = (e) => {
        if (e.key === 'Escape') {
            closeOverlay();
        }
    };
    document.addEventListener('keydown', _onOverlayKey);
    document.body.appendChild(overlay);
    setTimeout(() => closeBtn.focus(), 0);
}

/*
 * Ворота глобальных клавиш панели: КОГДА клавиша принадлежит не таймеру, а
 * слою под ней. Здесь, а не в обработчике control-app.js, потому что это
 * правило о клавишах, которые этот файл и перечисляет, и потому что его можно
 * проверить в Node (tests/panel-hotkeys.test.js).
 */
// Поля, в которых буквы и пробел — ввод. SELECT здесь же: пробел его
// открывает, буква листает по первой букве.
const HOTKEY_TEXT_ENTRY = 'input, textarea, select';
// Что активируется ПРОБЕЛОМ само. Буквы такие элементы не потребляют.
const HOTKEY_SPACE_CONTROLS = 'button, summary, a[href], [role="button"], [role="radio"], '
    + '[role="checkbox"], [role="switch"], [role="tab"], [role="option"], .font-select';
// Открытый слой поверх панели: модалки (класс show) и справка F1.
const HOTKEY_OPEN_LAYERS = '[role="dialog"][aria-modal="true"].show, #keyboard-shortcuts-overlay';

/**
 * @param {KeyboardEvent} event
 * @param {Document} doc
 * @param {Element|null} pointerControl контрол, по которому последним кликнули
 *        мышью и который с тех пор держит фокус (см. trackPointerControl)
 * @returns {boolean} true — глобальной клавише здесь делать нечего
 */
function globalHotkeyBlocked(event, doc, pointerControl) {
    // Автоповтор удержанной клавиши — не новая команда: Space слал start/pause
    // на каждом повторе, пока состояние ехало по IPC.
    if (event.repeat) { return true; }
    const target = event.target && typeof event.target.closest === 'function' ? event.target : null;
    if (target && (target.isContentEditable || target.closest(HOTKEY_TEXT_ENTRY))) { return true; }
    // За открытым диалогом таймер не трогают. F1 — переключатель самой
    // справки, он обязан её и закрывать.
    if (event.code !== 'F1' && doc && doc.querySelector(HOTKEY_OPEN_LAYERS)) { return true; }
    if (event.code === 'Space' && target) {
        const control = target.closest(HOTKEY_SPACE_CONTROLS);
        // Кнопка, до которой дошли С КЛАВИАТУРЫ, нажимается пробелом сама.
        // Кнопка, по которой только что кликнули мышью, — нет: «кликнул пресет,
        // нажал пробел — пошёл отсчёт» работало всегда.
        if (control && control !== pointerControl) { return true; }
    }
    return false;
}

/**
 * Помнит контрол, по которому кликнули мышью, пока фокус на нём. Любой другой
 * переход фокуса (Tab, программный focus модалки) это забывает.
 *
 * @param {Document} doc
 * @returns {() => Element|null}
 */
function trackPointerControl(doc) {
    let last = null;
    doc.addEventListener('pointerdown', (e) => {
        last = e.target && typeof e.target.closest === 'function'
            ? e.target.closest(HOTKEY_SPACE_CONTROLS)
            : null;
    }, true);
    doc.addEventListener('focusin', (e) => {
        if (last && e.target !== last) { last = null; }
    }, true);
    return () => last;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { globalHotkeyBlocked, trackPointerControl, HOTKEY_OPEN_LAYERS };
}

if (typeof window !== 'undefined') {
    window.showKeyboardShortcuts = showKeyboardShortcuts;
    window.globalHotkeyBlocked = globalHotkeyBlocked;
    window.trackPointerControl = trackPointerControl;
}
