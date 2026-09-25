'use strict';

/**
 * main-app-protocol.js — ответ схемы `app://timer-widget/…` (SEC-12).
 *
 * Что можно отдать и с какими заголовками, решает app-scheme.js (чистый,
 * проверяется отдельно). Здесь — только чтение файла и сборка Response для
 * `protocol.handle` (Electron ≥ 25). Файл читается `fs` главного процесса:
 * в сборке он прозрачно читает из app.asar, а заголовки и MIME ставим сами —
 * `net.fetch(file://…)` решал бы их за нас.
 *
 * Модуль не требует electron: `protocol` передаёт точка входа.
 */

const path = require('path');
const AppScheme = require('./app-scheme');

/**
 * @param {object} deps
 * @param {string} deps.appDir — каталог приложения (в сборке — app.asar)
 * @param {(file: string) => Promise<Buffer>} deps.readFile
 * @param {(rel: string) => string} deps.readText — синхронно, для списка файлов
 * @param {{warn: Function}} deps.log
 * @returns {(request: {url: string, method: string}) => Promise<Response>}
 */
function createAppProtocolHandler({ appDir, readFile, readText, log }) {
    // Список собирается один раз: страницы в сборке не меняются, а ASAR
    // целостность сверяет фьюз.
    const allowed = AppScheme.collectWebFiles(readText);

    // Отказ — в журнал один раз на пару «причина + имя»: окно, просящее
    // несуществующий файл, просит его при каждой загрузке.
    const seen = new Set();
    const warnOnce = (status, reason, url) => {
        let name = '';
        try { name = new URL(url).pathname.split('/').filter(Boolean).pop() || ''; } catch { /* не адрес */ }
        const key = `${status}|${reason}|${name}`;
        if (seen.has(key)) { return; }
        seen.add(key);
        log.warn(`[app://] отказ ${status} (${reason}): …/${name}`);
    };

    return async function handleAppRequest(request) {
        const method = request && request.method;
        if (method !== 'GET' && method !== 'HEAD') {
            warnOnce(405, 'метод', request && request.url);
            return new Response(null, { status: 405 });
        }
        const resolved = AppScheme.resolveAppRequest(request.url, allowed);
        if (!resolved.ok) {
            warnOnce(resolved.status, resolved.reason, request.url);
            return new Response(null, { status: resolved.status });
        }
        let body;
        try {
            body = await readFile(path.join(appDir, ...resolved.relPath.split('/')));
        } catch {
            warnOnce(404, 'нет файла', request.url);
            return new Response(null, { status: 404 });
        }
        return new Response(method === 'HEAD' ? null : body, {
            status: 200,
            headers: AppScheme.responseHeaders(resolved)
        });
    };
}

function registerAppProtocol(protocol, handler) {
    protocol.handle(AppScheme.SCHEME, handler);
}

module.exports = { createAppProtocolHandler, registerAppProtocol };
