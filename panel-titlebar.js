'use strict';

/**
 * panel-titlebar.js — две кнопки титлбара, у которых одна природа: тема и
 * замок «Закрепить положение».
 *
 * Обе величины ОБЩИЕ для всех четырёх окон, обе живут в своём модуле
 * (ui-theme.js / ui-lock.js) и обе рассылаются главным процессом. Панель —
 * единственное место, откуда они меняются, и здесь ровно эта, панельная,
 * сторона: кнопка, её подпись и отправка состояния.
 *
 * Поэтому же они в ТИТЛБАРЕ, а не в ящике настроек: ящик настраивает
 * КОНКРЕТНОЕ окно (виджет, часы, дисплей), а эти две — приложение целиком.
 *
 * Почему отдельным файлом, а не десятью строками в `electron-control.html`:
 * у панели стоит храповик на размер (tests/control-decomposition), и он
 * сработал ровно на этой правке. Правило простое — самодостаточный блок
 * выносится, а не дописывается в god-файл.
 *
 * Зависимости ВНЕДРЯЮТСЯ (документ, ipc, сам модуль замка), поэтому проводка
 * проверяется на поддельных объектах в Node, без окна и без Electron.
 */

/**
 * @param {object} deps
 * @param {Document} deps.doc      документ панели
 * @param {object|null} deps.ipc   ipcRenderer (в браузере без Electron — null)
 * @param {object} deps.lock       модуль замка (window.UILock)
 * @param {string} [deps.buttonId] id кнопки
 * @returns {{ set: (locked:boolean) => void, get: () => boolean }|null}
 */
function bindLockToggle({ doc, ipc, lock, buttonId = 'lockToggle' }) {
    const button = doc && doc.getElementById ? doc.getElementById(buttonId) : null;
    if (!button || !lock) { return null; }

    const label = (locked) => (locked ? 'Открепить положение' : 'Закрепить положение');

    const sync = (locked) => {
        button.setAttribute('aria-pressed', String(locked));
        button.classList.toggle('active', locked);
        // Глиф — ВТОРОЙ признак состояния помимо цвета: индикатор, отличимый
        // только цветом, в этом проекте уже был отдельным дефектом.
        button.textContent = locked ? '🔒' : '🔓';
        button.title = label(locked);
        button.setAttribute('aria-label', label(locked));
    };

    const set = (locked) => {
        const value = !!locked;
        lock.writeLock(value);
        lock.applyLock(value);
        sync(value);
        if (ipc && typeof ipc.send === 'function') {
            ipc.send('ui-lock-update', { locked: value });
        }
    };

    sync(lock.readLock());
    button.addEventListener('click', () => set(!lock.readLock()));

    // Состояние уезжает в окна и при старте панели: окно, открытое ПОСЛЕ
    // включения замка, иначе осталось бы единственным подвижным — тот же
    // случай, что и со снимком состояния окон на did-finish-load.
    if (ipc && typeof ipc.send === 'function') {
        ipc.send('ui-lock-update', { locked: lock.readLock() });
    }

    return { set, get: () => lock.readLock() };
}

/**
 * Кнопка темы. Тот же договор, что у замка: местное применение + рассылка.
 *
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {object|null} deps.ipc
 * @param {object} deps.theme    модуль темы (window.UITheme)
 * @param {string} [deps.buttonId]
 * @returns {{ set: (theme:string) => void }|null}
 */
function bindThemeToggle({ doc, ipc, theme, buttonId = 'contrastToggle' }) {
    const button = doc && doc.getElementById ? doc.getElementById(buttonId) : null;
    if (!button || !theme) { return null; }

    const sync = (value) => {
        const isLight = value === 'light';
        button.setAttribute('aria-pressed', String(isLight));
        button.classList.toggle('active', isLight);
        button.title = theme.themeLabel(value);
        button.setAttribute('aria-label', theme.themeLabel(value));
    };

    const set = (value) => {
        theme.storeTheme(value);
        theme.applyTheme(value);
        sync(value);
        if (ipc && typeof ipc.send === 'function') {
            ipc.send('ui-theme-update', { theme: value });
        }
    };

    sync(theme.readTheme());
    button.addEventListener('click', () => set(theme.nextTheme(theme.readTheme())));
    return { set };
}

const PanelTitlebar = { bindLockToggle, bindThemeToggle };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PanelTitlebar;
}

if (typeof window !== 'undefined') {
    window.PanelTitlebar = PanelTitlebar;
}
