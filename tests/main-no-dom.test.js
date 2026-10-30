'use strict';

// types/main-window.d.ts объявляет `window: undefined | {...}`, но под
// `strict: false` (нет strictNullChecks) `undefined` стирается — и tsc пропустил
// бы НЕОХРАНЯЕМЫЙ `window.X` в главном процессе. Охрана — этот тест: в файлах,
// которые живут ТОЛЬКО в главном процессе, `window`/`document` нет вовсе.
//
// Какие файлы «только главного процесса», знает не этот тест, а конфиги tsc:
// `include` tsconfig.main.json МИНУС всё, что попадает и в renderer-проект
// (общие модули — constants, utils… — спрашивают `typeof window` законно).
// Список, написанный здесь рукой (раньше — `electron-main.js` + `main-*.js`),
// не видел app-scheme.js, atomic-write.js, timer-engine.js и ещё десяток.
//
// Исключение — DUAL_WORLD: модуль, который tsc проверяет только в main, но
// написан для двух миров (`typeof window !== 'undefined'` и экспорт в window).
// Каждое исключение обязано это подтверждать, иначе оно устарело.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly, maskNonCode } = require('./helpers/source-scan');

const REPO = path.join(__dirname, '..');
const DOM_RE = /\b(window|document)\b/;
// Строки и шаблоны ('window-geometry', `window ready`) — не код: маска их гасит,
// но подстановки `${…}` в шаблоне — код, и маска их оставляет.
const scan = (src) => maskNonCode(codeOnly(src), { keepSubstitutions: true, regexLiterals: true });

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const ROOT_JS = fs.readdirSync(REPO).filter((f) => f.endsWith('.js'));

/** Шаблон include/exclude tsc уровня корня (`*` — без `/`) → файлы корня. */
function expand(patterns) {
    const out = new Set();
    for (const p of patterns) {
        if (p.includes('/')) { continue; }
        const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
        for (const f of ROOT_JS) {
            if (re.test(f)) { out.add(f); }
        }
    }
    return out;
}

const MAIN = expand(readJson('tsconfig.main.json').include);
const rendererCfg = readJson('tsconfig.renderer.json');
const rendererExcluded = expand(rendererCfg.exclude || []);
const RENDERER = new Set([...expand(rendererCfg.include)].filter((f) => !rendererExcluded.has(f)));
const DUAL_WORLD = [];
const MAIN_ONLY = [...MAIN].filter((f) => !RENDERER.has(f) && !DUAL_WORLD.includes(f)).sort();

test('охрана проверяет сама себя: регулярка ловит window.CONFIG и document', () => {
    assert.match(scan('const c = window.CONFIG;'), DOM_RE);
    assert.match(scan('document.body'), DOM_RE);
    assert.doesNotMatch(scan("// window.CONFIG\nsend('window-geometry'); log(`window ready`);"), DOM_RE);
});

test('охрана проверяет сама себя: window внутри ${…} шаблона — код, а не строка', () => {
    assert.match(scan('log(`ready ${window.CONFIG.X}`);'), DOM_RE);
    assert.match(scan('log(`a ${f(`b ${document.title}`)} c`);'), DOM_RE);
    assert.doesNotMatch(scan('log(`window ${x} document`);'), DOM_RE);
});

test('охрана проверяет сама себя: кавычка в регулярке не прячет код ниже', () => {
    assert.match(scan('const R = /"([^"]*)"/g;\nwindow.CONFIG;'), DOM_RE);
    assert.match(scan("s.replace(/[&<>\"'/]/g, f);\ndocument.body;"), DOM_RE);
    assert.doesNotMatch(scan('const half = a / b; const r = /window/;'), DOM_RE);
});

for (const file of DUAL_WORLD) {
    test(`${file}: исключение не устарело — модуль main-only по tsconfig и спрашивает typeof window`, () => {
        assert.ok(MAIN.has(file) && !RENDERER.has(file), `${file} больше не main-only — убери из DUAL_WORLD`);
        assert.match(codeOnly(fs.readFileSync(path.join(REPO, file), 'utf8')), /typeof window !== 'undefined'/);
    });
}

test('список файлов главного процесса выведен из конфигов tsc и не пуст', () => {
    for (const f of ['electron-main.js', 'main-state.js', 'app-scheme.js', 'atomic-write.js',
        'navigation-guard.js', 'timer-controller.js', 'timer-engine.js', 'recovery.js',
        'channel-validator.js', 'event-overrun-store.js']) {
        assert.ok(MAIN_ONLY.includes(f), `${f} не попал в список: ${MAIN_ONLY.join(', ')}`);
    }
    // Общий модуль (есть в обоих проектах) сюда не входит.
    assert.ok(!MAIN_ONLY.includes('constants.js'));
    assert.ok(!MAIN_ONLY.includes('utils.js'));
});

for (const file of MAIN_ONLY) {
    test(`${file}: нет window / document (только главный процесс)`, () => {
        const src = fs.readFileSync(path.join(REPO, file), 'utf8');
        // Проверка на себе: `window` в ПОСЛЕДНЕЙ строке файла обязан быть виден.
        // Незакрытая «строка» маски (кавычка в регулярке) гасит всё до конца
        // файла — и тест был бы зелёным на невидимом коде (так было с
        // app-scheme.js до regexLiterals).
        const probe = scan(`${src}\nwindow.__probe;\n`).split('\n');
        assert.match(probe[probe.length - 2], DOM_RE, `${file}: маска теряет конец файла`);
        const hits = scan(src).split('\n').filter((l) => DOM_RE.test(l));
        assert.deepEqual(hits, []);
    });
}
