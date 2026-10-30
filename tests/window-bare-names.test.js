'use strict';

/**
 * Файлы окна обращаются к чужому файлу ТОЛЬКО через `window.X`.
 *
 * Зачем. Пока скрипты окна классические, верхнеуровневый `const/let/class/
 * function` одного файла — глобальное имя для всех файлов страницы, и голое
 * обращение к нему работает. В lint это не ловится: у файлов окон `no-undef`
 * выключен ровно поэтому (eslint.config.js). Как только файл становится модулем
 * (план 2026-10-30-es-modules), его верхний уровень перестаёт быть глобалом —
 * и каждый голый потребитель падает, причём не при загрузке, а при первом
 * вызове. Инвентаризация 30.10.2026 нашла ноль таких обращений; этот тест
 * держит ноль.
 *
 * Метод — анализ областей видимости ESLint (`Linter` + правило-сборщик), а не
 * регулярка: имя файла может совпасть с локальным именем другого (параметр,
 * переменная функции), и такое обращение к глобалу не относится. Комментарии
 * и строки парсер не считает кодом сам — `codeOnly()` здесь не нужен и был бы
 * хуже (он режет `//` и внутри строк).
 *
 * Вторая половина — список модулей для lint (scripts/window-modules.js): он
 * вычисляется из разметки и графа import. Пока модулей нет, проверка
 * вычисления — на фикстуре.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Linter, ESLint } = require('eslint');
const { pageScripts, windowModuleFiles, moduleLintBlock } = require('../scripts/window-modules.js');

const REPO = path.join(__dirname, '..');

/**
 * Верхний уровень файла и его обращения к глобальной области.
 * @param {string} code
 * @param {string} file — для сообщения об ошибке разбора
 * @param {'script'|'module'} sourceType
 * @returns {{declared: Set<string>, through: {name: string, line: number}[]}}
 */
function topLevel(code, file, sourceType = 'script') {
    let result = null;
    const collect = {
        create(context) {
            return {
                'Program:exit'() {
                    const global = context.sourceCode.scopeManager.globalScope;
                    // У модуля верхний уровень — в дочерней области `module`.
                    const own = global.childScopes.find((s) => s.type === 'module') || global;
                    const declared = new Set();
                    for (const scope of [global, own]) {
                        if (!scope) { continue; }
                        for (const v of scope.variables) {
                            if (v.defs.length > 0) { declared.add(v.name); }
                        }
                    }
                    // `through` глобальной области — обращения, не нашедшие
                    // объявления в самом файле (глобалов конфиг не даёт).
                    const through = global.through.map((r) => ({
                        name: r.identifier.name,
                        line: r.identifier.loc.start.line,
                    }));
                    result = { declared, through };
                },
            };
        },
    };
    const messages = new Linter().verify(code, [{
        languageOptions: { ecmaVersion: 'latest', sourceType, globals: {} },
        plugins: { scan: { rules: { collect } } },
        rules: { 'scan/collect': 'error' },
    }], file);
    const fatal = messages.find((m) => m.fatal);
    if (fatal) { throw new Error(`${file}: ${fatal.message}`); }
    if (!result) { throw new Error(`${file}: сборщик не отработал`); }
    return result;
}

/**
 * Голые обращения к верхнему уровню ДРУГОГО файла той же страницы.
 * @param {Map<string, {src: string, type: string|null}[]>} pages
 * @param {(file: string) => string} read
 * Второй вид той же связи — одно имя на верхнем уровне ДВУХ классических
 * файлов страницы: они делят одну привязку, и голое имя внутри каждого из них
 * ведёт туда, куда решил порядок тегов (последний `function` перезаписывает).
 * Своё ли обращение — тогда не скажет никто; у модуля верхний уровень свой,
 * поэтому пары с модулем не считаются.
 * @returns {{found: string[], collisions: string[], cache: Map<string, ReturnType<typeof topLevel>>}}
 *   found — «файл:строка имя ← владелец [страница]», collisions — «имя: a.js b.js [страница]»
 */
function crossFileBareNames(pages, read) {
    const cache = new Map();
    const isModule = (t) => t.type !== null && t.type.trim().toLowerCase() === 'module';
    const scan = (tag) => {
        if (!cache.has(tag.src)) {
            cache.set(tag.src, topLevel(read(tag.src), tag.src, isModule(tag) ? 'module' : 'script'));
        }
        return cache.get(tag.src);
    };
    const found = [];
    const collisions = [];
    for (const [page, tags] of pages) {
        const declaredBy = new Map();
        for (const tag of tags.filter((t) => !isModule(t))) {
            for (const name of scan(tag).declared) {
                if (!declaredBy.has(name)) { declaredBy.set(name, []); }
                declaredBy.get(name).push(tag.src);
            }
        }
        for (const [name, files] of declaredBy) {
            if (files.length > 1) { collisions.push(`${name}: ${files.join(' ')} [${page}]`); }
        }
        for (const tag of tags) {
            const me = scan(tag);
            for (const ref of me.through) {
                if (me.declared.has(ref.name)) { continue; }
                const owners = tags.filter((t) => t.src !== tag.src && scan(t).declared.has(ref.name));
                for (const owner of owners) {
                    found.push(`${tag.src}:${ref.line} ${ref.name} ← ${owner.src} [${page}]`);
                }
            }
        }
    }
    return { found, collisions, cache };
}

test('самопроверка: голое обращение к чужому верхнему уровню находится, тень и window.X — нет', () => {
    const files = {
        'owner.js': 'const Foo = 1;\nfunction bar() { return 2; }\nclass Baz {}\nwindow.Qux = 3;\n',
        'user.js': [
            '// Foo в комментарии — не обращение',
            'const s = "Foo в строке — тоже";',
            'function shadowed(Foo) { return Foo; }',      // параметр затеняет
            'function local() { const bar = 0; return bar; }',
            'window.Foo; window.Qux; Qux;',                 // window.X и присвоенный window-глобал — законны
            'function real() { return Foo + bar() + new Baz(); }',
        ].join('\n'),
    };
    const pages = new Map([['page.html', [
        { src: 'owner.js', type: null }, { src: 'user.js', type: null },
    ]]]);
    const { found } = crossFileBareNames(pages, (f) => files[f]);
    assert.deepStrictEqual(found, [
        'user.js:6 Foo ← owner.js [page.html]',
        'user.js:6 bar ← owner.js [page.html]',
        'user.js:6 Baz ← owner.js [page.html]',
    ]);
});

test('самопроверка: обращение из модуля к классическому верхнему уровню тоже находится', () => {
    const files = {
        'owner.js': 'const Foo = 1;\n',
        'mod.js': "import './dep.js';\nexport function f() { return Foo; }\n",
    };
    const pages = new Map([['page.html', [
        { src: 'owner.js', type: null }, { src: 'mod.js', type: 'module' },
    ]]]);
    assert.deepStrictEqual(crossFileBareNames(pages, (f) => files[f]).found, ['mod.js:2 Foo ← owner.js [page.html]']);
});

test('самопроверка: одно имя на верхнем уровне двух классических файлов находится, у модуля — нет', () => {
    const files = {
        'a.js': 'function clamp(v, lo, hi) { return v; }\nconst onlyA = 1;\n',
        'b.js': 'function clamp(v) { return clamp2(v); }\nfunction clamp2(v) { return v; }\n',
        'm.js': 'export function clamp() {}\n',
    };
    const pages = new Map([['page.html', [
        { src: 'a.js', type: null }, { src: 'b.js', type: null }, { src: 'm.js', type: 'module' },
    ]]]);
    const { found, collisions } = crossFileBareNames(pages, (f) => files[f]);
    assert.deepStrictEqual(collisions, ['clamp: a.js b.js [page.html]']);
    assert.deepStrictEqual(found, []);
});

test('ни один файл окна не обращается голым именем к верхнему уровню другого файла страницы', () => {
    const pages = pageScripts(REPO);
    const { found, collisions, cache } = crossFileBareNames(pages, (f) => fs.readFileSync(path.join(REPO, f), 'utf8'));
    // Пустой результат на пустом разборе ничего не доказывает: проверка обязана
    // видеть и страницы, и объявления, и обращения к глобалам.
    assert.strictEqual(pages.size, 4, 'четыре страницы окон');
    for (const [page, tags] of pages) { assert.ok(tags.length > 0, `${page}: нет ни одного <script src>`); }
    const declared = [...cache.values()].reduce((n, c) => n + c.declared.size, 0);
    const through = [...cache.values()].reduce((n, c) => n + c.through.length, 0);
    assert.ok(declared > 100, `разбор увидел лишь ${declared} верхнеуровневых имён`);
    assert.ok(through > 100, `разбор увидел лишь ${through} обращений к глобалам`);
    assert.deepStrictEqual(found, [],
        'голое имя чужого файла сломается, когда тот станет модулем — пишите window.X ' +
        '(и присвойте window.X в файле-владельце)');
    assert.deepStrictEqual(collisions, [],
        'одно имя на верхнем уровне двух файлов страницы — одна привязка на двоих: переименуйте своё');
});

/** Временный корень с четырьмя страницами для windowModuleFiles. */
function fixtureRoot(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-modules-'));
    for (const [name, text] of Object.entries(files)) { fs.writeFileSync(path.join(dir, name), text); }
    return dir;
}

test('список модулей: type="module"-теги + транзитивное замыкание import, классика не входит', (t) => {
    const dir = fixtureRoot({
        'a.html': '<head><script src="classic.js"></script></head><body><script type="module" src="entry.js"></script></body>',
        'b.html': '<!-- <script type="module" src="commented.js"></script> --><script src="classic.js" defer></script>',
        'classic.js': "const s = \"import './not-a-dep.js'\";\n",
        'entry.js': "import './mid.js';\nexport const e = 1;\n",
        'mid.js': "import { x } from './leaf.js';\nimport './entry.js';\nexport const m = x;\n",
        'leaf.js': 'export const x = 1;\n',
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.deepStrictEqual(windowModuleFiles(dir, ['a.html', 'b.html']), ['entry.js', 'leaf.js', 'mid.js']);
    // Без модульных тегов — пусто, а не «все файлы».
    assert.deepStrictEqual(windowModuleFiles(dir, ['b.html']), []);
});

test('блок модулей: голое имя и require — ошибка no-undef, browser-глобалы и import — нет', async () => {
    const real = require('../eslint.config.js');
    const lint = async (configs, filePath, code) => {
        const eslint = new ESLint({ cwd: REPO, overrideConfigFile: true, overrideConfig: configs });
        const [res] = await eslint.lintText(code, { filePath: path.join(REPO, filePath) });
        return res.messages.filter((m) => m.ruleId === 'no-undef').map((m) => m.message);
    };
    const code = "import './leaf.js';\ndocument.title = String(window.innerWidth);\nexport const v = Foo;\nrequire('x');\n";
    // Блок стоит ПОСЛЕ остальных и перекрывает node-глобалы общего блока.
    assert.deepStrictEqual(await lint([...real, moduleLintBlock(['fixture-module.js'])], 'fixture-module.js', code), [
        "'Foo' is not defined.",
        "'require' is not defined.",
    ]);
    // Классический файл окна под реальным конфигом: no-undef выключен — вот
    // почему голые имена ловит тест выше, а не lint. После задачи 6 классика
    // окон — только скрипты <head> (theme-init*).
    assert.deepStrictEqual(await lint(real, 'theme-init.js', 'Foo;\n'), []);
});

test('eslint.config.js берёт блок модулей из вычисленного списка, а не из ручного', () => {
    const real = require('../eslint.config.js');
    const computed = windowModuleFiles(REPO);
    const blocks = real.filter((c) => c.languageOptions && c.languageOptions.sourceType === 'module');
    if (computed.length === 0) {
        assert.strictEqual(blocks.length, 0, 'модулей нет — блока нет (пустой files ESLint отвергает)');
    } else {
        assert.strictEqual(blocks.length, 1);
        assert.deepStrictEqual(blocks[0].files, computed);
        assert.strictEqual(blocks[0].rules['no-undef'], 'error');
        // Блок перекрывает классический блок окон — значит, стоит после него.
        const classic = real.findIndex((c) => Array.isArray(c.files) && c.files.includes('theme-init.js'));
        assert.ok(classic >= 0, 'классический блок окон не найден');
        assert.ok(real.indexOf(blocks[0]) > classic);
        // Входы окон — модули: классическим блоком они больше не описаны.
        for (const entry of ['control-app.js', 'widget-app.js', 'clock-widget-app.js', 'display-script.js']) {
            assert.ok(computed.includes(entry), `${entry} не модуль`);
            assert.ok(!real[classic].files.includes(entry), `${entry} остался в классическом блоке`);
        }
    }
});
