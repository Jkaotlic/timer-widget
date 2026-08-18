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
const UI_THEME_DEFAULT = 'light';
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
 * Ставит класс ТОНА ФОНА на <html>.
 *
 * Второй владелец в этом же модуле, и это не расширение обязанностей, а та же
 * обязанность. Панель следует теме напрямую: её фон принадлежит теме. У
 * виджета, часов и дисплея фон задаёт ПОЛЬЗОВАТЕЛЬ, и цвет текста там решает
 * измеренная яркость фактического фона (RendererShared.backgroundTone /
 * surfaceTone), а тема лишь выбирает фон по умолчанию. Палитру под этот класс
 * держит surface-tones.css.
 *
 * Класс висит на <html> по той же причине, что и `data-theme`: токены вида
 * `--tw-led-green: var(--tw-green)` вычисляются на :root, и палитра, объявленная
 * ниже по дереву, до них не доедет.
 *
 * @param {'light'|'dark'} tone
 * @returns {'light'|'dark'} что реально выставлено
 */
function applyTone(tone) {
    const t = tone === 'light' ? 'light' : 'dark';
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.classList.toggle('on-light-bg', t === 'light');
    }
    return t;
}

/**
 * Первое приближение тона ДО прихода настроек: своего фона окно ещё не знает,
 * значит решает тема. Вызывается из <head> рядом с initTheme(), чтобы первый
 * кадр не мигнул чужой палитрой; уточняет его окно, когда доедут цвета.
 */
function initTone() {
    return applyTone(readTheme() === 'light' ? 'light' : 'dark');
}

/**
 * Подписка на смену темы из другого окна. Слушатель — `on`, а НЕ `once`:
 * окно может быть перезагружено (bindRenderCrashHandler), и подписка обязана
 * работать снова — та же причина, по которой снимок состояния окон отправляется
 * на каждый did-finish-load.
 */
function bindThemeSync(ipc, onThemeChange) {
    if (!ipc || typeof ipc.on !== 'function') { return; }
    ipc.on('ui-theme-update', (_event, payload) => {
        const theme = applyTheme(payload && payload.theme);
        // Колбэк — для окон, чей фон теме не принадлежит: сменилась тема, а
        // значит могло смениться и то, какой фон стоит ПО УМОЛЧАНИЮ, то есть
        // тон, то есть палитра. Без него смена темы в панели меняла атрибут и
        // не меняла ни одного пикселя дисплея.
        if (typeof onThemeChange === 'function') { onThemeChange(theme); }
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
    applyTone,
    initTone,
    bindThemeSync
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UITheme;
}

if (typeof window !== 'undefined') {
    window.UITheme = UITheme;
}
