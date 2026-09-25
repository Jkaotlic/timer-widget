/*
 * widget-theme-sync.js — виджет слушает тему и замок. Стоит ПОСЛЕ ipc-compat.js
 * и widget-app.js. Отдельным файлом с 25.09.2026 (CSP `script-src 'self'`).
 */
window.UITheme.bindThemeSync(window.ipcRenderer, () => window.timerWidget && window.timerWidget.refreshTone());
// Замок — тем же путём, что и тема: панель шлёт, главный процесс
// рассылает всем окнам. Без подписки окно, открытое до включения
// замка, осталось бы единственным подвижным.
window.UILock.bindLockSync(window.ipcRenderer);
