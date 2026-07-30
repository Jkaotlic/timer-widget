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
        ['1—8', 'Пресеты: 5, 10, 15, 20, 25, 30, 45, 60 мин'],
        ['Ctrl + колесо', 'Масштаб виджета / часов / дисплея'],
        ['Esc', 'Закрыть настройки, затем все окна'],
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

if (typeof window !== 'undefined') {
    window.showKeyboardShortcuts = showKeyboardShortcuts;
}
