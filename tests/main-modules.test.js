'use strict';

/**
 * Модули главного процесса (main-*.js) и их точка входа electron-main.js.
 *
 * 25.09.2026 главный процесс разбит на модули. Разбиение держится на трёх
 * правилах, и каждое ломается молча:
 *
 *  1. Модуль-сирота. Файл main-*.js, который точка входа не подключает, для
 *     source-level тестов — «часть главного процесса» (они читают все main-*.js
 *     по шаблону имени), а в приложении не исполняется вовсе. Проверки были
 *     бы зелёными на коде, которого нет.
 *  2. electron только в точке входа. Модуль получает electron, журнал и окна
 *     параметрами. Модуль, сделавший `require('electron')` сам, закэшировал бы
 *     подставку первого теста electron-main-load и молча работал бы с ней во
 *     всех следующих; а в приложении получил бы доступ к НАСТОЯЩЕМУ ipcMain —
 *     мимо проверки отправителя (SEC-07).
 *  3. Настоящий ipcMain не покидает точку входа. Каждая регистрация идёт через
 *     обвязку ipc-senders.guardIpcMain; поведенчески это проверяет
 *     electron-main-load («каждый зарегистрированный канал проходит проверку
 *     отправителя»), здесь — что другой дороги к ipcMain в коде нет.
 *
 * И порядок: гард ключей отладки (SEC-04) стоит в точке входа РАНЬШЕ любого
 * локального require — модули не успевают ни загрузиться, ни что-то
 * зарегистрировать.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const { codeOnly } = require('./helpers/source-scan');
const { ROOT, MAIN_ENTRY, mainProcessFiles } = require('./helpers/main-source');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MODULES = mainProcessFiles().filter((f) => f !== MAIN_ENTRY);

// Локальные require файла: './x' → 'x.js'.
function localRequires(src) {
    return [...codeOnly(src).matchAll(/require\(\s*'\.\/([^']+)'\s*\)/g)]
        .map((m) => (m[1].endsWith('.js') ? m[1] : `${m[1]}.js`));
}

// Требует ли код electron или журнал electron-log — в любой форме записи.
const ELECTRON_REQUIRE = /require\(\s*['"`]electron(?:-log(?:\/[\w-]+)?)?['"`]\s*\)/;

test('модулей главного процесса больше одного — разбиение на месте', () => {
    // Иначе все проверки ниже прошли бы на пустом списке.
    assert.ok(MODULES.length >= 5, `модулей main-*.js найдено ${MODULES.length}`);
});

test('каждый main-*.js подключён точкой входа (транзитивно)', () => {
    const reached = new Set();
    const queue = [MAIN_ENTRY];
    while (queue.length) {
        const file = queue.shift();
        for (const dep of localRequires(read(file))) {
            if (reached.has(dep) || !fs.existsSync(path.join(ROOT, dep))) { continue; }
            reached.add(dep);
            queue.push(dep);
        }
    }
    const orphans = MODULES.filter((f) => !reached.has(f));
    assert.deepEqual(orphans, [], 'модуль не подключён ни точкой входа, ни её модулями: ' + orphans.join(', '));
});

test('electron и electron-log требует только точка входа', () => {
    const offenders = MODULES.filter((f) => ELECTRON_REQUIRE.test(codeOnly(read(f))));
    assert.deepEqual(offenders, [], 'модуль требует electron сам: ' + offenders.join(', '));
    // Само-проверка зонда: точка входа electron требует, и регулярка это видит.
    assert.ok(ELECTRON_REQUIRE.test(codeOnly(read(MAIN_ENTRY))), 'зонд не видит require(\'electron\') даже в точке входа');
    assert.ok(ELECTRON_REQUIRE.test("const log = require('electron-log/main');"), 'зонд не видит electron-log');
});

test('модули загружаются без electron: ничего не требуют и не регистрируют при загрузке', () => {
    // Поведенческая половина правила выше: регулярка не увидела бы
    // `require(name)` с именем в переменной.
    const originalLoad = Module._load;
    const asked = [];
    Module._load = function (request, parent, isMain) {
        if (/^electron(-log)?(\/|$)/.test(request)) {
            asked.push(`${path.basename((parent && parent.filename) || '?')} → ${request}`);
            throw new Error(`модуль главного процесса требует ${request}`);
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        for (const file of MODULES) {
            const full = require.resolve(path.join(ROOT, file));
            delete require.cache[full];
            const exported = require(full);
            delete require.cache[full];
            assert.ok(exported && typeof exported === 'object', `${file}: ничего не экспортирует`);
            // Экспорт — фабрики и константы, а не готовое состояние: функции
            // создания/регистрации и неизменяемые значения.
            const fns = Object.values(exported).filter((v) => typeof v === 'function');
            assert.ok(fns.length > 0, `${file}: нет ни одной функции — где фабрика?`);
        }
    } finally {
        Module._load = originalLoad;
    }
    assert.deepEqual(asked, []);
});

test('настоящий ipcMain не покидает точку входа и сразу уходит в обвязку', () => {
    const entry = codeOnly(read(MAIN_ENTRY));
    // Два упоминания: получение из electron под другим именем и передача
    // в обвязку. Третье — это обработчик мимо проверки отправителя.
    const uses = entry.match(/\brawIpcMain\b/g) || [];
    assert.equal(uses.length, 2, `rawIpcMain упомянут ${uses.length} раз(а) — где-то он используется мимо обвязки`);
    assert.match(entry, /ipcMain:\s*rawIpcMain\s*[,}]/, 'настоящий ipcMain получен не под своим «опасным» именем');
    assert.match(entry, /const ipcMain = IpcSenders\.guardIpcMain\(rawIpcMain,/, 'ipcMain точки входа — не обвязка');

    for (const file of MODULES) {
        const code = codeOnly(read(file));
        assert.doesNotMatch(code, /\brawIpcMain\b/, `${file}: знает настоящий ipcMain`);
    }

    // Само-проверка: модуль, получивший настоящий ipcMain, проверка бы увидела.
    assert.match('registerX({ ipcMain: rawIpcMain })', /\brawIpcMain\b/);
});

test('обработчики каналов регистрируются в модулях, получивших ipcMain параметром', () => {
    // Регистрация `ipcMain.on(` возможна только в функции, которой ipcMain
    // передали: другого способа достать его у модуля нет (electron он не
    // требует — см. выше). Здесь — что каналы действительно живут в модулях,
    // иначе правило выше стерегло бы пустоту.
    let total = 0;
    for (const file of MODULES) {
        const code = codeOnly(read(file));
        const regs = (code.match(/\bipcMain\.on\(/g) || []).length;
        if (regs === 0) { continue; }
        total += regs;
        assert.match(
            code,
            /function \w+\(\s*(?:ipcMain\b|\{[^}]*\bipcMain\b[^}]*\})/,
            `${file}: регистрирует каналы, но ipcMain не получает параметром`
        );
    }
    assert.ok(total >= 40, `каналов в модулях ${total} — регулярка ослепла?`);
    // Точка входа сама каналов не регистрирует: она только собирает модули.
    assert.doesNotMatch(codeOnly(read(MAIN_ENTRY)), /\bipcMain\.on\(/, 'канал зарегистрирован в точке входа');
});

test('SEC-04: гард ключей отладки стоит раньше любого локального модуля', () => {
    const entry = codeOnly(read(MAIN_ENTRY));
    const guard = entry.indexOf('DEBUG_SWITCHES.some(');
    const firstLocal = entry.search(/require\(\s*'\.\//);
    assert.ok(guard > 0, 'гард ключей отладки исчез из точки входа');
    assert.ok(firstLocal > 0, 'зонд не нашёл ни одного локального require');
    assert.ok(guard < firstLocal, 'модуль главного процесса загружается ДО гарда ключей отладки');
    // И гард выходит сразу: process.exit после app.exit.
    const tail = entry.slice(guard, guard + 400);
    assert.match(tail, /app\.exit\(1\);\s*process\.exit\(1\);/, 'гард не выходит немедленно');
});
