'use strict';

/**
 * Исходник окна целиком — разметка и СОБСТВЕННЫЙ код страницы на своих местах.
 *
 * Зачем. До 25.09.2026 логика каждого окна жила в inline-<script>, а стили
 * виджета и часов — в inline-<style>, и сотни source-level тестов читали
 * HTML-файл, чтобы утверждать о коде. CSP окон стала строгой
 * (`script-src 'self'; style-src 'self'` — без хешей и без 'unsafe-inline'),
 * и весь инлайн переехал во внешние файлы окна: `widget-app.js`, `widget.css`…
 *
 * Тесту важно ЧТО написано в окне, а не в каком файле: утверждения о наличии
 * и об отсутствии обязаны видеть тот же код, что и раньше. Поэтому здесь
 * страница собирается обратно: каждый `<script src>` / `<link rel="stylesheet">`
 * на СОБСТВЕННЫЙ файл окна заменяется его содержимым на той же позиции —
 * `<script>…</script>` и `<style>…</style>`. Порядок сохраняется, поэтому
 * проверки «X стоит в <head> до первого кадра» и «слушатель после ipc-compat»
 * продолжают мерить то же самое.
 *
 * Разворачиваются ТОЛЬКО файлы из WINDOW_OWN — код самой страницы. Общие
 * модули (renderer-shared.js, display-script.js, control.css…) тесты читают
 * отдельно, как и прежде: развернуть их сюда значило бы, что проверка
 * отсутствия в разметке окна вдруг начала бы видеть чужие модули.
 *
 * Сырой файл — `readRaw`: он нужен проверкам самой разметки (порядок <link>,
 * страж CSP «ни одного инлайна»).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Собственные файлы страниц. Новый файл окна обязан попасть сюда — иначе
// проверки о наличии его кода упадут, а проверки об отсутствии ослепнут.
// tests/window-source.test.js сверяет список с разметкой в обе стороны.
const WINDOW_OWN = Object.freeze({
    'electron-control.html': Object.freeze(['theme-init.js', 'control-app.js', 'control-theme-sync.js']),
    'electron-widget.html': Object.freeze(['theme-init-tone.js', 'widget.css', 'widget-app.js', 'widget-theme-sync.js']),
    'electron-clock-widget.html': Object.freeze(['theme-init-tone.js', 'clock-widget.css', 'clock-widget-app.js', 'clock-widget-theme-sync.js']),
    'display.html': Object.freeze(['theme-init.js', 'display-theme-sync.js'])
});

const readRaw = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function expandWindow(file) {
    let html = readRaw(file);
    for (const own of WINDOW_OWN[file]) {
        const body = readRaw(own);
        const re = own.endsWith('.css')
            ? new RegExp(`<link rel="stylesheet" href="${escapeRe(own)}">`, 'g')
            : new RegExp(`<script src="${escapeRe(own)}"></script>`, 'g');
        const tag = own.endsWith('.css') ? 'style' : 'script';
        let hits = 0;
        // Функция, а не строка замены: в коде бывают `$&` и `$1`.
        html = html.replace(re, () => { hits++; return `<${tag}>\n${body}</${tag}>`; });
        if (hits !== 1) {
            throw new Error(`${file}: собственный файл ${own} подключён ${hits} раз(а), ожидался ровно один`);
        }
    }
    return html;
}

/** Исходник окна со своим кодом на местах; для не-окна — файл как есть. */
function readSource(file) {
    return Object.prototype.hasOwnProperty.call(WINDOW_OWN, file) ? expandWindow(file) : readRaw(file);
}

module.exports = { WINDOW_OWN, readSource, readRaw };
