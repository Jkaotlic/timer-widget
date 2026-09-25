'use strict';

/**
 * navigation-guard.js — куда окну приложения МОЖНО перейти (SEC-06).
 *
 * Ответ: только на одну из четырёх собственных страниц. Прежний `hardenWindow`
 * пускал любой `file://`, и этого хватало для атаки без единой уязвимости в
 * коде: HTML-файл, перетащенный на виджет (или ссылка в таком файле), становился
 * страницей окна — с preload-мостом, белым списком IPC и правом file:// читать
 * весь диск. «Не http» — не то же самое, что «наше».
 *
 * С 25.09.2026 окна живут на своей схеме `app://timer-widget/…` (app-scheme.js,
 * SEC-12), и «своя страница» — это адрес этой схемы. file:// теперь чужой
 * ЦЕЛИКОМ, включая файлы из каталога приложения: окно с file:// — это окно,
 * которое загрузил кто-то другой.
 *
 * Сравнение — по НОРМАЛИЗОВАННОМУ адресу без хеша и query: URL-парсер сам
 * разворачивает `..`, `%2e%2e` и двойные слэши, поэтому записать чужую страницу
 * так, чтобы она совпала со своей, нельзя, а своя страница с `#якорем` остаётся
 * своей. Эталон строится той же `pageUrl`, которой main-windows.js грузит окна.
 *
 * Модуль чистый (без require('electron')): предикат и обвязку webContents
 * проверяет tests/navigation-guard.test.js на подставках.
 */

const AppScheme = require('./app-scheme');

// Четыре окна — четыре страницы. Новое окно без строки здесь не откроется
// навигацией, но loadURL его загрузит: loadURL — не навигация страницы, и
// will-navigate на него не срабатывает. Список держит только ПЕРЕХОДЫ.
// Страница миграции хранилища сюда НЕ входит: у её окна нет моста, и
// переходить на неё окну незачем.
const APP_PAGES = AppScheme.WINDOW_PAGES;

// Адрес без хеша и query в нормализованной форме, или null для мусора.
function normalize(url) {
    if (typeof url !== 'string' || url === '') { return null; }
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed.href;
}

function appPageUrls(pages = APP_PAGES) {
    return new Set(pages.map((page) => normalize(AppScheme.pageUrl(page))));
}

function isAppPageUrl(url, allowed) {
    const href = normalize(url);
    if (href === null || !href.startsWith(`${AppScheme.ORIGIN}/`)) { return false; }
    return allowed.has(href);
}

/**
 * Вешает запреты на webContents: навигация (сама страница, редирект,
 * субфрейм) — только на свои страницы; window.open и <webview> — никогда.
 *
 * `onBlocked(kind, url)` — чтобы отказ оставил след в журнале: иначе «окно
 * почему-то не переходит» не имеет ни одной зацепки. Что писать, решает
 * вызывающий (полный путь в журнал не нужен — SEC-11).
 */
function guardWebContents(contents, allowed, onBlocked = () => {}) {
    const check = (kind) => (event, url) => {
        // will-frame-navigate передаёт адрес в event.url, без второго аргумента.
        const target = url !== undefined ? url : event && event.url;
        if (!isAppPageUrl(target, allowed)) {
            event.preventDefault();
            onBlocked(kind, target);
        }
    };
    contents.on('will-navigate', check('will-navigate'));
    contents.on('will-redirect', check('will-redirect'));
    contents.on('will-frame-navigate', check('will-frame-navigate'));
    // Окна открывает только главный процесс, своими create-функциями
    // (CLAUDE.md: у открытия окна ОДИН владелец). window.open из рендерера —
    // всегда отказ, даже на свою страницу.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // <webview> в окнах нет и не будет (webviewTag по умолчанию выключен);
    // отказ здесь — на случай, если его включат, не подумав о последствиях.
    contents.on('will-attach-webview', (event) => {
        event.preventDefault();
        onBlocked('will-attach-webview', null);
    });
}

// Что сказать в журнал об отвергнутом адресе: схема и последний сегмент пути.
// Полный путь file:// — это домашний каталог и имя учётной записи.
// (Чужой адрес бывает и file://, поэтому правило осталось и после app://.)
function describeUrl(url) {
    if (typeof url !== 'string') { return String(url); }
    try {
        const parsed = new URL(url);
        const name = parsed.pathname.split('/').filter(Boolean).pop() || '';
        return `${parsed.protocol}…/${name}`;
    } catch {
        return '(не адрес)';
    }
}

module.exports = { APP_PAGES, appPageUrls, isAppPageUrl, guardWebContents, describeUrl };
