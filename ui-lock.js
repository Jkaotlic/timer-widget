'use strict';

/**
 * ui-lock.js — «Закрепить положение»: один переключатель на всё приложение.
 *
 * Зачем. Композиция полноэкранного окна собирается руками — карточки таскаются
 * с Alt, масштабируются Ctrl+колесом, виджет и часы двигаются мышью. Ровно те
 * же жесты случаются НЕЧАЯННО во время мероприятия: задел мышью, крутанул
 * колесо над окном — и настроенный кадр уехал на глазах у зала. Просьба
 * 19.08.2026: «введём настройку закрепления положения всего, когда всё
 * настроил, чтобы случайно что-то не сдвинуть».
 *
 * Замок ЗАПРЕЩАЕТ ЖЕСТЫ, а не настройки: панель продолжает менять что угодно,
 * потому что это осознанное действие в своём окне. Запрещается только то, что
 * можно сделать мимоходом — перетаскивание, масштабирование колесом и крестик
 * на карточке.
 *
 * Устройство скопировано с ui-theme.js, и это не совпадение: обе величины
 * общие для всех окон, живут в localStorage, ставятся панелью и рассылаются
 * главным процессом ВСЕМ окнам. Разница одна: тема красит, замок запрещает.
 *
 * Двойной экспорт: Node (тесты) — module.exports, браузер — window.UILock.
 */

const UI_LOCK_STORAGE_KEY = 'uiLocked';

/** Класс на <html>: по нему CSS прячет крестики и подсветку перетаскивания. */
const UI_LOCK_CLASS = 'ui-locked';

function safeStorage(storage) {
    if (storage) { return storage; }
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

/**
 * Прочитать состояние замка.
 *
 * Значение по умолчанию — ОТКРЫТО: пустой профиль обязан позволять настраивать,
 * иначе первый же жест пользователя не сработает без всякого объяснения.
 */
function readLock(storage) {
    const store = safeStorage(storage);
    if (!store) { return false; }
    try {
        return store.getItem(UI_LOCK_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function writeLock(locked, storage) {
    const store = safeStorage(storage);
    if (!store) { return !!locked; }
    try {
        store.setItem(UI_LOCK_STORAGE_KEY, locked ? '1' : '0');
    } catch { /* переполненное хранилище не должно ломать переключатель */ }
    return !!locked;
}

/**
 * Повесить (или снять) класс замка на документ.
 *
 * Класс на `<html>`, а не на `<body>`: то же правило, что у тона палитры —
 * `<body>` в полноэкранном окне носит классы стиля, и смешивать в нём
 * состояния разной природы уже приводило к тому, что одно перетирало другое.
 *
 * @returns {boolean} что реально выставлено
 */
function applyLock(locked) {
    const on = !!locked;
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.classList.toggle(UI_LOCK_CLASS, on);
    }
    return on;
}

/** Состояние замка ПО ДОКУМЕНТУ: то, что видит обработчик жеста. */
function isLocked() {
    if (typeof document === 'undefined' || !document.documentElement) { return false; }
    return document.documentElement.classList.contains(UI_LOCK_CLASS);
}

/** Первое применение до первого кадра — рядом с initTheme() в <head>. */
function initLock(storage) {
    return applyLock(readLock(storage));
}

/**
 * Подписка на смену замка из другого окна. `on`, а не `once`: окно может быть
 * перезагружено, и подписка обязана пережить перезагрузку — та же причина, что
 * у bindThemeSync.
 */
function bindLockSync(ipc, onChange) {
    if (!ipc || typeof ipc.on !== 'function') { return; }
    ipc.on('ui-lock-update', (_event, payload) => {
        const locked = applyLock(!!(payload && payload.locked));
        writeLock(locked);
        if (typeof onChange === 'function') { onChange(locked); }
    });
}

const UILock = {
    UI_LOCK_STORAGE_KEY,
    UI_LOCK_CLASS,
    readLock,
    writeLock,
    applyLock,
    isLocked,
    initLock,
    bindLockSync
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UILock;
}

if (typeof window !== 'undefined') {
    window.UILock = UILock;
}
