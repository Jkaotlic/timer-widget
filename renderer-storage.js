'use strict';

function getByteSize(value) {
    if (typeof value !== 'string') { return 0; }
    if (typeof Blob !== 'undefined') {
        return new Blob([value]).size;
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.byteLength(value, 'utf8');
    }
    return encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, 'x').length;
}

function safeGetJSON(storage, key, fallback) {
    if (!storage || typeof storage.getItem !== 'function') { return fallback; }
    try {
        const raw = storage.getItem(key);
        if (!raw) { return fallback; }
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function safeSetJSON(storage, key, value, options = {}) {
    if (!storage || typeof storage.setItem !== 'function') {
        return { ok: false, reason: 'storage-unavailable' };
    }

    const limitBytes = Number.isFinite(options.limitBytes)
        ? options.limitBytes
        : 1024 * 1024;
    const json = JSON.stringify(value);
    const bytes = getByteSize(json);

    if (bytes > limitBytes) {
        return { ok: false, reason: 'too-large', bytes, limitBytes };
    }

    try {
        storage.setItem(key, json);
        return { ok: true, bytes };
    } catch (err) {
        if (err && err.name === 'QuotaExceededError') {
            return { ok: false, reason: 'quota' };
        }
        return { ok: false, reason: 'write-failed', error: String(err) };
    }
}

const api = {
    getByteSize,
    safeGetJSON,
    safeSetJSON
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}

if (typeof window !== 'undefined') {
    window.RendererStorage = api;
}
