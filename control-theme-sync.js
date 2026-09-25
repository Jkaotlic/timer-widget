/*
 * control-theme-sync.js — панель слушает смену темы. Стоит ПОСЛЕ ipc-compat.js
 * и control-app.js. Отдельным файлом с 25.09.2026 (CSP `script-src 'self'`).
 */
window.UITheme.bindThemeSync(window.ipcRenderer);
