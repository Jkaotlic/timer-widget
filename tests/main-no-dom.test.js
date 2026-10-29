'use strict';

// types/main-window.d.ts объявляет `window: undefined | {...}`, но под
// `strict: false` (нет strictNullChecks) `undefined` стирается — и tsc пропустил
// бы НЕОХРАНЯЕМЫЙ `window.X` в главном процессе. Охрана — этот тест: в файлах,
// которые живут ТОЛЬКО в главном процессе, `window`/`document` нет вовсе.
// Общие модули (constants, utils…) спрашивают `typeof window` законно и сюда
// не входят.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly, maskNonCode } = require('./helpers/source-scan');

const REPO = path.join(__dirname, '..');
const DOM_RE = /\b(window|document)\b/;
// Строки и шаблоны ('window-geometry', `window ready`) — не код: маска их гасит.
const scan = (src) => maskNonCode(codeOnly(src));

const MAIN_ONLY = fs.readdirSync(REPO)
    .filter((f) => f === 'electron-main.js' || /^main-.*\.js$/.test(f))
    .sort();

test('охрана проверяет сама себя: регулярка ловит window.CONFIG и document', () => {
    assert.match(scan('const c = window.CONFIG;'), DOM_RE);
    assert.match(scan('document.body'), DOM_RE);
    assert.doesNotMatch(scan("// window.CONFIG\nsend('window-geometry'); log(`window ready`);"), DOM_RE);
});

test('список файлов главного процесса не пуст и входит в tsconfig.main.json', () => {
    assert.ok(MAIN_ONLY.includes('electron-main.js'));
    assert.ok(MAIN_ONLY.length >= 10, MAIN_ONLY.join(', '));
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'tsconfig.main.json'), 'utf8'));
    assert.ok(cfg.include.includes('electron-main.js'));
    assert.ok(cfg.include.includes('main-*.js'));
});

for (const file of MAIN_ONLY) {
    test(`${file}: нет window / document (только главный процесс)`, () => {
        const code = scan(fs.readFileSync(path.join(REPO, file), 'utf8'));
        const hits = code.split('\n').filter((l) => DOM_RE.test(l));
        assert.deepEqual(hits, []);
    });
}
