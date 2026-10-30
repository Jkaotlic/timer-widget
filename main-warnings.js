'use strict';

/**
 * main-warnings.js — гасит ОДНО предупреждение Node: MODULE_TYPELESS_PACKAGE_JSON.
 *
 * Откуда оно. Общие файлы окон и main (constants.js, utils.js…) — ES-модули
 * (план 2026-10-30-es-modules), а в package.json нет "type". Главный процесс
 * CommonJS и берёт их `require(esm)`. Файл, до которого `require` дошёл сам,
 * Node грузит молча; а файл, до которого дошёл `import` ВНУТРИ такого графа
 * (utils.js → constants.js), Node сначала пробует как CommonJS, не может и
 * печатает раз на процесс: «Module type … is not specified … Reparsing as ES
 * module». Поведение верное, это только шум в stderr при каждом старте.
 *
 * Почему не убрать причину. "type": "module" в package.json сделал бы ESM
 * каждый `.js` проекта — главный процесс, preload, тесты, скрипты пришлось бы
 * переименовать в `.cjs`. Переименовать общие файлы в `.mjs` — сменить имена
 * в четырёх страницах, белом списке app://, build.files и сотне тестов. Оба
 * пути — переезд, а не правка; предупреждение о них и просит. Поэтому гасится
 * ровно этот код, всё остальное печатается как прежде.
 *
 * Тесты и скрипты гасят то же флагом `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`
 * (package.json); здесь — для процесса Electron, которому флаг не передать.
 */

const SILENCED_CODE = 'MODULE_TYPELESS_PACKAGE_JSON';

/**
 * Код предупреждения для любой формы вызова `process.emitWarning`:
 * (warning, {code}), (warning, type, code), (Error с .code).
 * @param {unknown} warning
 * @param {unknown[]} rest
 * @returns {string|undefined}
 */
function warningCode(warning, rest) {
    const [opts, code] = rest;
    if (opts && typeof opts === 'object' && typeof (/** @type {{code?: unknown}} */ (opts)).code === 'string') {
        return /** @type {{code: string}} */ (opts).code;
    }
    if (typeof code === 'string') { return code; }
    if (warning && typeof warning === 'object' && typeof (/** @type {{code?: unknown}} */ (warning)).code === 'string') {
        return /** @type {{code: string}} */ (warning).code;
    }
    return undefined;
}

/**
 * Ставит фильтр на `proc.emitWarning`. Повторный вызов ничего не меняет.
 * @param {NodeJS.Process} [proc]
 */
function installWarningFilter(proc = process) {
    const current = /** @type {any} */ (proc.emitWarning);
    if (current && current.__typelessFilter) { return; }
    const original = current;
    const filtered = function emitWarning(warning, ...rest) {
        if (warningCode(warning, rest) === SILENCED_CODE) { return; }
        return original.call(this, warning, ...rest);
    };
    filtered.__typelessFilter = true;
    proc.emitWarning = /** @type {any} */ (filtered);
}

module.exports = { installWarningFilter, warningCode, SILENCED_CODE };
