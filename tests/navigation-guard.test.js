'use strict';

/**
 * SEC-06: навигация окон — только на четыре страницы приложения.
 * С 25.09.2026 (SEC-12) страницы живут на схеме app://timer-widget/, и file://
 * чужой целиком — даже файл из каталога приложения.
 *
 * Прежний `hardenWindow` пускал ЛЮБОЙ file://. Перетащенный на виджет HTML-файл
 * (или ссылка в нём) становился страницей окна — с preload-мостом, белым
 * списком IPC и правами file:// на чтение всего диска. Здесь проверяется сам
 * предикат (чистая функция) и обвязка webContents на подставке: что отказ
 * ставится на КАЖДОЕ событие навигации, а не только на will-navigate.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const guard = require('../navigation-guard');

const APP_DIR = path.join(__dirname, '..');
const ALLOWED = guard.appPageUrls();
const pageUrl = (page) => `app://timer-widget/${page}`;

test('четыре страницы приложения разрешены', () => {
    for (const page of guard.APP_PAGES) {
        assert.equal(guard.isAppPageUrl(pageUrl(page), ALLOWED), true, page);
    }
    assert.equal(guard.APP_PAGES.length, 4, 'страниц у приложения четыре — окно добавили мимо списка?');
});

test('хеш и query не мешают: это та же страница', () => {
    const control = pageUrl('electron-control.html');
    assert.equal(guard.isAppPageUrl(`${control}#settings`, ALLOWED), true);
    assert.equal(guard.isAppPageUrl(`${control}?x=1#y`, ALLOWED), true);
});

test('чужой file:// запрещён — даже рядом со страницами приложения', () => {
    const evil = [
        // Прежние адреса окон — теперь чужие: окно с file:// загрузил не main.
        ...guard.APP_PAGES.map((page) => pathToFileURL(path.join(APP_DIR, page)).href),
        pathToFileURL(path.join(APP_DIR, 'evil.html')).href,
        pathToFileURL(path.join(APP_DIR, 'tests', 'electron-control.html')).href,
        pathToFileURL(path.join(APP_DIR, '..', 'electron-control.html')).href,
        pathToFileURL('/etc/passwd').href,
        'file:///tmp/drop.html'
    ];
    for (const url of evil) {
        assert.equal(guard.isAppPageUrl(url, ALLOWED), false, url);
    }
});

test('чужие схемы, хосты и мусор запрещены', () => {
    for (const url of [
        'app://other/electron-control.html', 'app://timer-widget:8080/display.html',
        'app://user@timer-widget/display.html', 'app://timer-widget/evil.html',
        'app://timer-widget/storage-migration.html', 'app://timer-widget/sub/display.html',
        'https://example.com/', 'http://127.0.0.1/', 'javascript:alert(1)',
        'data:text/html,<script>1</script>', 'about:blank', 'devtools://devtools/',
        '', 'не адрес', null, undefined, 42
    ]) {
        assert.equal(guard.isAppPageUrl(url, ALLOWED), false, String(url));
    }
});

test('обход через кодирование пути не проходит', () => {
    // `%2e%2e` и двойной слэш нормализует URL-парсер; сравнивается уже
    // нормализованный адрес, поэтому «страница приложения этажом выше» — это
    // чужая страница, как бы её ни записали.
    const base = 'app://timer-widget';
    assert.equal(guard.isAppPageUrl(`${base}/sub/%2e%2e/evil.html`, ALLOWED), false);
    assert.equal(guard.isAppPageUrl(`${base}/%2e%2e/%2e%2e/display.html`, ALLOWED), true,
        'выше корня схемы не уйти: это та же страница');
    assert.equal(guard.isAppPageUrl(`${base}/sub/%2e%2e/display.html`, ALLOWED), true,
        'нормализованный путь к своей странице — та же страница');
});

// Подставка webContents: копит обработчики и умеет их вызвать.
function fakeContents() {
    const handlers = new Map();
    return {
        handlers,
        openHandler: null,
        on(event, fn) {
            if (!handlers.has(event)) { handlers.set(event, []); }
            handlers.get(event).push(fn);
        },
        setWindowOpenHandler(fn) { this.openHandler = fn; },
        fire(event, ...args) {
            for (const fn of handlers.get(event) || []) { fn(...args); }
        }
    };
}
const fakeEvent = (url) => {
    const e = { url, prevented: false };
    e.preventDefault = () => { e.prevented = true; };
    return e;
};

test('guardWebContents: чужая навигация отменяется на КАЖДОМ событии', () => {
    const c = fakeContents();
    guard.guardWebContents(c, ALLOWED);
    const evil = 'file:///tmp/drop.html';

    for (const name of ['will-navigate', 'will-redirect']) {
        const e = fakeEvent(evil);
        c.fire(name, e, evil);
        assert.equal(e.prevented, true, `${name} пропустил чужой file://`);
    }
    // will-frame-navigate передаёт адрес в event.url, без второго аргумента.
    const frame = fakeEvent(evil);
    c.fire('will-frame-navigate', frame);
    assert.equal(frame.prevented, true, 'will-frame-navigate пропустил чужой file://');
});

test('guardWebContents: своя страница проходит', () => {
    const c = fakeContents();
    guard.guardWebContents(c, ALLOWED);
    const own = pageUrl('display.html');
    const e = fakeEvent(own);
    c.fire('will-navigate', e, own);
    assert.equal(e.prevented, false);
});

test('guardWebContents: новые окна и webview запрещены', () => {
    const c = fakeContents();
    guard.guardWebContents(c, ALLOWED);
    assert.equal(typeof c.openHandler, 'function', 'нет setWindowOpenHandler');
    assert.deepEqual(c.openHandler({ url: pageUrl('display.html') }), { action: 'deny' },
        'window.open запрещён даже на свою страницу: окна открывает только main');

    const e = fakeEvent('file:///tmp/x.html');
    c.fire('will-attach-webview', e, {}, {});
    assert.equal(e.prevented, true, '<webview> обязан отвергаться');
});

test('guardWebContents: на отказ сообщает вызывающему', () => {
    // Отказ без следа в журнале — это «окно почему-то не переходит» без
    // единой зацепки. Сообщается только ИМЯ файла, а не путь (SEC-11).
    const c = fakeContents();
    const seen = [];
    guard.guardWebContents(c, ALLOWED, (kind, url) => seen.push([kind, url]));
    const evil = 'file:///tmp/drop.html';
    c.fire('will-navigate', fakeEvent(evil), evil);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], 'will-navigate');
});
