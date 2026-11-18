'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Главный процесс целиком: точка входа и её модули main-*.js.
const { readMainSource } = require('./helpers/main-source');
const source = readMainSource();

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
    // `devTools: false` (окно переноса настроек, SEC-12) — тоже гард, и строже.
    const windows = (source.match(/new BrowserWindow\(/g) || []).length;
    const guards = (source.match(
        /devTools:\s*(?:false|process\.argv\.includes\('--dev'\)\s*&&\s*!app\.isPackaged)/g
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
    // Тело вырезается балансировкой скобок, а не поиском `\n});`: обработчик
    // живёт внутри функции регистрации модуля, и отступ у него другой.
    // Разворот вынесен в expandControlWindow: его зовут и канал, и
    // перезагрузка свёрнутой страницы (MAIN-09) — проверяются оба тела.
    // Поведение — в tests/main-control-ipc.test.js.
    const handler = [codeOnly(ipcHandlerBody(source, 'control-collapse'))
        + codeOnly(functionBody(source, 'expandControlWindow'))];
    assert.match(handler[0], /expandControlWindow\(/, 'канал не зовёт разворот');

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
    const displayOpen = codeOnly(ipcHandlerBody(source, 'open-display'));
    assert.match(displayOpen, /isUsableWindow\(/);
    assert.match(displayOpen, /queueOpenAfterClose\(/);
    assert.match(codeOnly(ipcHandlerBody(source, 'close-display')), /cancelQueuedOpen\(/);
    const tray = codeOnly(functionBody(source, 'rebuildTrayMenu'));
    for (const [channel, key] of [['widget', 'widget'], ['clock-widget', 'clock']]) {
        assert.ok(ipcHandlerBody(source, 'open-' + channel).includes(`openAuxWindow('${key}'`));
        assert.ok(ipcHandlerBody(source, 'close-' + channel).includes(`closeAuxWindow('${key}'`));
        assert.ok(tray.includes(`toggleAuxWindow('${key}'`));
    }

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
    const mutated = displayOpen.replace('isUsableWindow(', 'Boolean(');
    assert.doesNotMatch(
        mutated,
        /isUsableWindow\(/,
        'зонд сломан: он не отличает исходник с проверкой от исходника без неё'
    );
});
