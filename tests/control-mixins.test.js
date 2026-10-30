'use strict';

/**
 * Примеси TimerController: каждая импортирована И присвоена прототипу.
 *
 * Зачем. Примесь — объект методов, который control-app.js подмешивает
 * `Object.assign(TimerController.prototype, XMixin)`. Потерянная строка
 * ничего не роняет при загрузке: падает первый клик, которому нужен метод
 * (CLAUDE.md, «Control panel modules»). С модулями примесь приходит
 * `import`-ом — пропавший экспорт уже ошибка связывания, — но импорт без
 * присваивания по-прежнему молчит, а файл-примесь, о котором control-app.js
 * забыл, не виден вовсе.
 *
 * Правило — три множества равны:
 *  - файлы-примеси: файлы проекта, экспортирующие имя `*Mixin`;
 *  - импортированные в control-app.js `*Mixin` (из того самого файла);
 *  - присвоенные прототипу: аргументы `Object.assign(TimerController.prototype, …)`.
 * Плюс примесь не импортирует control-app.js (цикл: контроллер подмешивает
 * примеси, а не наоборот).
 *
 * Разбор — парсер (ESLint `Linter` + правило-сборщик), как в
 * window-bridges.test.js: комментарий и строка — не код.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');

const REPO = path.join(__dirname, '..');
const CONTROL = 'control-app.js';

/**
 * Обход AST модуля одним правилом-сборщиком.
 * @param {string} code
 * @param {string} file
 * @param {Record<string, (node: any) => void>} visitors
 */
function walk(code, file, visitors) {
    const collect = { create() { return visitors; } };
    const messages = new Linter().verify(code, [{
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: {} },
        plugins: { scan: { rules: { collect } } },
        rules: { 'scan/collect': 'error' },
    }], file);
    const fatal = messages.find((m) => m.fatal);
    if (fatal) { throw new Error(`${file}: ${fatal.message}`); }
}

const isMixin = (name) => /Mixin$/.test(name);

/** Имена `*Mixin`, которые файл экспортирует (`export { X }`, `export const X`). */
function exportedMixins(code, file) {
    const out = [];
    walk(code, file, {
        ExportNamedDeclaration(node) {
            for (const s of node.specifiers || []) {
                const name = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value;
                if (isMixin(name)) { out.push(name); }
            }
            const decl = node.declaration;
            if (decl && decl.type === 'VariableDeclaration') {
                for (const d of decl.declarations) {
                    if (d.id.type === 'Identifier' && isMixin(d.id.name)) { out.push(d.id.name); }
                }
            }
        },
    });
    return out;
}

/** Что делает с примесями файл контроллера: импорты и присваивания прототипу. */
function controllerUse(code, file) {
    const imported = new Map(); // локальное имя → { name, from }
    const assigned = [];
    const importsOf = [];
    walk(code, file, {
        ImportDeclaration(node) {
            importsOf.push(node.source.value);
            for (const s of node.specifiers) {
                if (s.type !== 'ImportSpecifier') { continue; }
                const name = s.imported.type === 'Identifier' ? s.imported.name : s.imported.value;
                if (isMixin(name)) { imported.set(s.local.name, { name, from: node.source.value }); }
            }
        },
        CallExpression(node) {
            const c = node.callee;
            if (c.type !== 'MemberExpression' || c.computed || c.object.type !== 'Identifier'
                || c.object.name !== 'Object' || c.property.name !== 'assign') { return; }
            const [target, ...rest] = node.arguments;
            if (!target || target.type !== 'MemberExpression' || target.computed
                || target.object.type !== 'Identifier' || target.object.name !== 'TimerController'
                || target.property.name !== 'prototype') { return; }
            for (const a of rest) {
                // window.XMixin — прежняя форма: присваивание есть, импорта нет.
                if (a.type === 'Identifier') { assigned.push(a.name); }
                else if (a.type === 'MemberExpression' && !a.computed) { assigned.push(`<member>.${a.property.name}`); }
                else { assigned.push(`<${a.type}>`); }
            }
        },
    });
    return { imported, assigned, importsOf };
}

/** Файл, на который указывает `./x.js`. */
const fileOf = (spec) => spec.replace(/^\.\//, '');

/**
 * Нарушения правила.
 * @param {Map<string, string>} sources — файл → код (контроллер и кандидаты)
 * @param {string} controller
 */
function mixinViolations(sources, controller) {
    const mixinFiles = new Map(); // имя примеси → файл
    for (const [file, code] of sources) {
        if (file === controller) { continue; }
        for (const name of exportedMixins(code, file)) { mixinFiles.set(name, file); }
    }
    const { imported, assigned } = controllerUse(sources.get(controller), controller);

    const notImported = [];
    for (const [name, file] of mixinFiles) {
        const imp = [...imported.values()].find((i) => i.name === name);
        if (!imp) { notImported.push(`${name} (${file})`); }
        else if (fileOf(imp.from) !== file) { notImported.push(`${name}: импорт из ${imp.from}, а живёт в ${file}`); }
    }
    const notAssigned = [...imported.keys()].filter((local) => !assigned.includes(local));
    const assignedNotImported = assigned.filter((a) => !imported.has(a));
    const unknownImport = [...imported.values()]
        .filter((i) => mixinFiles.get(i.name) !== fileOf(i.from))
        .map((i) => `${i.name} из ${i.from}`);
    const cyclic = [...sources.entries()]
        .filter(([file]) => file !== controller && [...mixinFiles.values()].includes(file))
        .filter(([file, code]) => controllerUse(code, file).importsOf.some((s) => fileOf(s) === controller))
        .map(([file]) => file);
    return { notImported, notAssigned, assignedNotImported, unknownImport, cyclic };
}

test('охрана проверяет сама себя на фикстуре', () => {
    const sources = new Map([
        ['ctl.js', [
            "import { AMixin } from './a.js';",
            "import { BMixin } from './b.js';",
            "import { DMixin } from './wrong.js';",
            '// Object.assign(TimerController.prototype, CMixin);',
            'class TimerController {}',
            'Object.assign(TimerController.prototype, AMixin);',
            'Object.assign(TimerController.prototype, window.EMixin);',
        ].join('\n')],
        ['a.js', 'const AMixin = {};\nexport { AMixin };\n'],
        ['b.js', 'export const BMixin = {};\n'],
        ['c.js', "import { x } from './ctl.js';\nconst CMixin = {};\nexport { CMixin };\n"],
        ['d.js', 'const DMixin = {};\nexport { DMixin };\n'],
        ['plain.js', 'export const notAMixinHelper = 1;\n'],
    ]);
    assert.deepEqual(mixinViolations(sources, 'ctl.js'), {
        notImported: ['CMixin (c.js)', 'DMixin: импорт из ./wrong.js, а живёт в d.js'],
        notAssigned: ['BMixin', 'DMixin'],
        assignedNotImported: ['<member>.EMixin'],
        unknownImport: ['DMixin из ./wrong.js'],
        cyclic: ['c.js'],
    });
});

test('примеси панели: файлы = импорты control-app.js = присвоенные прототипу', () => {
    const files = fs.readdirSync(REPO).filter((f) => f.endsWith('.js'));
    const sources = new Map();
    for (const f of files) {
        const code = fs.readFileSync(path.join(REPO, f), 'utf8');
        // Кандидаты — только ES-модули (CommonJS-файлы main примесей не держат).
        if (f === CONTROL || /^\s*export\b/m.test(code)) { sources.set(f, code); }
    }
    const v = mixinViolations(sources, CONTROL);
    assert.deepEqual(v, { notImported: [], notAssigned: [], assignedNotImported: [], unknownImport: [], cyclic: [] });
    // Самопроверка на живом коде: охрана, не нашедшая примесей, зелёная впустую.
    const { imported } = controllerUse(sources.get(CONTROL), CONTROL);
    assert.ok(imported.size >= 8, `найдено примесей: ${imported.size}`);
});
