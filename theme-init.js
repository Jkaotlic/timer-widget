/*
 * theme-init.js — тема и замок окна ДО первого кадра (панель, дисплей).
 *
 * Стоит в <head> сразу за ui-theme.js и ui-lock.js: иначе окно успевало бы
 * отрисоваться в чужой теме и мигнуть. Отдельным файлом, а не inline-<script>,
 * с 25.09.2026: CSP окон — `script-src 'self'`, без хешей и 'unsafe-inline'.
 * Пара для виджета и часов — theme-init-tone.js (там ещё тон по яркости фона).
 */
window.UITheme.initTheme(); window.UILock.initLock();
