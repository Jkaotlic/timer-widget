'use strict';

/**
 * Исходник ГЛАВНОГО ПРОЦЕССА целиком — точка входа и все её модули.
 *
 * До 25.09.2026 главный процесс был одним файлом electron-main.js на 2363
 * строки, и source-level тесты читали его по имени. После разбиения на модули
 * `main-*.js` чтение одного файла превратилось бы в ловушку: проверка
 * ОТСУТСТВИЯ («нигде в главном процессе нет nodeIntegration: true») стала бы
 * зелёной просто потому, что окна создаются в другом файле. Поэтому тесты,
 * утверждающие что-то о главном процессе, читают его отсюда — все файлы сразу.
 *
 * Список модулей — не перечень, а шаблон имени (`main-*.js` в корне): новый
 * модуль попадает под проверки сам, а не когда о нём вспомнят. Что каждый
 * такой модуль действительно подключён точкой входа, стережёт
 * tests/main-modules.test.js — иначе модуль-сирота числился бы «главным
 * процессом», не исполняясь.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MAIN_ENTRY = 'electron-main.js';
const MAIN_MODULE_RE = /^main-[a-z0-9-]+\.js$/;

/** Точка входа первой, модули — по алфавиту. */
function mainProcessFiles() {
    const modules = fs.readdirSync(ROOT).filter((f) => MAIN_MODULE_RE.test(f)).sort();
    return [MAIN_ENTRY, ...modules];
}

/**
 * Все файлы главного процесса одной строкой. Между файлами — перевод строки
 * и комментарий с именем: функции и обработчики не склеиваются, а codeOnly()
 * метку срезает.
 */
function readMainSource() {
    return mainProcessFiles()
        .map((f) => `\n/* ${f} */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8'))
        .join('\n');
}

module.exports = { ROOT, MAIN_ENTRY, MAIN_MODULE_RE, mainProcessFiles, readMainSource };
