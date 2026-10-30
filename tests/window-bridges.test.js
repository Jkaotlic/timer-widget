'use strict';

/**
 * Храповик мостов: `window.X = …` в модулях окон — только из списка.
 *
 * Зачем. Окна переходят на нативные ES-модули по одному листу (план
 * 2026-10-30-es-modules). Переведённый файл временно оставляет `window.X`,
 * пока его читают ещё классические соседи, — это мост. Мост, пережившего
 * последнего читателя, никто не заметит: он ничего не ломает, он просто
 * остаётся навсегда и снова делает зависимость невидимой (анти-цель спеки:
 * «мост без читателя»).
 *
 * Правило:
 *  - каждое `window.X =` в модуле окна — либо крючок, который читает e2e или
 *    другой процесс (ПОСТОЯННЫЕ, список из спеки), либо временный мост из
 *    TEMPORARY с комментарием «мост до задачи 6» рядом;
 *  - каждая строка TEMPORARY ещё присваивается: снятый мост обязан уйти из
 *    списка. Поэтому список только убывает. Растёт он лишь в задаче 4 — мост
 *    при переводе не появляется (классический файл присваивал тот же
 *    `window.X`), он впервые становится видимым этому тесту;
 *  - в конце (задача 6) TEMPORARY пуст: мосты = крючки e2e.
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

// Крючки, которые читает e2e (`page.evaluate`), и `<head>`-скрипты — спека,
// «Установленные факты». `__*` — зонды e2e, по префиксу.
const PERMANENT = Object.freeze([
    'ipcRenderer', 'electronAPI', 'timerController', 'clockWidget', 'displayTimer',
    'timerWidget', 'Toast', 'LoadingIndicator', 'SoundBank', 'CONFIG', 'FlipCard',
    'UILock', 'UITheme', 'openModal', 'closeModal', 'showKeyboardShortcuts',
    'setupScaleValueEdit', 'addPickerToggle',
]);

// Временные мосты: имя → файл. Только убывает (см. шапку).
const TEMPORARY = Object.freeze({
    SecurityUtils: 'security.js',
    ColorUtils: 'color-utils.js',
    RendererStorage: 'renderer-storage.js',
    MoneyMeter: 'money-meter.js',
    TimeUtils: 'utils.js',
    ClockSettingsSchema: 'clock-settings-schema.js',
    DisplayLayouts: 'display-layouts.js',
    WindowGeometry: 'window-geometry.js',
    DigitsStyle: 'digits-style.js',
    RendererShared: 'renderer-shared.js',
    HeroModes: 'hero-modes.js',
    SettingsSchema: 'settings-schema.js',
    SoundPresets: 'sound-presets.js',
    Presets: 'presets.js',
    // Задача 5: модули панели, пока их читает классический control-app.js.
    ScaleReport: 'scale-report.js',
    ColorPicker: 'color-picker.js',
    attachFontSelect: 'font-select.js',
    globalHotkeyBlocked: 'shortcuts-help.js',
    trackPointerControl: 'shortcuts-help.js',
    Onboarding: 'onboarding.js',
    MiniBar: 'mini-bar.js',
    PanelDrawer: 'panel-drawer.js',
    PanelTitlebar: 'panel-titlebar.js',
    PanelPresets: 'panel-presets.js',
    PanelCompact: 'panel-compact.js',
    CustomSoundsMixin: 'custom-sounds.js',
    LocalBackgroundMixin: 'local-background.js',
    ThemeGridMixin: 'theme-grid.js',
    PanelStateMixin: 'panel-state.js',
});

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
