'use strict';

/**
 * app-scheme.js — своя схема окон `app://timer-widget/…` (SEC-12).
 *
 * До 25.09.2026 окна грузились с file://. Это держало включённым фьюз
 * `grantFileProtocolExtraPrivileges`: без него у file:// непрозрачный origin, и
 * localStorage бросает «Access is denied for this document». А с ним страница
 * file:// — привилегированная: читает соседние файлы диска, и любой HTML,
 * оказавшийся в окне, получает то же.
 *
 * Здесь — ЧИСТАЯ часть схемы: какой адрес во что превращается, что
 * отвергается, какие заголовки уходят с ответом. Регистрацию в Electron и
 * чтение файла делает main-app-protocol.js; этот модуль electron не требует,
 * его проверяет tests/app-scheme.test.js, а csp-guard.js берёт отсюда политику.
 *
 * Что отдаётся (список, а не каталог):
 *   - четыре страницы окон и страница миграции хранилища;
 *   - то, что эти страницы подключают (`<script src>`, `<link href>`) — список
 *     собирается из самой разметки, поэтому новый модуль окна не нужно
 *     вписывать в третье место: хватит подключить его и упаковать;
 *   - плоские файлы каталогов ассетов (`fonts/`, `sounds/`) с их расширениями.
 * Главный процесс, preload.js и package.json ни одна страница не подключает —
 * схема их не отдаёт.
 */

const path = require('path');

const SCHEME = 'app';
const HOST = 'timer-widget';
const ORIGIN = `${SCHEME}://${HOST}`;

// Регистрация схемы (до `ready`). standard — настоящий origin: localStorage и
// относительные адреса работают как у http. secure — безопасный контекст.
// supportFetchAPI / corsEnabled / stream НЕ даны: окнам запрещён connect-src,
// звуки — осцилляторы и data-URL, шрифты — того же origin.
const PRIVILEGED_SCHEME = Object.freeze({
    scheme: SCHEME,
    privileges: Object.freeze({ standard: true, secure: true })
});

const WINDOW_PAGES = Object.freeze([
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html'
]);

// Пустая страница без скриптов: на ней main-storage-migration.js читает старое
// хранилище (file://) и пишет новое (app://).
const MIGRATION_PAGE = 'storage-migration.html';

// Content-Security-Policy окон. ОДНА строка на meta в разметке (её сверяет и
// переписывает scripts/csp-guard.js) и на заголовок ответа схемы. Почему
// каждая директива такая — в csp-guard.js.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'"
].join('; ');

const MIME_TYPES = Object.freeze({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg'
});

// Каталоги ассетов → расширения, которые из них отдаются. Только плоские
// имена: подкаталогов нет, и шаблон в build.files их не обещает окнам.
const ASSET_DIRS = Object.freeze({
    fonts: Object.freeze(['.woff2', '.woff', '.ttf', '.otf']),
    sounds: Object.freeze(['.wav', '.mp3', '.ogg'])
});

// Имя файла: латиница, цифры, точка, дефис, подчёркивание; не с точки.
// Всё остальное — `..`, слэши, обратные слэши, `:`, `%`, NUL, пробелы —
// отвергается ДО сравнения со списком.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function pageUrl(page) {
    if (!WINDOW_PAGES.includes(page) && page !== MIGRATION_PAGE) {
        throw new Error(`app-scheme: «${page}» — не страница приложения`);
    }
    return `${ORIGIN}/${page}`;
}

// Ссылки страницы на свои файлы: `<script src>` и `<link href>`. Берутся только
// плоские относительные имена; внешние адреса, data: и `../` в список не идут
// (CSP их и так не пустит, а список — это то, что схема ОТДАЁТ).
const REF_RE = /<(?:script|link)\b[^>]*?\s(?:src|href)\s*=\s*"([^"]*)"/gi;

/**
 * Разрешённые к выдаче файлы корня: страницы и всё, что они подключают.
 * @param {(rel: string) => string} readText — текст файла по относительному пути
 * @returns {Set<string>}
 */
function collectWebFiles(readText) {
    const allowed = new Set();
    for (const page of [...WINDOW_PAGES, MIGRATION_PAGE]) {
        allowed.add(page);
        const html = readText(page) || '';
        for (const m of html.matchAll(REF_RE)) {
            const ref = m[1];
            if (SAFE_NAME.test(ref) && Object.prototype.hasOwnProperty.call(MIME_TYPES, path.posix.extname(ref))) {
                allowed.add(ref);
            }
        }
    }
    return allowed;
}

const reject = (status, reason) => ({ ok: false, status, reason });

/**
 * Адрес запроса → файл приложения или отказ.
 *
 * @param {string} url — request.url, как его передал Chromium
 * @param {Set<string>} allowed — collectWebFiles()
 * @returns {{ok: true, relPath: string, mime: string, isHtml: boolean}
 *          | {ok: false, status: number, reason: string}}
 */
function resolveAppRequest(url, allowed) {
    if (typeof url !== 'string' || url === '') { return reject(400, 'не адрес'); }
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return reject(400, 'не адрес');
    }
    if (parsed.protocol !== `${SCHEME}:`) { return reject(403, 'чужая схема'); }
    if (parsed.hostname !== HOST || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
        return reject(403, 'чужой хост');
    }

    // Путь без ведущего слэша. Парсер уже развернул `.`/`..` и `%2e%2e`;
    // декодирование — один раз, и после него снова проверяется каждый сегмент:
    // `%2f`, `%5c`, `%00`, двойное кодирование упираются в SAFE_NAME.
    let rel;
    try {
        rel = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    } catch {
        return reject(400, 'битое кодирование');
    }
    const segments = rel.split('/');
    if (rel === '' || segments.some((s) => !SAFE_NAME.test(s) || s === '.' || s === '..')) {
        return reject(404, 'недопустимое имя');
    }

    const ext = path.posix.extname(rel);
    let ok = false;
    if (segments.length === 1) {
        ok = allowed.has(rel);
    } else if (segments.length === 2) {
        const exts = Object.prototype.hasOwnProperty.call(ASSET_DIRS, segments[0]) ? ASSET_DIRS[segments[0]] : null;
        ok = !!exts && exts.includes(ext) && segments[1].length > ext.length;
    }
    if (!ok || !Object.prototype.hasOwnProperty.call(MIME_TYPES, ext)) {
        return reject(404, 'нет в списке');
    }
    return { ok: true, relPath: rel, mime: MIME_TYPES[ext], isHtml: ext === '.html' };
}

/**
 * Заголовки успешного ответа. CSP — заголовком у страниц (та же строка, что в
 * meta: действующая политика — пересечение, так что расхождение сузило бы её
 * молча). nosniff — у всех: скрипт или стиль с чужим MIME не исполнится.
 */
function responseHeaders(resolved) {
    const headers = {
        'Content-Type': resolved.mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache'
    };
    if (resolved.isHtml) { headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY; }
    return headers;
}

module.exports = {
    SCHEME, HOST, ORIGIN, PRIVILEGED_SCHEME, WINDOW_PAGES, MIGRATION_PAGE,
    CONTENT_SECURITY_POLICY, MIME_TYPES, ASSET_DIRS,
    pageUrl, collectWebFiles, resolveAppRequest, responseHeaders
};
