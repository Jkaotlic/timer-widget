/*
 * display-theme-sync.js — дисплей слушает смену темы. Стоит ПОСЛЕ ipc-compat.js
 * и display-script.js. Отдельным файлом с 25.09.2026 (CSP `script-src 'self'`).
 */
window.UITheme.bindThemeSync(window.ipcRenderer, () => window.displayTimer && window.displayTimer.onThemeChanged());
