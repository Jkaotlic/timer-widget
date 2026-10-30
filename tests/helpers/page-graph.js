'use strict';

/**
 * «Файл подключён в окне» — утверждение о ГРАФЕ, а не о теге.
 *
 * С ES-модулями у окна один вход (`<script type="module" src="…-app.js">`), а
 * библиотеки приходят его `import`-ом (план 2026-10-30-es-modules, решение 5).
 * Тест, искавший `<script src="x.js">`, после перевода упал бы на исправной
 * странице, а переписанный на «import есть в control-app.js» не заметил бы
 * импорт через посредника. Поэтому одна функция: файл достижим со страницы по
 * тегам и статическим import — тем же обходом (`collectImports`), по которому
 * схема `app://` решает, отдавать ли файл вообще.
 */

const path = require('node:path');
const { pageFiles } = require('../../scripts/window-modules.js');

const ROOT = path.join(__dirname, '..', '..');

/** @param {string} page @param {string} file */
function pageLoads(page, file) {
    return pageFiles(ROOT, page).includes(file);
}

module.exports = { pageLoads, pageFiles: (page) => pageFiles(ROOT, page) };
