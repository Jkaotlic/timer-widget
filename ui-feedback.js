'use strict';

/**
 * ui-feedback.js — обратная связь для пользователя в окне управления:
 * всплывающие уведомления (Toast) и индикатор загрузки (LoadingIndicator).
 *
 * Вынесено из inline-скрипта electron-control.html. Обе штуки не знают ни о
 * таймере, ни о настройках — только создают и убирают DOM-узлы, поэтому держать
 * их внутри god-файла не было причин.
 *
 * Экспорт в window: остальной код панели зовёт Toast.show(...) и
 * LoadingIndicator.show(...) по этим именам, как и раньше.
 */

// FIX BUG-028: Loading indicator utilities
const LoadingIndicator = {
    /**
     * Show fullscreen loading overlay
     * @param {string} message - Loading message to display
     * @returns {HTMLElement} - Overlay element (to remove later)
     */
    show(message = 'Загрузка...') {
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        // Используем escapeHTML для защиты от XSS
        const safeMessage = window.SecurityUtils && window.SecurityUtils.escapeHTML 
            ? window.SecurityUtils.escapeHTML(message) 
            : message.replace(/[&<>"'/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;'})[c]);
        overlay.innerHTML = `
            <div style="text-align: center;">
                <div class="loading-spinner"></div>
                <div class="loading-text">${safeMessage}</div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    },

    /**
     * Hide loading overlay
     * @param {HTMLElement} overlay - Overlay element to remove
     */
    hide(overlay) {
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    },

    /**
     * Show inline loading indicator in a button
     * @param {HTMLElement} button - Button element
     * @returns {HTMLElement} - Loader element
     */
    showInline(button) {
        if (!button) {return null;}

        button.disabled = true;
        button.classList.add('loading-button');

        const loader = document.createElement('span');
        loader.className = 'inline-loader';
        button.appendChild(loader);

        return loader;
    },

    /**
     * Hide inline loading indicator
     * @param {HTMLElement} button - Button element
     * @param {HTMLElement} loader - Loader element to remove
     */
    hideInline(button, loader) {
        if (!button) {return;}

        button.disabled = false;
        button.classList.remove('loading-button');

        if (loader && loader.parentNode) {
            loader.parentNode.removeChild(loader);
        }
    }
};

// Toast notification system (replaces alert dialogs)
const Toast = {
    _container: null,
    _getContainer() {
        if (!this._container) {
            this._container = document.createElement('div');
            this._container.className = 'toast-container';
            document.body.appendChild(this._container);
        }
        return this._container;
    },
    show(message, type = 'error', duration = 3500) {
        const container = this._getContainer();
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
};

if (typeof window !== 'undefined') {
    window.Toast = Toast;
    window.LoadingIndicator = LoadingIndicator;
}
