/*
 * widget-theme-sync.js — виджет слушает тему и замок. Стоит ПОСЛЕ widget-app.js. Отдельным файлом с 25.09.2026 (CSP `script-src 'self'`).
 */
// ES-модуль: шим IPC — import-ом, а не соседним тегом. Окно (window.X) —
// крючок своего входа, тег которого стоит раньше этого.
import './ipc-compat.js';
import { activeWidgetTimer } from './widget-app.js';

window.UITheme.bindThemeSync(window.ipcRenderer, () => activeWidgetTimer && activeWidgetTimer.refreshTone());
// Замок — тем же путём, что и тема: панель шлёт, главный процесс
// рассылает всем окнам. Без подписки окно, открытое до включения
// замка, осталось бы единственным подвижным.
window.UILock.bindLockSync(window.ipcRenderer);
