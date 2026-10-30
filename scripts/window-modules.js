'use strict';

/**
 * window-modules.js — какие файлы окон грузятся КЛАССИКОЙ, а какие МОДУЛЕМ.
 *
 * Зачем отдельный файл. Окна переходят на нативные ES-модули по одному листу
 * (план 2026-10-30-es-modules). Lint должен знать, какой файл уже модуль:
 * классике нужен `sourceType: 'script'` и выключенный `no-undef` (верхний
 * уровень соседнего файла страницы для неё — глобал), модулю — наоборот:
 * `sourceType: 'module'` и `no-undef: 'error'`, потому что его верхний уровень
 * никому не виден и голое имя чужого файла в нём — падение при вызове.
 *
 * Список НЕ пишется руками: третий список рядом с разметкой и графом import
 * разошёлся бы с ними при первом же переводе. Он вычисляется из тех же
 * источников, что белый список схемы `app://` (app-scheme.js): теги
 * `type="module"` четырёх страниц плюс транзитивное замыкание их статических
 * `import` (`collectImports`). Файл, который импортирует модуль, — сам модуль.
 *
 * Читает его eslint.config.js и тесты; приложение — нет (в сборку не входит).
 */

const fs = require('node:fs');
const path = require('node:path');
const globals = require('globals');
const { WINDOW_PAGES, collectImports } = require('../app-scheme.js');
// Разбор тегов — один на проект (тот же, что у тестов разметки): тег с `defer`
// или `type="module"` литералом не находится, а атрибуты разбираются здесь.
const { scriptTags } = require('../tests/helpers/source-scan.js');

/**
 * Теги `<script src>` каждой страницы окна, в порядке разметки.
 * @param {string} root — каталог со страницами
 * @param {readonly string[]} [pages]
 * @returns {Map<string, {src: string, type: string|null, defer: boolean, inHead: boolean}[]>}
 */
function pageScripts(root, pages = WINDOW_PAGES) {
    const out = new Map();
    for (const page of pages) {
        out.set(page, scriptTags(fs.readFileSync(path.join(root, page), 'utf8')));
    }
    return out;
}

/**
 * Файлы окон, которые браузер исполнит как модули: `type="module"`-теги и всё,
 * что они статически импортируют, транзитивно. Посещённые запоминаются —
 * цикл a ↔ b безопасен. Отсортировано: порядок не зависит от разметки.
 * @param {string} root
 * @param {readonly string[]} [pages]
 * @returns {string[]}
 */
function windowModuleFiles(root, pages = WINDOW_PAGES) {
    const queue = [];
    for (const tags of pageScripts(root, pages).values()) {
        for (const t of tags) {
            if (t.type !== null && t.type.trim().toLowerCase() === 'module') { queue.push(t.src); }
        }
    }
    const seen = new Set();
    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file)) { continue; }
        seen.add(file);
        for (const dep of collectImports(fs.readFileSync(path.join(root, file), 'utf8'))) {
            queue.push(dep);
        }
    }
    return [...seen].sort();
}

/**
 * Блок flat-конфига ESLint для модулей окон.
 *
 * Глобалы в flat-конфиге СЛИВАЮТСЯ по блокам, а не заменяются: общий блок
 * `**\/*.js` даёт файлу и node-глобалы (`require`, `module`, `process`…), и без
 * явного `'off'` модуль окна, зовущий `require`, прошёл бы lint, а упал бы в
 * окне. Поэтому node-only имена гасятся, остаются browser-глобалы.
 * @param {string[]} files
 */
function moduleLintBlock(files) {
    const nodeOnly = Object.keys(globals.node).filter((name) => !(name in globals.browser));
    return {
        files,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...Object.fromEntries(nodeOnly.map((name) => [name, 'off'])),
                ...globals.browser,
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-case-declarations': 'error',
            'no-useless-assignment': 'error',
        },
    };
}

module.exports = { pageScripts, windowModuleFiles, moduleLintBlock };
