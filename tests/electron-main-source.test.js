'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(repoRoot, 'electron-main.js'), 'utf8');

test('IPC handlers do not destructure renderer payloads in parameters', () => {
    const unsafeHandlers = [
        'display-move',
        'clock-widget-resize',
        'clock-widget-move',
        'widget-set-position',
        'widget-resize',
        'widget-move'
    ];

    for (const channel of unsafeHandlers) {
        const handlerPattern = new RegExp(
            `ipcMain\\.on\\('${channel}',\\s*\\([^)]*\\{[^)]*\\}[^)]*\\)\\s*=>`
        );
        assert.equal(
            handlerPattern.test(source),
            false,
            `${channel} must validate payload object before reading fields`
        );
    }
});

test('BrowserWindow DevTools are enabled only in unpackaged --dev runs', () => {
    // Считались СОВПАДЕНИЯ и сравнивались с четвёркой. Пятое окно, добавленное
    // без гарда, оставляет счётчик равным четырём — тест проходит на злом окне
    // (воспроизведено мутацией). Поэтому сравниваются две величины, растущие
    // вместе с кодом: гардов обязано быть не меньше, чем конструкторов окон.
    const windows = (source.match(/new BrowserWindow\(/g) || []).length;
    const guards = (source.match(
        /devTools:\s*process\.argv\.includes\('--dev'\)\s*&&\s*!app\.isPackaged/g
    ) || []).length;

    assert.ok(windows >= 4, `окон найдено ${windows}, ожидалось не меньше четырёх`);
    assert.ok(
        guards >= windows,
        `окон ${windows}, гардов devTools ${guards}: в сборке останется режим разработчика`
    );
});

test('control window uses packaged PNG app icon', () => {
    assert.equal(source.includes("path.join(__dirname, 'icon.ico')"), false);
    assert.equal(source.includes("path.join(__dirname, 'build', 'icon.png')"), true);
});

test('app icon resolves from process.resourcesPath when packaged (not inside asar)', () => {
    // build/icon.png is buildResources, NOT packed into app.asar — the packaged
    // build ships it via extraResources, so the runtime path must branch on
    // app.isPackaged and read process.resourcesPath. Using __dirname there would
    // point inside the asar where the file doesn't exist (blank tray icon).
    assert.match(source, /app\.isPackaged/);
    assert.match(source, /process\.resourcesPath/);
    // Both the window icon and the tray icon go through the shared helper.
    const helperUses = source.match(/getAppIconPath\(\)/g) || [];
    assert.ok(helperUses.length >= 2, 'window icon and tray icon should both use getAppIconPath()');
});

test('control window uses a transparent native surface for rounded corners', () => {
    assert.match(source, /transparent:\s*!__screenshotMode/);
    assert.match(source, /backgroundColor:\s*__screenshotMode\s*\?\s*'#000000'\s*:\s*'#00000000'/);
    assert.match(source, /hasShadow:\s*false/);
});

// ---------------------------------------------------------------------------
// Режим «полоса»: свёртывание окна управления
// ---------------------------------------------------------------------------

const { codeOnly, ipcHandlerBody, functionBody } = require('./helpers/source-scan.js');

test('свёртывание в полосу снимает пол минимального размера и возвращает его', () => {
    // Окно управления создаётся с minHeight: 660. Полоса — 52px, то есть НИЖЕ
    // пола, и без setMinimumSize запрос на сжатие молча обрезается до 660:
    // окно осталось бы панелью, а разметка уже переключилась бы в полосу.
    // Возврат пола обязателен: без него окно можно было бы растянуть мышью в
    // панель высотой 52 и получить обрезанную раскладку — ровно тот дефект,
    // который чинила задача про минимальную высоту.
    const src = codeOnly(source);
    const handler = /ipcMain\.on\('control-collapse'[\s\S]*?\n\}\);/.exec(src);
    assert.ok(handler, 'обработчика control-collapse нет');

    assert.match(
        handler[0],
        /setMinimumSize\(\s*CONFIG\.CONTROL_WINDOW_MIN_WIDTH\s*,\s*1\s*\)/,
        'пол не снимается перед сжатием'
    );
    assert.match(
        handler[0],
        /setMinimumSize\(\s*CONFIG\.CONTROL_WINDOW_MIN_WIDTH\s*,\s*CONFIG\.CONTROL_WINDOW_MIN_HEIGHT\s*\)/,
        'пол не возвращается при развороте'
    );
    assert.match(handler[0], /setAlwaysOnTop\(/, 'полоса не поднимается поверх окон');
    // Payload — не доверенный: высота обязана проверяться, как во всех
    // остальных обработчиках размеров.
    assert.match(handler[0], /Number\.isFinite\(/, 'высота из рендерера не проверяется');
});

test('канал control-collapse объявлен в whitelist', () => {
    const validator = require('../channel-validator.js');
    assert.ok(validator.ALLOWED_CHANNELS.send.includes('control-collapse'));
});

test('закрывающееся окно не считается открытым — во ВСЕХ трёх окнах', () => {
    // Разбор — в docs/lessons.md и в шапке e2e/window-reopen-race.spec.js.
    // Коротко: `close()` разрушает окно сразу, а событие `closed` — то, что
    // обнуляет ссылку в главном процессе — приходит следующим оборотом цикла.
    // Команда «открыть», попавшая в зазор, видела живую ссылку и уходила в
    // `focus()`; окно после этого закрывалось до конца, и его не оставалось.
    //
    // Проверяются ТЕЛА обработчиков, а не файл целиком: `isUsableWindow` есть
    // в файле по определению, и поиск по всему исходнику был бы зелёным при
    // полностью пустом обработчике.
    const OPENERS = ['open-widget', 'open-clock-widget', 'open-display'];
    for (const channel of OPENERS) {
        const code = codeOnly(ipcHandlerBody(source, channel));
        assert.match(
            code,
            /isUsableWindow\(/,
            `${channel}: ветка «просто сфокусировать» обязана спрашивать, не закрывается ли окно`
        );
        assert.match(
            code,
            /queueOpenAfterClose\(/,
            `${channel}: запрос, пришедший во время закрытия, обязан быть ОТЛОЖЕН, а не потерян`
        );
    }

    // «Закрыть» отменяет отложенное открытие — иначе окно возрождается само.
    for (const channel of ['close-widget', 'close-clock-widget', 'close-display']) {
        assert.match(
            codeOnly(ipcHandlerBody(source, channel)),
            /cancelQueuedOpen\(/,
            `${channel}: «закрыть» обязано отменять запланированное открытие`
        );
    }

    // Метка «закрываюсь» ставится ВЕЗДЕ, где зовётся close(): у виджета и
    // часов — и в обработчике канала, и в пункте трея (трей ходит МИМО IPC),
    // у дисплея — в closeDisplayWindow.
    //
    // Считать вхождения `markClosing(` по всему файлу нельзя: в счёт попадает
    // её собственное объявление, и проверка «вызовов не меньше четырёх»
    // остаётся зелёной, когда один вызов убрали. Это не выдумка — ровно так
    // первая версия этой проверки и прошла мутацию.
    for (const channel of ['close-widget', 'close-clock-widget']) {
        assert.match(
            codeOnly(ipcHandlerBody(source, channel)),
            /markClosing\(/,
            `${channel}: закрытие обязано помечать окно, иначе «открыть» в тот же миг видит его живым`
        );
    }
    const tray = codeOnly(functionBody(source, 'rebuildTrayMenu'));
    const trayMarks = (tray.match(/markClosing\(/g) || []).length;
    assert.equal(
        trayMarks, 2,
        `в rebuildTrayMenu ${trayMarks} пометок вместо двух (виджет и часы): трей закрывает окна МИМО IPC, `
        + 'и без метки там дефект возвращается только для этого пути'
    );

    const closeBody = codeOnly(functionBody(source, 'closeDisplayWindow'));
    const markIdx = closeBody.indexOf('_closing = true');
    const fullscreenIdx = closeBody.indexOf('isFullScreen()');
    assert.ok(markIdx > -1, 'closeDisplayWindow обязан помечать окно закрывающимся');
    assert.ok(
        markIdx < fullscreenIdx,
        'метка обязана стоять ДО развилки по полноэкранности, иначе мгновенное '
        + 'закрытие уходит без неё'
    );

    // У отложенного открытия ОДИН владелец на все окна: два запроса, пришедшие
    // пока окно закрывается, обязаны дать одно окно.
    const queue = codeOnly(functionBody(source, 'queueOpenAfterClose'));
    assert.match(queue, /pendingOpens\.has\(/, 'очередь обязана узнавать уже запланированное открытие');
    assert.match(queue, /once\('closed'/, 'открытие обязано ждать события закрытия');
    assert.match(
        queue,
        /setTimeout\(\s*run/,
        'нужна страховка по времени: окно, не приславшее closed, не имеет права '
        + 'сделать приложение НЕоткрываемым'
    );

    // Проверка себя: на исходнике с вырезанной проверкой тест обязан краснеть.
    const mutated = codeOnly(ipcHandlerBody(source, 'open-widget')).replace('isUsableWindow(', 'Boolean(');
    assert.doesNotMatch(
        mutated,
        /isUsableWindow\(/,
        'зонд сломан: он не отличает исходник с проверкой от исходника без неё'
    );
});
