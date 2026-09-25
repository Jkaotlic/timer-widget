'use strict';

/**
 * Ворота релиза. Эти проверки обязаны валить сборку, а не советовать.
 *
 * Что они держат:
 *
 *  1. РЕЖИМ РАЗРАБОТЧИКА ЗАКРЫТ В СБОРКЕ. DevTools в Electron — это консоль
 *     ВНУТРИ процесса приложения: оттуда доступны localStorage со всеми
 *     настройками и любой IPC-канал, открытый в preload.js. В electron-main.js
 *     уже стоит двойной замок `--dev && !app.isPackaged`, но существующая
 *     проверка сравнивала ЧИСЛО совпадений с четвёркой, и это её слабое место:
 *     пятое окно, добавленное БЕЗ гарда, оставляет число равным четырём — тест
 *     проходит. Здесь наоборот: перечисляются все конструкторы BrowserWindow и
 *     каждый обязан нести гард. Добавить окно без него нельзя.
 *
 *  2. ПРИЛОЖЕНИЕ РАБОТАЕТ БЕЗ СЕТИ. Ни один поставляемый файл не тянет ресурсы
 *     по http(s) — шрифты лежат локально в fonts/, телеметрия Chromium выключена
 *     явными ключами. Одна @import-строка на внешний CDN превращает запуск без
 *     интернета в отрисовку запасным шрифтом и висящий запрос.
 *
 *  3. ПРИЛОЖЕНИЕ НЕ ОБНОВЛЯЕТ СЕБЯ САМО. `publish: null`, никакого
 *     electron-updater. Самообновление означает исходящие запросы и подмену
 *     собственного бинарника — свойство, которое должно появляться только
 *     осознанно, а не приехать вместе с зависимостью.
 *
 *  4. ОКНА ИЗОЛИРОВАНЫ. sandbox + contextIsolation + отсутствие nodeIntegration
 *     на КАЖДОМ окне, CSP в каждом HTML, белый список IPC-каналов.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { codeOnly } = require('./helpers/source-scan');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PKG = JSON.parse(read('package.json'));
const MAIN = read('electron-main.js');
// Проверки ОТСУТСТВИЯ обязаны идти по коду: пояснение вида
// «nodeIntegration: true здесь запрещён» уронило бы ворота релиза на самом
// комментарии, который объясняет запрет (CLAUDE.md, Gotchas).
const MAIN_CODE = codeOnly(MAIN);

const WINDOW_HTML = [
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html'
];

// Файлы, которые реально попадают в сборку (без каталогов и шаблонов).
const SHIPPED = PKG.build.files.filter((f) => !f.includes('*'));

// Пропускает строковый литерал; возвращает индекс закрывающей кавычки или -1.
function skipString(source, start) {
    const quote = source[start];
    for (let i = start + 1; i < source.length; i++) {
        const ch = source[i];
        if (ch === '\\') { i++; continue; }
        if (ch === quote) { return i; }
        // Перевод строки внутри обычной кавычки — признак того, что за строку
        // принято что-то другое; лучше упасть, чем молча съесть полфайла.
        if (ch === '\n' && quote !== '`') { return -1; }
    }
    return -1;
}

// Индекс скобки, закрывающей ту, что стоит на позиции open.
function matchingBrace(source, open) {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];
        if (ch === '/' && next === '/') {
            const eol = source.indexOf('\n', i);
            if (eol === -1) { return -1; }
            i = eol;
            continue;
        }
        if (ch === '/' && next === '*') {
            const close = source.indexOf('*/', i + 2);
            if (close === -1) { return -1; }
            i = close + 1;
            continue;
        }
        if (ch === '\'' || ch === '"' || ch === '`') {
            const end = skipString(source, i);
            if (end === -1) { return -1; }
            i = end;
            continue;
        }
        if (ch === '{') { depth++; continue; }
        if (ch === '}') {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return -1;
}

// Разбивает electron-main.js на блоки настроек окон: от `new BrowserWindow({`
// до скобки, которая этот объект ЗАКРЫВАЕТ.
//
// Границу задаёт баланс скобок, а не отступ. Прежняя версия искала конец как
// литерал `\n    });`, то есть считала, что каждый конструктор стоит на верхнем
// уровне функции. Все четыре существующих окна там и стоят, поэтому парсер
// «работал». Пятое окно, объявленное внутри `if (...) {` на восьми пробелах,
// своей закрывающей строки не имеет: поиск уезжал к концу СЛЕДУЮЩЕГО блока, оба
// окна склеивались в один кусок текста, и злое окно наследовало чужие гарды.
// Воспроизведено мутацией: окно с nodeIntegration: true, contextIsolation: false,
// sandbox: false и devTools: true проходило все ворота зелёным.
//
// Скобки внутри строк и комментариев не считаются: в блоках есть и текстовые
// литералы ('Управление Таймером'), и поясняющие комментарии. Литералы
// регулярных выражений парсер не разбирает — в объявлениях окон их нет, а если
// разбор всё-таки уедет, это заметит самопроверка: за закрывающей скобкой
// объекта обязана идти скобка вызова.
function browserWindowBlocks(source) {
    const blocks = [];
    const re = /new BrowserWindow\(\s*\{/g;
    let m;
    while ((m = re.exec(source)) !== null) {
        const open = source.indexOf('{', m.index);
        const close = matchingBrace(source, open);
        assert.ok(close !== -1, 'не найден конец блока new BrowserWindow');
        const tail = source.slice(close + 1).match(/^\s*\)/);
        assert.ok(tail, 'разбор блока new BrowserWindow уехал: за объектом нет закрывающей скобки вызова');
        blocks.push(source.slice(m.index, close + 1));
    }
    return blocks;
}

test('режим разработчика закрыт в КАЖДОМ окне, а не в четырёх известных', () => {
    const blocks = browserWindowBlocks(MAIN);
    assert.ok(blocks.length >= 4, `окон найдено ${blocks.length}, ожидалось не меньше четырёх`);

    blocks.forEach((block, i) => {
        assert.match(
            block,
            /devTools:\s*process\.argv\.includes\('--dev'\)\s*&&\s*!app\.isPackaged/,
            `окно №${i + 1}: DevTools без гарда «--dev И не собранное приложение»`
        );
    });
});

test('окна изолированы: sandbox, contextIsolation, без nodeIntegration', () => {
    browserWindowBlocks(MAIN).forEach((block, i) => {
        assert.match(block, /nodeIntegration:\s*false/, `окно №${i + 1}: nodeIntegration не выключен`);
        assert.match(block, /contextIsolation:\s*true/, `окно №${i + 1}: contextIsolation не включён`);
        assert.match(block, /sandbox:\s*true/, `окно №${i + 1}: sandbox не включён`);
        assert.match(block, /preload:\s*path\.join\(__dirname, 'preload\.js'\)/, `окно №${i + 1}: нет preload`);
    });
});

test('во ВСЁМ главном процессе нет ослабленных настроек окна', () => {
    // Вторая линия обороны, намеренно дублирующая поблочные проверки выше.
    // Проверка ОТСУТСТВИЯ по целому файлу строго сильнее поблочной: она не
    // пользуется границами блоков вовсе, поэтому любая будущая ошибка разбора
    // (окно в незнакомой форме, конструктор внутри выражения) её не обходит.
    // Тот же приём уже работает на упакованном артефакте — checkHardening()
    // в scripts/verify-packed.js.
    assert.doesNotMatch(MAIN_CODE, /nodeIntegration:\s*true/, 'где-то в главном процессе окно с nodeIntegration: true');
    assert.doesNotMatch(MAIN_CODE, /contextIsolation:\s*false/, 'где-то в главном процессе окно с contextIsolation: false');
    assert.doesNotMatch(MAIN_CODE, /sandbox:\s*false/, 'где-то в главном процессе окно с sandbox: false');

    // Гардов DevTools обязано быть не меньше, чем конструкторов окон. Сравнение
    // с ЧИСЛОМ (было `=== 4`) пропускает пятое окно без гарда: счётчик остаётся
    // четвёркой. Сравниваются две величины, обе растущие вместе с кодом.
    const windows = (MAIN_CODE.match(/new BrowserWindow\(/g) || []).length;
    const guards = (MAIN_CODE.match(
        /devTools:\s*process\.argv\.includes\('--dev'\)\s*&&\s*!app\.isPackaged/g
    ) || []).length;
    assert.ok(windows > 0, 'в главном процессе не найдено ни одного BrowserWindow — проверка ослепла');
    assert.ok(
        guards >= windows,
        `окон ${windows}, гардов devTools ${guards} — окно осталось с режимом разработчика`
    );
});

test('DevTools не открываются программно вне того же гарда', () => {
    // Проверка ПОСТРОЧНАЯ и намеренно узкая. Первая версия смотрела 400 символов
    // до вызова и находила там строку `devTools: ...` из webPreferences соседнего
    // окна — то есть считала защищённым вызов, стоящий совсем в другом месте.
    // Проверено мутацией: незащищённый openDevTools проходил насквозь.
    const lines = MAIN.split('\n');
    const GUARD = /if\s*\(process\.argv\.includes\('--dev'\)\s*&&\s*!app\.isPackaged\)\s*\{/;

    lines.forEach((line, i) => {
        if (!line.includes('openDevTools')) { return; }
        // Гард обязан быть на одной из трёх предыдущих непустых строк.
        const preceding = lines
            .slice(Math.max(0, i - 3), i)
            .filter((l) => l.trim() !== '');
        assert.ok(
            preceding.some((l) => GUARD.test(l)),
            `строка ${i + 1}: openDevTools вызывается без непосредственного гарда `
            + '«--dev И не собранное приложение»'
        );
    });
});

// Единственный внешний адрес в приложении: страница релизов, открываемая в
// браузере пользователя. Объявлен здесь константой, чтобы исключение в гейте
// было ИМЕНОВАННЫМ, а не регуляркой «ну там что-то с github».
const RELEASES_URL = 'https://github.com/Jkaotlic/timer-widget/releases';

test('единственный внешний адрес уходит только в shell.openExternal', () => {
    // Гейт выше пропускает этот адрес. Проверка ниже следит, чтобы пропуск не
    // превратился в лазейку: адрес не должен попасть ни в loadURL (это
    // загрузило бы страницу В ОКНО приложения, мимо CSP и мимо изоляции), ни в
    // fetch/XMLHttpRequest (это и была бы та сетевая активность, которой здесь
    // быть не должно).
    const main = read('electron-main.js');
    assert.ok(main.includes(RELEASES_URL), 'адрес страницы релизов исчез из main — кнопка перестала работать?');

    assert.match(
        main, new RegExp(`shell\\.openExternal\\(\\s*RELEASES_URL`),
        'адрес обязан уходить в shell.openExternal — и только туда'
    );
    for (const forbidden of [/loadURL\(\s*RELEASES_URL/, /fetch\(\s*RELEASES_URL/, /XMLHttpRequest/]) {
        assert.doesNotMatch(main, forbidden, `адрес релизов используется запрещённым способом: ${forbidden}`);
    }

    // И канал обязан оставаться БЕЗ payload: shell.openExternal с адресом из
    // рендерера — это выполнение произвольного URL руками ОС.
    const handler = main.slice(main.indexOf("ipcMain.on('open-releases-page'"));
    const body = handler.slice(0, handler.indexOf('});') + 3);
    assert.doesNotMatch(
        body, /\(\s*_?event\s*,\s*[A-Za-z_$]/,
        'обработчик open-releases-page принимает payload — адрес обязан быть константой в main'
    );
});

test('в поставляемых файлах нет внешних сетевых адресов', () => {
    // Комментарии вырезаются: они объясняют, КАКУЮ телеметрию выключили, и
    // содержат адреса Google в качестве документации, а не как код.
    const strip = (text, file) => {
        let out = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
        if (file.endsWith('.html')) { out = out.replace(/<!--[\s\S]*?-->/g, ' '); }
        if (file.endsWith('.js') || file.endsWith('.html')) {
            out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
        }
        return out;
    };

    const offenders = [];
    for (const file of SHIPPED) {
        if (!/\.(js|html|css)$/.test(file)) { continue; }
        const code = strip(read(file), file);
        // Схемы, которые действительно уходят в сеть. data:, file: и about: — нет.
        const hits = code.match(/\b(?:https?|wss?|ftp):\/\/[^\s"'`)]+/g) || [];
        for (const hit of hits) {
            // Пространства имён XML — это идентификаторы, а не загрузка.
            if (hit.startsWith('http://www.w3.org/')) { continue; }
            // Страница релизов. Единственное исключение, и оно узкое: адрес не
            // ЗАГРУЖАЕТСЯ приложением, а передаётся браузеру пользователя через
            // shell.openExternal по явному клику. Инвариант гейта — «приложение
            // обязано работать без сети» — не задет: без сети не откроется
            // страница в браузере, а само приложение работает как работало.
            //
            // Исключение адресное (ровно этот URL, ровно в main-процессе) и
            // подпёрто отдельной проверкой ниже: адрес обязан уходить ТОЛЬКО в
            // shell.openExternal. Широкое «разрешим https в main» превратило бы
            // гейт в декорацию.
            if (file === 'electron-main.js' && hit === RELEASES_URL) { continue; }
            offenders.push(`${file}: ${hit}`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        'приложение обязано работать без сети; найдены внешние адреса:\n' + offenders.join('\n')
    );
});

test('шрифты подключены локально, а не из внешнего источника', () => {
    // Раньше список был ['control.css', ...WINDOW_HTML] с `continue` на файлах
    // без @font-face. После переезда объявлений в fonts.css такая проверка стала
    // бы ПУСТОЙ и зелёной: ни в одном из перечисленных файлов @font-face больше
    // нет, цикл бы весь вышел через continue. Поэтому объявления считаются, и
    // ноль объявлений — это падение.
    const withFonts = ['fonts.css', 'control.css', ...WINDOW_HTML];
    let declared = 0;
    for (const file of withFonts) {
        const text = read(file);
        if (!text.includes('@font-face')) { continue; }
        const sources = [...text.matchAll(/src:\s*url\((['"]?)([^)'"]+)\1\)/g)].map((m) => m[2]);
        assert.ok(sources.length > 0, `${file}: объявлен @font-face без src`);
        declared += sources.length;
        for (const src of sources) {
            assert.match(src, /^fonts\//, `${file}: шрифт грузится не из локальной папки: ${src}`);
        }
    }
    // Было 20: 12 Inter (6 начертаний × latin/cyrillic) + 8 JetBrains Mono
    // (4 начертания × latin/cyrillic). Стиль «Цифры» добавил ещё 4: Bebas Neue,
    // Oswald, Orbitron, Playfair Display — по одному начертанию каждый, только
    // latin (стиль печатает цифры, двоеточие и минус, кириллица не нужна). Итого 24.
    assert.ok(declared >= 24, `найдено ${declared} объявлений @font-face — проверка смотрит не туда`);

    // И объявления обязаны доезжать до КАЖДОГО окна: файл, который никто не
    // подключил, — это тот же запасной шрифт, только незаметнее.
    for (const file of WINDOW_HTML) {
        assert.match(
            read(file),
            /<link rel="stylesheet" href="fonts\.css">/,
            `${file}: не подключает fonts.css — окно отрисуется системным шрифтом`
        );
    }
    // Файлы шрифтов существуют — иначе останется молчаливый запасной шрифт.
    const woff = fs.readdirSync(path.join(ROOT, 'fonts')).filter((f) => f.endsWith('.woff2'));
    assert.ok(woff.length >= 10, `в fonts/ найдено ${woff.length} файлов woff2 — подозрительно мало`);
});

test('приложение не обновляет себя само', () => {
    assert.equal(PKG.build.publish, null, 'build.publish обязан быть null: автообновления нет');
    const deps = Object.keys(PKG.dependencies || {});
    for (const forbidden of ['electron-updater', 'update-electron-app']) {
        assert.ok(!deps.includes(forbidden), `зависимость ${forbidden} включает самообновление`);
    }
    assert.ok(
        !/autoUpdater|electron-updater/.test(MAIN),
        'в главном процессе появился автообновлятель'
    );
});

test('телеметрия Chromium выключена явно', () => {
    // Без этих ключей Chromium сам обращается к сервисам обновления компонентов
    // и подсказок — приложение бы «звонило домой» без единой строки нашего кода.
    assert.match(MAIN, /appendSwitch\('disable-features',\s*'[^']*ChromeVariations[^']*'\)/);
    assert.match(MAIN, /appendSwitch\('disable-features',\s*'[^']*OptimizationHints[^']*'\)/);
});

test('в каждом окне есть CSP и она не разрешает внешние источники', () => {
    for (const file of WINDOW_HTML) {
        const html = read(file);
        const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
        assert.ok(m, `${file}: нет CSP`);
        const policy = m[1];
        assert.match(policy, /default-src 'self'/, `${file}: default-src не 'self'`);
        assert.match(policy, /object-src 'none'/, `${file}: object-src не 'none'`);
        assert.ok(
            !/https?:/.test(policy),
            `${file}: CSP разрешает внешний источник — приложение перестанет быть автономным`
        );
    }
});

test('песочница Linux: ни одна цель не отключает её, deb ставит AppArmor и SUID только запасом', () => {
    // Ключ --no-sandbox отключает главную границу изоляции рендерера и
    // противоречит `sandbox: true` во всех окнах. Раньше он оставался у AppImage
    // «осознанным исключением» — и на ПСИ именно Linux-сборка не прошла по
    // критическим уязвимостям. AppImage убран: без шага установки песочницу на
    // Ubuntu 24.04+ не поднять ничем, кроме этого ключа.
    const build = JSON.stringify(PKG.build);
    assert.ok(!build.includes('--no-sandbox'), 'в конфигурации сборки снова есть --no-sandbox');
    assert.deepEqual(PKG.build.linux.target, ['deb'], 'Linux поставляется только deb-пакетом');
    assert.equal(PKG.build.appImage, undefined, 'секция appImage осталась без цели');

    const code = (file) => read(file)
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');

    // postinst: профиль AppArmor с userns (Ubuntu 24.04+ режет user namespaces
    // без него), а SUID-root на chrome-sandbox — ТОЛЬКО если user namespaces в
    // ядре нет вовсе. Бинарник с SUID-root там, где он не нужен, — лишняя
    // поверхность атаки, которую сканер помечает сам по себе.
    assert.equal(PKG.build.deb.afterInstall, 'build/linux-after-install.sh', 'postinst не подключён');
    const afterInstall = code('build/linux-after-install.sh');
    assert.match(afterInstall, /unshare --user true/, 'postinst не проверяет user namespaces перед SUID');
    assert.match(afterInstall, /chmod 4755/, 'нет запасного SUID для ядер без user namespaces');
    assert.match(afterInstall, /chown root:root/, 'SUID без владельца root бесполезен');
    assert.match(afterInstall, /chmod 0755/, 'при рабочих user namespaces SUID обязан сниматься');
    assert.match(afterInstall, /\/etc\/apparmor\.d\//, 'postinst не ставит профиль AppArmor');
    assert.match(afterInstall, /apparmor_parser --skip-kernel-load/, 'профиль ставится без пробной загрузки');

    // postrm: профиль выгружается и удаляется, purge не идёт по симлинкам.
    assert.equal(PKG.build.deb.afterRemove, 'build/linux-post-remove.sh', 'postrm подключён мимо electron-builder');
    assert.ok(
        !(PKG.build.deb.fpm || []).some((a) => a.startsWith('--after-remove')),
        'сырой --after-remove в fpm подменяет штатный postrm'
    );
    const afterRemove = code('build/linux-post-remove.sh');
    assert.match(afterRemove, /apparmor_parser --remove/, 'postrm не выгружает профиль AppArmor');
    assert.match(afterRemove, /-L /, 'purge удаляет каталоги, не проверив симлинк');
});

test('навигация и новые окна заблокированы', () => {
    // Сами запреты живут в navigation-guard.js (там их проверяют поведенчески,
    // tests/navigation-guard.test.js); здесь — что main их ПРИМЕНЯЕТ: к каждому
    // окну и к любому webContents, появившемуся в обход create-функций.
    const GUARD = codeOnly(read('navigation-guard.js'));
    for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) {
        assert.ok(GUARD.includes(`'${event}'`), `нет запрета ${event}`);
    }
    assert.match(GUARD, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/, 'нет запрета window.open');
    assert.match(MAIN_CODE, /function hardenWindow\(win\) \{\s*NavigationGuard\.guardWebContents\(/,
        'hardenWindow не ставит запреты navigation-guard');
    assert.match(
        MAIN_CODE,
        /app\.on\('web-contents-created',[^]*?NavigationGuard\.guardWebContents\(contents/,
        'нет глобального запрета на web-contents-created'
    );
    // Прежнее правило «любой file://» не вернулось.
    assert.doesNotMatch(MAIN_CODE, /startsWith\('file:\/\/'\)/, 'навигация снова пускает любой file://');
    assert.match(MAIN, /hardenWindow\(/, 'hardenWindow не применяется');
    // hardenWindow вызывается для каждого окна.
    const calls = (MAIN.match(/hardenWindow\((?!window)/g) || []).length;
    assert.ok(calls >= 4, `hardenWindow применён ${calls} раз, окон не меньше четырёх`);
});

test('фьюзы Electron: ни Node-режима, ни NODE_OPTIONS, ни --inspect, asar сверяется', () => {
    // Фьюзы — биты в самом бинаре Electron, их переворачивает electron-builder
    // при упаковке (build.electronFuses). Без них собранное приложение — это
    // полноценная Node с правами пользователя: ELECTRON_RUN_AS_NODE=1 превращает
    // его в интерпретатор, NODE_OPTIONS=--require подгружает чужой код в main,
    // --inspect открывает отладчик, а подменённый app.asar исполняется молча.
    // Здесь держится КОНФИГ, а scripts/verify-packed.js читает биты обратно из
    // собранного бинаря (CI, джоба pack) — конфиг, который electron-builder
    // тихо не применил, этот тест не увидит.
    assert.deepEqual(PKG.build.electronFuses, {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
        loadBrowserProcessSpecificV8Snapshot: false,
        // ОСТАЁТСЯ включённым, и это замер, а не недосмотр: окна грузятся с
        // file://, и без этого фьюза их origin непрозрачен — `localStorage`
        // бросает «Access is denied for this document», панель падает на
        // старте (проверено 25.09.2026: копия Electron с этим фьюзом, e2e
        // windows-load-clean). Выключить можно только вместе с переездом окон
        // на свою схему (protocol.handle) — а это смена origin и миграция всех
        // настроек пользователя.
        grantFileProtocolExtraPrivileges: true,
        // identity: null — сборка без подписи, electron-builder её не ставит.
        // Перевёрнутые биты ломают штатную ad-hoc подпись Electron, и на Apple
        // Silicon неподписанный бинарь убивается ядром при запуске. Переподпись
        // ad-hoc делает @electron/fuses сразу после переворота.
        resetAdHocDarwinSignature: true
    });
    // Сверка asar и «только из asar» без самого asar — пустые обещания.
    assert.notEqual(PKG.build.asar, false, 'asar выключен — фьюзы целостности бессмысленны');
    assert.notEqual(PKG.build.disableAsarIntegrity, true, 'хеш asar не пишется — сверять будет нечего');
    // Читалка фьюзов в verify-packed.js — прямая зависимость, а не случайно
    // приехавшая транзитивная: её версия обязана знать провод этого Electron.
    assert.ok(PKG.devDependencies['@electron/fuses'], '@electron/fuses не объявлен в devDependencies');
});
