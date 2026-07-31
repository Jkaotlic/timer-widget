// ui-theme.js — единственный владелец атрибута `data-theme` на <html>.
//
// Зачем отдельный модуль. Блоки тем в design-tokens.css существовали с самого
// начала, но атрибут `data-theme` не выставлял НИКТО: ни один файл проекта его не
// писал, `prefers-color-scheme` не использовался. Из-за этого их контраст никогда
// не настраивали и проверить его было нельзя — тема была недостижима. Теперь
// владелец атрибута ровно один, и все четыре окна используют его же.
//
// Двойной экспорт, как в utils.js / renderer-shared.js:
//   - Node (тесты):        module.exports = { ... }
//   - Renderer (браузер):  window.UITheme = { ... }
//
// Чистые функции (normalize / label) отделены от трогающих DOM и localStorage
// намеренно: первые тестируются в node без окружения браузера.

// Порядок важен: это же порядок перебора кнопкой-переключателем.
const UI_THEMES = ['dark', 'light'];
const UI_THEME_DEFAULT = 'dark';
// Ключ обязан быть в CONFIG.STORAGE_KEYS.UI_THEME — tests/storage-keys.test.js
// проверяет реестр в обе стороны и падает на ключе, которого там нет.
const UI_THEME_STORAGE_KEY = 'uiTheme';

/**
 * Приводит любое значение к известной теме. Неизвестное — не ошибка, а «тема по
 * умолчанию»: в localStorage может лежать что угодно из прошлых версий.
 * @param {*} value
 * @returns {'dark'|'light'}
 */
function normalizeTheme(value) {
    return UI_THEMES.indexOf(String(value)) === -1 ? UI_THEME_DEFAULT : String(value);
}

/**
 * Следующая тема по кругу — поведение кнопки-переключателя.
 * @param {*} current
 * @returns {'dark'|'light'}
 */
function nextTheme(current) {
    const i = UI_THEMES.indexOf(normalizeTheme(current));
    return UI_THEMES[(i + 1) % UI_THEMES.length];
}

/** Человеческая подпись для title/aria-label кнопки. */
function themeLabel(theme) {
    return normalizeTheme(theme) === 'light' ? 'Светлая тема' : 'Тёмная тема';
}

// --- Всё ниже трогает DOM/localStorage и в тестах не вызывается ---

/** Читает сохранённую тему. Приватный режим/квота — не повод падать. */
function readTheme() {
    try {
        return normalizeTheme(window.localStorage.getItem(UI_THEME_STORAGE_KEY));
    } catch {
        return UI_THEME_DEFAULT;
    }
}

/** Пишет тему. Возвращает то, что реально записано (после нормализации). */
function storeTheme(theme) {
    const t = normalizeTheme(theme);
    try {
        window.localStorage.setItem(UI_THEME_STORAGE_KEY, t);
    } catch { /* переполненная квота не должна ломать переключение */ }
    return t;
}

/**
 * Выставляет атрибут. Пишется ВСЕГДА, включая 'dark': тогда в DevTools и в
 * тестах видно фактическое состояние, а не «атрибута нет — значит, наверное,
 * тёмная». Селектор `:root, [data-theme="dark"]` покрывает оба случая.
 */
function applyTheme(theme) {
    const t = normalizeTheme(theme);
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute('data-theme', t);
    }
    return t;
}

/** Применяет сохранённую тему как можно раньше — до первого кадра. */
function initTheme() {
    return applyTheme(readTheme());
}

/**
 * Подписка на смену темы из другого окна. Слушатель — `on`, а НЕ `once`:
 * окно может быть перезагружено (bindRenderCrashHandler), и подписка обязана
 * работать снова — та же причина, по которой снимок состояния окон отправляется
 * на каждый did-finish-load.
 */
function bindThemeSync(ipc) {
    if (!ipc || typeof ipc.on !== 'function') { return; }
    ipc.on('ui-theme-update', (_event, payload) => {
        applyTheme(payload && payload.theme);
    });
}

const UITheme = {
    UI_THEMES,
    UI_THEME_DEFAULT,
    UI_THEME_STORAGE_KEY,
    normalizeTheme,
    nextTheme,
    themeLabel,
    readTheme,
    storeTheme,
    applyTheme,
    initTheme,
    bindThemeSync
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UITheme;
}

if (typeof window !== 'undefined') {
    window.UITheme = UITheme;
}
