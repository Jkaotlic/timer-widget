/*
 * display-theme-sync.js — дисплей слушает смену темы. Стоит ПОСЛЕ display-script.js. Отдельным файлом с 25.09.2026 (CSP `script-src 'self'`).
 */
// ES-модуль: шим IPC — import-ом, а не соседним тегом. Окно (window.X) —
// крючок своего входа, тег которого стоит раньше этого.
import './ipc-compat.js';
import { displayTimer } from './display-script.js';

window.UITheme.bindThemeSync(window.ipcRenderer, () => displayTimer && displayTimer.onThemeChanged());
