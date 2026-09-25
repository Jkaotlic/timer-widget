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
 * Сравнение — по НОРМАЛИЗОВАННОМУ адресу без хеша и query: URL-парсер сам
 * разворачивает `..`, `%2e%2e` и двойные слэши, поэтому записать чужую страницу
 * так, чтобы она совпала со своей, нельзя, а своя страница с `#якорем` остаётся
 * своей. Эталон строится тем же `pathToFileURL`, которым Chromium получает адрес
 * при `loadFile`, — две формулы одного адреса разошлись бы на пробеле или
 * кириллице в пути установки.
 *
 * Модуль чистый (без require('electron')): предикат и обвязку webContents
 * проверяет tests/navigation-guard.test.js на подставках.
 */

const path = require('path');
const { pathToFileURL } = require('url');

// Четыре окна — четыре страницы. Новое окно без строки здесь не откроется
// навигацией, но loadFile его загрузит: loadFile — не навигация страницы, и
// will-navigate на него не срабатывает. Список держит только ПЕРЕХОДЫ.
const APP_PAGES = Object.freeze([
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html'
]);

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

function appPageUrls(appDir, pages = APP_PAGES) {
    return new Set(pages.map((page) => normalize(pathToFileURL(path.join(appDir, page)).href)));
}

function isAppPageUrl(url, allowed) {
    const href = normalize(url);
    if (href === null || !href.startsWith('file:')) { return false; }
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
