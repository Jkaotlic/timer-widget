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

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PKG = JSON.parse(read('package.json'));
const MAIN = read('electron-main.js');

const WINDOW_HTML = [
    'electron-control.html',
    'electron-widget.html',
    'electron-clock-widget.html',
    'display.html'
];

// Файлы, которые реально попадают в сборку (без каталогов и шаблонов).
const SHIPPED = PKG.build.files.filter((f) => !f.includes('*'));

// Разбивает electron-main.js на блоки настроек окон: от `new BrowserWindow({`
// до закрывающей строки `});` на том же отступе.
function browserWindowBlocks(source) {
    const blocks = [];
    const re = /new BrowserWindow\(\{/g;
    let m;
    while ((m = re.exec(source)) !== null) {
        const start = m.index;
        const end = source.indexOf('\n    });', start);
        assert.ok(end !== -1, 'не найден конец блока new BrowserWindow');
        blocks.push(source.slice(start, end));
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
    const withFonts = ['control.css', ...WINDOW_HTML];
    for (const file of withFonts) {
        const text = read(file);
        if (!text.includes('@font-face')) { continue; }
        const sources = [...text.matchAll(/src:\s*url\((['"]?)([^)'"]+)\1\)/g)].map((m) => m[2]);
        assert.ok(sources.length > 0, `${file}: объявлен @font-face без src`);
        for (const src of sources) {
            assert.match(src, /^fonts\//, `${file}: шрифт грузится не из локальной папки: ${src}`);
        }
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

test('песочница Linux: ключ --no-sandbox только у AppImage', () => {
    // Ключ отключает главную границу изоляции рендерера и противоречит
    // `sandbox: true` во всех окнах. Он стоял на уровне `linux`, то есть уезжал
    // и в deb — при том что у deb есть шаг установки, на котором песочницу можно
    // настроить по-человечески. Разнесено по целям:
    //   deb      — SUID-помощник ставится в postinst, ключ не нужен;
    //   AppImage — устанавливать нечего, а user namespaces есть не везде
    //              (жёсткие ядра, AppArmor в Ubuntu 24.04), поэтому ключ остаётся
    //              осознанным исключением.
    assert.equal(
        PKG.build.linux.executableArgs,
        undefined,
        'executableArgs на уровне linux уезжает во ВСЕ цели, включая deb'
    );
    assert.deepEqual(
        PKG.build.appImage.executableArgs,
        ['--no-sandbox'],
        'у AppImage ключ должен быть указан явно, иначе он потеряется вместе с общим'
    );
    assert.equal(
        PKG.build.deb.executableArgs,
        undefined,
        'deb обязан идти с включённой песочницей'
    );

    // Скрипт установки обязан ставить SUID и владельца root — без этого
    // песочница в deb не поднимется на системах без user namespaces.
    // Комментарии вырезаются: скрипт намеренно объясняет, почему прежний
    // `chmod 0755` был неверным, и упоминает эту команду в тексте.
    const afterInstall = read('build/linux-after-install.sh')
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');
    assert.match(afterInstall, /chmod 4755/, 'postinst не ставит SUID-бит на chrome-sandbox');
    assert.match(afterInstall, /chown root:root/, 'postinst не задаёт владельца root');
    assert.ok(
        !/chmod 0755/.test(afterInstall),
        'вернулся chmod 0755: SUID снят, а ключа --no-sandbox в deb больше нет — приложение не стартует'
    );
    assert.equal(PKG.build.deb.afterInstall, 'build/linux-after-install.sh', 'postinst не подключён');
});

test('навигация и новые окна заблокированы', () => {
    assert.match(MAIN, /will-navigate/, 'нет запрета навигации');
    assert.match(MAIN, /setWindowOpenHandler/, 'нет запрета window.open');
    assert.match(MAIN, /hardenWindow\(/, 'hardenWindow не применяется');
    // hardenWindow вызывается для каждого окна.
    const calls = (MAIN.match(/hardenWindow\((?!window)/g) || []).length;
    assert.ok(calls >= 4, `hardenWindow применён ${calls} раз, окон не меньше четырёх`);
});
