'use strict';

/**
 * Мосты `window.X` после перехода окон на ES-модули: ровно крючки e2e.
 *
 * Зачем. Окна — нативные ES-модули (план 2026-10-30-es-modules): зависимость
 * — import. `window.X` остаётся только там, где его читает тот, кто import-ом
 * дотянуться не может: e2e (`page.evaluate`) и стенд съёмки
 * (`executeJavaScript`). Мост без читателя ничего не ломает — он просто
 * остаётся навсегда и снова делает зависимость невидимой (анти-цель спеки).
 *
 * Правило — в обе стороны:
 *  - каждое `window.X =` в модуле окна — крючок из PERMANENT (или зонд `__*`);
 *    TEMPORARY — пуст с задачи 6, и новый мост сюда не пишется;
 *  - каждое `window.X`, которое читают e2e/ и scripts/, — крючок: из
 *    PERMANENT (его присваивает модуль), из `<head>`-скриптов (HEAD) или мост
 *    preload (PRELOAD). Иначе читатель молча получит undefined;
 *  - каждый крючок кто-то читает — иначе это мост «на всякий случай».
 *
 * История: задачи 4–5 переводили листья с временными мостами
 * («мост до задачи 6»), задача 6 сняла последний.
 *
 * Модули — `windowModuleFiles()` (scripts/window-modules.js): тот же список,
 * по которому lint даёт файлу `sourceType: 'module'`. Присваивания ищет парсер
 * (ESLint `Linter`), а не регулярка: комментарий и строка — не код.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');
const { windowModuleFiles } = require('../scripts/window-modules.js');

const REPO = path.join(__dirname, '..');

// Крючки, которые присваивают модули окон и читает e2e или стенд съёмки.
// `__*` — зонды e2e, по префиксу.
const PERMANENT = Object.freeze([
    // Шим IPC (ipc-compat.js): 280+ обращений в e2e.
    'ipcRenderer',
    // Экземпляры окон (входы).
    'timerController', 'clockWidget', 'displayTimer', 'timerWidget',
    // Экземпляр полосы (control-app.js): e2e (mini-bar.spec.js) и стенд
    // съёмки (scripts/screenshot-runner.js, executeJavaScript).
    'miniBar',
    // Модули панели и общие библиотеки, которые e2e зовёт или проверяет.
    'Toast', 'LoadingIndicator', 'SoundBank', 'CONFIG', 'FlipCard',
    'openModal', 'closeModal', 'showKeyboardShortcuts', 'setupScaleValueEdit', 'addPickerToggle',
]);

// Классические `<head>`-скрипты (тема, замок, drop-guard): исполняются до
// первой отрисовки, модулями не становятся (спека, «Ограничения»).
const HEAD = Object.freeze({ UITheme: 'ui-theme.js', UILock: 'ui-lock.js', DropGuard: 'drop-guard.js' });
// Мост preload (contextBridge) — не модуль окна.
const PRELOAD = Object.freeze(['electronAPI']);

// Временные мосты: пуст с задачи 6. Новый мост — нельзя (крючок e2e — в PERMANENT).
const TEMPORARY = Object.freeze({});

const BRIDGE_NOTE = 'мост до задачи 6';

/**
 * Все `window.X = …` файла (не computed), со строкой.
 * @param {string} code
 * @param {string} file
 * @returns {{name: string, line: number}[]}
 */
function windowAssignments(code, file) {
    const found = [];
    const collect = {
        create() {
            return {
                AssignmentExpression(node) {
                    const left = node.left;
                    if (left.type === 'MemberExpression' && !left.computed
                        && left.object.type === 'Identifier' && left.object.name === 'window'
                        && left.property.type === 'Identifier') {
                        found.push({ name: left.property.name, line: left.loc.start.line });
                    }
                },
            };
        },
    };
    const messages = new Linter().verify(code, [{
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: {} },
        plugins: { scan: { rules: { collect } } },
        rules: { 'scan/collect': 'error' },
    }], file);
    const fatal = messages.find((m) => m.fatal);
    if (fatal) { throw new Error(`${file}: ${fatal.message}`); }
    return found;
}

/** Комментарий-пометка на строке присваивания или в трёх строках над ней. */
function hasNote(code, line) {
    const lines = code.split('\n');
    return lines.slice(Math.max(0, line - 4), line).some((l) => l.includes(BRIDGE_NOTE));
}

/**
 * Нарушения правила для набора файлов.
 * @param {Map<string, string>} sources — файл → код
 * @param {Readonly<Record<string, string>>} temporary
 * @returns {{unexpected: string[], unmarked: string[], stale: string[]}}
 */
function bridgeViolations(sources, temporary) {
    const unexpected = [];
    const unmarked = [];
    const assigned = new Map();
    for (const [file, code] of sources) {
        for (const { name, line } of windowAssignments(code, file)) {
            if (name.startsWith('__') || PERMANENT.includes(name)) { continue; }
            assigned.set(name, file);
            if (temporary[name] !== file) {
                unexpected.push(`${file}:${line} window.${name}`);
            } else if (!hasNote(code, line)) {
                unmarked.push(`${file}:${line} window.${name}`);
            }
        }
    }
    const stale = Object.entries(temporary)
        .filter(([name, file]) => assigned.get(name) !== file)
        .map(([name, file]) => `${name} (${file})`);
    return { unexpected, unmarked, stale };
}

test('охрана проверяет сама себя на фикстуре', () => {
    const sources = new Map([
        ['a.js', [
            'export const A = 1;',
            '// window.InComment = A;',
            "const s = 'window.InString = 1';",
            'if (typeof window !== \'undefined\') {',
            `    // ${BRIDGE_NOTE}`,
            '    window.Listed = { A };',
            '}',
            'window.CONFIG = {};',
            'window.__probe = 1;',
            'window.Surprise = 2;',
            "window['Computed'] = 3;",
        ].join('\n')],
        ['b.js', 'export const B = 1;\nwindow.NoNote = B;\n'],
    ]);
    const temporary = { Listed: 'a.js', NoNote: 'b.js', Gone: 'c.js' };
    assert.deepEqual(bridgeViolations(sources, temporary), {
        unexpected: ['a.js:10 window.Surprise'],
        unmarked: ['b.js:2 window.NoNote'],
        stale: ['Gone (c.js)'],
    });
    // Мост, записанный за другим файлом, — не тот мост.
    assert.deepEqual(bridgeViolations(sources, { Listed: 'z.js', NoNote: 'b.js' }).unexpected,
        ['a.js:6 window.Listed', 'a.js:10 window.Surprise']);
});

test('мосты в модулях окон — только из списка, с пометкой; снятые вычеркнуты', () => {
    const files = windowModuleFiles(REPO);
    assert.ok(files.includes('constants.js'), `список модулей окон не вычислился: ${files.join(', ')}`);
    const sources = new Map(files.map((f) => [f, fs.readFileSync(path.join(REPO, f), 'utf8')]));
    const { unexpected, unmarked, stale } = bridgeViolations(sources, TEMPORARY);
    assert.deepEqual(unexpected, [], 'мост не из списка (новый мост — нельзя; крючок e2e — в PERMANENT по спеке)');
    assert.deepEqual(unmarked, [], `у временного моста нет комментария «${BRIDGE_NOTE}»`);
    assert.deepEqual(stale, [], 'мост снят — вычеркни его из TEMPORARY (список только убывает)');
});

// ---------------------------------------------------------------------------
// Читатели крючков: e2e/ и scripts/
// ---------------------------------------------------------------------------

const BROWSER = new Set(Object.keys(require('globals').browser));

/**
 * Имена `window.X`, которые читает код (не DOM и не зонды `__*`).
 * Регулярка по коду без комментариев: e2e пишет обращения внутри строк
 * (`executeJavaScript('…window.miniBar…')`) и стрелок `evaluate`, — парсер
 * первых не увидел бы.
 * @param {string} code
 * @returns {Set<string>}
 */
function hookReads(code) {
    const out = new Set();
    const clean = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    for (const m of clean.matchAll(/(?<![\w$.])window\.([A-Za-z_$][\w$]*)/g)) {
        const name = m[1];
        if (name.startsWith('__') || BROWSER.has(name)) { continue; }
        out.add(name);
    }
    return out;
}

function jsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) { out.push(...jsFiles(rel)); } else if (entry.name.endsWith('.js')) { out.push(rel); }
    }
    return out;
}

test('сборщик читателей проверяет сам себя на фикстуре', () => {
    const code = [
        "await page.evaluate(() => window.timerController.start());",
        "win.webContents.executeJavaScript('!!(window.miniBar && window.miniBar.collapse())');",
        '// window.InComment.x',
        'const w = window.innerWidth + window.devicePixelRatio;',
        'window.__probe = 1;',
        'foo.window.Nested = 1;',
    ].join('\n');
    assert.deepEqual([...hookReads(code)].sort(), ['miniBar', 'timerController']);
});

test('каждый window.X, который читают e2e и стенд, — крючок, который кто-то ставит', () => {
    const readers = new Map();
    for (const file of [...jsFiles('e2e'), ...jsFiles('scripts')]) {
        for (const name of hookReads(fs.readFileSync(path.join(REPO, file), 'utf8'))) {
            if (!readers.has(name)) { readers.set(name, file); }
        }
    }
    // Пустой сбор ничего не доказывает: шим IPC e2e читает сотнями.
    assert.ok(readers.has('ipcRenderer') && readers.has('timerController'), 'сборщик не увидел e2e');

    const known = new Set([...PERMANENT, ...Object.keys(HEAD), ...PRELOAD]);
    const unknown = [...readers].filter(([name]) => !known.has(name)).map(([n, f]) => `${f}: window.${n}`);
    assert.deepEqual(unknown, [], 'e2e/стенд читает window.X, которого окно больше не ставит (переведён в import?)');

    const unread = [...known].filter((name) => !readers.has(name));
    assert.deepEqual(unread, [], 'крючок без читателя — мост «на всякий случай»: снимите его');

    // Каждый крючок кто-то СТАВИТ: модуль окна, <head>-скрипт или preload.
    const assigned = new Set();
    for (const f of windowModuleFiles(REPO)) {
        for (const { name } of windowAssignments(fs.readFileSync(path.join(REPO, f), 'utf8'), f)) { assigned.add(name); }
    }
    const missing = PERMANENT.filter((name) => !assigned.has(name));
    assert.deepEqual(missing, [], 'крючок в списке, но ни один модуль окна его не присваивает');
    for (const [name, file] of Object.entries(HEAD)) {
        assert.match(fs.readFileSync(path.join(REPO, file), 'utf8'), new RegExp(`\\.${name} = `), `${file} не ставит ${name}`);
    }
    assert.match(fs.readFileSync(path.join(REPO, 'preload.js'), 'utf8'), /exposeInMainWorld\('electronAPI'/);
});
