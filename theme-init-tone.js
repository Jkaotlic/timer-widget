/*
 * theme-init-tone.js — тема, ТОН и замок окна ДО первого кадра (виджет, часы).
 *
 * Отличие от theme-init.js — initTone(): у этих окон палитру выбирает яркость
 * фона (surface-tones.css), и класс тона обязан стоять до первого кадра.
 * Отдельным файлом с 25.09.2026: CSP окон — `script-src 'self'`.
 */
window.UITheme.initTheme(); window.UITheme.initTone(); window.UILock.initLock();
